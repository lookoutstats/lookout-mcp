# Contributing to lookout-mcp

Thanks for helping. This is the MCP server for [Lookout](https://lookoutstats.com): a thin, stateless client of Lookout's public REST API. It holds no data and has no database.

## Setup

```bash
git clone https://github.com/lookoutstats/lookout-mcp.git
cd lookout-mcp
npm ci
npm run check   # lint, typecheck, tests, build
```

Node 20 or newer.

## Layout

| Path | What |
|---|---|
| `src/client.ts` | The REST client, typed from `src/generated/openapi.ts` |
| `src/server.ts` | Tools, resources and prompts |
| `src/range.ts` | The `range` argument: presets or a custom `{ from, to }` window |
| `src/stdio.ts` | `npx lookout-mcp` (stdio) |
| `src/http.ts` | Streamable HTTP, for Vercel or any Node server |
| `api/index.js` | The Vercel function behind `mcp.lookoutstats.com` |

## Changing the API types

The types come from the live OpenAPI document. After the API changes:

```bash
npm run gen:types
```

Commit the regenerated `src/generated/openapi.ts` with your change.

## Trying it locally

```bash
npm run build
LOOKOUT_API_KEY=lk_live_… npx @modelcontextprotocol/inspector node dist/stdio.js
# or the HTTP entry
PORT=3000 node dist/http.js
```

## Pull requests

- One topic per PR, with a test: every tool has one in `test/tools.test.ts`, against a mocked API.
- Tool names, arguments and summaries are part of the public contract. Change them only with a reason in the PR.
- Never log or echo API keys.
- `npm run check` must pass. CI runs it on Node 20 and 22.

## Releases

Maintainers bump `version` in `package.json`, `src/version.ts` and `server.json`, then push a `vX.Y.Z` tag. The Publish workflow checks and publishes to npm with provenance.

## Security

Please report vulnerabilities privately to security@lookoutstats.com, not in issues.
