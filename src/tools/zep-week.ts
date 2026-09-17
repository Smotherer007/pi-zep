/**
 * zep_week -- read the Projektzeiten week overview.
 */

import { Type } from "typebox";

import { createClient } from "../session.ts";
import { formatWeek } from "../formatting/formatters.ts";
import { errorResult, textResult, toIsoDate, type ToolResult } from "./shared.ts";

export const ZepWeekTool = {
  name: "zep_week",
  label: "ZEP Week",
  description:
    "Show the ZEP Projektzeiten week overview: per day the bookings with id, times, duration, project, Vorgang, Tätigkeit and comment, plus the daily sum and whether the day is under-booked. Read-only.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "ZEP profile to use. Defaults to the active profile." }),
    ),
    date: Type.Optional(
      Type.String({
        description:
          "Any date inside the wanted ISO week (YYYY-MM-DD or DD.MM.YYYY). Defaults to the current week.",
      }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: { profile?: string; date?: string },
  ): Promise<ToolResult> {
    try {
      const iso = toIsoDate(params.date);
      const { client, profileName } = await createClient(params.profile);
      const week = await client.week(iso);
      return textResult(formatWeek(week), {
        profile: profileName,
        kwDate: week.kwDate,
        days: week.days.length,
      });
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  },
};
