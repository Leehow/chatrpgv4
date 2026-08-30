#!/usr/bin/env node
/**
 * Single-source lock: KP-facing closed identity grammars must equal the
 * validator maps in tool-contract-projection.ts. Parse the validator
 * source; fail on docs/overlay/live-probe divergence.
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
const GRAMMAR_TABLE_DOCS = [
  "plugins/coc-keeper/skills/coc-keeper-play/references/turn-tooling-and-typed-ops.md",
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

function parseConstCollectionBody(source, constName) {
  const match = new RegExp(
    `const ${constName}[\\s\\S]*?=\\s*new (?:Map|Set)\\(\\[([\\s\\S]*?)\\]\\);`,
  ).exec(source);
  assert.ok(match, `${constName} not found in validator source`);
  return match[1];
}

function parseMapKeys(source, constName) {
  const body = parseConstCollectionBody(source, constName);
  const keys = [...body.matchAll(/^\s*\["([^"]+)"/gm)].map((row) => row[1]);
  assert.ok(keys.length > 0, `${constName} parsed empty`);
  return keys;
}

function parseSetKeys(source, constName) {
  const body = parseConstCollectionBody(source, constName);
  const keys = [...body.matchAll(/"([^"]+)"/g)].map((row) => row[1]);
  assert.ok(keys.length > 0, `${constName} parsed empty`);
  return keys;
}

function parseClosedGrammarFieldsFromValidatorSource(source) {
  const never = new Set(parseSetKeys(source, "RAW_NEVER_MODEL_AUTHORED_FIELDS"));
  const fields = new Set([
    "decision_id",
    ...parseMapKeys(source, "RAW_COMPOSED_FIELDS"),
    ...parseMapKeys(source, "RAW_ECHOED_FIELDS"),
    ...parseMapKeys(source, "RAW_HANDLE_ONLY"),
    ...parseMapKeys(source, "RAW_HANDLE_OR_NAMESPACE"),
    ...parseSetKeys(source, "RAW_PROVENANCE_FIELDS"),
    ...parseSetKeys(source, "RAW_VOCABULARY_FIELDS"),
  ]);
  return [...fields].filter((field) => !never.has(field)).sort(sortIdentityFields);
}

function sortIdentityFields(a, b) {
  if (a === "decision_id") return -1;
  if (b === "decision_id") return 1;
  return a.localeCompare(b);
}

function collectPresentedSuffixDecisionIdFields(schema, acc = new Set()) {
  if (!schema || typeof schema !== "object") return acc;
  if (schema.properties && typeof schema.properties === "object") {
    for (const [field, prop] of Object.entries(schema.properties)) {
      if (field.endsWith("_decision_id")) acc.add(field);
      collectPresentedSuffixDecisionIdFields(prop, acc);
    }
  }
  if (Object.hasOwn(schema, "items")) {
    if (Array.isArray(schema.items)) {
      for (const item of schema.items) {
        collectPresentedSuffixDecisionIdFields(item, acc);
      }
    } else {
      collectPresentedSuffixDecisionIdFields(schema.items, acc);
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    collectPresentedSuffixDecisionIdFields(schema.additionalProperties, acc);
  }
  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
    if (!Array.isArray(schema[key])) continue;
    for (const entry of schema[key]) {
      collectPresentedSuffixDecisionIdFields(entry, acc);
    }
  }
  return acc;
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

function isStringishIdentitySchema(prop) {
  if (!prop || typeof prop !== "object") return false;
  const type = prop.type;
  if (type === "string") return true;
  if (Array.isArray(type) && type.includes("string")) return true;
  if (type === "array" || Object.hasOwn(prop, "items")) return true;
  if (Array.isArray(prop.enum) && prop.enum.every((value) => typeof value === "string")) {
    return true;
  }
  return false;
}

function assertPresentedOverlay(description, spec, label) {
  assert.ok(
    description.includes(spec.marker),
    `${label} missing marker ${spec.marker}`,
  );
  if (spec.kind !== "decision") {
    assert.ok(
      description.includes(spec.acceptedForm),
      `${label} missing accepted form`,
    );
  }
  assert.ok(
    description.includes(spec.rightExample),
    `${label} missing RIGHT ${spec.rightExample}`,
  );
  assert.equal(
    description.includes("WRONG:"),
    false,
    `${label} still contains unframed WRONG:`,
  );
  if (!spec.rightExample.includes(spec.wrongExample)) {
    assert.equal(
      description.includes(spec.wrongExample),
      false,
      `${label} still contains WRONG literal ${spec.wrongExample}`,
    );
  }
}

function collectFieldDescriptions(schema, acc = new Map()) {
  if (!schema || typeof schema !== "object") return acc;
  if (schema.properties && typeof schema.properties === "object") {
    for (const [field, prop] of Object.entries(schema.properties)) {
      if (!prop || typeof prop !== "object") continue;
      if (isStringishIdentitySchema(prop) && typeof prop.description === "string") {
        const list = acc.get(field) ?? [];
        list.push(prop.description);
        acc.set(field, list);
      }
      collectFieldDescriptions(prop, acc);
    }
  }
  if (Object.hasOwn(schema, "items")) {
    if (Array.isArray(schema.items)) {
      for (const item of schema.items) collectFieldDescriptions(item, acc);
    } else {
      collectFieldDescriptions(schema.items, acc);
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    collectFieldDescriptions(schema.additionalProperties, acc);
  }
  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
    if (!Array.isArray(schema[key])) continue;
    for (const entry of schema[key]) collectFieldDescriptions(entry, acc);
  }
  return acc;
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
    assert.equal(description.includes("first-impression-arty-wilmot"), false);
    assert.equal(description.includes("persuade-arty-morgue-access"), false);
    assert.match(description, /roll-persuade-arty-access-v1/);
    assert.equal(description.includes("WRONG:"), false);
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

test("closed-grammar fields from validator source are covered by docs, overlays, and live probes", async () => {
  const validatorSource = readFileSync(VALIDATOR_SOURCE, "utf8");
  const sourceFields = parseClosedGrammarFieldsFromValidatorSource(validatorSource);
  const typed = await import(
    pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts")).href
  );
  const presented = typed.defaultTypedToolCatalog();
  const suffixFields = new Set();
  for (const tool of presented.byOperation.values()) {
    collectPresentedSuffixDecisionIdFields(tool.parameters, suffixFields);
  }
  const expectedFields = [...new Set([...sourceFields, ...suffixFields])]
    .sort(sortIdentityFields);
  const catalog = typed.closedIdentityGrammarCatalog();
  const liveFields = catalog.map((row) => row.field);
  assert.deepEqual(
    liveFields,
    expectedFields,
    "catalog drifted from validator source maps ∪ presented *_decision_id fields",
  );
  assert.ok(sourceFields.includes("decision_id"));
  assert.ok(sourceFields.includes("claim_id"));
  assert.ok(sourceFields.includes("matched_affordance_ids"));
  assert.equal(sourceFields.includes("run_segment_id"), false);
  assert.equal(sourceFields.includes("first_impression_ref"), false);
  assert.ok(
    suffixFields.has("original_check_decision_id"),
    "presented schemas must still expose original_check_decision_id",
  );
  for (const field of suffixFields) {
    assert.ok(
      liveFields.includes(field),
      `presented suffix field ${field} missing from catalog`,
    );
    assert.equal(
      typed.closedIdentityGrammarSpec(field)?.kind,
      "decision",
      `${field} must use the decision grammar`,
    );
  }

  const heading = typed.CLOSED_IDENTITY_GRAMMAR_TABLE_HEADING;
  for (const rel of GRAMMAR_TABLE_DOCS) {
    const text = readFileSync(path.join(root, rel), "utf8");
    assert.ok(text.includes(heading), `${rel} missing ${heading}`);
    for (const spec of catalog) {
      const rowRe = new RegExp(
        `\\|\\s*\`${spec.field}\`\\s*\\|`,
      );
      const line = text.split("\n").find((candidate) => rowRe.test(candidate));
      assert.ok(line, `${rel} missing table row for ${spec.field}`);
      assert.ok(
        line.includes(spec.acceptedForm),
        `${rel} ${spec.field} row missing accepted form`,
      );
      assert.ok(
        line.includes(`\`${spec.rightExample}\``),
        `${rel} ${spec.field} row missing RIGHT ${spec.rightExample}`,
      );
      assert.ok(
        line.includes(`\`${spec.wrongExample}\``),
        `${rel} ${spec.field} row missing framed WRONG ${spec.wrongExample}`,
      );
      assert.ok(
        line.includes(typed.CLOSED_IDENTITY_GRAMMAR_WRONG_FRAME),
        `${rel} ${spec.field} row missing ${typed.CLOSED_IDENTITY_GRAMMAR_WRONG_FRAME}`,
      );
    }
  }

  const descriptions = new Map();
  for (const tool of presented.byOperation.values()) {
    collectFieldDescriptions(tool.parameters, descriptions);
  }
  for (const field of suffixFields) {
    const spec = typed.closedIdentityGrammarSpec(field);
    assert.ok(spec, field);
    const seen = descriptions.get(field) ?? [];
    assert.ok(seen.length > 0, `presented ${field} has no stringish description`);
    for (const description of seen) {
      assertPresentedOverlay(description, spec, `presented suffix ${field}`);
    }
  }
  for (const spec of catalog) {
    const seen = descriptions.get(spec.field) ?? [];
    for (const description of seen) {
      assertPresentedOverlay(description, spec, `presented ${spec.field}`);
    }
  }
  const advise = presented.byOperation.get("actions.advise");
  assert.ok(advise);
  const matched = advise.parameters.properties.intent_evidence
    ?.properties?.matched_affordance_ids?.description ?? "";
  assert.ok(matched.includes("Closed matched_affordance_ids grammar"));
  assert.ok(matched.includes("affordance:example-slug"));
  assert.ok(matched.includes("copied verbatim"));
  assert.ok(matched.includes("never synthesized from route_id"));
  assert.equal(matched.includes("route:commission-briefing-8"), false);
  assert.equal(matched.includes("WRONG:"), false);
  const finalize = presented.byOperation.get("turn.finalize");
  assert.ok(finalize);
  const claimDesc = finalize.parameters.properties.agency_claims
    ?.items?.properties?.claim_id?.description ?? "";
  assert.ok(claimDesc.includes("Closed claim_id grammar"));
  assert.ok(claimDesc.includes("claim-sit-notebook-smoke"));
  assert.equal(claimDesc.includes("WRONG:"), false);

  const live = (field, value) => (
    typed.validateRawModelIdentityPayload({ [field]: value }).ok === true
  );
  for (const spec of catalog) {
    assert.equal(
      live(spec.field, spec.rightExample),
      true,
      `${spec.field} expected ACCEPT ${spec.rightExample}`,
    );
    assert.equal(
      live(spec.field, spec.wrongExample),
      false,
      `${spec.field} expected REJECT ${spec.wrongExample}`,
    );
    const rejected = typed.validateRawModelIdentityPayload({
      [spec.field]: spec.wrongExample,
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.field, spec.field);
    if (spec.kind !== "vocabulary") {
      assert.ok(
        rejected.message.includes(spec.acceptedForm),
        `${spec.field} error missing accepted form: ${rejected.message}`,
      );
      assert.ok(
        rejected.message.includes(`RIGHT: ${spec.rightExample}`),
        `${spec.field} error missing RIGHT`,
      );
      assert.ok(
        rejected.message.includes(`WRONG: ${spec.wrongExample}`),
        `${spec.field} error missing WRONG`,
      );
    }
  }

  const push = presented.byOperation.get("rules.push");
  assert.ok(push);
  const originalCheck = push.parameters.properties.original_check_decision_id
    ?.description ?? "";
  assert.ok(originalCheck.includes("Closed decision_id grammar"));
  assert.ok(originalCheck.includes("roll-persuade-arty-access-v1"));
  assert.equal(originalCheck.includes("first-impression-arty-wilmot"), false);
  assert.equal(originalCheck.includes("WRONG:"), false);

  const bannedPresentedLiterals = [
    "route:commission-briefing-8",
    "route:commission-briefing-9",
    "route:commission-briefing-10",
    "route:commission-briefing-11",
  ];
  for (const [field, seen] of descriptions) {
    for (const description of seen) {
      for (const banned of bannedPresentedLiterals) {
        assert.equal(
          description.includes(banned),
          false,
          `presented ${field} still contains rejected literal ${banned}`,
        );
      }
    }
  }

  const campaign04 = [
    ["claim_id", "sit-notebook-smoke", false],
    ["claim_id", "claim-sit-notebook-smoke", true],
    ["claim_id", "claim:sit-notebook-smoke", false],
    ["claim_id", "agency-sit-notebook-smoke", true],
    // Campaign-10 contract: the copied affordance handle is the ONLY
    // accepted form. The 04/05/10 guess ladder (route: → affordance: →
    // bare slug) fails closed except for the verbatim handle.
    ["matched_affordance_ids", "route:commission-briefing-8", false],
    ["matched_affordance_ids", "affordance:commission-briefing-8", true],
    ["matched_affordance_ids", "search-clippings", false],
    ["matched_affordance_ids", "route:<route_id>", false],
    ["decision_id", "quick-start:x:finalize", true],
    ["original_check_decision_id", "roll-persuade-arty-access-v1", true],
    ["original_check_decision_id", "first-impression-arty-wilmot", false],
  ];
  for (const [field, value, expect] of campaign04) {
    assert.equal(
      live(field, value),
      expect,
      `campaign-04 probe ${field}=${value} expected ${expect ? "ACCEPT" : "REJECT"}`,
    );
  }
});
