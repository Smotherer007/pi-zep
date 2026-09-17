/**
 * Live smoke check against the real ZEP server.
 *
 *   node scripts/live-check.ts [--profile work] [--write]
 *
 * Reads the profile from ~/.pi/zep-config.json (create it with zep_setup),
 * logs in, and exercises the read paths.
 *
 * With --write it additionally creates and immediately deletes one 15-minute
 * booking on the given date, to prove the write path end to end. Only use it
 * on a day you are allowed to write to (--date, default: today).
 *
 *   node scripts/live-check.ts work --write --date 2026-09-17 --projekt 16
 */

import { loadConfig, getActiveProfileName, getProfile, saveSession } from "../src/config.ts";
import { ZepClient } from "../src/clients/zep-client.ts";
import { durationBetween, mondayOf } from "../src/clients/zep-parse.ts";
import { formatFormData, formatPlan, formatWeek } from "../src/formatting/formatters.ts";
import { addDays } from "../src/tools/shared.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const profileName = value("profile");

const doWrite = flag("write");
const date = value("date") ?? new Date().toISOString().slice(0, 10);
const projektRef = value("projekt");
const vorgangRef = value("vorgang");
const taetigkeit = value("taetigkeit") ?? "vw";

loadConfig();
const name = profileName ?? getActiveProfileName();
if (!name) {
  console.error("No ZEP profile configured. Run zep_setup first, or pass a profile name.");
  process.exit(2);
}

const account = getProfile(name);
console.log(`profile "${name}" -> ${account.baseUrl}/${account.mandant} as ${account.userid}\n`);

const client = new ZepClient(account, {
  onSession: (s) => {
    saveSession(name, s);
    console.log(`[session] ${s.clientsessid} cookies=${Object.keys(s.cookies).join(",")}`);
  },
});

const started = Date.now();
const login = await client.login();
console.log(`login: ${login.ok ? "OK" : "FAILED"} (${Date.now() - started} ms)`);
if (!login.ok) {
  console.error(`  ${login.message}`);
  if (login.attemptsLeft !== undefined) {
    console.error(`  ${login.attemptsLeft} password attempt(s) left before the account is locked.`);
  }
  process.exit(1);
}
console.log(`  CLIENTSESSID=${client.sessionId} token=${client.token}\n`);

console.log("=== week ===");
console.log(formatWeek(await client.week(mondayOf(new Date(`${date}T12:00:00Z`)))));

const { form } = await client.loadForm();
console.log("\n=== form ===");
console.log(formatFormData(form));

console.log("\n=== Einplanung (capacity planning) ===");
console.log(formatPlan(await client.plan({ from: date, to: addDays(date, 30) })));

if (!doWrite) {
  console.log("\n(read-only run; pass --write to also exercise a booking + delete)");
  process.exit(0);
}

const projektId = projektRef ?? form.selected.projektId;
const vorgangId = vorgangRef ?? form.selected.vorgangId;
if (!projektId || !vorgangId) {
  console.error("\n--write needs a resolvable projekt and vorgang");
  process.exit(1);
}

console.log(`\n=== write test on ${date} ===`);
console.log(`projekt=${projektId} vorgang=${vorgangId} taetigkeit=${taetigkeit}`);

const request = {
  date,
  from: "08:00",
  to: "08:15",
  duration: durationBetween("08:00", "08:15")!,
  projektId,
  vorgangId,
  taetigkeit,
  comment: "API-Test (pi) - bitte ignorieren",
};

const saved = await client.book(request);
console.log(saved.ok ? `save: OK (${saved.message})` : `save: REJECTED - ${saved.error}`);
if (!saved.ok) process.exit(1);

const kwDate = mondayOf(new Date(`${date}T12:00:00Z`));
const afterSave = await client.week(kwDate);
const day = afterSave.days.find((d) => d.date === date);
const created = day?.bookings.find((b) => b.comment.includes("API-Test (pi)"));
console.log(created ? `verify: found row #${created.objectId}` : "verify: NOT FOUND in the week table");
if (!created?.objectId) process.exit(1);

const removed = await client.remove(created.objectId, kwDate);
console.log(removed.ok ? `delete: OK` : `delete: FAILED - ${removed.error}`);

const afterDelete = await client.week(kwDate);
const dayAfter = afterDelete.days.find((d) => d.date === date);
const stillThere = dayAfter?.bookings.some((b) => b.comment.includes("API-Test (pi)"));
console.log(`verify: booking ${stillThere ? "STILL PRESENT" : "removed"}`);
if (stillThere) process.exit(1);

// --- capacity planning: create a 1 h plan entry, verify it, clear it again
console.log("\n=== Einplanung write test ===");
const planDate = value("plan-date") ?? addDays(date, value("plan-offset") ? Number(value("plan-offset")) : 60);
console.log(`plan cell: projekt ${projektId} on ${planDate}`);

const planned = await client.savePlan({
  entries: [{ projektId, date: planDate, value: 1, unit: "h" }],
});
console.log(planned.ok ? `plan save: OK (${planned.message})` : `plan save: REJECTED - ${planned.error}`);
if (!planned.ok) process.exit(1);

// The plan is per project, so the check must look at that project's slice -
// other projects may well be planned on the same day.
const projektLabel = form.projects.find((option) => option.id === projektId)?.label;
const hasOurCell = (day: { slices: ReadonlyArray<{ project: string; hours: number }> } | undefined) =>
  day?.slices.some((slice) => slice.hours === 1 && (projektLabel ? slice.project === projektLabel : true)) ??
  false;

const planAfterSave = await client.plan({ from: planDate, to: planDate });
const createdCell = hasOurCell(planAfterSave.days[0]);
console.log(createdCell ? `verify: 1,00 h planned on ${planDate}` : "verify: NOT FOUND in the plan");
if (!createdCell) process.exit(1);

const cleared = await client.savePlan({
  entries: [{ projektId, date: planDate, value: null, unit: "h" }],
});
console.log(cleared.ok ? "plan clear: OK" : `plan clear: FAILED - ${cleared.error}`);

const planAfterClear = await client.plan({ from: planDate, to: planDate });
const stillPlanned = hasOurCell(planAfterClear.days[0]);
console.log(`verify: plan cell ${stillPlanned ? "STILL PRESENT" : "cleared"}`);
process.exit(stillPlanned ? 1 : 0);
