# taxassist-spec-mcp

A local MCP (Model Context Protocol) server for building and maintaining
this repo's `spec.md`. It doesn't touch tax logic — it's a small structural
editor over one markdown file, addressed by `##` section heading, so an MCP
client (Claude Desktop, Claude Code, etc.) can read and edit the spec
without re-typing the whole document on every change.

## Tools

| Tool | Purpose |
|---|---|
| `spec_init` | Create a new spec file with a title and starter sections. Refuses to overwrite an existing file. |
| `spec_read` | Read the full spec file. |
| `spec_list_sections` | List `##` section headings in document order. |
| `spec_get_section` | Get the body of one section by heading. |
| `spec_upsert_section` | Create a section, or replace its body if it already exists. |
| `spec_append_to_section` | Append content to an existing section without discarding what's there. |
| `spec_log_change` | Append a dated bullet to the "Changelog" section. |

All paths are relative to the repo root (one directory up from
`mcp-server/`) and are sandboxed — a path that resolves outside the repo
root is rejected. The default target is `spec.md` at the repo root; pass
`path` to any tool to point at a different file.

## Setup

```bash
cd mcp-server
npm install
npm run build
```

## Running standalone (for testing)

```bash
npm start
```

This starts the server on stdio and blocks — it's meant to be launched by
an MCP client, not run interactively.

## Wiring into an MCP client

Add an entry pointing at the built server. For Claude Desktop / Claude Code
(`claude_desktop_config.json` or equivalent local MCP config):

```json
{
  "mcpServers": {
    "taxassist-spec": {
      "command": "node",
      "args": ["/absolute/path/to/Tax-assistant-/mcp-server/dist/index.js"]
    }
  }
}
```

Use an absolute path — the server resolves the repo root relative to its
own compiled file location (`dist/index.js`), so the client can be launched
from any working directory.
