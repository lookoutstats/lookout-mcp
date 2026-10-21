#!/usr/bin/env node
import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient, type LookoutApiError } from "./client.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

// The MCP server over Streamable HTTP (what https://mcp.lookoutstats.com runs): stateless, one JSON answer per POST, no
// session and no server-sent stream. The caller's Lookout API key comes in the Authorization header and is passed to the
// REST API as is; the server keeps nothing. The API's 401 and 429 (with Retry-After) come back as this response's status,
// so a client sees the same limits as the API (600 requests an hour per key).

export interface HttpHandlerOptions {
  /** The Lookout REST API (default https://api.lookoutstats.com/v1). */
  baseUrl?: string;
  fetch?: typeof fetch;
}

const MCP_PATHS = new Set(["/", "/mcp"]);
const HEALTH_PATHS = new Set(["/health", "/healthz"]);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "Retry-After, WWW-Authenticate",
};

type Rpc = { id?: string | number | null };
const rpcError = (body: unknown, code: number, message: string) => {
  const one = (m: unknown) => ({ jsonrpc: "2.0", id: (m as Rpc | null)?.id ?? null, error: { code, message } });
  return Array.isArray(body) ? body.map(one) : one(body);
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...headers } });
}

const UNAUTHORIZED_HEADERS = { "WWW-Authenticate": 'Bearer realm="Lookout", error="invalid_token"' };

/** A fetch-style handler: `(request) => response`, for Vercel functions, Node, Bun, Deno or any Web-standard server. */
export function createHttpHandler(opts: HttpHandlerOptions = {}): (req: Request) => Promise<Response> {
  return async function handle(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (HEALTH_PATHS.has(path)) return json({ ok: true, name: "lookout-mcp", version: VERSION });
    if (!MCP_PATHS.has(path)) return json({ error: "not_found", hint: "POST MCP JSON-RPC messages to /" }, 404);
    if (req.method !== "POST") return json(rpcError(null, -32000, "Method not allowed: POST JSON-RPC messages to this endpoint (stateless, no SSE stream)"), 405, { Allow: "POST, OPTIONS" });

    const apiKey = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(rpcError(null, -32700, "Parse error"), 400);
    }
    if (!apiKey) return json(rpcError(body, -32001, "Missing API key: send Authorization: Bearer lk_live_… (Lookout → Settings › API & MCP)"), 401, UNAUTHORIZED_HEADERS);

    // The first 401 or 429 from the API, to pass on as this response's status.
    let refused: LookoutApiError | null = null;
    const client = createClient({
      apiKey,
      baseUrl: opts.baseUrl,
      fetch: opts.fetch,
      userAgent: `lookout-mcp/${VERSION} (http)`,
      onError: (err) => {
        if ((err.status === 401 || err.status === 429) && !refused) refused = err;
      },
    });
    const server = createServer(client);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      const res = await transport.handleRequest(req, { parsedBody: body });
      const failed = refused as LookoutApiError | null;
      if (failed?.status === 429) {
        return json(rpcError(body, -32000, "Rate limited: 600 requests an hour per key"), 429, failed.retryAfterSec ? { "Retry-After": String(failed.retryAfterSec) } : {});
      }
      if (failed?.status === 401) return json(rpcError(body, -32001, "The Lookout API key was refused (invalid or revoked)"), 401, UNAUTHORIZED_HEADERS);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    } finally {
      await server.close().catch(() => {});
    }
  };
}

/** Bridges node:http to the fetch-style handler. */
export function toNodeListener(handle: (req: Request) => Promise<Response>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
      const body = chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined;
      const out = await handle(new Request(url, { method: req.method, headers, body }));
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
    } catch (err) {
      process.stderr.write(`lookout-mcp: ${err instanceof Error ? err.stack : String(err)}\n`);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal" }));
    }
  };
}

// `npx lookout-mcp-http` / `node dist/http.js`: a standalone server on $PORT (default 3000).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  createNodeServer(toNodeListener(createHttpHandler({ baseUrl: process.env.LOOKOUT_API_URL }))).listen(port, () => {
    process.stderr.write(`lookout-mcp ${VERSION} listening on http://localhost:${port} (POST /, GET /health)\n`);
  });
}
