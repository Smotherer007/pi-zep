/**
 * Regression test for the bug that made a hand-written config invisible:
 * pi loads an extension once per session, so the config was read exactly once
 * at startup. A file written afterwards was never picked up and every tool
 * kept answering "No ZEP profile configured".
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// config.ts resolves ~ lazily through os.homedir(), which honours $HOME.
const HOME = mkdtempSync(join(tmpdir(), "zep-home-"));
process.env.HOME = HOME;
mkdirSync(join(HOME, ".pi"), { recursive: true });

const { loadConfig, refreshConfig, getActiveProfileName, getProfile, configPath } = await import(
  "../src/config.ts"
);

const file = join(HOME, ".pi", "zep-config.json");

test("a config written after startup is picked up by refreshConfig()", () => {
  loadConfig();
  assert.equal(getActiveProfileName(), null, "nothing on disk yet");

  writeFileSync(
    file,
    JSON.stringify({
      profiles: {
        work: {
          baseUrl: "https://zep-online.de",
          mandant: "zepneoimpulse",
          userid: "patrick.weppelmann",
          password: "geheim123",
        },
      },
      activeProfile: "work",
    }),
  );

  // Without refreshConfig() this would still be null - the whole bug.
  refreshConfig();
  assert.equal(getActiveProfileName(), "work");
  assert.equal(getProfile().userid, "patrick.weppelmann");
  assert.equal(configPath(), file);
});

test("refreshConfig() is a no-op while the file is untouched", () => {
  const before = getProfile();
  refreshConfig();
  assert.deepEqual(getProfile(), before);
});

test("an edited password is visible after refreshConfig()", () => {
  const current = JSON.parse(readFileSync(file, "utf8"));
  current.profiles.work.password = "ein-anderes-passwort";
  writeFileSync(file, JSON.stringify(current));
  // force a distinct mtime, filesystems can be coarse
  const future = new Date(Date.now() + 2000);
  utimesSync(file, future, future);

  refreshConfig();
  assert.equal(getProfile().password, "ein-anderes-passwort");
});

test("a missing config degrades to 'no profile' instead of throwing", () => {
  assert.ok(existsSync(file));
  const emptyHome = mkdtempSync(join(tmpdir(), "zep-empty-"));
  process.env.HOME = emptyHome;
  loadConfig();
  assert.equal(getActiveProfileName(), null);
  refreshConfig();
  assert.equal(getActiveProfileName(), null);
});
