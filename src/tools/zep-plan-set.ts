/**
 * zep_plan_set -- write planned hours into the ZEP capacity planning.
 *
 * ZEP's Einplanung matrix stores one value per project and day, either as
 * hours ("h") or as a percentage of that day's availability ("%"). The grid
 * posts only the cells it marked as edited, so a save merges into the existing
 * plan; `value: null` clears a cell.
 */

import { Type } from "typebox";

import { createClient } from "../session.ts";
import { formatPlan, formatPlanEntries } from "../formatting/formatters.ts";
import { errorResult, matchOption, textResult, toIsoDate, type ToolResult } from "./shared.ts";
import type { ZepPlanEntry } from "../types.ts";

interface CellParams {
  datum?: string;
  projekt?: string;
  stunden?: number;
  prozent?: number;
  leeren?: boolean;
  bemerkung?: string;
}

const CellSchema = Type.Object({
  datum: Type.Optional(Type.String({ description: "Day (YYYY-MM-DD or DD.MM.YYYY). Defaults to today." })),
  projekt: Type.Optional(
    Type.String({ description: "Project id (e.g. '371') or part of its label." }),
  ),
  stunden: Type.Optional(Type.Number({ description: "Planned hours for that day." })),
  prozent: Type.Optional(
    Type.Number({ description: "Planned percentage of the day's availability (ZEP stores '%')." }),
  ),
  leeren: Type.Optional(Type.Boolean({ description: "Clear the cell instead of setting a value." })),
  bemerkung: Type.Optional(Type.String({ description: "Note stored with the plan cell." })),
});

export const ZepPlanSetTool = {
  name: "zep_plan_set",
  label: "ZEP Einplanung setzen",
  description:
    "Write into the ZEP capacity planning (Einplanung / Kapa-Planung): set planned hours or a percentage for one project and day, or clear the cell. Give one cell with the top-level fields or several with 'entries'. Use dryRun to see the exact request without saving. Every save is verified by re-reading the plan.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "ZEP profile to use. Defaults to the active profile." }),
    ),
    datum: Type.Optional(Type.String({ description: "Day for a single cell. Defaults to today." })),
    projekt: Type.Optional(Type.String({ description: "Project id or part of its label." })),
    stunden: Type.Optional(Type.Number({ description: "Planned hours." })),
    prozent: Type.Optional(Type.Number({ description: "Planned percentage of the day's availability." })),
    leeren: Type.Optional(Type.Boolean({ description: "Clear the cell instead of setting a value." })),
    bemerkung: Type.Optional(Type.String({ description: "Note stored with the plan cell." })),
    entries: Type.Optional(
      Type.Array(CellSchema, { description: "Several cells in one call." }),
    ),
    dryRun: Type.Optional(
      Type.Boolean({ description: "Resolve everything and show what would be sent, without saving." }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: CellParams & { profile?: string; entries?: ReadonlyArray<CellParams>; dryRun?: boolean },
  ): Promise<ToolResult> {
    try {
      const cells: CellParams[] = params.entries?.length ? [...params.entries] : [params];
      if (cells.length === 0) return errorResult("No plan cell given.");

      const { client, profileName } = await createClient(params.profile);
      const { form } = await client.loadForm();

      const entries: ZepPlanEntry[] = [];
      for (const cell of cells) {
        const date = toIsoDate(cell.datum ?? params.datum);
        const reference = cell.projekt ?? params.projekt;
        if (!reference) return errorResult("No project given: pass 'projekt' (id or label).");

        const project = matchOption(form.projects, reference);
        if (!project) {
          return errorResult(
            `No project matches "${reference}". Known projects: ${form.projects
              .map((option) => `${option.id}=${option.label}`)
              .join(" | ")}`,
          );
        }

        const hours = cell.stunden;
        const percent = cell.prozent;
        const clear = cell.leeren ?? false;
        const given = [hours !== undefined, percent !== undefined, clear].filter(Boolean).length;
        if (given !== 1) {
          return errorResult(
            `Give exactly one of 'stunden', 'prozent' or 'leeren' for ${date} / ${project.label}.`,
          );
        }

        const comment = cell.bemerkung ?? params.bemerkung;
        entries.push({
          projektId: project.id,
          date,
          value: clear ? null : (hours ?? percent ?? null),
          unit: percent !== undefined ? "%" : "h",
          ...(comment ? { comment } : {}),
        });
      }

      const preview =
        `${params.dryRun ? "DRY RUN - nothing saved.\n\n" : ""}` +
        `Einplanung (${entries.length} Zelle(n)):\n${formatPlanEntries(entries)}`;

      if (params.dryRun) return textResult(preview, { profile: profileName, dryRun: true });

      const saved = await client.savePlan({ entries });
      if (!saved.ok) {
        return errorResult(`ZEP rejected the Einplanung: ${saved.error ?? "unspecified error"}`);
      }

      // Read back what ZEP stored for the touched days.
      const dates = entries.map((entry) => entry.date).sort();
      const from = dates[0]!;
      const to = dates[dates.length - 1]!;
      const plan = await client.plan({ from, to });

      return textResult(
        `${preview}\n\n${saved.message ?? "saved"}\n\nKontrolle (${from} - ${to}):\n${formatPlan(plan)}`,
        {
          profile: profileName,
          saved: true,
          entries: entries.length,
          from,
          to,
          planned: plan.planned,
          capacity: plan.capacity,
        },
      );
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  },
};
