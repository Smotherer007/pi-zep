/**
 * Small helpers shared by the ZEP tools.
 */

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

export function textResult(text: string, details: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: "text", text }], details };
}

export function errorResult(text: string, details: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: "text", text: `Error: ${text}` }], details: { ...details, error: true } };
}

/** Normalise ISO-ish date input; falls back to today. */
export function toIsoDate(value: string | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const trimmed = value.trim();
  const direct = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (direct) return trimmed;
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (german) {
    const [, d, m, y] = german;
    return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  throw new Error(`Unparseable date: "${value}" (use YYYY-MM-DD)`);
}

/** Accept `8:00`, `08:00`, `0800`; return `HH:MM`. */
export function toHhMm(value: string): string {
  const trimmed = value.trim();
  const colon = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (colon) return `${colon[1]!.padStart(2, "0")}:${colon[2]}`;
  const compact = /^(\d{2})(\d{2})$/.exec(trimmed);
  if (compact) return `${compact[1]}:${compact[2]}`;
  const hourOnly = /^(\d{1,2})$/.exec(trimmed);
  if (hourOnly) return `${hourOnly[1]!.padStart(2, "0")}:00`;
  throw new Error(`Unparseable time: "${value}" (use HH:MM)`);
}
