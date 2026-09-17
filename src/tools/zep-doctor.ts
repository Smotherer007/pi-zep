/**
 * zep_doctor -- diagnose the ZEP setup without spending a login attempt.
 *
 * Why this exists: every login attempt costs one of only five tries before
 * ZEP locks the account, and a rejected login says only "Benutzername oder
 * Kennwort falsch" - it cannot distinguish a wrong userid from a wrong
 * password, nor from a config file that carries a trailing space. This tool
 * checks everything that can be checked for free, and performs the real
 * credential check only when explicitly asked for.
 */

import { existsSync, statSync } from "node:fs";
import { Type } from "typebox";

import {
  configPath,
  getActiveProfileName,
  getProfile,
  getSession,
  listProfiles,
  refreshConfig,
  sessionPath,
} from "../config.ts";
import { ZepClient } from "../clients/zep-client.ts";
import { errorResult, textResult, type ToolResult } from "./shared.ts";

interface Check {
  readonly name: string;
  readonly status: "ok" | "warn" | "fail" | "skip";
  readonly detail: string;
  /** What to do about it, when it is not "ok". */
  readonly hint?: string;
}

const ICON = { ok: "OK  ", warn: "WARN", fail: "FAIL", skip: "SKIP" } as const;

function render(checks: ReadonlyArray<Check>): string {
  return checks
    .map((c) => {
      const head = `${ICON[c.status]}  ${c.name}: ${c.detail}`;
      return c.hint ? `${head}\n         -> ${c.hint}` : head;
    })
    .join("\n");
}

export const ZepDoctorTool = {
  name: "zep_doctor",
  label: "ZEP Doctor",
  description:
    "Check the ZEP configuration and connectivity before booking: config file, permissions, profile fields, password hygiene (whitespace is the usual cause of 'Benutzername oder Kennwort falsch'), cached session, and reachability of the server. Uses no login attempt unless checkCredentials is set, and reports how many password tries are left.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "ZEP profile to check. Defaults to the active profile." }),
    ),
    checkCredentials: Type.Optional(
      Type.Boolean({
        description:
          "Also perform ONE real login attempt to verify userid and password. This consumes one of the 5 tries before ZEP locks the account, so it is off by default.",
      }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: { profile?: string; checkCredentials?: boolean },
  ): Promise<ToolResult> {
    // Re-read from disk: the doctor is exactly the tool you run right after
    // editing the config by hand.
    refreshConfig();
    const checks: Check[] = [];

    // ------------------------------------------------------------ config file
    const path = configPath();
    if (!existsSync(path)) {
      checks.push({
        name: "config file",
        status: "fail",
        detail: `${path} does not exist`,
        hint: "Run zep_setup, or write the file by hand (profiles.<name>.userid/password, activeProfile).",
      });
      return errorResult(render(checks), { ok: false });
    }

    const mode = statSync(path).mode & 0o777;
    checks.push({
      name: "config file",
      status: mode === 0o600 ? "ok" : "warn",
      detail: `${path} (mode ${mode.toString(8)})`,
      ...(mode === 0o600
        ? {}
        : { hint: `chmod 600 ${path} - the file holds a password in clear text.` }),
    });

    const profiles = listProfiles();
    const name = params.profile ?? getActiveProfileName();
    if (!name) {
      checks.push({
        name: "active profile",
        status: "fail",
        detail: `none set (known: ${profiles.join(", ") || "none"})`,
        hint: 'Set "activeProfile" in the config file, or run zep_profile action=use.',
      });
      return errorResult(render(checks), { ok: false });
    }

    let account;
    try {
      account = getProfile(name);
    } catch (error) {
      checks.push({
        name: `profile "${name}"`,
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
        hint: `Known profiles: ${profiles.join(", ") || "none"}`,
      });
      return errorResult(render(checks), { ok: false });
    }
    checks.push({ name: "profile", status: "ok", detail: `"${name}" (active)` });

    // --------------------------------------------------------------- fields
    const missing = (["baseUrl", "mandant", "userid", "password"] as const).filter(
      (field) => !account[field],
    );
    checks.push(
      missing.length === 0
        ? { name: "profile fields", status: "ok", detail: "baseUrl, mandant, userid, password" }
        : {
            name: "profile fields",
            status: "fail",
            detail: `missing or empty: ${missing.join(", ")}`,
            hint: 'Add the field to the profile in the config file, or re-run zep_setup.',
          },
    );

    checks.push({
      name: "target",
      status: "ok",
      detail: `${account.baseUrl}/${account.mandant} as ${account.userid}`,
    });

    // ------------------------------------------------- password hygiene
    const raw = account.password ?? "";
    const hygiene = passwordShapeIssues(raw);

    checks.push(
      hygiene.length === 0
        ? { name: "password shape", status: "ok", detail: `${raw.length} characters, no whitespace` }
        : {
            name: "password shape",
            status: "fail",
            detail: hygiene.join("; "),
            hint: "Fix the stored password. ZEP reports all of these as 'Benutzername oder Kennwort falsch'.",
          },
    );

    // --------------------------------------------------------- session cache
    const cached = getSession(name);
    let liveSession: ZepClient | null = null;

    if (!cached) {
      checks.push({
        name: "cached session",
        status: "skip",
        detail: `${sessionPath()} has no entry for "${name}"`,
        hint: "A login is needed once; after that the session is reused.",
      });
    } else {
      const client = new ZepClient(account, {});
      client.applySession(cached);
      const alive = await client.probe();
      checks.push({
        name: "cached session",
        status: alive ? "ok" : "warn",
        detail: `CLIENTSESSID ${cached.clientsessid} saved ${cached.savedAt} - ${
          alive ? "still accepted" : "no longer accepted"
        }`,
        ...(alive ? {} : { hint: "It expired; the next call performs a fresh login." }),
      });
      if (alive) liveSession = client;
    }

    // ------------------------------------------------------------ reachability
    // A dedicated client: ping() primes a fresh PHPSESSID, which must not
    // overwrite the one belonging to a live session.
    try {
      const ping = await new ZepClient(account, {}).ping();
      checks.push({
        name: "reachability",
        status: ping.loginPageOk || ping.redirectedToApp ? "ok" : "warn",
        detail: `GET /view/login.php -> HTTP ${ping.status}, login form ${
          ping.loginPageOk ? "present" : "absent"
        }${ping.redirectedToApp ? ", redirects into the app (already authenticated)" : ""}`,
        ...(ping.loginPageOk || ping.redirectedToApp
          ? {}
          : { hint: "Unexpected response; a proxy or maintenance page may be in the way." }),
      });
    } catch (error) {
      checks.push({
        name: "reachability",
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
        hint: "Check network/proxy. Override baseUrl per profile if a mirror is used.",
      });
    }

    // --------------------------------------------------------- live session
    if (liveSession) {
      try {
        const { form } = await liveSession.loadForm();
        checks.push({
          name: "booking form",
          status: "ok",
          detail: `${form.projects.length} projects, ${form.vorgaenge.length} Vorgänge for the selected project`,
        });
      } catch (error) {
        checks.push({
          name: "booking form",
          status: "fail",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // ------------------------------------------------------ credential check
    if (params.checkCredentials) {
      const client = new ZepClient(account, {});
      try {
        const result = await client.login();
        checks.push({
          name: "credential check",
          status: result.ok ? "ok" : "fail",
          detail: result.ok
            ? `login accepted (CLIENTSESSID ${result.clientsessid})`
            : `${result.message ?? "rejected"}${
                result.attemptsLeft !== undefined ? ` - ${result.attemptsLeft} tries left` : ""
              }`,
          ...(result.ok
            ? {}
            : {
                hint:
                  "ZEP cannot tell 'wrong userid' from 'wrong password'. Verify both; do NOT retry blindly - the account locks after 5.",
              }),
        });
      } catch (error) {
        checks.push({
          name: "credential check",
          status: "fail",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      checks.push({
        name: "credential check",
        status: "skip",
        detail: "not attempted (costs one of 5 tries before lockout)",
        hint: "Re-run with checkCredentials=true only when the stored userid/password are confirmed.",
      });
    }

    const text = render(checks);
    const failed = checks.some((c) => c.status === "fail");
    const warnOrFail = failed || checks.some((c) => c.status === "warn");

    const verdict = failed
      ? "\n\nVerdict: something must be fixed before booking will work."
      : warnOrFail
        ? "\n\nVerdict: usable, with warnings above."
        : "\n\nVerdict: everything checks out.";

    return warnOrFail
      ? errorResult(text + verdict, { ok: !failed, checks })
      : textResult(text + verdict, { ok: true, checks });
  },
};

/**
 * Problems with a stored password that ZEP would all report as
 * "Benutzername oder Kennwort falsch" - i.e. silently. Pure, so it is testable
 * without a config file.
 */
export function passwordShapeIssues(raw: string): string[] {
  const issues: string[] = [];
  if (raw !== raw.trim()) issues.push("leading/trailing whitespace (copy-paste!)");
  if (/\s/.test(raw.trim())) issues.push("contains an inner whitespace character");
  if (raw === "undefined" || raw === "null") issues.push(`literally the string "${raw}"`);
  if (raw.length < 6) issues.push(`suspiciously short (${raw.length} chars)`);
  // `!` starts history expansion in an interactive bash. A password written
  // through a shell command can silently lose everything from the `!` on -
  // and ZEP then only says "wrong password".
  if (raw.includes("!")) {
    issues.push(
      `contains "!" (${raw.length} chars) - in an interactive shell "!" starts history expansion, ` +
        "so a password written via a command line may be truncated at that position",
    );
  }
  return issues;
}
