/**
 * Wiring between stored configuration and a live ZepClient.
 *
 * A cached session is tried first and verified with a cheap read. Only when
 * that fails do we log in again - important because ZEP locks an account
 * after 5 failed password attempts.
 */

import {
  clearSession,
  getActiveProfileName,
  getProfile,
  getSession,
  refreshConfig,
  saveSession,
} from "./config.ts";
import { ZepClient, ZepError } from "./clients/zep-client.ts";

export interface ClientHandle {
  readonly client: ZepClient;
  readonly profileName: string;
  /** How the current session was obtained. */
  readonly sessionSource: "cache" | "fresh";
}

export async function createClient(profileName?: string): Promise<ClientHandle> {
  refreshConfig();
  const name = profileName ?? getActiveProfileName();
  if (!name) {
    throw new ZepError("No ZEP profile configured. Call zep_setup first.");
  }
  const account = getProfile(name);

  let source: "cache" | "fresh" = "cache";
  const client = new ZepClient(account, {
    onSession: (session) => saveSession(name, session),
  });

  const cached = getSession(name);
  if (cached) {
    client.applySession(cached);
    try {
      const alive = await client.probe();
      if (alive) {
        return { client, profileName: name, sessionSource: "cache" };
      }
    } catch {
      // fall through to a fresh login
    }
    clearSession(name);
  }

  source = "fresh";
  const result = await client.login();
  if (!result.ok) {
    throw new ZepError(
      `${result.message ?? "Login failed"}${
        result.attemptsLeft !== undefined
          ? ` - ${result.attemptsLeft} password attempt(s) left before ZEP locks the account`
          : ""
      }`,
      result.attemptsLeft,
    );
  }
  return { client, profileName: name, sessionSource: source };
}

/**
 * Force a fresh login for a profile, discarding any cached session.
 * Used by zep_login force=true.
 */
export async function loginProfile(profileName: string): Promise<ZepClient> {
  refreshConfig();
  const account = getProfile(profileName);
  clearSession(profileName);

  const client = new ZepClient(account, {
    onSession: (session) => saveSession(profileName, session),
  });

  const result = await client.login();
  if (!result.ok) {
    throw new ZepError(
      `${result.message ?? "Login failed"}${
        result.attemptsLeft !== undefined
          ? ` - ${result.attemptsLeft} password attempt(s) left before ZEP locks the account`
          : ""
      }`,
      result.attemptsLeft,
    );
  }
  return client;
}

export { ZepError };
