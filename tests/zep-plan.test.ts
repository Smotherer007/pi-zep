/**
 * Einplanung parsing and formatting.
 *
 * The fixture is a trimmed live capture (see tests/fixtures/plan-snippet.ts):
 * ZEP renders the capacity plan as an ApexCharts options object inside an ajax
 * schnipsel, JavaScript formatter functions included, so the parser cannot
 * simply JSON.parse it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { PLAN_CHART_SNIPPET } from "./fixtures/plan-snippet.ts";
import { extractChartOptions, parsePlan } from "../src/clients/zep-parse.ts";
import { formatPlan } from "../src/formatting/formatters.ts";

test("extractChartOptions turns the options object into data despite its JS formatters", () => {
  const options = extractChartOptions(PLAN_CHART_SNIPPET);
  assert.ok(options, "the options object must be found");
  assert.equal(options.title, "Patrick Weppelmann");
  assert.equal(options.subtitle, "17.09.2026-17.10.2026");
  assert.deepEqual(options.categories, ["Heute", "Morgen", "19.09.", "20.09."]);
  assert.equal(options.series.length, 5);
  assert.equal(options.series[0]!.name, "Verfügbarkeit [19,20 h]");
  assert.deepEqual(options.series[0]!.data, [6.4, 6.4, 0, 6.4]);
});

test("parsePlan splits the series into availability, projects and the daily total", () => {
  const plan = parsePlan(PLAN_CHART_SNIPPET, "2026-09-17", "2026-09-20");
  assert.ok(plan, "the chart must parse");

  assert.equal(plan.title, "Patrick Weppelmann");
  assert.equal(plan.range, "17.09.2026-17.10.2026");
  assert.equal(plan.capacity, 19.2, "6,40 h on the three working days, 0 on the weekend");
  assert.equal(plan.planned, 23.2);
  assert.equal(plan.days.length, 4);

  const [today, tomorrow, saturday] = plan.days;
  assert.equal(today!.date, "2026-09-17", "dates are derived from the requested range");
  assert.equal(today!.label, "Heute", "the label ZEP prints is kept");
  assert.equal(today!.available, 6.4);
  assert.equal(today!.planned, 12.8);
  assert.deepEqual(
    today!.slices.map((slice) => [slice.project, slice.hours]),
    [
      ["K-10000-00002 (Example Corp - Extensions 2026)", 8],
      ["K-10000-00003 (Example Corp - Improvements Q3/Q4 2026)", 3.2],
      ["K-10000-00001 (Contoso - Integration Warehouse Automation in SAP S/4 Cloud Public Edition)", 1.6],
    ],
    "slices come largest first and drop the [x,xx h] suffix",
  );

  assert.equal(tomorrow!.planned, 7.2);
  assert.equal(saturday!.planned, 0);
  assert.deepEqual(saturday!.slices, []);

  assert.deepEqual(
    plan.projects.map((project) => [project.project, project.hours]),
    [
      ["K-10000-00002 (Example Corp - Extensions 2026)", 12],
      ["K-10000-00003 (Example Corp - Improvements Q3/Q4 2026)", 9.6],
      ["K-10000-00001 (Contoso - Integration Warehouse Automation in SAP S/4 Cloud Public Edition)", 1.6],
    ],
    "project totals come from the series name (ZEP's own number)",
  );
});

test("parsePlan returns null instead of throwing on markup without a chart", () => {
  assert.equal(parsePlan("<div>kein Diagramm</div>", "2026-09-17", "2026-09-20"), null);
  assert.equal(parsePlan("var optionschart1 = null;", "2026-09-17", "2026-09-20"), null);
});

test("formatPlan prints the day lines, the utilization and the project totals", () => {
  const plan = parsePlan(PLAN_CHART_SNIPPET, "2026-09-17", "2026-09-20")!;
  const text = formatPlan(plan);

  assert.match(text, /^Einplanung Patrick Weppelmann {2}\(17\.09\.2026-17\.10\.2026\)$/m);
  assert.match(text, /Kapazität 19,20 h \| geplant 23,20 h \| Auslastung 121 %/);
  assert.match(text, /^Do 17\.09\. {2}12,80 \/ 6,40 h {2}K-10000-00002 .*8,00 \| /m);
  assert.doesNotMatch(text, /^Sa 19\.09\./m, "days without a plan are not listed");
  assert.match(text, /Planstunden je Projekt:/);
  assert.match(text, / {2}12,00 h {2}K-10000-00002/);
  // 12,80 h and 7,20 h on a 6,40 h day are over-booked
  assert.match(text, /2 Tag\(e\) überbucht/);
});
