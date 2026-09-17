/**
 * zep_status -- report configuration, session state and a successful login.
 */

import { Type } from "typebox";

import {
  configPath,
  getActiveProfileName,
  listProfiles,
  refreshConfig,
  sessionPath,
} from "../config.ts";
import { ZepClient } from "../clients/zep-client.ts";
import { createClient, ZepError } from "../session.ts";
import { formatFormData } from "../formatting/formatters.ts";
import { errorResult, textResult, type ToolResult } from "./shared.ts";

export const ZepStatusTool = {
  name: "zep_status",
  label: "ZEP Status",
  description:
    "Show the configured ZEP profiles and verify the live session by logging in and reading the booking form. Use the 'probe' flag to also confirm that the Projektzeiten page is reachable.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "ZEP profile to use. Defaults to the active profile." }),
    ),
    probe: Type.Optional(
      Type.Boolean({
        description: "Also load the booking form (project list) to prove the session works.",
      }),
    ),
    relogin: Type.Optional(
      Type.Boolean({
        description: "Discard any cached session and log in from scratch.",
      }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: { profile?: string; probe?: boolean; relogin?: boolean },
  ): Promise<ToolResult> {
    refreshConfig();
    const lines: string[] = [];
    const profiles = listProfiles();

    lines.push(`Config file:  ${configPath()}`);
    lines.push(`Session file: ${sessionPath()}`);
    lines.push(`Profiles:     ${profiles.length ? profiles.join(", ") : "(none)"}`);
    lines.push(`Active:       ${getActiveProfileName() ?? "(none)"}`);
    lines.push("");

    if (profiles.length === 0) {
      lines.push("No ZEP profile configured yet. Call zep_setup with userid, password and mandant.");
      return textResult(lines.join("\n"), { profiles: 0 });
    }

    try {
      if (params.relogin) {
        const { getActiveProfileName: active, getProfile, saveSession } = await import("../config.ts");
        const name = params.profile ?? active()!;
        const account = getProfile(name);
        const client = new ZepClient(account, { onSession: (s) => saveSession(name, s) });
        const result = await client.login();
        if (!result.ok) {
          lines.push(`Login FAILED: ${result.message}`);
          if (result.attemptsLeft !== undefined) {
            lines.push(`Attempts left before lockout: ${result.attemptsLeft}`);
          }
          return errorResult(lines.join("\n"));
        }
        lines.push(`Login OK (fresh). CLIENTSESSID=${result.clientsessid}`);
        lines.push(`Request token: ${client.token ?? "(none)"}`);
        if (params.probe) {
          const { form } = await client.loadForm();
          lines.push("");
          lines.push(formatFormData(form, "Projekte"));
        }
        return textResult(lines.join("\n"), { ok: true, freshLogin: true });
      }

      const handle = await createClient(params.profile);
      lines.push(`Session for "${handle.profileName}": OK (${handle.sessionSource})`);
      lines.push(`CLIENTSESSID:  ${handle.client.sessionId}`);
      lines.push(`Request token: ${handle.client.token ?? "(none)"}`);

      if (params.probe) {
        const { form } = await handle.client.loadForm();
        lines.push("");
        lines.push(formatFormData(form, "Projekte"));
      } else {
        const alive = await handle.client.probe();
        lines.push(`Week read:    ${alive ? "OK" : "FAILED"}`);
      }

      return textResult(lines.join("\n"), {
        ok: true,
        sessionSource: handle.sessionSource,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ZepError && error.attemptsLeft !== undefined) {
        lines.push(`Attempts left before lockout: ${error.attemptsLeft}`);
      }
      lines.push(message);
      return errorResult(lines.join("\n"));
    }
  },
};
