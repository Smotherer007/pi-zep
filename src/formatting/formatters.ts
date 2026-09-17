/**
 * Pure functions that turn ZEP domain data into text for the model/user.
 */

import type { ZepFormData, ZepSaveResult, ZepWeek } from "../types.ts";

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
          `${booking.billable ? " [billable]" : ""}`,
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
