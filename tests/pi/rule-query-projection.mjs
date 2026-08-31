#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const projection = await import(
  pathToFileURL(
    path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts"),
  ).href
);

function project(operation, envelope) {
  const diagnostics = { unmapped: [] };
  const visible = projection.projectModelVisibleCanonicalResult(
    operation,
    envelope,
    null,
    diagnostics,
  );
  return { visible, diagnostics: diagnostics.unmapped };
}

test("rules.skill_describe keeps semantic skill catalog identities model-visible", () => {
  const canonical = {
    ok: true,
    tool: "rules.skill_describe",
    wire: {
      full_result_sha256:
        "sha256:f1697b5ca3031f0d14e4bd47fc06bce058d80f6b1495cb1c81a4d1e7ba546539",
    },
    data: {
      schema_version: 1,
      requested: ["Library Use"],
      skills: {
        "Library Use": {
          base_chance: 20,
          summary: "Find information in a library or archive.",
        },
      },
      missing: [],
      catalog_skill_ids: [
        "Credit Rating",
        "Firearms (Rifle/Shotgun)",
        "Library Use",
      ],
      selection_policy: {
        id: "interpersonal-disambiguation",
        title: "Interpersonal Skills: Disambiguation",
      },
    },
  };

  const { visible, diagnostics } = project("rules.skill_describe", canonical);

  assert.deepEqual(diagnostics, []);
  assert.equal(visible.ok, true);
  assert.equal(visible.data.skills["Library Use"].base_chance, 20);
  assert.deepEqual(visible.data.catalog_skill_ids, [
    "Credit Rating",
    "Firearms (Rifle/Shotgun)",
    "Library Use",
  ]);
  assert.equal(
    visible.data.selection_policy.id,
    "interpersonal-disambiguation",
  );
  assert.ok(!Object.hasOwn(visible, "wire"));
  assert.ok(!JSON.stringify(visible).includes("f1697b5ca3031f0d"));
});

test("rules.build_scale keeps mechanics while its citation ref stays host-only", () => {
  const canonical = {
    ok: true,
    tool: "rules.build_scale",
    data: {
      comparison: {
        actor_build: 2,
        target_build: 2,
        relative_build: 0,
        lift_throw: {
          verdict: "carried_briefly",
          note: "a target of equal build can be carried briefly",
        },
        maneuver: { penalty_dice: 0, impossible: false },
        rule_ref: "keeper-rulebook p.279 (Table XV), p.105",
      },
    },
  };

  const direct = project("rules.build_scale", canonical);
  assert.deepEqual(direct.diagnostics, []);
  assert.equal(direct.visible.ok, true);
  assert.equal(direct.visible.data.comparison.relative_build, 0);
  assert.equal(direct.visible.data.comparison.rule_ref, undefined);

  const outputContext = project("turn.output_context", {
    ok: true,
    tool: "turn.output_context",
    data: {
      obligations: [],
      required_obligation_ids: [],
      mechanics_summary: {
        public_check: [],
        state_delta: [],
        exceptional_effect: [],
        concealed_consequence: [],
      },
      candidate_factors: [{
        tool: "rules.build_scale",
        data: canonical.data,
      }],
    },
  });
  assert.deepEqual(outputContext.diagnostics, []);
  assert.equal(outputContext.visible.ok, true);
  assert.equal(
    outputContext.visible.data.candidate_factors[0].data.comparison.relative_build,
    0,
  );
  assert.equal(
    outputContext.visible.data.candidate_factors[0].data.comparison.rule_ref,
    undefined,
  );
});

test("rules.skill_describe rejects opaque values disguised as skill identities", () => {
  const opaque =
    "sha256:f1697b5ca3031f0d14e4bd47fc06bce058d80f6b1495cb1c81a4d1e7ba546539";
  const { visible, diagnostics } = project("rules.skill_describe", {
    ok: true,
    tool: "rules.skill_describe",
    data: {
      schema_version: 1,
      requested: [],
      skills: {},
      missing: [],
      catalog_skill_ids: ["Library Use", opaque],
      selection_policy: { id: opaque },
    },
  });

  assert.deepEqual(visible.data.catalog_skill_ids, ["Library Use"]);
  assert.deepEqual(diagnostics, [{
    field: "catalog_skill_ids",
    parentField: "catalog_skill_ids",
    domain: "skill_catalog",
    path: "catalog_skill_ids",
  }, {
    field: "id",
    parentField: "id",
    domain: "unknown",
  }]);
  assert.ok(!JSON.stringify(visible).includes(opaque));
});

test("state.cash_query remains a model-visible read-only empty ledger", () => {
  const { visible, diagnostics } = project("state.cash_query", {
    ok: true,
    tool: "state.cash_query",
    data: { schema_version: 2, balances: {}, ledger: [] },
  });

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(visible.data, {
    schema_version: 2,
    balances: {},
    ledger: [],
  });
});

test("state.finance_query preserves a canonical missing-state business gap", () => {
  const { visible, diagnostics } = project("state.finance_query", {
    ok: false,
    tool: "state.finance_query",
    error: {
      code: "state_corrupt",
      message: "runtime finance state is missing",
      retryable: false,
      class: "invariant_terminal",
      recoverable_by: "none",
      allowed_next_actions: [],
    },
  });

  assert.deepEqual(diagnostics, []);
  assert.equal(visible.ok, false);
  assert.deepEqual(visible.error, {
    code: "state_corrupt",
    message: "runtime finance state is missing",
    retryable: false,
    class: "invariant_terminal",
    recoverable_by: "none",
    allowed_next_actions: [],
  });
});
