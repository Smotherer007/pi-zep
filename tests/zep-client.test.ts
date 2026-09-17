/**
 * Client tests with a stubbed fetch. These pin down the wire contract that
 * was reverse-engineered from the live system:
 *
 *   - login is a plain form POST to login.php, success is a 302 carrying
 *     the new CLIENTSESSID
 *   - every ajax call needs the `x-requesttoken` header, `json=true` and
 *     `ajax=1` in the query string
 *   - the token rotates with every response
 *   - a stale token kills the whole session
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ZepClient, ZepError } from "../src/clients/zep-client.ts";
import type { ZepAccount } from "../src/types.ts";

const ACCOUNT: ZepAccount = {
  name: "test",
  baseUrl: "https://zep-online.de",
  mandant: "zepneoimpulse",
  userid: "patrick.weppelmann",
  password: "secret",
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

interface StubResponse {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

function stubFetch(responses: Array<StubResponse | ((call: Call) => StubResponse)>) {
  const calls: Call[] = [];
  let index = 0;

  const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init.headers ?? {}).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const call: Call = {
      url,
      method: (init.method ?? "GET").toUpperCase(),
      headers,
      body: typeof init.body === "string" ? init.body : null,
    };
    calls.push(call);

    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    const spec = typeof next === "function" ? next(call) : next;

    const headerBag = new Headers(spec.headers ?? {});
    if (spec.body === undefined) {
      return new Response(null, { status: spec.status ?? 200, headers: headerBag });
    }
    return new Response(spec.body, { status: spec.status ?? 200, headers: headerBag });
  };

  (globalThis as { fetch: typeof fetch }).fetch = fakeFetch as unknown as typeof fetch;
  return { calls };
}

const TOKEN_PAGE = `<!doctype html><html><head><script>
var requesttoken = '7e6025829eb894e14707';
</script></head><body>
<select id="projektId" name="projektId"><option value="413" selected>K-10000-00001 (Contoso)</option></select>
<select id="vorgangId" name="vorgangId"><option value="3284" selected>90-01 (Entwicklung)</option><option value="3282">70 (AP7)</option></select>
<select id="taetigkeit" name="taetigkeit"><option value="co" selected>co (Consulting)</option><option value="re">re (reisen)</option></select>
<select id="ort" name="ort"><option value="NULL" selected>- Erste Tätigkeitsstätte -</option></select>
</body></html>`;

/**
 * The exact response sequence a successful login produces:
 *   GET login.php            -> PHPSESSID
 *   POST login.php           -> 302 into the app
 *   GET <redirect>           -> app shell (followed once)
 *   GET index.php Projektzeiten -> requesttoken
 */
function loginSequence(sid = "sid1"): StubResponse[] {
  return [
    {
      status: 200,
      body: "<form id='login-form'></form>",
      headers: { "set-cookie": "PHPSESSID=abc; path=/zepneoimpulse/; HttpOnly" },
    },
    { status: 302, headers: { location: `index.php?CLIENTSESSID=${sid}` } },
    { status: 200, body: TOKEN_PAGE },
    { status: 200, body: TOKEN_PAGE },
  ];
}


test("login follows the 302, keeps the PHPSESSID cookie and adopts the token", async () => {
  stubFetch([
    // GET login.php -> primes PHPSESSID
    { status: 200, body: "<form id='login-form'></form>", headers: { "set-cookie": "PHPSESSID=abc123; path=/zepneoimpulse/; HttpOnly" } },
    // POST login.php -> success redirect
    { status: 302, headers: { location: "index.php?CLIENTSESSID=17896225246aab78fc9d271" } },
    // followed redirect -> app shell
    { status: 200, body: TOKEN_PAGE },
    // the Projektzeiten page, which carries the requesttoken
    { status: 200, body: TOKEN_PAGE },
  ]);

  const client = new ZepClient(ACCOUNT);
  const result = await client.login();

  assert.equal(result.ok, true);
  assert.equal(result.clientsessid, "17896225246aab78fc9d271");
  assert.equal(client.sessionId, "17896225246aab78fc9d271");
  // the token from the followed page is adopted
  assert.equal(client.token, "7e6025829eb894e14707");
  assert.equal(client.currentSession().cookies.PHPSESSID, "abc123");
});

test("login reports the remaining password attempts on failure", async () => {
  stubFetch([
    { status: 200, body: "", headers: { "set-cookie": "PHPSESSID=abc; path=/" } },
    {
      status: 302,
      headers: { location: "login.php?CLIENTSESSID=1&action=login&msg=1&noch=4" },
    },
    {
      status: 200,
      body: `<div class="alert alert-danger"><div class="alert-message">Eingabefehler:<br />Benutzername oder Kennwort falsch,<br /> Sie haben noch 4 Versuch(e).</div></div>`,
    },
  ]);

  const client = new ZepClient(ACCOUNT);
  const result = await client.login();
  assert.equal(result.ok, false);
  assert.match(result.message ?? "", /Benutzername oder Kennwort falsch/);
  assert.equal(result.attemptsLeft, 4);
});

test("an expired cached session falls back to a fresh login", async () => {
  const { calls } = stubFetch([
    // probe -> session gone
    { status: 200, body: `{"javascript":"forwardTo('login.php?CLIENTSESSID=x&action=logout&msg=555001')"}` },
    // fresh login
    ...loginSequence("fresh123"),
    // and then the actual week read
    { status: 200, body: JSON.stringify({ requesttoken: "t2", 0: { type: "schnipsel", target: "ProjektzeitTableDiv", data: "<table></table>" } }) },
  ]);

  const client = new ZepClient(ACCOUNT);
  client.applySession({
    clientsessid: "stale",
    requesttoken: "old",
    cookies: { PHPSESSID: "stale" },
    savedAt: new Date().toISOString(),
  });

  assert.equal(await client.probe(), false);

  const login = await client.login();
  assert.equal(login.ok, true);
  assert.equal(client.sessionId, "fresh123");

  await client.week("2026-09-14");
  const lastCall = calls.at(-1)!;
  assert.match(lastCall.url, /CLIENTSESSID=fresh123/);
});

test("book() sends the exact ajax contract the web form uses", async () => {
  const { calls } = stubFetch([
    ...loginSequence(),
    // save response rotates the token
    { status: 200, body: JSON.stringify({ name: "response", requesttoken: "ROTATED", javascript: null, error: null }) },
    // second save must use the rotated token
    { status: 200, body: JSON.stringify({ name: "response", requesttoken: "ROTATED2", javascript: null, error: null }) },
  ]);

  const client = new ZepClient(ACCOUNT);
  assert.equal((await client.login()).ok, true);

  const result = await client.book({
    date: "2026-09-17",
    from: "08:00",
    to: "12:00",
    duration: "04:00",
    projektId: "413",
    vorgangId: "3284",
    taetigkeit: "co",
    comment: "4711 Beispiel-Ticket",
  });
  assert.equal(result.ok, true);

  const save = calls.at(-1)!;
  const url = new URL(save.url);
  assert.equal(save.method, "POST");
  assert.equal(url.pathname, "/zepneoimpulse/view/ajax.php");
  assert.equal(url.searchParams.get("pageContextId"), "Projektzeiten");
  assert.equal(url.searchParams.get("mgr"), "ProjektzeitMgr");
  assert.equal(url.searchParams.get("mgrId"), "3");
  assert.equal(url.searchParams.get("action"), "save");
  assert.equal(url.searchParams.get("json"), "true");
  assert.equal(url.searchParams.get("ajax"), "1");
  assert.equal(url.searchParams.get("JS_ENV_VAR_locale"), "de");
  assert.equal(url.searchParams.get("CLIENTSESSID"), "sid1");
  assert.equal(save.headers["x-requesttoken"], "7e6025829eb894e14707");
  assert.match(save.headers.cookie ?? "", /PHPSESSID=abc/);

  const body = new URLSearchParams(save.body ?? "");
  assert.equal(body.get("datum"), "2026-09-17");
  assert.equal(body.get("von"), "08:00");
  assert.equal(body.get("bis"), "12:00");
  assert.equal(body.get("dauer"), "04:00");
  assert.equal(body.get("projektId"), "413");
  assert.equal(body.get("vorgangId"), "3284");
  assert.equal(body.get("taetigkeit"), "co");
  assert.equal(body.get("bemerkung"), "4711 Beispiel-Ticket");
  // the token travels in the body as well as in the header
  assert.equal(body.get("requesttoken"), "7e6025829eb894e14707");
  // disabled fields must not appear
  assert.equal(body.get("fakturierbar"), null);

  // token rotation: the next call uses the token from the previous response
  await client.book({
    date: "2026-09-17",
    from: "13:00",
    to: "17:00",
    duration: "04:00",
    projektId: "413",
    vorgangId: "3284",
    taetigkeit: "co",
    comment: "second block",
  });
  assert.equal(calls.at(-1)!.headers["x-requesttoken"], "ROTATED");
});

test("book() surfaces the Plan-Stunden rejection as an error, not an exception", async () => {
  stubFetch([
    ...loginSequence(),
    {
      status: 200,
      body: JSON.stringify({
        name: "response",
        requesttoken: "t",
        error: null,
        javascript:
          "zepalert('error Projektzeit Do, 17.09.2026, 08:00 - 12:00 Speichern fehlgeschlagen.<br \\/><br \\/>Diese Zeit kann nicht gebucht werden, da dadurch die Plan Stunden des Projekts\\/Vorgangs überschritten würden.', function() { reloadPage() })",
      }),
    },
  ]);

  const client = new ZepClient(ACCOUNT);
  await client.login();
  const result = await client.book({
    date: "2026-09-17",
    from: "08:00",
    to: "12:00",
    duration: "04:00",
    projektId: "413",
    vorgangId: "3284",
    taetigkeit: "co",
    comment: "x",
  });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Plan Stunden/);
});

test("a dead session during an ajax call raises a ZepError", async () => {
  stubFetch([
    ...loginSequence(),
    {
      status: 200,
      body: `{"javascript":"forwardTo('login.php?CLIENTSESSID=x&action=logout&msg=555003')","requesttoken":null}`,
    },
  ]);

  const client = new ZepClient(ACCOUNT);
  await client.login();
  await assert.rejects(() => client.week("2026-09-14"), ZepError);
});

test("loadForm reads the requesttoken and every option list", async () => {
  stubFetch(loginSequence());

  const client = new ZepClient(ACCOUNT);
  await client.login();
  const { form, token } = await client.loadForm();

  assert.equal(token, "7e6025829eb894e14707");
  assert.equal(form.selected.projektId, "413");
  assert.equal(form.selected.vorgangId, "3284");
  assert.equal(form.selected.taetigkeit, "co");
  assert.equal(form.vorgaenge.length, 2);
  assert.equal(form.taetigkeiten.length, 2);
});

test("week() reads the table out of the ajax snippet", async () => {
  stubFetch([
    ...loginSequence(),
    {
      status: 200,
      body: JSON.stringify({
        requesttoken: "t",
        0: {
          type: "schnipsel",
          target: "ProjektzeitTableDiv",
          data: `<table>
            <tr class="tag_17 today"><td>Do 17.09.</td><td></td></tr>
            <tr><td><a onclick="x('objectId=999')">delete</a></td><td>08:00</td><td>12:00</td><td>4,00</td><td></td><td>Contoso</td><td>90-01</td><td>co</td><td>payments</td><td>test</td></tr>
            <tr><td>Summe</td><td>4,00</td><td>payments 4,00</td></tr>
          </table>`,
        },
      }),
    },
  ]);

  const client = new ZepClient(ACCOUNT);
  await client.login();
  const week = await client.week("2026-09-14");

  assert.equal(week.days.length, 1);
  assert.equal(week.days[0]!.date, "2026-09-17");
  assert.equal(week.days[0]!.bookings[0]!.objectId, "999");
  assert.equal(week.days[0]!.total, "4,00");
});

test("remove() calls the delete action with userId and objectId", async () => {
  const { calls } = stubFetch([
    ...loginSequence(),
    { status: 200, body: JSON.stringify({ requesttoken: "t2", javascript: null }) },
  ]);

  const client = new ZepClient(ACCOUNT);
  await client.login();
  const result = await client.remove("163533", "2026-09-14");
  assert.equal(result.ok, true);

  const url = new URL(calls.at(-1)!.url);
  assert.equal(url.searchParams.get("action"), "delete");
  assert.equal(url.searchParams.get("mgrId"), "0");
  assert.equal(url.searchParams.get("objectId"), "163533");
  assert.equal(url.searchParams.get("userId"), "patrick.weppelmann");
  assert.equal(url.searchParams.get("kwDate"), "2026-09-14");
});

// ------------------------------------------------- live-verified response shapes

test("book() reports the German rejection text from the snippet, not a generic error", async () => {
  const rejected = JSON.stringify({
    error: "error",
    javascript: null,
    requesttoken: "t1",
    defaultschnipsel: {
      type: "schnipsel",
      target: "formularmessagediv_ProjektzeitFormMgr3",
      data: '<div class="card-alert alert alert-danger fadeout"><div class="alert-message">Projektzeit Do, 17.09.2026, 08:00 - 08:15 Speichern fehlgeschlagen. Tasse zu heiss.</div></div>',
    },
  });

  stubFetch([...loginSequence(), { status: 200, body: rejected }]);

  const client = new ZepClient(ACCOUNT);
  await client.login();
  const result = await client.book({
    date: "2026-09-17", from: "08:00", to: "08:15", duration: "00:15",
    projektId: "413", vorgangId: "3287", taetigkeit: "co", comment: "x",
  });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Tasse zu heiss/);
  assert.doesNotMatch(result.error ?? "", /alert-message/);
});

test("book() treats the dispatchZepEvent response as success", async () => {
  const accepted = JSON.stringify({
    error: null,
    javascript: "dispatchZepEvent('zepProjektzeitMgrRefresh')",
    requesttoken: "t2",
    defaultschnipsel: {
      type: "schnipsel",
      target: "managerdiv_ProjektzeitMgr",
      data: '<div class="calendar" id="attendances-index"></div>',
    },
  });

  stubFetch([...loginSequence(), { status: 200, body: accepted }]);

  const client = new ZepClient(ACCOUNT);
  await client.login();
  const result = await client.book({
    date: "2026-09-17", from: "08:00", to: "08:15", duration: "00:15",
    projektId: "16", vorgangId: "862", taetigkeit: "vw", comment: "x",
  });

  assert.equal(result.ok, true);
});

test("book() computes the duration when it is not supplied", async () => {
  const { calls } = stubFetch([
    ...loginSequence(),
    { status: 200, body: JSON.stringify({ error: null, javascript: "dispatchZepEvent('x')" }) },
  ]);

  const client = new ZepClient(ACCOUNT);
  await client.login();
  const result = await client.book({
    date: "2026-09-17", from: "13:00", to: "17:00", duration: "",
    projektId: "16", vorgangId: "862", taetigkeit: "vw", comment: "x",
  });

  assert.equal(result.ok, true);
  const body = new URLSearchParams(calls.at(-1)!.body ?? "");
  assert.equal(body.get("dauer"), "04:00");
});

test("login() refuses to send an empty password instead of burning a lockout attempt", async () => {
  const { calls } = stubFetch([{ status: 200, body: "" }]);
  const client = new ZepClient({ ...ACCOUNT, password: "" });

  await assert.rejects(() => client.login(), (error: unknown) => {
    assert.ok(error instanceof ZepError);
    assert.match((error as Error).message, /No password stored/);
    assert.match((error as Error).message, /locks the account after 5 failed attempts/);
    return true;
  });

  assert.equal(calls.length, 0, "no request may leave the process");
});
