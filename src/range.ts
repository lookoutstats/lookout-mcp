import { z } from "zod";

/** The preset ranges Lookout keeps figures for. */
export const PRESETS = ["24h", "7d", "30d"] as const;
export type Preset = (typeof PRESETS)[number];

const day = z.iso.date().describe("A UTC day, YYYY-MM-DD");

/**
 * A tool's `range`: a preset (24h, 7d, 30d) or a custom window of whole UTC days, `{ from, to }`, 1 to 30 days long and
 * ending today at the latest. The API takes the custom form as `YYYY-MM-DD..YYYY-MM-DD`.
 */
export const RangeSchema = z
  .union([z.enum(PRESETS), z.object({ from: day, to: day }).describe("A custom window of whole UTC days, 1 to 30 days, ending today at the latest")])
  .default("7d")
  .describe('24h, 7d or 30d, or a custom window { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" } (UTC days, up to 30). Default 7d.');
export type Range = z.infer<typeof RangeSchema>;

const DAY_MS = 86_400_000;

/** The API's range key for a tool's range; a custom window outside the API's limits throws a RangeError with the reason. */
export function toRangeKey(range: Range, now: Date = new Date()): string {
  if (typeof range === "string") return range;
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (from > to) throw new RangeError(`range.from (${range.from}) is after range.to (${range.to})`);
  if (to > today) throw new RangeError(`range.to (${range.to}) is in the future`);
  const days = (to - from) / DAY_MS + 1;
  if (days > 30) throw new RangeError(`A custom range is at most 30 days; ${range.from}..${range.to} is ${days}`);
  return `${range.from}..${range.to}`;
}

/** "last 7 days", or "Oct 1 – Oct 14" for a custom window: for the one-line summaries. */
export function rangeLabel(key: string): string {
  if (key === "24h") return "last 24 hours";
  if (key === "7d") return "last 7 days";
  if (key === "30d") return "last 30 days";
  const [from, to] = key.split("..");
  const fmt = (d: string | undefined) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "?");
  return `${fmt(from)} – ${fmt(to)}`;
}
