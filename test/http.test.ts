import { describe, expect, it } from "vitest";
import { createHttpHandler } from "../src/http.js";
import { VERSION } from "../src/version.js";
import { boards, mockApi } from "./helpers.js";

const URL_ = "https://mcp.test/";
const post = (body: unknown, key: string | null = "lk_live_test") =>
  new Request(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });
const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } };
const call = (name: string, id = 2) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } });

describe("the Streamable HTTP entry", () => {
  it("answers the health route", async () => {
    const res = await createHttpHandler()(new Request("https://mcp.test/health"));
    expect(await res.json()).toEqual({ ok: true, name: "lookout-mcp", version: VERSION });
  });

  it("initializes and calls a tool statelessly, passing the caller's key to the API", async () => {
    const api = mockApi({ "GET /boards": () => boards });
    const handle = createHttpHandler({ baseUrl: "https://api.test/v1", fetch: api.fetch });
    const first = await handle(post(init));
    expect(first.status).toBe(200);
    expect(((await first.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe("lookout");
    const res = await handle(post(call("list_boards")));
    const body = (await res.json()) as { result: { content: { text: string }[] } };
    expect(body.result.content[0]!.text).toMatch(/^1 board: Clients/);
    expect(api.calls[0]!.auth).toBe("Bearer lk_live_test");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("needs a bearer key: 401 with WWW-Authenticate, and passes the API's 401 through", async () => {
    const handle = createHttpHandler({ fetch: mockApi({}).fetch });
    const missing = await handle(post(call("list_boards"), null));
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("Bearer");
    const refused = createHttpHandler({ baseUrl: "https://api.test/v1", fetch: mockApi({ "GET /boards": () => Response.json({ error: { code: "unauthorized", message: "x" } }, { status: 401 }) }).fetch });
    expect((await refused(post(call("list_boards")))).status).toBe(401);
  });

  it("passes the API's per-key rate limit through: 429 with Retry-After", async () => {
    const api = mockApi({ "GET /alerts": () => Response.json({ error: { code: "rate_limited", message: "Over" } }, { status: 429, headers: { "Retry-After": "90" } }) });
    const res = await createHttpHandler({ baseUrl: "https://api.test/v1", fetch: api.fetch })(post(call("list_alerts", 7)));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("90");
    expect(await res.json()).toEqual({ jsonrpc: "2.0", id: 7, error: { code: -32000, message: "Rate limited: 600 requests an hour per key" } });
  });

  it("answers 405 to GET, 404 off its paths, 204 to CORS preflight, and 400 to bad JSON", async () => {
    const handle = createHttpHandler();
    expect((await handle(new Request(URL_))).status).toBe(405);
    expect((await handle(new Request("https://mcp.test/nope", { method: "POST" }))).status).toBe(404);
    expect((await handle(new Request(URL_, { method: "OPTIONS" }))).status).toBe(204);
    expect((await handle(new Request(URL_, { method: "POST", body: "{", headers: { Authorization: "Bearer k" } }))).status).toBe(400);
  });
});
