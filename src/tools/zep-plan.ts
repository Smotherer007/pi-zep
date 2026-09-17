/**
 * zep_plan -- read the ZEP capacity planning ("Einplanung", Kapa-Planung).
 */

import { Type } from "typebox";

import { createClient } from "../session.ts";
import { formatPlan } from "../formatting/formatters.ts";
import { addDays, errorResult, textResult, toIsoDate, type ToolResult } from "./shared.ts";

export const ZepPlanTool = {
  name: "zep_plan",
  label: "ZEP Einplanung",
  description:
    "Show the ZEP capacity planning (Einplanung / Kapa-Planung): per day the planned hours, the available hours and the per-project breakdown, plus total capacity, planned hours and utilization. Read-only. Defaults to today plus 30 days.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "ZEP profile to use. Defaults to the active profile." }),
    ),
    von: Type.Optional(
      Type.String({
        description: "Start date (YYYY-MM-DD or DD.MM.YYYY). Defaults to today.",
      }),
    ),
    bis: Type.Optional(
      Type.String({
        description: "End date. Defaults to 30 days after 'von' (ZEP's own default range).",
      }),
    ),
    projektTyp: Type.Optional(
      Type.String({
        description: "ZEP Projekttyp filter: 'alle' (default), 'intern' or 'kunden'.",
      }),
    ),
    projekte: Type.Optional(
      Type.Array(Type.String(), {
        description: "Restrict the plan to these project ids.",
      }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: {
      profile?: string;
      von?: string;
      bis?: string;
      projektTyp?: string;
      projekte?: ReadonlyArray<string>;
    },
  ): Promise<ToolResult> {
    try {
      const from = toIsoDate(params.von);
      const to = params.bis ? toIsoDate(params.bis) : addDays(from, 30);

      const { client, profileName } = await createClient(params.profile);
      const plan = await client.plan({
        from,
        to,
        projektTyp: params.projektTyp,
        projektIds: params.projekte,
      });

      return textResult(formatPlan(plan), {
        profile: profileName,
        from: plan.from,
        to: plan.to,
        capacity: plan.capacity,
        planned: plan.planned,
        projects: plan.projects.length,
        days: plan.days.length,
      });
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  },
};
