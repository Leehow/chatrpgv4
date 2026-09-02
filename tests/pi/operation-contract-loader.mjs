#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const archivePath = path.join(
  root,
  "plugins/coc-keeper/references/mcp-operation-contracts.json",
);
const mod = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/operation-contracts.ts")).href
);
const policyMod = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/operation-policy.ts")).href
);

const archive = JSON.parse(readFileSync(archivePath, "utf8"));
const EXPECTED = [
  "rules.roll",
  "rules.social_adjudicate",
  "magic.cast",
  "magic.learn",
  "npc.reaction",
  "state.journal",
  "turn.output_context",
  "turn.finalize",
];

test("loads every archive operation with unique names", () => {
  const catalog = mod.loadOperationContracts(archivePath);
  const names = mod.listOperationNames(catalog);
  assert.equal(names.length, archive.operation_count);
  assert.equal(names.length, Object.keys(archive.operations).length);
  assert.equal(new Set(names).size, names.length);
  for (const name of Object.keys(archive.operations).sort()) {
    assert.ok(catalog.operations.has(name), name);
  }
});

test("spotlight schemas match archive inputSchema exactly", () => {
  const catalog = mod.loadOperationContracts(archivePath);
  for (const name of EXPECTED) {
    assert.deepEqual(
      mod.operationInputSchema(catalog, name),
      archive.operations[name].inputSchema,
      name,
    );
    const schema = catalog.operations.get(name).inputSchema;
    assert.notEqual(schema, archive.operations[name].inputSchema);
    assert.ok("required" in schema);
    assert.ok("properties" in schema);
  }
});

test("policy filters are pure and do not invent operations", () => {
  const catalog = mod.loadOperationContracts(archivePath);
  // `domain` asks which operations belong to a KP surface. That is a wider
  // question than which operations the surface lists: an operation reached
  // only by exact name (`discovery: "exact"`) belongs to its surface without
  // being browsable there. The two sets coincided until the first exact-
  // discovery rules operation shipped, so assert each against its own source.
  const rules = mod.filterOperationNames(catalog, { domain: "rules" });
  assert.deepEqual(
    rules,
    Object.keys(policyMod.OPERATION_POLICY)
      .filter((name) => catalog.operations.has(name))
      .filter((name) => policyMod.OPERATION_POLICY[name].kp_surface === "rules")
      .sort(),
  );
  const browsable = [...policyMod.OPERATIONS_BY_SURFACE.rules].sort();
  assert.deepEqual(
    browsable,
    rules.filter((name) => policyMod.OPERATION_POLICY[name].discovery === "surface"),
  );
  const live = mod.filterOperationNames(catalog, { phase: "live_turn" });
  for (const name of live) {
    assert.ok(policyMod.OPERATION_POLICY[name].phases.includes("live_turn"), name);
  }
  const setup = mod.filterOperationNames(catalog, { role: "setup" });
  for (const name of setup) {
    assert.ok(
      policyMod.sessionRolesForPolicy(name, policyMod.OPERATION_POLICY[name]).includes("setup"),
      name,
    );
  }
  assert.ok(setup.includes("setup.inspect"));
  assert.ok(!setup.includes("rules.roll"));
  assert.equal(policyMod.OPERATION_POLICY["magic.cast"].discovery, "exact");
  assert.equal(policyMod.OPERATION_POLICY["magic.learn"].kp_surface, "none");
  assert.equal(policyMod.OPERATION_POLICY["rules.context"].kp_surface, "rules");
  assert.equal(policyMod.OPERATION_POLICY["rules.context"].discovery, "surface");
  assert.equal(policyMod.OPERATION_POLICY["rules.settle"].kp_surface, "rules");
});

test("missing and malformed contracts fail closed", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-coc-op-contract-"));
  const missing = path.join(dir, "absent.json");
  assert.throws(() => mod.loadOperationContracts(missing), (err) => {
    assert.equal(err.code, "missing_archive");
    return true;
  });

  const badJson = path.join(dir, "bad.json");
  writeFileSync(badJson, "{");
  assert.throws(() => mod.loadOperationContracts(badJson), (err) => {
    assert.equal(err.code, "malformed_archive");
    return true;
  });

  const noOps = path.join(dir, "no-ops.json");
  writeFileSync(noOps, JSON.stringify({
    kind: "mcp_operation_contracts",
    schema_version: 1,
    operations: {},
    operation_count: 0,
  }));
  assert.throws(() => mod.loadOperationContracts(noOps), (err) => {
    assert.equal(err.code, "malformed_archive");
    return true;
  });

  const badRow = path.join(dir, "bad-row.json");
  writeFileSync(badRow, JSON.stringify({
    kind: "mcp_operation_contracts",
    schema_version: 1,
    operation_count: 1,
    operations: {
      "rules.roll": { canonical_operation: "rules.roll" },
    },
  }));
  assert.throws(() => mod.loadOperationContracts(badRow), (err) => {
    assert.equal(err.code, "malformed_input_schema");
    return true;
  });

  const noDescription = path.join(dir, "no-description.json");
  writeFileSync(noDescription, JSON.stringify({
    kind: "mcp_operation_contracts",
    schema_version: 1,
    operation_count: 1,
    operations: {
      "rules.roll": {
        canonical_operation: "rules.roll",
        inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
      },
    },
  }));
  assert.throws(() => mod.loadOperationContracts(noDescription), (err) => {
    assert.equal(err.code, "malformed_contract");
    return true;
  });

  const mismatch = path.join(dir, "mismatch.json");
  writeFileSync(mismatch, JSON.stringify({
    kind: "mcp_operation_contracts",
    schema_version: 1,
    operation_count: 1,
    operations: {
      "rules.roll": {
        canonical_operation: "other.op",
        inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
      },
    },
  }));
  assert.throws(() => mod.loadOperationContracts(mismatch), (err) => {
    assert.equal(err.code, "malformed_contract");
    return true;
  });

  const catalog = mod.loadOperationContracts(archivePath);
  assert.throws(() => mod.getOperationContract(catalog, "not.a.real.op"), (err) => {
    assert.equal(err.code, "unknown_operation");
    return true;
  });
});
