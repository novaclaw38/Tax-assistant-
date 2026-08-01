# TaxAssist V1 Product Spec

## Problem

SARS auto-assessment now covers roughly 6M taxpayers a year, built from third-party
data feeds (employers, banks, medical schemes, retirement funds). That data is often wrong
or incomplete:

- Missing freelance income, rental income, or deductions not yet reflected in SARS's data feed.
- Most taxpayers don't know what to check on an assessment, or what they're entitled to claim.
- Provisional taxpayers (freelancers, side-hustlers, small landlords) still have to file
  properly and get no help doing it well.
- Taxpayers are explicitly wary of anyone who "guarantees a refund" — trust and transparency
  have to be core to the product, not an afterthought.

## Target Users (v1)

**Primary**: the "almost-simple" taxpayer — salaried, but with one or two complicating
factors (RA/pension contributions, medical aid, some freelance or rental income, maybe a home
office). Not complex enough to justify hiring an accountant, too complex to trust
auto-assessment blindly.

**Explicitly not v1**: full provisional taxpayers with complex business structures, trusts,
or CGT events. That's a v2/v3 expansion, not the v1 wedge.

## Positioning & Legal Guardrail

This is an **explainer + checklist tool**, not a registered tax practitioner service.
It does not file on the user's behalf and does not give personalized tax advice framed as
professional advice. It:

- Explains SARS's own assessment in plain language.
- Flags commonly-missed deduction categories for the user to check themselves.
- Prepares the user with a clean checklist before they touch eFiling.

This is designed to avoid RCB (Recognised Controlling Body) tax practitioner registration
requirements under the Tax Administration Act. **Get this confirmed by an actual tax attorney
or registered practitioner before launch** — this is a product decision, not legal advice.

See [Decisions Log](#decisions-log) for the s240 research backing this positioning.

## MVP Feature Set

1. **Assessment import** — user uploads/photographs their SARS auto-assessment (PDF or
   screenshot); OCR/parse into structured line items (income sources, deductions claimed,
   medical credits, RA contributions, refund/owing amount).
2. **Plain-language explainer** — walks through the assessment section by section: "This is
   what SARS thinks you earned. This is what they think you can claim. Here's your bottom
   line and why."
3. **Gap-check / deduction prompts** — rules-based checklist against common categories
   (RA/pension top-ups, medical aid credits, home office, travel logbook, donations (s18A),
   income protection premiums). Each prompt is a yes/no question with a plain explanation of
   what qualifies — not a calculation, a "go check this" flag.
4. **Freelance/side-income helper (light)** — simple income + expense capture for users who
   need to manually declare extra income not covered by auto-assessment. Not full
   bookkeeping — a guided form, not a ledger.
5. **Filing-day checklist export** — generates a one-page summary/checklist the user takes
   into eFiling themselves (PDF export).

## Out of Scope (v1)

- Filing on the user's behalf / eFiling integration.
- Provisional tax calculations (IRP6).
- CGT, trusts, multi-entity structures.
- Tax practitioner marketplace/referral (possible v2 monetization, not v1).
- Payroll/PAYE for employers.

## Architecture & Stack

- **Frontend**: Vite + React SPA, deployed on Vercel.
- **Backend**: Supabase (Postgres + Auth + Storage for uploaded assessments).
- **Extraction**: two paths, branched on input type — see
  [Document Extraction](#document-extraction).
- **Compliance**: POPIA is non-negotiable — this touches income, medical aid data (special
  personal information under POPIA), and ID numbers. Higher bar than typical SaaS compliance
  work.

## Data Model

Draft schema (Postgres / Supabase). RLS: every table scoped to `auth.uid() =
taxpayer_id` (or joined via `assessment -> taxpayer_id`). Given the sensitivity of this
data, this needs its own dedicated RLS audit before launch — do not reuse an RLS pattern from
another product without re-testing it against this schema specifically.

```sql
-- users (via Supabase Auth)

create table taxpayer_profiles (
  id uuid primary key references auth.users(id),
  tax_year int not null,
  is_provisional boolean default false,
  created_at timestamptz default now()
);

create table assessments (
  id uuid primary key default gen_random_uuid(),
  taxpayer_id uuid references taxpayer_profiles(id),
  tax_year int not null,
  source_file_url text, -- Supabase Storage path
  raw_ocr_json jsonb,    -- unparsed extraction output
  status text default 'uploaded', -- uploaded, parsed, reviewed, exported
  created_at timestamptz default now()
);

create table assessment_line_items (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid references assessments(id),
  category text not null, -- 'income', 'deduction', 'credit'
  subcategory text,        -- 'employer_income', 'medical_credit', 'ra_contribution', etc.
  label text,
  amount numeric,
  source text default 'sars', -- 'sars' vs 'user_added'
  created_at timestamptz default now()
);

create table deduction_prompts (
  id uuid primary key default gen_random_uuid(),
  code text unique not null, -- 'ra_topup', 'home_office', 'donations_18a', etc.
  question text not null,
  explanation text not null,
  applies_to text[] -- tags for filtering relevance e.g. 'salaried', 'freelance'
);

create table user_prompt_responses (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid references assessments(id),
  prompt_id uuid references deduction_prompts(id),
  answer boolean, -- yes/no
  note text,
  created_at timestamptz default now()
);

create table freelance_income_entries (
  id uuid primary key default gen_random_uuid(),
  taxpayer_id uuid references taxpayer_profiles(id),
  tax_year int not null,
  description text,
  income_amount numeric,
  expense_amount numeric,
  created_at timestamptz default now()
);
```

## Document Extraction

SARS issues **multiple distinct document types**, not just the ITA34. First extraction
step for both paths (PDF text / vision fallback) must be a **document type classifier**
before field extraction runs. At minimum, v1 must distinguish:

- **ITA34** — Notice of Assessment. The per-year assessment result itself (income, deductions,
  taxable income, tax liability).
- **ITSA** (Income Tax Statement of Account) — a running ledger covering a date range, showing
  transactions (assessments, payments, penalties, interest) posted to the account, plus a
  Refund Advice section when a refund is due.

These are treated as two distinct flows sharing one document-upload entry point: "explain my
refund/balance" (ITSA) vs. "check my deductions" (ITA34). The gap-check (deduction-level)
logic only makes sense against the ITA34 — the ITSA alone doesn't contain income/deduction
line items to check against.

### Extraction paths

Both the ITA34 and ITSA are fixed-template government forms — same field labels, same order,
every year. That makes this a much easier extraction problem than variable-format documents
(invoices, bank statements): the schema is known and stable.

1. **Text-native PDF** (downloaded from eFiling/MobiApp) — almost certainly has a real text
   layer, not a scanned image. Use direct PDF text extraction + label-matching against the
   known field schema (e.g. pdfplumber). No OCR/vision API needed — cheaper, faster, more
   reliable. **Build this path first.**
2. **Screenshot/photo** (no text layer) — needs vision-based extraction. Use a Claude vision
   call with the known field schema as the extraction target (structured JSON out), rather
   than generic OCR — the fixed template means the model knows exactly what to look for.
   **Add once path 1 is validated.**

Either path: always show the user the parsed fields before proceeding and let them correct
anything — never silently trust extraction on a document with real financial consequences.
Any field marked low-confidence or listed in `raw_fields_needing_review` must force user
confirmation before it's used anywhere downstream.

### ITA34 extraction schema

```json
{
  "reference_number": "string",
  "document_number": "string",
  "date_of_assessment": "YYYY-MM-DD",
  "year_of_assessment": "integer",
  "assessment_type": "Original | Additional | Reduced | Original Estimate",
  "payment_due_date": "YYYY-MM-DD | null",
  "grace_period_until": "YYYY-MM-DD | null",
  "prn_number": "string | null",
  "balance": {
    "description": "string",
    "amount": "number",
    "direction": "refund_to_taxpayer | payable_by_taxpayer | zero"
  },
  "compliance": {
    "unprocessed_payments": "number",
    "provisional_taxpayer": "boolean",
    "selected_for_audit_or_verification": "boolean"
  },
  "assessment_summary": {
    "income": { "previous": "number", "current": "number", "adjustment": "number" },
    "deductions_allowed": { "previous": "number", "current": "number", "adjustment": "number" },
    "taxable_income": { "previous": "number", "current": "number", "adjustment": "number" },
    "calculated_tax_liability": { "previous": "number", "current": "number", "adjustment": "number" }
  },
  "extraction_confidence": "high | medium | low",
  "extraction_path": "pdf_text | vision_fallback",
  "raw_fields_needing_review": ["array of field names the model was unsure about"]
}
```

### ITSA extraction schema

```json
{
  "document_type": "ITSA",
  "reference_number": "string",
  "issue_date": "YYYY-MM-DD",
  "statement_period": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "account_summary": {
    "balance_brought_forward": "number",
    "assessment": "number",
    "balance": "number"
  },
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "reference": "string",
      "description": "string",
      "tax_year": "integer | null",
      "value": "number",
      "running_balance": "number"
    }
  ],
  "compliance": {
    "unprocessed_payments": "number",
    "provisional_taxpayer": "boolean",
    "selected_for_audit_or_verification": "boolean",
    "outstanding_returns": "boolean"
  },
  "refund_advice": {
    "refund_amount": "number | null",
    "note": "string"
  },
  "sign_convention": "negative = credit owed to taxpayer, per SARS's own printed note",
  "extraction_confidence": "high | medium | low",
  "extraction_path": "pdf_text | vision_fallback",
  "raw_fields_needing_review": ["array"]
}
```

**Sign-convention quirk (must be encoded explicitly)**: SARS prints a negative sign for credit
balances (money owed *to* the taxpayer) — the opposite of how most people intuitively read a
negative number in a financial context. The plain-language explainer MUST translate sign into
words ("this is a refund owed to you") rather than showing the taxpayer a raw negative number.

### Vision fallback prompt (draft, for screenshots/photos)

```
You are extracting structured data from a South African SARS ITA34
(Notice of Assessment) image. This is a fixed-template government form.

Extract ONLY the following fields, using the exact JSON schema below.
If a field is not visible or you are not confident in a value, set it to
null and add its name to "raw_fields_needing_review" — do NOT guess or
estimate any financial figure.

[schema pasted here]

Rules:
- Amounts must be extracted exactly as printed, including sign (negative
  for amounts owed by SARS vs owed to SARS — check context).
- Dates must be normalized to YYYY-MM-DD.
- If the image is not an ITA34 (wrong document type, illegible, cropped),
  return {"error": "reason"} instead of the schema.
- Never infer a value that isn't visibly printed on the document.
```

A confident-sounding wrong extraction is worse than a flagged null for a financial document —
this instruction is load-bearing, not boilerplate.

## Gap-Check & Anomaly Detection

Two distinct passes, run in this order:

1. **Structural anomaly pass** (run first, before deduction-specific questions) — does
   anything on this assessment look structurally off, independent of any specific deduction:
   - R0 assessed income for a profile that looks employed/salaried.
   - Refund/payment status contradicting the top-line balance (e.g. a refund shown as due but
     actually withheld pending action, buried in boilerplate text elsewhere in the document).
   - Transaction or event dates inconsistent with the document's own issue date (e.g. a
     "pending" or scheduled entry dated after the statement was issued) — surface as "worth
     checking on eFiling," not silently ignored or silently assumed fine.
   - Compliance flags: provisional taxpayer, selected for audit/verification, outstanding
     returns.

   These must surface on the **first screen** the user sees, not buried in a "read the fine
   print" step — see the worked example in [Decisions Log](#decisions-log) for why.

2. **Deduction-level gap-check** (ITA34 only) — rules-based checklist against common
   categories: RA/pension top-ups, medical aid credits, home office, travel logbook, donations
   (s18A), income protection premiums. Each prompt is a yes/no question with a plain
   explanation of what qualifies — a "go check this" flag, not a calculation. This pass only
   makes sense against an ITA34; an ITSA has no income/deduction line items to check. If the
   user has only uploaded an ITSA, prompt them to also pull the matching ITA34 for that tax
   year before running this pass.

## Monetization

- **Freemium**: explainer + checklist free; deduction gap-check + PDF export behind a
  small once-off fee. Matches the seasonal nature of the product — people pay once a year, not
  monthly.
- **Seasonal pricing** makes more sense here than a subscription model — usage clusters around
  filing season (Jul–Oct).
- **Later**: referral fee to registered tax practitioners for complex cases the app flags as
  "you need a professional" — a clean upsell that keeps the core product out of
  practitioner-registration territory.

## Decisions Log

Research findings that shaped the scope above, kept here for traceability.

**s240 / Tax Administration Act (Jul 2026)** — The registration trigger is a *natural person*
who provides tax advice or completes/assists in completing a return *for consideration* (the
"free" exemption doesn't apply since we're charging). Software that explains an assessment and
prompts the user to self-check deduction categories — without a human at the company
completing/assisting with the actual return, and without submitting to SARS on the user's
behalf — sits outside the s240 trigger as currently understood. TaxTim (SA market leader,
14M+ users) validates this split in practice: "guidance" (self-service, base price) is
separated from "we do it for you" (requires their in-house registered practitioners, priced
separately, only for audits/disputes/complex calculations).
**Decision**: stay entirely in the explainer + checklist lane for v1 — no eFiling submission
integration, no "we file for you" tier. A "human practitioner does it for you" tier is a valid
v2/v3 expansion, but a distinct compliance and staffing decision, not a feature toggle.
Still get final sign-off from an actual tax attorney before launch.

**Worked example — real ITSA (Aug 2026)** — Ran the v1 concept against a real ITSA sample.
Result: a refund of R3,297.05 for the 2021 tax year, no compliance blockers, but a second
transaction ("Additional assessment 2021", R0.00) dated *after* the statement's own issue
date. Confirmed the anomaly pass needs a date-consistency check, and confirmed the ITSA/ITA34
split described in [Document Extraction](#document-extraction).

**Worked example — real ITA34, "the value prop in one document" (Aug 2026)** — A real ITA34
test document showed the top-line summary and the actual account status telling two different
stories. Top summary (page 1): a clean R3,297.05 refund, no flags. Full read of the document
revealed: (1) assessed income was R0.00 — for a salaried taxpayer, a red flag that IRP5 data
either didn't reach SARS or wasn't matched to the account; (2) the refund was actually
*withheld*, not incoming — SARS stated in boilerplate on page 3 of 5 that it couldn't be paid
because they didn't hold valid banking details. Nothing on page 1 hinted at either issue. This
is the product's core value prop in one concrete example, and is the direct justification for
running the structural anomaly pass before any deduction-specific prompts.

## Open Questions

1. Given the seasonal spike (Jul–Oct), is the acquisition/marketing plan built around
   that window, or year-round positioning (e.g. "get ready early")?
2. Real-world OCR/extraction testing against actual user documents (beyond the sample set
   already reviewed) is still needed to confirm reliability at scale.
3. Final legal sign-off on the practitioner-registration positioning (see Decisions Log) is
   still outstanding — treat as a launch blocker, not a nice-to-have.

## Changelog

- 2026-08-01: Initial spec assembled from product scope
  notes via the taxassist-spec-mcp server.
