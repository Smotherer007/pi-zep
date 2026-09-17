# pi-zep

A [pi](https://github.com/earendil-works/pi) extension that books project times
(**Projektzeiten**) in ZEP over plain HTTP — no browser, and no paid ZEP REST API.

## Why

ZEP's official REST API is a paid add-on and, at least up to ZEP v7.13.88,
cannot create a Projektzeit booking at all. The web UI itself talks to a plain
PHP endpoint that can, and it needs no API key. This extension speaks that
endpoint directly.

## How it works

The whole protocol was reverse-engineered from the web client. Three parts:

| Step | Request |
|------|---------|
| Login | `POST {root}/view/login.php` with `userid`, `password`, `login` → `302` whose `Location` carries the new `CLIENTSESSID` |
| Page / token | `GET {root}/view/index.php?CLIENTSESSID=…&menu=ProjektzeitVerwaltungMgr&action=save` → HTML containing `var requesttoken = '…'` |
| Booking | `POST {root}/view/ajax.php?CLIENTSESSID=…&pageContextId=Projektzeiten&mgr=ProjektzeitMgr&mgrId=3&action=save&JS_ENV_VAR_isFast=true&JS_ENV_VAR_locale=de&json=true&ajax=1` |

`{root}` is `<baseUrl>/<mandant>`, e.g. `https://zep-online.de/zepneoimpulse`.

The booking request needs:

* the **`x-requesttoken`** header (mandatory), plus `requesttoken` in the body,
* the **`PHPSESSID`** cookie **and** the `CLIENTSESSID` query parameter — neither alone is accepted,
* a form-urlencoded body with `datum`, `von`, `bis`, `dauer`, `projektId`, `vorgangId`, `taetigkeit`, `bemerkung`, `ort`, …

### Three things that bite

1. **The token rotates.** Every response — including errors — hands out the next
   `requesttoken`. This client adopts it automatically. Reusing an old token is
   not merely rejected: it makes the server **log the session out**
   (`msg=555001` / `555003` / `555009`) and you have to log in again.
2. **Never send an ajax call without a token.** The client fetches the page first
   when it does not hold a fresh token, so it can never fall into (1).
3. **ZEP locks the account after 5 failed password attempts.** The client
   therefore caches the session in `~/.pi/zep-session.json` and only logs in
   again when the cached session stops working. A failed login reports the
   remaining attempts (`noch=N`).

Reads and deletes use the same envelope:

```
GET …/ajax.php?…&mgr=ProjektzeitMgr&mgrId=0&action=setKw&kwDate=<monday>   # week overview
GET …/ajax.php?…&mgr=ProjektzeitMgr&mgrId=0&action=delete&objectId=<id>&kwDate=<monday>&userId=<user>
POST …/ajax.php?…&mgrId=3&action=save&formrefresh=true&formrefreshtrigger=projektId  # re-render the form for another project
```

The last one is the UI's own mechanism for changing the project: the Vorgang
list is rendered server-side, so it only contains the Vorgänge of the project
the page was rendered for. Posting `formrefresh=true` returns the new
`<select id="vorgangId">` without saving anything.

### Response shapes (verified against the live server)

| Outcome | `error` | `javascript` | content |
|---------|---------|--------------|---------|
| accepted | `null` | `dispatchZepEvent('zepProjektzeitMgrRefresh')` | calendar snippet |
| rejected | `"error"` | `null` | snippet containing `alert-message` with the reason |

**A rejection does not arrive in `javascript`.** It arrives as a `schnipsel`
whose target is a form message slot:

```html
<div class="card-alert alert alert-danger">
  <div class="alert-message">Projektzeit Do, 17.09.2026, 08:00 - 08:15 Speichern
  fehlgeschlagen. Diese Zeit kann nicht gebucht werden, da dadurch die Plan
  Stunden des Projekts/Vorgangs überschritten würden. Projektleiter wurden ggf.
  per E-Mail informiert.</div>
</div>
```

A client that only inspects `javascript` would report a useless "unspecified
error" here. `extractSnippetAlert()` reads the real text.

Other message texts observed:

* `… Tätigkeit co bei Vorgang 90-02 nicht erlaubt.` — the activity is not allowed for that Vorgang (90-02 only accepts `co_nb`).
* `… Plan Stunden des Projekts/Vorgangs überschritten…` — the Vorgang's planned hours are used up.

### Week table quirks

* The `setKw` snippet carries **no `target`** — it has to be recognised by content (`pz_kwnav`, `id="objectId…"`, `class="tag_…"`), never by target.
* The save response ships a *calendar* snippet targeting `managerdiv_ProjektzeitMgr`, which must not be mistaken for the week table.
* The ISO date of a day row is in `id="day_YYYY-MM-DD"` (fallback: the `openMahlzeiten(this, 'YYYY-MM-DD')` onclick, then the weekday + `DD.MM.` label).
* A day row's label is split across `<div>Do</div><div>17.09.</div>`, so plain `innerText` yields `Do17.09.` while tag-stripping yields `Do 17.09.` — parse the latter.
* Booking rows have 10 cells (`action, von, bis, Dauer, action, Projekt, Vorgang, Tät., fakturierbar, Bemerkung`); the `class="luecke"` spacer rows in between have 1 and must be skipped; the sum row has 3.

## Tools

| Tool | Purpose |
|------|---------|
| `zep_setup` | Store `userid`, `password`, `mandant` (default `zepneoimpulse`) |
| `zep_login` | Log in with the stored credentials, cache the session (`force` to ignore the cache) |
| `zep_status` | Show profiles and verify the live session (`probe` loads the booking form) |
| `zep_profile` | List / switch / delete profiles, `clear-session` |
| `zep_projects` | List projects and, per project, its Vorgänge and Tätigkeiten |
| `zep_week` | Week overview: bookings with row id, times, duration, sum, under-booked days |
| `zep_book` | Create bookings — one block or an `entries` array; `dryRun` supported |
| `zep_delete` | Delete a booking by row id |

## Usage

```
zep_setup  name=work userid=patrick.weppelmann password=… mandant=zepneoimpulse
zep_status probe=true
zep_projects projekt=Contoso
zep_week
zep_book   datum=2026-09-17 von=08:00 bis=12:00 projekt=413 vorgang=90-01 taetigkeit=co bemerkung="4711 Beispiel-Ticket"
zep_book   datum=2026-09-17 entries=[{von:"08:00",bis:"12:00",bemerkung:"…"},{von:"13:00",bis:"17:00",bemerkung:"…"}]
```

`projekt` and `vorgang` accept either an id (`413`, `3284`) or part of the label
(`Contoso`, `90-01`). A full example, `dryRun` first:

```
zep_book projekt=Contoso vorgang=90-01 datum=2026-09-17 von=08:00 bis=12:00 dryRun=true
```

## Important behaviour

* **ZEP rejects rather than overwrites.** A booking that would exceed the
  Vorgang's planned hours comes back as *"Diese Zeit kann nicht gebucht werden,
  da dadurch die Plan Stunden des Projekts/Vorgangs überschritten würden.
  Projektleiter wurden ggf. per E-Mail informiert."* This extension reports that
  text verbatim and never silently retries on another Vorgang.
* **`fakturierbar` is derived server-side** from project + Vorgang + Tätigkeit.
  The field is `disabled` in the UI and is deliberately not sent.
* **`jpeg`-free, dependency-light:** the only runtime dependency is `typebox`.

## Verified live

The full write cycle was exercised against the real system on 2026-09-17:
form re-render for another project, a booking created and confirmed in the week
table, then deleted and confirmed gone. A rejected booking (plan hours
exhausted) and a rejected Tätigkeit were reproduced as well.

What is *not* covered by that test run: a successful password login, because
that requires the account password. The endpoint, the field names and the
failure contract (`302 → login.php?…&action=login&msg=1&noch=N`) were verified
with throwaway credentials; everything after the redirect was verified with a
real session.

## Files

```
index.ts                    extension entry point (tool registration)
src/types.ts                plain data shapes
src/config.ts               profile + session persistence (~/.pi, mode 0600)
src/clients/zep-client.ts   HTTP session handling, booking, week, delete
src/clients/zep-parse.ts    tolerant parsers for ZEP's HTML / ajax JSON
src/formatting/             domain data -> text
src/tools/                  one tool per file
tests/                      parser + wire-contract tests (stubbed fetch)
```

## Development

```bash
npm install
npm test        # node --test
npx tsc --noEmit
```

The wire contract is pinned by `tests/zep-client.test.ts`, which asserts the
exact query parameters, headers and body fields against the live system's
observed behaviour.

## Configuration files

| File | Content |
|------|---------|
| `~/.pi/zep-config.json` | profiles with `userid` / `password` / `mandant` |
| `~/.pi/zep-session.json` | cached `CLIENTSESSID`, cookies and current `requesttoken` |

Both are written with mode `0600`.
