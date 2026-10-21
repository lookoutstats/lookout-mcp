# lookout-mcp

[![npm](https://img.shields.io/npm/v/lookout-mcp?color=141412)](https://www.npmjs.com/package/lookout-mcp)
[![CI](https://github.com/lookoutstats/lookout-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/lookoutstats/lookout-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-141412)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP%20%2B%20stdio-141412)](https://modelcontextprotocol.io)

The MCP server for **[Lookout](https://lookoutstats.com)**: Vercel Web Analytics for all your projects, in one view. Ask Claude, Cursor or any MCP client about your sites — visitors, sources, campaigns, Core Web Vitals and traffic between your sites — and get answers from your real numbers.

> "Which landing page dropped most this week, and what deployed right before?"

It's a thin client of Lookout's public REST API: every answer comes from `api.lookoutstats.com`, and the server stores nothing. Run it two ways:

- **Hosted**, over Streamable HTTP: `https://mcp.lookoutstats.com`
- **Locally**, over stdio: `npx lookout-mcp`

## 60-second setup

1. In Lookout, open **Settings › API & MCP** and create an API key (`lk_live_…`). Tick **Allow notes and exports** only if you want the two write tools.
2. Add the server to your client below, paste the key, and restart the client.

### Claude Desktop

Settings → Developer → Edit config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lookout": {
      "command": "npx",
      "args": ["-y", "lookout-mcp"],
      "env": { "LOOKOUT_API_KEY": "lk_live_…" }
    }
  }
}
```

### claude.ai (connectors)

claude.ai custom connectors connect without a key header, so the hosted server can't take your API key from there yet. Until Lookout supports OAuth sign-in for connectors, use Claude Desktop (above) or Claude Code.

### Cursor

`.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` for every project):

```json
{
  "mcpServers": {
    "lookout": {
      "url": "https://mcp.lookoutstats.com",
      "headers": { "Authorization": "Bearer lk_live_…" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add --transport http lookout https://mcp.lookoutstats.com \
  --header "Authorization: Bearer lk_live_…"
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "lookout": {
      "serverUrl": "https://mcp.lookoutstats.com",
      "headers": { "Authorization": "Bearer lk_live_…" }
    }
  }
}
```

### Any other client

stdio: `LOOKOUT_API_KEY=lk_live_… npx -y lookout-mcp` · Streamable HTTP: `POST https://mcp.lookoutstats.com` with `Authorization: Bearer lk_live_…`.

## Tools

`range` is `24h`, `7d` (default) or `30d`, or a custom window `{ "from": "2026-10-01", "to": "2026-10-14" }` of up to 30 UTC days. A board can be named by its id or its exact name. Every tool answers with a one-line summary, then compact JSON.

| Tool | Arguments | What it returns |
|---|---|---|
| `list_boards` | — | The workspace's boards with ids and site counts |
| `get_board` | `board`, `range` | Every site on a board: visitors and change vs the previous period, page views, pages per visit, top source and country, conversions |
| `get_site` | `site`, `range`, `board?` | One site in depth: visitors per day (or hour), top referrers, countries and pages, production deployments, Core Web Vitals, and the board's notes |
| `compare_sites` | `sites[]` (1–5), `range`, `mode`, `baseline?` | Sites side by side: `absolute`, `indexed` (first bucket = 100) or `baseline` (% of one site) |
| `get_campaigns` | `site`, `range` | Visitors by UTM campaign, source and medium, with goal conversions (needs Vercel Web Analytics Plus) |
| `get_flow` | `board`, `range` | Traffic between a board's sites: who sends visitors where |
| `get_speed` | `site`, `range`, `device` | Core Web Vitals (LCP, INP, CLS, p75) for all, mobile or desktop visitors, and the slowest routes |
| `list_alerts` | — | Alert rules and what fired in the last 30 days |
| `add_annotation` ✎ | `board`, `site?`, `date`, `text`, `scope` | Pins a note to a day on the board's charts, for one site or all |
| `export_board` ✎ | `board`, `fmt` (`pdf`/`csv`), `range` | A download link for the board, valid for 5 minutes |

✎ Write tools: they need a key created with **Allow notes and exports**.

**Resources:** `lookout://boards` (the boards) and `lookout://boards/{id}` (a board's sites, last 7 days).
**Prompts:** `weekly_brief(board)` — a short brief with the biggest movers and why · `why_did_it_drop(site)` — when a drop started, what changed, and the likely cause.

## Try asking

1. "Which landing page dropped most this week, and what deployed right before?"
2. "Compare the three pricing pages over the last 30 days, indexed."
3. "Where do visitors to acme.com come from, and which campaign brought the most?"
4. "Are our sites passing Core Web Vitals on mobile? Which route is slowest?"
5. "Do my landing pages send visitors to the main site? Which ones are dead ends?"

## Security

- **Your key, your data only.** Every call goes to Lookout's API with your key; a key sees only its own workspace. The server keeps no data, no logs of answers, and never stores the key.
- **Read-only by default.** A key can only read unless you create it with *Allow notes and exports*; even then it can only add chart notes and make export links — never change boards, members, alerts or settings, and never see your Vercel token.
- **No personal data.** Vercel Web Analytics is cookieless and aggregated: answers contain counts, domains, paths, referrers and countries, not people.
- **Keep the key out of your repo.** Put it in your client's local config (`~/.cursor/mcp.json`, Claude's config, an env var), not a committed file. Revoke it any time in Settings › API & MCP; it stops working on the next request.
- **Limits.** 600 requests an hour per key, shared with the REST API. `get_site` makes 4–5 requests; the others make 1 (plus one to resolve a board name). Over the limit you get a `429` with `Retry-After`.

Report vulnerabilities to security@lookoutstats.com.

## Self-hosting

```bash
npm i -g lookout-mcp
PORT=3000 lookout-mcp-http        # Streamable HTTP on http://localhost:3000 (POST /, GET /health)
```

Or use the handler in your own server — it's a plain `(Request) => Promise<Response>`:

```ts
import { createHttpHandler } from "lookout-mcp/http";
export const POST = createHttpHandler();
```

This repo deploys to Vercel as is (`vercel.json`, `api/index.js`). `LOOKOUT_API_URL` points either entry at another API base.

## Links

- [Lookout](https://lookoutstats.com) · [API & MCP docs](https://lookoutstats.com/vercel-analytics-api-mcp) · [OpenAPI](https://api.lookoutstats.com/v1/openapi.json)
- [Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [MIT License](LICENSE)

Lookout is not affiliated with Vercel Inc.
