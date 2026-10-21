/** Small number formatting for the one-line summaries. */

export const int = (n: number) => Math.round(n).toLocaleString("en-US");

/** "+12.3%", "-4%", or "" when there's nothing to compare with. */
export const change = (pct: number | null | undefined) => {
  if (pct == null) return "";
  const r = (Math.sign(pct) * Math.round(Math.abs(pct) * 10)) / 10; // halves away from zero: -6.25 → -6.3
  return `${r > 0 ? "+" : ""}${r === 0 ? 0 : r}%`;
};

/** "4,321 visitors (+12.3%)". */
export const visitors = (n: number, pct?: number | null) => `${int(n)} visitor${n === 1 ? "" : "s"}${pct == null ? "" : ` (${change(pct)})`}`;

export const plural = (n: number, word: string, many = `${word}s`) => `${int(n)} ${n === 1 ? word : many}`;

/** "1.8s", "120ms", "0.04". */
export const ms = (v: number | null) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);
export const cls = (v: number | null) => (v == null ? "—" : v.toFixed(2));
