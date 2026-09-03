#!/usr/bin/env node
// Normal-play model-ID boundary regression (attempt-02 actual-surface fix).
//
// Part A — every exposed canonical envelope family from the live attempt-02
// audit is projected through the single post-observer Pi gateway boundary and
// recursively scanned for opaque identity material (hashes, UUIDs, long
// random hex/base62, source/review/decision/receipt/job/packet/cache/asset
// ids, nested opaque refs, denied field names). Regex is the tests-only leak
// detector; production projection stays field-structured.
//
// Part B — a replayable normal turn (opening → context → roll fail-closed →
// journal → output_context → review → finalize) through the REAL Pi gateway,
// typed tools, retained host bindings, and the state-claim compiler stub:
// model content carries only semantic handles, the host restores exact
// investigator/subject/source/advisory identities before transport, exact
// opaque values stay in host-only `details`, and explicit opaque ids from the
// model fail closed without echo.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
process.env.COC_PI_SESSION_ROLE = "play";
const dependencyRoot = path.resolve(process.env.PI_TEST_REPO_ROOT || root);
const main = await import(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts")
);
const {
  PiStateClaimCompiler,
  canonicalDigest,
  draftParagraphs,
} = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/state-claim-compiler.ts")
);
const { emptySemanticProjectionView } = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/semantic-identity-registry.ts")
);
const {
  CURRENT_INVESTIGATOR_HANDLE,
  CURRENT_PC_SUBJECT_HANDLE,
  CURRENT_PLAYER_INPUT_SOURCE_HANDLE,
  CURRENT_ADVICE_HANDLE,
  CURRENT_CANDIDATE_HANDLE,
  deriveSemanticEntityFacts,
  emptySemanticEntityFacts,
  projectModelVisibleCanonicalResult,
  restoreSemanticEntityHandles,
  stripOpaqueModelIdentity,
  validateRawModelIdentityPayload,
  RAW_IDENTITY_GRAMMAR_FIELDS,
} = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts")
);
const { isTypedOperationTool } = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts")
);

const FAMILIES = JSON.parse(
  readFileSync(
    new URL("./fixtures/normal-model-id-families.json", import.meta.url),
    "utf8",
  ),
);

// Exact opaque material observed in attempt-02 model-visible content.
const EXACT_OPAQUE_SUBSTRINGS = [
  "inv-x6a217e22-e0532209",
  "pc:inv-x6a217e22-e0532209",
  "turn-v1-8e3599cdcb794cd5b993b59c077d126f",
  "turn-effect-v1:",
  "narration-review-v1:",
  "ws-v1-",
  "ca-v1-",
  "job-45db308081f7",
  "job-6aff20a89a8e",
  "srcasset-",
  "source-coordinator-235f3263bf6dd02d66c1",
  "player_input:journal-stone-street-exterior-t1",
  "storylets:0:df3fb04785ed9164779e",
  "storylet-candidate-v1:23176fa5590f08753f5a868f042a2890",
  "table-transcript-v1:9da485d333b5793db54c816ec17d335a2cee92b5",
  "continuation-v1-2efcf6b3fa1b-c7a6c09bb19473f5",
  "pi-narration-review:db56e0dd",
  "pi-turn-finalize:db56e0dd",
  "01a048ac-6473-7f90-888f-a8acf166f2d3",
  "npc-identity-v2:",
  "npc-profile-v2:",
  "e4f53f7f1f06122ee0bf98df2f639f1597601d48d8c86ce17b0a1b0771be0956",
];
const OPAQUE_VALUE_RES = [
  /sha256:[0-9a-f]{8}/i,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /\b[0-9a-f]{24,}\b/i,
];
// Identity field names that must never appear as object keys in model content.
const DENIED_KEY_NAMES = new Set([
  "wire",
  "turn_id",
  "session_id",
  "entry_id",
  "finalization_id",
  "narration_review_id",
  "review_id",
  "settlement_snapshot_id",
  "journal_decision_id",
  "repair_finalization_id",
  "identity_ref",
  "profile_revision_ref",
  "identity_contract",
  "contract_ref",
  "state_claim_compilation",
  "packet_id",
  "packet",
  "pi_task",
  "claim_operation",
  "coordinator_dispatch",
  "background_takeover",
  "ready_background_requests",
  "next_host_action",
  "host_dispatch",
  "task_prompt",
  "job_id",
  "supersedes_host_job_ids",
  "superseded_host_job_ids",
  "pending_supersede_host_job_ids",
  "consumer_refs",
  "host_work_request",
  "workspace_root",
  "python_executable",
  "toolbox_script",
  "catalog_path",
  "source_bundle_path",
  "asset_ids",
  "player_input",
  "checkpoint_id",
  "enqueue",
  "worker_kick",
  "cache",
  "source_digest",
  "mechanics_bundle_sha256",
  "contract_projection_sha256",
  "accepted_draft_sha256",
  "rendered_text_sha256",
  "integrity_digest",
  "draft_sha256",
  "request_digest",
  "review_digest",
  "text_sha256",
  "full_result_sha256",
  "contract_archive_sha256",
  "bundle_sha256s",
  "full_capsule_sha256",
  "projection_sha256",
  "scenario_binding_sha256",
  "original_hash",
  "bundle_sha256",
  "sha256",
  "manifest_revision",
  "archive_revision",
  "revision_token",
  "source_receipt_id",
]);
// Advisory identity fields are allowed ONLY with the semantic handle values.
const HANDLE_ALLOWED_KEYS = new Map([
  ["advice_id", new Set([CURRENT_ADVICE_HANDLE])],
  ["candidate_ref", new Set([CURRENT_CANDIDATE_HANDLE])],
  ["investigator_id", new Set([CURRENT_INVESTIGATOR_HANDLE])],
  ["pc_subject_refs", new Set(["pc:current-investigator"])] ,
  ["party", new Set([CURRENT_INVESTIGATOR_HANDLE])],
]);

function collectViolations(value, keyPath, violations, deniedKeys = DENIED_KEY_NAMES) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectViolations(value[i], `${keyPath}[${i}]`, violations, deniedKeys);
    }
    return violations;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (deniedKeys.has(key)) violations.push(`key:${keyPath}.${key}`);
      const allowedHandles = HANDLE_ALLOWED_KEYS.get(key);
      if (allowedHandles) {
        const members = Array.isArray(child) ? child : [child];
        for (const member of members) {
          if (typeof member === "string" && member && !allowedHandles.has(member)) {
            violations.push(`handle@${keyPath}.${key}:${member}`);
          }
        }
      }
      collectViolations(child, `${keyPath}.${key}`, violations, deniedKeys);
    }
    return violations;
  }
  if (typeof value === "string") {
    for (const needle of EXACT_OPAQUE_SUBSTRINGS) {
      if (value.includes(needle)) {
        violations.push(`value@${keyPath}:…${needle}…`);
      }
    }
    for (const re of OPAQUE_VALUE_RES) {
      if (re.test(value)) violations.push(`pattern@${keyPath}:${re}`);
    }
  }
  return violations;
}

function assertModelSafeContent(
  label,
  projected,
  deniedKeys = DENIED_KEY_NAMES,
) {
  const violations = collectViolations(projected, "$", [], deniedKeys);
  assert.deepEqual(
    violations,
    [],
    `${label}: opaque model-visible content leaked:\n${violations.join("\n")}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Part A — attempt-02 actual-surface families through the gateway projection.
// ─────────────────────────────────────────────────────────────────────────────
const CANONICAL_FAMILIES = Object.entries(FAMILIES).filter(
  ([name]) => !name.startsWith("source_assets"),
);
// Model-authored semantic decision ids stay in generic results (rules.push
// needs original_check_decision_id); the settle-phase views must not expose
// any host decision identity.
const DENIED_KEY_NAMES_SETTLE_VIEWS = new Set([
  ...DENIED_KEY_NAMES,
  "decision_id",
]);

for (const [family, envelope] of CANONICAL_FAMILIES) {
  const projected = projectModelVisibleCanonicalResult(
    envelope.tool,
    envelope,
    emptySemanticProjectionView(),
  );
  const deniedKeys = [
    "turn_output_context",
    "narration_review",
    "turn_finalize",
  ].includes(family)
    ? DENIED_KEY_NAMES_SETTLE_VIEWS
    : DENIED_KEY_NAMES;
  assertModelSafeContent(`family ${family}`, projected, deniedKeys);
}

// Production-shaped long-tail rule/subsystem envelopes use explicit closed
// identity dispositions. Internal command/provenance ids stay host-only;
// authored semantic ids remain visible without weakening the generic boundary.
{
  const cases = [
    ["rules.catalog_search", {
      ok: true,
      tool: "rules.catalog_search",
      data: {
        ruleset_id: "coc7",
        candidates: [{ entity_id: "knife_medium", price_id: "eq.1920s.knife-medium" }],
      },
    }],
    ["mechanics.ensure", {
      ok: true,
      tool: "mechanics.ensure",
      data: {
        subject_id: "npc-walter-corbitt",
        monster_ref: "Walter Corbitt",
        affordance_id: "strike-with-his-dagger",
        mechanics_revision_ref: {
          stable_id: "npc:walter-corbitt:mechanics",
          content_sha256: "f".repeat(64),
        },
      },
    }],
    ["sanity.execute", {
      ok: true,
      tool: "sanity.execute",
      data: {
        results: [{
          command_id: "sanity-see-corbitt-body-v1",
          events: [{ san_trigger_id: "see-corbitt-body", event_id: "se1" }],
          state_refs: ["save/sanity.json#state"],
        }],
      },
    }],
    ["combat.resolve", {
      ok: true,
      tool: "combat.resolve",
      data: {
        events: [{
          attack_command_id: "combat-corbitt-attack-1",
          actor_id: "thomas-hayes",
          target_actor_id: "walter-corbitt",
          rule_ref: "module.haunting.corbitt-own-dagger",
        }],
      },
    }],
    ["turn.output_context", {
      ok: true,
      tool: "turn.output_context",
      data: {
        source_decision_id: "exceptional-push-failure-v1",
        obligations: [],
        required_obligation_ids: [],
        mechanics_summary: { public_check: [], state_delta: [], exceptional_effect: [], concealed_consequence: [] },
      },
    }],
  ];
  for (const [operation, envelope] of cases) {
    const diagnostics = { unmapped: [] };
    const projected = projectModelVisibleCanonicalResult(
      operation,
      envelope,
      emptySemanticProjectionView(),
      diagnostics,
    );
    assert.deepEqual(diagnostics.unmapped, [], `${operation} production identity projection`);
    assertModelSafeContent(`${operation} production identity projection`, projected);
  }
}

// Magic receipts expose public spell/check semantics while runtime-generated
// operation and scheduled-completion identities stay host-only.
{
  const cases = [
    ["magic.cast", {
      ok: true,
      tool: "magic.cast",
      data: {
        receipt: {
          kind: "magic.cast",
          operation_id: "op-magic-cast-134364244112",
          result: { spell: "Cloud Memory", success: true },
        },
      },
    }],
    ["magic.learn", {
      ok: true,
      tool: "magic.learn",
      data: {
        receipt: {
          kind: "magic.learn",
          operation_id: "op-magic-learn-134364244112",
          result: {
            spell: "Cloud Memory",
            learned: true,
            completion_trigger_id: "trigger-magic-learn-cloud-memory-1",
          },
        },
      },
    }],
  ];
  for (const [operation, envelope] of cases) {
    const diagnostics = { unmapped: [] };
    const projected = projectModelVisibleCanonicalResult(
      operation,
      envelope,
      emptySemanticProjectionView(),
      diagnostics,
    );
    assert.deepEqual(diagnostics.unmapped, [], `${operation} magic identity projection`);
    assert.equal(projected.data.receipt.operation_id, undefined);
    assert.equal(
      projected.data.receipt.result.completion_trigger_id,
      undefined,
    );
    assert.equal(projected.data.receipt.result.spell, "Cloud Memory");
    assertModelSafeContent(`${operation} magic identity projection`, projected);
  }
}

// R11 SAN output keeps player-facing numbers/events while routing every roll
// identity through the existing semantic roll registry. Internal event,
// command, bout, and decision ids remain host-only.
{
  const rollView = {
    ...emptySemanticProjectionView(),
    rolls: new Map([
      ["toolbox-campaign-000001", "roll:san-check"],
      ["toolbox-campaign-000002", "roll:int-check"],
      ["toolbox-campaign-000003", "roll:bout-duration"],
      ["toolbox-campaign-000004", "roll:bout-table"],
      ["toolbox-campaign-000005", "roll:bout-rounds"],
      ["toolbox-campaign-000006", "roll:san-loss"],
      ["pi-sanity-command", "roll:san-command-check"],
    ]),
  };
  const flatDiagnostics = { unmapped: [] };
  const flat = projectModelVisibleCanonicalResult(
    "rules.sanity_check",
    {
      ok: true,
      tool: "rules.sanity_check",
      data: {
        investigator_id: "thomas-hayes",
        check: {
          skill: "SAN",
          target: 55,
          roll: 89,
          outcome: "failure",
          trigger_id: "trigger:see-corbitt-body",
          san_loss: 5,
        },
        san_before: 55,
        san_after: 50,
        trigger_id: "trigger:see-corbitt-body",
        active_bout_id: "thomas-hayes:bout:1",
        session_roll_ids: [
          "toolbox-campaign-000001",
          "toolbox-campaign-000002",
        ],
        session_events: [{
          event_id: "se1",
          event_type: "bout_of_madness",
          bout_id: "thomas-hayes:bout:1",
          trigger_id: "trigger:see-corbitt-body",
          summary: "The investigator flees in panic.",
        }],
        check_roll_id: "toolbox-campaign-000001",
        int_roll_id: "toolbox-campaign-000002",
        bout_duration_roll_id: "toolbox-campaign-000003",
        bout_table_roll_id: "toolbox-campaign-000004",
        bout_rounds_roll_id: "toolbox-campaign-000005",
        loss_roll_id: "toolbox-campaign-000006",
      },
    },
    rollView,
    flatDiagnostics,
  );
  assert.deepEqual(flatDiagnostics.unmapped, []);
  assert.equal(flat.data.san_before, 55);
  assert.equal(flat.data.san_after, 50);
  assert.equal(flat.data.check.trigger_id, "trigger:see-corbitt-body");
  assert.deepEqual(flat.data.session_roll_ids, ["roll:san-check", "roll:int-check"]);
  assert.equal(flat.data.check_roll_id, "roll:san-check");
  assert.equal(flat.data.loss_roll_id, "roll:san-loss");
  assert.equal(flat.data.session_events[0].summary, "The investigator flees in panic.");
  assert.ok(!("event_id" in flat.data.session_events[0]));
  assert.ok(!("bout_id" in flat.data.session_events[0]));
  assert.ok(!("active_bout_id" in flat.data));

  const subsystemDiagnostics = { unmapped: [] };
  const subsystem = projectModelVisibleCanonicalResult(
    "sanity.execute",
    {
      ok: true,
      tool: "sanity.execute",
      data: {
        results: [{
          command_id: "pi-sanity-command",
          events: [{
            roll_id: "pi-sanity-command",
            decision_id: "pi-sanity-command",
            event_id: "se2",
            rule_ref: "rule:coc7:sanity-check",
            san_trigger_id: "trigger:see-corbitt-body",
            roll: 32,
            san_loss: 1,
            san_before: 54,
            san_after: 53,
          }],
        }],
      },
    },
    rollView,
    subsystemDiagnostics,
  );
  assert.deepEqual(subsystemDiagnostics.unmapped, []);
  assert.equal(subsystem.data.results[0].events[0].roll_id, "roll:san-command-check");
  assert.equal(subsystem.data.results[0].events[0].rule_ref, "rule:coc7:sanity-check");
  assert.equal(subsystem.data.results[0].events[0].san_loss, 1);
  assert.ok(!("decision_id" in subsystem.data.results[0].events[0]));
  assert.ok(!("event_id" in subsystem.data.results[0].events[0]));
}

// state.journal continuation memory uses item_id as the semantic identity of
// a do-not-repeat note. It is not an inventory item and must not be routed
// through the item registry merely because the leaf field shares that name.
{
  const diagnostics = { unmapped: [] };
  const journal = {
    ok: true,
    tool: "state.journal",
    data: {
      turn_number: 1,
      tension_level: "low",
      continuation_delta: {
        do_not_repeat: [{
          item_id: "macario-summary-first-tell",
          instruction: "不要原样复述刚交付的线索",
          reason: "本回合已经首次交代",
          source_turn: 1,
        }],
      },
    },
    warnings: [],
    hints: [],
  };
  const out = projectModelVisibleCanonicalResult(
    "state.journal",
    journal,
    emptySemanticProjectionView(),
    diagnostics,
  );
  assert.deepEqual(
    diagnostics.unmapped,
    [],
    "do_not_repeat item_id is journal-memory identity, not inventory identity",
  );
  assert.equal(
    out.data.continuation_delta.do_not_repeat[0].item_id,
    "macario-summary-first-tell",
  );
}

{
  const envelope = structuredClone(FAMILIES.turn_output_context);
  envelope.data.journal_context = {
    summary: "诺特说马卡里奥一家逃离，父亲仍在罗克斯伯里疗养院。",
    player_action: "向诺特询问马卡里奥一家的遭遇",
    intent_class: "social",
  };
  const out = projectModelVisibleCanonicalResult(
    "turn.output_context",
    envelope,
    emptySemanticProjectionView(),
  );
  assert.deepEqual(out.data.journal_context, envelope.data.journal_context);
}

{
  const envelope = structuredClone(FAMILIES.turn_output_context);
  const hostExactExcerpt = "直到指节的皮裂开，血顺着拳面往下淌。";
  envelope.data.accepted_review_evidence = {
    schema_version: 1,
    contract_id: "coc.accepted-review-evidence.v2",
    visibility: "host_only",
    review_id: "narration-review-v1:host-only",
    turn_id: envelope.data.turn_id,
    source_digest: envelope.data.source_digest,
    revision: 1,
    draft_sha256: `sha256:${"1".repeat(64)}`,
    review_digest: `sha256:${"2".repeat(64)}`,
    pending_draft_receipt_digest: `sha256:${"3".repeat(64)}`,
    contract_projection_sha256: envelope.data.contract_projection_sha256,
    verification: { agency_gate: "clear", state_authority_gate: "clear" },
    state_authority_review: {
      disposition: "claims_listed",
      reason: "host only",
      claims: [{ exact_excerpt: hostExactExcerpt }],
    },
    player_input_source_ref: "player_input:host-only",
    agency_authority: { pc_subject_refs: ["pc:host-only"] },
    control_overrides: [],
    evidence_sha256: `sha256:${"4".repeat(64)}`,
  };
  const out = projectModelVisibleCanonicalResult(
    "turn.output_context",
    envelope,
    emptySemanticProjectionView(),
  );
  assert.equal(Object.hasOwn(out.data, "accepted_review_evidence"), false);
  assert.equal(JSON.stringify(out).includes(hostExactExcerpt), false);
  assert.equal(JSON.stringify(out).includes("narration-review-v1:host-only"), false);
}

// Opening substance survives: exact opening text and time anchor.
{
  const out = projectModelVisibleCanonicalResult(
    "evidence.table_opening",
    FAMILIES.evidence_table_opening,
    emptySemanticProjectionView(),
  );
  assert.equal(
    out.data.text,
    FAMILIES.evidence_table_opening.data.text,
    "opening text must survive byte-exact",
  );
  assert.equal(out.data.speaker, "KP");
  assert.equal(
    out.data.authoritative_time_anchor.rendered_line,
    "【开场时间】夜晚",
  );
  assert.equal(out.data.source_ref, "table.opening#table-opening-king-shreds-recovery-live-01");
}

// turn.output_context semantic view: obligations + mechanics + draft
// instructions stay; turn/source/revision/journal/review identities go.
{
  const out = projectModelVisibleCanonicalResult(
    "turn.output_context",
    FAMILIES.turn_output_context,
    emptySemanticProjectionView(),
  );
  const data = out.data;
  assert.equal(data.obligations.length, 2);
  // Boundary mode: unobserved canonical obligation ids drop (no toolbox
  // identity can reach model content); skill substance remains.
  assert.deepEqual(data.required_obligation_ids, []);
  assert.ok(!("obligation_id" in data.obligations[0]));
  assert.equal(data.obligations[0].skill, "Spot Hidden");
  assert.equal(data.obligations[1].skill, "Listen");
  assert.equal(data.mechanics_summary.public_check[0].roll, 62);
  assert.ok(!("roll_id" in data.mechanics_summary.public_check[0]));
  assert.equal(data.mechanics_summary.public_check[1].display_skill, "聆听");
  assert.deepEqual(
    data.contract_projection.narration_budget,
    { mode: "routine_resolution", max_chars: 525, max_paragraphs: 3 },
  );
  assert.equal(data.contract_projection.agency_review_required, true);
  assert.deepEqual(data.contract_projection.agency_authority.pc_subject_refs, [
    CURRENT_PC_SUBJECT_HANDLE,
  ]);
  assert.equal(
    data.contract_projection.agency_authority.involuntary_physiology_sources[0]
      .source_ref,
    "narration_contract:involuntary_physiology",
  );
  assert.deepEqual(data.agency_review_operation.missing_model_arguments, [
    "draft_text",
    "findings",
    "state_authority_review",
  ]);
  assert.deepEqual(
    data.agency_review_operation.host_bound_auto_attached_arguments,
    ["decision_id", "revision", "source_digest", "turn_id"],
  );
  assert.deepEqual(data.finalize_operation.missing_model_arguments, [
    "draft",
    "coverage",
    "agency_claims",
  ]);
  assert.deepEqual(
    data.finalize_operation.host_bound_auto_attached_arguments,
    ["decision_id", "narration_review_id", "revision"],
  );
  assert.deepEqual(
    data.finalize_operation.coverage_contract.obligation_ids,
    [],
    "boundary mode: unobserved canonical obligation ids drop from the "
      + "finalize descriptor (no toolbox identity can reach model content)",
  );
  assert.deepEqual(data.finalize_operation.coverage_contract.required_fields,
    ["obligation_id", "realization", "action_realization", "response",
      "causal_explanation", "persona_fit", "player_input_handling",
      "exact_excerpt", "exceptional_beat"]);
  assert.equal(data.narrative_opportunity.advice_id, CURRENT_ADVICE_HANDLE);
  assert.equal(
    data.narrative_opportunity.candidate_ref,
    CURRENT_CANDIDATE_HANDLE,
  );
  assert.equal(
    data.narrative_opportunity.candidate.storylet_id,
    "medium-clock-visible",
  );
  assert.equal(data.narrative_opportunity.candidate.title, "倒计时可见");
  assert.deepEqual(
    data.narrative_opportunity.adoption_operation.semantic_identity_handles,
    { advice_id: CURRENT_ADVICE_HANDLE, candidate_ref: CURRENT_CANDIDATE_HANDLE },
  );
  assert.equal(data.pending_narration_draft_status.status, "not_submitted");
  assert.equal(data.turn_number, 1);
}

// narration.review semantic view: accepted/revision guidance only.
{
  const out = projectModelVisibleCanonicalResult(
    "narration.review",
    FAMILIES.narration_review,
    emptySemanticProjectionView(),
  );
  assert.equal(out.data.recommendation, "no_revision_suggested");
  assert.equal(out.data.agency_gate, "clear");
  assert.equal(out.data.revision, 1);
  assert.deepEqual(out.data.findings, []);
  assert.equal(
    out.data.state_authority_review.disposition,
    "no_player_state_change_claimed",
  );
  // Review hints are Pi-authored semantic guidance derived from structured
  // fields; no canonical prose (and therefore no opaque tokens) is relayed.
  assert.deepEqual(out.hints, [
    "findings are advisory; the KP decides whether and how to revise them",
    "after a clear Pi review, select reviewed_span + claim_type + authority "
      + "from the refreshed finalize binding; the host attaches the frozen "
      + "draft and exact agency evidence",
  ]);
}

// A successful narration review may echo the Keeper's nested semantic claim
// identities. The composed claim id remains meaningful, while the canonical
// current-PC ref is projected back to the one copy-safe model handle.
{
  const envelope = structuredClone(FAMILIES.narration_review);
  envelope.data.state_authority_review = {
    disposition: "claims_listed",
    reason: "草稿声明了已经由状态工具落地的钥匙交接。",
    claims: [{
      claim_id: "claim-keys-handoff",
      subject_ref: "pc:inv-x6a217e22-e0532209",
      claim_kind: "item",
      exact_excerpt: "钥匙现在在你手里。",
      source_effect_id: null,
      reason: "钥匙已经由权威物品写入落地。",
    }],
  };
  const diagnostics = { unmapped: [] };
  const out = projectModelVisibleCanonicalResult(
    "narration.review",
    envelope,
    emptySemanticProjectionView(),
    diagnostics,
  );
  assert.deepEqual(diagnostics.unmapped, []);
  assert.equal(
    out.data.state_authority_review.claims[0].claim_id,
    "claim-keys-handoff",
  );
  assert.equal(
    out.data.state_authority_review.claims[0].subject_ref,
    CURRENT_PC_SUBJECT_HANDLE,
  );
  assertModelSafeContent("narration.review nested claim content", out);

  const opaqueClaim = structuredClone(envelope);
  opaqueClaim.data.state_authority_review.claims[0].claim_id =
    "claim-7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const opaqueDiagnostics = { unmapped: [] };
  const opaqueOut = projectModelVisibleCanonicalResult(
    "narration.review",
    opaqueClaim,
    emptySemanticProjectionView(),
    opaqueDiagnostics,
  );
  assert.equal(
    opaqueOut.data.state_authority_review.claims[0].claim_id,
    undefined,
  );
  assert.ok(
    opaqueDiagnostics.unmapped.some((entry) => entry.field === "claim_id"),
  );
}

// turn.finalize semantic view: rendered text + semantic status only.
{
  const out = projectModelVisibleCanonicalResult(
    "turn.finalize",
    FAMILIES.turn_finalize,
    emptySemanticProjectionView(),
  );
  assert.deepEqual(
    Object.keys(out.data).sort(),
    ["accepted_revision", "rendered_text", "schema_version", "status"],
  );
  assert.equal(out.data.status, "finalized");
  assert.equal(out.data.accepted_revision, 1);
  assert.ok(out.data.rendered_text.includes("【明骰】侦查｜掷骰：62"));
  assert.ok(out.data.rendered_text.endsWith("屋子仍黑着。"));
  assert.ok(!("continuation" in out));
}

// Context / NPC / progressive families keep semantic substance.
{
  const diagnostics = { unmapped: [] };
  const out = projectModelVisibleCanonicalResult(
    "state.record_clue",
    FAMILIES.state_record_clue,
    null,
    diagnostics,
  );
  assert.equal(
    out.data.route_completion.decision_id,
    "record-clue-knott-macario-summary-t1",
  );
  assert.deepEqual(diagnostics.unmapped, []);

  const opaque = structuredClone(FAMILIES.state_record_clue);
  opaque.data.route_completion.decision_id =
    "record-clue-7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const opaqueDiagnostics = { unmapped: [] };
  const opaqueOut = projectModelVisibleCanonicalResult(
    "state.record_clue",
    opaque,
    null,
    opaqueDiagnostics,
  );
  assert.equal(opaqueOut.data.route_completion.decision_id, undefined);
  assert.deepEqual(
    opaqueDiagnostics.unmapped.map((entry) => entry.field),
    ["decision_id"],
  );
}
{
  const out = projectModelVisibleCanonicalResult(
    "scene.context",
    FAMILIES.scene_context,
    emptySemanticProjectionView(),
  );
  assert.deepEqual(out.data.party, [CURRENT_INVESTIGATOR_HANDLE]);
  assert.equal(out.data.party_investigators[0].name, "程远");
  assert.equal(out.data.party_investigators[0].app, 50);
  assert.equal(out.data.progressive.asset_root_id, "coc-king-colfix-verify-001");
  assert.equal(out.data.progressive.open_host_work_count, 4);
}
{
  const out = projectModelVisibleCanonicalResult(
    "scene.context",
    FAMILIES.scene_context_compact,
    emptySemanticProjectionView(),
  );
  assert.equal(out.data.active_scene_id, "stone-street-coft-lodging");
  assert.equal(out.data.kind, "typed_scene_recovery_index");
  assert.deepEqual(out.data.party, [CURRENT_INVESTIGATOR_HANDLE]);
}
{
  const diagnostics = { unmapped: [] };
  const out = projectModelVisibleCanonicalResult(
    "npc.query",
    FAMILIES.npc_query,
    emptySemanticProjectionView(),
    diagnostics,
  );
  assert.equal(out.data.npcs[0].npc_id, "npc-lucy-henry");
  assert.equal(out.data.npcs[0].name, "露西·亨利");
  assert.ok(out.data.npcs[0].agenda.includes("玛瑞杰"));
  assert.ok(!("identity_contract" in out.data.npcs[0]));
  assert.equal(out.data.npcs[0].facts[0].fact_id, "fact-lucy-missing-cousin");
  assert.equal(out.data.npcs[0].facts[0].clue_id, "clue-lucy-missing-cousin");
  assert.equal(
    out.data.npcs[0].deflect_options[0].deflect_id,
    "deflect-lucy-wait-for-proof",
  );
  assert.equal(
    out.data.npcs[0].schedule[0].schedule_id,
    "lucy-opening-interview",
  );
  assert.equal(
    out.data.npcs[0].first_contact_readiness.pending_source_dependency.subject_id,
    "npc-lucy-henry",
  );
  assert.deepEqual(
    out.data.npcs[0].first_contact_readiness
      .social_adjudication_operation.valid_optional_evidence_refs,
    ["npc_fact:npc-lucy-henry/fact-lucy-missing-cousin"],
  );
  assert.equal(
    out.data.npcs[0].psych.impression.memories[0].memory_id,
    undefined,
    "opaque first-impression memory identity stays host-only",
  );
  assert.equal(
    out.data.npcs[0].psych.impression.memories[0].source_ref,
    undefined,
    "opaque first-impression source identity stays host-only",
  );
  assert.equal(
    out.data.npcs[0].first_contact_readiness
      .social_adjudication_operation.safe_omissions.feasibility_refs,
    undefined,
    "prose under an id-like field is not projected as identity",
  );
  assert.deepEqual(diagnostics.unmapped, []);

  const opaque = structuredClone(FAMILIES.npc_query);
  opaque.data.npcs[0].first_contact_readiness
    .social_adjudication_operation.valid_optional_evidence_refs = [
      "npc_fact:npc-lucy-henry/7c9e6679742540de944be07fc1f90ae7",
    ];
  const opaqueDiagnostics = { unmapped: [] };
  const opaqueOut = projectModelVisibleCanonicalResult(
    "npc.query",
    opaque,
    emptySemanticProjectionView(),
    opaqueDiagnostics,
  );
  assert.deepEqual(
    opaqueOut.data.npcs[0].first_contact_readiness
      .social_adjudication_operation.valid_optional_evidence_refs,
    [],
  );
  assert.deepEqual(
    opaqueDiagnostics.unmapped.map((entry) => entry.field),
    ["valid_optional_evidence_refs"],
  );
}
// Source-bound semantic provenance survives: pdf_index-* page handles are
// kept exactly while nested digest integrity refs are dropped.
{
  const out = projectModelVisibleCanonicalResult("clues.query", FAMILIES.clues_query, emptySemanticProjectionView());
  assert.deepEqual(out.data.handouts.cards[0].source_refs, ["pdf_index-4"]);
  assert.deepEqual(out.data.handouts.cards[1].source_refs, ["pdf_index-8"]);
  assert.equal(out.data.handouts.cards[0].asset_id, "croft-letter-card1");
  assert.ok(out.data.handouts.cards[0].title.includes("考夫特"));
}
{
  const out = projectModelVisibleCanonicalResult(
    "scene.context",
    FAMILIES.scene_context_compact,
    emptySemanticProjectionView(),
  );
  const rows = out.data.source_material.source_refs;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_id, "pdf:colfix-verify");
  assert.equal(rows[0].pdf_index, 5);
  assert.ok(!("text_sha256" in rows[0]), "digest provenance is host-only");
  assert.ok(!("grep_anchors" in rows[0]), "grep anchors are host-only");
  // The exact mixed original stays intact for host-only details.
  const originalRows = FAMILIES.scene_context_compact.data.source_material.source_refs;
  assert.equal(originalRows.length, 1);
  assert.equal(originalRows[0].text_sha256.length, 64);
}
// Mixed provenance projection: approved semantic members survive exactly;
// bare, archive, UUID, hash, and random members and grep anchors do not.
{
  const mixed = {
    ok: true,
    tool: "secrets.briefing",
    data: {
      schema_version: 1,
      source_refs: [
        "pdf_index-4",
        "pdf_index-8",
        "abcd",
        "archive-v3:9f2d4c8ab17e4460b3a9c5d1e7f02a46",
        "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        "qZ8kR2mXvT5wL9pB3nC6jF1d",
        { source_id: "abcd", pdf_index: 3 },
        {
          source_id: "pdf:colfix-verify",
          pdf_index: 5,
          page_ref: "pdf_index-5",
          printed_page: 10,
          text_sha256: "a".repeat(64),
          grep_anchors: ["3. 各种线索", "9f2d4c8ab17e4460"],
        },
        {
          source_id: "module:king-shreds",
          pdf_index: 6,
        },
      ],
    },
  };
  const out = projectModelVisibleCanonicalResult("secrets.briefing", mixed);
  const rows = out.data.source_refs;
  assert.deepEqual(rows, [
    "pdf_index-4",
    "pdf_index-8",
    {
      source_id: "pdf:colfix-verify",
      pdf_index: 5,
      page_ref: "pdf_index-5",
      printed_page: 10,
    },
    { source_id: "module:king-shreds", pdf_index: 6 },
  ]);
  // The exact mixed original is untouched for host-only details.
  assert.equal(mixed.data.source_refs.length, 9);
  assert.equal(mixed.data.source_refs[4], "7c9e6679-7425-40de-944b-e07fc1f90ae7");
  assert.equal(mixed.data.source_refs[7].grep_anchors.length, 2);
}
{
  // Boundary mode (explicit empty map): unobserved canonical roll ids fail
  // closed — no toolbox identity can ever reach model content.
  const out = projectModelVisibleCanonicalResult(
    "rules.roll",
    FAMILIES.rules_roll,
    emptySemanticProjectionView(),
  );
  assert.equal(out.data.investigator_id, CURRENT_INVESTIGATOR_HANDLE);
  assert.equal(out.data.roll_id, undefined);
  assert.equal(out.data.skill, "Spot Hidden");
  assert.equal(out.data.passed, false);
  // Hints are Pi-authored from structured fields; canonical hint prose is
  // never parsed or relayed, so no opaque cache/session tokens can appear.
  // The Pi-authored hint names the graph decision. Legacy `rules.push` is
  // `kp_surface: "none"` after the ten-family cutover, so a hint naming it
  // would send the Keeper into a refused call on the exact failure path where
  // it is looking for the next move.
  assert.deepEqual(out.hints, [
    "failed: the player may push this roll with a changed method and an "
      + "announced consequence (rules.settle with decision_ref "
      + "decision:coc7:push-luck:pushed-roll)",
  ]);
}
{
  const out = projectModelVisibleCanonicalResult(
    "progressive.on_enter_scene",
    FAMILIES.progressive_on_enter_scene,
    emptySemanticProjectionView(),
  );
  assert.equal(out.data.scene_id, "stone-street-coft-lodging");
  assert.equal(out.data.materialization.actions[0].merged_pack,
    "stone-street-coft-lodging");
  assert.equal(out.data.projection.host_work_open_count, 3);
  assert.ok(!("background_takeover" in out.data));
  assert.equal(out.data.materialization.actions[1].enqueue, undefined);
}
{
  const out = projectModelVisibleCanonicalResult(
    "state.journal",
    FAMILIES.state_journal,
    emptySemanticProjectionView(),
  );
  assert.equal(out.data.turn_number, 1);
  assert.equal(out.data.continuation_delta.open_threads[0].thread_id,
    "croft-stone-street-unanswered");
  assert.equal(
    out.data.continuation_delta.confirmed_decisions[0].decision_id,
    "keep-lamp-low",
    "semantic continuation decisions remain visible in a successful journal result",
  );
  assert.ok(!("turn_id" in out.data));

  const opaqueJournal = structuredClone(FAMILIES.state_journal);
  opaqueJournal.data.continuation_delta.confirmed_decisions[0].decision_id =
    "journal-7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const opaqueDiagnostics = { unmapped: [] };
  const opaqueOut = projectModelVisibleCanonicalResult(
    "state.journal",
    opaqueJournal,
    emptySemanticProjectionView(),
    opaqueDiagnostics,
  );
  assert.equal(
    opaqueOut.data.continuation_delta.confirmed_decisions[0].decision_id,
    undefined,
    "declaring the workflow field must not expose an opaque decision id",
  );
  assert.deepEqual(
    opaqueDiagnostics.unmapped.map((entry) => entry.field),
    ["decision_id"],
  );
}
{
  const failure = projectModelVisibleCanonicalResult(
    "state.advance_time",
    FAMILIES.state_advance_time_failure,
    emptySemanticProjectionView(),
  );
  assert.equal(failure.ok, false);
  assert.equal(failure.error.code, "missing_param");
  assert.equal(failure.error.class, "schema_validation");
  assert.deepEqual(failure.error.details.missing_parameters, ["decision_id"]);
  assert.ok(failure.error.expected_schema.properties.minutes);
  assertModelSafeContent("advance_time failure", failure);
}

// Host source-asset tool content: hashes/paths/srcasset ids host-only.
{
  const { projectHostToolModelContent } = main.__test;
  const catalog = projectHostToolModelContent(FAMILIES.source_assets_catalog, {
    dropAssetIdFields: true,
  });
  assert.equal(catalog.status, "cataloged");
  assert.ok(!("bundle_sha256" in catalog));
  assert.ok(!("asset_ids" in catalog));
  assert.ok(!("catalog_path" in catalog));
  assert.ok(!("source_bundle_path" in catalog.catalog));
  assert.equal(catalog.catalog.asset_root_id, "coc-king-colfix-verify-001");
  assert.ok(!("asset_id" in catalog.catalog.assets[0]));
  assert.equal(catalog.catalog.assets[0].kind, "unclassified");
  const query = projectHostToolModelContent(FAMILIES.source_assets_query, {
    dropAssetIdFields: true,
  });
  assert.equal(query.status, "ok");
  assert.ok(!("asset_id" in query.assets[0]));
  assert.equal(query.assets[0].visibility, "undiscovered");
  assert.ok(!("sha256" in query.assets[0]));
  assert.equal(query.assets[0].source.pdf_index, 1);
  assertModelSafeContent("source_assets catalog", catalog);
  assertModelSafeContent("source_assets query", query);
}

// Derivation + restoration units.
{
  const facts = emptySemanticEntityFacts();
  for (const [operation, envelope] of [
    ["session.resume", FAMILIES.session_resume],
    ["scene.context", FAMILIES.scene_context],
    ["turn.output_context", FAMILIES.turn_output_context],
  ]) {
    Object.assign(facts, deriveSemanticEntityFacts(operation, envelope.data));
  }
  assert.equal(facts.investigatorId, "inv-x6a217e22-e0532209");
  assert.deepEqual(facts.pcSubjectRefs, ["pc:inv-x6a217e22-e0532209"]);
  assert.equal(facts.playerInputSourceRef,
    "player_input:journal-stone-street-exterior-t1");
  assert.equal(facts.advisoryAdviceId, "storylets:0:df3fb04785ed9164779e");
  assert.equal(facts.advisoryCandidateRef,
    "storylet-candidate-v1:23176fa5590f08753f5a868f042a2890");

  const restored = restoreSemanticEntityHandles("rules.roll", {
    investigator: CURRENT_INVESTIGATOR_HANDLE,
    skill: "Spot Hidden",
  }, facts);
  assert.deepEqual(restored.value, {
    investigator: "inv-x6a217e22-e0532209",
    skill: "Spot Hidden",
  });

  const opaque = restoreSemanticEntityHandles("rules.roll", {
    investigator: "inv-x6a217e22-e0532209",
  }, facts);
  assert.equal(opaque.ok, false);
  assert.equal(opaque.code, "opaque_entity_identity");
  assert.ok(!JSON.stringify(opaque).includes("inv-x6a217e22-e0532209"));

  const claims = restoreSemanticEntityHandles("turn.finalize", {
    agency_claims: [{
      claim_id: "c1",
      subject_ref: CURRENT_PC_SUBJECT_HANDLE,
      source_ref: CURRENT_PLAYER_INPUT_SOURCE_HANDLE,
    }],
    advisory_uptake: {
      advice_id: CURRENT_ADVICE_HANDLE,
      candidate_ref: CURRENT_CANDIDATE_HANDLE,
    },
  }, facts);
  assert.deepEqual(claims.value.agency_claims[0].subject_ref,
    "pc:inv-x6a217e22-e0532209");
  assert.deepEqual(claims.value.agency_claims[0].source_ref,
    "player_input:journal-stone-street-exterior-t1");
  assert.deepEqual(claims.value.advisory_uptake.advice_id,
    "storylets:0:df3fb04785ed9164779e");
  assert.deepEqual(claims.value.advisory_uptake.candidate_ref,
    "storylet-candidate-v1:23176fa5590f08753f5a868f042a2890");

  const opaqueSubject = restoreSemanticEntityHandles("turn.finalize", {
    agency_claims: [{ claim_id: "c1", subject_ref: "pc:inv-other" }],
  }, facts);
  assert.equal(opaqueSubject.ok, false);
  assert.ok(!JSON.stringify(opaqueSubject).includes("inv-other"));

  // Closed semantic-identity grammar: UUID/hex/random-token identity values
  // fail closed (field named, value never echoed); meaning-bearing ids pass.
  const grammar = restoreSemanticEntityHandles("turn.finalize", {
    agency_claims: [{
      claim_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      subject_ref: CURRENT_PC_SUBJECT_HANDLE,
      source_ref: CURRENT_PLAYER_INPUT_SOURCE_HANDLE,
    }],
  }, facts);
  assert.equal(grammar.ok, false);
  assert.equal(grammar.code, "opaque_identity_grammar");
  assert.ok(grammar.message.includes("claim_id"));
  assert.ok(!JSON.stringify(grammar).includes("7c9e6679"));
  const hexDecision = restoreSemanticEntityHandles("state.journal", {
    decision_id: "journal-9f2d4c8ab17e4460b3a9c5d1e7f02a46",
    player_text: "probe",
  }, facts);
  assert.equal(hexDecision.ok, false);
  assert.equal(hexDecision.code, "opaque_identity_grammar");
  assert.ok(!JSON.stringify(hexDecision).includes("9f2d4c8a"));
  const semanticIds = restoreSemanticEntityHandles("state.journal", {
    decision_id: "journal-stone-street-exterior-t1",
    player_text: "probe",
  }, facts);
  assert.equal(semanticIds.ok, true);
  const coverageIds = restoreSemanticEntityHandles("turn.finalize", {
    coverage: [{
      obligation_id: "roll:toolbox-king-shreds-recovery-live-01-000003",
      realization: "fictional_beat",
    }],
  }, facts);
  assert.equal(coverageIds.ok, true);

  // Weapon/route refs: registry-backed handles project; unregistered ids
  // fail closed (dropped, with bounded diagnostics) in boundary mode;
  // entropy rejects at the raw gate.
  {
    const { createSemanticIdentityRegistry } = await import(
      path.join(root, "plugins/coc-keeper/pi/lib/semantic-identity-registry.ts")
    );
    const registry = createSemanticIdentityRegistry();
    const registryScope = {
      sessionEpoch: 1,
      campaign: "boundary-registry",
      playerTurnEpoch: 1,
      ownerKey: "inventory:investigator:boundary-owner",
    };
    registry.applySnapshot("weapon", registryScope, [
      { canonicalId: "item-7c9e6679", facts: ["iron-knife"] },
    ]);
    registry.applySnapshot("route", registryScope, [
      { canonicalId: "route:old-mill-path", facts: ["old-mill-path"] },
    ]);
    const mappedDiag = { unmapped: [] };
    const weaponOut = stripOpaqueModelIdentity({
      weapon_id: "item-7c9e6679",
      route_id: "route:old-mill-path",
    }, null, registry.projectAll(registryScope), mappedDiag);
    assert.equal(weaponOut.weapon_id, "weapon:iron-knife");
    assert.equal(weaponOut.route_id, "route:old-mill-path");
    assert.deepEqual(mappedDiag.unmapped, []);
    const boundaryDiag = { unmapped: [] };
    const unregistered = stripOpaqueModelIdentity({
      weapon_id: "item-unobserved",
      route_id: "route:never-seen-path",
    }, null, emptySemanticProjectionView(), boundaryDiag);
    assert.equal(unregistered.weapon_id, undefined,
      "unobserved weapon ids fail closed instead of leaking");
    assert.equal(unregistered.route_id, undefined,
      "unobserved route ids fail closed instead of leaking");
    assert.deepEqual(
      boundaryDiag.unmapped.map((entry) => entry.domain).sort(),
      ["route", "weapon"],
    );
  }

  // Schema-driven identity inventory (TRUE zero-exemption): every
  // identity-bearing field path in the presented model-facing operation
  // schemas — after host-owned AND never-model-authored fields are projected
  // out — must classify into a registry/grammar domain. Fields of the
  // never-model-authored family (settle identity, workstream infrastructure)
  // surviving projection are failures; integrity/hash/digest-named fields in
  // a model-owned schema are failures; the generic coc_invoke envelope is
  // inventoried through each selected operation's projected schema. There is
  // no documented exemption list.
  {
    const { loadOperationContracts } = await import(
      path.join(root, "plugins/coc-keeper/pi/lib/operation-contracts.ts")
    );
    const { presentedTypedToolParameters } = await import(
      path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts")
    );
    const { modelIdentityFieldClass, projectModelOwnedSchema } = await import(
      path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts")
    );
    const { buildGenericInvokeInputSchema } = await import(
      path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts")
    );
    const contracts = loadOperationContracts();
    const MODEL_OWNED_CLASSES = new Set([
      "composed", "echoed", "handle_only", "handle_or_namespace",
      "decision", "provenance", "vocabulary",
    ]);
    const isIdentityNamed = (prop) =>
      /(^|_)(id|ids|ref|refs)$/.test(prop)
      || prop === "investigator"
      || prop === "decision_id";
    const isIntegrityNamed = (prop) =>
      /(?:^|_)(?:sha256|sha1|digest|hash|integrity|seal|receipt)(?:_|$)/i.test(prop);
    const failures = [];
    const walk = (schema, basePath, operation) => {
      if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
      for (const [key, value] of Object.entries(schema)) {
        if (key === "properties" && value && typeof value === "object") {
          for (const [prop, sub] of Object.entries(value)) {
            const fieldPath = `${basePath}${prop}`;
            if (isIntegrityNamed(prop)) {
              failures.push(`integrity:${operation}:${fieldPath}`);
            } else if (isIdentityNamed(prop)) {
              const fieldClass = modelIdentityFieldClass(prop);
              if (!MODEL_OWNED_CLASSES.has(fieldClass)) {
                failures.push(`${fieldClass}:${operation}:${fieldPath}`);
              }
            }
            walk(sub, `${fieldPath}.`, operation);
          }
        } else if (key === "items") {
          walk(value, basePath, operation);
        } else if ((key === "oneOf" || key === "anyOf" || key === "allOf")
          && Array.isArray(value)) {
          value.forEach((entry) => walk(entry, basePath, operation));
        }
      }
    };
    // Typed surfaces: walk each operation's projected model-owned schema…
    for (const [key, contract] of contracts.operations) {
      const operation = contract?.operation ?? key;
      const presented = presentedTypedToolParameters(operation, contract.inputSchema ?? {});
      walk(projectModelOwnedSchema(operation, presented), "", String(operation));
    }
    // …and the ACTUAL REGISTERED generic coc_invoke schema — the exact
    // object buildGenericInvokeInputSchema() produces for tool registration,
    // runtime validation, and this inventory (no synthetic substitute).
    // Each operation branch is closed, pins its operation const at the
    // envelope level, and strips the host-bound transport fields.
    const registeredGenericSchema = buildGenericInvokeInputSchema();
    globalThis.__registeredGenericInvokeSchema = registeredGenericSchema;
    assert.ok(Array.isArray(registeredGenericSchema.oneOf));
    for (const branch of registeredGenericSchema.oneOf) {
      const operation = branch.properties.operation.const;
      assert.equal(branch.additionalProperties, false, operation);
      assert.equal(branch.type, "object", operation);
      assert.deepEqual(
        Object.keys(branch.properties).sort(),
        ["arguments", "operation"],
        `${operation}: the envelope carries only operation + arguments`,
      );
      const argumentAlternatives = branch.properties.arguments.oneOf;
      assert.equal(
        argumentAlternatives.length, 2,
        `${operation}: object schema + JSON-string decoding alternative`,
      );
      walk(argumentAlternatives[0], "", `generic:${operation}`);
      for (const hostField of ["campaign", "root"]) {
        assert.equal(
          Object.hasOwn(argumentAlternatives[0].properties ?? {}, hostField),
          false,
          `${operation}: ${hostField} is host-bound and never model-authored`,
        );
      }
    }
    assert.deepEqual(failures, [],
      "model-owned schemas must project out never-model-authored and "
        + "integrity fields, and every surviving identity path must classify "
        + "into a registry/grammar domain — on typed and generic surfaces");

    // Injected-unknown probes: a brand-new identity field AND a brand-new
    // digest field in a real presented schema must both fail this inventory.
    const injected = structuredClone(
      contracts.operations.get("turn.finalize")?.inputSchema ?? {},
    );
    injected.properties ??= {};
    injected.properties.probe_unknown_ref = { type: "string" };
    injected.properties.probe_unknown_sha256 = { type: "string" };
    const injectedProjected = projectModelOwnedSchema("turn.finalize", injected);
    const probe = { identity: [], integrity: [] };
    const probeWalk = (schema) => {
      if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
      for (const [key, value] of Object.entries(schema)) {
        if (key === "properties" && value && typeof value === "object") {
          for (const [prop, sub] of Object.entries(value)) {
            if (isIntegrityNamed(prop)) probe.integrity.push(prop);
            else if (isIdentityNamed(prop)
              && !MODEL_OWNED_CLASSES.has(modelIdentityFieldClass(prop))) {
              probe.identity.push(prop);
            }
            probeWalk(sub);
          }
        } else if (key === "items") {
          probeWalk(value);
        } else if (["oneOf", "anyOf", "allOf"].includes(key) && Array.isArray(value)) {
          value.forEach(probeWalk);
        }
      }
    };
    probeWalk(injectedProjected);
    assert.ok(
      probe.identity.includes("probe_unknown_ref"),
      "an injected unknown identity field must fail the inventory",
    );
    // Digest-named fields are projected out of the model-owned view…
    assert.equal(
      Object.hasOwn(injectedProjected.properties ?? {}, "probe_unknown_sha256"),
      false,
      "an injected digest field must be projected out of the model-owned schema",
    );
    // …and flagged by the inventory when present before projection.
    const injectedPresented = presentedTypedToolParameters(
      "turn.finalize",
      injected,
    );
    probe.integrity = [];
    probeWalk(injectedPresented);
    assert.ok(
      probe.integrity.includes("probe_unknown_sha256"),
      "an injected digest field must fail the inventory before projection",
    );
  }

  // Raw model-payload validation (pre-restoration gate): closed namespaces
  // are the authority; UUID/entropy checks are secondary defense only.
  const raw = (args) => validateRawModelIdentityPayload(args);
  assert.equal(raw({ decision_id: "journal-stone-street-exterior-t1" }).ok, true);
  assert.equal(raw({ decision_id: "roll-spot-hidden-t1" }).ok, true);
  assert.equal(raw({ run_id: "run-1" }).ok, true);
  // Internal toolbox roll ids reject in every form; semantic handles pass.
  assert.equal(raw({
    coverage: [{
      obligation_id: "roll:toolbox-king-shreds-recovery-live-01-000003",
      realization: "fictional_beat",
    }],
  }).ok, false);
  assert.equal(raw({
    presented_roll_ids: ["toolbox-king-shreds-recovery-live-01-000003"],
  }).ok, false);
  assert.equal(raw({
    coverage: [{
      obligation_id: "roll:inspect-exterior-stone-street-t1",
      realization: "fictional_beat",
    }],
  }).ok, true);
  assert.equal(raw({
    coverage: [{
      obligation_id: "roll:con",
      realization: "fictional_beat",
    }],
  }).ok, true, "host-minted characteristic handles must pass raw grammar");
  assert.equal(raw({
    agency_claims: [{ claim_id: "claim-wall-listen-cupboard" }],
  }).ok, true);
  assert.equal(raw({ subject_ref: CURRENT_PC_SUBJECT_HANDLE }).ok, true);
  assert.equal(raw({ source_ref: "narration_contract:involuntary_physiology" }).ok, true);
  assert.equal(raw({ advice_id: "advice:corridor-whisper" }).ok, true);
  const rejects = (args, field) => {
    const result = raw(args);
    assert.equal(result.ok, false, JSON.stringify(args));
    assert.equal(result.field, field);
    assert.ok(!JSON.stringify(result).includes("7c9e6679"));
    return result;
  };
  rejects({ decision_id: "pi-attacker-controlled" }, "decision_id");
  rejects({ agency_claims: [{ claim_id: "pi-turn-finalize:deadbeef" }] }, "claim_id");
  rejects({ agency_claims: [{ claim_id: "x" }] }, "claim_id");
  rejects({ agency_claims: [{ claim_id: "foo" }] }, "claim_id");
  // Length is never the authority: padded opaque/composition-less tokens
  // still reject under the field prefix/namespace rules.
  rejects({ agency_claims: [{ claim_id: "abcdefgh" }] }, "claim_id");
  rejects({ scene_id: "abcd" }, "scene_id");
  rejects({ decision_id: "abcdefgh" }, "decision_id");
  rejects({ agency_claims: [{ claim_id: "claim-7c9e6679-7425-40de-944b-e07fc1f90ae7" }] }, "claim_id");
  rejects({ agency_claims: [{ claim_id: "claim-a1b2c3d4e5f6a7b8" }] }, "claim_id");
  rejects({ decision_id: "journal-9f2d4c8ab17e4460b3a9c5d1e7f02a46" }, "decision_id");
  rejects({ clue_id: "scene:unknown-namespace" }, "clue_id");
  rejects({ obligation_id: "archive:b8f1c2d3e4f5a6b7" }, "obligation_id");
  rejects({ subject_ref: "pc:inv-relayed" }, "subject_ref");
  rejects({ source_ref: "player_input:9f2d4c8ab17e4460b3a9c5d1e7f02a46" }, "source_ref");
  rejects({ investigator: "inv-x6a217e22-e0532209" }, "investigator");
  rejects({ presented_roll_ids: ["roll-9f2d4c8ab17e4460"] }, "presented_roll_ids");
  rejects({ weapon_id: "weapon:9f2d4c8ab17e4460" }, "weapon_id");
  rejects({ route_id: "route:x" }, "route_id");
  assert.equal(raw({ route_id: "route:old-mill-path" }).ok, true);
  assert.equal(raw({ weapon_id: "weapon:iron-knife" }).ok, true);
  // Coverage obligation ids are the host-presented semantic keys and echo.
  // Internal toolbox roll ids reject in every form; semantic handles pass.
  assert.equal(raw({
    coverage: [{
      obligation_id: "roll:toolbox-king-shreds-recovery-live-01-000003",
      realization: "fictional_beat",
    }],
  }).ok, false);
  assert.equal(raw({
    presented_roll_ids: ["toolbox-king-shreds-recovery-live-01-000003"],
  }).ok, false);
  assert.equal(raw({
    coverage: [{
      obligation_id: "roll:inspect-exterior-stone-street-t1",
      realization: "fictional_beat",
    }],
  }).ok, true);
  // Roll/effect reference fields are closed too: raw pi-* and internal
  // toolbox ids reject; semantic roll refs pass.
  rejects({ source_roll_id: "pi-x" }, "source_roll_id");
  rejects({ source_roll_id: "toolbox-king-shreds-recovery-live-01-000003" }, "source_roll_id");
  rejects({ mechanics_placements: [{ source_ids: ["pi-x"] }] }, "source_ids");
  rejects({ mechanics_placements: [{ source_ids: ["abcd"] }] }, "source_ids");
  assert.equal(raw({ source_roll_id: "roll:spot-hidden-1" }).ok, true);
  assert.equal(raw({
    mechanics_placements: [{ source_ids: ["roll-spot-hidden"] }],
  }).ok, true);
  assert.equal(raw({ scene_id: "scene:downtown-docks" }).ok, true);
  // A long, meaning-bearing multi-segment decision id stays accepted.
  assert.equal(raw({
    decision_id: "move-stone-street-coft-lodging-turn-two-listen-at-the-back-door",
  }).ok, true);
  // R3 rules.settle semantic ids: decision cards and actor refs pass;
  // machine namespaces/entropy on the same fields still reject.
  assert.equal(raw({
    decision_ref: "decision:coc7:healing:first-aid-stabilization",
  }).ok, true);
  assert.equal(raw({ rescuer_ref: "npc:doctor-one" }).ok, true);
  assert.equal(raw({ assistant_rescuer_ref: "npc:second-hands" }).ok, true);
  assert.equal(raw({ assistant_rescuer_ref: "npc-second-hands" }).ok, true);
  rejects({ decision_ref: "pi-x" }, "decision_ref");
  rejects({
    decision_ref: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  }, "decision_ref");
  rejects({ rescuer_ref: "toolbox-abc123def456789" }, "rescuer_ref");
  rejects({ assistant_rescuer_ref: "job-45db308081f7" }, "assistant_rescuer_ref");

  // Host-bound identity is NEVER model-authored: any raw supply rejects
  // before host restoration, naming only the field — even semantic values.
  rejects({ turn_id: "turn-v1-8e3599cdcb794cd5b993b59c077d126f" }, "turn_id");
  rejects({ turn_id: "turn:semantic-form" }, "turn_id");
  rejects({ finalization_id: "turn-effect-v1:played" }, "finalization_id");
  rejects({ journal_decision_id: "journal-semantic-name" }, "journal_decision_id");
  rejects({ narration_review_id: "narration-review-v1:abcd" }, "narration_review_id");
  rejects({ entry_id: "note-semantic-entry" }, "entry_id");
  rejects({ conversation_window_id: "window-semantic-name" }, "conversation_window_id");
  // A registry-shaped but unobserved handle passes the RAW grammar (raw
  // validation judges shape, not registry liveness); the restoration gate
  // fails it closed as unknown_semantic_handle before transport.
  assert.equal(raw({
    agency_claims: [{ claim_id: "claim-x", source_effect_id: "roll:made-up" }],
  }).ok, true);
  // Unclassified identity-shaped fields still reject machine namespaces and
  // entropy material before any nullable-rule pass — shape is never a bypass.
  rejects({ unknown_future_ref: "toolbox-abc123def456789" }, "unknown_future_ref");
  rejects({ unknown_future_ref: "pi-task-name" }, "unknown_future_ref");
  rejects({
    unknown_future_ref: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  }, "unknown_future_ref");
  rejects({ unknown_future_ids: ["9f2d4c8ab17e4460b3a9c5d1e7f02a46"] }, "unknown_future_ids");
  // …while meaning-bearing values on the same unruled field pass the raw
  // gate (canonical validation judges them at transport).
  assert.equal(raw({ unknown_future_ref: "old-mill-path" }).ok, true);
  assert.equal(raw({ unknown_future_ref: "scene:stone-street" }).ok, true);
  // Workstream infrastructure identity is NEVER model-authored on any
  // surface: even fully semantic-looking values reject at the raw gate.
  rejects({ job_id: "" }, "job_id");
  rejects({ job_id: "job-45db308081f7" }, "job_id");
  rejects({ asset_root_id: "coc-king-colfix-verify-001" }, "asset_root_id");
  rejects({ backlog_id: "backlog-campaign-t1" }, "backlog_id");
  // contract_id is setup-lane model-authored semantic card data (echoed
  // grammar): semantic values pass, machine ids reject.
  rejects({ contract_id: "job-contract-45db308081f7" }, "contract_id");
  assert.equal(raw({ contract_id: "coc.opening-fast-facts.v1" }).ok, true);
  rejects({ host_session_id: "session-main-table-01" }, "host_session_id");
  rejects({ rendered_sha256: "sha256:abc" }, "rendered_sha256");
  // The delivery lane is semantic-only on the generic surface too: a nested
  // legacy finalization relay rejects before any host binding.
  rejects({
    operation: "session.delivery_text",
    arguments: { finalization_id: "turn-effect-v1:ctx" },
  }, "finalization_id");
}

// ─────────────────────────────────────────────────────────────────────────────
// Part B — replayable normal turn through the real Pi gateway.
// ─────────────────────────────────────────────────────────────────────────────
const campaign = "king-shreds-recovery-live-01";
const testRoot = mkdtempSync(path.join(tmpdir(), "normal-model-id-boundary-"));
const tools = new Map();
const handlers = new Map();
const clientCalls = [];
const modelContents = [];
const stubCompilerInfer = async (input) => {
  const candidateClaims = Array.isArray(input.candidate_claims)
    ? input.candidate_claims
    : [];
  const compiledClaims = candidateClaims.map((claim) => ({
    subject_ref: claim.subject_ref,
    claim_kind: claim.claim_kind,
    exact_excerpt: claim.exact_excerpt,
    matched_review_claim_id: claim.claim_id,
    reason: "The exact draft claim matches the Keeper's semantic declaration.",
  }));
  return {
    result: {
      schema_version: 1,
      contract_id: "coc.pi-state-claim-compiler-result.v1",
      disposition: compiledClaims.length > 0
        ? "claims_detected"
        : "no_claims_detected",
      reason: "每一段草稿都已复核。",
      claims: compiledClaims,
      paragraph_coverage: draftParagraphs(input.draft_text).map(
        (text, paragraph_index) => ({
          paragraph_index,
          paragraph_sha256: canonicalDigest(text),
          claim_indices: compiledClaims.flatMap((claim, index) =>
            text.includes(claim.exact_excerpt) ? [index] : []
          ),
        }),
      ),
    },
    responseModel: { provider: "offline", id: "offline", api: "openai-responses" },
  };
};

// Host-initiated canonical probes (capabilities, memory.extraction_status)
// interleave with KP transports, so the fake client routes by operation.
const transportHandlers = new Map();
const routeOperation = (operation, envelope) =>
  transportHandlers.set(operation, envelope);
const transportFor = (operation) => {
  const handler = transportHandlers.get(operation);
  assert.ok(handler, `unexpected canonical transport: ${operation}`);
  return handler;
};

// Host-internal probes never model-visible; respond benignly.
routeOperation("memory.extraction_status", { ok: true, data: { status: "idle" } });
routeOperation("session.resume", () => resumeQueue.shift() ?? secondCampaignResume);
routeOperation("*", { ok: true, data: {} });

// Real ready-for-table campaigns resume with the complete scene projection
// nested under `data.scene_context`, not only the compact recovery index used
// by the original attempt-02 fixture. This shape must reuse the exact
// scene.context semantic boundary: semantic scene/clue/NPC/affordance ids
// remain visible, route ids are registry handles, and host-only identities
// stay private. A generic session.resume walk previously diagnosed every
// nested field as undeclared and failed the whole resume.
const populatedSceneResume = structuredClone(FAMILIES.session_resume);
populatedSceneResume.data.semantic_capsule = {
  ...(populatedSceneResume.data.semantic_capsule ?? {}),
  recent_summaries: [{
    turn_number: 1,
    summary: "调查员进入科比特地下藏身处。",
    source_ref: "memory/session-summaries.jsonl#turn-1",
    summary_sha256: `sha256:${"7".repeat(64)}`,
  }],
};
populatedSceneResume.data.scene_context = {
  ...populatedSceneResume.data.scene_context,
  active_scene_id: "commission-briefing",
  scene: {
    exit_conditions: [
      { kind: "clue_discovered", clue_id: "clue-knott-research-leads" },
    ],
  },
  npcs_present: [
    { npc_id: "npc-steven-knott", name: "Steven Knott" },
  ],
  clues_here: [
    {
      clue_id: "clue-knott-commission",
      conclusion_id: "commission-and-research-frame",
      discovered: false,
    },
  ],
  action_routes: [
    {
      route_id: "confirm-commission-terms",
      resolution_kind: "direct_delivery",
      grants_clue_ids: ["clue-knott-commission"],
    },
  ],
  nearby_routes: {
    destinations: [
      {
        scene_id: "newspaper-morgue",
        open_routes: [
          { affordance_id: "persuade-arty", cue: "Persuade the editor." },
        ],
      },
    ],
  },
  exits: [
    {
      to: "newspaper-morgue",
      kind: "unlock",
      open: false,
      when: { kind: "clue_discovered", clue_id: "clue-knott-research-leads" },
    },
  ],
  exit_operation_template: {
    operation: "state.move_scene",
    argument_binding: { scene_id: "copy selected exit destination" },
  },
};
const resumeQueue = [populatedSceneResume];
const secondCampaign = "king-shreds-other-campaign";
const secondCampaignResume = {
  ok: true,
  tool: "session.resume",
  data: {
    schema_version: 1,
    campaign_id: secondCampaign,
    mode: "awaiting_player",
    scene_context: { party: ["inv-other-campaign-9"] },
    next_operations: [],
  },
};

const fakePi = {
  registerTool(tool) {
    tools.set(tool.name, tool);
  },
  registerCommand() {},
  registerShortcut() {},
  on(type, handler) {
    const registered = handlers.get(type) || [];
    registered.push(handler);
    handlers.set(type, registered);
  },
  appendEntry() {},
  sendMessage() {},
  setActiveTools() {},
  getThinkingLevel: () => "off",
};
main.default(fakePi, {
  coordinatorEnabled: () => false,
  startupCampaignId: () => null,
  createStateClaimCompiler: () => new PiStateClaimCompiler(stubCompilerInfer),
  createClient: () => {
    const callTool = async (_name, params) => {
      clientCalls.push(JSON.parse(JSON.stringify(params)));
      const operation = String(params?.operation || "");
      const handler = transportHandlers.has(operation)
        ? transportHandlers.get(operation)
        : transportHandlers.get("*");
      assert.ok(handler, `unexpected canonical transport: ${operation}`);
      return typeof handler === "function" ? handler(params) : handler;
    };
    return {
      callTool,
      callToolWithTransportMeta: async (name, params) => ({
        value: await callTool(name, params),
        transport: null,
      }),
      async close() {},
    };
  },
});
// Schema identity proof: the REGISTERED coc_invoke parameters are the exact
// runtime validation/inventory schema (deep equality with the object the
// inventory walked above) — one closed source, no synthetic substitute.
assert.deepEqual(
  tools.get("coc_invoke").parameters,
  globalThis.__registeredGenericInvokeSchema,
  "registered coc_invoke parameters equal the inventory/runtime schema object",
);
const ctx = {
  cwd: testRoot,
  mode: "rpc",
  model: { provider: "probe", id: "probe" },
  sessionManager: {
    getSessionId: () => "normal-model-id-boundary",
    getEntries: () => [],
  },
  hasUI: false,
};

const executeTool = async (name, params) => {
  const delivered = await tools.get(name).execute(
    `probe-${name}`,
    params,
    undefined,
    undefined,
    ctx,
  );
  const contentText = delivered.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  modelContents.push({ name, text: contentText });
  return delivered;
};

for (const handler of handlers.get("session_start") || []) {
  await handler({ type: "session_start", reason: "probe" }, ctx);
}

// 1) Opening resume — party retention armed; wire stays details-only.
const resumeResult = await executeTool("coc_invoke", {
  operation: "session.resume",
  root: testRoot,
  campaign,
  arguments: {},
});
const resumeVisible = JSON.parse(modelContents.at(-1).text);
assert.deepEqual(
  resumeVisible.ok,
  true,
  `populated session.resume must stay model-visible: ${JSON.stringify({
    visible: resumeVisible,
    diagnostics: resumeResult.details?.semantic_identity_diagnostics,
  })}`,
);
assert.equal(resumeResult.details.wire.canonical_operation, "session.resume");
assert.equal(
  resumeVisible.data.scene_context.clues_here[0].clue_id,
  "clue-knott-commission",
);
assert.equal(
  resumeVisible.data.scene_context.nearby_routes.destinations[0].scene_id,
  "newspaper-morgue",
);
assert.equal(
  resumeVisible.data.semantic_capsule.recent_summaries[0].summary,
  "调查员进入科比特地下藏身处。",
);
assert.equal(
  Object.hasOwn(
    resumeVisible.data.semantic_capsule.recent_summaries[0],
    "source_ref",
  ),
  false,
);
assert.equal(
  Object.hasOwn(
    resumeVisible.data.semantic_capsule.recent_summaries[0],
    "summary_sha256",
  ),
  false,
);
assert.equal(
  resumeVisible.data.scene_context.nearby_routes.destinations[0]
    .open_routes[0].affordance_id,
  "persuade-arty",
);
assert.match(
  resumeVisible.data.scene_context.action_routes[0].route_id,
  /^route:/,
);
assert.ok(
  !JSON.stringify(resumeVisible).includes("confirm-commission-terms"),
  "nested authored route ids never reach model content unprojected",
);
assertModelSafeContent("session.resume content", resumeVisible);

// 2) scene.context with the semantic investigator handle.
routeOperation("scene.context", FAMILIES.scene_context);
const sceneResult = await executeTool("coc_scene_context", {
  root: testRoot,
  campaign,
  investigator: CURRENT_INVESTIGATOR_HANDLE,
});
assert.equal(
  clientCalls.filter((call) => call.operation === "scene.context").at(-1)
    .arguments.investigator,
  "inv-x6a217e22-e0532209",
  "host must restore the exact investigator id before transport",
);
assert.equal(
  JSON.parse(modelContents.at(-1).text).data.party[0],
  CURRENT_INVESTIGATOR_HANDLE,
);
assertModelSafeContent("scene.context content", JSON.parse(modelContents.at(-1).text));

// 2b) Complete the table opening so the phase advances to the live turn.
routeOperation("evidence.table_opening", FAMILIES.evidence_table_opening);
await executeTool("coc_evidence_table_opening", {
  presented_roll_ids: [],
  speaker: "KP",
  text: "夜。一封信送到你，程远，手上。\n\n[/in_game]",
});
assertModelSafeContent(
  "evidence.table_opening content",
  JSON.parse(modelContents.at(-1).text),
);
// An oversized combat.end result is intentionally reduced by the canonical
// wire to an identity-only replay card. Its projection digest remains
// host-only, while the replay operation must survive the FIRST response so
// the model does not repeat an already-authoritative combat mutation.
//
// Since the ten-family RuleGraph cutover, combat.end is `kp_surface: "none"`
// and outside the coc_invoke compatibility set: it has NO model-facing
// invocation. The card must therefore name the operation without advertising
// one, and a direct coc_invoke must be refused rather than silently accepted.
{
  const combatProjectionDigest = `sha256:${"9".repeat(64)}`;
  const combatEndCanonical = {
    ok: true,
    tool: "combat.end",
    wire: {
      schema_version: 1,
      profile: "keeper_hot_v1",
      canonical_operation: "combat.end",
      max_inline_bytes: 16384,
      full_result_bytes: 50656,
      full_result_sha256: `sha256:${"8".repeat(64)}`,
      contract_archive_sha256: `sha256:${"7".repeat(64)}`,
      payload_projected: true,
      identity_only: true,
      measured_inline_bytes: 1068,
    },
    data: {
      projection_sha256: combatProjectionDigest,
      replay_operation: {
        operation: "combat.end",
        invoke_via: null,
        model_invocable: false,
        prefilled_arguments: {},
        missing_arguments: [],
        authority: "advisory",
        hard_gate: false,
        contract_ref: "combat.end@4646cc703297402e",
        discovery_required: false,
      },
    },
    warnings: [
      "The canonical result exceeded the bounded coding-host projection.",
    ],
    hints: [],
  };
  routeOperation("combat.end", combatEndCanonical);
  const callsBefore = clientCalls.filter(
    (call) => call.operation === "combat.end",
  ).length;
  // The model has no route to a host-private operation. Attempting the hidden
  // compatibility wrapper must fail closed at the ACL, and must not reach the
  // canonical client.
  await assert.rejects(
    () => executeTool("coc_invoke", {
      operation: "combat.end",
      root: testRoot,
      campaign,
      arguments: {
        outcome: "investigator escaped the confrontation",
        decision_id: "combat-end-corbitt-escape-v1",
      },
    }),
    /combat\.end is not on the live KP domain surface/,
    "a host-private operation has no coc_invoke route",
  );
  assert.equal(
    clientCalls.filter((call) => call.operation === "combat.end").length,
    callsBefore,
    "a refused host-private call must not reach the canonical client",
  );
  // The identity-only projection of that same canonical result still hides the
  // digest and still names the operation — it just does not invite a call.
  const combatEndVisible = projectModelVisibleCanonicalResult(
    "combat.end",
    combatEndCanonical,
    null,
    { unmapped: [] },
  );
  assert.equal(combatEndVisible.ok, true, JSON.stringify(combatEndVisible));
  assert.equal(combatEndVisible.data.projection_sha256, undefined);
  assert.equal(
    combatEndVisible.data.replay_operation.operation,
    "combat.end",
  );
  assert.equal(
    combatEndVisible.data.replay_operation.invoke_via,
    null,
    "a host-private replay card must not advertise an invocation",
  );
  assert.equal(combatEndVisible.data.replay_operation.model_invocable, false);
  assert.ok(!JSON.stringify(combatEndVisible).includes(combatProjectionDigest));
  assertModelSafeContent("combat.end identity-only content", combatEndVisible);
}
// Random dice and opposed checks are authoritative rolls too. Their exact
// toolbox ids are registered before projection, so the first successful call
// remains ok:true and exposes only stable semantic roll handles. A model must
// never be pushed into retrying an already-settled opposed check because its
// result identity was undeclared.
{
  const randomCanonicalId = "toolbox-live-rules-000101";
  routeOperation("rules.roll_dice", {
    ok: true,
    tool: "rules.roll_dice",
    data: {
      expression: "1D6+1",
      count: 1,
      sides: 6,
      modifier: 1,
      rolls: [4],
      total: 5,
      reason: "随机伤害量",
      roll_id: randomCanonicalId,
    },
  });
  const randomResult = await executeTool("coc_rules_roll_dice", {
    campaign,
    decision_id: "roll-random-damage-v1",
    expression: "1D6+1",
    reason: "随机伤害量",
  });
  const randomVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(randomVisible.ok, true, JSON.stringify(randomVisible));
  assert.match(randomVisible.data.roll_id, /^roll:/);
  assert.ok(!modelContents.at(-1).text.includes(randomCanonicalId));
  assert.equal(randomResult.details.data.roll_id, randomCanonicalId);
  assertModelSafeContent("rules.roll_dice content", randomVisible);

  // `rules.opposed` is host-private since the ten-family cutover: core-check
  // is graph-owned and its legacy surface is hidden, so there is no typed tool
  // and no coc_invoke route. The Keeper reaches an opposed check through
  // rules.settle / decision:coc7:core-check:opposed-check.
  //
  // The invariant this block guards is unchanged and still worth guarding: one
  // canonical opposed settlement yields one usable model result whose two
  // canonical roll ids are replaced by distinct semantic handles. It is now
  // asserted on the projection directly, because the operation has no
  // model-facing tool to drive it through.
  const investigatorRollId = "toolbox-live-rules-000102";
  const opponentRollId = "toolbox-live-rules-000103";
  assert.equal(
    isTypedOperationTool("coc_rules_opposed"),
    false,
    "rules.opposed has no typed tool after the core-check cutover",
  );
  assert.equal(tools.get("coc_rules_opposed"), undefined);
  const opposedCanonical = {
    ok: true,
    tool: "rules.opposed",
    data: {
      investigator_id: "inv-x6a217e22-e0532209",
      skill: "Stealth",
      target_source: "sheet",
      investigator_roll: {
        target: 40,
        roll: 31,
        achieved_level: "regular",
        passed: true,
      },
      opponent_label: "守卫侦查",
      opponent_roll: {
        target: 55,
        roll: 72,
        achieved_level: "failure",
        passed: false,
      },
      winner: "investigator",
      investigator_roll_id: investigatorRollId,
      opponent_roll_id: opponentRollId,
    },
  };
  const opposedView = {
    ...emptySemanticProjectionView(),
    investigators: new Map([
      ["inv-x6a217e22-e0532209", CURRENT_INVESTIGATOR_HANDLE],
    ]),
    rolls: new Map([
      [investigatorRollId, "roll:stealth-vs-guard-investigator"],
      [opponentRollId, "roll:stealth-vs-guard-opponent"],
    ]),
  };
  const opposedDiagnostics = { unmapped: [] };
  const opposedVisible = projectModelVisibleCanonicalResult(
    "rules.opposed",
    opposedCanonical,
    opposedView,
    opposedDiagnostics,
  );
  assert.equal(opposedVisible.ok, true, JSON.stringify(opposedVisible));
  assert.deepEqual(opposedDiagnostics.unmapped, []);
  assert.match(opposedVisible.data.investigator_roll_id, /^roll:/);
  assert.match(opposedVisible.data.opponent_roll_id, /^roll:/);
  assert.notEqual(
    opposedVisible.data.investigator_roll_id,
    opposedVisible.data.opponent_roll_id,
  );
  const opposedRendered = JSON.stringify(opposedVisible);
  assert.ok(!opposedRendered.includes(investigatorRollId));
  assert.ok(!opposedRendered.includes(opponentRollId));
  assertModelSafeContent("rules.opposed content", opposedVisible);
}
// SAN typed tools expose only semantic cause/loss/trigger data. Host-owned
// idempotency and subsystem command identity never reach the model schema.
{
  // `rules.sanity_check` is host-private since the sanity family cutover, so
  // there is no typed tool to inspect or drive. Its model-visible projection —
  // semantic cause/loss/trigger data only, with every canonical session roll id
  // replaced by a `roll:` handle — is asserted directly on the projector
  // earlier in this file, where a populated roll view makes the mapping
  // observable without a tool round trip.
  assert.equal(
    isTypedOperationTool("coc_rules_sanity_check"),
    false,
    "rules.sanity_check has no typed tool after the sanity cutover",
  );
  assert.equal(tools.get("coc_rules_sanity_check"), undefined);

  // `sanity.execute` is host-private for the same reason: the sanity family is
  // graph-owned, so the subsystem command surface is no longer Keeper-facing.
  // Host-owned command identity (command_id / kind / phase / payload
  // decision_id) is therefore not a model schema question any more — nothing
  // presents that schema to the model at all.
  assert.equal(
    isTypedOperationTool("coc_sanity_execute"),
    false,
    "sanity.execute has no typed tool after the sanity cutover",
  );
  assert.equal(tools.get("coc_sanity_execute"), undefined);

  // The sanity bout surface was Keeper-facing before the cutover: the Keeper
  // read `sanity.context` for pending bout choices and drove them through
  // `sanity.execute`. Both are host-private now, so the armed-choice schema,
  // the semantic choice handles and the stale-choice transport guard no longer
  // have a model-facing surface to assert against.
  //
  // What still matters is the leak invariant: if a sanity context is ever
  // projected to the model, the host-owned bout, choice and command identity
  // must not survive it. Assert that on the projector directly.
  const boutChoiceId = "pi-sanity:opaque:bout";
  const boutSourceCommandId = "pi-sanity:opaque";
  const boutId = "inv-x6a217e22-e0532209:bout:1";
  assert.equal(isTypedOperationTool("coc_sanity_context"), false);
  assert.equal(tools.get("coc_sanity_context"), undefined);
  const boutVisible = projectModelVisibleCanonicalResult(
    "sanity.context",
    {
      ok: true,
      tool: "sanity.context",
      data: {
        investigator_id: "inv-x6a217e22-e0532209",
        active: true,
        snapshot: {
          investigator_id: "inv-x6a217e22-e0532209",
          bout_active: true,
          active_bout_id: boutId,
          bout_rounds_remaining: 2,
        },
        pending_choices: [{
          choice_id: boutChoiceId,
          command_id: boutSourceCommandId,
          kind: "bout_keeper_action",
          responder: "keeper",
          revision: 0,
          prompt: "Advance or end the active Keeper-controlled bout?",
          options: [
            { action: "tick", label: "Advance Keeper-controlled round" },
            { action: "end", label: "End the bout now" },
          ],
        }],
      },
    },
    {
      ...emptySemanticProjectionView(),
      investigators: new Map([
        ["inv-x6a217e22-e0532209", CURRENT_INVESTIGATOR_HANDLE],
      ]),
    },
  );
  assertModelSafeContent("sanity.context active bout", boutVisible);
  const boutRendered = JSON.stringify(boutVisible);
  assert.ok(!boutRendered.includes(boutChoiceId));
  assert.ok(!boutRendered.includes(boutSourceCommandId));
  assert.ok(!boutRendered.includes(boutId));

}

// 2c) Canonical mutation success must survive the model projection. These
// fields already belong to the closed semantic grammar; an incomplete
// per-operation output table must not turn the authoritative ok:true result
// into semantic_identity_unavailable and invite a duplicate write.
{
  const canonicalCashGrant = {
    ok: true,
    tool: "state.cash_grant",
    data: {
      decision_id: "cash-knott-advance-accept-v1",
      op: "grant",
      amount: "20.00",
      currency: "USD",
      source: "npc:steven-knott-commission-advance",
      reason: "Knott cash advance on accepting the commission",
      localized_reason: "诺特支付的首日调查预付金",
      balance_before: "0.00",
      balance_after: "20.00",
      recorded_at: "1920-10-12T10:00:00-04:00",
      game_time: {
        calendar_mode: "gregorian",
        civil_segment_id: "civil-start",
        day_phase: "morning",
        display: "1920-10-12 10:00",
        elapsed_minutes: 0,
      },
      changed: true,
      investigator_id: "inv-x6a217e22-e0532209",
    },
    warnings: [],
    hints: [],
  };
  routeOperation("state.cash_grant", canonicalCashGrant);
  const cashResult = await executeTool("coc_invoke", {
    operation: "state.cash_grant",
    root: testRoot,
    campaign,
    arguments: {
      amount: 20,
      currency: "USD",
      source: "npc:steven-knott-commission-advance",
      reason: "Knott cash advance on accepting the commission",
      localized_reason: "诺特支付的首日调查预付金",
      decision_id: "cash-knott-advance-accept-v1",
    },
  });
  const cashVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(
    cashVisible.ok,
    true,
    `successful cash mutation must remain visible: ${JSON.stringify({
      visible: cashVisible,
      diagnostics: cashResult.details?.semantic_identity_diagnostics,
    })}`,
  );
  assert.equal(cashVisible.data.decision_id, "cash-knott-advance-accept-v1");
  assert.equal(cashVisible.data.game_time.civil_segment_id, "civil-start");
  assert.equal(cashVisible.data.balance_after, "20.00");
  assertModelSafeContent("state.cash_grant content", cashVisible);

  const opaqueCashGrant = structuredClone(canonicalCashGrant);
  opaqueCashGrant.data.decision_id =
    "cash-7c9e6679-7425-40de-944b-e07fc1f90ae7";
  routeOperation("state.cash_grant", opaqueCashGrant);
  const opaqueCashResult = await executeTool("coc_invoke", {
    operation: "state.cash_grant",
    root: testRoot,
    campaign,
    arguments: {
      amount: 20,
      currency: "USD",
      source: "npc:steven-knott-commission-advance",
      reason: "opaque output identity probe",
      localized_reason: "不透明输出身份探针",
      decision_id: "cash-knott-advance-probe-v2",
    },
  });
  const opaqueCashVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(opaqueCashVisible.ok, false);
  assert.equal(
    opaqueCashVisible.error.code,
    "semantic_identity_unavailable",
    "a classified field still rejects an opaque canonical value",
  );
  assert.ok(!modelContents.at(-1).text.includes("7c9e6679"));
  // The refusal must name WHICH field failed closed -- the names are schema,
  // the values are the identity being withheld and stay out (asserted just
  // above). Without the names the refusal is unfalsifiable: on 2026-09-02
  // every rules.context for the sanity family collapsed through a whole run
  // saying only "(undeclared)", so the Keeper got no cards and no reason,
  // settled decision refs from memory, and burned five round trips guessing
  // arguments for a bout that was not underway. Recovering the field name
  // afterwards meant digging through host-internal evidence the diagnostic
  // lanes do not record at all.
  assert.ok(
    Array.isArray(opaqueCashVisible.error.details.undeclared_fields)
      && opaqueCashVisible.error.details.undeclared_fields.length > 0,
    "the collapse must name the fields that failed closed",
  );
  assert.ok(
    opaqueCashVisible.error.details.undeclared_fields.some(
      (field) => String(field).includes("decision_id"),
    ),
    "and they must be the actual offending fields",
  );
  assert.ok(
    opaqueCashVisible.error.message.includes("decision_id"),
    "the message the Keeper reads names them too",
  );
  assert.deepEqual(
    opaqueCashResult.details.canonical,
    opaqueCashGrant,
    "the rejected exact mutation envelope stays host-only",
  );

  const misplacedEntityGrant = structuredClone(canonicalCashGrant);
  misplacedEntityGrant.data.scene_id = "commission-briefing";
  routeOperation("state.cash_grant", misplacedEntityGrant);
  const misplacedResult = await executeTool("coc_invoke", {
    operation: "state.cash_grant",
    root: testRoot,
    campaign,
    arguments: {
      amount: 20,
      currency: "USD",
      source: "npc:steven-knott-commission-advance",
      reason: "operation-local echoed identity probe",
      localized_reason: "操作局部实体身份探针",
      decision_id: "cash-knott-advance-probe-v3",
    },
  });
  const misplacedVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(misplacedVisible.ok, false);
  assert.equal(misplacedVisible.error.code, "semantic_identity_unavailable");
  assert.ok(!modelContents.at(-1).text.includes("commission-briefing"));
  assert.ok(
    misplacedResult.details.semantic_identity_diagnostics.some((entry) =>
      entry.field === "scene_id" && entry.domain === "undeclared"
    ),
    "echoed entity fields remain operation-local rather than globally open",
  );
}

// 2d) Nested model-authored semantic identities use the same systemic output
// classifier. An acquisition receipt's decision_id must stay meaningful and
// visible after a successful item mutation; it is not operation-local syntax.
{
  const canonicalItemGrant = {
    ok: true,
    tool: "state.item_grant",
    data: {
      investigator_id: "inv-x6a217e22-e0532209",
      kind: "gear",
      item_id: "corbitt-house-keys",
      label: "科比特宅钥匙",
      changed: true,
      present_before: false,
      present_after: true,
      items: [{
        item_id: "corbitt-house-keys",
        kind: "gear",
        label: "科比特宅钥匙",
        note: "史蒂文·诺特当面交托",
        acquired: {
          tool: "state.item_grant",
          decision_id: "item-corbitt-house-keys-v1",
          ts: "1920-10-12T10:00:00-04:00",
        },
      }],
    },
    warnings: [],
    hints: [],
  };
  routeOperation("state.item_grant", canonicalItemGrant);
  const itemResult = await executeTool("coc_invoke", {
    operation: "state.item_grant",
    root: testRoot,
    campaign,
    arguments: {
      kind: "gear",
      label: "科比特宅钥匙",
      note: "史蒂文·诺特当面交托",
      decision_id: "item-corbitt-house-keys-v1",
    },
  });
  const itemVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(
    itemVisible.ok,
    true,
    `successful item mutation must remain visible: ${JSON.stringify({
      visible: itemVisible,
      diagnostics: itemResult.details?.semantic_identity_diagnostics,
    })}`,
  );
  assert.equal(
    itemVisible.data.items.at(-1).acquired.decision_id,
    "item-corbitt-house-keys-v1",
  );
  assert.match(itemVisible.data.item_id, /^item:/);
  assertModelSafeContent("state.item_grant nested receipt content", itemVisible);
}


// 1b) Campaign-10 regression — commission briefing route affordance
// projection. The model-visible action_routes row carries an exact
// copy-verbatim `affordance_id` handle alongside its route-family
// `route_id`; the copied handle restores to the canonical route id before
// transport, while `route:`-prefixed and bare-slug forms fail closed at the
// raw grammar gate (the 04/05/10 guess ladder), and route consumers keep
// the `route:` family.
const commissionRoute = resumeVisible.data.scene_context.action_routes[0];
const affordanceHandle = commissionRoute.affordance_id;
assert.match(
  affordanceHandle,
  /^affordance:/,
  "actionable route must project an affordance-family handle",
);
assert.notEqual(
  affordanceHandle,
  commissionRoute.route_id,
  "affordance and route families must stay separate namespaces",
);
routeOperation("actions.advise", FAMILIES.actions_advise);

// Copied handle passes: the host restores the canonical route id exactly.
await executeTool("coc_invoke", {
  operation: "actions.advise",
  root: testRoot,
  campaign,
  arguments: {
    intent_evidence: {
      primary_intent: "confirm the commission terms with Knott",
      semantic_reason: "the player accepts the outlined commission",
      matched_affordance_ids: [affordanceHandle],
    },
  },
});
assert.equal(
  clientCalls.filter((call) => call.operation === "actions.advise").at(-1)
    .arguments.intent_evidence.matched_affordance_ids[0],
  "confirm-commission-terms",
  "copied affordance handle must restore to the canonical route id",
);

// `route:` namespace on the affordance field fails closed, no transport.
const routeFormAdvise = await executeTool("coc_invoke", {
  operation: "actions.advise",
  root: testRoot,
  campaign,
  arguments: {
    intent_evidence: {
      primary_intent: "confirm the commission terms with Knott",
      semantic_reason: "the player accepts the outlined commission",
      matched_affordance_ids: ["route:confirm-commission-terms"],
    },
  },
});
assert.equal(routeFormAdvise.isError, true);
assert.equal(
  JSON.parse(modelContents.at(-1).text).error.code,
  "opaque_identity_grammar",
);
assert.ok(
  !modelContents.at(-1).text.includes("confirm-commission-terms"),
  "rejected route form must not echo the canonical id",
);

// Bare slug on the affordance field fails closed too: the verbatim handle
// is the only accepted form.
const bareFormAdvise = await executeTool("coc_invoke", {
  operation: "actions.advise",
  root: testRoot,
  campaign,
  arguments: {
    intent_evidence: {
      primary_intent: "confirm the commission terms with Knott",
      semantic_reason: "the player accepts the outlined commission",
      matched_affordance_ids: ["confirm-commission-terms"],
    },
  },
});
assert.equal(bareFormAdvise.isError, true);
assert.equal(
  JSON.parse(modelContents.at(-1).text).error.code,
  "opaque_identity_grammar",
);
assert.equal(
  clientCalls.filter((call) => call.operation === "actions.advise").length,
  1,
  "rejected affordance forms must never reach transport",
);
// 3) Explicit opaque investigator id fails closed without echo, no transport.
const opaqueArgs = {
  root: testRoot,
  campaign,
  investigator: "inv-x6a217e22-e0532209",
  skill: "Spot Hidden",
  difficulty: "regular",
  difficulty_basis: "environment",
  goal: "probe",
  decision_id: "roll-probe-opaque",
};
const opaqueRoll = await executeTool("coc_rules_damage", opaqueArgs);
assert.equal(opaqueRoll.isError, true);
const opaqueRollVisible = JSON.parse(modelContents.at(-1).text);
// The RAW model payload is grammar-checked before any host restoration, so
// the handle-only investigator field is rejected at the raw gate.
assert.equal(opaqueRollVisible.error.code, "opaque_identity_grammar");
assert.ok(
  !modelContents.at(-1).text.includes("inv-x6a217e22-e0532209"),
  "rejected opaque investigator id must not be echoed",
);
assert.equal(
  clientCalls.filter((call) => call.operation === "rules.damage").length,
  0,
  "fail-closed opaque id must never reach transport",
);

// 4) Normal roll with the semantic handle succeeds.
routeOperation("rules.damage", FAMILIES.rules_damage);
await executeTool("coc_rules_damage", {
  root: testRoot,
  campaign,
  investigator: CURRENT_INVESTIGATOR_HANDLE,
  kind: "damage",
  amount: "1",
  source: "查看门窗墙根",
  decision_id: "roll-spot-hidden-t1",
});
assert.equal(
  clientCalls.find((call) => call.operation === "rules.damage").arguments
    .investigator,
  "inv-x6a217e22-e0532209",
);
const rulesRollVisible = JSON.parse(modelContents.at(-1).text);
// `rules.damage` carries this block's identity-binding checks because
// `rules.roll` is host-private after the core-check cutover. Damage keeps its
// canonical roll host-side rather than publishing a handle, so what is
// asserted here is that the canonical id does not leak while the semantic
// result survives. The complementary invariant — a public roll the model may
// reference DOES retain its registry-backed `roll:` handle — is asserted on
// `rules.roll_dice`, which is still a Keeper-facing operation.
assert.equal(rulesRollVisible.ok, true, JSON.stringify(rulesRollVisible));
assert.equal(rulesRollVisible.data.roll_id, undefined);
assert.ok(
  !modelContents.at(-1).text.includes(FAMILIES.rules_damage.data.roll_id),
  "the canonical damage roll id must not reach model content",
);
assert.equal(rulesRollVisible.data.hp_after, 10);
assertModelSafeContent("rules.damage carrier content", rulesRollVisible);

// Publishing the public roll handle that later effect/coverage blocks bind to.
// Before the cutover this came from a `rules.roll` result's
// `resolution_context.attempt_id`; a graph-settled check keeps its canonical
// roll host-side, so the Keeper-facing publisher is now `rules.roll_dice`.
routeOperation("rules.roll_dice", {
  ok: true,
  tool: "rules.roll_dice",
  data: {
    expression: "1D100",
    count: 1,
    sides: 100,
    modifier: 0,
    rolls: [62],
    total: 62,
    reason: "inspect exterior stone street t1",
    roll_id: "toolbox-king-shreds-recovery-live-01-000003",
  },
});
await executeTool("coc_rules_roll_dice", {
  campaign,
  decision_id: "roll-inspect-exterior-stone-street-t1",
  expression: "1D100",
  reason: "inspect exterior stone street t1",
});
assert.equal(
  JSON.parse(modelContents.at(-1).text).data.roll_id,
  "roll:inspect-exterior-stone-street-t1",
  "public rolls the model may reference retain their registry-backed handle",
);

// 4a) A damage expression mints its canonical roll id inside the successful
// mutation result, after the model's pre-call roll view was established. The
// model needs the authoritative dice/HP facts, not that machine identity: a
// missing immediate handle must never turn ok:true into an apparent failure
// that invites the mutation to be retried.
{
  const canonicalDamage = {
    ok: true,
    tool: "rules.damage",
    wire: {
      schema_version: 1,
      profile: "keeper_hot_v1",
      canonical_operation: "rules.damage",
      full_result_sha256: `sha256:${"a".repeat(64)}`,
      contract_archive_sha256: `sha256:${"b".repeat(64)}`,
      payload_projected: false,
    },
    data: {
      investigator_id: "inv-x6a217e22-e0532209",
      kind: "damage",
      amount: 2,
      roll_detail: {
        expression: "1D3",
        count: 1,
        sides: 3,
        modifier: 0,
        rolls: [2],
        total: 2,
      },
      hp_before: 12,
      hp_after: 10,
      max_hp: 12,
      conditions_before: [],
      conditions_after: [],
      conditions: [],
      source: "strike the desk corner until the knuckles bleed",
      roll_id: "toolbox-rulegraph-healing-e2e-xai-20260830-03-000002",
    },
    warnings: [],
    hints: [],
  };
  routeOperation("rules.damage", canonicalDamage);
  const damageTransportsBefore = clientCalls.filter(
    (call) => call.operation === "rules.damage",
  ).length;
  const damageResult = await executeTool("coc_rules_damage", {
    root: testRoot,
    campaign,
    investigator: CURRENT_INVESTIGATOR_HANDLE,
    kind: "damage",
    amount: "1D3",
    source: "strike the desk corner until the knuckles bleed",
    decision_id: "roll-knuckles-desk-corner-v1",
  });
  const damageVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(
    damageVisible.ok,
    true,
    `successful damage must remain visible: ${JSON.stringify({
      visible: damageVisible,
      diagnostics: damageResult.details?.semantic_identity_diagnostics,
    })}`,
  );
  assert.equal(damageVisible.data.investigator_id, CURRENT_INVESTIGATOR_HANDLE);
  assert.equal(damageVisible.data.amount, 2);
  assert.deepEqual(damageVisible.data.roll_detail, {
    expression: "1D3",
    count: 1,
    sides: 3,
    modifier: 0,
    rolls: [2],
    total: 2,
  });
  assert.equal(damageVisible.data.hp_before, 12);
  assert.equal(damageVisible.data.hp_after, 10);
  assert.equal(damageVisible.data.roll_id, undefined);
  assert.ok(
    !modelContents.at(-1).text.includes(canonicalDamage.data.roll_id),
    "the newly minted canonical damage roll id stays out of model content",
  );
  assert.deepEqual(
    damageResult.details,
    canonicalDamage,
    "the exact successful damage envelope and roll identity stay host-only",
  );
  assert.equal(
    clientCalls.filter((call) => call.operation === "rules.damage").length,
    damageTransportsBefore + 1,
    "a successful damage mutation reaches canonical transport exactly once",
  );
  assertModelSafeContent("rules.damage content", damageVisible);
}

// The graph settlement surface returns the same class of newly minted roll
// evidence nested inside an existing canonical result envelope. Keep its
// public dice/actor/HP facts while command, roll, state-path, and digest
// identity remain host-owned; no RuleGraph or healing implementation fixture
// is involved in this projection-only regression.
{
  const graphCommandId = "healing:graph-first-aid-v1-first-aid";
  const graphRollId = `${graphCommandId}:roll:primary`;
  const graphEvent = {
    event_type: "first_aid",
    outcome: "extreme",
    hp_before: 5,
    hp_after: 6,
    hp_gained: 1,
    caregiver_id: "doctor-one",
    rule_ref: "core.combat.first_aid",
    source_command_id: graphCommandId,
    treatment_scope: {
      day_id: "day-0",
      wound_id: "wound-desk-corner",
    },
  };
  const graphRoll = {
    actor_id: "thomas-hayes",
    decision_id: "roll-healing-graph-first-aid-v1",
    dice: { expression: "1D100", raw: [8], total: 8 },
    event_type: "combat_rescue_roll",
    outcome: "extreme",
    passed: true,
    roll: 8,
    roll_id: graphRollId,
    roll_role: "percentile_check",
    source_command_id: graphCommandId,
    target: 80,
  };
  const canonicalGraphSettle = {
    ok: true,
    tool: "rules.settle",
    wire: {
      schema_version: 1,
      profile: "keeper_hot_v1",
      canonical_operation: "rules.settle",
      full_result_sha256: `sha256:${"c".repeat(64)}`,
      contract_archive_sha256: `sha256:${"d".repeat(64)}`,
      payload_projected: false,
    },
    data: {
      decision_ref: "decision:coc7:healing:first-aid-ordinary",
      family: "healing",
      status: "settled",
      rule_refs: ["rule:coc7:healing:first-aid"],
      investigator_id: "thomas-hayes",
      event: graphEvent,
      player_state_receipt: {
        schema_version: 1,
        investigator_id: "thomas-hayes",
        hp: { before: 5, after: 6 },
        conditions_before: ["major_wound"],
        conditions_after: [],
      },
      current_hp: 6,
      conditions: [],
      settlement: {
        existing_result_envelope: true,
        result: {
          investigator_id: "thomas-hayes",
          event: graphEvent,
          events: [graphEvent, graphRoll],
          player_state_receipt: {
            schema_version: 1,
            investigator_id: "thomas-hayes",
            hp: { before: 5, after: 6 },
            conditions_before: ["major_wound"],
            conditions_after: [],
          },
          current_hp: 6,
          conditions: [],
          rescuer_id: "thomas-hayes",
          results: [{
            command_id: graphCommandId,
            events: [graphEvent, graphRoll],
            kind: "stabilize",
            pending_choice: null,
            state_refs: [
              "save/investigator-state/thomas-hayes.json#current_hp",
              `logs/rolls.jsonl#${graphRollId}`,
            ],
            status: "completed",
          }],
        },
      },
      next_decisions: [{
        decision_ref: "decision:coc7:healing:medicine-stabilization",
        capability_ref: "capability:coc7:medicine",
        rule_refs: ["rule:coc7:healing:medicine"],
      }],
      authority: "canonical-resolver-state-receipts",
      request_digest: `sha256:${"e".repeat(64)}`,
    },
    warnings: [],
    hints: [],
  };
  routeOperation("rules.settle", canonicalGraphSettle);
  const settleResult = await executeTool("coc_rules_settle", {
    root: testRoot,
    campaign,
    investigator: CURRENT_INVESTIGATOR_HANDLE,
    decision_ref: "decision:coc7:healing:first-aid-ordinary",
    semantic_inputs: { rescuer_ref: "npc:doctor-one" },
    decision_id: "roll-healing-graph-first-aid-v1",
  });
  const settleVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(
    settleVisible.ok,
    true,
    `successful graph settlement must remain visible: ${JSON.stringify({
      visible: settleVisible,
      diagnostics: settleResult.details?.semantic_identity_diagnostics,
    })}`,
  );
  assert.equal(settleVisible.data.status, "settled");
  assert.equal(settleVisible.data.current_hp, 6);
  assert.equal(settleVisible.data.player_state_receipt.hp.before, 5);
  assert.equal(settleVisible.data.player_state_receipt.hp.after, 6);
  assert.equal(settleVisible.data.event.rule_ref, "core.combat.first_aid");
  assert.equal(settleVisible.data.event.caregiver_id, "doctor-one");
  assert.deepEqual(
    settleVisible.data.rule_refs,
    ["rule:coc7:healing:first-aid"],
  );
  assert.equal(
    settleVisible.data.next_decisions[0].capability_ref,
    "capability:coc7:medicine",
  );
  assert.equal(settleVisible.data.settlement.result.events[1].dice.total, 8);
  // `33290a09` deliberately stopped hiding this field. A settled roll that
  // stays host-only cannot be echoed back as `source_roll_id`, which
  // deadlocked a live table on a fumbled STR check. The roll now presents its
  // SEMANTIC handle; the opaque minted id is still absent (asserted below),
  // and an unmappable roll id still fails closed (section 4c).
  assert.equal(
    settleVisible.data.settlement.result.events[1].roll_id,
    "roll:healing",
  );
  assert.equal(settleVisible.data.settlement.result.events[1].actor_id, "thomas-hayes");
  assert.equal(
    settleVisible.data.settlement.result.events[1].source_command_id,
    undefined,
  );
  assert.equal(
    settleVisible.data.settlement.result.results[0].command_id,
    undefined,
  );
  assert.equal(
    settleVisible.data.settlement.result.results[0].state_refs,
    undefined,
  );
  assert.equal(settleVisible.data.request_digest, undefined);
  assert.ok(!modelContents.at(-1).text.includes(graphRollId));
  assert.deepEqual(
    settleResult.details,
    canonicalGraphSettle,
    "the exact graph settlement and minted roll evidence stay host-only",
  );
  assert.equal(
    clientCalls.filter((call) => call.operation === "rules.settle").length,
    1,
    "a successful graph settlement reaches canonical transport exactly once",
  );
  assertModelSafeContent("rules.settle content", settleVisible);
}

// 4b) Exceptional effect bound to the observed roll handle: the source roll
// handle restores to the canonical roll id, and the canonical effect id is
// registered under a semantic kind handle for later reference.
routeOperation("state.exceptional_effect", {
  ok: true,
  tool: "state.exceptional_effect",
  data: {
    schema_version: 1,
    effect_id: "effect-9f2d4c8ab17e4460",
    kind: "condition",
    source_roll_id: "toolbox-king-shreds-recovery-live-01-000003",
  },
});
const effectCall = clientCalls.length;
const effectApplied = await executeTool("coc_invoke", {
  operation: "state.exceptional_effect",
  root: testRoot,
  campaign,
  arguments: {
    decision_id: "exceptional-effect-t1",
    source_roll_id: "roll:inspect-exterior-stone-street-t1",
    action: "apply",
    effect_kind: "condition",
    resolution_reason: "侦查失败的既定后果落地。",
  },
});
const effectVisible = JSON.parse(modelContents.at(-1).text);
assert.equal(effectVisible.ok, true);
assert.equal(
  clientCalls.at(effectCall).arguments.source_roll_id,
  "toolbox-king-shreds-recovery-live-01-000003",
  "the roll handle restores the exact canonical roll id on effect refs",
);
assertModelSafeContent("state.exceptional_effect content", effectVisible);
assert.equal(
  effectVisible.data.effect_id,
  "effect:condition",
  "the canonical effect id projects to its semantic kind handle",
);

// 4c) NON-settle operations fail closed too: a present-but-unmappable
// identity field (a roll id from a stale scope) yields a bounded
// semantic-identity failure with the exact canonical envelope preserved
// host-side — never a silent field deletion.
{
  const staleEffectEnvelope = {
    ok: true,
    tool: "state.exceptional_effect",
    data: {
      schema_version: 1,
      effect_id: "effect-stale-consequence",
      kind: "condition",
      source_roll_id: "toolbox-stale-previous-turn-000042",
    },
  };
  routeOperation("state.exceptional_effect", staleEffectEnvelope);
  const staleEffectResult = await executeTool("coc_invoke", {
    operation: "state.exceptional_effect",
    root: testRoot,
    campaign,
    arguments: {
      decision_id: "exceptional-stale-probe",
      source_roll_id: "roll:inspect-exterior-stone-street-t1",
      action: "apply",
      effect_kind: "condition",
      resolution_reason: "过期掷骰引用探针。",
    },
  });
  const staleVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(staleVisible.ok, false);
  assert.equal(staleVisible.error.code, "semantic_identity_unavailable");
  assert.ok(
    !modelContents.at(-1).text.includes("toolbox-stale-previous-turn-000042"),
    "the stale canonical id is never echoed",
  );
  assert.deepEqual(
    staleEffectResult.details.canonical,
    staleEffectEnvelope,
    "the exact canonical envelope stays in host-only details",
  );
  assert.ok(
    staleEffectResult.details.semantic_identity_diagnostics.some(
      (entry) => entry.field === "source_roll_id" && entry.domain === "roll",
    ),
  );
}

// 4c-2) The unknown-handle refusal must be ACTIONABLE.
//
// A live Keeper lane (debug-gate9-depth-10-r65 / c-defend) burned its entire
// 1800s budget and delivered no turn to the player because this refusal said
// "no roll handle by that name was ever presented this turn; copy one verbatim
// from the current turn context." and carried NO `details` at all. It named a
// place the Keeper cannot enumerate, so the Keeper guessed: eight shapes of
// `source_roll_id` over 29 attempts, 25 refused here and 21 then swallowed by
// `nonretryable_repeat_blocked`. Two roll handles were live the whole time.
//
// The refusal now names the domain the value was classified into and the live
// handles of that domain AS STRUCTURED DATA -- not only in the message,
// because the model-facing failure projection rewrites canonical ids out of
// error prose and a handle referenced only in prose does not survive the wire.
{
  const beforeUnknownHandleCalls = clientCalls.length;
  await executeTool("coc_invoke", {
    operation: "state.exceptional_effect",
    root: testRoot,
    campaign,
    arguments: {
      decision_id: "exceptional-unknown-roll-probe",
      source_roll_id: "roll:combat-corbitt-house-ground-cr2",
      action: "apply",
      effect_kind: "condition",
      resolution_reason: "从未出现过的掷骰句柄探针。",
    },
  });
  const refusalText = modelContents.at(-1).text;
  const refusal = JSON.parse(refusalText);
  assert.equal(refusal.ok, false);
  assert.equal(refusal.error.code, "unknown_semantic_handle");
  assert.equal(
    clientCalls.length,
    beforeUnknownHandleCalls,
    "an unresolvable handle still never reaches canonical transport",
  );
  const refusalDetails = refusal.error.details;
  assert.ok(
    refusalDetails && typeof refusalDetails === "object",
    `the refusal must carry structured details: ${refusalText}`,
  );
  assert.equal(refusalDetails.identity_field, "source_roll_id");
  assert.equal(
    refusalDetails.identity_domain,
    "roll",
    "the refusal says which domain the value was classified into",
  );
  assert.equal(refusalDetails.supplied_value_kind, "never_presented");
  assert.ok(
    Array.isArray(refusalDetails.live_handles)
      && refusalDetails.live_handles.length > 0,
    `the live roll handles must reach the Keeper as data: ${refusalText}`,
  );
  assert.ok(
    refusalDetails.live_handles.includes("roll:inspect-exterior-stone-street-t1"),
    `the handle the Keeper could actually have used is named: ${refusalText}`,
  );
  assert.ok(
    refusalDetails.live_handles.every((handle) => handle.startsWith("roll:")),
    "only roll-domain handles are offered for a roll-domain field",
  );
  assert.equal(
    refusalDetails.live_handle_count,
    refusalDetails.live_handles.length,
  );
  assert.ok(
    !refusalText.includes("combat-corbitt-house-ground-cr2"),
    "the refused value is never echoed back",
  );
  assertModelSafeContent("unknown roll handle refusal", refusal);
}

// 4c-3) Pasting a live entity's EXACT CANONICAL id where its handle belongs is
// a different mistake from naming something that never existed, and only this
// one has a one-step remedy. The refusal separates them and hands back the
// handle -- never the canonical id, which stays host-bound.
{
  await executeTool("coc_invoke", {
    operation: "state.exceptional_effect",
    root: testRoot,
    campaign,
    arguments: {
      decision_id: "exceptional-canonical-paste-probe",
      source_roll_id: "roll:healing:graph-first-aid-v1-first-aid:roll:primary",
      action: "apply",
      effect_kind: "condition",
      resolution_reason: "把权威掷骰 id 当句柄粘贴的探针。",
    },
  });
  const pastedText = modelContents.at(-1).text;
  const pasted = JSON.parse(pastedText);
  assert.equal(pasted.ok, false);
  assert.equal(
    pasted.error.code,
    "unknown_semantic_handle",
    `canonical-id paste must reach the handle refusal: ${pastedText}`,
  );
  assert.equal(
    pasted.error.details.supplied_value_kind,
    "canonical_id_of_live_handle",
    `the stale-vs-never-existed distinction must survive: ${pastedText}`,
  );
  assert.equal(
    pasted.error.details.handle_for_supplied_value,
    "roll:healing",
    "the refusal hands back the live handle for that canonical id",
  );
  assert.ok(
    !pastedText.includes("graph-first-aid-v1-first-aid"),
    "the pasted canonical id is never echoed back",
  );
  assertModelSafeContent("canonical-id paste refusal", pasted);
}

// 4c-4) "No handle was ever presented" can be true of the WIRE and false of
// the table. A combat settlement is 70-80KB against a 16KB inline budget, so
// `coc_mcp_wire._minimal_identity` replaces its whole `data` with
// `{projection_sha256, replay_operation}` -- and it preserves only a
// TOP-LEVEL `roll_id`, while a combat settlement's roll ids are nested under
// `settlement.result`. Every one is dropped before this gateway can register
// it. In the lane this regression comes from, the roll the Keeper was asking
// for was a real Dodge FUMBLE (99) that the subsystem had rolled and written
// to `logs/rolls.jsonl`; it simply had no handle, and the refusal reported
// only that nothing had ever been presented. The refusal now names the cause.
{
  routeOperation("rules.settle", {
    ok: true,
    tool: "rules.settle",
    wire: {
      schema_version: 1,
      profile: "keeper_hot_v1",
      max_inline_bytes: 16384,
      full_result_bytes: 73187,
      payload_projected: true,
      identity_only: true,
    },
    data: {
      projection_sha256: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      replay_operation: {
        operation: "rules.settle",
        invoke_via: "coc_rules",
        model_invocable: true,
        prefilled_arguments: {},
        missing_arguments: [],
        authority: "advisory",
        hard_gate: false,
        discovery_required: false,
      },
    },
    warnings: [
      "The canonical result exceeded the bounded coding-host projection; "
        + "use the returned exact typed operation instead of reading files.",
    ],
  });
  await executeTool("coc_rules_settle", {
    root: testRoot,
    campaign,
    investigator: CURRENT_INVESTIGATOR_HANDLE,
    decision_ref: "decision:coc7:combat:defend",
    decision_id: "combat-defend-oversize-probe-v1",
  });
  await executeTool("coc_invoke", {
    operation: "state.exceptional_effect",
    root: testRoot,
    campaign,
    arguments: {
      decision_id: "exceptional-after-oversize-probe",
      source_roll_id: "roll:combat-corbitt-house-ground-cr2",
      action: "apply",
      effect_kind: "condition",
      resolution_reason: "超出内联预算后掷骰身份丢失的探针。",
    },
  });
  const gapText = modelContents.at(-1).text;
  const gap = JSON.parse(gapText);
  assert.equal(gap.ok, false);
  assert.equal(gap.error.code, "unknown_semantic_handle");
  assert.ok(
    gap.error.details.dropped_evidence,
    `the refusal must name the evidence gap it cannot see past: ${gapText}`,
  );
  assert.equal(
    gap.error.details.dropped_evidence.cause,
    "identity_only_projection",
  );
  assert.ok(
    gap.error.details.dropped_evidence.operations.includes("rules.settle"),
    "the collapsed operation is named",
  );
  assert.ok(
    gap.error.details.dropped_evidence.collapsed_results >= 1,
    "the number of collapsed canonical results is reported",
  );
  assertModelSafeContent("evidence-gap refusal", gap);
}

// 4d) Scene routes: authoritative `exits` populate the route snapshot; the
// registry projects authored route ids to semantic handles; a later scene
// observation without them RETIRES the routes.
{
  const routedScene = structuredClone(FAMILIES.scene_context);
  routedScene.data.exits = [
    {
      to: "archive-annex",
      kind: "travel",
      open: true,
      route_id: "route-stone-alley-1",
      travel_minutes: 5,
    },
  ];
  routedScene.data.action_routes = [
    {
      route_id: "action-stone-parlor",
      resolution_kind: "social_engagement",
    },
  ];
  routeOperation("scene.context", routedScene);
  await executeTool("coc_scene_context", {
    root: testRoot,
    campaign,
    investigator: CURRENT_INVESTIGATOR_HANDLE,
  });
  const routedVisible = JSON.parse(modelContents.at(-1).text);
  const projectedExitRouteId = routedVisible.data.exits[0].route_id;
  const projectedActionRouteId = routedVisible.data.action_routes[0].route_id;
  assert.match(projectedExitRouteId, /^route:/);
  assert.match(projectedActionRouteId, /^route:/);
  assert.ok(
    !JSON.stringify(routedVisible).includes("route-stone-alley-1"),
    "authored canonical route ids never reach model content unprojected",
  );
  // The registry resolves the presented route handles (host-side proof via
  // the next observation's retirement): a NEW scene without those exits
  // replaces the snapshot and retires both routes.
  const emptiedScene = structuredClone(FAMILIES.scene_context);
  emptiedScene.data.exits = [];
  emptiedScene.data.action_routes = [];
  routeOperation("scene.context", emptiedScene);
  await executeTool("coc_scene_context", {
    root: testRoot,
    campaign,
    investigator: CURRENT_INVESTIGATOR_HANDLE,
  });
  // The retired route handle no longer resolves: a model reference fails
  // closed with zero transport (route removal is authoritative).
  const transportsBeforeRetiredRoute = clientCalls.filter(
    (call) => call.operation === "state.record_route_completion",
  ).length;
  const retiredRoute = await executeTool("coc_invoke", {
    operation: "state.record_route_completion",
    root: testRoot,
    campaign,
    arguments: {
      decision_id: "move-route-retired-probe",
      scene_id: "scene:archive-annex",
      route_id: projectedExitRouteId,
      evidence_ref: "fiction-confirm-alley",
      semantic_reason: "已不在当前场景的路由快照中。",
    },
  });
  assert.equal(retiredRoute.isError, true);
  assert.equal(
    JSON.parse(modelContents.at(-1).text).error.code,
    "unknown_semantic_handle",
    "a retired route handle must fail resolution",
  );
  assert.equal(
    clientCalls.filter(
      (call) => call.operation === "state.record_route_completion",
    ).length,
    transportsBeforeRetiredRoute,
    "retired route references never reach transport",
  );
  // Restoring the routed scene re-arms the same handles (stable semantic
  // identities for recurring authoritative routes).
  routeOperation("scene.context", routedScene);
  await executeTool("coc_scene_context", {
    root: testRoot,
    campaign,
    investigator: CURRENT_INVESTIGATOR_HANDLE,
  });
  const reArmedVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(reArmedVisible.data.exits[0].route_id, projectedExitRouteId,
    "re-observed routes reuse the stable semantic handles");
  assert.equal(
    reArmedVisible.data.action_routes[0].route_id,
    projectedActionRouteId,
  );
  // Restore the plain fixture for the settle steps that follow.
  routeOperation("scene.context", FAMILIES.scene_context);
}

// 4e) Real canonical inventory shapes: weapons with ids AND name-only
// weapons, nested label facts, and authoritative lost-id arrays — registered,
// projected, and retired through the owner-scoped registry.
{
  // Prior authoritative listing registers the later-lost entities so the
  // loss record can project their last-known semantic handles.
  const priorInventory = {
    ok: true,
    tool: "state.inventory_list",
    data: {
      schema_version: 1,
      investigator_id: "inv-x6a217e22-e0532209",
      items: [
        { item_id: "item-lantern-1", label: "手提灯" },
        { item_id: "item-lost-notebook", label: "丢失的笔记本" },
      ],
      weapons: [
        { weapon_id: "weapon-colt-1911", name: "柯尔特M1911", label: "柯尔特M1911" },
        { weapon_id: "weapon-lost-derringer", name: "德林杰", label: "德林杰" },
        { name: "猎刀" },
      ],
      lost_weapon_ids: [],
      lost_equipment_ids: [],
    },
  };
  routeOperation("state.inventory_list", priorInventory);
  const priorListed = await executeTool("coc_invoke", {
    operation: "state.inventory_list",
    root: testRoot,
    campaign,
    arguments: {},
  });
  assert.equal(
    JSON.parse(modelContents.at(-1).text).ok,
    true,
    JSON.stringify(priorListed.details?.semantic_identity_diagnostics ?? "prior-listing"),
  );
  const inventoryShape = {
    ok: true,
    tool: "state.inventory_list",
    data: {
      schema_version: 1,
      investigator_id: "inv-x6a217e22-e0532209",
      items: [{ item_id: "item-lantern-1", label: "手提灯" }],
      weapons: [
        {
          weapon_id: "weapon-colt-1911",
          name: "柯尔特M1911",
          label: "柯尔特M1911",
        },
        // Name-only weapon: the exact canonical value is the name itself.
        { name: "猎刀" },
      ],
      lost_weapon_ids: ["weapon-lost-derringer"],
      lost_equipment_ids: ["item-lost-notebook"],
    },
  };
  routeOperation("state.inventory_list", inventoryShape);
  const listed = await executeTool("coc_invoke", {
    operation: "state.inventory_list",
    root: testRoot,
    campaign,
    arguments: {},
  });
  const listedVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(listedVisible.ok, true, JSON.stringify(listedVisible).slice(0, 300));
  // Handles are case-normalized semantic slugs; restoration returns the
  // exact canonical name.
  assert.equal(listedVisible.data.weapons[0].weapon_id, "weapon:柯尔特m1911");
  // Name-only weapons carry the exact name as their semantic identity in
  // content; the registry keeps the meaning-bearing handle for references.
  assert.equal(listedVisible.data.weapons[1].name, "猎刀");
  assert.equal(
    Object.hasOwn(listedVisible.data.weapons[1], "weapon_id"),
    false,
    "no opaque id is invented for name-only weapons",
  );
  assert.equal(listedVisible.data.items[0].item_id, "item:手提灯");
  // Lost-id arrays project semantically (retired handles drop as absence).
  assert.ok(Array.isArray(listedVisible.data.lost_weapon_ids));
  assert.equal(
    JSON.stringify(listedVisible.data).includes("weapon-lost-derringer"),
    false,
    "lost canonical weapon ids never reach model content",
  );
  assert.equal(
    JSON.stringify(listedVisible.data).includes("item-lost-notebook"),
    false,
    "lost canonical item ids never reach model content",
  );
  // The registry retired the lost entities: a model reference to the lost
  // weapon handle fails resolution with zero transport.
  // `combat.resolve` carried this handle-resolution check before the cutover;
  // it is host-private now, so the probe rides `state.item_grant`, which is
  // still Keeper-facing and takes the same `weapon_id` handle. The invariant
  // under test is the registry's, not combat's.
  const lostProbe = await executeTool("coc_state_item_grant", {
    root: testRoot,
    campaign,
    weapon_id: "weapon:weapon-lost-derringer",
    decision_id: "item-lost-derringer-probe-v1",
  });
  assert.equal(lostProbe.isError, true);
  assert.equal(
    JSON.parse(modelContents.at(-1).text).error.code,
    "unknown_semantic_handle",
    "lost weapon handles are retired and fail resolution",
  );
  // Restoration: the model echoes a CURRENT weapon handle and the host
  // restores the exact canonical value the operation expects.
  routeOperation("state.item_grant", {
    ok: true,
    tool: "state.item_grant",
    data: { schema_version: 1, granted: true },
  });
  const combatCall = clientCalls.length;
  await executeTool("coc_state_item_grant", {
    root: testRoot,
    campaign,
    weapon_id: "weapon:柯尔特m1911",
    decision_id: "item-colt-restore-v1",
  });
  assert.equal(
    clientCalls.at(combatCall).arguments.weapon_id,
    "weapon-colt-1911",
    "weapon handles restore the exact canonical value",
  );
  // A name-only weapon reference restores the exact canonical NAME.
  routeOperation("state.inventory_list", priorInventory);
  await executeTool("coc_invoke", {
    operation: "state.inventory_list",
    root: testRoot,
    campaign,
    arguments: {},
  });
  const nameOnlyCall = clientCalls.length;
  routeOperation("state.item_grant", {
    ok: true,
    tool: "state.item_grant",
    data: { schema_version: 1, granted: true },
  });
  const nameOnlyResult = await executeTool("coc_state_item_grant", {
    root: testRoot,
    campaign,
    weapon_id: "weapon:猎刀",
    decision_id: "item-hunting-knife-restore-v1",
  });
  assert.equal(
    clientCalls.at(nameOnlyCall).arguments.weapon_id,
    "猎刀",
    "name-only weapons restore the exact canonical name",
  );
}

// 4e2) Real canonical mutation envelopes across ALL inventory operations
// and BOTH owner kinds, through the generic coc_invoke gateway: purchase
// (gear + weapon), grant (investigator + NPC, weapon spec + name-only),
// remove, use decrement/consume, listing snapshots with lost arrays — and
// the two-owner same-canonical-id law: one owner's loss never retires or
// projects through another owner's mapping.
{
  const invA = "inv-owner-a-1111";
  const npcB = "npc-owner-b-2222";
  const grantDecision = "deliver-grant-brass-key-t1";
  const removeDecision = "deliver-remove-brass-key-t2";
  const purchaseDecision = "fin-purchase-brass-key-t3";
  // Register an investigator-listing snapshot first so later mutations
  // exercise registration against an existing snapshot.
  routeOperation("state.inventory_list", {
    ok: true,
    tool: "state.inventory_list",
    data: {
      schema_version: 1,
      investigator_id: invA,
      items: [{ item_id: "item-lantern-a", label: "铜提灯" }],
      weapons: [],
      lost_weapon_ids: [],
      lost_equipment_ids: [],
    },
  });
  const listedA = JSON.parse((await executeTool("coc_invoke", {
    operation: "state.inventory_list",
    root: testRoot,
    campaign,
    arguments: {},
  })).content[0].text);
  assert.equal(listedA.ok, true, JSON.stringify(listedA).slice(0, 300));
  assert.equal(listedA.data.investigator_id, "current-investigator");
  assert.equal(listedA.data.items[0].item_id, "item:铜提灯");

  // PURCHASE (gear): scalar registration under the purchasing owner; the
  // canonical result carries no snapshot arrays.
  routeOperation("state.purchase", {
    ok: true,
    tool: "state.purchase",
    data: {
      changed: true,
      investigator_id: invA,
      decision_id: purchaseDecision,
      payment_mode: "cash",
      item_id: "item-brass-key-a",
      label: "黄铜钥匙",
      kind: "gear",
      amount: 3,
      currency: "USD",
      charged_amount: "$3.00",
      cash_balance_after: "$17.00",
      settled: true,
      aggregated_from: [],
    },
  });
  const purchased = JSON.parse((await executeTool("coc_invoke", {
    operation: "state.purchase",
    root: testRoot,
    campaign,
    arguments: {
      payment_mode: "cash",
      amount: 3,
      currency: "USD",
      kind: "gear",
      label: "黄铜钥匙",
      source: "street_vendor",
      reason: "街角杂货摊购买",
      localized_reason: "在街角杂货摊买下黄铜钥匙",
      decision_id: purchaseDecision,
    },
  })).content[0].text);
  assert.equal(purchased.ok, true, JSON.stringify(purchased).slice(0, 300));
  assert.equal(purchased.data.item_id, "item:黄铜钥匙");

  // NPC GRANT (weapon with a spec id): scalar item_id registers the ITEM
  // domain, the embedded weapon spec registers the WEAPON domain — both
  // under the NPC owner.
  routeOperation("state.item_grant", {
    ok: true,
    tool: "state.item_grant",
    data: {
      npc_id: npcB,
      kind: "weapon",
      item_id: "weapon-b-hatchet-id",
      label: "短柄斧",
      changed: true,
      weapon: { weapon_id: "weapon-b-hatchet-id", name: "短柄斧" },
    },
  });
  const npcGranted = JSON.parse((await executeTool("coc_invoke", {
    operation: "state.item_grant",
    root: testRoot,
    campaign,
    arguments: {
      npc_id: npcB,
      kind: "weapon",
      label: "短柄斧",
      weapon_id: "weapon-b-hatchet-id",
      decision_id: grantDecision,
    },
  })).content[0].text);
  assert.equal(npcGranted.ok, true, JSON.stringify(npcGranted).slice(0, 300));
  assert.equal(npcGranted.data.item_id, "item:短柄斧");
  assert.equal(npcGranted.data.weapon.weapon_id, "weapon:短柄斧");

  // INVESTIGATOR GRANT (name-only weapon): the exact name is the canonical
  // value; no opaque id is invented. 4e's other owner already holds a 猎刀,
  // so A's same-name entity takes a stable ordinal in every projected
  // domain (handles stay globally unique per campaign, owner-blind).
  routeOperation("state.item_grant", {
    ok: true,
    tool: "state.item_grant",
    data: {
      investigator_id: invA,
      kind: "weapon",
      item_id: "猎刀",
      label: "猎刀",
      changed: true,
      present_after: true,
      items: [{ item_id: "猎刀", label: "猎刀" }],
      weapon: { name: "猎刀" },
    },
  });
  const invGranted = JSON.parse((await executeTool("coc_invoke", {
    operation: "state.item_grant",
    root: testRoot,
    campaign,
    arguments: {
      kind: "weapon",
      label: "猎刀",
      weapon: { name: "猎刀" },
      decision_id: grantDecision,
    },
  })).content[0].text);
  assert.equal(invGranted.ok, true, JSON.stringify(invGranted).slice(0, 300));
  assert.match(invGranted.data.items[0].item_id, /^item:猎刀(?:-\d+)?$/);

  // NPC REMOVE: the canonical scalar item_id retires BOTH projected domains
  // under the NPC owner only.
  routeOperation("state.item_remove", {
    ok: true,
    tool: "state.item_remove",
    data: {
      npc_id: npcB,
      item_id: "weapon-b-hatchet-id",
      outcome: "removed",
      changed: true,
    },
  });
  const npcRemoved = JSON.parse((await executeTool("coc_invoke", {
    operation: "state.item_remove",
    root: testRoot,
    campaign,
    arguments: {
      npc_id: npcB,
      item_id: "item:短柄斧",
      decision_id: removeDecision,
    },
  })).content[0].text);
  assert.equal(npcRemoved.ok, true, JSON.stringify(npcRemoved).slice(0, 300));

  // Two-owner same canonical id: the 4e owner AND A both hold 猎刀. A
  // listing for one owner projects only that owner's mapping, never the
  // other's; B's independent listing stays clean.
  routeOperation("state.inventory_list", {
    ok: true,
    tool: "state.inventory_list",
    data: {
      schema_version: 1,
      npc_id: npcB,
      weapons: [],
      gear: [],
      override_recorded: false,
      authored_weapons: [],
    },
  });
  const listedB = JSON.parse((await executeTool("coc_invoke", {
    operation: "state.inventory_list",
    root: testRoot,
    campaign,
    arguments: { npc_id: npcB },
  })).content[0].text);
  assert.equal(listedB.ok, true, JSON.stringify(listedB).slice(0, 300));
  assert.equal(listedB.data.npc_id, npcB);
  assert.equal(listedB.data.weapons.length, 0,
    "B's authoritative empty listing retires B's own mappings only");

  // INVESTIGATOR listing AFTER the NPC loss: the investigator's 猎刀 and the
  // purchased key still project under the investigator owner; the NPC's
  // retirement never leaked across owners.
  routeOperation("state.inventory_list", {
    ok: true,
    tool: "state.inventory_list",
    data: {
      schema_version: 1,
      investigator_id: invA,
      items: [
        { item_id: "item-lantern-a", label: "铜提灯" },
        { item_id: "item-brass-key-a", label: "黄铜钥匙" },
      ],
      weapons: [{ name: "猎刀" }],
      lost_weapon_ids: [],
      lost_equipment_ids: [],
    },
  });
  const relistedA = JSON.parse((await executeTool("coc_invoke", {
    operation: "state.inventory_list",
    root: testRoot,
    campaign,
    arguments: {},
  })).content[0].text);
  assert.equal(relistedA.ok, true, JSON.stringify(relistedA).slice(0, 300));
  assert.equal(relistedA.data.weapons[0].name, "猎刀");
  assert.equal(relistedA.data.items[1].item_id, "item:黄铜钥匙");

  // USE (consume): the post-use items snapshot invalidates the consumed
  // entity for the exact owner; the OTHER owner's same-id item stays live.
  routeOperation("state.item_use", {
    ok: true,
    tool: "state.item_use",
    data: {
      investigator_id: invA,
      item_id: "item-lantern-a",
      label: "铜提灯",
      count: 9,
      outcome: "consumed",
      changed: true,
      remaining: 0,
      present_after: false,
      items: [{ item_id: "item-brass-key-a", label: "黄铜钥匙" }],
    },
  });
  const consumed = JSON.parse((await executeTool("coc_invoke", {
    operation: "state.item_use",
    root: testRoot,
    campaign,
    arguments: { item_id: "item:铜提灯", count: 9 },
  })).content[0].text);
  assert.equal(consumed.ok, true, JSON.stringify(consumed).slice(0, 300));
  assert.equal(consumed.data.remaining, 0);
  // A model reference to the consumed handle fails resolution: it is dead
  // for its owner. state.item_remove carries the model-owned item_id field.
  const consumedProbe = await executeTool("coc_invoke", {
    operation: "state.item_remove",
    root: testRoot,
    campaign,
    arguments: {
      item_id: "item:铜提灯",
      decision_id: removeDecision,
    },
  });
  assert.equal(consumedProbe.isError, true);
  assert.equal(
    JSON.parse(modelContents.at(-1).text).error.code,
    "unknown_semantic_handle",
    "a consumed item handle is retired for its owner",
  );

  // PURCHASE (weapon kind): the bought weapon resolves in BOTH projected
  // domains under the purchasing owner.
  routeOperation("state.purchase", {
    ok: true,
    tool: "state.purchase",
    data: {
      changed: true,
      investigator_id: invA,
      decision_id: purchaseDecision,
      payment_mode: "cash",
      item_id: "weapon-purchased-cane-id",
      label: "手杖",
      kind: "weapon",
      amount: 6,
      currency: "USD",
      charged_amount: "$6.00",
      cash_balance_after: "$11.00",
      settled: true,
      aggregated_from: [],
    },
  });
  const purchasedWeapon = JSON.parse((await executeTool("coc_invoke", {
    operation: "state.purchase",
    root: testRoot,
    campaign,
    arguments: {
      payment_mode: "cash",
      amount: 6,
      currency: "USD",
      kind: "weapon",
      label: "手杖",
      source: "pawn_shop",
      reason: "当铺购得手杖",
      localized_reason: "在当铺买下防身手杖",
      decision_id: purchaseDecision,
      item_id: "weapon-purchased-cane-id",
      weapon_id: "weapon-purchased-cane-id",
    },
  })).content[0].text);
  assert.equal(purchasedWeapon.ok, true, JSON.stringify(purchasedWeapon).slice(0, 300));
  assert.equal(purchasedWeapon.data.item_id, "item:手杖");

  // Restoration across the whole flow: current handles restore exact
  // canonical values per owner scope; the consumed and NPC-removed handles
  // stay dead, and A's 猎刀 survives every other owner's loss.
  routeOperation("state.item_grant", {
    ok: true,
    tool: "state.item_grant",
    data: { schema_version: 1, weapon_id: "weapon-purchased-cane-id" },
  });
  const restoreCane = await executeTool("coc_state_item_grant", {
    root: testRoot,
    campaign,
    weapon_id: "weapon:手杖",
    decision_id: "item-cane-restore-v1",
  });
  assert.equal(
    JSON.parse(modelContents.at(-1).text).ok,
    true,
    JSON.stringify(JSON.parse(modelContents.at(-1).text)).slice(0, 300),
  );
  assert.equal(
    clientCalls.at(-1).arguments.weapon_id,
    "weapon-purchased-cane-id",
    "the purchased weapon handle restores the exact canonical id",
  );
}

// 4f) Unknown output identity discovery: an identity field absent from every
// fixed table cannot carry opaque material through content on ANY operation.
{
  const unknownRefScene = structuredClone(FAMILIES.scene_context);
  unknownRefScene.data.probe_unknown_ref = "gate-9f2d4c8ab17e4460";
  routeOperation("scene.context", unknownRefScene);
  const unknownSceneResult = await executeTool("coc_scene_context", {
    root: testRoot,
    campaign,
    investigator: CURRENT_INVESTIGATOR_HANDLE,
  });
  const unknownSceneVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(unknownSceneVisible.ok, false);
  assert.equal(unknownSceneVisible.error.code, "semantic_identity_unavailable");
  assert.ok(
    !modelContents.at(-1).text.includes("9f2d4c8a"),
    "the unknown opaque value is never echoed",
  );
  assert.deepEqual(
    unknownSceneResult.details.canonical.data.probe_unknown_ref,
    "gate-9f2d4c8ab17e4460",
    "the exact canonical envelope stays host-side on non-settle paths too",
  );
  // A SEMANTIC value on the same unknown field FAILS CLOSED too: the
  // operation-declared projection registry judges the PATH, not the value
  // shape. `probe_unknown_ref` is declared on no operation, so even a
  // plausible semantic slug is unknown identity evidence — bounded failure,
  // exact canonical value host-side, nothing echoed.
  const semanticRefScene = structuredClone(FAMILIES.scene_context);
  semanticRefScene.data.probe_unknown_ref = "moon-gate-key";
  routeOperation("scene.context", semanticRefScene);
  const semanticSceneResult = await executeTool("coc_scene_context", {
    root: testRoot,
    campaign,
    investigator: CURRENT_INVESTIGATOR_HANDLE,
  });
  const semanticSceneVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(semanticSceneVisible.ok, false,
    "an undeclared identity path fails closed even with a semantic value");
  assert.equal(semanticSceneVisible.error.code, "semantic_identity_unavailable");
  assert.ok(
    !modelContents.at(-1).text.includes("moon-gate-key"),
    "the undeclared path's value is never echoed",
  );
  assert.deepEqual(
    semanticSceneResult.details.canonical.data.probe_unknown_ref,
    "moon-gate-key",
    "the exact canonical value stays host-side",
  );
  const undeclaredDiagnostics = semanticSceneResult.details
    .semantic_identity_diagnostics ?? [];
  assert.ok(
    undeclaredDiagnostics.some((entry) =>
      entry.field === "probe_unknown_ref"
      && entry.path === "probe_unknown_ref"
      && entry.domain === "undeclared"
    ),
    "the diagnostic names the exact undeclared path",
  );
  // Unknown INTEGRITY fields (hash/digest-named, not operation-declared)
  // fail closed the same way on non-settle and settle paths. A DECLARED
  // integrity field on its own operation (source_digest on
  // turn.output_context) stays silently details-only.
  {
    const unknownIntegrityScene = structuredClone(FAMILIES.scene_context);
    unknownIntegrityScene.data.probe_unknown_sha256 = "a".repeat(64);
    routeOperation("scene.context", unknownIntegrityScene);
    const unknownIntegritySceneResult = await executeTool("coc_scene_context", {
      root: testRoot,
      campaign,
      investigator: CURRENT_INVESTIGATOR_HANDLE,
    });
    const unknownIntegritySceneVisible = JSON.parse(modelContents.at(-1).text);
    assert.equal(unknownIntegritySceneVisible.ok, false);
    assert.equal(
      unknownIntegritySceneVisible.error.code,
      "semantic_identity_unavailable",
      "unknown integrity evidence fails closed on non-settle paths",
    );
    assert.deepEqual(
      unknownIntegritySceneResult.details.canonical.data.probe_unknown_sha256,
      "a".repeat(64),
      "the exact canonical integrity value stays host-side",
    );
    const unknownIntegrityContext = structuredClone(FAMILIES.turn_output_context);
    unknownIntegrityContext.data.probe_unknown_sha256 = "b".repeat(64);
    routeOperation("turn.output_context", unknownIntegrityContext);
    const unknownIntegrityContextResult = await executeTool(
      "coc_turn_output_context",
      { root: testRoot, campaign },
    );
    const unknownIntegrityContextVisible = JSON.parse(modelContents.at(-1).text);
    assert.equal(unknownIntegrityContextVisible.ok, false);
    assert.equal(unknownIntegrityContextVisible.error.code, "semantic_identity_unavailable");
    assert.deepEqual(
      unknownIntegrityContextResult.details.canonical.data.probe_unknown_sha256,
      "b".repeat(64),
    );
    // Restore the authoritative fixtures for the settle steps that follow.
    routeOperation("scene.context", FAMILIES.scene_context);
    routeOperation("turn.output_context", FAMILIES.turn_output_context);
  }

  // Settle path: the same discovery applies to turn.output_context.
  const unknownContext = structuredClone(FAMILIES.turn_output_context);
  unknownContext.data.probe_unknown_ref = "receipt-7c9e6679742540de";
  routeOperation("turn.output_context", unknownContext);
  const unknownContextResult = await executeTool("coc_turn_output_context", {
    root: testRoot,
    campaign,
  });
  const unknownContextVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(unknownContextVisible.ok, false);
  assert.equal(unknownContextVisible.error.code, "semantic_identity_unavailable");
  assert.deepEqual(
    unknownContextResult.details.canonical.data.probe_unknown_ref,
    "receipt-7c9e6679742540de",
  );
  // Restore the authoritative fixtures for the settle steps that follow.
  routeOperation("scene.context", FAMILIES.scene_context);
  routeOperation("turn.output_context", FAMILIES.turn_output_context);
}

// 5) Journal the settled turn.
routeOperation("state.journal", FAMILIES.state_journal);
const journalResult = await executeTool("coc_invoke", {
  operation: "state.journal",
  root: testRoot,
  campaign,
  // The model-owned journal surface: the host binds player_text and
  // decision identity from the armed journal card; the model supplies the
  // semantic summary only.
  arguments: {
    summary: "程远举灯查看门窗墙根，贴门听动静；无人应门，窗子黑着。",
    intent_class: "investigate",
    player_action: "举灯查看门窗墙根后贴门听动静",
  },
});
assert.ok(!JSON.parse(modelContents.at(-1).text).data.turn_id);
assert.equal(JSON.parse(modelContents.at(-1).text).data.turn_number, 1);
assert.equal(
  JSON.parse(modelContents.at(-1).text)
    .data.continuation_delta.confirmed_decisions[0].decision_id,
  "keep-lamp-low",
  "successful state.journal must not become an identity projection failure",
);
assertModelSafeContent("state.journal content", JSON.parse(modelContents.at(-1).text));
assert.equal(journalResult.details.data.turn_id,
  "turn-v1-8e3599cdcb794cd5b993b59c077d126f",
  "exact canonical journal identity stays host-internal");

// 5b) Production-shaped pending finalization: a fresh host observes the
// exact canonical output_context before projection. First-impression
// obligations, a nested HP state delta, and an NPC context effect all need
// semantic aliases in one pass; receipt/digest identities remain host-only.
// This is the real live-2/live-3 failure class that previously turned an
// authoritative ok:true result into semantic_identity_unavailable and left
// the model guessing finalize arguments.
{
  const firstImpressionReceipt =
    "npc-first-impression-v2:e8cacaee8831cedf422612cac4e5cf6e219270e9";
  const firstImpressionRoll =
    "npc-first-impression-roll-v2:6c859213e858b4faa7a441da1e2bc4777a9c55de";
  const hpEffect =
    "turn-effect-v1:3a2f127eb04b7b718385ed5a19eed6c8a4100021";
  const secondHpEffect =
    "turn-effect-v1:bf8d33d7f5a948c198d8c5f6bb6d91a4";
  const pendingModifierEffect =
    "exceptional-effect-v1:73bf92c9e1f04a7aa8f1c70c09d8a1b2";
  const contextEffect = `context:${firstImpressionReceipt}`;
  const productionContext = structuredClone(FAMILIES.turn_output_context);
  productionContext.data.obligations = [
    {
      obligation_id: `first-impression:${firstImpressionReceipt}`,
      source_kind: "first_impression",
      source_id: firstImpressionReceipt,
      npc_display_name: "史蒂文·诺特",
      visibility: "context_effect",
      skill: null,
      goal: "realize the NPC's first observable response",
      outcome: null,
      required_level: null,
      achieved_level: null,
      passed: null,
      surplus_levels: null,
      exceptional_required: false,
      substantive_effect_required: false,
      substantive_effect_direction: null,
      substantive_effect_ids: [],
      substantive_effect_status: "not_required",
    },
    {
      obligation_id: `roll:${firstImpressionRoll}`,
      source_kind: "check",
      source_id: firstImpressionRoll,
      npc_display_name: "史蒂文·诺特",
      visibility: "public",
      skill: "First Impression",
      goal: "keeper_toolbox",
      outcome: "extreme",
      required_level: "regular",
      achieved_level: "extreme",
      passed: true,
      surplus_levels: 2,
      exceptional_required: false,
      substantive_effect_required: false,
      substantive_effect_direction: null,
      substantive_effect_ids: [],
      substantive_effect_status: "not_required",
    },
  ];
  productionContext.data.required_obligation_ids = [
    `first-impression:${firstImpressionReceipt}`,
    `roll:${firstImpressionRoll}`,
  ];
  productionContext.data.source_roll_ids = [firstImpressionRoll];
  productionContext.data.mechanics_summary = {
    journal_decision_id: "pi-state-journal:player-epoch-2:revision-1",
    public_check: [{
      roll_id: firstImpressionRoll,
      kind: "npc_first_impression",
      skill: "First Impression",
      display_skill: "初印象",
      roll: 2,
      base_target: 50,
      required_level: "regular",
      required_target: 50,
      achieved_level: "extreme",
      passed: true,
      success: true,
      surplus_levels: 2,
      outcome: "extreme",
      visibility: "public",
    }],
    state_delta: [{
      schema_version: 1,
      category: "state_delta",
      effect_id: hpEffect,
      effect_kind: "scalar",
      resource: "HP",
      investigator_id: "inv-x6a217e22-e0532209",
      before: 12,
      delta: -1,
      after: 11,
      source_decision_id: "roll-damage-right-knuckles-desk-v1",
    }, {
      schema_version: 1,
      category: "state_delta",
      effect_id: secondHpEffect,
      effect_kind: "scalar",
      resource: "HP",
      investigator_id: "inv-x6a217e22-e0532209",
      before: 11,
      delta: -1,
      after: 10,
      source_decision_id: "roll-damage-right-knuckles-desk-second-v1",
    }],
    exceptional_effect: [],
    concealed_consequence: [],
  };
  productionContext.data.npc_performance_constraints = [{
    schema_version: 2,
    category: "context_effect",
    effect_id: contextEffect,
    source_receipt_id: firstImpressionReceipt,
    source_roll_id: firstImpressionRoll,
    effect_kind: "npc_first_impression",
    contract_version: "public-roll-v2",
    investigator_id: "inv-x6a217e22-e0532209",
    npc_id: "npc-steven-knott",
    npc_display_name: "史蒂文·诺特",
    reaction_tier: "strongly_favorable",
    achieved_level: "extreme",
    observable_manner: "诺特盯住你破裂流血的右拳，把文件夹推近了一点。",
    causal_explanation: "极难成功使他把这理解成不易退缩的信号。",
    boundary_preserved: "他仍不会泄露尚未发现的秘密。",
    opportunity_or_friction: "他更愿意把佣金条件讲清楚。",
  }];
  productionContext.data.candidate_factors = [];
  productionContext.data.pending_modifier_consumptions = [{
    effect_id: pendingModifierEffect,
    roll_id: firstImpressionRoll,
    effect_kind: "bonus_die",
    required_dice: 1,
    investigator_id: "inv-x6a217e22-e0532209",
    skill: "First Impression",
  }];
  productionContext.data.finalize_operation.coverage_contract.obligation_ids = [
    `first-impression:${firstImpressionReceipt}`,
    `roll:${firstImpressionRoll}`,
  ];
  routeOperation("turn.output_context", productionContext);
  const productionResult = await executeTool(
    "coc_turn_output_context",
    { root: testRoot, campaign },
  );
  const productionVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(
    productionVisible.ok,
    true,
    `production-shaped output_context must stay usable: ${JSON.stringify({
      visible: productionVisible,
      diagnostics: productionResult.details?.semantic_identity_diagnostics,
    })}`,
  );
  assertModelSafeContent("production-shaped output_context", productionVisible);
  assert.equal(productionVisible.data.required_obligation_ids.length, 2);
  assert.ok(
    productionVisible.data.required_obligation_ids.every((id) =>
      typeof id === "string" && id.startsWith("roll:")
    ),
  );
  assert.match(
    productionVisible.data.mechanics_summary.public_check[0].roll_id,
    /^roll:/,
  );
  assert.match(
    productionVisible.data.mechanics_summary.state_delta[0].effect_id,
    /^effect:/,
  );
  const visibleHpEffects = productionVisible.data.mechanics_summary
    .state_delta.map((row) => row.effect_id);
  assert.deepEqual(
    visibleHpEffects,
    ["effect:hp-scalar-state-delta", "effect:hp-scalar-state-delta-2"],
    "short-resource same-kind effects receive meaningful distinct handles",
  );
  for (const alias of visibleHpEffects) {
    assert.equal(
      validateRawModelIdentityPayload({ source_effect_id: alias }).ok,
      true,
      `host-issued effect alias must satisfy the raw grammar: ${alias}`,
    );
  }
  assert.match(
    productionVisible.data.npc_performance_constraints[0].effect_id,
    /^effect:/,
  );
  assert.match(
    productionVisible.data.npc_performance_constraints[0].source_roll_id,
    /^roll:/,
  );
  assert.match(
    productionVisible.data.pending_modifier_consumptions[0].effect_id,
    /^effect:/,
  );
  assert.match(
    productionVisible.data.pending_modifier_consumptions[0].roll_id,
    /^roll:/,
  );
  assert.equal(
    productionVisible.data.npc_performance_constraints[0].source_receipt_id,
    undefined,
    "machine receipt identity stays host-owned",
  );
  assert.equal(
    productionResult.details.data.npc_performance_constraints[0]
      .source_receipt_id,
    firstImpressionReceipt,
    "the exact receipt remains available to host consumers",
  );
  assert.equal(
    productionResult.details.data.mechanics_summary.state_delta[0].effect_id,
    hpEffect,
    "the exact state-effect identity remains available to host consumers",
  );
  assert.deepEqual(
    productionVisible.data.agency_review_operation.missing_model_arguments,
    ["draft_text", "findings", "state_authority_review"],
  );
  assert.deepEqual(
    productionVisible.data.agency_review_operation
      .host_bound_auto_attached_arguments,
    ["decision_id", "revision", "source_digest", "turn_id"],
  );
  assert.deepEqual(
    productionVisible.data.finalize_operation.missing_model_arguments,
    ["draft", "coverage", "agency_claims"],
  );
  assert.deepEqual(
    productionVisible.data.finalize_operation.host_bound_auto_attached_arguments,
    ["decision_id", "narration_review_id", "revision"],
  );
  assert.deepEqual(
    productionVisible.data.finalize_operation.coverage_contract.obligation_ids,
    productionVisible.data.required_obligation_ids,
    "the finalize descriptor reuses the exact semantic obligation aliases",
  );
  routeOperation("turn.output_context", productionContext);
  await executeTool("coc_turn_output_context", { root: testRoot, campaign });
  const replayVisible = JSON.parse(modelContents.at(-1).text);
  assert.deepEqual(
    replayVisible.data.required_obligation_ids,
    productionVisible.data.required_obligation_ids,
    "unchanged pending-turn observation reuses stable semantic aliases",
  );
  assert.deepEqual(
    replayVisible.data.mechanics_summary.state_delta.map((row) => row.effect_id),
    visibleHpEffects,
    "multiple same-kind effect aliases stay stable across replay",
  );
  const visibleHpEffect = productionVisible.data.mechanics_summary
    .state_delta[0].effect_id;
  const productionDraft = "你的右拳指节裂开，鲜血沿着手背滴下。";
  const reviewCallsBeforeRoundTrip = clientCalls.filter(
    (call) => call.operation === "narration.review",
  ).length;
  routeOperation("narration.review", FAMILIES.narration_review);
  const productionReviewResult = await executeTool("coc_narration_review", {
    draft_text: productionDraft,
    findings: [],
    investigator: CURRENT_INVESTIGATOR_HANDLE,
    state_authority_review: {
      disposition: "claims_listed",
      reason: "草稿准确陈述了本回合已经落地的生命值变化。",
      claims: [{
        claim_id: "claim-right-knuckles-hp-loss",
        subject_ref: CURRENT_PC_SUBJECT_HANDLE,
        claim_kind: "scalar",
        exact_excerpt: "右拳指节裂开",
        source_effect_id: visibleHpEffect,
        reason: "绑定冻结的 HP 状态变化。",
      }],
    },
  });
  const productionReviewVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(
    productionReviewVisible.ok,
    true,
    `host-issued effect alias must round-trip through review: ${JSON.stringify(
      productionReviewVisible,
    )}`,
  );
  assert.equal(
    clientCalls.filter((call) => call.operation === "narration.review").length,
    reviewCallsBeforeRoundTrip + 1,
    "grammar-safe review reaches canonical transport exactly once",
  );
  const productionReviewTransport = clientCalls.filter(
    (call) => call.operation === "narration.review",
  ).at(-1);
  assert.equal(
    productionReviewTransport.arguments.state_authority_review.claims[0]
      .source_effect_id,
    hpEffect,
    "the semantic effect alias restores the exact canonical state effect",
  );
  assert.equal(
    productionReviewTransport.arguments.state_authority_review.claims[0]
      .subject_ref,
    "pc:inv-x6a217e22-e0532209",
  );
  assert.equal(
    productionReviewTransport.arguments.state_claim_compilation.result
      .claims[0].matched_review_claim_id,
    "claim-right-knuckles-hp-loss",
    "the host compiler and Keeper review agree on the exact grounded claim",
  );
  assert.equal(
    productionReviewResult.details.data.review_id,
    FAMILIES.narration_review.data.review_id,
    "the exact review receipt remains host-only after semantic round-trip",
  );
  // The existing normal review/finalize vertical below proves these two
  // descriptors restore their host-only turn/digest/review/decision identity.
  routeOperation("turn.output_context", FAMILIES.turn_output_context);
}

// 6) turn.output_context — semantic obligations/draft instructions only.
routeOperation("turn.output_context", FAMILIES.turn_output_context);
await executeTool("coc_turn_output_context", { root: testRoot, campaign });
const outputVisible = JSON.parse(modelContents.at(-1).text);
assertModelSafeContent("turn.output_context content", outputVisible);
assert.equal(outputVisible.data.obligations.length, 2);
assert.equal(
  outputVisible.data.contract_projection.player_input_text,
  FAMILIES.turn_output_context.data.contract_projection.player_input.text,
  "output context must retain the exact player text without its opaque source identity",
);
assert.ok(
  !Object.hasOwn(outputVisible.data.contract_projection, "player_input"),
  "the canonical player-input source ref and digest stay host-only",
);
assert.equal(
  outputVisible.data.contract_projection.agency_authority.pc_subject_refs[0],
  CURRENT_PC_SUBJECT_HANDLE,
);
// The two same-turn rolls present as two DISTINCT stable semantic handles in
// the model-visible obligations, required ids, and finalize descriptor — the
// model never sees (and can never echo) the canonical toolbox roll ids.
assert.deepEqual(
  [...outputVisible.data.required_obligation_ids].sort(),
  ["roll:inspect-exterior-stone-street-t1", "roll:listen"].sort(),
);
assert.deepEqual(
  [...outputVisible.data.finalize_operation.coverage_contract.obligation_ids]
    .sort(),
  ["roll:inspect-exterior-stone-street-t1", "roll:listen"].sort(),
);
assert.deepEqual(
  outputVisible.data.obligations.map((row) => row.obligation_id).sort(),
  ["roll:inspect-exterior-stone-street-t1", "roll:listen"].sort(),
);
assert.ok(
  !JSON.stringify(outputVisible).includes("toolbox-"),
  "no canonical toolbox roll identity may appear in output_context content",
);

// 6b) A settled output_context whose required mechanics cannot be mapped
// fails closed with a bounded semantic-identity error — required mechanics
// are never silently dropped from model content.
{
  const unmappedContext = structuredClone(FAMILIES.turn_output_context);
  unmappedContext.data.obligations = [
    ...unmappedContext.data.obligations,
    {
      obligation_id: "roll:toolbox-king-shreds-recovery-live-01-999999",
      source_id: "toolbox-king-shreds-recovery-live-01-999999",
      // No meaning-bearing facts: output_context registration cannot mint a
      // handle, so required mechanics stay unmapped and fail closed.
      source_kind: "",
      skill: "",
      visibility: "public",
      outcome: "failure",
      passed: false,
      substantive_effect_ids: [],
      substantive_effect_status: "not_required",
    },
  ];
  unmappedContext.data.required_obligation_ids = [
    ...unmappedContext.data.required_obligation_ids,
    "roll:toolbox-king-shreds-recovery-live-01-999999",
  ];
  routeOperation("turn.output_context", unmappedContext);
  const unavailableResult = await executeTool(
    "coc_turn_output_context",
    { root: testRoot, campaign },
  );
  const unavailableVisible = JSON.parse(modelContents.at(-1).text);
  assert.equal(unavailableVisible.ok, false);
  assert.equal(unavailableVisible.error.code, "semantic_identity_unavailable");
  assert.ok(
    unavailableVisible.error.details.semantic_domains.includes("roll"),
  );
  assert.ok(
    !modelContents.at(-1).text.includes("999999"),
    "the unmapped canonical id is never echoed in the bounded error",
  );
  // The exact canonical envelope and bounded diagnostics stay host-only in
  // details for settle paths too.
  const unavailableDetails = JSON.parse(
    JSON.stringify(unavailableResult.details),
  );
  assert.deepEqual(
    unavailableDetails.canonical,
    unmappedContext,
    "the exact canonical envelope is preserved host-side",
  );
  assert.ok(
    unavailableDetails.semantic_identity_diagnostics.some(
      (entry) => entry.domain === "roll",
    ),
  );
  assert.ok(
    !JSON.stringify(unavailableDetails.semantic_identity_diagnostics)
      .includes("999999"),
    "diagnostics never carry the unmapped value",
  );
  // Restore the authoritative envelope for the settle steps that follow.
  routeOperation("turn.output_context", FAMILIES.turn_output_context);
  await executeTool("coc_turn_output_context", { root: testRoot, campaign });
}

// 7) narration.review — host binds exact identity; content is guidance only.
const draftText = "石街的夜很静。考夫特的住处门前无人应门，窗子里也没有灯。\n\n屋子仍黑着。";
const acceptedReview = structuredClone(FAMILIES.narration_review);
acceptedReview.data.draft_sha256 = canonicalDigest(draftText);
routeOperation("narration.review", acceptedReview);
await executeTool("coc_narration_review", {
  draft_text: draftText,
  findings: [],
  investigator: CURRENT_INVESTIGATOR_HANDLE,
  state_authority_review: {
    disposition: "no_player_state_change_claimed",
    claims: [],
    reason: "草稿未声称现金、物品、资源、状态或明确的时间推进数值。",
  },
});
const reviewTransport = clientCalls.filter(
  (call) => call.operation === "narration.review",
).at(-1);
assert.ok(reviewTransport, "narration.review must reach transport");
assert.equal(reviewTransport.arguments.turn_id,
  "turn-v1-8e3599cdcb794cd5b993b59c077d126f",
  "host injects exact turn identity");
assert.equal(reviewTransport.arguments.source_digest,
  "sha256:a0770a91e647696e5aecee0ef0b095eb3b06846cbe16a317ede49069a08a5299",
  "host injects exact source digest");
assert.equal(reviewTransport.arguments.revision, 1);
assert.equal(reviewTransport.arguments.investigator,
  "inv-x6a217e22-e0532209");
assert.equal(typeof reviewTransport.arguments.decision_id, "string");
assert.ok(reviewTransport.arguments.decision_id.startsWith("pi-narration-review:"));
assert.ok(
  reviewTransport.arguments.state_claim_compilation,
  "compiler receipt is machine-attached for the host binding",
);
const reviewVisible = JSON.parse(modelContents.at(-1).text);
assertModelSafeContent("narration.review content", reviewVisible);
assert.equal(reviewVisible.data.recommendation, "no_revision_suggested");
assert.ok(!("review_id" in reviewVisible.data));
assert.equal(
  reviewVisible.data.finalize_agency_binding.mode,
  "semantic_reviewed_spans",
);
assert.equal(
  JSON.stringify(reviewVisible.data.finalize_agency_binding)
    .includes("考夫特的住处门前无人应门"),
  false,
  "review binding exposes semantic ordinals, never frozen exact excerpts",
);
assert.equal(
  JSON.stringify(reviewVisible.data.finalize_agency_binding)
    .includes("exact_excerpt"),
  false,
  "same-session coverage binding never asks the model to transcribe excerpts",
);
assert.deepEqual(
  reviewVisible.data.finalize_agency_binding.coverage_obligations.map(
    (row) => row.obligation,
  ).sort(),
  ["roll:inspect-exterior-stone-street-t1", "roll:listen"].sort(),
);

// 8) turn.finalize — reviewed agency spans and all exact host evidence are
// restored; receipt stays details-only.
routeOperation("turn.finalize", FAMILIES.turn_finalize);
const finalizeDelivered = await executeTool("coc_turn_finalize", {
  coverage: [
    {
      // The semantic roll handle presented in output_context content.
      obligation_ref: "roll:inspect-exterior-stone-street-t1",
      reviewed_span: "reviewed-sentence:paragraph-2:1",
      realization: "fictional_beat",
      action_realization: "程远举灯查看门窗与墙根。",
      response: "夜色里看不清任何确定痕迹。",
      causal_explanation: "侦查未通过，无法确认脚印或撬痕。",
      persona_fit: "他以工匠般的耐心近距离查看。",
      player_input_handling: "specific_preserved",
      exceptional_beat: null,
    },
    {
      obligation_ref: "roll:listen",
      reviewed_span: "reviewed-sentence:paragraph-2:1",
      realization: "fictional_beat",
      action_realization: "他把耳朵贴上门板。",
      response: "门后没有可辨认的声响。",
      causal_explanation: "聆听未通过，听不出屋内动静。",
      persona_fit: "他贴得近且耐心。",
      player_input_handling: "specific_preserved",
      exceptional_beat: null,
    },
  ],
  agency_claims: [{
    reviewed_span: "reviewed-sentence:paragraph-1:2",
    claim_type: "voluntary_action",
    authority: "current-player-input",
  }],
  advisory_uptake: {
    advice_id: CURRENT_ADVICE_HANDLE,
    candidate_ref: CURRENT_CANDIDATE_HANDLE,
    disposition: "not_adopted",
    reason: "本回合无需采纳故事线索建议。",
    adopted_fields: [],
    exact_excerpt: "屋子仍黑着。",
  },
});
const finalizeTransport = clientCalls.find(
  (call) => call.operation === "turn.finalize",
);
assert.ok(finalizeTransport, "turn.finalize must reach transport");
assert.equal(finalizeTransport.arguments.draft, draftText);
assert.equal(
  finalizeTransport.arguments.agency_claims[0].exact_excerpt,
  "考夫特的住处门前无人应门，窗子里也没有灯。",
  "host restores the exact accepted-review sentence",
);
assert.equal(
  finalizeTransport.arguments.agency_claims[0].subject_ref,
  "pc:inv-x6a217e22-e0532209",
  "host restores the exact PC subject ref before transport",
);
assert.equal(
  finalizeTransport.arguments.agency_claims[0].source_ref,
  "player_input:journal-stone-street-exterior-t1",
  "host restores the exact player-input source ref before transport",
);
assert.equal(
  finalizeTransport.arguments.advisory_uptake.advice_id,
  "storylets:0:df3fb04785ed9164779e",
  "host restores the exact advisory identity before transport",
);
assert.equal(
  finalizeTransport.arguments.advisory_uptake.candidate_ref,
  "storylet-candidate-v1:23176fa5590f08753f5a868f042a2890",
);
assert.equal(finalizeTransport.arguments.revision, 1);
assert.equal(
  finalizeTransport.arguments.narration_review_id,
  "narration-review-v1:ba015abf306ad27c57885a4ae45d9085e01da4a9",
  "host injects the exact accepted-review identity",
);
assert.ok(finalizeTransport.arguments.decision_id.startsWith("pi-turn-finalize:"));
// Two distinct semantic roll handles restore to two distinct exact
// canonical roll ids — the two-roll chain stays distinguishable.
assert.deepEqual(
  finalizeTransport.arguments.coverage.map((row) => row.obligation_id),
  [
    "roll:toolbox-king-shreds-recovery-live-01-000003",
    "roll:toolbox-king-shreds-recovery-live-01-000004",
  ],
  "semantic roll handles restore the exact kind-prefixed Python obligation ids",
);
assert.ok(
  finalizeTransport.arguments.coverage.every(
    (row) => row.exact_excerpt === "屋子仍黑着。",
  ),
  "host restores exact reviewed consequence spans for every obligation",
);
assert.equal(
  Object.hasOwn(finalizeTransport.arguments, "mechanics_placements"),
  false,
  "accepted-review placement stays host-owned through canonical safe default",
);

// 8b) Unknown semantic roll handles fail closed with zero transport.
routeOperation("turn.finalize", FAMILIES.turn_finalize);
const unknownHandle = await executeTool("coc_turn_finalize", {
  campaign,
  draft: "石街的夜很静。屋子仍黑着。",
  coverage: [{
    obligation_id: "roll:made-up-handle",
    realization: "fictional_beat",
    action_realization: "程远查看。",
    response: "看不清。",
    causal_explanation: "侦查未通过。",
    persona_fit: "耐心。",
    player_input_handling: "specific_preserved",
    exact_excerpt: "屋子仍黑着。",
    exceptional_beat: null,
  }],
  agency_claims: [],
});
assert.equal(unknownHandle.isError, true);
const unknownHandleVisible = JSON.parse(modelContents.at(-1).text);
assert.equal(unknownHandleVisible.error.code, "unknown_semantic_handle");
assert.ok(
  !modelContents.at(-1).text.includes("made-up-handle"),
  "unknown handles are never echoed",
);
assert.equal(
  clientCalls.filter((call) => call.operation === "turn.finalize").length,
  1,
  "unknown semantic handles never reach transport",
);
const finalizeVisible = JSON.parse(finalizeDelivered.content[0].text);
assertModelSafeContent("turn.finalize content", finalizeVisible);
assert.deepEqual(
  Object.keys(finalizeVisible.data).sort(),
  ["accepted_revision", "rendered_text", "schema_version", "status"],
);
assert.equal(finalizeVisible.data.status, "finalized");
assert.ok(finalizeVisible.data.rendered_text.includes("【明骰】侦查｜掷骰：62"));
// Exact canonical receipt preserved in host-only details.
assert.equal(
  finalizeDelivered.details.data.finalization_id,
  "turn-effect-v1:fcb7661cb6b168f0685eed34ce72a35132525a2f",
);
assert.equal(
  finalizeDelivered.details.wire.full_result_sha256,
  "sha256:46a4b7a12b368cce75ec1e66f7b1d766af05640ec8eb5b95f828e732ae3b7464",
);
assert.equal(
  finalizeDelivered.details.data.rendered_text,
  finalizeVisible.data.rendered_text,
  "model rendered_text is byte-identical to the canonical receipt",
);

// 9) Opaque finalize ids fail closed without echo and without transport.
const opaqueFinalize = await executeTool("coc_turn_finalize", {
  draft: "石街的夜很静。屋子仍黑着。",
  coverage: [{
    obligation_id: "roll:toolbox-king-shreds-recovery-live-01-000003",
    realization: "fictional_beat",
    action_realization: "程远举灯查看。",
    response: "夜色里看不清痕迹。",
    causal_explanation: "侦查未通过。",
    persona_fit: "耐心查看。",
    player_input_handling: "specific_preserved",
    exact_excerpt: "屋子仍黑着。",
    exceptional_beat: null,
  }],
  agency_claims: [{
    claim_id: "agency-opaque",
    claim_type: "voluntary_action",
    exact_excerpt: "屋子仍黑着",
    override_id: null,
    source_ref: "player_input:journal-stone-street-exterior-t1",
    subject_ref: "pc:inv-x6a217e22-e0532209",
  }],
});
assert.equal(opaqueFinalize.isError, true);
assert.equal(JSON.parse(modelContents.at(-1).text).error.code,
  "opaque_identity_grammar");
assert.ok(
  !modelContents.at(-1).text.includes("inv-x6a217e22-e0532209"),
  "opaque subject/source echo must never reach model content",
);
assert.equal(
  clientCalls.filter((call) => call.operation === "turn.finalize").length,
  1,
  "opaque finalize attempt must never reach transport",
);

// 10) Generic coc_invoke rejects a UUID identity under the closed grammar
// before transport, naming only the field.
const uuidJournal = await executeTool("coc_invoke", {
  operation: "state.journal",
  root: testRoot,
  campaign,
  arguments: {
    decision_id: "journal-7c9e6679-7425-40de-944b-e07fc1f90ae7",
    player_text: "我退后一步，举灯再照了一次门框。",
  },
});
assert.equal(uuidJournal.isError, true);
const uuidJournalVisible = JSON.parse(modelContents.at(-1).text);
assert.equal(uuidJournalVisible.error.code, "opaque_identity_grammar");
assert.ok(uuidJournalVisible.error.message.includes("decision_id"));
assert.ok(
  !modelContents.at(-1).text.includes("7c9e6679"),
  "opaque decision id must never be echoed",
);
assert.equal(
  clientCalls.filter((call) => call.operation === "state.journal").length,
  1,
  "grammar-rejected input must never reach transport",
);

// 11) Investigator binding survives the player-message boundary: a new
// external message clears turn bindings but not the session/campaign-scoped
// current-PC identity, so the handle works with NO scene.context refetch.
const sceneContextCallsBefore = clientCalls.filter(
  (call) => call.operation === "scene.context",
).length;
for (const handler of handlers.get("message_start") || []) {
  await handler({
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text: "我绕到屋子侧面，想看看后门。" }],
      timestamp: 900,
    },
  }, ctx);
}
routeOperation("rules.damage", FAMILIES.rules_damage);
await executeTool("coc_rules_damage", {
  root: testRoot,
  campaign,
  investigator: CURRENT_INVESTIGATOR_HANDLE,
  kind: "damage",
  amount: "1",
  source: "贴墙听屋内动静",
  decision_id: "roll-listen-side-wall-t2",
});
assert.equal(
  clientCalls.filter((call) => call.operation === "scene.context").length,
  sceneContextCallsBefore,
  "no redundant scene.context may be required after a player message",
);
assert.equal(
  clientCalls.filter(
    (call) => call.operation === "rules.damage"
      && call.arguments.decision_id === "roll-listen-side-wall-t2",
  ).at(-1).arguments.investigator,
  "inv-x6a217e22-e0532209",
  "retained same-campaign binding restores the exact investigator",
);

// 11b) DIRECT campaign switch without a rebinding resume: the identity slot
// is campaign-tagged, so a call targeting another campaign fails closed with
// zero transport and zero leakage of the first campaign's investigator.
const directSwitchRoll = await executeTool("coc_rules_damage", {
  root: testRoot,
  campaign: secondCampaign,
  investigator: CURRENT_INVESTIGATOR_HANDLE,
  kind: "damage",
  amount: "1",
  source: "未重新绑定的跨战役调用",
  decision_id: "roll-listen-direct-switch",
});
assert.equal(directSwitchRoll.isError, true);
assert.equal(JSON.parse(modelContents.at(-1).text).error.code,
  "semantic_entity_binding_missing");
const directSwitchTransports = clientCalls.filter(
  (call) => call.operation === "rules.damage"
    && call.arguments.decision_id === "roll-listen-direct-switch",
).length;
assert.equal(directSwitchTransports, 0, "direct switch must never transport");
assert.ok(
  !JSON.stringify(clientCalls).includes('"investigator":"inv-x6a217e22-e0532209"')
    || clientCalls.filter((call) => call.arguments?.investigator
      === "inv-x6a217e22-e0532209").every((call) => call.campaign === campaign),
  "the A-campaign investigator may only ever ride A-campaign transports",
);

// 11c) Typed model calls omit the transport campaign by construction. The
// active canonical campaign scopes semantic restoration before transport.
const omittedCampaignRoll = await executeTool("coc_rules_damage", {
  root: testRoot,
  investigator: CURRENT_INVESTIGATOR_HANDLE,
  kind: "damage",
  amount: "1",
  source: "缺少当前战役的聆听",
  decision_id: "roll-listen-omitted-campaign",
});
assert.equal(JSON.parse(modelContents.at(-1).text).ok, true);
const activeCampaignRoll = clientCalls.find(
  (call) => call.operation === "rules.damage"
    && call.arguments.decision_id === "roll-listen-omitted-campaign",
);
assert.equal(activeCampaignRoll.campaign, campaign);
assert.equal(activeCampaignRoll.arguments.investigator, "inv-x6a217e22-e0532209");

// 12) Campaign switch rebinds: the retained identity is campaign-tagged, so
// the handle restores the NEW campaign's investigator and never leaks the old.
const switchResumeCallCount = clientCalls.filter(
  (call) => call.operation === "session.resume",
).length;
await executeTool("coc_invoke", {
  operation: "session.resume",
  root: testRoot,
  campaign: secondCampaign,
  arguments: {},
});
assert.equal(
  clientCalls.filter((call) => call.operation === "session.resume").length,
  switchResumeCallCount + 1,
);
routeOperation("rules.damage", FAMILIES.rules_damage);
await executeTool("coc_rules_damage", {
  root: testRoot,
  campaign: secondCampaign,
  investigator: CURRENT_INVESTIGATOR_HANDLE,
  kind: "damage",
  amount: "1",
  source: "另一场战役中的侦查",
  decision_id: "roll-spot-other-campaign-t1",
});
const switchRoll = clientCalls.filter(
  (call) => call.operation === "rules.damage"
    && call.arguments.decision_id === "roll-spot-other-campaign-t1",
).at(-1);
assert.equal(
  switchRoll.arguments.investigator,
  "inv-other-campaign-9",
  "campaign switch rebinds the identity slot",
);
assert.equal(
  JSON.stringify(switchRoll).includes("inv-x6a217e22-e0532209"),
  false,
  "no cross-campaign investigator leakage",
);

// 13) Cross-session isolation: a fresh extension instance with no party
// observation fails closed on the handle and never sees another session's id.
{
  const sessionTwoTools = new Map();
  const sessionTwoHandlers = new Map();
  const sessionTwoCalls = [];
  const fakePiTwo = {
    registerTool(tool) {
      sessionTwoTools.set(tool.name, tool);
    },
    registerCommand() {},
    registerShortcut() {},
    on(type, handler) {
      const registered = sessionTwoHandlers.get(type) || [];
      registered.push(handler);
      sessionTwoHandlers.set(type, registered);
    },
    appendEntry() {},
    sendMessage() {},
    setActiveTools() {},
    getThinkingLevel: () => "off",
  };
  main.default(fakePiTwo, {
    coordinatorEnabled: () => false,
    startupCampaignId: () => null,
    createStateClaimCompiler: () => new PiStateClaimCompiler(stubCompilerInfer),
    createClient: () => ({
      callTool: async (_name, params) => {
        sessionTwoCalls.push(JSON.parse(JSON.stringify(params)));
        return { ok: true, tool: String(params.operation || ""), data: {
          schema_version: 1,
          campaign_id: "lonely-campaign",
          mode: "awaiting_player",
          next_operations: [],
        } };
      },
      callToolWithTransportMeta: async (name, params) => ({
        value: await (async () => {
          sessionTwoCalls.push(JSON.parse(JSON.stringify(params)));
          return { ok: true, tool: String(params.operation || ""), data: {
            schema_version: 1,
            campaign_id: "lonely-campaign",
            mode: "awaiting_player",
            next_operations: [],
          } };
        })(),
        transport: null,
      }),
      async close() {},
    }),
  });
  const ctxTwo = {
    cwd: testRoot,
    mode: "rpc",
    model: { provider: "probe", id: "probe" },
    sessionManager: {
      getSessionId: () => "normal-model-id-boundary-session-two",
      getEntries: () => [],
    },
    hasUI: false,
  };
  for (const handler of sessionTwoHandlers.get("session_start") || []) {
    await handler({ type: "session_start", reason: "probe" }, ctxTwo);
  }
  await sessionTwoTools.get("coc_invoke").execute(
    "resume-two",
    { operation: "session.resume", campaign: "lonely-campaign", arguments: {} },
    undefined,
    undefined,
    ctxTwo,
  );
  const lonelyRoll = await sessionTwoTools.get("coc_rules_damage").execute(
    "roll-two",
    {
      root: testRoot,
      campaign: "lonely-campaign",
      investigator: CURRENT_INVESTIGATOR_HANDLE,
      kind: "damage",
      amount: "1",
      source: "无队伍会话的侦查",
      decision_id: "roll-lonely-campaign-t1",
    },
    undefined,
    undefined,
    ctxTwo,
  );
  const lonelyVisible = JSON.parse(lonelyRoll.content[0].text);
  assert.equal(lonelyVisible.error.code, "semantic_entity_binding_missing");
  assert.ok(
    !lonelyRoll.content[0].text.includes("inv-x6a217e22-e0532209"),
    "no cross-session investigator leakage",
  );
  assert.equal(
    sessionTwoCalls.filter((call) => call.operation === "rules.damage").length,
    0,
    "unbound handle must never reach transport",
  );
}

// 14) Authoritative single→empty invalidation: a same-campaign resume that
// reports NO current PC invalidates the retained identity — the handle then
// fails closed with zero transport.
resumeQueue.push({
  ok: true,
  tool: "session.resume",
  data: {
    schema_version: 1,
    campaign_id: secondCampaign,
    mode: "awaiting_player",
    scene_context: { party: [] },
    next_operations: [],
  },
});
await executeTool("coc_invoke", {
  operation: "session.resume",
  root: testRoot,
  campaign: secondCampaign,
  arguments: {},
});
const emptyRollTransportsBefore = clientCalls.filter(
  (call) => call.operation === "rules.damage",
).length;
const emptyRoll = await executeTool("coc_rules_damage", {
  root: testRoot,
  campaign: secondCampaign,
  investigator: CURRENT_INVESTIGATOR_HANDLE,
  kind: "damage",
  amount: "1",
  source: "无当前调查员时的聆听",
  decision_id: "roll-listen-empty-party-t3",
});
assert.equal(emptyRoll.isError, true);
assert.equal(JSON.parse(modelContents.at(-1).text).error.code,
  "semantic_entity_binding_missing");
assert.equal(
  clientCalls.filter((call) => call.operation === "rules.damage").length,
  emptyRollTransportsBefore,
  "empty-party invalidation must never transport the handle",
);
const transportsAfterInvalidation = JSON.stringify(
  clientCalls.slice(emptyRollTransportsBefore * 0 + (clientCalls.length - 1)),
);
assert.ok(
  !transportsAfterInvalidation.includes("inv-other-campaign-9"),
  "the invalidated identity must not leak into any transport after invalidation",
);

// 15) Authoritative single→ambiguous invalidation: multiple PCs invalidate.
resumeQueue.push({
  ok: true,
  tool: "session.resume",
  data: {
    schema_version: 1,
    campaign_id: secondCampaign,
    mode: "awaiting_player",
    scene_context: { party: ["inv-alpha", "inv-beta"] },
    next_operations: [],
  },
});
await executeTool("coc_invoke", {
  operation: "session.resume",
  root: testRoot,
  campaign: secondCampaign,
  arguments: {},
});
const ambiguousRollTransportsBefore = clientCalls.filter(
  (call) => call.operation === "rules.damage",
).length;
const ambiguousRoll = await executeTool("coc_rules_damage", {
  root: testRoot,
  campaign: secondCampaign,
  investigator: CURRENT_INVESTIGATOR_HANDLE,
  kind: "damage",
  amount: "1",
  source: "多人队伍时的聆听",
  decision_id: "roll-listen-ambiguous-party-t4",
});
assert.equal(ambiguousRoll.isError, true);
assert.equal(JSON.parse(modelContents.at(-1).text).error.code,
  "semantic_entity_binding_missing");
assert.equal(
  clientCalls.filter((call) => call.operation === "rules.damage").length,
  ambiguousRollTransportsBefore,
  "ambiguous-party invalidation must never transport the handle",
);

// 16) Same-instance session reset: re-firing session_start advances the
// session epoch; the previous identity is dead even inside one extension.
resumeQueue.push(secondCampaignResume);
await executeTool("coc_invoke", {
  operation: "session.resume",
  root: testRoot,
  campaign: secondCampaign,
  arguments: {},
});
routeOperation("rules.damage", FAMILIES.rules_damage);
await executeTool("coc_rules_damage", {
  root: testRoot,
  campaign: secondCampaign,
  investigator: CURRENT_INVESTIGATOR_HANDLE,
  kind: "damage",
  amount: "1",
  source: "重置前的侦查",
  decision_id: "roll-spot-before-reset",
});
const resetRollCallsBefore = clientCalls.filter(
  (call) => call.operation === "rules.damage",
).length;
for (const handler of handlers.get("session_start") || []) {
  await handler({ type: "session_start", reason: "probe-reset" }, ctx);
}
const clientCallsAtReset = clientCalls.length;
// ACL-before-registry: after the reset the phase is cold_start, so the
// role/phase ACL rejects the roll BEFORE any registry restoration code —
// the established ACL rejection, still with zero transport.
let postResetRollRejected = null;
try {
  await executeTool("coc_rules_damage", {
    root: testRoot,
    campaign: secondCampaign,
    investigator: CURRENT_INVESTIGATOR_HANDLE,
    kind: "damage",
    amount: "1",
    source: "重置后的侦查",
    decision_id: "roll-spot-after-reset",
  });
} catch (error) {
  postResetRollRejected = String(error?.message || error);
}
assert.ok(
  postResetRollRejected !== null
    && /not allowed/.test(postResetRollRejected),
  "a phase-forbidden roll rejects at the ACL before registry code: "
    + JSON.stringify(postResetRollRejected),
);
assert.equal(
  clientCalls.filter((call) => call.operation === "rules.damage").length,
  resetRollCallsBefore,
  "session reset must clear the identity without transport",
);
assert.ok(
  !JSON.stringify(clientCalls.slice(clientCallsAtReset))
    .includes("inv-other-campaign-9"),
  "no stale identity crosses the session reset",
);

// Every piece of model-visible content in the replay is opaque-free.
for (const entry of modelContents) {
  assert.ok(
    !EXACT_OPAQUE_SUBSTRINGS.some((needle) => entry.text.includes(needle)),
    `model-visible content for ${entry.name} contains opaque material`,
  );
}

console.log("normal-model-id-boundary: all assertions passed");
