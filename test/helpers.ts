import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createClient } from "../src/client.js";
import { createServer } from "../src/server.js";

export const BOARD = "6f1c2a4e-1b2c-4d3e-8f90-0a1b2c3d4e5f";
export const NOW = new Date("2026-10-21T12:00:00Z");

/** One recorded API call. */
export interface Call {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  auth: string | null;
}

type Route = (call: Call) => unknown | Response;

/** A fake Lookout API: "GET /boards" → handler. Unknown routes answer 404, like the API. Records every call. */
export function mockApi(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const path = url.pathname.replace(/^\/v1/, "");
    const method = init?.method ?? "GET";
    const call: Call = {
      method,
      path,
      query: Object.fromEntries(url.searchParams),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: new Headers(init?.headers).get("authorization"),
    };
    calls.push(call);
    const route = Object.entries(routes).find(([k]) => {
      const [m, p] = k.split(" ");
      return m === method && new RegExp(`^${p!.replace(/\{[^}]+\}/g, "[^/]+")}$`).test(path);
    });
    if (!route) return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
    const out = route[1](call);
    return out instanceof Response ? out : Response.json(out, { status: method === "POST" && path.endsWith("/annotations") ? 201 : 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** An MCP client connected in memory to the server over the mocked API. */
export async function connect(routes: Record<string, Route>) {
  const api = mockApi(routes);
  const server = createServer(createClient({ apiKey: "lk_live_test", baseUrl: "https://api.test/v1", fetch: api.fetch }), { now: () => NOW });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  /** Calls a tool; returns its summary line, its JSON and whether it errored. */
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };
    const text = res.content[0]!.text;
    return { summary: text.split("\n")[0]!, text, data: res.structuredContent, isError: res.isError === true };
  };
  return { client, tool, calls: api.calls };
}

// Fixtures, shaped as the API answers (src/generated/openapi.ts).
export const boards = { boards: [{ id: BOARD, name: "Clients", siteCount: 2, createdAt: "2026-10-01T00:00:00.000Z" }] };

const site = (id: string, domain: string, visitors: number, previousVisitors: number, change: number) => ({
  id, domain, visitors, previousVisitors, change, pageviews: visitors * 2, pagesPerVisit: 2,
  topSource: { name: "google.com", share: 40 }, topCountry: { name: "US", share: 50 }, goal: null, conversions: null,
});
export const boardSites = {
  board: { id: BOARD, name: "Clients" },
  range: "7d",
  sites: [site("prj_a", "acme.com", 1200, 1000, 20), site("prj_b", "lp.acme.com", 300, 600, -50)],
  unavailable: [],
};

export const series = (id: string, domain: string, values: number[]) => ({
  site: { id, domain },
  range: "7d",
  granularity: "day",
  points: values.map((v, i) => ({ start: new Date(Date.UTC(2026, 9, 15 + i)).toISOString(), visitors: v, previousVisitors: v })),
  visitors: values.reduce((a, b) => a + b, 0),
  previousVisitors: values.reduce((a, b) => a + b, 0),
  change: 0,
  pageviews: 10,
});
