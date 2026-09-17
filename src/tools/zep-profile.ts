/**
 * zep_profile -- list, switch or delete ZEP profiles.
 */

import { Type } from "typebox";

import {
  clearSession,
  deleteProfile,
  getActiveProfileName,
  listProfiles,
  useProfile,
  refreshConfig,
} from "../config.ts";
import { errorResult, textResult, type ToolResult } from "./shared.ts";

export const ZepProfileTool = {
  name: "zep_profile",
  label: "ZEP Profile",
  description:
    "List configured ZEP profiles, switch the active one, or delete a profile. Without arguments it lists all profiles.",
  parameters: Type.Object({
    action: Type.Optional(
      Type.String({ description: "One of: list, use, delete. Defaults to list." }),
    ),
    name: Type.Optional(
      Type.String({ description: "Profile name for 'use' and 'delete'." }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: { action?: string; name?: string },
  ): Promise<ToolResult> {
    refreshConfig();
    const action = params.action ?? "list";
    try {
      if (action === "list") {
        const profiles = listProfiles();
        if (profiles.length === 0) {
          return textResult("No ZEP profiles configured. Call zep_setup first.", { profiles: [] });
        }
        const active = getActiveProfileName();
        const lines = profiles.map((p) => `${p === active ? "*" : " "} ${p}`).join("\n");
        return textResult(`ZEP profiles (${profiles.length})\n${lines}`, { profiles, active });
      }

      if (!params.name) return errorResult(`Action "${action}" needs a profile name.`);

      if (action === "use") {
        useProfile(params.name);
        return textResult(`Active ZEP profile is now "${params.name}".`, { active: params.name });
      }

      if (action === "delete") {
        deleteProfile(params.name);
        return textResult(
          `ZEP profile "${params.name}" deleted (including its cached session).`,
          { deleted: params.name },
        );
      }

      if (action === "clear-session") {
        clearSession(params.name);
        return textResult(`Cached ZEP session for "${params.name}" cleared.`, {
          cleared: params.name,
        });
      }

      return errorResult(`Unknown action "${action}". Use list, use, delete or clear-session.`);
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  },
};
