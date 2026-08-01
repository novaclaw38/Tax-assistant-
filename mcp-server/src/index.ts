#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpecStore, type Section } from "./spec-store.js";

// Repo root = one level up from mcp-server/. All spec file paths are
// resolved (and sandboxed) relative to this.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_SPEC_PATH = "spec.md";

const store = new SpecStore(REPO_ROOT);

const server = new McpServer({
  name: "taxassist-spec-mcp",
  version: "1.0.0",
});

const specPathArg = z
  .string()
  .default(DEFAULT_SPEC_PATH)
  .describe(`Path to the spec file, relative to the repo root. Defaults to "${DEFAULT_SPEC_PATH}".`);

function formatSectionList(sections: Section[]): string {
  if (sections.length === 0) return "(no ## sections yet)";
  return sections.map((s, i) => `${i + 1}. ${s.heading}`).join("\n");
}

server.registerTool(
  "spec_read",
  {
    title: "Read spec",
    description:
      "Read the full contents of the spec markdown file (title, preamble, and all ## sections).",
    inputSchema: { path: specPathArg },
  },
  async ({ path: relPath }) => {
    if (!(await store.exists(relPath))) {
      return {
        content: [{ type: "text", text: `No spec file at "${relPath}" yet. Call spec_init first.` }],
        isError: true,
      };
    }
    const text = await store.read(relPath);
    return { content: [{ type: "text", text }] };
  }
);

server.registerTool(
  "spec_init",
  {
    title: "Initialize spec",
    description:
      "Create a new spec file with a title and starter sections if one doesn't already exist at the given path. Never overwrites an existing file — use spec_upsert_section to edit an existing spec.",
    inputSchema: {
      path: specPathArg,
      title: z.string().describe('Document title, without the leading "# " (e.g. "TaxAssist V1 Product Spec").'),
      sections: z
        .array(z.object({ heading: z.string(), body: z.string().default("") }))
        .default([
          { heading: "Problem", body: "" },
          { heading: "Scope", body: "" },
          { heading: "Non-Goals", body: "" },
          { heading: "Design", body: "" },
          { heading: "Open Questions", body: "" },
          { heading: "Changelog", body: "" },
        ])
        .describe("Initial ## sections to seed the document with."),
    },
  },
  async ({ path: relPath, title, sections }) => {
    if (await store.exists(relPath)) {
      return {
        content: [
          {
            type: "text",
            text: `A spec already exists at "${relPath}". Refusing to overwrite; use spec_upsert_section instead.`,
          },
        ],
        isError: true,
      };
    }
    await store.save(relPath, { title: `# ${title}`, preamble: "", sections });
    return {
      content: [{ type: "text", text: `Created "${relPath}" with sections:\n${formatSectionList(sections as Section[])}` }],
    };
  }
);

server.registerTool(
  "spec_list_sections",
  {
    title: "List spec sections",
    description: "List the ## section headings currently in the spec, in document order.",
    inputSchema: { path: specPathArg },
  },
  async ({ path: relPath }) => {
    const spec = await store.parse(relPath);
    return {
      content: [
        {
          type: "text",
          text: `Title: ${spec.title || "(none)"}\n\nSections:\n${formatSectionList(spec.sections)}`,
        },
      ],
    };
  }
);

server.registerTool(
  "spec_get_section",
  {
    title: "Get spec section",
    description: "Get the body content of one ## section by heading (exact match, case-insensitive).",
    inputSchema: { path: specPathArg, heading: z.string().describe("Section heading text, without '## '.") },
  },
  async ({ path: relPath, heading }) => {
    const spec = await store.parse(relPath);
    const section = spec.sections.find((s) => s.heading.toLowerCase() === heading.toLowerCase());
    if (!section) {
      return {
        content: [
          {
            type: "text",
            text: `No section "${heading}" found. Existing sections:\n${formatSectionList(spec.sections)}`,
          },
        ],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: section.body || "(empty)" }] };
  }
);

server.registerTool(
  "spec_upsert_section",
  {
    title: "Create or replace spec section",
    description:
      "Create a ## section if it doesn't exist, or replace its entire body if it does. Use spec_append_to_section instead if you just want to add content without discarding what's there.",
    inputSchema: {
      path: specPathArg,
      heading: z.string().describe("Section heading text, without '## '."),
      body: z.string().describe("Full replacement body for the section (markdown)."),
      after: z
        .string()
        .optional()
        .describe(
          "When creating a new section, insert it immediately after this existing heading. Omit to append at the end. Ignored when the section already exists."
        ),
    },
  },
  async ({ path: relPath, heading, body, after }) => {
    if (!(await store.exists(relPath))) {
      return {
        content: [{ type: "text", text: `No spec file at "${relPath}" yet. Call spec_init first.` }],
        isError: true,
      };
    }
    const spec = await store.parse(relPath);
    const idx = spec.sections.findIndex((s) => s.heading.toLowerCase() === heading.toLowerCase());
    if (idx >= 0) {
      spec.sections[idx] = { heading: spec.sections[idx].heading, body };
    } else {
      const afterIdx = after
        ? spec.sections.findIndex((s) => s.heading.toLowerCase() === after.toLowerCase())
        : -1;
      const insertAt = afterIdx >= 0 ? afterIdx + 1 : spec.sections.length;
      spec.sections.splice(insertAt, 0, { heading, body });
    }
    await store.save(relPath, spec);
    return {
      content: [{ type: "text", text: `${idx >= 0 ? "Updated" : "Created"} section "${heading}" in "${relPath}".` }],
    };
  }
);

server.registerTool(
  "spec_append_to_section",
  {
    title: "Append to spec section",
    description:
      "Append markdown content to the end of an existing ## section's body (e.g. add one more bullet without retyping the rest). Fails if the section doesn't exist.",
    inputSchema: {
      path: specPathArg,
      heading: z.string().describe("Section heading text, without '## '."),
      content: z.string().describe("Markdown content to append."),
    },
  },
  async ({ path: relPath, heading, content }) => {
    const spec = await store.parse(relPath);
    const idx = spec.sections.findIndex((s) => s.heading.toLowerCase() === heading.toLowerCase());
    if (idx < 0) {
      return {
        content: [
          {
            type: "text",
            text: `No section "${heading}" found. Use spec_upsert_section to create it first.\nExisting sections:\n${formatSectionList(spec.sections)}`,
          },
        ],
        isError: true,
      };
    }
    const existing = spec.sections[idx].body;
    spec.sections[idx] = {
      heading: spec.sections[idx].heading,
      body: existing ? `${existing}\n${content}` : content,
    };
    await store.save(relPath, spec);
    return { content: [{ type: "text", text: `Appended to section "${heading}" in "${relPath}".` }] };
  }
);

server.registerTool(
  "spec_log_change",
  {
    title: "Log a spec change",
    description:
      'Append a dated bullet to the "Changelog" section (creating it at the end of the document if missing). Use this after any meaningful spec_upsert_section / spec_append_to_section edit so the spec keeps a traceable history.',
    inputSchema: {
      path: specPathArg,
      summary: z.string().describe("One-line summary of what changed and why."),
      date: z
        .string()
        .optional()
        .describe("ISO date (YYYY-MM-DD). Defaults to today (server clock) if omitted."),
    },
  },
  async ({ path: relPath, summary, date }) => {
    const spec = await store.parse(relPath);
    const stamp = date ?? new Date().toISOString().slice(0, 10);
    const entry = `- ${stamp}: ${summary}`;
    const idx = spec.sections.findIndex((s) => s.heading.toLowerCase() === "changelog");
    if (idx >= 0) {
      const existing = spec.sections[idx].body;
      spec.sections[idx] = { heading: spec.sections[idx].heading, body: existing ? `${existing}\n${entry}` : entry };
    } else {
      spec.sections.push({ heading: "Changelog", body: entry });
    }
    await store.save(relPath, spec);
    return { content: [{ type: "text", text: `Logged change to "${relPath}": ${entry}` }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("taxassist-spec-mcp fatal error:", err);
  process.exit(1);
});
