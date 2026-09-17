/**
 * Parser tests. The fixtures are trimmed copies of what the live system
 * (zep-online.de, Mandant zepneoimpulse, ZEP v7.13.88) actually returns.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decodeEntities,
  detectSessionLoss,
  durationBetween,
  extractAlertMessage,
  extractClientSessionId,
  extractRequestToken,
  parseAjaxEnvelope,
  parseSelect,
  parseWeek,
  selectedValue,
  timeToMinutes,
} from "../src/clients/zep-parse.ts";

test("extractRequestToken reads the inline page variable", () => {
  const html = `<script>\nvar requesttoken = '7e6025829eb894e14707';\n</script>`;
  assert.equal(extractRequestToken(html), "7e6025829eb894e14707");
  assert.equal(extractRequestToken("<html>no token</html>"), null);
});

test("extractClientSessionId picks the id out of a redirect URL", () => {
  assert.equal(
    extractClientSessionId("login.php?CLIENTSESSID=17896225246aab78fc9d271&action=logout&msg=555001"),
    "17896225246aab78fc9d271",
  );
});

test("detectSessionLoss recognises the three logout envelopes", () => {
  assert.match(
    detectSessionLoss(
      `{"javascript":"forwardTo('login.php?CLIENTSESSID=x&action=logout&msg=555001')"}`,
    ) ?? "",
    /msg=555001/,
  );
  assert.match(
    detectSessionLoss(`{"javascript":"zepalert('Ihre Session ist ung\\u00fcltig! ...')"}`) ?? "",
    /session invalid/,
  );
  assert.equal(detectSessionLoss(`{"requesttoken":"abc"}`), null);
});

test("parseSelect reads a ZEP select with selected and disabled options", () => {
  const html = `
    <select id="projektId" name="projektId" class="form-control custom-select select2-hidden-accessible">
      <option value="376" >I-10 (Organisation &amp; Verwaltung)</option>
      <option value="16" >I-50 (Produktentwicklung)</option>
      <option value="413" selected>K-10000-00001 (Contoso - Integration Warehouse Automation&trade; in SAP S/4 Cloud Public Edition)</option>
      <option value="999" disabled>hidden</option>
    </select>`;
  const options = parseSelect(html, "projektId");
  assert.equal(options.length, 4);
  assert.equal(options[2]!.id, "413");
  assert.equal(options[2]!.selected, true);
  assert.match(options[2]!.label, /Contoso - Integration Warehouse Automation/);
  assert.equal(options[1]!.label, "I-50 (Produktentwicklung)");
  assert.equal(options[3]!.disabled, true);
  assert.equal(selectedValue(options), "413");
});

test("parseSelect tolerates an attribute order swap and single quotes", () => {
  const html = `<select name='vorgangId' id='vorgangId' size='1'>
     <option selected='selected' value='3284'>90-01 (Entwicklung ExampleLink Public Cloud)</option>
     <option value='3282'>70 (AP7 &ndash; Cutover und Migration)</option>
   </select>`;
  const options = parseSelect(html, "vorgangId");
  assert.equal(options[0]!.id, "3284");
  assert.equal(options[0]!.selected, true);
});

test("parseSelect returns nothing for an unknown select", () => {
  assert.deepEqual(parseSelect("<select id='other'></select>", "projektId"), []);
});

test("parseAjaxEnvelope keeps snippets and the rotated token", () => {
  const body = JSON.stringify({
    name: "response",
    type: "response",
    javascript: null,
    error: "error",
    requesttoken: "013c16072d89623ed872",
    cssfiles: { name: "cssfiles", type: "undefined" },
    javascriptfiles: { name: "javascriptfiles", type: "undefined" },
    0: {
      name: 0,
      type: "schnipsel",
      target: "ProjektzeitTableDiv",
      buildfunc: "default",
      data: "<table><tbody></tbody></table>",
    },
  });
  const envelope = parseAjaxEnvelope(body);
  assert.equal(envelope.requesttoken, "013c16072d89623ed872");
  assert.equal(envelope.error, "error");
  assert.equal(envelope.snippets.length, 1);
  assert.equal(envelope.snippets[0]!.target, "ProjektzeitTableDiv");
});

test("parseAjaxEnvelope rejects a non-JSON body", () => {
  assert.throws(() => parseAjaxEnvelope("<html>oops</html>"), /non-JSON/);
});

test("extractAlertMessage unwraps the zepalert call", () => {
  const js =
    "zepalert('error Projektzeit Do, 17.09.2026, 08:00 - 12:00 Speichern fehlgeschlagen.<br \\/><br \\/>Diese Zeit kann nicht gebucht werden, da dadurch die Plan Stunden des Projekts\\/Vorgangs überschritten würden.', function() { reloadPage() })";
  const message = extractAlertMessage(js);
  assert.match(message ?? "", /Speichern fehlgeschlagen/);
  assert.match(message ?? "", /Plan Stunden/);
  assert.doesNotMatch(message ?? "", /[<>]/);
});

test("decodeEntities handles the entities ZEP emits", () => {
  assert.equal(decodeEntities("Warehouse Automation&trade;"), "Warehouse Automation&trade;");
  assert.equal(decodeEntities("Cutover &ndash; Migration"), "Cutover &ndash; Migration");
  assert.equal(decodeEntities("A&amp;B &uuml;ber"), "A&B über");
  assert.equal(decodeEntities("&#8211;"), "–");
});

test("durationBetween and timeToMinutes", () => {
  assert.equal(timeToMinutes("08:00"), 480);
  assert.equal(timeToMinutes("8:00"), 480);
  assert.equal(timeToMinutes("25:00"), null);
  assert.equal(durationBetween("08:00", "12:00"), "04:00");
  assert.equal(durationBetween("13:00", "17:00"), "04:00");
  assert.equal(durationBetween("08:00", "08:15"), "00:15");
  assert.equal(durationBetween("12:00", "08:00"), null);
  assert.equal(durationBetween("bogus", "08:00"), null);
});

// ------------------------------------------------------------------- week table

const WEEK_FIXTURE = `
<table class="table table-striped">
  <thead>
    <tr><th>Tag</th><th></th><th>von</th><th>bis</th><th>Dauer</th><th></th><th>Projekt</th><th>Vorgang</th><th>T&auml;t.</th><th></th><th>Bemerkung</th></tr>
  </thead>
  <tbody>
    <tr class="tag_18 zukunft">
      <td><span>Fr 18.09.</span> <a href="javascript:void(0)" onclick="preventDblClick(this, function() { openMahlzeiten(this, '2026-09-18') }, 500); return false;"><i>restaurant</i></a></td>
      <td></td>
    </tr>
    <tr class="tag_17 today pzminuszeit">
      <td><span>Do 17.09.</span> <a href="javascript:void(0)" onclick="preventDblClick(this, function() { openMahlzeiten(this, '2026-09-17') }, 500); return false;"><i>restaurant</i></a></td>
      <td></td>
    </tr>
    <tr class="tag_16">
      <td><span>Mi 16.09.</span> <a href="javascript:void(0)" onclick="preventDblClick(this, function() { openMahlzeiten(this, '2026-09-16') }, 500); return false;"><i>restaurant</i></a></td>
      <td></td>
    </tr>
    <tr class="zeile">
      <td><a href="javascript:void(0)" onclick="preventDblClick(this, function() { openPopup('ajax.php?CLIENTSESSID=x&amp;pageContextId=Projektzeiten&amp;mgr=ProjektzeitMgr&amp;mgrId=0_0&amp;action=update&amp;objectId=163533', {}) }, 500); return false;">edit</a><a href="javascript:void(0)" onclick="preventDblClick(this, function() { zepAjaxrequest_sendConfirmedDeleteGetRequest('wirklich?', 'ajax.php?CLIENTSESSID=x&amp;pageContextId=Projektzeiten&amp;mgr=ProjektzeitMgr&amp;mgrId=0&amp;action=delete&amp;userId=patrick.weppelmann&amp;objectId=163533&amp;kwDate=2026-09-16', null, null) }, 500); return false;">delete</a></td>
      <td>13:00</td>
      <td>17:00</td>
      <td>4,00</td>
      <td><i>arrow_top_right</i></td>
      <td>K-10000-00001 (Contoso - Integration Warehouse Automation&trade; in SAP S/4 Cloud Public Edition)</td>
      <td>70 (AP7 &ndash; Cutover und Migration)</td>
      <td>co</td>
      <td>payments</td>
      <td>4711 Beispiel-Ticket, 4712 Beispiel-Ticket</td>
    </tr>
    <tr class="zeile">
      <td><a href="javascript:void(0)" onclick="preventDblClick(this, function() { openPopup('ajax.php?objectId=163532', {}) }, 500); return false;">edit</a></td>
      <td>08:00</td>
      <td>12:00</td>
      <td>4,00</td>
      <td></td>
      <td>K-10000-00001 (Contoso)</td>
      <td>70 (AP7 &ndash; Cutover und Migration)</td>
      <td>co</td>
      <td>payments</td>
      <td>4713 Beispiel-Export</td>
    </tr>
    <tr class="summe">
      <td>Summe</td>
      <td>8,00</td>
      <td>payments 8,00</td>
    </tr>
  </tbody>
</table>`;

test("parseWeek groups bookings under their day and reads the sum", () => {
  const week = parseWeek(WEEK_FIXTURE, "2026-09-14");
  assert.equal(week.kwDate, "2026-09-14");
  assert.equal(week.days.length, 3);

  const friday = week.days[0]!;
  assert.match(friday.dayLabel, /^Fr 18\.09\./);
  assert.equal(friday.date, "2026-09-18");
  assert.equal(friday.bookings.length, 0);
  assert.equal(friday.future, true);
  assert.equal(friday.empty, true);

  const thursday = week.days[1]!;
  assert.equal(thursday.date, "2026-09-17");
  assert.equal(thursday.underBooked, true);
  assert.equal(thursday.today, true);

  const wednesday = week.days[2]!;
  assert.equal(wednesday.date, "2026-09-16");
  assert.equal(wednesday.bookings.length, 2);
  assert.equal(wednesday.total, "8,00");
  assert.equal(wednesday.billableTotal, "8,00");
  assert.equal(wednesday.bookings[0]!.objectId, "163533");
  assert.equal(wednesday.bookings[0]!.from, "13:00");
  assert.equal(wednesday.bookings[0]!.to, "17:00");
  assert.equal(wednesday.bookings[0]!.duration, "4,00");
  assert.equal(wednesday.bookings[0]!.taetigkeit, "co");
  assert.equal(wednesday.bookings[0]!.billable, true);
  assert.match(wednesday.bookings[0]!.comment, /4711 Beispiel-Ticket/);
  // HTML in the comment must not leak through as markup
  assert.doesNotMatch(wednesday.bookings[1]!.comment, /</);
});

test("parseWeek on an empty table yields no days instead of throwing", () => {
  const week = parseWeek("<table></table>", "2026-09-21");
  assert.equal(week.days.length, 0);
});
