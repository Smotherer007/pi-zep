/**
 * Parsers for ZEP's HTML and AJAX-JSON responses.
 *
 * ZEP is a classic server-rendered PHP app: everything the client needs
 * arrives either as HTML fragments or as a small JSON envelope that carries
 * `{type:"schnipsel", target, data:"<html>"}` entries plus a fresh
 * `requesttoken`. There is no DOM in Node, so these are deliberately
 * tolerant regex parsers rather than a full HTML parser.
 */

import type { ZepBooking, ZepOption, ZepWeek, ZepWeekDay } from "../types.ts";

/** Decode the handful of entities ZEP actually uses in labels. */
export function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&auml;/g, "ä")
    .replace(/&ouml;/g, "ö")
    .replace(/&uuml;/g, "ü")
    .replace(/&Auml;/g, "Ä")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&szlig;/g, "ß")
    .replace(/&euro;/g, "€")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();
}

/** The per-page CSRF-ish token. ZEP rotates it with every response. */
export function extractRequestToken(html: string): string | null {
  const m = /var\s+requesttoken\s*=\s*'([^']+)'/.exec(html);
  return m?.[1] ?? null;
}

/** `CLIENTSESSID` is the URL-carried half of the ZEP session. */
export function extractClientSessionId(text: string): string | null {
  const m = /CLIENTSESSID=([A-Za-z0-9]+)/.exec(text);
  return m?.[1] ?? null;
}

/**
 * ZEP's generic server-side error envelope. `msg=555001`, `555003` and
 * `555009` all mean "your session/token is not valid any more" and the
 * server logs the session out as a side effect.
 */
export function detectSessionLoss(body: string): string | null {
  // ZEP emits non-ASCII as \uXXXX in its JSON, so match on the ASCII prefix
  // rather than on "ungültig" itself.
  const noToken = /Session ist ung/i.test(body);
  const logoutForward = /forwardTo\('login\.php[^']*action=logout/i.test(body);
  if (noToken || logoutForward) {
    const msg = /msg=(\d+)/.exec(body)?.[1];
    return msg ? `session invalid (msg=${msg})` : "session invalid";
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read the `<option>` list of a `<select id="...">`.
 *
 * Works for both the full page and the `formrefresh` HTML fragment.
 */
export function parseSelect(html: string, selectId: string): ZepOption[] {
  const open = new RegExp(
    `<select[^>]*\\bid\\s*=\\s*["']${escapeRegExp(selectId)}["'][^>]*>`,
    "i",
  ).exec(html);
  if (!open) return [];

  const rest = html.slice(open.index + open[0].length);
  const closeIdx = rest.toLowerCase().indexOf("</select>");
  const body = closeIdx === -1 ? rest : rest.slice(0, closeIdx);

  const options: ZepOption[] = [];
  const optionRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  let m: RegExpExecArray | null;
  while ((m = optionRe.exec(body)) !== null) {
    const attrs = m[1] ?? "";
    const rawLabel = m[2] ?? "";
    const valueMatch = /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const value = valueMatch?.[1] ?? valueMatch?.[2] ?? valueMatch?.[3] ?? "";
    options.push({
      id: decodeEntities(value),
      label: stripTags(rawLabel),
      selected: /\bselected\b/i.test(attrs),
      disabled: /\bdisabled\b/i.test(attrs),
    });
  }
  return options;
}

/** Currently selected value of a `<select id="...">`. */
export function selectedValue(options: ReadonlyArray<ZepOption>): string | null {
  return options.find((o) => o.selected)?.id ?? null;
}

/**
 * The AJAX JSON envelope. Every string value that looks like markup is a
 * DOM snippet destined for a target element.
 */
export interface ZepAjaxSnippet {
  readonly target: string | null;
  readonly data: string;
}

export interface ZepAjaxEnvelope {
  readonly requesttoken: string | null;
  readonly error: string | null;
  readonly javascript: string | null;
  readonly snippets: ReadonlyArray<ZepAjaxSnippet>;
  readonly raw: unknown;
}

export function parseAjaxEnvelope(body: string): ZepAjaxEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`ZEP returned a non-JSON response: ${body.slice(0, 300)}`);
  }

  const root = parsed as Record<string, unknown>;
  const snippets: ZepAjaxSnippet[] = [];
  for (const value of Object.values(root)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.data !== "string") continue;
    if (!entry.data.includes("<")) continue;
    snippets.push({
      target: typeof entry.target === "string" ? entry.target : null,
      data: entry.data,
    });
  }

  return {
    requesttoken: typeof root.requesttoken === "string" ? root.requesttoken : null,
    error: typeof root.error === "string" ? root.error : null,
    javascript: typeof root.javascript === "string" ? root.javascript : null,
    snippets,
    raw: parsed,
  };
}

/**
 * Pull the human readable message out of the `zepalert(...)` calls ZEP
 * embeds in its JSON responses.
 */
export function extractAlertMessage(javascript: string | null): string | null {
  if (!javascript) return null;
  const m = /zepalert\(\s*(['"])([\s\S]*?)\1/.exec(javascript);
  if (!m) return null;
  const text = decodeEntities(
    (m[2] ?? "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\\\//g, "/")
      .replace(/\\'/g, "'")
      .replace(/\s+/g, " "),
  ).trim();
  return text || null;
}

// ------------------------------------------------------------- week overview

export interface ZepAlert {
  /** bootstrap alert kind: success, danger, warning or info */
  readonly kind: string;
  readonly message: string;
}

/**
 * Read the message ZEP renders into a form message slot.
 *
 * This is where real rejections arrive. A failed booking answers with
 * `error: "error"` and NO `javascript` at all - the German text (plan hours
 * exceeded, Tätigkeit not allowed for the Vorgang, …) lives inside a
 * `schnipsel` whose data is
 *   `<div class="card-alert alert alert-danger">…<div class="alert-message">…</div>`
 * so a client that only looks at `javascript` reports a useless
 * "unspecified error".
 */
export function extractSnippetAlert(
  snippets: ReadonlyArray<ZepAjaxSnippet>,
): ZepAlert | null {
  for (const snippet of snippets) {
    const idx = snippet.data.search(/alert-message/i);
    if (idx === -1) continue;

    const prefix = snippet.data.slice(0, idx);
    const kind = /alert-(success|danger|warning|info)/i.exec(prefix)?.[1]?.toLowerCase() ?? "info";

    const body = snippet.data.slice(idx);
    const close = body.search(/<\/div>/i);
    const raw = close === -1 ? body : body.slice(0, close);
    const message = decodeEntities(
      raw
        .replace(/^[^>]*>/, "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " "),
    ).trim();

    if (message) return { kind, message };
  }
  return null;
}

/**
 * Pick the week-table snippet out of an ajax envelope.
 *
 * The setKw response carries no `target` at all, so the table has to be
 * recognised by its content. The save response, by contrast, ships a
 * calendar snippet targeting `managerdiv_ProjektzeitMgr` - which must not be
 * mistaken for the week table.
 */
export function pickWeekTableSnippet(
  snippets: ReadonlyArray<ZepAjaxSnippet>,
): ZepAjaxSnippet | null {
  const isWeekTable = (data: string) =>
    /pz_kwnav/.test(data) || /id="objectId\d+"/.test(data) || /class="tag_\d/.test(data);

  return (
    snippets.find((s) => /ProjektzeitTable/i.test(s.target ?? "") && isWeekTable(s.data)) ??
    snippets.find((s) => isWeekTable(s.data)) ??
    [...snippets].sort((a, b) => b.data.length - a.data.length)[0] ??
    null
  );
}

interface RawRow {
  readonly html: string;
  readonly classes: string;
}

function splitRows(tableHtml: string): RawRow[] {
  const rows: RawRow[] = [];
  const rowRe = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(tableHtml)) !== null) {
    rows.push({ classes: m[1] ?? "", html: m[2] ?? "" });
  }
  return rows;
}

function splitCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowHtml)) !== null) cells.push(m[1] ?? "");
  return cells;
}

const DAY_RE = /^\s*(Mo|Di|Mi|Do|Fr|Sa|So)\s+(\d{2}\.\d{2}\.)/;

const WEEKDAY_INDEX: Record<string, number> = { Mo: 0, Di: 1, Mi: 2, Do: 3, Fr: 4, Sa: 5, So: 6 };

/**
 * Work out the ISO date of a day row from its `Do 17.09.` label when the
 * markup does not spell the date out (ZEP embeds it in the meals-icon
 * onclick, which can change between versions).
 */
function resolveDayDate(dayLabel: string, kwDate: string): string | null {
  const m = DAY_RE.exec(dayLabel);
  if (!m) return null;
  const offset = WEEKDAY_INDEX[m[1]!];
  if (offset === undefined) return null;

  const [dd, mm] = (m[2] ?? "").replace(/\.$/, "").split(".");
  if (!dd || !mm) return null;

  const monday = new Date(`${kwDate}T00:00:00Z`);
  if (Number.isNaN(monday.getTime())) return null;
  monday.setUTCDate(monday.getUTCDate() + offset);

  // Handle a week that straddles the turn of the year.
  if (monday.getUTCMonth() + 1 !== Number(mm)) {
    monday.setUTCFullYear(monday.getUTCFullYear() + (Number(mm) === 1 ? 1 : -1));
  }
  return monday.toISOString().slice(0, 10);
}

/**
 * Parse the week table rendered into `#ProjektzeitTableDiv`.
 *
 * Row shapes observed on the live system:
 *   day row      `["Do 17.09. restaurant", ...]`   (icons = meals/breaks)
 *   booking row  `["editdelete", von, bis, Dauer, "", Projekt, Vorgang, Taet, "payments", Bemerkung]`
 *   sum row      `["Summe", "8,00", "payments 8,00"]`
 */
export function parseWeek(tableHtml: string, kwDate: string): ZepWeek {
  const days: ZepWeekDay[] = [];
  let current: {
    label: string;
    date: string | null;
    bookings: ZepBooking[];
    classes: string;
  } | null = null;
  let currentTotal: string | null = null;
  let currentBillable: string | null = null;

  const flush = (): void => {
    if (!current) return;
    days.push({
      dayLabel: current.label,
      date: current.date,
      bookings: current.bookings,
      total: currentTotal,
      billableTotal: currentBillable,
      empty: current.bookings.length === 0 && !currentTotal,
      underBooked: /pzminuszeit/.test(current.classes),
      future: /zukunft/.test(current.classes),
      today: /\btoday\b/.test(current.classes),
    });
    current = null;
    currentTotal = null;
    currentBillable = null;
  };

  for (const row of splitRows(tableHtml)) {
    const cells = splitCells(row.html);
    const flat = cells.map((c) => stripTags(c));

    // --- day header -------------------------------------------------------
    const joined = flat.join(" ").trim();
    const dayMatch = DAY_RE.exec(joined);
    if (dayMatch && cells.length <= 3) {
      flush();
      const iso =
        /id="day_(\d{4}-\d{2}-\d{2})"/.exec(row.html) ??
        /openMahlzeiten\s*\(\s*this\s*,\s*'(\d{4}-\d{2}-\d{2})'/.exec(row.html);
      const label = joined.split(/\s{2,}/)[0] ?? joined;
      current = {
        label,
        date: iso?.[1] ?? resolveDayDate(label, kwDate),
        bookings: [],
        classes: row.classes,
      };
      continue;
    }

    if (!current) continue;

    // --- sum row ----------------------------------------------------------
    if (/^Summe\b/i.test(joined)) {
      const numbers = flat.filter((c) => /^\d+[.,]\d+$/.test(c));
      currentTotal = numbers[0] ?? null;
      const pay = flat.find((c) => /payments/i.test(c));
      currentBillable = pay ? (pay.match(/(\d+[.,]\d+)/)?.[1] ?? null) : null;
      continue;
    }

    // --- booking row ------------------------------------------------------
    const from = /^\d{2}:\d{2}$/.test(flat[1] ?? "");
    if (!from) continue;

    const objectId = /objectId=(\d+)/.exec(row.html)?.[1] ?? null;
    current.bookings.push({
      objectId,
      dayLabel: current.label,
      date: current.date,
      from: flat[1] ?? "",
      to: flat[2] ?? "",
      duration: flat[3] ?? "",
      project: flat[5] ?? "",
      vorgang: flat[6] ?? "",
      taetigkeit: flat[7] ?? "",
      billable: /payments/i.test(flat[8] ?? "") || /payments/i.test(row.html),
      comment: flat[9] ?? "",
    });
  }

  flush();
  return { kwDate, days };
}

/** Monday of the ISO week containing `date`. */
export function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** `HH:MM` -> minutes since midnight. Returns null when unparseable. */
export function timeToMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Duration between two `HH:MM` values as `HH:MM`, or null when invalid. */
export function durationBetween(from: string, to: string): string | null {
  const a = timeToMinutes(from);
  const b = timeToMinutes(to);
  if (a === null || b === null) return null;
  const diff = b - a;
  if (diff <= 0) return null;
  const h = Math.floor(diff / 60);
  const min = diff % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
