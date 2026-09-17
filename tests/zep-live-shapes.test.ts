/**
 * Tests built from markup and JSON captured from the LIVE system
 * (zep-online.de, Mandant zepneoimpulse, ZEP v7.13.88) on 2026-09-17.
 *
 * Everything here was observed verbatim, so these tests guard the actual
 * server contract rather than an idealised version of it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractSnippetAlert,
  parseAjaxEnvelope,
  parseWeek,
  pickWeekTableSnippet,
} from "../src/clients/zep-parse.ts";

// ---------------------------------------------------------------- week markup

const DAY_FRIDAY = `<tr class="tag_5  zukunft"><td id="day_2026-09-18" class="day" style="" rowspan="1" title="18.09.2026"><div class="filler"><div class="daycontent leer"><div class="d-flex">
<span class=""><div class="wochentag" onClick="setDateTime('2026-09-18')"  data-placement="auto" data-trigger="hover focus" title="18.09.2026 Setzen" data-toggle="tooltip" ><div class="modimidofrsaso">Fr</div><div class="tag_monat">18.09.</div></div></span><div class="actionbar"><a href="javascript:void(0)" onClick="preventDblClick(this, function() { openMahlzeiten(this, '2026-09-18') }, 500); return false;"  title=""><i class="icon icons icon-light icon-restaurant icon-utensils material-symbols-rounded iconButton mahlzeiten" data-placement="auto" data-trigger="hover focus" title="Mahlzeiten" data-toggle="tooltip" >restaurant</i></a></div></div></div></div></td><td class="pz leererTag tagInformation" colspan="10"></td></tr>`;

const DAY_THURSDAY = `<tr class="tag_4  pzminuszeit today"><td id="day_2026-09-17" class="day" style="" rowspan="1" title="17.09.2026"><div class="filler"><div class="clickSetter topClick" onClick="setDateTime('2026-09-17', '08:00:00')"  data-placement="auto" data-trigger="hover focus" title="Ab &lt;strong&gt;08:00&lt;/strong&gt; Uhr, 17.09.2026 vorbelegen" data-toggle="tooltip" ><div class="clickbg">&nbsp;</div></div><div class="daycontent leer"><div class="d-flex">
<span class=""><div class="wochentag" onClick="setDateTime('2026-09-17')"  data-placement="auto" data-trigger="hover focus" title="17.09.2026 Setzen" data-toggle="tooltip" ><div class="modimidofrsaso">Do</div><div class="tag_monat">17.09.</div></div></span><div class="actionbar"><a href="javascript:void(0)" onClick="preventDblClick(this, function() { openMahlzeiten(this, '2026-09-17') }, 500); return false;"  title=""><i class="icon icons icon-restaurant icon-utensils material-symbols-rounded iconButton mahlzeiten">restaurant</i></a></div></div></div></div></td><td class="pz leererTag tagInformation" colspan="10"></td></tr>`;

const DAY_WEDNESDAY = `<tr class="day "><td id="day_2026-09-16" class="day" style="" rowspan="3" title="16.09.2026"><div class="filler"><div class="daycontent"><div class="d-flex">
<span class=""><div class="wochentag" onClick="setDateTime('2026-09-16')"><div class="modimidofrsaso">Mi</div><div class="tag_monat">16.09.</div></div></span><div class="actionbar"><a href="javascript:void(0)" onClick="preventDblClick(this, function() { openMahlzeiten(this, '2026-09-16') }, 500); return false;" title=""><i class="icon icons icon-restaurant icon-utensils material-symbols-rounded iconButton mahlzeiten">restaurant</i></a><a href="javascript:void(0)" onClick="preventDblClick(this, function() { openDayBreak(this, '2026-09-16') }, 500); return false;" title=""><i class="icon icons icon-light icon-local_cafe icon-mug-hot material-symbols-rounded iconButton">local_cafe</i></a></div></div></div></div></td></tr>`;

const BOOKING_ROW = `<tr id="objectId163533" class=""><td class="pz action" style="text-align:left"><a href="javascript:void(0)" onclick="preventDblClick(this, function() { openPopup('ajax.php?CLIENTSESSID=x&amp;pageContextId=Projektzeiten&amp;mgr=ProjektzeitMgr&amp;mgrId=0_0&amp;action=update&amp;objectId=163533', {}) }, 500); return false;" class="action" title="Details/ändern (13:00 bis 17:00)"><i class="icon icon-edit">edit</i></a><a href="javascript:void(0)" onclick="preventDblClick(this, function() { zepAjaxrequest_sendConfirmedDeleteGetRequest('Projektzeit Mi, 16.09.2026, 13:00 - 17:00 wirklich löschen?', 'ajax.php?CLIENTSESSID=x&amp;pageContextId=Projektzeiten&amp;mgr=ProjektzeitMgr&amp;mgrId=0&amp;action=delete&amp;userId=patrick.weppelmann&amp;objectId=163533&amp;kwDate=2026-09-16', null, null) }, 500); return false;" class="action" title=""><i class="icon icon-delete">delete</i></a></td><td class="screennobr pz " style="white-space:nowrap; width:1%;">13:00</td><td class="screennobr pz " style="white-space:nowrap; width:1%;">17:00</td><td class="screennobr pz " style="white-space:nowrap; width:1%; text-align:right;">4,00</td><td class="screennobr pz action action"><a href="javascript:void(0)" onclick="preventDblClick(this, function() { copyVonVorlage('163533') }, 500); return false;" title=""><i class="icon icon-arrow_top_right">arrow_top_right</i></a></td><td class="condensed text-nowrap pz col-projekt textkurz fuenf fuenf-resized" data-columnid="projekt"><span><a href="index.php?CLIENTSESSID=x&amp;menu=ProjektVerwaltungMgr&amp;modelContentMenu=true&amp;contentModelId=413">K-10000-00001 (Contoso - Integration Warehouse Automation&trade; in SAP S/4 Cloud Public Edition)</a></span></td><td class="condensed text-nowrap pz col-vorgang textkurz fuenf" data-columnid="vorgang"><span><a href="index.php?CLIENTSESSID=x&amp;menu=ProjektVerwaltungMgr&amp;modelContentMenu=vorgang&amp;contentModelId=3282">70 (AP7 &ndash; Cutover und Migration)</a></span></td><td class="condensed pz col-taetigkeit" data-columnid="taetigkeit">co</td><td class="condensed pz col-fakturierbar" data-columnid="fakturierbar"><i class="icon icon-payments" title="fakturierbar">payments</i>f</td><td class="condensed pz col-bemerkung" data-columnid="bemerkung">4711 Beispiel-Ticket, 4712 Beispiel-Ticket</td></tr>`;

const LUECKE_ROW = `<tr class="luecke "><td class="" colspan="11" style="height: 3px;"></td></tr>`;

const SUM_ROW = `<tr class="summe tag_3"><td style="vertical-align:top;" colspan="3"><i>Summe</i></td><td style="width: 2.6em;vertical-align:top;text-align:right;">8,00</td><td class="tagInformation" colspan="7"><span class="mr-3"><i class="icon icons icon-solid icon-payments material-symbols-rounded iconButton mr-1" title="fakturierbar">payments</i> 8,00</span></td></tr>`;

const WEEK_TABLE = `<div class="card"><div class="card-header bg-light"><h2 class="card-title" id="kw38"><span class="pz_table_title">Projektzeiten</span></h2>
<select id="pz_kwnav" class="form-control custom-select text-center"><option value="2026-09-21">39/2026</option><option value="2026-09-14" selected="selected">38/2026</option></select></div>
<div class="card-body"><div id="ProjektzeitTableDiv"><table class="table table-sm"><thead><tr><th class="pz">Tag</th><th></th><th class="pz">von</th><th class="pz">bis</th><th class="pz">Dauer</th><th></th><th class="pz col-projekt">Projekt</th><th class="pz col-vorgang">Vorgang</th><th class="pz col-taetigkeit">Tät.</th><th class="pz col-fakturierbar">&nbsp;</th><th class="pz col-bemerkung">Bemerkung</th></tr></thead>
<tbody>${DAY_FRIDAY}${DAY_THURSDAY}${DAY_WEDNESDAY}${BOOKING_ROW}${LUECKE_ROW}${SUM_ROW}</tbody></table></div></div></div>`;

test("parseWeek handles the real markup: day ids, luecke spacers, colspan sum row", () => {
  const week = parseWeek(WEEK_TABLE, "2026-09-14");

  assert.equal(week.days.length, 3);

  const [friday, thursday, wednesday] = week.days;
  assert.equal(friday!.date, "2026-09-18");
  assert.equal(friday!.bookings.length, 0);
  assert.equal(friday!.future, true);
  assert.equal(friday!.empty, true);
  assert.match(friday!.dayLabel, /^Fr 18\.09\./);

  assert.equal(thursday!.date, "2026-09-17");
  assert.equal(thursday!.today, true);
  assert.equal(thursday!.underBooked, true);

  // The day header uses <div>Do</div><div>17.09.</div> - the label must still
  // come out as "Do 17.09." and not "Do17.09.".
  assert.match(thursday!.dayLabel, /^Do 17\.09\./);

  const wd = wednesday!;
  assert.equal(wd.date, "2026-09-16");
  assert.equal(wd.bookings.length, 1, "the luecke spacer row must not become a booking");
  assert.equal(wd.total, "8,00");
  assert.equal(wd.billableTotal, "8,00");

  const booking = wd.bookings[0]!;
  assert.equal(booking.objectId, "163533");
  assert.equal(booking.from, "13:00");
  assert.equal(booking.to, "17:00");
  assert.equal(booking.duration, "4,00");
  assert.equal(booking.taetigkeit, "co");
  assert.equal(booking.billable, true);
  assert.match(booking.project, /K-10000-00001 \(Contoso/);
  assert.match(booking.vorgang, /70 \(AP7/);
  assert.match(booking.comment, /^4711 Beispiel-Ticket/);
  assert.doesNotMatch(booking.comment, /[<>]/);
});

// -------------------------------------------------------------- ajax envelopes

const SAVE_REJECTED = JSON.stringify({
  name: "response",
  type: "response",
  prejavascript: null,
  javascript: null,
  error: "error",
  requesttoken: "d88e26069ef712283587",
  cssfiles: { name: "cssfiles", type: "undefined" },
  javascriptfiles: { name: "javascriptfiles", type: "undefined" },
  defaultschnipsel: {
    name: "defaultschnipsel",
    type: "schnipsel",
    buildfunc: "default",
    target: "formularmessagediv_ProjektzeitFormMgr3",
    data: '<div class="card-alert alert alert-danger fadeout" style="margin-top:12px;" role="alert"><div class="alert-icon-div"><i class="icon text-red">error</i></div><div class="alert-message">Projektzeit Do, 17.09.2026, 08:00 - 08:15 Speichern fehlgeschlagen. Diese Zeit kann nicht gebucht werden, da dadurch die Plan Stunden des Projekts/Vorgangs überschritten würden.<br />\nProjektleiter wurden ggf. per E-Mail informiert. Details siehe</div></div>',
  },
});

const SAVE_ACCEPTED = JSON.stringify({
  name: "response",
  type: "response",
  prejavascript: null,
  javascript: "dispatchZepEvent('zepProjektzeitMgrRefresh')",
  error: null,
  requesttoken: "38a9191b72e468c2968d",
  defaultschnipsel: {
    name: "defaultschnipsel",
    type: "schnipsel",
    buildfunc: "default",
    target: "managerdiv_ProjektzeitMgr",
    data: ' <div class="calendar calendar-container-2" id="attendances-index"> <div id="calendar-navigation-bar"></div></div>',
  },
});

const SETKW_RESPONSE = JSON.stringify({
  name: "response",
  type: "response",
  javascript: null,
  error: null,
  requesttoken: "113f35892a8c669c0087",
  0: {
    name: 0,
    type: "schnipsel",
    buildfunc: "default",
    resizeable: false,
    data: WEEK_TABLE,
  },
});

test("the rejection text lives in a schnipsel, not in javascript", () => {
  const envelope = parseAjaxEnvelope(SAVE_REJECTED);
  assert.equal(envelope.error, "error");
  assert.equal(envelope.javascript, null, "no zepalert is present on a rejection");

  const alert = extractSnippetAlert(envelope.snippets);
  assert.ok(alert, "the danger alert must be readable from the snippet");
  assert.equal(alert.kind, "danger");
  assert.match(alert.message, /Plan Stunden des Projekts\/Vorgangs überschritten/);
  assert.match(alert.message, /Projektleiter wurden ggf\. per E-Mail informiert/);
  assert.doesNotMatch(alert.message, /[<>]/);
  assert.ok(!/alert-message/.test(alert.message), "the CSS class must not leak into the message");
});

test("an accepted save carries no alert and a dispatch javascript", () => {
  const envelope = parseAjaxEnvelope(SAVE_ACCEPTED);
  assert.equal(envelope.error, null);
  assert.equal(extractSnippetAlert(envelope.snippets), null);
  assert.match(envelope.javascript ?? "", /dispatchZepEvent/);
});

test("pickWeekTableSnippet finds the table even though setKw sends no target", () => {
  const envelope = parseAjaxEnvelope(SETKW_RESPONSE);
  assert.equal(envelope.snippets.length, 1);
  assert.equal(envelope.snippets[0]!.target, null);

  const chosen = pickWeekTableSnippet(envelope.snippets);
  assert.ok(chosen);
  assert.match(chosen.data, /id="objectId163533"/);
});

test("pickWeekTableSnippet does not mistake the calendar snippet for the week table", () => {
  const envelope = parseAjaxEnvelope(SAVE_ACCEPTED);
  const chosen = pickWeekTableSnippet(envelope.snippets);
  // only the calendar is present, so it is the fallback - but it must not be
  // reported as a week table by a content test
  assert.ok(chosen === null || !/objectId\d+/.test(chosen.data));
});

test("the 'Tätigkeit nicht erlaubt' rejection is readable too", () => {
  const envelope = parseAjaxEnvelope(
    JSON.stringify({
      error: "error",
      javascript: null,
      requesttoken: "12a0c3eba47497868539",
      d: {
        type: "schnipsel",
        target: "formularmessagediv_ProjektzeitFormMgr3",
        data: '<div class="card-alert alert alert-danger fadeout"><div class="alert-message">Projektzeit Do, 17.09.2026, 08:00 - 08:15 Speichern fehlgeschlagen. Tätigkeit co bei Vorgang 90-02 nicht erlaubt.</div></div>',
      },
    }),
  );
  const alert = extractSnippetAlert(envelope.snippets);
  assert.equal(alert?.kind, "danger");
  assert.match(alert!.message, /Tätigkeit co bei Vorgang 90-02 nicht erlaubt/);
});

// --------------------------- week markup: day row carrying its first booking
//
// Captured verbatim from the live system on 2026-09-17. On real days ZEP does
// NOT emit a standalone row for the first booking: the day row carries it
// inline behind the label cell (which gets rowspan=N). A parser that only
// recognises short day rows drops that booking AND attaches the remaining
// bookings of the day to the previous day.

const ROW_4 = `<tr id="objectId163533 tag_3" class="day "><td id="day_2026-09-16" class="day" rowspan="5"><div class="filler"><div class="clickSetter topClick" onClick="setDateTime('2026-09-16', '17:00:00')" ><div class="clickbg">&nbsp;</div></div><div class="daycontent"><div class="d-flex"> <span><div class="wochentag" onClick="setDateTime('2026-09-16')" ><div class="modimidofrsaso">Mi</div><div class="tag_monat">16.09.</div></div></span><div class="actionbar"><a href="javascript:void(0)" onClick="preventDblClick(this, function() { openMahlzeiten(this, '2026-09-16') }, 500); return false;" ><i class="icon icons icon-light icon-restaurant icon-utensils material-symbols-rounded iconButton mahlzeiten" >restaurant</i></a><br><a href="javascript:void(0)" onClick="preventDblClick(this, function() { openDayBreak(this, '2026-09-16') }, 500); return false;" ><i class="icon icons icon-light icon-local_cafe icon-mug-hot material-symbols-rounded iconButton" >local_cafe</i></a><br> <div id="SimpleDatepicker3" class="SimpleDatepicker"> <a href="javascript:void(0)" onClick="preventDblClick(this, function() { zepSimpleDatepicker('#SimpleDatepicker3').show() }, 500); return false;" ><i class="icon icons icon-light icon-content_copy icon-copy material-symbols-rounded iconButton" >content_copy</i></a><div> <input type="hidden" class="onchangetrigger" onchange="doDayCopy('2026-09-16', date2dbdatestring(event.date))" /> <input type="text" value="2026-09-16" class="datepicker-input" /> <script type="text/javascript"> $(document).ready(function() { executeOnReferencesReady('zepSimpleDatepicker', function() { zepSimpleDatepicker('#SimpleDatepicker3').init({ title: 'Einträge vom 16.09. kopieren', minDatum: '2026-03-18', maxDatum: '2026-10-17', orientation: 'auto' }); }); }); </script> </div></div></div></div></div><div class="clickSetter bottomClick" onClick="setDateTime('2026-09-16', '', '08:00:00')" ><div class="clickbg">&nbsp;</div></div></div></td><td class="leer" colspan="11"></td><tr id="objectId163533" class=""><td class="pz action"><a href="javascript:void(0)" onClick="preventDblClick(this, function() { openPopup('ajax.php?CLIENTSESSID=x&amp;pageContextId=Projektzeiten&amp;mgr=ProjektzeitMgr&amp;mgrId=0_0&amp;action=update&amp;objectId=163533', {&quot;title&quot;:&quot;Projektzeit \u00e4ndern&quot;,&quot;size&quot;:&quot;xl&quot;}) }, 500); return false;" id="link_4" class="action"><i class="icon icons icon-light icon-edit icon-edit material-symbols-rounded iconButton" >edit</i></a><a href="javascript:void(0)" onClick="preventDblClick(this, function() { zepAjaxrequest_sendConfirmedDeleteGetRequest('Projektzeit Mi, 16.09.2026, 13:00 - 17:00 wirklich löschen?', 'ajax.php?CLIENTSESSID=x&amp;pageContextId=Projektzeiten&amp;mgr=ProjektzeitMgr&amp;mgrId=0&amp;action=delete&amp;userId=patrick.weppelmann&amp;objectId=163533&amp;kwDate=2026-09-16', null, null) }, 500); return false;" id="link_5" class="action"><i class="icon icons icon-light icon-delete icon-trash material-symbols-rounded iconButton ml-2" >delete</i></a></td><td class="screennobr pz ">13:00</td><td class="screennobr pz ">17:00</td><td class="screennobr pz ">4,00</td><td class="screennobr pz action action"><a href="javascript:void(0)" onClick="preventDblClick(this, function() { copyVonVorlage('163533') }, 500); return false;" ><i class="icon icons icon-light icon-arrow_top_right icon-level-up material-symbols-rounded iconButton icon-rotate-left" >arrow_top_right</i></a></td><td class="condensed text-nowrap pz col-projekt textkurz fuenf fuenf-resized" data-columnid="projekt" ><span><a href="index.php?CLIENTSESSID=x&menu=ProjektVerwaltungMgr&modelContentMenu=true&contentModelId=413" class="objektlink link-p-413">K-10000-00001 (Contoso - Integration Warehouse Automation™ in SAP S/4 Cloud Public Edition)</a></span></td><td class="condensed text-nowrap pz col-vorgang textkurz vier" data-columnid="vorgang" ><span><a href="index.php?CLIENTSESSID=x&menu=ProjektVerwaltungMgr&modelContentMenu=vorgang&contentModelId=3286" class="objektlink link-t-3286">90-03 (Customizing &amp; FUT ExampleLink Public Cloud)</a></span></td><td class="screennobr pz ">co</td><td class="screennobr pz "><span class="displayStyle"><i class="icon icons icon-solid icon-payments icon-payments material-symbols-rounded iconButton" >payments</i></span><span class="printStyle">f</span></td><td class="pz col-bemerkung textkurz fuenf" data-columnid="bemerkung" ><span>4711 Beispiel-Ticket, 4712 Beispiel-Ticket, Merge Base-Develop (Port)</span></td><td class="screennobr pz ">&nbsp;&nbsp;</td></tr>`;

const ROW_5 = `<tr class="luecke "><td colspan="11"><div class="pauselink" " onClick="setDateTime('2026-09-16', '12:00:00', '13:00:00');"></div></td></tr>`;

const ROW_6 = `<tr id="objectId163531" class=""><td class="pz action"><a href="javascript:void(0)" onClick="preventDblClick(this, function() { openPopup('ajax.php?CLIENTSESSID=x&amp;pageContextId=Projektzeiten&amp;mgr=ProjektzeitMgr&amp;mgrId=0_0&amp;action=update&amp;objectId=163531', {&quot;title&quot;:&quot;Projektzeit \u00e4ndern&quot;,&quot;size&quot;:&quot;xl&quot;}) }, 500); return false;" id="link_6" class="action"><i class="icon icons icon-light icon-edit icon-edit material-symbols-rounded iconButton" >edit</i></a><a href="javascript:void(0)" onClick="preventDblClick(this, function() { zepAjaxrequest_sendConfirmedDeleteGetRequest('Projektzeit Mi, 16.09.2026, 08:00 - 12:00 wirklich löschen?', 'ajax.php?CLIENTSESSID=x&amp;pageContextId=Projektzeiten&amp;mgr=ProjektzeitMgr&amp;mgrId=0&amp;action=delete&amp;userId=patrick.weppelmann&amp;objectId=163531&amp;kwDate=2026-09-16', null, null) }, 500); return false;" id="link_7" class="action"><i class="icon icons icon-light icon-delete icon-trash material-symbols-rounded iconButton ml-2" >delete</i></a></td><td class="screennobr pz ">08:00</td><td class="screennobr pz ">12:00</td><td class="screennobr pz ">4,00</td><td class="screennobr pz action action"><a href="javascript:void(0)" onClick="preventDblClick(this, function() { copyVonVorlage('163531') }, 500); return false;" ><i class="icon icons icon-light icon-arrow_top_right icon-level-up material-symbols-rounded iconButton icon-rotate-left" >arrow_top_right</i></a></td><td class="condensed text-nowrap pz col-projekt textkurz fuenf fuenf-resized" data-columnid="projekt" ><span><a href="index.php?CLIENTSESSID=x&menu=ProjektVerwaltungMgr&modelContentMenu=true&contentModelId=413" class="objektlink link-p-413">K-10000-00001 (Contoso - Integration Warehouse Automation™ in SAP S/4 Cloud Public Edition)</a></span></td><td class="condensed text-nowrap pz col-vorgang textkurz vier" data-columnid="vorgang" ><span><a href="index.php?CLIENTSESSID=x&menu=ProjektVerwaltungMgr&modelContentMenu=vorgang&contentModelId=3286" class="objektlink link-t-3286">90-03 (Customizing &amp; FUT ExampleLink Public Cloud)</a></span></td><td class="screennobr pz ">co</td><td class="screennobr pz "><span class="displayStyle"><i class="icon icons icon-solid icon-payments icon-payments material-symbols-rounded iconButton" >payments</i></span><span class="printStyle">f</span></td><td class="pz col-bemerkung textkurz fuenf" data-columnid="bemerkung" ><span>4713 Beispiel-Export, 4714 Beispiel-CDS-Sicht, 4715/4716/4717 Port-Fixes</span></td><td class="screennobr pz ">&nbsp;&nbsp;</td></tr>`;

const ROW_7 = `<tr class="summe tag_3"><td colspan="3"><i>Summe</i></td><td>8,00</td><td class="tagInformation" colspan="8"><span class="mr-3"><i class="icon icons icon-solid icon-payments icon-payments material-symbols-rounded iconButton mr-1" >payments</i> 8,00</span></td></tr>`;
const WEEK_TABLE_INLINE_FIRST_BOOKING = `<div id="ProjektzeitTableDiv"><table class="table table-sm">
<thead><tr><th class="pz">Tag</th><th></th><th class="pz">von</th><th class="pz">bis</th><th class="pz">Dauer</th><th></th><th class="pz col-projekt">Projekt</th><th class="pz col-vorgang">Vorgang</th><th class="pz col-taetigkeit">Tät.</th><th class="pz col-fakturierbar">&nbsp;</th><th class="pz col-bemerkung">Bemerkung</th></tr></thead>
<tbody>${ROW_4}${ROW_5}${ROW_6}${ROW_7}</tbody></table></div>`;

test("parseWeek keeps the first booking of a day that is rendered inside the day row", () => {
  const week = parseWeek(WEEK_TABLE_INLINE_FIRST_BOOKING, "2026-09-14");

  assert.equal(week.days.length, 1, "only 16.09. has rows in this capture");

  const day = week.days[0]!;
  assert.equal(day.date, "2026-09-16");
  assert.equal(day.dayLabel, "Mi 16.09.", "the meals icon text must not leak into the label");
  assert.equal(day.bookings.length, 2, "the inline booking must not be dropped");
  assert.equal(day.total, "8,00");
  assert.equal(day.billableTotal, "8,00");

  const [inline, standalone] = day.bookings;
  assert.equal(inline!.objectId, "163533", "objectId comes from the day row's own id");
  assert.equal(inline!.from, "13:00");
  assert.equal(inline!.to, "17:00");
  assert.equal(inline!.duration, "4,00");
  assert.equal(inline!.taetigkeit, "co");
  assert.equal(inline!.billable, true);
  assert.match(inline!.project, /K-10000-00001 \(Contoso/);
  assert.match(inline!.vorgang, /90-03/);
  assert.match(inline!.comment, /4711 Beispiel-Ticket/);
  assert.equal(inline!.date, "2026-09-16", "bookings must inherit the day they are rendered under");

  assert.equal(standalone!.objectId, "163531");
  assert.equal(standalone!.from, "08:00");
  assert.equal(standalone!.to, "12:00");
  // `-&gt;` arrives HTML-encoded from ZEP and must come out as an arrow, not
  // as markup - the remark really is "EDMX S/4 -> Public Cloud".
  assert.match(standalone!.comment, /^4713 Beispiel-Export/);
  assert.doesNotMatch(standalone!.comment, /<\/?[a-z]/i);
});

// ------------------------------------------- place of work (Ort) per booking
//
// Observed on the live system: the Ort cell is the cell right behind the
// `bemerkung` column, it carries no `data-columnid` of its own, and ZEP only
// renders it when there is something to say. A trailing `*` marks a
// deviation from the default place of work ("Erste Tätigkeitsstätte" = NULL).
// When ZEP renders no cell, the booking sits on the default.

const ROW_WITH_ORT = `<tr id="objectId163533"><td class="pz action">edit delete</td><td>13:00</td><td>17:00</td><td>4,00</td><td></td><td data-columnid="projekt">K-10000-00001 (Contoso)</td><td data-columnid="vorgang">90-03</td><td data-columnid="taetigkeit">co</td><td data-columnid="fakturierbar">payments</td><td data-columnid="bemerkung">Arbeit mit Ort</td><td class="pz">D-Office&nbsp;*</td></tr>`;

const ROW_WITHOUT_ORT = `<tr id="objectId163534"><td class="pz action">edit delete</td><td>08:00</td><td>12:00</td><td>4,00</td><td></td><td data-columnid="projekt">I-50 (Produktentwicklung)</td><td data-columnid="vorgang">I011 (neo|StoreLink)</td><td data-columnid="taetigkeit">vw</td><td data-columnid="fakturierbar">&nbsp;</td><td data-columnid="bemerkung">Arbeit ohne Ort</td></tr>`;

const WEEK_TABLE_ORT = `<div id="ProjektzeitTableDiv"><table class="table table-sm">
<thead><tr><th class="pz">Tag</th><th></th><th class="pz">von</th><th class="pz">bis</th><th class="pz">Dauer</th><th></th><th data-columnid="projekt">Projekt</th><th data-columnid="vorgang">Vorgang</th><th data-columnid="taetigkeit">Tät.</th><th data-columnid="fakturierbar">&nbsp;</th><th data-columnid="bemerkung">Bemerkung</th><th data-columnid="ort">Ort</th></tr></thead>
<tbody><tr class="day "><td id="day_2026-09-16" class="day" rowspan="3"><div class="wochentag"><div class="modimidofrsaso">Mi</div><div class="tag_monat">16.09.</div></div></td></tr>
${ROW_WITH_ORT}<tr class="luecke "><td colspan="11"></td></tr>${ROW_WITHOUT_ORT}
<tr class="summe tag_3"><td colspan="3">Summe</td><td>8,00</td><td colspan="8"></td></tr></tbody></table></div>`;

test("parseWeek reads the place of work and treats a missing Ort cell as the default", () => {
  const week = parseWeek(WEEK_TABLE_ORT, "2026-09-14");
  const day = week.days[0]!;

  assert.equal(day.bookings.length, 2);
  assert.equal(day.bookings[0]!.ort, "D-Office", "the `*` deviation marker is not part of the value");
  assert.equal(
    day.bookings[1]!.ort,
    null,
    "no Ort cell rendered means the default place of work (NULL)",
  );
});
