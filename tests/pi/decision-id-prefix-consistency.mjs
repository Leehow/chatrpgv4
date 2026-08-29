#!/usr/bin/env node
/**
 * Single-source lock: KP-facing documented decision_id prefixes must equal
 * the validator's DECISION_ID_PREFIXES. Parse both; fail on divergence.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());

const VALIDATOR_SOURCE = path.join(
  root,
  "plugins/coc-keeper/pi/lib/tool-contract-projection.ts",
);
const DOC_PATHS = [
  "plugins/coc-keeper/skills/coc-keeper-play/references/turn-tooling-and-typed-ops.md",
  "plugins/coc-keeper/skills/coc-keeper-play/SKILL.md",
  "plugins/coc-keeper/pi/prompts/host-system-play.md",
];

const DOC_HEADING = (
  "Closed `decision_id` prefixes (validator `DECISION_ID_PREFIXES`):"
);

function parseValidatorPrefixes(source) {
  const match = /const DECISION_ID_PREFIXES: readonly string\[\] = \[([\s\S]*?)\];/
    .exec(source);
  assert.ok(match, "DECISION_ID_PREFIXES array not found in validator source");
  const prefixes = [...match[1].matchAll(/"([^"]+)"/g)].map((row) => row[1]);
  assert.ok(prefixes.length > 0, "DECISION_ID_PREFIXES parsed empty");
  return prefixes;
}

function parseDocumentedPrefixes(text, label) {
  const headingIdx = text.indexOf(DOC_HEADING);
  assert.notEqual(headingIdx, -1, `${label} missing documented prefix heading`);
  const after = text.slice(headingIdx + DOC_HEADING.length);
  const lineMatch = /^\s*((?:`[^`]+-`\s*)+)/.exec(after);
  assert.ok(lineMatch, `${label} missing documented prefix line after heading`);
  const prefixes = [...lineMatch[1].matchAll(/`([^`]+-)`/g)].map((row) => row[1]);
  assert.ok(prefixes.length > 0, `${label} documented prefix line parsed empty`);
  return prefixes;
}

test("documented decision_id prefixes equal validator DECISION_ID_PREFIXES", () => {
  const validatorSource = readFileSync(VALIDATOR_SOURCE, "utf8");
  const validator = parseValidatorPrefixes(validatorSource);
  for (const rel of DOC_PATHS) {
    const documented = parseDocumentedPrefixes(
      readFileSync(path.join(root, rel), "utf8"),
      rel,
    );
    assert.deepEqual(documented, validator, rel);
  }
});

test("typed tool decision_id descriptions carry the closed grammar at point of use", async () => {
  const typed = await import(
    pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts")).href
  );
  const catalog = typed.defaultTypedToolCatalog();
  const prefixes = typed.DECISION_ID_PREFIXES;
  assert.ok(Array.isArray(prefixes) && prefixes.length > 0);
  for (const operation of ["rules.roll", "npc.reaction"]) {
    const tool = catalog.byOperation.get(operation);
    assert.ok(tool, operation);
    const field = tool.parameters.properties.decision_id;
    assert.ok(field, `${operation} must present decision_id`);
    const description = field.description;
    assert.equal(typeof description, "string");
    assert.match(description, /Closed decision_id grammar/);
    for (const prefix of prefixes) {
      assert.ok(
        description.includes(prefix),
        `${operation} decision_id description missing prefix ${prefix}`,
      );
    }
    assert.match(description, /first-impression-arty-wilmot/);
    assert.match(description, /persuade-arty-morgue-access/);
    assert.match(description, /roll-persuade-arty-access-v1/);
    assert.equal(description.includes(typed.DECISION_ID_FIELD_DESCRIPTION), true);
    assert.equal(description.includes(typed.DECISION_ID_ANY_PREFIX_SENTENCE), true);
    assert.equal(description.includes(typed.DECISION_ID_TN_SCOPE_SENTENCE), true);
    assert.equal(description.includes(typed.DECISION_ID_FINALIZE_SCOPE_SENTENCE), true);
  }
});

test("each documented grammar sentence is pinned to live validateRawModelIdentityPayload", async () => {
  const typed = await import(
    pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts")).href
  );
  const live = (value) => typed.validateRawModelIdentityPayload({ decision_id: value }).ok === true;
  const slug = "persuade-arty-access-v1";
  const table = [
    {
      sentence: typed.DECISION_ID_ANY_PREFIX_SENTENCE,
      accept: [
        ...typed.DECISION_ID_PREFIXES.map((prefix) => `${prefix}${slug}`),
        "npc-first-impression-arty-wilmot",
        "roll-first-impression-arty-wilmot",
      ],
      reject: ["first-impression-arty-wilmot", "persuade-arty-morgue-access"],
    },
    {
      sentence: typed.DECISION_ID_TN_SCOPE_SENTENCE,
      accept: [`t3-roll-${slug}`, `t3-npc-${slug}`],
      reject: ["t3-quick-start:x", "t3-setup-complete:x", "t3-quick-start:x:finalize"],
    },
    {
      sentence: typed.DECISION_ID_FINALIZE_SCOPE_SENTENCE,
      accept: [
        `roll-${slug}:finalize`,
        "quick-start:x:finalize",
        "setup-complete:x:finalize",
      ],
      reject: [],
    },
  ];
  const overlay = typed.DECISION_ID_FIELD_DESCRIPTION;
  for (const rel of DOC_PATHS) {
    const text = readFileSync(path.join(root, rel), "utf8");
    assert.equal(
      text.includes("must use the `roll-` prefix"),
      false,
      `${rel} still claims roll- exclusivity`,
    );
    assert.equal(
      text.includes("never to `quick-start:` / `setup-complete:` colon forms."),
      true,
    );
    for (const row of table) {
      assert.ok(text.includes(row.sentence), `${rel} missing ${row.sentence}`);
      assert.ok(overlay.includes(row.sentence), `overlay missing ${row.sentence}`);
      for (const value of row.accept) {
        assert.equal(live(value), true, `${row.sentence} expected ACCEPT ${value}`);
      }
      for (const value of row.reject) {
        assert.equal(live(value), false, `${row.sentence} expected REJECT ${value}`);
      }
    }
  }
});
