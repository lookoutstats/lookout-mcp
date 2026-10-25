#!/usr/bin/env node
import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient, type LookoutApiError } from "./client.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

// The MCP server over Streamable HTTP (what https://mcp.lookoutstats.com runs): stateless, one JSON answer per POST, no
// session and no server-sent stream. The caller's Lookout API key comes in the Authorization header (or X-Lookout-Api-Key,
// for gateways that keep Authorization for themselves, like Smithery's) and is passed to the REST API as is; the server
// keeps nothing. The API's 401 and 429 (with Retry-After) come back as this response's status,
// when nothing in the request succeeded, so a client sees the same limits as the API (600 requests an hour per key). A
// key that isn't an API key's shape, a batch of more than 5 messages and a body over 1 MB are refused before any API call.

export interface HttpHandlerOptions {
  /** The Lookout REST API (default https://api.lookoutstats.com/v1). */
  baseUrl?: string;
  fetch?: typeof fetch;
}

const MCP_PATHS = new Set(["/", "/mcp"]);
/** An API key as Lookout makes them: "lk_live_" and 24 letters and digits. */
const API_KEY = /^lk_live_[A-Za-z0-9]{24}$/;
/** JSON-RPC batches (dropped from MCP in 2025-06-18) are capped, so one request can't fan out into many API calls. */
const MAX_BATCH = 5;
export const MAX_BODY_BYTES = 1_000_000;
const HEALTH_PATHS = new Set(["/health", "/healthz"]);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, X-Lookout-Api-Key, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id",
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

    const apiKey = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? (req.headers.get("x-lookout-api-key")?.trim() || undefined);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json(rpcError(null, -32600, "Request body over 1 MB"), 413);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(rpcError(null, -32700, "Parse error"), 400);
    }
    if (!apiKey) return json(rpcError(body, -32001, "Missing API key: send Authorization: Bearer lk_live_… or X-Lookout-Api-Key: lk_live_… (Lookout → Settings › API & MCP)"), 401, UNAUTHORIZED_HEADERS);
    if (!API_KEY.test(apiKey)) return json(rpcError(body, -32001, "That isn't a Lookout API key (lk_live_ and 24 letters and digits)"), 401, UNAUTHORIZED_HEADERS);
    if (Array.isArray(body) && (body.length === 0 || body.length > MAX_BATCH)) return json(rpcError(null, -32600, `A batch holds 1 to ${MAX_BATCH} messages`), 400);

    // The first 401 or 429 from the API, to pass on as this response's status.
    // Passed on only when no API call in this request succeeded: answers already paid for aren't thrown away.
    let refused: LookoutApiError | null = null;
    let succeeded = 0;
    const client = createClient({
      apiKey,
      baseUrl: opts.baseUrl,
      fetch: opts.fetch,
      userAgent: `lookout-mcp/${VERSION} (http)`,
      signal: req.signal,
      stopAfterRefusal: true,
      onSuccess: () => void succeeded++,
      onError: (err) => {
        if ((err.status === 401 || err.status === 429) && !refused) refused = err;
      },
    });
    const server = createServer(client);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      const res = await transport.handleRequest(req, { parsedBody: body });
      const failed = succeeded === 0 ? (refused as LookoutApiError | null) : null;
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
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY_BYTES) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "payload_too_large" }));
          req.destroy();
          return;
        }
        chunks.push(chunk as Buffer);
      }
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

// `npx lookout-mcp-http` / `node dist/http.js`: a standalone server on $HOST:$PORT (default 127.0.0.1:3000; set
// HOST=0.0.0.0 in a container).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  createNodeServer(toNodeListener(createHttpHandler({ baseUrl: process.env.LOOKOUT_API_URL }))).listen(port, host, () => {
    process.stderr.write(`lookout-mcp ${VERSION} listening on http://${host}:${port} (POST /, GET /health)\n`);
  });
}
