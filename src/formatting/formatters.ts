/**
 * Pure functions that turn ZEP domain data into text for the model/user.
 */

import type { ZepFormData, ZepPlan, ZepPlanEntry, ZepSaveResult, ZepWeek } from "../types.ts";

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

export function formatFormData(form: ZepFormData, heading = "Projekte"): string {
  const lines: string[] = [];
  lines.push(`${heading} (${form.projects.length}):`);
  for (const project of form.projects) {
    const marker = project.id === form.selected.projektId ? "*" : " ";
    lines.push(` ${marker} ${project.id.padStart(4)}  ${project.label}`);
  }

  lines.push("");
  lines.push(
    form.selected.projektId
      ? `Vorgänge of project ${form.selected.projektId} (${form.vorgaenge.length}):`
      : `Vorgänge (${form.vorgaenge.length}):`,
  );
  for (const vorgang of form.vorgaenge) {
    const marker = vorgang.id === form.selected.vorgangId ? "*" : " ";
    lines.push(` ${marker} ${vorgang.id.padStart(5)}  ${vorgang.label}`);
  }

  lines.push("");
  lines.push(`Tätigkeiten: ${form.taetigkeiten.map((t) => `${t.id}=${t.label}`).join(", ") || "(none)"}`);
  lines.push(`Orte: ${form.orte.map((o) => `${o.id}=${o.label}`).join(", ") || "(none)"}`);
  lines.push("");
  lines.push(
    `Current selection: projekt=${form.selected.projektId ?? "-"} vorgang=${form.selected.vorgangId ?? "-"} taetigkeit=${form.selected.taetigkeit ?? "-"}`,
  );
  return lines.join("\n");
}

export function formatWeek(week: ZepWeek): string {
  const lines: string[] = [];
  lines.push(`Projektzeiten week of ${week.kwDate}:`);
  lines.push("");

  if (week.days.length === 0) {
    lines.push("(no rows returned - the session may have expired)");
    return lines.join("\n");
  }

  for (const day of week.days) {
    const flags = [
      day.today ? "today" : "",
      day.future ? "future" : "",
      day.underBooked ? "UNDER-BOOKED" : "",
    ]
      .filter(Boolean)
      .join(", ");

    lines.push(`${day.dayLabel}${day.date ? ` (${day.date})` : ""}${flags ? `  [${flags}]` : ""}`);

    if (day.bookings.length === 0) {
      lines.push("    (no bookings)");
    }
    for (const booking of day.bookings) {
      lines.push(
        `    #${booking.objectId ?? "?"}  ${booking.from}-${booking.to} (${booking.duration})  ` +
          `${booking.project} / ${booking.vorgang} / ${booking.taetigkeit}` +
          `${booking.billable ? " [billable]" : ""}` +
          `${booking.ort ? `  @ ${booking.ort}` : ""}`,
      );
      if (booking.comment) lines.push(`        ${booking.comment}`);
    }
    if (day.total) {
      lines.push(`    Summe: ${day.total}${day.billableTotal ? ` (payments ${day.billableTotal})` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function formatSaveResult(result: ZepSaveResult, what = "Booking"): string {
  if (result.ok) return `${what} OK: ${result.message ?? "saved"}`;
  return `${what} REJECTED: ${result.error ?? "unknown error"}`;
}

export function formatMoneyTable(headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: ReadonlyArray<string>) =>
    cells.map((c, i) => pad(c ?? "", widths[i] ?? 0)).join("  ").trimEnd();
  return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

// ------------------------------------------------- capacity planning (Einplanung)

/** `16` -> `16,00` (ZEP prints hours with a comma). */
function formatHours(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

function dayParts(iso: string): { weekday: string; short: string } {
  const date = new Date(`${iso}T00:00:00Z`);
  const weekday = WEEKDAYS[date.getUTCDay()] ?? "??";
  const short = `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.`;
  return { weekday, short };
}

export function formatPlan(plan: ZepPlan): string {
  const lines: string[] = [];
  lines.push(`Einplanung${plan.title ? ` ${plan.title}` : ""}  (${plan.range ?? `${plan.from} - ${plan.to}`})`);

  const utilization = plan.capacity > 0 ? Math.round((plan.planned / plan.capacity) * 100) : null;
  const overBooked = plan.days.filter(
    (day) => day.available !== null && day.planned > day.available + 0.001,
  ).length;

  lines.push(
    `Kapazität ${formatHours(plan.capacity)} h | geplant ${formatHours(plan.planned)} h` +
      `${utilization === null ? "" : ` | Auslastung ${utilization} %`}` +
      `${overBooked > 0 ? ` | ${overBooked} Tag(e) überbucht` : ""}`,
  );
  lines.push("");

  const plannedDays = plan.days.filter((day) => day.planned > 0);
  if (plannedDays.length === 0) {
    lines.push("(keine Einplanung im Zeitraum)");
  }
  for (const day of plannedDays) {
    const { weekday, short } = dayParts(day.date);
    const slices = day.slices
      .map((slice) => `${slice.project} ${formatHours(slice.hours)}`)
      .join(" | ");
    lines.push(
      `${weekday} ${short}  ${formatHours(day.planned)}` +
        `${day.available === null ? "" : ` / ${formatHours(day.available)}`} h  ${slices}`,
    );
  }

  if (plan.projects.length > 0) {
    lines.push("", "Planstunden je Projekt:");
    for (const project of plan.projects) {
      lines.push(`    ${formatHours(project.hours).padStart(6)} h  ${project.project}`);
    }
  }

  return lines.join("\n").trimEnd();
}

/** One line per changed cell, used by zep_plan_set. */
export function formatPlanEntries(entries: ReadonlyArray<ZepPlanEntry>): string {
  return entries
    .map((entry) => {
      const value =
        entry.value === null ? "geleert" : `${formatHours(entry.value)} ${entry.unit === "%" ? "%" : "h"}`;
      return `    ${entry.date}  Projekt ${entry.projektId}  ${value}${
        entry.comment ? `  "${entry.comment}"` : ""
      }`;
    })
    .join("\n");
}
