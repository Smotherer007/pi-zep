/**
 * Configuration and session persistence.
 *
 * Two files, both owner-readable only:
 *   ~/.pi/zep-config.json   - accounts (userid + password)
 *   ~/.pi/zep-session.json  - cached session per profile (CLIENTSESSID + cookies)
 *
 * The session cache matters: ZEP locks an account after 5 failed password
 * attempts, so re-using a live session is much safer than logging in again
 * on every call.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ZepAccount, ZepConfigFile, ZepSession } from "./types.ts";

/** Resolved on every call, so honouring $HOME works and tests can relocate it. */
function configFile(): string {
  return join(homedir(), ".pi", "zep-config.json");
}

function sessionFile(): string {
  return join(homedir(), ".pi", "zep-session.json");
}

export const DEFAULT_BASE_URL = "https://zep-online.de";
export const DEFAULT_MANDANT = "zepneoimpulse";

let config: { profiles: Record<string, ZepAccount>; activeProfile: string | null } = {
  profiles: {},
  activeProfile: null,
};
let sessions: Record<string, ZepSession> = {};

// mtimes of the last read, so refreshConfig() can tell whether the files
// changed on disk. -1 means "never read".
let configMtime = -1;
let sessionMtime = -1;

function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

function writePrivate(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort - Windows and some filesystems do not support chmod
  }
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function loadConfig(): void {
  const loaded = readJson<ZepConfigFile>(configFile(), { profiles: {}, activeProfile: null });
  config = {
    profiles: loaded?.profiles ?? {},
    activeProfile: loaded?.activeProfile ?? null,
  };
  sessions = readJson<Record<string, ZepSession>>(sessionFile(), {});
  configMtime = mtimeOf(configFile());
  sessionMtime = mtimeOf(sessionFile());
}

/**
 * Re-read the files when they changed on disk.
 *
 * pi loads an extension once per session, so without this a config file that
 * the user wrote by hand (the documented alternative to zep_setup) is only
 * picked up after a restart - the tools would keep reporting
 * "No ZEP profile configured" while a perfectly valid file sits on disk.
 *
 * Cheap: two stat() calls in the common case where nothing changed.
 */
export function refreshConfig(): void {
  const nextConfig = mtimeOf(configFile());
  const nextSession = mtimeOf(sessionFile());
  if (nextConfig === configMtime && nextSession === sessionMtime) return;
  loadConfig();
}

export function getConfig(): ZepConfigFile {
  return config;
}

export function listProfiles(): string[] {
  return Object.keys(config.profiles);
}

export function getActiveProfileName(): string | null {
  return config.activeProfile;
}

export function getProfile(name?: string): ZepAccount {
  const key = name ?? config.activeProfile;
  if (!key) {
    throw new Error(
      "No ZEP profile configured. Call zep_setup first (userid, password, mandant).",
    );
  }
  const profile = config.profiles[key];
  if (!profile) {
    const known = listProfiles();
    throw new Error(
      known.length
        ? `ZEP profile "${key}" not found. Known profiles: ${known.join(", ")}`
        : "No ZEP profile configured. Call zep_setup first.",
    );
  }

  // A hand-written ~/.pi/zep-config.json may leave out the derived fields, so
  // fill them in rather than crashing on `undefined.replace`.
  const baseUrl = (profile.baseUrl ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  const mandant = (profile.mandant ?? DEFAULT_MANDANT).trim() || DEFAULT_MANDANT;

  return {
    ...profile,
    name: profile.name ?? key,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    mandant: mandant.replace(/^\/+|\/+$/g, ""),
  };
}

export function saveProfile(name: string, account: ZepAccount): void {
  config.profiles[name] = account;
  if (!config.activeProfile) config.activeProfile = name;
  writePrivate(configFile(), config);
}

export function updateProfile(name: string, patch: Partial<ZepAccount>): void {
  const existing = config.profiles[name];
  if (!existing) return;
  config.profiles[name] = { ...existing, ...patch };
  writePrivate(configFile(), config);
}

export function useProfile(name: string): void {
  if (!config.profiles[name]) {
    throw new Error(`ZEP profile "${name}" not found.`);
  }
  config.activeProfile = name;
  writePrivate(configFile(), config);
}

export function deleteProfile(name: string): void {
  delete config.profiles[name];
  delete sessions[name];
  if (config.activeProfile === name) {
    config.activeProfile = listProfiles()[0] ?? null;
  }
  writePrivate(configFile(), config);
  writePrivate(sessionFile(), sessions);
}

export function configPath(): string {
  return configFile();
}

export function sessionPath(): string {
  return sessionFile();
}

// ------------------------------------------------------------------- sessions

export function getSession(profileName: string): ZepSession | undefined {
  return sessions[profileName];
}

export function saveSession(profileName: string, session: ZepSession): void {
  sessions[profileName] = session;
  writePrivate(sessionFile(), sessions);
}

export function clearSession(profileName: string): void {
  delete sessions[profileName];
  writePrivate(sessionFile(), sessions);
}
