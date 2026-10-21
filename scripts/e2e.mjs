// End-to-end check against the live Lookout API: starts the built stdio server (npm run build first), calls every tool,
// reads the resources and gets the prompts. Prints each tool's summary line, never the key.
//   LOOKOUT_API_KEY=lk_live_… node scripts/e2e.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (!process.env.LOOKOUT_API_KEY) throw new Error("Set LOOKOUT_API_KEY");
const transport = new StdioClientTransport({ command: process.execPath, args: [new URL("../dist/stdio.js", import.meta.url).pathname], env: { ...process.env } });
const client = new Client({ name: "lookout-mcp-e2e", version: "1.0.0" });
await client.connect(transport);

let failed = 0;
async function call(name, args = {}, { expectError = false } = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content[0].text;
  const ok = Boolean(res.isError) === expectError;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${text.split("\n")[0]}`);
  return res.structuredContent;
}

const { tools } = await client.listTools();
console.log(`tools: ${tools.length}`);
const { boards } = await call("list_boards");
const board = boards.find((b) => b.siteCount >= 2) ?? boards[0];
if (!board) throw new Error("The key's workspace has no boards");
const sites = (await call("get_board", { board: board.name, range: "7d" })).sites;
const [a, b] = sites;
await call("get_site", { site: a.id, range: "7d", board: board.id });
if (b) await call("compare_sites", { sites: [a.id, b.id], range: "30d", mode: "indexed" });
await call("get_campaigns", { site: a.id, range: "30d" });
await call("get_flow", { board: board.id, range: "30d" });
await call("get_speed", { site: a.id, range: "7d", device: "mobile" });
await call("list_alerts");
const today = new Date().toISOString().slice(0, 10);
const write = process.env.E2E_WRITE === "1";
await call("add_annotation", { board: board.id, site: a.id, date: today, text: "lookout-mcp e2e" }, { expectError: !write });
await call("export_board", { board: board.id, fmt: "csv", range: "7d" }, { expectError: !write });
const custom = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);
await call("get_board", { board: board.id, range: { from: custom, to: today } });

const res = await client.readResource({ uri: `lookout://boards/${board.id}` });
console.log(`✓ resource lookout://boards/{id}: ${JSON.parse(res.contents[0].text).sites.length} sites`);
const { resources } = await client.listResources();
console.log(`✓ resources listed: ${resources.length}`);
const brief = await client.getPrompt({ name: "weekly_brief", arguments: { board: board.name } });
console.log(`✓ prompt weekly_brief: ${brief.messages[0].content.text.split("\n")[0]}`);

await client.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
