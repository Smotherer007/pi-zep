/**
 * Smoke test: the extension must load and register every tool with a
 * well-formed schema. This catches import errors and TypeBox mistakes
 * before pi ever starts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import extension from "../index.ts";

interface RegisteredTool {
  name: string;
  label?: string;
  description?: string;
  parameters?: unknown;
  execute?: unknown;
}

test("extension registers all ZEP tools", async () => {
  const registered: RegisteredTool[] = [];
  const commands: string[] = [];

  const fakePi = {
    registerTool(tool: RegisteredTool) {
      registered.push(tool);
    },
    registerCommand(name: string) {
      commands.push(name);
    },
    on() {},
  };

  await extension(fakePi as never);

  const names = registered.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "zep_book",
    "zep_delete",
    "zep_doctor",
    "zep_login",
    "zep_profile",
    "zep_projects",
    "zep_setup",
    "zep_status",
    "zep_week",
  ]);

  for (const tool of registered) {
    assert.ok(tool.description && tool.description.length > 20, `${tool.name} needs a description`);
    assert.equal(typeof tool.execute, "function", `${tool.name} needs an execute function`);
    assert.ok(tool.parameters, `${tool.name} needs a parameter schema`);
  }
});
