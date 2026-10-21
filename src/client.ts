import type { paths } from "./generated/openapi.js";

/** The Lookout REST API this server is a thin client of. */
export const DEFAULT_BASE_URL = "https://api.lookoutstats.com/v1";

type JsonOf<R> = R extends { content: { "application/json": infer T } } ? T : never;
type Response<P extends keyof paths, M extends "get" | "post", S extends number> = paths[P][M] extends { responses: infer Rs }
  ? S extends keyof Rs
    ? JsonOf<Rs[S]>
    : never
  : never;
type Body<P extends keyof paths> = paths[P]["post"] extends { requestBody?: { content: { "application/json": infer B } } } ? B : never;

export type BoardList = Response<"/v1/boards", "get", 200>;
export type BoardSites = Response<"/v1/boards/{id}/sites", "get", 200>;
export type BoardFlow = Response<"/v1/boards/{id}/flow", "get", 200>;
export type BoardNotes = Response<"/v1/boards/{id}/annotations", "get", 200>;
export type NoteCreated = Response<"/v1/boards/{id}/annotations", "post", 201>;
export type NoteInput = Body<"/v1/boards/{id}/annotations">;
export type BoardExport = Response<"/v1/boards/{id}/export", "post", 200>;
export type ExportInput = Body<"/v1/boards/{id}/export">;
export type SiteDetail = Response<"/v1/sites/{id}", "get", 200>;
export type SiteSeries = Response<"/v1/sites/{id}/series", "get", 200>;
export type SiteBreakdowns = Response<"/v1/sites/{id}/breakdowns", "get", 200>;
export type SiteDeployments = Response<"/v1/sites/{id}/deployments", "get", 200>;
export type SiteSpeed = Response<"/v1/sites/{id}/speed", "get", 200>;
export type SiteCampaigns = Response<"/v1/sites/{id}/campaigns", "get", 200>;
export type Alerts = Response<"/v1/alerts", "get", 200>;
export type Device = "all" | "mobile" | "desktop";

/** An error answer from the API: its HTTP status, error code and message, and for a 429 when to retry. */
export class LookoutApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = "LookoutApiError";
  }
}

export interface ClientOptions {
  /** An API key from Lookout's Settings › API & MCP (lk_live_…). */
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Sent as the User-Agent, so the workspace's security log says what called. */
  userAgent?: string;
  /** Called with every error answer before it's thrown: the HTTP entry passes 401s and 429s through. */
  onError?: (err: LookoutApiError) => void;
}

const enc = encodeURIComponent;

export type LookoutClient = ReturnType<typeof createClient>;

/** A typed client for the Lookout REST API: one method per endpoint, nothing cached, nothing stored. */
export function createClient(opts: ClientOptions) {
  const base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;

  async function request<T>(method: "GET" | "POST", path: string, query?: Record<string, string | undefined>, body?: unknown): Promise<T> {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
    const headers: Record<string, string> = { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" };
    if (opts.userAgent) headers["User-Agent"] = opts.userAgent;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await doFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.ok) return (await res.json()) as T;
    const err = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    const retry = Number(res.headers.get("retry-after"));
    const failure = new LookoutApiError(
      res.status,
      err?.error?.code ?? `http_${res.status}`,
      err?.error?.message ?? (res.statusText || `HTTP ${res.status}`),
      res.status === 429 && Number.isFinite(retry) && retry > 0 ? retry : null,
    );
    opts.onError?.(failure);
    throw failure;
  }

  return {
    listBoards: () => request<BoardList>("GET", "/boards"),
    boardSites: (board: string, range: string) => request<BoardSites>("GET", `/boards/${enc(board)}/sites`, { range }),
    boardFlow: (board: string, range: string) => request<BoardFlow>("GET", `/boards/${enc(board)}/flow`, { range }),
    boardNotes: (board: string, site?: string) => request<BoardNotes>("GET", `/boards/${enc(board)}/annotations`, { site }),
    addNote: (board: string, note: NoteInput) => request<NoteCreated>("POST", `/boards/${enc(board)}/annotations`, undefined, note),
    exportBoard: (board: string, input: ExportInput) => request<BoardExport>("POST", `/boards/${enc(board)}/export`, undefined, input),
    site: (site: string, range: string) => request<SiteDetail>("GET", `/sites/${enc(site)}`, { range }),
    siteSeries: (site: string, range: string) => request<SiteSeries>("GET", `/sites/${enc(site)}/series`, { range }),
    siteBreakdowns: (site: string, range: string) => request<SiteBreakdowns>("GET", `/sites/${enc(site)}/breakdowns`, { range }),
    siteDeployments: (site: string, range: string) => request<SiteDeployments>("GET", `/sites/${enc(site)}/deployments`, { range }),
    siteSpeed: (site: string, range: string, device: Device) => request<SiteSpeed>("GET", `/sites/${enc(site)}/speed`, { range, device }),
    siteCampaigns: (site: string, range: string) => request<SiteCampaigns>("GET", `/sites/${enc(site)}/campaigns`, { range }),
    alerts: () => request<Alerts>("GET", "/alerts"),
  };
}
