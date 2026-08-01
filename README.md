# design-mcp

One MCP server aggregating four design/component sources so Claude can
search and pull real component code without juggling separate connectors.

## Tools

| Tool | Source | Auth needed |
|---|---|---|
| `list_sources` | — | no |
| `search_components({ query, source })` | shadcn/ui, Magic UI, Aceternity UI (`source: 'all'` or one) | no |
| `get_component({ source, name })` | shadcn/ui, Magic UI, Aceternity UI | no |
| `magic_generate({ prompt })` | 21st.dev (AI-generated UI) | yes |
| `magic_search_logo({ query })` | 21st.dev (brand logos) | yes |

`search_components` and `get_component` talk directly to each site's public
component registry (the same JSON the `shadcn` CLI itself reads) — no API
key, no rate limit beyond what those sites impose.

`magic_generate` and `magic_search_logo` proxy through 21st.dev's own
official MCP server (`@21st-dev/magic`) rather than reimplementing their
backend. They only work once `TWENTY_FIRST_API_KEY` is set — call
`list_sources` first to check.

## Setup

```bash
cd design-mcp
npm install
npm run build
```

Get a free 21st.dev key at https://21st.dev/mcp if you want `magic_generate`
/ `magic_search_logo` — optional, everything else works without it.

### Register with Claude Code

```bash
claude mcp add design-mcp -- node /home/byron/design-mcp/dist/index.js
# with the optional 21st.dev key:
claude mcp add design-mcp -e TWENTY_FIRST_API_KEY=sk_... -- node /home/byron/design-mcp/dist/index.js
```

### Register with Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "design-mcp": {
      "command": "node",
      "args": ["/home/byron/design-mcp/dist/index.js"],
      "env": { "TWENTY_FIRST_API_KEY": "sk_..." }
    }
  }
}
```

## Notes on the static registries

shadcn/ui, Magic UI, and Aceternity UI all serve components in the identical
shape (`{ name, dependencies, files: [{ path, content }] }`) — that's what
lets one adapter (`src/registries.ts`) cover all three. Magic UI and
Aceternity each publish a live `registry.json` index used for search; shadcn's
own registry predates that convention and has no live index, so its
component list is a hand-maintained array in `registries.ts` — update it if
shadcn ships new components that aren't showing up in search.
