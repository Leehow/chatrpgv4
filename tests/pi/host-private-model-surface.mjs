#!/usr/bin/env node
/**
 * No Pi model-facing surface may reference a host-private operation.
 *
 * The ten-family RuleGraph cutover moved every legacy family operation to
 * `kp_surface: "none"`: the Pi execute ACL refuses them with
 * `host_private_operation`. Each surface that kept naming one produced a
 * real defect — replay cards advertising `coc_invoke` for private ops, the
 * failure advice naming `rules.push`, card labels steering the Keeper into
 * `policy_forbidden`, the mechanical-output gate telling a blocked Keeper
 * to retry through `rules.roll` / `sanity.execute`, and host prompts
 * choreographing combat through `combat.resolve`. Every mention is an
 * invitation to spend a guaranteed-refused round trip at the exact moment
 * the model follows written guidance — a *negative* mention ("never use
 * rules.roll") is equally banned, because it keeps a dead name in the
 * model's working vocabulary.
 *
 * Both axes are DERIVED, never hand-listed, so neither can rot:
 *
 *  1. the operation names and the host-private set come from
 *     `OPERATION_POLICY` (generated from canonical OperationSpec facts and
 *     staleness-locked by test_plugin_mcp) minus the `coc_invoke`
 *     compatibility set (locked to the Python source of truth by
 *     tests/pi/host-invoke-compat-single-source.mjs) — a newly retired
 *     operation is covered the day its policy flips;
 *  2. the checked content is read from the real artifacts: the generated
 *     surface projection, the typed-tool catalog exactly as presented to
 *     the model (descriptions and parameter schemas from the contract
 *     archive), every exported string of the static Pi instruction/label
 *     modules, and the host prompt files.
 *
 * The surface roster below names *artifacts*, not operations: it is the
 * closed list of static places whose text reaches the Keeper model. Code
 * that consumes operation names as data (settle-route processing, identity
 * tables, receipt keys, phase-inference probes in tool-contract-projection
 * and the extensions) is deliberately NOT scanned: canonical receipts carry
 * legacy names forever, and that is host-internal. Runtime producers of
 * cards/hints are covered at their source by
 * `coc_operation_policy.model_invocation_tool` and their own tests.
 * `pi/agents/*.md` are host-side steward subagent briefs (their CLI writes
 * are the designed path for host-private steward ops), not Keeper surfaces.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const lib = (rel) => pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib", rel)).href;

const { OPERATION_POLICY, OPERATIONS_BY_SURFACE } = await import(lib("operation-policy.generated.ts"));
const { HOST_INVOKE_COMPAT_OPERATIONS } = await import(lib("operation-policy.ts"));

const allOperations = Object.keys(OPERATION_POLICY);
assert.ok(allOperations.length > 0, "generated OPERATION_POLICY is empty");

/** Host-private = no model-facing invocation at all (outside coc_invoke compat). */
const hostPrivate = new Set(
  allOperations.filter((operation) =>
    OPERATION_POLICY[operation].kp_surface === "none"
    && !HOST_INVOKE_COMPAT_OPERATIONS.has(operation)
  ),
);
assert.ok(hostPrivate.size > 0, "no host-private operations derived; guard wiring is broken");

/**
 * Exact-token matcher over the FULL operation vocabulary. Boundaries reject
 * partial hits (`rules.roll` must not match inside `rules.roll_dice`), and
 * matching every known operation first means a violation is reported as the
 * operation it names, not a substring accident.
 */
const OPERATION_TOKEN = new RegExp(
  "(?<![A-Za-z0-9_.])("
    + allOperations
      .map((operation) => operation.replace(/\./g, "\\."))
      .sort((left, right) => right.length - left.length)
      .join("|")
    + ")(?![A-Za-z0-9_])",
  "g",
);

function privateMentions(text) {
  const found = new Set();
  for (const match of String(text).matchAll(OPERATION_TOKEN)) {
    if (hostPrivate.has(match[1])) found.add(match[1]);
  }
  return [...found].sort();
}

/** Collect every string reachable from a module's exported plain values. */
function exportedStrings(moduleNamespace) {
  const strings = [];
  const seen = new Set();
  const walk = (value, trail) => {
    if (typeof value === "string") {
      strings.push({ trail, value });
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (value instanceof Map) {
      for (const [key, entry] of value) walk(entry, `${trail}[${String(key)}]`);
      return;
    }
    if (value instanceof Set || Array.isArray(value)) {
      let index = 0;
      for (const entry of value) walk(entry, `${trail}[${index++}]`);
      return;
    }
    for (const [key, entry] of Object.entries(value)) walk(entry, `${trail}.${key}`);
  };
  for (const [name, value] of Object.entries(moduleNamespace)) {
    if (typeof value === "function") continue;
    walk(value, name);
  }
  return strings;
}

function assertClean(entries, surface) {
  const violations = [];
  for (const { trail, value } of entries) {
    const mentions = privateMentions(value);
    if (mentions.length) {
      violations.push(`${surface} :: ${trail} names ${mentions.join(", ")}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `${surface} references host-private operations the execute ACL will refuse`,
  );
}

test("generated working-set surfaces expose no host-private operation", () => {
  for (const [surface, operations] of Object.entries(OPERATIONS_BY_SURFACE)) {
    for (const operation of operations) {
      assert.ok(
        !hostPrivate.has(operation)
          && OPERATION_POLICY[operation]?.kp_surface !== "none",
        `surface ${surface} lists host-private operation ${operation}`,
      );
    }
  }
});

test("typed-tool catalog binds no host-private operation and describes none", async () => {
  const typed = await import(lib("typed-tools.ts"));
  const catalog = typed.defaultTypedToolCatalog();
  assert.ok(catalog.byOperation.size > 0, "typed catalog is empty");
  const entries = [];
  for (const [operation, tool] of catalog.byOperation) {
    assert.ok(
      !hostPrivate.has(operation),
      `typed tool ${tool.name} binds host-private operation ${operation}`,
    );
    entries.push({ trail: `${tool.name}.description`, value: tool.description });
    entries.push({
      trail: `${tool.name}.parameters`,
      value: JSON.stringify(tool.parameters),
    });
  }
  assertClean(entries, "typed-tools catalog");
});

test("static instruction and label modules name no host-private operation", async () => {
  // Static Pi modules whose exported strings reach the Keeper model:
  // typed-tool/domain-tool labels, gate refusal instructions, system
  // instructions, recovery guidance, briefings, working-set constants.
  // `exports: null` scans every exported plain value; a named list scopes a
  // mixed module to its model-facing exports (domain-tools also re-exports
  // the ACL's own refusal sets, which legitimately enumerate private ops).
  const surfaces = [
    { rel: "domain-tools.ts", exports: ["DOMAIN_TOOL_LABELS", "DOMAIN_TOOL_DESCRIPTIONS"] },
    { rel: "mechanical-output-gate.ts", exports: null },
    { rel: "turn-output-gate.ts", exports: null },
    { rel: "system-instruction.ts", exports: null },
    { rel: "keeper-briefing.ts", exports: null },
    { rel: "recovery-guidance.ts", exports: null },
    { rel: "tool-working-set.ts", exports: null },
    { rel: "welcome.ts", exports: null },
  ];
  for (const { rel, exports } of surfaces) {
    const moduleNamespace = await import(lib(rel));
    const scanned = exports === null
      ? moduleNamespace
      : Object.fromEntries(exports.map((name) => {
        assert.ok(name in moduleNamespace, `${rel} no longer exports ${name}`);
        return [name, moduleNamespace[name]];
      }));
    assertClean(exportedStrings(scanned), rel);
  }
});

test("host prompt files name no host-private operation", () => {
  const promptDir = path.join(root, "plugins/coc-keeper/pi/prompts");
  const prompts = fs.readdirSync(promptDir).filter((name) => name.endsWith(".md"));
  assert.ok(prompts.length > 0, "no host prompt files found");
  for (const name of prompts) {
    const text = fs.readFileSync(path.join(promptDir, name), "utf8");
    assertClean([{ trail: name, value: text }], `prompts/${name}`);
  }
});

test("visible operation contracts describe no host-private operation", async () => {
  // The archive is what typed tools and discovery present for every
  // model-invocable operation; a visible operation's summary/description/
  // schema steering the Keeper at a private one is the same defect class.
  const archive = JSON.parse(fs.readFileSync(
    path.join(root, "plugins/coc-keeper/references/mcp-operation-contracts.json"),
    "utf8",
  ));
  const entries = [];
  for (const [operation, contract] of Object.entries(archive.operations)) {
    if (hostPrivate.has(operation)) continue;
    if (OPERATION_POLICY[operation]?.kp_surface === "none"
      && !HOST_INVOKE_COMPAT_OPERATIONS.has(operation)) continue;
    entries.push({ trail: `${operation}.summary`, value: contract.summary });
    entries.push({ trail: `${operation}.description`, value: contract.description });
    entries.push({
      trail: `${operation}.inputSchema`,
      value: JSON.stringify(contract.inputSchema),
    });
  }
  assert.ok(entries.length > 0, "no visible operation contracts found");
  assertClean(entries, "mcp-operation-contracts");
});
