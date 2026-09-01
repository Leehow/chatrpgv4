#!/usr/bin/env node
// A characteristic check must be expressible.
//
// `actor_check_ref` and `combined_target_refs` declare `characteristic:` an
// allowed namespace — the core-check adapter's `_sheet_check` partitions on
// exactly `skill:` / `characteristic:`. But the closed grammar required four
// characters after the namespace, granting a three-character floor only to
// `roll:`. Every CoC7 characteristic abbreviation is exactly three letters, so
// the allowance contradicted itself: no characteristic-based opposed or
// combined check could ever be settled.
//
// Live, 2026-09-01 (campaign amaranthine-run3): the Keeper rolled POW against
// a ghost, sent `characteristic:POW`, was told the value "must use its closed
// semantic form: namespace `skill:`, `characteristic:` only", retried with
// exactly that form as `characteristic:pow`, and was refused again — an error
// message instructing the Keeper to do the thing it had just done. It gave up
// on the opposed check and improvised the outcome.
//
// The characteristic list is read from the ruleset rather than restated here,
// so a ruleset that adds one is covered without editing this file.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const projection = await import(
  pathToFileURL(
    path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts"),
  ).href,
);

function rulesetCharacteristics() {
  const source = fs.readFileSync(
    path.join(root, "plugins/coc-keeper/scripts/coc_character.py"),
    "utf8",
  );
  const match = /^REQUIRED_CHARACTERISTICS = \(([^)]*)\)/m.exec(source);
  assert.ok(match, "the ruleset's characteristic tuple was not found");
  const names = [...match[1].matchAll(/"([A-Za-z]+)"/g)].map((row) => row[1]);
  assert.ok(names.length >= 8, `expected the full set, got ${names.join(",")}`);
  return [...names, "Luck"];
}

const check = (value) => projection.validateRawModelIdentityPayload({
  semantic_inputs: { actor_check_ref: value },
});

test("the ruleset's characteristics are all three letters", () => {
  // The premise of the bug: if this stops holding, the four-character floor
  // would no longer have excluded them and this fix's reasoning changes.
  const short = rulesetCharacteristics().filter((name) => name.length <= 3);
  assert.ok(short.length >= 8, "expected three-letter characteristic names");
});

test("every ruleset characteristic can be named in a check ref", () => {
  for (const name of rulesetCharacteristics()) {
    const value = `characteristic:${name.toLowerCase()}`;
    const result = check(value);
    assert.ok(
      result.ok,
      `${value} is refused, so no opposed or combined check can use it: `
        + String(result.message),
    );
  }
});

test("skills, which are long, keep working", () => {
  for (const value of ["skill:stealth", "skill:first-aid", "skill:spot-hidden"]) {
    assert.ok(check(value).ok, `${value} regressed`);
  }
});

test("the floor is three characters, not zero", () => {
  // Lowering a minimum must not open the namespace to arbitrary tokens.
  for (const value of ["characteristic:x", "characteristic:ab"]) {
    assert.equal(check(value).ok, false, `${value} should stay refused`);
  }
});

test("entropy in the namespace is still refused", () => {
  for (const value of [
    "characteristic:9f2c1ab4d7e6c8a1",
    "characteristic:550e8400-e29b-41d4-a716-446655440000",
  ]) {
    assert.equal(check(value).ok, false, `${value} should stay refused`);
  }
});

test("an unapproved namespace is still refused", () => {
  const result = check("route:pow");
  assert.equal(result.ok, false);
  assert.match(
    String(result.message),
    /characteristic:/,
    "the refusal should still name the namespaces that are allowed",
  );
});
