import type { paths } from "./generated/openapi.js";

/** The Lookout REST API this server is a thin client of. */
export const DEFAULT_BASE_URL = "https://api.lookoutstats.com/v1";

type JsonOf<R> = R extends { content: { "application/json": infer T } } ? T : never;
type Answer<P extends keyof paths, M extends "get" | "post", S extends number> = paths[P][M] extends { responses: infer Rs }
  ? S extends keyof Rs
    ? JsonOf<Rs[S]>
    : never
  : never;
type Body<P extends keyof paths> = paths[P]["post"] extends { requestBody?: { content: { "application/json": infer B } } } ? B : never;

export type BoardList = Answer<"/v1/boards", "get", 200>;
export type BoardSites = Answer<"/v1/boards/{id}/sites", "get", 200>;
export type BoardFlow = Answer<"/v1/boards/{id}/flow", "get", 200>;
export type BoardFixes = Answer<"/v1/boards/{id}/fixes", "get", 200>;
export type FixStatus = "open" | "snoozed" | "resolved";
export type BoardNotes = Answer<"/v1/boards/{id}/annotations", "get", 200>;
export type NoteCreated = Answer<"/v1/boards/{id}/annotations", "post", 201>;
export type NoteInput = Body<"/v1/boards/{id}/annotations">;
export type BoardExport = Answer<"/v1/boards/{id}/export", "post", 200>;
export type ExportInput = Body<"/v1/boards/{id}/export">;
export type SiteDetail = Answer<"/v1/sites/{id}", "get", 200>;
export type SiteOverview = Answer<"/v1/sites/{id}/overview", "get", 200>;
export type SiteSeries = Answer<"/v1/sites/{id}/series", "get", 200>;
export type SiteBreakdowns = Answer<"/v1/sites/{id}/breakdowns", "get", 200>;
export type SiteDeployments = Answer<"/v1/sites/{id}/deployments", "get", 200>;
export type SiteSpeed = Answer<"/v1/sites/{id}/speed", "get", 200>;
export type SiteCampaigns = Answer<"/v1/sites/{id}/campaigns", "get", 200>;
export type Alerts = Answer<"/v1/alerts", "get", 200>;
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
  /** Called after every successful answer. */
  onSuccess?: () => void;
  /** Gives up on a request after this long (default 25 s, inside Vercel's 30 s function limit). */
  timeoutMs?: number;
  /** Aborts every request when it fires, e.g. when the MCP caller disconnects. */
  signal?: AbortSignal;
  /**
   * After a 401 or 429, refuse every later request at once with the same error instead of calling the API again. For a
   * short-lived client (one HTTP request): a refused key shouldn't fan out into more refused calls.
   */
  stopAfterRefusal?: boolean;
}

/** One path segment: encoded, and never "." or "..", which URL resolution would turn into a different path. */
function enc(segment: string): string {
  if (segment === "" || segment === "." || segment === "..") throw new LookoutApiError(400, "validation_error", `Invalid id: "${segment}"`);
  return encodeURIComponent(segment);
}

export type LookoutClient = ReturnType<typeof createClient>;

/**
 * A typed client for the Lookout REST API: one method per endpoint, nothing cached, nothing stored. A board is named by
 * its id or its exact name: the API resolves names.
 */
export function createClient(opts: ClientOptions) {
  const base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 25_000;
  let refused: LookoutApiError | null = null;

  async function request<T>(method: "GET" | "POST", path: string, query?: Record<string, string | undefined>, body?: unknown): Promise<T> {
    if (refused) throw refused;
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
    const headers: Record<string, string> = { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" };
    if (opts.userAgent) headers["User-Agent"] = opts.userAgent;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
    let res: Response;
    try {
      res = await doFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
    } catch (err) {
      if (timeout.aborted) throw new LookoutApiError(504, "timeout", `Lookout didn't answer within ${Math.round(timeoutMs / 1000)}s`);
      throw err;
    }
    if (res.ok) {
      const data = (await res.json()) as T;
      opts.onSuccess?.();
      return data;
    }
    const err = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    const retry = Number(res.headers.get("retry-after"));
    const failure = new LookoutApiError(
      res.status,
      err?.error?.code ?? `http_${res.status}`,
      err?.error?.message ?? (res.statusText || `HTTP ${res.status}`),
      res.status === 429 && Number.isFinite(retry) && retry > 0 ? retry : null,
    );
    if (opts.stopAfterRefusal && (failure.status === 401 || failure.status === 429)) refused = failure;
    opts.onError?.(failure);
    throw failure;
  }

  return {
    listBoards: () => request<BoardList>("GET", "/boards"),
    boardSites: (board: string, range: string) => request<BoardSites>("GET", `/boards/${enc(board)}/sites`, { range }),
    boardFlow: (board: string, range: string) => request<BoardFlow>("GET", `/boards/${enc(board)}/flow`, { range }),
    boardFixes: (board: string, range: string, status?: FixStatus) => request<BoardFixes>("GET", `/boards/${enc(board)}/fixes`, { range, status }),
    boardNotes: (board: string, site?: string, range?: string) => request<BoardNotes>("GET", `/boards/${enc(board)}/annotations`, { site, range }),
    addNote: (board: string, note: NoteInput) => request<NoteCreated>("POST", `/boards/${enc(board)}/annotations`, undefined, note),
    exportBoard: (board: string, input: ExportInput) => request<BoardExport>("POST", `/boards/${enc(board)}/export`, undefined, input),
    site: (site: string, range: string) => request<SiteDetail>("GET", `/sites/${enc(site)}`, { range }),
    /** One site in depth in one request (series, breakdowns, deployments, speed and, with a board, its notes). */
    siteOverview: (site: string, range: string, board?: string) => request<SiteOverview>("GET", `/sites/${enc(site)}/overview`, { range, board }),
    siteSeries: (site: string, range: string) => request<SiteSeries>("GET", `/sites/${enc(site)}/series`, { range }),
    siteBreakdowns: (site: string, range: string) => request<SiteBreakdowns>("GET", `/sites/${enc(site)}/breakdowns`, { range }),
    siteDeployments: (site: string, range: string) => request<SiteDeployments>("GET", `/sites/${enc(site)}/deployments`, { range }),
    siteSpeed: (site: string, range: string, device: Device) => request<SiteSpeed>("GET", `/sites/${enc(site)}/speed`, { range, device }),
    siteCampaigns: (site: string, range: string) => request<SiteCampaigns>("GET", `/sites/${enc(site)}/campaigns`, { range }),
    alerts: () => request<Alerts>("GET", "/alerts"),
  };
}
