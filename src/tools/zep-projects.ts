/**
 * zep_projects -- discover bookable projects, Vorgänge and Tätigkeiten.
 */

import { Type } from "typebox";

import { createClient } from "../session.ts";
import { formatFormData } from "../formatting/formatters.ts";
import { errorResult, textResult, type ToolResult } from "./shared.ts";

export const ZepProjectsTool = {
  name: "zep_projects",
  label: "ZEP Projects",
  description:
    "List the ZEP projects available for time booking, plus the Vorgänge (work packages) and Tätigkeiten of the selected project. Use it to resolve ids before calling zep_book. Pass 'projekt' to make ZEP re-render the form for a specific project so its Vorgänge can be read.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "ZEP profile to use. Defaults to the active profile." }),
    ),
    projekt: Type.Optional(
      Type.String({
        description:
          "Project id (e.g. '413') or part of its label. ZEP re-renders the booking form for this project so its Vorgänge become visible.",
      }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: { profile?: string; projekt?: string },
  ): Promise<ToolResult> {
    try {
      const { client, profileName } = await createClient(params.profile);
      const { form } = await client.loadForm();

      if (!params.projekt) {
        return textResult(formatFormData(form), {
          profile: profileName,
          projects: form.projects,
          selected: form.selected,
        });
      }

      const resolved = resolveProject(form, params.projekt);
      if (!resolved) return errorResult(`No project matches "${params.projekt}".`);

      const refreshed = await client.refreshFormForProject(resolved.id);
      const merged = {
        ...form,
        vorgaenge: refreshed.vorgaenge.length ? refreshed.vorgaenge : form.vorgaenge,
        taetigkeiten: refreshed.taetigkeiten.length ? refreshed.taetigkeiten : form.taetigkeiten,
        selected: { ...form.selected, projektId: resolved.id },
      };

      return textResult(`${formatFormData(merged)}\n\n(resolved "${params.projekt}" -> ${resolved.id} ${resolved.label})`, {
        profile: profileName,
        project: resolved,
        vorgaenge: merged.vorgaenge,
      });
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  },
};

export function resolveProject(
  form: { projects: ReadonlyArray<{ id: string; label: string }> },
  reference: string,
): { id: string; label: string } | null {
  const needle = reference.trim().toLowerCase();
  const byId = form.projects.find((p) => p.id === reference.trim());
  if (byId) return byId;
  const exact = form.projects.find((p) => p.label.toLowerCase() === needle);
  if (exact) return exact;
  const partial = form.projects.filter((p) => p.label.toLowerCase().includes(needle));
  if (partial.length >= 1) return partial[0]!;
  return null;
}
