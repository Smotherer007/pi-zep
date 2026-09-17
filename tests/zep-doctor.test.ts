/**
 * Tests for the free checks zep_doctor performs. None of them may touch the
 * network or spend a login attempt.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { passwordShapeIssues } from "../src/tools/zep-doctor.ts";

test("a clean password raises nothing", () => {
  assert.deepEqual(passwordShapeIssues("correct-horse-battery"), []);
  assert.deepEqual(passwordShapeIssues("a1b2c3d4e5"), []);
});

test("a trailing space is reported - ZEP would only say 'wrong password'", () => {
  const issues = passwordShapeIssues("supergeheim ");
  assert.equal(issues.length, 1);
  assert.match(issues[0]!, /leading\/trailing whitespace/);
});

test("a leading space or a newline is reported too", () => {
  assert.match(passwordShapeIssues(" xyz12345")[0] ?? "", /leading\/trailing whitespace/);
  assert.match(passwordShapeIssues("xyz12345\n")[0] ?? "", /leading\/trailing whitespace/);
});

test("inner whitespace is reported", () => {
  const issues = passwordShapeIssues("my pass word");
  assert.ok(issues.some((i) => /inner whitespace/.test(i)));
});

test("the literals 'undefined' and 'null' are called out", () => {
  assert.match(passwordShapeIssues("undefined")[0] ?? "", /literally the string "undefined"/);
  assert.match(passwordShapeIssues("null")[0] ?? "", /literally the string "null"/);
});

test("a too-short password is flagged", () => {
  assert.match(passwordShapeIssues("abc")[0] ?? "", /suspiciously short \(3 chars\)/);
});

test("a '!' is flagged as a shell-truncation risk", () => {
  const issues = passwordShapeIssues("Sommer2024!");
  assert.equal(issues.length, 1);
  assert.match(issues[0]!, /history expansion/);
  // "Sommer2024!" is 11 characters - the length is reported so the user can
  // compare it against the password they believe they stored.
  assert.match(issues[0]!, /11 chars/);
});

test("the password length is part of the warning so it can be compared", () => {
  assert.match(passwordShapeIssues("a1!b2c3")[0] ?? "", /7 chars/);
});
