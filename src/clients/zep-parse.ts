/**
 * Parsers for ZEP's HTML and AJAX-JSON responses.
 *
 * ZEP is a classic server-rendered PHP app: everything the client needs
 * arrives either as HTML fragments or as a small JSON envelope that carries
 * `{type:"schnipsel", target, data:"<html>"}` entries plus a fresh
 * `requesttoken`. There is no DOM in Node, so these are deliberately
 * tolerant regex parsers rather than a full HTML parser.
 */

import type { ZepBooking, ZepOption, ZepPlan, ZepPlanDay, ZepPlanSlice, ZepWeek, ZepWeekDay } from "../types.ts";

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
 * Label of a day row: `Do 17.09.`.
 *
 * The label cell also carries the meals/breaks icons, whose text content is
 * literally `restaurant` / `local_cafe`; taking the plain text of the cell
 * would render as `Do 17.09. restaurant`. Prefer the dedicated weekday and
 * day/month divs and only fall back to text surgery.
 */
function dayRowLabel(cellHtml: string, joined: string): string {
  const weekday = /class="modimidofrsaso"[^>]*>\s*([A-Za-z]{2})\s*</.exec(cellHtml)?.[1];
  const dayMonth = /class="tag_monat"[^>]*>\s*([0-9]{2}\.[0-9]{2}\.)\s*</.exec(cellHtml)?.[1];
  if (weekday && dayMonth) return `${weekday} ${dayMonth}`;

  return joined
    .split(/\s{2,}/)[0]!
    .replace(/\s*(restaurant|local_cafe)\b.*$/i, "")
    .trim();
}

/**
 * Place of work of a booking row, or null when ZEP does not render it.
 *
 * The Ort cell is the row's last column (`von` + 9) and, unlike the other
 * metadata columns, it carries no `data-columnid` of its own. ZEP only emits
 * it when there is something to report, so an absent cell means the booking
 * sits on the default place of work (`NULL`). A trailing `*` marks a
 * deviation from that default and is not part of the value.
 */
function bookingOrt(flat: ReadonlyArray<string>, from: number): string | null {
  return (flat[from + 9] ?? "").replace(/[\s*]+$/, "").trim() || null;
}

/**
 * Parse the week table rendered into `#ProjektzeitTableDiv`.
 *
 * Row shapes observed on the live system (2026-09-17, ZEP v7.13.88):
 *
 *   day, no bookings   `["Do 17.09. restaurant", ""]`
 *   day, with bookings `["Do 17.09. restaurant", "", "editdelete", von, bis, Dauer, "", Projekt, Vorgang, Taet, fakturierbar, Bemerkung, Ort]`
 *   further bookings   `["editdelete", von, bis, Dauer, "", Projekt, Vorgang, Taet, "payments", Bemerkung, Ort]`
 *   sum row            `["Summe", "4,00", ...]`
 *
 * The day's FIRST booking is rendered inside the day row itself (the label
 * cell then has `rowspan=N`), which is why the booking columns must be read
 * relative to the first `HH:MM` cell rather than at a fixed offset.
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
    // A day row is identified by its `id="day_YYYY-MM-DD"` cell; the label
    // text is only used as a fallback so that a markup change in the label
    // cannot silently re-attach a day's bookings to the previous day.
    const dayId =
      /id="day_(\d{4}-\d{2}-\d{2})"/.exec(row.html) ??
      /openMahlzeiten\s*\(\s*this\s*,\s*'(\d{4}-\d{2}-\d{2})'/.exec(row.html);
    if (dayId || (dayMatch && cells.length <= 3)) {
      flush();
      const label = dayRowLabel(cells[0] ?? "", joined) || joined;
      current = {
        label,
        date: dayId?.[1] ?? resolveDayDate(label, kwDate),
        bookings: [],
        classes: row.classes,
      };
      // deliberately no `continue`: this row may carry the day's first booking
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
    // Anchor on the `von` cell: cell 1 in a standalone booking row, cell 3
    // behind the label in a day row that carries its first booking.
    const from = flat.findIndex((c, index) => index > 0 && /^\d{2}:\d{2}$/.test(c));
    if (from === -1) continue;

    const objectId =
      /objectId=?(\d+)/.exec(row.html)?.[1] ?? null;
    current.bookings.push({
      objectId,
      dayLabel: current.label,
      date: current.date,
      from: flat[from] ?? "",
      to: flat[from + 1] ?? "",
      duration: flat[from + 2] ?? "",
      project: flat[from + 4] ?? "",
      vorgang: flat[from + 5] ?? "",
      taetigkeit: flat[from + 6] ?? "",
      billable: /payments/i.test(flat[from + 7] ?? "") || /payments/i.test(row.html),
      comment: flat[from + 8] ?? "",
      ort: bookingOrt(flat, from),
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

// --------------------------------------------- capacity planning ("Einplanung")

export interface ZepChartSeries {
  readonly name: string;
  readonly type?: string;
  readonly data: ReadonlyArray<number>;
}

/** The slice of ZEP's ApexCharts options object that carries the plan data. */
export interface ZepChartOptions {
  readonly series: ReadonlyArray<ZepChartSeries>;
  readonly categories: ReadonlyArray<string>;
  readonly title: string | null;
  readonly subtitle: string | null;
}

interface RawChartOptions {
  series?: unknown;
  xaxis?: { categories?: unknown };
  title?: { text?: unknown };
  subtitle?: { text?: unknown };
}

/** Trailing `[16,00 h]` ZEP appends to every series name. */
const SERIES_HOURS_RE = /\s*\[([\d.,]+)\s*h\]\s*$/;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Slice a balanced `{...}` or `[...]` block starting at `start`.
 *
 * String-aware on purpose: series names are project labels like
 * `K-10000-00001 (Contoso) [16,00 h]`, so brackets inside string literals
 * must not be counted as nesting.
 */
function sliceBalanced(text: string, start: number): string | null {
  const open = text[start];
  if (open !== "{" && open !== "[") return null;
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Turn ZEP's options object into parseable JSON.
 *
 * It is JavaScript, not JSON: the axis label and tooltip formatters are real
 * function expressions (`"formatter":function(val, index) { ... }`). Their
 * values carry no plan data, so each one is replaced by `null`.
 */
function stripJsFunctions(text: string): string {
  let result = "";
  let index = 0;

  while (index < text.length) {
    const found = text.indexOf("function", index);
    if (found === -1) {
      result += text.slice(index);
      break;
    }

    // Only treat it as code in value position; a project label could contain
    // the word "function" as text.
    const before = text.slice(0, found).replace(/\s+$/, "").slice(-1);
    if (before !== ":" && before !== "," && before !== "[" && before !== "(") {
      result += text.slice(index, found + "function".length);
      index = found + "function".length;
      continue;
    }

    const bodyStart = text.indexOf("{", found + "function".length);
    const body = bodyStart === -1 ? null : sliceBalanced(text, bodyStart);
    // keep everything before the keyword - it is part of the object
    result += text.slice(index, found) + "null";
    if (!body) break;
    index = bodyStart + body.length;
  }
  return result;
}

/**
 * Replace bare JavaScript identifiers that are not JSON keywords with `null`.
 *
 * ZEP's object is JavaScript, not JSON: axis locales arrive as a reference to
 * the page's global (`"locales":[apex_lang_de]`), which JSON.parse rejects.
 */
function neutraliseJsValues(jsonish: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let index = 0;

  while (index < jsonish.length) {
    const char = jsonish[index]!;
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      index += 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      let end = index;
      while (end < jsonish.length && /[A-Za-z0-9_$.]/.test(jsonish[end]!)) end += 1;
      const token = jsonish.slice(index, end);
      result += token === "true" || token === "false" || token === "null" ? token : "null";
      index = end;
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}

/** Read the ApexCharts options object ZEP embeds next to a chart container. */
export function extractChartOptions(html: string): ZepChartOptions | null {
  const marker = /var\s+options\w*\s*=\s*/.exec(html);
  if (!marker) return null;

  const start = html.indexOf("{", marker.index + marker[0].length);
  if (start === -1) return null;

  const raw = sliceBalanced(html, start);
  if (!raw) return null;

  let parsed: RawChartOptions;
  try {
    parsed = JSON.parse(neutraliseJsValues(stripJsFunctions(raw))) as RawChartOptions;
  } catch {
    return null;
  }

  const rawSeries = Array.isArray(parsed.series) ? parsed.series : [];
  const series: ZepChartSeries[] = [];
  for (const entry of rawSeries) {
    if (!entry || typeof entry !== "object") continue;
    const shaped = entry as { name?: unknown; type?: unknown; data?: unknown };
    if (typeof shaped.name !== "string" || shaped.name === "") continue;
    series.push({
      name: shaped.name,
      type: typeof shaped.type === "string" ? shaped.type : undefined,
      data: Array.isArray(shaped.data)
        ? shaped.data.filter((value): value is number => typeof value === "number")
        : [],
    });
  }

  const categories = Array.isArray(parsed.xaxis?.categories)
    ? parsed.xaxis.categories.filter((value): value is string => typeof value === "string")
    : [];

  return {
    series,
    categories,
    title: typeof parsed.title?.text === "string" ? parsed.title.text : null,
    subtitle: typeof parsed.subtitle?.text === "string" ? parsed.subtitle.text : null,
  };
}

/** `[16,00 h]` -> 16, `[108,80 h]` -> 108.8 */
function hoursFromSeriesName(name: string): number | null {
  const match = SERIES_HOURS_RE.exec(name);
  if (!match) return null;
  const value = Number((match[1] ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Parse the Einplanung chart into days, capacity and planned hours.
 *
 * ZEP renders three kinds of series: `Verfügbarkeit [108,80 h]` (the person's
 * capacity per day), one `bar` series per project and `gesamt [82,40 h]` (the
 * daily total). The kind is detected on the name prefix and only falls back to
 * the chart type.
 */
export function parsePlan(html: string, from: string, to: string): ZepPlan | null {
  const options = extractChartOptions(html);
  if (!options || options.series.length === 0) return null;

  let availability: ReadonlyArray<number> = [];
  let totals: ReadonlyArray<number> = [];
  const projectSeries: Array<{ name: string; data: ReadonlyArray<number>; stated: number | null }> = [];

  for (const series of options.series) {
    const label = series.name.replace(SERIES_HOURS_RE, "").trim();
    if (/^verf/i.test(label) || series.type === "area") {
      availability = series.data;
    } else if (/^gesamt/i.test(label) || series.type === "line") {
      totals = series.data;
    } else {
      projectSeries.push({ name: label, data: series.data, stated: hoursFromSeriesName(series.name) });
    }
  }

  const columnCount = Math.max(
    options.categories.length,
    ...options.series.map((series) => series.data.length),
    0,
  );
  if (columnCount === 0) return null;

  const days: ZepPlanDay[] = [];
  const summed = new Map<string, number>();

  for (let index = 0; index < columnCount; index += 1) {
    const slices: ZepPlanSlice[] = [];
    for (const series of projectSeries) {
      const hours = series.data[index] ?? 0;
      if (hours <= 0) continue;
      slices.push({ project: series.name, hours: round2(hours) });
      summed.set(series.name, round2((summed.get(series.name) ?? 0) + hours));
    }
    slices.sort((a, b) => b.hours - a.hours);

    const available = availability[index];
    const total = totals[index] ?? slices.reduce((sum, slice) => sum + slice.hours, 0);

    days.push({
      label: options.categories[index] ?? "",
      date: addDays(from, index),
      available: available === undefined ? null : round2(available),
      planned: round2(total ?? 0),
      slices,
    });
  }

  return {
    title: options.title,
    from,
    to,
    range: options.subtitle,
    capacity: round2(days.reduce((sum, day) => sum + (day.available ?? 0), 0)),
    planned: round2(days.reduce((sum, day) => sum + day.planned, 0)),
    // ZEP states each project's range total in its series name ([16,00 h]);
    // prefer that number, fall back to our own sum of the days.
    projects: projectSeries
      .map((series) => ({
        project: series.name,
        hours: series.stated ?? summed.get(series.name) ?? 0,
      }))
      .sort((a, b) => b.hours - a.hours),
    days,
  };
}
