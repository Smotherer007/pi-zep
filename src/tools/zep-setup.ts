/**
 * zep_setup -- store the ZEP account (userid + password + Mandant).
 */

import { Type } from "typebox";

import { DEFAULT_BASE_URL, DEFAULT_MANDANT, getProfile, saveProfile, useProfile } from "../config.ts";
import type { SetupParams, ZepAccount } from "../types.ts";
import { errorResult, textResult, type ToolResult } from "./shared.ts";

export const ZepSetupTool = {
  name: "zep_setup",
  label: "ZEP Setup",
  description:
    "Configure a ZEP (zep-online.de) account for time tracking: userid, password and Mandant. Call this before any other zep_* tool. Credentials are stored in ~/.pi/zep-config.json (file mode 0600).",
  parameters: Type.Object({
    name: Type.String({
      description: "Profile name, e.g. 'work'. Use a short, memorable name.",
    }),
    userid: Type.String({
      description: "ZEP user id as used in the ZEP login form, e.g. 'patrick.weppelmann'.",
    }),
    password: Type.String({
      description:
        "ZEP password. WARNING: ZEP locks the account after 5 failed login attempts, so make sure this is correct.",
    }),
    mandant: Type.Optional(
      Type.String({
        description: `Mandant / tenant path segment in the ZEP URL, e.g. '${DEFAULT_MANDANT}'. Defaults to '${DEFAULT_MANDANT}'.`,
      }),
    ),
    baseUrl: Type.Optional(
      Type.String({
        description: `ZEP origin, defaults to '${DEFAULT_BASE_URL}'.`,
      }),
    ),
  }),

  async execute(_toolCallId: string, params: SetupParams): Promise<ToolResult> {
    try {
      const existing = (() => {
        try {
          return getProfile(params.name);
        } catch {
          return undefined;
        }
      })();

      const account: ZepAccount = {
        name: params.name,
        baseUrl: (params.baseUrl ?? existing?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
        mandant: (params.mandant ?? existing?.mandant ?? DEFAULT_MANDANT).replace(/^\/+|\/+$/g, ""),
        userid: params.userid,
        password: params.password,
        ...(existing?.lastProjektId ? { lastProjektId: existing.lastProjektId } : {}),
        ...(existing?.lastVorgangId ? { lastVorgangId: existing.lastVorgangId } : {}),
        ...(existing?.lastTaetigkeit ? { lastTaetigkeit: existing.lastTaetigkeit } : {}),
      };

      saveProfile(params.name, account);
      useProfile(params.name);

      return textResult(
        `ZEP profile "${params.name}" saved and set as active.\n` +
          `  URL:      ${account.baseUrl}/${account.mandant}\n` +
          `  User:     ${account.userid}\n` +
          `\nNext: run zep_status to verify the login, then zep_week / zep_book.`,
        { profile: params.name, mandant: account.mandant },
      );
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  },
};
