#!/usr/bin/env node
// Graph-settled roll handle lifecycle + actionable-error projection
// (amaranthine-table3 Stage B live-table defect, 2026-09-01).
//
// Chain under regression:
// 1. `rules.settle` settles a fumble; its canonical percentile evidence is
//    a nested settlement.result.bound_check row, never a rules.roll envelope
//    this gateway observes. The registry MUST register that roll id so the
//    model receives a live `roll:` handle in the projected settle result.
// 2. `state.exceptional_effect` echoes that handle as `source_roll_id`; the
//    host restores the exact canonical roll id before transport.
// 3. A canonical FAILURE naming machine roll ids (state.journal
//    `substantive_exceptional_effect_required`) reaches the model with its
//    code and recovery actions intact — never degraded into the generic
//    `semantic_identity_unavailable` — while machine ids stay host-only:
//    mapped ids project to handles, unmapped ids are dropped/scrubbed.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

process.env.COC_PI_SESSION_ROLE = "play";
delete process.env.PI_SUBAGENT_CHILD;
const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));

const CAMPAIGN = "amaranthine-table3";
const MACHINE_ROLL_ID = "toolbox-amaranthine-table3-000002";
const SETTLE_DECISION_ID = "roll-str-secure-skiff-v3";

// Canonical rules.settle fumble envelope, exactly as the live table produced
// it (bound_check carries the machine roll id; no rules.roll envelope ever
// crosses this gateway for a graph-settled check).
const settleEnvelope = () => ({
  ok: true,
  tool: "rules.settle",
  wire: { full_result_sha256: "d".repeat(64) },
  data: {
    decision_ref: "decision:coc7:core-check:ordinary-check",
    family: "core-check",
    status: "settled",
    rule_refs: [
      "rule:coc7:core-check:canonical-target-binding",
      "rule:coc7:core-check:combined",
      "rule:coc7:push-luck:luck-roll",
    ],
    investigator_id: "tobias-levett",
    event: null,
    player_state_receipt: null,
    current_hp: null,
    conditions: null,
    settlement: {
      existing_result_envelope: true,
      result: {
        bound_check: {
          base_target: 40,
          target: 40,
          required_level: "regular",
          difficulty: "regular",
          required_target: 40,
          effective_target: 40,
          achieved_level: "fumble",
          passed: false,
          success: false,
          surplus_levels: 0,
          outcome: "fumble",
          bonus: 0,
          penalty: 0,
          roll: 99,
          unmodified_roll: 99,
          tens_values: [],
          units: null,
          investigator_id: "tobias-levett",
          skill: "STR",
          target_source: "explicit",
          pushed: false,
          goal: "hurry crew to finish last crates then hold the skiff steady",
          stakes: {
            on_success: "last crates ashore and skiff held",
            on_failure: "skiff yaws; cargo or footing threatened",
          },
          difficulty_basis: "environment",
          roll_id: MACHINE_ROLL_ID,
        },
        outcome: "fumble",
        pushed: false,
        next_continuations: [],
      },
    },
    next_decisions: [],
    authority: "canonical-resolver-state-receipts",
  },
  warnings: [],
  hints: [],
});

// Canonical state.journal refusal exactly as the live table produced it:
// actionable code, machine roll ids in both the prose and the structured
// missing_substantive_effects rows.
const journalErrorEnvelope = () => ({
  ok: false,
  tool: "state.journal",
  wire: { full_result_sha256: "e".repeat(64) },
  error: {
    code: "substantive_exceptional_effect_required",
    message: (
      "state.journal refused before writing because a critical, fumble, or "
      + "pushed-failure outcome lacks a source-bound applied effect: "
      + `roll:${MACHINE_ROLL_ID}`
    ),
    details: {
      journal_committed: false,
      missing_substantive_effects: [{
        obligation_id: `roll:${MACHINE_ROLL_ID}`,
        source_roll_id: MACHINE_ROLL_ID,
        required_direction: "cost",
      }],
      pending_modifier_consumptions: [],
    },
    retryable: false,
    class: "business_precondition",
    recoverable_by: "model_next_action",
    allowed_next_actions: [{
      operation: "state.exceptional_effect",
      action: "apply_source_bound_exceptional_effect",
      reason: "apply the required source-bound exceptional effect before finalizing the frozen turn",
      host_bound: true,
    }],
  },
  warnings: [],
  hints: [],
  isError: true,
});

async function bootHarness() {
  const tools = new Map();
  const transported = [];
  const handlers = new Map();
  const fakePi = {
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand() {},
    registerShortcut() {},
    on(type, handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
    },
    appendEntry() {},
    sendMessage() {},
    setActiveTools() {},
    getThinkingLevel: () => "off",
  };
  main.default(fakePi, {
    coordinatorEnabled: () => false,
    startupCampaignId: () => null,
    welcomeAgentDir: mkdtempSync(path.join(tmpdir(), "coc-settle-handle-")),
    createClient: () => ({
      async callToolWithTransportMeta(_name, params) {
        transported.push(structuredClone(params));
        if (params.operation === "rules.settle") {
          return { value: settleEnvelope(), transport: null };
        }
        if (params.operation === "state.exceptional_effect") {
          return {
            value: {
              ok: true,
              tool: "state.exceptional_effect",
              wire: { full_result_sha256: "f".repeat(64) },
              data: {
                schema_version: 1,
                action: "apply",
                effect_id: "exceptional-effect-v1:" + "a".repeat(40),
                effect: {
                  effect_id: "exceptional-effect-v1:" + "a".repeat(40),
                  effect_kind: "scene_event",
                  direction: "cost",
                  status: "applied",
                },
              },
              warnings: [],
              hints: [],
            },
            transport: null,
          };
        }
        if (params.operation === "state.journal") {
          return { value: journalErrorEnvelope(), transport: null };
        }
        if (params.operation === "session.resume") {
          return {
            value: {
              ok: true,
              tool: "session.resume",
              wire: { full_result_sha256: "9".repeat(64) },
              data: {
                schema_version: 1,
                campaign_id: CAMPAIGN,
                mode: "awaiting_player",
                next_operations: ["interpret_current_player_message"],
                current_turn: { rows: [] },
              },
              warnings: [],
              hints: [],
            },
            transport: null,
          };
        }
        // Auxiliary host flows (briefing, steward supply) degrade gracefully.
        return {
          value: {
            ok: false,
            tool: params.operation,
            error: { code: "unscripted_operation", message: "not scripted in this probe" },
          },
          transport: null,
        };
      },
      async close() {},
    }),
  });
  const ctx = {
    cwd: root,
    mode: "rpc",
    model: { provider: "xai", id: "grok-4.5" },
    sessionManager: {
      getSessionId: () => "settle-exceptional-effect-handle",
      getEntries: () => [],
      getBranch: () => [],
    },
    hasUI: false,
  };
  for (const handler of handlers.get("session_start") ?? []) {
    await handler({ type: "session_start" }, ctx);
  }
  const invoke = async (toolName, args) => {
    const tool = tools.get(toolName);
    assert.ok(tool, `tool ${toolName} is registered`);
    const result = await tool.execute(
      `${toolName}-${transported.length}`,
      args,
      undefined,
      undefined,
      ctx,
    );
    return { visible: JSON.parse(result.content[0].text), result };
  };
  // Reach live-turn ACL the same way a real table does: one accepted
  // awaiting_player resume.
  const resume = await invoke("coc_session_resume", {});
  assert.equal(resume.visible.ok, true, JSON.stringify(resume.visible));
  return { invoke, transported };
}

// ── Part 1: settle presents a live roll handle; exceptional_effect binds it ──
{
  const { invoke, transported } = await bootHarness();
  const settle = await invoke("coc_rules_settle", {
    campaign: CAMPAIGN,
    decision_id: SETTLE_DECISION_ID,
    decision_ref: "decision:coc7:core-check:ordinary-check",
    semantic_inputs: {
      characteristic: "STR",
      difficulty: "regular",
      difficulty_basis: "environment",
      goal: "hurry crew to finish last crates then hold the skiff steady",
      stakes: {
        on_success: "last crates ashore and skiff held",
        on_failure: "skiff yaws; cargo or footing threatened",
      },
      bonus: 0,
      penalty: 0,
    },
  });
  assert.equal(settle.visible.ok, true, JSON.stringify(settle.visible));
  const boundCheck = settle.visible.data?.settlement?.result?.bound_check;
  assert.ok(boundCheck, "projected settle keeps the bound check");
  const handle = boundCheck.roll_id;
  assert.equal(
    typeof handle,
    "string",
    "graph-settled roll must present a model-consumable roll handle",
  );
  assert.ok(
    handle.startsWith("roll:"),
    `presented roll id must be a semantic handle, got ${handle}`,
  );
  assert.ok(
    !handle.includes(MACHINE_ROLL_ID),
    "machine roll id must never reach model content",
  );
  assert.ok(
    !JSON.stringify(settle.visible).includes(MACHINE_ROLL_ID),
    "no machine roll id anywhere in the projected settle result",
  );

  const exceptional = await invoke("coc_state_exceptional_effect", {
    action: "apply",
    campaign: CAMPAIGN,
    decision_id: "exceptional-str-fumble-wave-hazard-v1",
    direction: "cost",
    effect_kind: "scene_event",
    source_roll_id: handle,
    visibility: "player_visible",
    causal_link: "你在浪头里硬拽缆绳时力道尽失，小艇被侧面拍来的巨浪掀歪。",
    player_visible_impact: "巨浪拍翻小艇；你被抛入冰冷的海浪。",
    boundary: { kind: "until_scene_end", scene_id: "scene-opening-smuggling-1895" },
    mechanics: {
      scene_id: "scene-opening-smuggling-1895",
      event_id: "storm-wave-overturns-skiff",
      change_kind: "hazard",
    },
  });
  assert.equal(exceptional.visible.ok, true, JSON.stringify(exceptional.visible));
  const transportedEffect = transported.find(
    (params) => params.operation === "state.exceptional_effect",
  );
  assert.ok(transportedEffect, "exceptional effect reached canonical transport");
  assert.equal(
    transportedEffect.arguments.source_roll_id,
    MACHINE_ROLL_ID,
    "host restores the exact canonical roll id from the presented handle",
  );

  // Journal refusal AFTER the roll is live: the actionable code passes
  // through and its machine ids project to the live handle.
  const journal = await invoke("coc_state_journal", {
    campaign: CAMPAIGN,
    summary: "力量检定大失败，风浪中小艇失控。",
    player_action: "招呼同伴赶卸最后几箱并守住小艇。",
  });
  assert.equal(journal.visible.ok, false);
  assert.equal(
    journal.visible.error?.code,
    "substantive_exceptional_effect_required",
    `actionable canonical error must keep its code, got ${JSON.stringify(journal.visible.error)}`,
  );
  assert.ok(
    journal.visible.error.message.includes(handle),
    "mapped machine ids in error prose project to the live semantic handle",
  );
  assert.ok(
    !JSON.stringify(journal.visible).includes(MACHINE_ROLL_ID),
    "no machine roll id anywhere in the projected journal error",
  );
  const missing = journal.visible.error?.details?.missing_substantive_effects?.[0];
  assert.ok(missing, "structured missing-effect row survives projection");
  assert.equal(missing.obligation_id, handle);
  assert.equal(missing.source_roll_id, handle);
  assert.equal(missing.required_direction, "cost");
}

// ── Part 2: the same refusal with NO live handle (fresh session) still
// reaches the model with its meaning intact — code, class, and recovery
// actions — while the unmapped machine ids are dropped and scrubbed. ──
{
  const { invoke } = await bootHarness();
  const journal = await invoke("coc_state_journal", {
    campaign: CAMPAIGN,
    summary: "力量检定大失败，风浪中小艇失控。",
    player_action: "招呼同伴赶卸最后几箱并守住小艇。",
  });
  assert.equal(journal.visible.ok, false);
  assert.equal(
    journal.visible.error?.code,
    "substantive_exceptional_effect_required",
    `unmapped ids must not degrade the code to semantic_identity_unavailable: ${
      JSON.stringify(journal.visible.error)
    }`,
  );
  assert.equal(journal.visible.error.class, "business_precondition");
  assert.equal(
    journal.visible.error.allowed_next_actions?.[0]?.operation,
    "state.exceptional_effect",
    "the recovery action survives projection",
  );
  assert.ok(
    !JSON.stringify(journal.visible).includes(MACHINE_ROLL_ID),
    "unmapped machine roll ids are scrubbed from the delivered error",
  );
  const missing = journal.visible.error?.details?.missing_substantive_effects?.[0];
  assert.ok(missing, "structured row survives with identity fields dropped");
  assert.ok(!("obligation_id" in missing), "unmapped obligation_id is dropped");
  assert.ok(!("source_roll_id" in missing), "unmapped source_roll_id is dropped");
  assert.equal(missing.required_direction, "cost");
  // Host-only evidence keeps the exact canonical error plus the bounded
  // identity diagnostics.
  assert.equal(
    journal.result.details.error?.code,
    "substantive_exceptional_effect_required",
  );
  assert.ok(
    Array.isArray(journal.result.details.semantic_identity_diagnostics)
      && journal.result.details.semantic_identity_diagnostics.length > 0,
    "identity diagnostics ride along host-only in details",
  );
}

process.stdout.write("settle-exceptional-effect-handle: all assertions passed\n");
