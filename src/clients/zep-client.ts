/**
 * Minimal ZEP HTTP client.
 *
 * Why this exists: ZEP's official REST API is a paid add-on and (as of
 * v7.13.x) cannot even create a Projektzeit booking. The web UI, however,
 * talks to a plain PHP endpoint that can:
 *
 *   POST {root}/view/ajax.php?CLIENTSESSID=..&pageContextId=Projektzeiten
 *        &mgr=ProjektzeitMgr&mgrId=3&action=save
 *        &JS_ENV_VAR_isFast=true&JS_ENV_VAR_locale=de&json=true&ajax=1
 *   header: x-requesttoken: <token>
 *   body:   form-urlencoded booking fields + requesttoken
 *
 * Three things are easy to get wrong and are handled here:
 *   1. The session is `CLIENTSESSID` (URL) *plus* a `PHPSESSID` cookie. Neither alone works.
 *   2. `x-requesttoken` is mandatory. A missing or stale token makes the server
 *      invalidate the whole session (msg=555001 / 555003 / 555009) - it does not
 *      just reject the one request.
 *   3. The token rotates: every response hands out the next one.
 */

import type { LoginResult, ZepAccount, ZepBookingRequest, ZepFormData, ZepSaveResult, ZepSession, ZepWeek } from "../types.ts";
import {
  detectSessionLoss,
  durationBetween,
  extractAlertMessage,
  extractClientSessionId,
  extractRequestToken,
  extractSnippetAlert,
  parseAjaxEnvelope,
  parseSelect,
  parseWeek,
  pickWeekTableSnippet,
  selectedValue,
} from "./zep-parse.ts";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** `mgrId` of the Projektzeiten booking form on the Projektzeiten page. */
const SAVE_MGR_ID = "3";
/** `mgrId` of the read-only Projektzeiten table. */
const TABLE_MGR_ID = "0";

export class ZepError extends Error {
  readonly attemptsLeft?: number;
  constructor(message: string, attemptsLeft?: number) {
    super(message);
    this.name = "ZepError";
    this.attemptsLeft = attemptsLeft;
  }
}

export interface ZepPing {
  readonly status: number;
  /** The login form rendered, i.e. the server is up and reachable. */
  readonly loginPageOk: boolean;
  /** login.php bounced us into the app, i.e. we are already authenticated. */
  readonly redirectedToApp: boolean;
}

export interface ZepClientOptions {
  /** Called whenever a fresh session was established, so it can be cached. */
  readonly onSession?: (session: ZepSession) => void;
}

export class ZepClient {
  private readonly account: ZepAccount;
  private readonly root: string;
  private readonly options: ZepClientOptions;

  private cookies = new Map<string, string>();
  private clientsessid: string | null = null;
  private requesttoken: string | null = null;
  private lastLogin: LoginResult | null = null;

  constructor(account: ZepAccount, options: ZepClientOptions = {}) {
    this.account = account;
    this.root = `${account.baseUrl.replace(/\/+$/, "")}/${account.mandant.replace(/^\/+|\/+$/g, "")}`;
    this.options = options;
  }

  // ------------------------------------------------------------------ session

  /** Adopt a cached session (from disk) so no login is needed. */
  applySession(session: ZepSession): void {
    this.clientsessid = session.clientsessid;
    this.requesttoken = session.requesttoken;
    this.cookies = new Map(Object.entries(session.cookies));
  }

  currentSession(): ZepSession {
    if (!this.clientsessid) throw new ZepError("Not logged in.");
    return {
      clientsessid: this.clientsessid,
      requesttoken: this.requesttoken,
      cookies: Object.fromEntries(this.cookies),
      savedAt: new Date().toISOString(),
    };
  }

  get sessionId(): string | null {
    return this.clientsessid;
  }

  get token(): string | null {
    return this.requesttoken;
  }

  get lastLoginResult(): LoginResult | null {
    return this.lastLogin;
  }

  /** True when we hold both halves of a session. */
  get hasSession(): boolean {
    return this.clientsessid !== null && this.cookies.size > 0;
  }

  /**
   * Log in with the stored credentials.
   *
   * `login.php` is a plain form POST (`userid`, `password`, `login`) with no
   * CSRF token. Success is a 302 whose Location carries the new
   * `CLIENTSESSID`; failure is a 302 back to `login.php?...&msg=N&noch=M`
   * where `noch` is the remaining attempt count before a lockout.
   */
  async login(): Promise<LoginResult> {
    // Refuse before touching the network. Without this guard an absent
    // password becomes the literal string "undefined" in the form body, which
    // ZEP counts as a real failed attempt - and the account is locked after 5.
    if (!this.account.password) {
      throw new ZepError(
        `No password stored for ZEP user "${this.account.userid}". Add a "password" to the ` +
          "profile in ~/.pi/zep-config.json (or run zep_setup). Refusing to send an empty " +
          "password, because ZEP locks the account after 5 failed attempts.",
      );
    }

    this.cookies.clear();
    this.clientsessid = null;
    this.requesttoken = null;

    // 1) Prime the PHPSESSID cookie.
    await this.raw("/view/login.php", { method: "GET" });

    // 2) Post the credentials.
    const body = new URLSearchParams({
      userid: this.account.userid,
      password: this.account.password,
      login: "Anmelden",
    }).toString();

    // Match the browser form POST exactly: same-origin form submissions carry
    // Referer and Origin, and ZEP's login handler is the pickiest endpoint.
    const loginUrl = `${this.root}/view/login.php`;
    const res = await this.raw("/view/login.php", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: loginUrl,
        origin: this.root,
      },
      body,
    });

    const location = res.headers.get("location") ?? "";
    let html = await res.text();

    // ZEP always answers the login POST with a 302: either into the app
    // (success) or back to login.php with `action=login&msg=N&noch=M`
    // (failure). Follow it once either way - the failure text only exists on
    // the rendered page, not in the redirect URL.
    if (res.status >= 300 && res.status < 400 && location) {
      const followed = await this.raw(relativize(location), { method: "GET" });
      html = await followed.text();
    }

    const isLoginFailure = /action=(login|logout)/i.test(location) || /Eingabefehler/i.test(html);
    const sid = isLoginFailure
      ? null
      : (extractClientSessionId(location) ?? extractClientSessionId(html));

    if (sid) {
      this.clientsessid = sid;
      this.requesttoken = extractRequestToken(html);

      // Always finish by loading the booking page: it both proves the login
      // worked and hands us the token every ajax call needs.
      try {
        await this.fetchPage();
      } catch {
        this.clientsessid = null;
        this.cookies.clear();
        this.lastLogin = { ok: false, message: "Login appeared to succeed but the app did not load." };
        return this.lastLogin;
      }

      this.lastLogin = { ok: true, clientsessid: sid };
      this.persistSession();
      return this.lastLogin;
    }

    const attemptsLeft = /noch\s+(\d+)/.exec(html)?.[1];
    const message =
      /Benutzername oder Kennwort falsch/i.test(html)
        ? "Benutzername oder Kennwort falsch."
        : /gesperrt|locked/i.test(html)
          ? "Account locked."
          : `Login failed (HTTP ${res.status}${location ? `, ${location}` : ""}).`;

    this.lastLogin = {
      ok: false,
      message,
      attemptsLeft: attemptsLeft ? Number(attemptsLeft) : undefined,
    };
    return this.lastLogin;
  }

  /**
   * Reachability probe used by zep_doctor. Read-only: it fetches the login
   * page and reports what came back. Never call it on a client that holds a
   * live session - priming a new PHPSESSID would replace the working cookie.
   */
  async ping(): Promise<ZepPing> {
    const res = await this.raw("/view/login.php", { method: "GET" });
    const body = await res.text();
    const location = res.headers.get("location") ?? "";
    return {
      status: res.status,
      loginPageOk: /id="login-form"/.test(body),
      redirectedToApp: /index\.php/.test(location) && !/action=login/.test(location),
    };
  }

  /** Log in only when there is no usable session yet. */
  async ensureLogin(): Promise<void> {
    if (this.hasSession) return;
    const result = await this.login();
    if (!result.ok) {
      throw new ZepError(
        `${result.message ?? "Login failed"}${
          result.attemptsLeft !== undefined ? ` (${result.attemptsLeft} attempts left)` : ""
        }`,
        result.attemptsLeft,
      );
    }
  }

  private persistSession(): void {
    if (!this.clientsessid) return;
    try {
      this.options.onSession?.(this.currentSession());
    } catch {
      // caching is best effort
    }
  }

  // ------------------------------------------------------------------ plumbing

  private url(path: string, query: Record<string, string> = {}): string {
    const base = /^https?:/i.test(path) ? path : `${this.root}${path}`;
    const search = new URLSearchParams(query).toString();
    return `${base}${search ? `${base.includes("?") ? "&" : "?"}${search}` : ""}`;
  }

  private async raw(
    path: string,
    init: RequestInit & { query?: Record<string, string> } = {},
  ): Promise<Response> {
    const { query, ...rest } = init;
    const headers = new Headers(rest.headers ?? {});
    headers.set("user-agent", USER_AGENT);
    headers.set("accept-language", "de-DE,de;q=0.9,en;q=0.8");
    // Deliberately no automatic X-Requested-With here: the browser only sends
    // it on ajax.php calls, never on the login form POST. Sending it on the
    // login made the request diverge from the real form.
    if (this.cookies.size > 0) {
      headers.set(
        "cookie",
        [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
      );
    }

    const res = await fetch(this.url(path, query), { redirect: "manual", ...rest, headers });
    this.absorbCookies(res);
    return res;
  }

  private absorbCookies(res: Response): void {
    const setCookies =
      typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const rawCookie of setCookies) {
      const [pair] = rawCookie.split(";");
      if (!pair) continue;
      const idx = pair.indexOf("=");
      if (idx === -1) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  /**
   * Build the ajax.php URL exactly the way the web UI does:
   * base + JS env vars + `json=true` + `ajax=1`.
   */
  private ajaxUrl(
    action: string,
    mgrId: string,
    extra: Record<string, string> = {},
  ): { path: string; query: Record<string, string> } {
    if (!this.clientsessid) throw new ZepError("Not logged in.");
    return {
      path: "/view/ajax.php",
      query: {
        CLIENTSESSID: this.clientsessid,
        pageContextId: "Projektzeiten",
        mgr: "ProjektzeitMgr",
        mgrId,
        action,
        ...extra,
        JS_ENV_VAR_isFast: "true",
        JS_ENV_VAR_locale: "de",
        json: "true",
        ajax: "1",
      },
    };
  }

  private async ajax(
    action: string,
    mgrId: string,
    options: { method?: "GET" | "POST"; extra?: Record<string, string>; form?: Record<string, string> } = {},
  ) {
    await this.ensureLogin();
    // A request without a token is answered with a session logout, so never
    // send one: fetch the page first when we do not have a fresh token yet.
    if (!this.requesttoken) await this.fetchPage();

    const { path, query } = this.ajaxUrl(action, mgrId, options.extra);
    const method = options.method ?? "GET";

    const headers: Record<string, string> = {
      "x-requested-with": "XMLHttpRequest",
      ...(this.requesttoken ? { "x-requesttoken": this.requesttoken } : {}),
    };

    let body: string | undefined;
    if (method === "POST") {
      headers["content-type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      const form = { ...(options.form ?? {}) };
      if (this.requesttoken) form.requesttoken = this.requesttoken;
      body = new URLSearchParams(form).toString();
    }

    const res = await this.raw(path, { method, headers, body, query });
    const text = await res.text();
    const sessionLoss = detectSessionLoss(text);
    if (sessionLoss) throw new ZepError(`ZEP ${sessionLoss}`);
    const envelope = parseAjaxEnvelope(text);
    if (envelope.requesttoken) this.requesttoken = envelope.requesttoken;
    return envelope;
  }

  // ---------------------------------------------------------------------- page

  /**
   * Load the Projektzeiten page and read the requesttoken plus the option
   * lists from the booking form.
   */
  async loadForm(): Promise<{ form: ZepFormData; token: string | null }> {
    await this.ensureLogin();
    const html = await this.getPageHtml();
    return { form: parseFormData(html), token: this.requesttoken };
  }

  /** Load the Projektzeiten page and pick up its requesttoken. */
  private async fetchPage(): Promise<string> {
    if (!this.clientsessid) throw new ZepError("Not logged in.");
    const res = await this.raw("/view/index.php", {
      query: {
        CLIENTSESSID: this.clientsessid,
        menu: "ProjektzeitVerwaltungMgr",
        action: "save",
      },
    });
    const html = await res.text();
    const sessionLoss = detectSessionLoss(html);
    if (sessionLoss) throw new ZepError(`ZEP ${sessionLoss}`);
    const token = extractRequestToken(html);
    if (token) this.requesttoken = token;
    return html;
  }

  /**
   * Like `fetchPage`, but recovers once from a stale session by logging in
   * again. Used by the read paths.
   */
  private async getPageHtml(): Promise<string> {
    await this.ensureLogin();
    try {
      return await this.fetchPage();
    } catch {
      this.clientsessid = null;
      this.cookies.clear();
      const result = await this.login();
      if (!result.ok) {
        throw new ZepError(result.message ?? "Login failed", result.attemptsLeft);
      }
      return this.fetchPage();
    }
  }

  // -------------------------------------------------------------------- actions

  /**
   * Verify the session cheaply by reading the current week.
   * Returns false when ZEP no longer accepts the session.
   */
  async probe(): Promise<boolean> {
    try {
      await this.week();
      return true;
    } catch {
      return false;
    }
  }

  /** Week overview for the ISO week containing `isoDate` (default: today). */
  async week(isoDate?: string): Promise<ZepWeek> {
    const kwDate = isoDate ?? mondayOfToday();
    const envelope = await this.ajax("setKw", TABLE_MGR_ID, { extra: { kwDate } });
    const tableHtml = pickWeekTableSnippet(envelope.snippets)?.data ?? "";
    return parseWeek(tableHtml, kwDate);
  }

  /**
   * Turn an ajax envelope into a success/failure verdict.
   *
   * Verified against the live system:
   *   accepted -> `error: null`, `javascript: "dispatchZepEvent(...)"`
   *   rejected -> `error: "error"`, `javascript: null`, and the reason inside
   *               a `schnipsel` message slot (e.g. plan hours exceeded).
   */
  private verdict(envelope: Awaited<ReturnType<ZepClient["ajax"]>>, successMessage: string): ZepSaveResult {
    const snippetAlert = extractSnippetAlert(envelope.snippets);
    if (snippetAlert && snippetAlert.kind !== "success") {
      return { ok: false, error: snippetAlert.message };
    }

    const jsAlert = extractAlertMessage(envelope.javascript);
    if (jsAlert) return { ok: false, error: jsAlert };

    if (envelope.error === "error") {
      return {
        ok: false,
        error:
          snippetAlert?.message ??
          "ZEP rejected the request without a readable message.",
      };
    }

    return { ok: true, message: snippetAlert?.message ?? successMessage };
  }

  /**
   * Create one Projektzeit booking.
   *
   * ZEP rejects a booking whose duration would exceed the Vorgang's planned
   * hours; that arrives as a normal JSON alert, not an HTTP error.
   */
  async book(request: ZepBookingRequest): Promise<ZepSaveResult> {
    const duration = request.duration || durationBetween(request.from, request.to) || "";
    if (!duration) {
      throw new ZepError(`Invalid time range: ${request.from} - ${request.to}`);
    }

    const form: Record<string, string> = {
      ueberschreiben: "0",
      doppelbuchungTrotzdemFragenObUeberschreiben: "1",
      ueberschreibenTrotzDoppelbuchung: "0",
      preisfaktorantwort: "",
      datum: request.date,
      von: request.from,
      bis: request.to,
      dauer: duration,
      projektId: request.projektId,
      vorgangId: request.vorgangId,
      taetigkeit: request.taetigkeit,
      ort: request.ort ?? "NULL",
      letzterReiseOrt: "D-Office",
      ortProjektrelevant: "1",
      reise: "0",
      startort: "Beispielweg 1",
      zielort: "Beispielort",
      fahrzeug: "Firmenwagen",
      km: "285",
      mitfahrer: "1",
      bemerkung: request.comment,
      plusDays: "30",
      plusMinutes: "0",
      pastDays: "180",
      pastDaysBezug: "0",
      montagsErfassungFuerVorwoche: "1",
      privat: "0",
    };

    const envelope = await this.ajax("save", SAVE_MGR_ID, { method: "POST", form });
    return this.verdict(envelope, "Buchung gespeichert.");
  }

  /** Delete a booking by its row id from `week()`. */
  async remove(objectId: string, kwDate?: string): Promise<ZepSaveResult> {
    const envelope = await this.ajax("delete", TABLE_MGR_ID, {
      extra: {
        userId: this.account.userid,
        objectId,
        ...(kwDate ? { kwDate } : {}),
      },
    });
    return this.verdict(envelope, "Buchung gelöscht.");
  }

  /**
   * Ask ZEP to re-render the booking form for a different project so its
   * Vorgang list becomes readable. This is the UI's own `formrefresh`
   * mechanism (`formrefreshtrigger=projektId`), not a save.
   */
  async refreshFormForProject(projektId: string): Promise<ZepFormData> {
    const envelope = await this.ajax("save", SAVE_MGR_ID, {
      method: "POST",
      extra: { formrefresh: "true", formrefreshtrigger: "projektId" },
      form: { projektId },
    });
    const html = envelope.snippets.map((s) => s.data).join("\n");
    const form = parseFormData(html);
    if (form.vorgaenge.length > 0 && form.projects.length === 0) {
      // A partial re-render only carries the changed selects.
      const full = await this.loadForm();
      return {
        ...full.form,
        vorgaenge: form.vorgaenge,
        taetigkeiten: form.taetigkeiten.length ? form.taetigkeiten : full.form.taetigkeiten,
        selected: {
          ...full.form.selected,
          ...form.selected,
          projektId: form.selected.projektId ?? projektId,
        },
      };
    }
    return form;
  }
}

// ---------------------------------------------------------------------- helpers

/** Turn an absolute redirect target into a path relative to the ZEP root. */
function relativize(location: string): string {
  if (!/^https?:/i.test(location)) return location.startsWith("/") ? location : `/${location}`;
  try {
    const parsed = new URL(location);
    const marker = `/${parsed.pathname.split("/").filter(Boolean)[0] ?? ""}`;
    const withoutMandant = parsed.pathname.startsWith(marker)
      ? parsed.pathname.slice(marker.length)
      : parsed.pathname;
    return `${withoutMandant}${parsed.search}`;
  } catch {
    return location;
  }
}

function mondayOfToday(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  now.setUTCDate(now.getUTCDate() + diff);
  return now.toISOString().slice(0, 10);
}

export function parseFormData(html: string): ZepFormData {
  const projects = parseSelect(html, "projektId");
  const vorgaenge = parseSelect(html, "vorgangId");
  const taetigkeiten = parseSelect(html, "taetigkeit");
  const orte = parseSelect(html, "ort");
  return {
    projects,
    vorgaenge,
    taetigkeiten,
    orte,
    selected: {
      projektId: selectedValue(projects),
      vorgangId: selectedValue(vorgaenge),
      taetigkeit: selectedValue(taetigkeiten),
      ort: selectedValue(orte),
    },
  };
}

/**
 * Resolve a project/Vorgang/Tätigkeit reference that the user gave either as a
 * numeric id or as (part of) a label. Returns the matching option, preferring
 * an exact id match.
 */
export function resolveOption(
  options: ReadonlyArray<{ id: string; label: string }>,
  reference: string,
  what: string,
): { id: string; label: string } {
  const needle = reference.trim();
  if (!needle) throw new ZepError(`No ${what} given.`);

  const byId = options.find((o) => o.id === needle);
  if (byId) return byId;

  const lower = needle.toLowerCase();
  const exact = options.find((o) => o.label.toLowerCase() === lower);
  if (exact) return exact;

  const partial = options.filter((o) => o.label.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0]!;
  if (partial.length === 0) {
    throw new ZepError(
      `No ${what} matches "${needle}". Available: ${options.map((o) => `${o.id}=${o.label}`).join(" | ") || "(none)"}`,
    );
  }
  throw new ZepError(
    `"${needle}" is ambiguous for ${what}: ${partial.map((o) => `${o.id}=${o.label}`).join(" | ")}`,
  );
}
