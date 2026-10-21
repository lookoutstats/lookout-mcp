# lookout-mcp

[![npm](https://img.shields.io/npm/v/lookout-mcp?color=141412)](https://www.npmjs.com/package/lookout-mcp)
[![CI](https://github.com/lookoutstats/lookout-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/lookoutstats/lookout-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-141412)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP%20%2B%20stdio-141412)](https://modelcontextprotocol.io)

This is the MCP server for **[Lookout](https://lookoutstats.com)**. Lookout shows Vercel Web Analytics for all your projects in one view.

Connect Claude, Cursor or a different MCP client. Then ask about your sites: visitors, sources, campaigns, Core Web Vitals and traffic between your sites. The answers come from your real numbers.

> "Which landing page dropped most this week, and what deployed right before?"

The server is a thin client of the Lookout REST API. Every answer comes from `api.lookoutstats.com`. The server stores no data.

You can run the server in two ways:

- **Hosted**, over Streamable HTTP: `https://mcp.lookoutstats.com`
- **Local**, over stdio: `npx lookout-mcp`

## 60-second setup

1. In Lookout, open **Settings › API & MCP** and create an API key (`lk_live_…`). Select **Allow notes and exports** only if you want the two write tools.
2. Add the server to your client with one of the configurations below. Paste the key into the configuration.
3. Restart the client.

### Claude Desktop

Open Settings → Developer → Edit config (`claude_desktop_config.json`), and add this entry:

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

A claude.ai custom connector does not send a key header. Thus the hosted server cannot get your API key from a connector yet. Use Claude Desktop (above) or Claude Code until Lookout supports OAuth sign-in for connectors.

### Cursor

Put this in `.cursor/mcp.json` in your project. To use the server in all your projects, put it in `~/.cursor/mcp.json`.

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

Put this in `~/.codeium/windsurf/mcp_config.json`:

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

### Other clients

- stdio: `LOOKOUT_API_KEY=lk_live_… npx -y lookout-mcp`
- Streamable HTTP: `POST https://mcp.lookoutstats.com` with the header `Authorization: Bearer lk_live_…`

## Tools

These rules apply to all tools:

- `range` is `24h`, `7d` (the default) or `30d`. It can also be a custom window, for example `{ "from": "2026-10-01", "to": "2026-10-14" }`. A custom window is 30 UTC days or less.
- `board` is the board's id or its exact name.
- Each tool returns a one-line summary first. Compact JSON follows the summary.

| Tool | Arguments | Result |
|---|---|---|
| `list_boards` | — | The boards in the workspace, with their ids and site counts |
| `get_board` | `board`, `range` | All sites on a board. For each site: visitors, change against the previous period, page views, pages per visit, top source and country, conversions |
| `get_site` | `site`, `range`, `board?` | One site in detail. It shows visitors per day (or per hour), top referrers, countries and pages, production deployments and Core Web Vitals. With `board`, it also shows the notes. |
| `compare_sites` | `sites[]` (1–5), `range`, `mode`, `baseline?` | Sites side by side. `absolute` shows visitors. `indexed` sets the first bucket to 100. `baseline` shows each site as a percentage of one site. |
| `get_campaigns` | `site`, `range` | Visitors by UTM campaign, source and medium, with goal conversions. This needs Vercel Web Analytics Plus. |
| `get_flow` | `board`, `range` | Traffic between the sites on a board: which site sends visitors to which site |
| `get_speed` | `site`, `range`, `device` | Core Web Vitals (LCP, INP, CLS, p75) for all, mobile or desktop visitors, and the slowest routes |
| `list_alerts` | — | The alert rules, and the alerts of the last 30 days |
| `add_annotation` ✎ | `board`, `site?`, `date`, `text`, `scope` | Adds a note to a day on the board's charts, for one site or for all sites |
| `export_board` ✎ | `board`, `fmt` (`pdf` or `csv`), `range` | A download link for the board. The link is valid for 5 minutes. |

✎ A write tool. A write tool needs a key with **Allow notes and exports**.

**Resources:**

- `lookout://boards`: the boards.
- `lookout://boards/{id}`: the sites on a board, for the last 7 days.

**Prompts:**

- `weekly_brief(board)`: a short brief. It names the sites with the largest changes and the causes.
- `why_did_it_drop(site)`: finds when a drop started, what changed, and the likely cause.

## Example questions

1. "Which landing page dropped most this week, and what deployed right before?"
2. "Compare the three pricing pages over the last 30 days, indexed."
3. "Where do visitors to acme.com come from, and which campaign brought the most?"
4. "Are our sites passing Core Web Vitals on mobile? Which route is slowest?"
5. "Do my landing pages send visitors to the main site? Which ones are dead ends?"

## Security

- **Your key gets only your data.** Each call goes to the Lookout API with your key. A key can only see its own workspace. The server keeps no data and does not log answers. The server does not store the key.
- **A key is read-only by default.** A key can only read data unless you create it with *Allow notes and exports*. A write key can add chart notes and make export links. It cannot change boards, members, alerts or settings. It cannot see your Vercel token.
- **No personal data.** Vercel Web Analytics does not use cookies. It reports aggregated data. Answers contain counts, domains, paths, referrers and countries. Answers do not identify people.
- **Keep the key out of your repository.** Put the key in a local configuration of your client. Examples are `~/.cursor/mcp.json`, the Claude configuration and an environment variable. Do not put it in a file that you commit. You can revoke a key at any time in Settings › API & MCP. A revoked key stops on the next request.
- **Limits.** Each key has 600 requests per hour. The REST API and the MCP server share this limit. `compare_sites` makes 1 request for each site. Each other tool makes 1 request. Above the limit, you get a `429` response with a `Retry-After` header. The hosted server accepts batches of 5 messages or fewer.
- **Data from outside.** Referrers, paths, UTM values, deployment messages and note texts come from websites and their visitors. The server tells the model to use them as data, not as instructions. Keep keys read-only unless you need the write tools.

Send security problems to security@lookoutstats.com.

## Self-hosting

```bash
npm i -g lookout-mcp
PORT=3000 lookout-mcp-http        # Streamable HTTP on http://127.0.0.1:3000 (POST /, GET /health)
```

The server listens on `127.0.0.1` by default. In a container, set `HOST=0.0.0.0`.

You can also use the handler in your own server. The handler is a plain `(Request) => Promise<Response>` function:

```ts
import { createHttpHandler } from "lookout-mcp/http";
export const POST = createHttpHandler();
```

You can deploy this repository to Vercel without changes (`vercel.json`, `api/index.js`). To use a different API base URL with either entry point, set `LOOKOUT_API_URL`.

## Links

- [Lookout](https://lookoutstats.com) · [API & MCP documentation](https://lookoutstats.com/vercel-analytics-api-mcp) · [OpenAPI](https://api.lookoutstats.com/v1/openapi.json)
- [Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [MIT License](LICENSE)

Lookout is not affiliated with Vercel Inc.
