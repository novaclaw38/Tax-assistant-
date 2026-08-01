import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * A tiny markdown "document store" scoped to one spec file, addressed by
 * H2 (##) section headings. Deliberately dumb: no nested-heading awareness,
 * no markdown AST — just enough structure for an MCP client to read/write
 * a spec.md without clobbering unrelated sections on every edit.
 */

export interface Section {
  heading: string;
  body: string; // content between this heading and the next, trimmed
}

export interface ParsedSpec {
  title: string; // H1 line, verbatim (including "# ")
  preamble: string; // content between H1 and first H2, trimmed
  sections: Section[];
}

const H1_RE = /^# (.+)$/;
const H2_RE = /^## (.+)$/;

export function parseSpec(raw: string): ParsedSpec {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let title = "";
  let cursor = 0;

  if (lines[0] && H1_RE.test(lines[0])) {
    title = lines[0];
    cursor = 1;
  }

  const sections: Section[] = [];
  let preambleLines: string[] = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (; cursor < lines.length; cursor++) {
    const line = lines[cursor];
    const h2 = line.match(H2_RE);
    if (h2) {
      if (current) {
        sections.push({ heading: current.heading, body: current.lines.join("\n").trim() });
      }
      current = { heading: h2[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  if (current) {
    sections.push({ heading: current.heading, body: current.lines.join("\n").trim() });
  }

  return { title, preamble: preambleLines.join("\n").trim(), sections };
}

export function renderSpec(spec: ParsedSpec): string {
  const parts: string[] = [];
  if (spec.title) parts.push(spec.title);
  if (spec.preamble) parts.push(spec.preamble);
  for (const s of spec.sections) {
    parts.push(`## ${s.heading}\n\n${s.body}`.trimEnd());
  }
  return parts.join("\n\n") + "\n";
}

export class SpecStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** Resolves a user-supplied relative path and refuses to leave the repo root. */
  resolvePath(relPath: string): string {
    const resolved = path.resolve(this.root, relPath);
    const normalizedRoot = path.resolve(this.root) + path.sep;
    if (resolved !== path.resolve(this.root) && !resolved.startsWith(normalizedRoot)) {
      throw new Error(`Path "${relPath}" resolves outside the repo root; refusing.`);
    }
    return resolved;
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(relPath));
      return true;
    } catch {
      return false;
    }
  }

  async read(relPath: string): Promise<string> {
    return fs.readFile(this.resolvePath(relPath), "utf8");
  }

  async write(relPath: string, content: string): Promise<void> {
    const full = this.resolvePath(relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }

  async parse(relPath: string): Promise<ParsedSpec> {
    return parseSpec(await this.read(relPath));
  }

  async save(relPath: string, spec: ParsedSpec): Promise<void> {
    await this.write(relPath, renderSpec(spec));
  }
}
