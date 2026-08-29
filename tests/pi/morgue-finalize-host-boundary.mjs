#!/usr/bin/env node
// Host-boundary morgue regression: KP-visible semantic obligation handles
// are projected from turn.output_context and restored to kind-prefixed
// Python join keys through the REAL tool-contract-projection path.
// Does not import extensions (no pi-tui). Optional pipe mode consumes a
// live output_context JSON and writes restored coverage for toolbox finalize.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const {
  createSemanticIdentityRegistry,
} = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/semantic-identity-registry.ts")
);
const {
  projectModelVisibleCanonicalResult,
  restoreSemanticEntityHandles,
} = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts")
);

const HEX_RUN = /[0-9a-f]{16,}/i;
const ROLL_SOURCE = "npc-first-impression-roll-v2:" + "c".repeat(40);
const FI_SOURCE = "npc-first-impression-v2:" + "d".repeat(40);
const TALK_SOURCE = "toolbox-fast-talk-000007";

const scopeAt = (overrides = {}) => ({
  sessionEpoch: 1,
  campaign: "morgue-host-boundary",
  playerTurnEpoch: 1,
  ...overrides,
});

function registerOutputContextObligations(registry, data, scope) {
  // Mirrors plugins/coc-keeper/pi/extensions/index.ts turn.output_context
  // observation: kind-prefixed non-roll ids stay canonical; roll: is stripped
  // so the live roll-domain handle is shared.
  const obligations = Array.isArray(data.obligations) ? data.obligations : [];
  for (const [index, raw] of obligations.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const obligationId = typeof raw.obligation_id === "string"
      ? raw.obligation_id
      : "";
    const canonical = obligationId.startsWith("roll:")
      ? obligationId.slice("roll:".length)
      : obligationId;
    const result = registry.register({
      domain: "roll",
      canonicalId: canonical,
      facts: [
        raw.npc_display_name,
        raw.skill,
        raw.source_kind,
        raw.goal,
        index + 1,
      ],
      scope,
      lifetime: "player_turn",
    });
    assert.equal(
      result.ok,
      true,
      `obligation ${obligationId} must register semantic facts: ${JSON.stringify(result)}`,
    );
    for (
      const effectId
      of Array.isArray(raw.substantive_effect_ids) ? raw.substantive_effect_ids : []
    ) {
      if (typeof effectId !== "string" || !effectId.trim()) continue;
      registry.register({
        domain: "effect",
        canonicalId: effectId,
        facts: [raw.skill, "substantive-effect"],
        scope,
        lifetime: "player_turn",
      });
    }
  }
  for (const rollId of Array.isArray(data.source_roll_ids) ? data.source_roll_ids : []) {
    if (typeof rollId !== "string" || !rollId.trim()) continue;
    registry.register({
      domain: "roll",
      canonicalId: rollId,
      facts: [data.turn_number, "source-roll"],
      scope,
      lifetime: "player_turn",
    });
  }
}

function resolverFor(registry, scope) {
  const resolve = (domain, handle) => {
    const result = registry.resolveHandle(domain, handle, scope);
    return result.ok ? result.canonicalId : null;
  };
  return {
    resolveRoll: (handle) => resolve("roll", handle),
    resolveEffect: (handle) => resolve("effect", handle),
    resolveItem: (handle) => resolve("item", handle),
    resolveWeapon: (handle) => resolve("weapon", handle),
    resolveRoute: (handle) => resolve("route", handle),
  };
}

function assertNoHex(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert.equal(
    HEX_RUN.test(text),
    false,
    `${label} leaks opaque hex: ${text}`,
  );
}

function syntheticObligations() {
  return [
    {
      obligation_id: `roll:${ROLL_SOURCE}`,
      source_kind: "check",
      source_id: ROLL_SOURCE,
      npc_display_name: "档案员",
      skill: "APP",
      goal: "first impression",
    },
    {
      obligation_id: `first-impression:${FI_SOURCE}`,
      source_kind: "first_impression",
      source_id: FI_SOURCE,
      npc_display_name: "档案员",
      skill: null,
      goal: "realize the NPC's first observable response",
    },
    {
      obligation_id: `roll:${TALK_SOURCE}`,
      source_kind: "check",
      source_id: TALK_SOURCE,
      npc_display_name: null,
      skill: "Fast Talk",
      goal: "请档案员让开停尸房入口",
    },
  ];
}

function projectAndRestore(data, coverageTemplates, scope = scopeAt()) {
  const registry = createSemanticIdentityRegistry();
  registerOutputContextObligations(registry, data, scope);
  const semanticIds = registry.projectAll(scope);
  const diagnostics = { unmapped: [] };
  const requiredIds = data.required_obligation_ids
    ?? data.obligations.map((row) => row.obligation_id);
  const envelope = {
    ok: true,
    tool: "turn.output_context",
    data: {
      ...data,
      required_obligation_ids: requiredIds,
    },
  };
  const projected = projectModelVisibleCanonicalResult(
    "turn.output_context",
    envelope,
    semanticIds,
    diagnostics,
  );
  const droppedObligations = diagnostics.unmapped.filter((entry) => (
    entry.field === "obligation_id"
    || entry.field === "required_obligation_ids"
  ));
  assert.deepEqual(
    droppedObligations,
    [],
    `first-impression/roll obligations must project: ${JSON.stringify(droppedObligations)}`,
  );
  const projectedIds = projected.data.required_obligation_ids;
  assert.ok(Array.isArray(projectedIds) && projectedIds.length === data.obligations.length);
  for (const [index, handle] of projectedIds.entries()) {
    assert.equal(typeof handle, "string");
    assert.match(handle, /^roll:/);
    assertNoHex(handle, "projected obligation handle");
    assert.notEqual(
      handle,
      data.obligations[index].obligation_id,
      "KP-visible handle must not be the opaque Python obligation id",
    );
    const sourceId = data.obligations[index].source_id;
    if (typeof sourceId === "string" && HEX_RUN.test(sourceId)) {
      assert.notEqual(handle, sourceId);
    }
  }
  assertNoHex(projected.data.obligations, "projected obligations");
  const projectedRowIds = projected.data.obligations.map((row) => row.obligation_id);
  assert.deepEqual(projectedRowIds, projectedIds);
  for (const row of projected.data.obligations) {
    if (typeof row.source_id === "string") {
      assertNoHex(row.source_id, "projected obligation source_id");
    }
  }
  const templates = coverageTemplates ?? data.obligations.map(() => ({
    realization: "fictional_beat",
    action_realization: "走进停尸房并说明来意",
    response: "档案员抬眼打量",
    causal_explanation: "初见与话术共同决定是否让路",
    persona_fit: "先礼后兵",
    player_input_handling: "specific_preserved",
    exact_excerpt: "档案员抬眼打量",
    exceptional_beat: "",
  }));
  assert.equal(templates.length, projectedIds.length);
  const modelCoverage = templates.map((row, index) => ({
    ...row,
    obligation_id: projectedIds[index],
  }));
  const restored = restoreSemanticEntityHandles(
    "turn.finalize",
    { coverage: modelCoverage },
    null,
    resolverFor(registry, scope),
  );
  assert.equal(restored.ok, true, JSON.stringify(restored));
  const restoredIds = restored.value.coverage.map((row) => row.obligation_id);
  assert.deepEqual(
    restoredIds,
    data.obligations.map((row) => row.obligation_id),
    "semantic handles must restore to the exact kind-prefixed Python obligation ids",
  );
  return {
    projectedHandles: projectedIds,
    restoredCoverage: restored.value.coverage,
    restoredIds,
  };
}

{
  const obligations = syntheticObligations();
  const result = projectAndRestore({ obligations });
  assert.equal(result.projectedHandles.length, 3);
  assert.ok(result.projectedHandles.some((handle) => handle.includes("fast-talk")
    || handle.includes("app")
    || handle.includes("档案员")
    || handle.includes("first-impression")));
}

const contextPath = process.argv[3];
const outPath = process.argv[4];
if (contextPath && outPath) {
  const payload = JSON.parse(readFileSync(contextPath, "utf8"));
  const data = payload.output_context ?? payload;
  const templates = payload.coverage_templates;
  const scope = scopeAt({
    campaign: typeof payload.campaign === "string"
      ? payload.campaign
      : "morgue-host-boundary",
  });
  const result = projectAndRestore(data, templates, scope);
  writeFileSync(outPath, `${JSON.stringify({
    coverage: result.restoredCoverage,
    projected_handles: result.projectedHandles,
    restored_ids: result.restoredIds,
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    projected_handles: result.projectedHandles,
    restored_ids: result.restoredIds,
  })}\n`);
} else {
  console.log("morgue-finalize-host-boundary: all assertions passed");
}
