#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "./client.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

// `npx lookout-mcp`: the MCP server over stdio, for Claude Desktop, Cursor, Windsurf and other local clients. The key comes
// from LOOKOUT_API_KEY; LOOKOUT_API_URL points at another API (tests, self-hosting). Logs go to stderr: stdout is the protocol.

const apiKey = process.env.LOOKOUT_API_KEY?.trim();
if (!apiKey) {
  process.stderr.write("lookout-mcp: set LOOKOUT_API_KEY to an API key from Lookout → Settings › API & MCP (lk_live_…).\n");
  process.exit(1);
}

const client = createClient({ apiKey, baseUrl: process.env.LOOKOUT_API_URL, userAgent: `lookout-mcp/${VERSION} (stdio)` });
await createServer(client).connect(new StdioServerTransport());
process.stderr.write(`lookout-mcp ${VERSION} ready on stdio\n`);
