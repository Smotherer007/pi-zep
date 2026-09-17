/**
 * zep_delete -- remove a Projektzeit booking by its row id.
 */

import { Type } from "typebox";

import { createClient } from "../session.ts";
import { mondayOf } from "../clients/zep-parse.ts";
import { errorResult, textResult, toIsoDate, type ToolResult } from "./shared.ts";

export const ZepDeleteTool = {
  name: "zep_delete",
  label: "ZEP Delete",
  description:
    "Delete a ZEP Projektzeit booking. Get the row id from zep_week (shown as #<id>). Prefer passing 'datum' so ZEP re-renders the right week.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "ZEP profile to use. Defaults to the active profile." }),
    ),
    objectId: Type.String({ description: "Booking row id from zep_week, e.g. '163533'." }),
    datum: Type.Optional(
      Type.String({ description: "Day the booking sits on (YYYY-MM-DD). Defaults to today." }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: { profile?: string; objectId: string; datum?: string },
  ): Promise<ToolResult> {
    try {
      const iso = toIsoDate(params.datum);
      const kwDate = mondayOf(new Date(`${iso}T12:00:00Z`));
      const { client, profileName } = await createClient(params.profile);
      const result = await client.remove(params.objectId, kwDate);
      return result.ok
        ? textResult(`Booking #${params.objectId} deleted.`, { profile: profileName, objectId: params.objectId })
        : errorResult(`Delete of #${params.objectId} failed: ${result.error ?? "unknown error"}`);
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  },
};
