/**
 * zep_login -- establish a ZEP session.
 *
 * ZEP does not offer a token exchange: a session is a `PHPSESSID` cookie
 * bound 1:1 to a `CLIENTSESSID` query parameter, and both are only issued by
 * the login POST. That is why this tool exists separately from zep_setup:
 * zep_setup stores the credentials, zep_login proves they work and caches the
 * resulting session.
 */

import { Type } from "typebox";

import { getActiveProfileName, getProfile } from "../config.ts";
import { createClient, loginProfile } from "../session.ts";
import { errorResult, textResult, type ToolResult } from "./shared.ts";

export const ZepLoginTool = {
  name: "zep_login",
  label: "ZEP Login",
  description:
    "Log in to ZEP with the stored credentials and cache the session in ~/.pi/zep-session.json. Use force to ignore a cached session. Reports the remaining password attempts when the login fails (ZEP locks the account after 5).",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "ZEP profile to use. Defaults to the active profile." }),
    ),
    force: Type.Optional(
      Type.Boolean({
        description: "Ignore a cached session and log in from scratch.",
      }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: { profile?: string; force?: boolean },
  ): Promise<ToolResult> {
    try {
      const name = params.profile ?? getActiveProfileName();
      if (!name) return errorResult("No ZEP profile configured. Call zep_setup first.");
      const account = getProfile(name);

      if (!params.force) {
        const handle = await createClient(params.profile);
        if (handle.sessionSource === "cache") {
          return textResult(
            `Cached session for "${name}" is still valid - no login needed.\n` +
              `CLIENTSESSID:  ${handle.client.sessionId}\n` +
              `Request token: ${handle.client.token}\n` +
              `(use force=true to log in again)`,
            { profile: name, sessionSource: "cache" },
          );
        }
        return textResult(
          `Logged in to ZEP as "${account.userid}" (profile "${name}").\n` +
            `URL:           ${account.baseUrl}/${account.mandant}\n` +
            `CLIENTSESSID:  ${handle.client.sessionId}\n` +
            `Request token: ${handle.client.token}`,
          { profile: name, clientsessid: handle.client.sessionId, sessionSource: "fresh" },
        );
      }

      const client = await loginProfile(name);
      return textResult(
        `Logged in to ZEP as "${account.userid}" (profile "${name}").\n` +
          `URL:           ${account.baseUrl}/${account.mandant}\n` +
          `CLIENTSESSID:  ${client.sessionId}\n` +
          `Request token: ${client.token}`,
        { profile: name, clientsessid: client.sessionId, sessionSource: "fresh" },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResult(message);
    }
  },
};
