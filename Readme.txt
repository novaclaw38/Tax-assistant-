DESIGN-MCP (repository: Tax-assistant-)
=======================================

NOTE: despite the repository name, this project is not a tax assistant. It contains
design-mcp, an MCP server that aggregates four UI design sources so Claude can search and
pull real component code from one connector.

TOOLS
-----
  list_sources                        List available sources and whether auth is configured
  search_components({query, source}) Search shadcn/ui, Magic UI, Aceternity UI
  get_component({source, name})      Fetch component code from those sources
  magic_generate({prompt})           AI-generated UI via 21st.dev (needs an API key)
  magic_search_logo({query})         Brand logos via 21st.dev (needs an API key)

The first three need no API key; they read each site's public component registry.

GETTING STARTED
---------------
  npm install
  npm run build
  npm start                          (runs dist/index.js over stdio)

Register with Claude Code:
  claude mcp add design-mcp -- node /path/to/dist/index.js
  (add -e TWENTY_FIRST_API_KEY=... for the 21st.dev tools)

PROJECT LAYOUT
--------------
  src/          Server source (src/registries.ts holds the registry adapter)
  package.json, tsconfig.json

See README.md for registration with Claude Desktop and notes on the static registries.
