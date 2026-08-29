import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { embeddedPiFile } from "./_lib/embedded-pi-path.mjs";

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const dependencyRoot = path.resolve(process.env.PI_TEST_REPO_ROOT || repoRoot);
const extension = await import(path.join(
  repoRoot,
  "plugins/coc-keeper/pi/extensions/index.ts",
));
const { validateToolCall } = await import(embeddedPiFile(
  dependencyRoot,
  "pi-ai",
  "dist/utils/validation.js",
));

const previousRole = process.env.COC_PI_SESSION_ROLE;
const previousCampaign = process.env.PI_COC_CAMPAIGN_ID;
const originalExit = process.exit;
delete process.env.COC_PI_SESSION_ROLE;
delete process.env.PI_COC_CAMPAIGN_ID;

const workspace = mkdtempSync(path.join(tmpdir(), "pi-coc-no-selector-typed-"));
const welcomeAgentDir = mkdtempSync(path.join(tmpdir(), "pi-coc-no-selector-agent-"));
const campaign = "no-selector-haunting";
const investigator = "thomas-hayes";
const setupCompleteDecisionId = (
  `setup-complete:${campaign}:${investigator}:handoff-1`
);
const tools = new Map();
const handlers = new Map();
const activeSnapshots = [];
const clientCalls = [];
const sent = [];
const appended = [];
const exitCodes = [];
const observedCompilerContexts = [];
const compiledReviews = [];
let durableSetupCompleteReceipt = null;
const hostCompilationReceipt = {
  schema_version: 1,
  contract_id: "coc.pi-state-claim-compilation-receipt.v1",
  status: "completed",
  binding: {
    campaign_id: campaign,
    turn_id: "turn-no-selector-review-1",
    source_digest: "sha256:no-selector-source-1",
    mechanics_bundle_sha256: "sha256:no-selector-mechanics-1",
  },
  disposition: "no_claims_detected",
  claims: [],
};

const canonicalJsonSha256 = (value) => (
  `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`
);

const handoffEnvelope = (decisionId) => ({
  ok: true,
  tool: "setup.complete",
  data: {
    schema_version: 1,
    status: "PASS",
    kind: "campaign.complete",
    result: {
      campaign_id: campaign,
      ready_for_table: true,
      next: "table_opening",
      handoff: {
        schema_version: 1,
        campaign_id: campaign,
        decision_id: decisionId,
        investigator_ids: [investigator],
        completed_at: "2026-08-26T00:00:00Z",
        opening_projection_ref: null,
        lane_interrupted_at_handoff: false,
      },
    },
  },
});

const canonicalCall = async (name, params) => {
  assert.equal(name, "coc_invoke");
  clientCalls.push(structuredClone(params));
  if (params.operation === "setup.quick_start") {
    assert.equal(params.root, path.resolve(workspace));
    assert.equal(params.campaign, undefined);
    assert.deepEqual(params.arguments, {
      campaign_id: campaign,
      scenario_id: "the-haunting",
      pregen_id: investigator,
      title: "The Haunting",
      decision_id: "quick-start:the-haunting:attempt-1",
    });
    return {
      ok: true,
      tool: "setup.quick_start",
      data: {
        schema_version: 1,
        status: "PASS",
        kind: "campaign.quick_start",
        result: {
          campaign_id: campaign,
          investigator_id: investigator,
          needs_investigator: false,
          scenario_id: "the-haunting",
          pregen_id: investigator,
          character_path: path.join(
            workspace,
            ".coc",
            "investigators",
            investigator,
            "character.json",
          ),
          campaign_dir: path.join(workspace, ".coc", "campaigns", campaign),
        },
        state_refs: [
          `.coc/campaigns/${campaign}`,
          `.coc/investigators/${investigator}/character.json`,
        ],
      },
    };
  }
  if (params.operation === "setup.complete") {
    assert.equal(params.root, path.resolve(workspace));
    assert.equal(params.campaign, campaign);
    assert.equal(params.arguments.campaign_id, campaign);
    assert.equal(params.arguments.decision_id, setupCompleteDecisionId);
    if (durableSetupCompleteReceipt === null) {
      durableSetupCompleteReceipt = handoffEnvelope(params.arguments.decision_id);
      throw new Error(
        "simulated setup.complete response unavailable after durable commit",
      );
    }
    return structuredClone(durableSetupCompleteReceipt);
  }
  if (params.operation === "session.resume") {
    assert.equal(params.root, path.resolve(workspace));
    assert.equal(params.campaign, campaign);
    // The host attaches its own session id post-validation; it is never
    // model-authored and the model-facing schema stays semantic-only.
    assert.deepEqual(params.arguments, {
      host_session_id: "no-selector-typed-onboarding",
    });
    return {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: campaign,
        mode: "table_opening",
        next_operations: ["evidence.table_opening"],
      },
    };
  }
  if (params.operation === "evidence.table_opening") {
    const text = params.arguments.text;
    return {
      ok: true,
      tool: "evidence.table_opening",
      data: {
        schema_version: 1,
        turn: 0,
        text,
        text_sha256: canonicalJsonSha256(text),
        authoritative_time_anchor: { day: 1, period: "morning" },
      },
    };
  }
  if (params.operation === "state.cash_grant" || params.operation === "state.item_grant") {
    return { ok: true, tool: params.operation, data: { changed: true } };
  }
  if (params.operation === "state.journal") {
    return {
      ok: true,
      tool: "state.journal",
      data: { turn_id: "turn-no-selector-review-1" },
    };
  }
  if (params.operation === "turn.output_context") {
    return {
      ok: true,
      tool: "turn.output_context",
      data: {
        schema_version: 1,
        turn_id: "turn-no-selector-review-1",
        source_digest: "sha256:no-selector-source-1",
        settlement_snapshot_id: "turn-settlement-v1:no-selector-review-1",
        mechanics_bundle_sha256: "sha256:no-selector-mechanics-1",
        contract_projection: {
          agency_review_required: true,
          agency_authority: { pc_subject_refs: [`pc:${investigator}`] },
        },
        agency_review_operation: {
          operation: "narration.review",
          prefilled_arguments: { revision: 1 },
        },
        finalize_operation: {
          operation: "turn.finalize",
          prefilled_arguments: { revision: 1 },
        },
      },
    };
  }
  if (params.operation === "narration.review") {
    assert.deepEqual(
      params.arguments.state_claim_compilation,
      hostCompilationReceipt,
    );
    return {
      ok: true,
      tool: "narration.review",
      data: {
        schema_version: 1,
        accepted: true,
        review_id: "narration-review:no-selector-review-1",
        revision: 1,
        state_claim_compilation: { private: "must-be-scrubbed" },
      },
    };
  }
  if (params.operation === "turn.finalize") {
    assert.equal(
      params.arguments.narration_review_id,
      "narration-review:no-selector-review-1",
    );
    const renderedText = "档案合拢时，远处教堂的钟声正好响起。";
    return {
      ok: true,
      tool: "turn.finalize",
      data: {
        schema_version: 1,
        rendered_text: renderedText,
        rendered_text_sha256: canonicalJsonSha256(renderedText),
        obligation_ids: [],
      },
    };
  }
  throw new Error(`unexpected canonical call ${params.operation}`);
};

const pi = {
  registerTool(tool) { tools.set(tool.name, tool); },
  getAllTools() {
    return [
      ...tools.values(),
      { name: "subagent", parameters: { type: "object", properties: {} } },
      { name: "subagent_wait", parameters: { type: "object", properties: {} } },
      { name: "read", parameters: { type: "object", properties: {} } },
    ];
  },
  registerCommand() {},
  registerShortcut() {},
  on(type, handler) {
    const list = handlers.get(type) ?? [];
    list.push(handler);
    handlers.set(type, list);
  },
  appendEntry(type, value) { appended.push({ type, value }); },
  sendMessage(message, options) { sent.push({ message, options }); },
  setActiveTools(names) { activeSnapshots.push([...names]); },
  getThinkingLevel: () => "off",
};

extension.default(pi, {
  coordinatorEnabled: () => false,
  startupCampaignId: () => null,
  welcomeAgentDir,
  createStateClaimCompiler: () => ({
    clear() {},
    beginExternalTurn() {},
    observeOutputContext(campaignId, envelope) {
      observedCompilerContexts.push({
        campaignId,
        envelope: structuredClone(envelope),
      });
    },
    async compileReview(options) {
      compiledReviews.push({
        campaignId: options.campaignId,
        arguments: structuredClone(options.arguments),
      });
      assert.equal(
        Object.hasOwn(options.arguments, "state_claim_compilation"),
        false,
      );
      return structuredClone(hostCompilationReceipt);
    },
  }),
  createClient: () => ({
    callTool: canonicalCall,
    async callToolWithTransportMeta(name, params) {
      return { value: await canonicalCall(name, params), transport: null };
    },
    async close() {},
  }),
});

const ctx = {
  cwd: workspace,
  mode: "rpc",
  model: { provider: "xai", id: "grok-4.5" },
  sessionManager: {
    getSessionId: () => "no-selector-typed-onboarding",
    getEntries: () => [],
    getBranch: () => [],
  },
  hasUI: false,
};

const emit = async (type, event) => {
  for (const handler of handlers.get(type) ?? []) await handler(event, ctx);
};

const invokeValidated = async (toolName, id, args) => {
  const tool = tools.get(toolName);
  assert.ok(tool, toolName);
  const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args;
  const validated = validateToolCall([tool], {
    name: toolName,
    arguments: prepared,
  });
  return JSON.parse((await tool.execute(
    id,
    validated,
    undefined,
    undefined,
    ctx,
  )).content[0].text);
};

const assertNoGenericWrappers = (names) => {
  for (const name of [
    "coc_invoke",
    "coc_setup",
    "coc_context",
    "coc_rules",
    "coc_state",
    "coc_npc",
    "coc_turn",
    "coc_advice",
    "coc_subsystem",
  ]) assert.ok(!names.includes(name), name);
};

async function assertRoleNullResumeGateCase({
  label,
  resumeDataForCampaign,
  expectFirstResumeAccepted = false,
  omitQuickStartCampaignId = false,
  loseQuickStartResponseAfterCommit = false,
  terminalRetryArguments = {},
  verifyTerminalRetryRejections = false,
}) {
  const caseCampaign = `no-selector-${label}`;
  const caseInvestigator = `investigator-${label}`;
  const caseWorkspace = mkdtempSync(
    path.join(tmpdir(), `pi-coc-${label}-`),
  );
  const caseAgentDir = mkdtempSync(
    path.join(tmpdir(), `pi-coc-${label}-agent-`),
  );
  const caseTools = new Map();
  const caseHandlers = new Map();
  const caseActive = [];
  const caseAppended = [];
  const caseCalls = [];
  let durableQuickStartReceipt = null;
  let durableQuickStartMutations = 0;
  const caseCanonical = async (name, params) => {
    assert.equal(name, "coc_invoke");
    caseCalls.push(structuredClone(params));
    if (params.operation === "setup.quick_start") {
      const receipt = {
        ok: true,
        tool: "setup.quick_start",
        data: {
          schema_version: 1,
          status: "PASS",
          kind: "campaign.quick_start",
          result: {
            campaign_id: caseCampaign,
            investigator_id: caseInvestigator,
            needs_investigator: false,
            scenario_id: "the-haunting",
            pregen_id: caseInvestigator,
            character_path: path.join(
              caseWorkspace,
              ".coc",
              "investigators",
              caseInvestigator,
              "character.json",
            ),
            campaign_dir: path.join(
              caseWorkspace,
              ".coc",
              "campaigns",
              caseCampaign,
            ),
          },
          state_refs: [
            `.coc/campaigns/${caseCampaign}`,
            `.coc/investigators/${caseInvestigator}/character.json`,
          ],
        },
      };
      if (loseQuickStartResponseAfterCommit) {
        if (durableQuickStartReceipt !== null) {
          return structuredClone(durableQuickStartReceipt);
        }
        durableQuickStartMutations += 1;
        durableQuickStartReceipt = structuredClone(receipt);
        throw new Error(
          "simulated setup.quick_start response unavailable after durable commit",
        );
      }
      return receipt;
    }
    if (params.operation === "setup.complete") {
      return {
        ok: true,
        tool: "setup.complete",
        wire: {
          schema_version: 1,
          profile: "keeper_hot_v1",
          canonical_operation: "setup.complete",
        },
        data: {
          schema_version: 1,
          status: "PASS",
          kind: "campaign.complete",
          result: {
            campaign_id: caseCampaign,
            ready_for_table: true,
            next: "table_opening",
            handoff: {
              schema_version: 1,
              campaign_id: caseCampaign,
              decision_id: params.arguments.decision_id,
              investigator_ids: [caseInvestigator],
              completed_at: "2026-08-26T00:00:00Z",
              opening_projection_ref: {
                kind: "opening_source_readiness",
                state: "not_source_gated",
                reason: "no_source_binding",
              },
              lane_interrupted_at_handoff: false,
            },
          },
        },
        warnings: [],
        hints: ["retain this handoff receipt"],
      };
    }
    if (params.operation === "session.resume") {
      const resumeAttempt = caseCalls.filter(
        (call) => call.operation === "session.resume",
      ).length;
      return {
        ok: true,
        tool: "session.resume",
        data: resumeAttempt === 1
          ? resumeDataForCampaign(caseCampaign)
          : {
              schema_version: 1,
              campaign_id: caseCampaign,
              mode: "table_opening",
              next_operations: ["evidence.table_opening"],
            },
      };
    }
    throw new Error(`malformed resume ${label} escaped to ${params.operation}`);
  };
  const casePi = {
    registerTool(tool) { caseTools.set(tool.name, tool); },
    getAllTools() {
      return [
        ...caseTools.values(),
        { name: "subagent", parameters: { type: "object", properties: {} } },
        { name: "subagent_wait", parameters: { type: "object", properties: {} } },
        { name: "read", parameters: { type: "object", properties: {} } },
      ];
    },
    registerCommand() {},
    registerShortcut() {},
    on(type, handler) {
      const list = caseHandlers.get(type) ?? [];
      list.push(handler);
      caseHandlers.set(type, list);
    },
    appendEntry(type, value) { caseAppended.push({ type, value }); },
    sendMessage() {},
    setActiveTools(names) { caseActive.push([...names]); },
    getThinkingLevel: () => "off",
  };
  extension.default(casePi, {
    coordinatorEnabled: () => false,
    startupCampaignId: () => null,
    welcomeAgentDir: caseAgentDir,
    createClient: () => ({
      callTool: caseCanonical,
      async callToolWithTransportMeta(name, params) {
        return { value: await caseCanonical(name, params), transport: null };
      },
      async close() {},
    }),
  });
  const caseCtx = {
    cwd: caseWorkspace,
    mode: "rpc",
    model: { provider: "xai", id: "grok-4.5" },
    sessionManager: {
      getSessionId: () => `malformed-resume-${label}`,
      getEntries: () => [],
      getBranch: () => [],
    },
    hasUI: false,
  };
  const caseEmit = async (type, event) => {
    for (const handler of caseHandlers.get(type) ?? []) {
      await handler(event, caseCtx);
    }
  };
  await caseEmit("session_start", { type: "session_start" });
  await caseEmit("message_start", {
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text: "开始快速开桌。" }],
    },
  });
  const quickExecution = caseTools.get("coc_setup_quick_start").execute(
    `quick-${label}`,
    {
      ...(omitQuickStartCampaignId ? {} : { campaign_id: caseCampaign }),
      scenario_id: "the-haunting",
      pregen_id: caseInvestigator,
      title: "The Haunting",
      decision_id: "quick-start:the-haunting:attempt-1",
    },
    undefined,
    undefined,
    caseCtx,
  );
  if (loseQuickStartResponseAfterCommit) {
    await assert.rejects(
      quickExecution,
      /response unavailable after durable commit/,
    );
    assert.equal(durableQuickStartReceipt.data.result.campaign_id, caseCampaign);
    assert.equal(
      caseCalls.filter((call) => call.operation === "setup.quick_start").length,
      1,
    );
    assert.deepEqual(
      caseActive.at(-1),
      ["coc_setup_quick_start"],
      `${label}: ${JSON.stringify(caseActive)}`,
    );
    const callsBeforeMismatch = caseCalls.length;
    const mismatch = JSON.parse((await caseTools.get("coc_setup_quick_start").execute(
      `quick-mismatch-${label}`,
      {
        scenario_id: "the-haunting",
        pregen_id: caseInvestigator,
        title: "The Haunting",
        decision_id: "quick-start:the-haunting:attempt-2",
      },
      undefined,
      undefined,
      caseCtx,
    )).content[0].text);
    assert.equal(mismatch.ok, false, `${label}: ${JSON.stringify(mismatch)}`);
    assert.equal(mismatch.error.code, "quick_start_recovery_mismatch", label);
    assert.equal(caseCalls.length, callsBeforeMismatch, label);
    const replayResult = JSON.parse((await caseTools.get("coc_setup_quick_start").execute(
      `quick-replay-${label}`,
      {
        scenario_id: "the-haunting",
        pregen_id: caseInvestigator,
        title: "The Haunting",
        decision_id: "quick-start:the-haunting:attempt-1",
      },
      undefined,
      undefined,
      caseCtx,
    )).content[0].text);
    assert.equal(replayResult.ok, true, `${label}: ${JSON.stringify(replayResult)}`);
    assert.equal(durableQuickStartMutations, 1, label);
    assert.equal(
      caseCalls.filter((call) => call.operation === "setup.quick_start").length,
      2,
      label,
    );
  }
  if (!loseQuickStartResponseAfterCommit) {
    const quickResult = JSON.parse((await quickExecution).content[0].text);
    assert.equal(quickResult.ok, true, `${label}: ${JSON.stringify(quickResult)}`);
  }
  if (omitQuickStartCampaignId) {
    const routeAudits = caseAppended
      .filter(({ type }) => type === "coc-opening-setup-route-audit")
      .map(({ value }) => value);
    assert.ok(routeAudits.some((audit) => (
      audit.transition === "canonical_no_selector_quick_start_identity_adopted"
      && audit.campaign_id === caseCampaign
    )), `${label}: ${JSON.stringify(routeAudits)}`);
    assert.ok(!routeAudits.some((audit) => (
      audit.reason === "unowned_result"
      && audit.operation === "setup.quick_start"
    )), `${label}: ${JSON.stringify(routeAudits)}`);
  }
  await caseEmit("message_start", {
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text: "确认打开游戏桌。" }],
    },
  });
  const discoveredSetupComplete = JSON.parse((await caseTools.get("coc_discover").execute(
    `discover-complete-${label}`,
    { operation: "setup.complete" },
    undefined,
    undefined,
    caseCtx,
  )).content[0].text);
  assert.equal(
    discoveredSetupComplete.ok,
    true,
    `${label}: ${JSON.stringify(discoveredSetupComplete)}`,
  );
  const completeResult = JSON.parse((await caseTools.get("coc_setup_complete").execute(
    `complete-${label}`,
    {
      campaign_id: caseCampaign,
      decision_id: (
        `setup-complete:${caseCampaign}:${caseInvestigator}:handoff-1`
      ),
    },
    undefined,
    undefined,
    caseCtx,
  )).content[0].text);
  assert.equal(
    completeResult.ok,
    true,
    `${label}: ${JSON.stringify(completeResult)}`,
  );
  assert.deepEqual(
    caseActive.at(-1),
    ["coc_session_resume"],
    `${label}: ${JSON.stringify(caseActive)}`,
  );
  const firstResume = JSON.parse((await caseTools.get("coc_session_resume").execute(
    `resume-${label}`,
    {},
    undefined,
    undefined,
    caseCtx,
  )).content[0].text);
  if (expectFirstResumeAccepted) {
    assert.equal(firstResume.ok, true, `${label}: ${JSON.stringify(firstResume)}`);
    assert.ok(caseActive.at(-1).includes("coc_evidence_table_opening"), label);
    const resumedWorkingSet = caseAppended
      .filter(({ type }) => type === "coc-tool-working-set")
      .at(-1)?.value;
    assert.equal(
      resumedWorkingSet?.role,
      "play",
      `${label}: ${JSON.stringify(caseAppended)}`,
    );
    const npcDiscovery = JSON.parse((await caseTools.get("coc_discover").execute(
      `discover-npc-reaction-${label}`,
      { operation: "npc.reaction" },
      undefined,
      undefined,
      caseCtx,
    )).content[0].text);
    assert.equal(npcDiscovery.ok, true, `${label}: ${JSON.stringify(npcDiscovery)}`);
    assert.equal(npcDiscovery.data.operation_card.operation, "npc.reaction", label);
    assert.equal(
      caseCalls.filter((call) => call.operation === "session.resume").length,
      1,
      label,
    );
    return;
  }
  assert.deepEqual(caseActive.at(-1), ["coc_session_resume"], label);
  assertNoGenericWrappers(caseActive.at(-1));
  assert.ok(!caseActive.at(-1).includes("coc_evidence_table_opening"), label);
  assert.ok(!caseActive.at(-1).includes("coc_state_journal"), label);

  const callsBeforeBlockedPlay = caseCalls.length;
  let blockedOpening = null;
  let blockedOpeningError = null;
  try {
    blockedOpening = await caseTools.get("coc_evidence_table_opening").execute(
        `blocked-opening-${label}`,
        {
          text: "不应抵达 MCP 的开场。",
          presented_roll_ids: [],
        },
        undefined,
        undefined,
        caseCtx,
    );
  } catch (error) {
    blockedOpeningError = error;
  }
  if (blockedOpeningError !== null) {
    assert.match(
      String(blockedOpeningError),
      /session.resume|terminally blocked|hard-gated/,
      label,
    );
  } else {
    const blockedOpeningEnvelope = JSON.parse(blockedOpening.content[0].text);
    assert.equal(blockedOpeningEnvelope.ok, false, label);
  }
  await assert.rejects(
    caseTools.get("coc_state_journal").execute(
      `blocked-journal-${label}`,
      { summary: "不应抵达 MCP。" },
      undefined,
      undefined,
      caseCtx,
    ),
    /session.resume|terminally blocked|hard-gated/,
  );
  assert.equal(caseCalls.length, callsBeforeBlockedPlay, label);

  const callsBeforeRetry = caseCalls.length;
  if (verifyTerminalRetryRejections) {
    for (const [suffix, argumentsObject] of [
      ["campaign-mismatch", {
        ...terminalRetryArguments,
        campaign: `${caseCampaign}-drifted`,
      }],
      ["forbidden-argument", {
        ...terminalRetryArguments,
        unsupported: "drift",
      }],
    ]) {
      let rejected = null;
      let blocked = null;
      try {
        blocked = await caseTools.get("coc_session_resume").execute(
          `resume-retry-${label}-${suffix}`,
          argumentsObject,
          undefined,
          undefined,
          caseCtx,
        );
      } catch (error) {
        rejected = error;
      }
      if (rejected !== null) {
        assert.match(
          String(rejected),
          /session.resume|terminally blocked|hard-gated/,
        );
      } else {
        const projected = JSON.parse(blocked.content[0].text);
        assert.equal(projected.ok, false, `${label}:${suffix}`);
      }
      assert.equal(caseCalls.length, callsBeforeRetry, `${label}:${suffix}`);
    }
  }
  const retried = JSON.parse((await caseTools.get("coc_session_resume").execute(
    `resume-retry-${label}`,
    terminalRetryArguments,
    undefined,
    undefined,
    caseCtx,
  )).content[0].text);
  assert.equal(retried.ok, true, `${label}: ${JSON.stringify(retried)}`);
  // Each resume execution also emits a canonical memory.extraction_status
  // probe after the resume call itself.
  assert.equal(caseCalls.length, callsBeforeRetry + 2, label);
  assert.deepEqual(caseCalls.at(-2), {
    operation: "session.resume",
    root: path.resolve(caseWorkspace),
    campaign: caseCampaign,
    arguments: {
      ...terminalRetryArguments,
      host_session_id: `malformed-resume-${label}`,
    },
  }, label);
  const postRetryTools = caseActive.at(-1);
  assertNoGenericWrappers(postRetryTools);
  assert.ok(postRetryTools.includes("coc_evidence_table_opening"), label);
  assert.ok(!postRetryTools.includes("coc_setup_quick_start"), label);
  assert.ok(!postRetryTools.includes("coc_setup_complete"), label);
  assert.ok(!postRetryTools.includes("coc_state_journal"), label);
  const resumedWorkingSet = caseAppended
    .filter(({ type }) => type === "coc-tool-working-set")
    .at(-1)?.value;
  assert.equal(
    resumedWorkingSet?.role,
    "play",
    `${label}: ${JSON.stringify(caseAppended)}`,
  );
}

try {
  process.exit = (code) => { exitCodes.push(code); };
  await emit("session_start", { type: "session_start" });
  await emit("message_start", {
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text: "玩《闹鬼》，用托马斯·海斯。" }],
    },
  });

  // Cold start: the host registers the bounded tool manifest up front and
  // the model's first coc_discover projects the active working set.
  const registeredNames = [...tools.keys()];
  assert.ok(registeredNames.includes("coc_discover"), JSON.stringify(registeredNames));
  assert.ok(
    registeredNames.includes("coc_setup_quick_start"),
    JSON.stringify(registeredNames),
  );
  const coldDiscover = JSON.parse((await tools.get("coc_discover").execute(
    "cold-discover",
    { domain: "setup" },
    undefined,
    undefined,
    ctx,
  )).content[0].text);
  assert.equal(coldDiscover.ok, true, JSON.stringify(coldDiscover).slice(0, 300));
  const coldStartTools = activeSnapshots.at(-1);
  assertNoGenericWrappers(coldStartTools);
  assert.ok(coldStartTools.includes("coc_discover"), JSON.stringify(coldStartTools));
  assert.ok(coldStartTools.includes("coc_setup_quick_start"), JSON.stringify(coldStartTools));
  const quickStart = tools.get("coc_setup_quick_start");
  assert.ok(!quickStart.parameters.properties.root);
  assert.ok(!quickStart.parameters.properties.campaign);
  assert.ok(quickStart.parameters.required.includes("decision_id"));
  assert.ok(new RegExp(
    quickStart.parameters.properties.decision_id.pattern,
  ).test("quick-start:the-haunting:attempt-1"));

  const callsBeforeForge = clientCalls.length;
  const forged = await quickStart.execute(
    "forged-root",
    {
      root: "/tmp/forged",
      campaign_id: campaign,
      scenario_id: "the-haunting",
      pregen_id: investigator,
      title: "The Haunting",
      decision_id: "quick-start:the-haunting:attempt-1",
    },
    undefined,
    undefined,
    ctx,
  );
  assert.match(forged.content[0].text, /forged_host_argument/);
  assert.equal(clientCalls.length, callsBeforeForge);

  await invokeValidated("coc_setup_quick_start", "quick-start", {
    campaign_id: campaign,
    scenario_id: "the-haunting",
    pregen_id: investigator,
    title: "The Haunting",
    decision_id: "quick-start:the-haunting:attempt-1",
  });
  const complete = tools.get("coc_setup_complete");
  assert.deepEqual(
    complete.parameters.required,
    ["campaign_id", "decision_id"],
  );
  assert.deepEqual(
    Object.keys(complete.parameters.properties ?? {}).sort(),
    ["campaign_id", "decision_id"],
  );
  assert.ok(!complete.parameters.properties.root);
  assert.ok(!complete.parameters.properties.campaign);
  assert.equal(
    complete.parameters.properties.decision_id.const,
    setupCompleteDecisionId,
  );
  assert.match(
    setupCompleteDecisionId,
    new RegExp(complete.parameters.properties.decision_id.pattern),
  );
  assert.throws(
    () => validateToolCall([complete], {
      name: "coc_setup_complete",
      arguments: { campaign_id: campaign },
    }),
    /decision_id/,
  );
  assert.ok(activeSnapshots.at(-1).includes("coc_setup_complete"));

  const completeCallsBeforeConfirmation = clientCalls.filter(
    (call) => call.operation === "setup.complete",
  ).length;
  await assert.rejects(
    invokeValidated("coc_setup_complete", "same-turn-complete", {
      campaign_id: campaign,
      decision_id: setupCompleteDecisionId,
    }),
    /requires a new external player message/,
  );
  assert.equal(
    clientCalls.filter((call) => call.operation === "setup.complete").length,
    completeCallsBeforeConfirmation,
  );

  await emit("message_start", {
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text: "确认打开游戏桌。" }],
    },
  });
  const decisionContext = sent
    .filter(({ message }) => (
      message.customType === "coc-opening-table-player-decision"
    ))
    .at(-1)?.message.details;
  assert.deepEqual(
    decisionContext.next_operation.prefilled_arguments,
    {
      campaign_id: campaign,
      decision_id: setupCompleteDecisionId,
    },
  );
  assert.deepEqual(
    decisionContext.next_operation.missing_arguments,
    [],
  );
  await assert.rejects(
    invokeValidated("coc_setup_complete", "lost-complete-response", {
      campaign_id: campaign,
      decision_id: setupCompleteDecisionId,
    }),
    /response unavailable after durable commit/,
  );
  const callsAfterLostResponse = clientCalls.filter(
    (call) => call.operation === "setup.complete",
  ).length;
  assert.equal(callsAfterLostResponse, 1);
  for (const invalidDecisionId of [
    `setup-complete:${campaign}:${investigator}:handoff-2`,
    "550e8400-e29b-41d4-a716-446655440000",
    "a".repeat(64),
    "opaque-confirmation-token",
  ]) {
    assert.throws(
      () => validateToolCall([complete], {
        name: "coc_setup_complete",
        arguments: {
          campaign_id: campaign,
          decision_id: invalidDecisionId,
        },
      }),
      /decision_id|const|handoff-1/,
    );
  }
  // The drifted UUID decision_id rejects at the raw identity gate before
  // transport; the field name is surfaced without echoing the value.
  {
    const drifted = JSON.parse((await complete.execute(
      "drifted-complete-direct",
      {
        campaign_id: campaign,
        decision_id: "550e8400-e29b-41d4-a716-446655440000",
      },
      undefined,
      undefined,
      ctx,
    )).content[0].text);
    assert.equal(drifted.ok, false);
    assert.equal(drifted.error.code, "opaque_identity_grammar");
    assert.ok(
      !JSON.stringify(drifted).includes("550e8400"),
      "the drifted id is never echoed",
    );
  }
  assert.equal(
    clientCalls.filter((call) => call.operation === "setup.complete").length,
    callsAfterLostResponse,
  );
  await invokeValidated("coc_setup_complete", "retried-complete", {
    campaign_id: campaign,
    decision_id: setupCompleteDecisionId,
  });
  assert.deepEqual(exitCodes, []);
  assert.deepEqual(activeSnapshots.at(-1), ["coc_session_resume"]);
  assertNoGenericWrappers(activeSnapshots.at(-1));
  assert.deepEqual(tools.get("coc_session_resume").parameters.required ?? [], []);
  assert.deepEqual(Object.keys(tools.get("coc_session_resume").parameters.properties ?? {}), []);

  const callsBeforeStaleSetup = clientCalls.length;
  await assert.rejects(
    quickStart.execute(
      "stale-quick-start",
      {
        campaign_id: `${campaign}-stale`,
        scenario_id: "the-haunting",
        pregen_id: investigator,
      },
      undefined,
      undefined,
      ctx,
    ),
    /hard-gated|session.resume/,
  );
  assert.equal(clientCalls.length, callsBeforeStaleSetup);

  await invokeValidated("coc_session_resume", "resume", {});
  const opening = tools.get("coc_evidence_table_opening");
  assert.ok(activeSnapshots.at(-1).includes("coc_evidence_table_opening"));
  assert.ok(opening.parameters.properties.text);
  assert.ok(!opening.parameters.properties.narrative);
  for (const hostField of ["root", "campaign", "run_id", "decision_id"]) {
    assert.ok(!opening.parameters.properties[hostField], hostField);
  }
  assert.throws(
    () => validateToolCall([opening], {
      name: "coc_evidence_table_opening",
      arguments: {
        narrative: "wrong field",
        presented_roll_ids: [],
      },
    }),
    /text|narrative/,
  );

  await invokeValidated("coc_evidence_table_opening", "opening", {
    text: "雨夜里，波士顿的街灯在雾中泛着冷光。",
    presented_roll_ids: [],
  });

  const discover = tools.get("coc_discover");
  for (const operation of ["state.cash_grant", "state.item_grant"]) {
    const discovered = JSON.parse((await discover.execute(
      `discover-${operation}`,
      { operation },
      undefined,
      undefined,
      ctx,
    )).content[0].text);
    assert.equal(discovered.ok, true, JSON.stringify(discovered));
    assert.equal(discovered.data.operation_card.operation, operation);
    assert.equal(discovered.data.operation_card.parameters.additionalProperties, false);
  }
  const cash = tools.get("coc_state_cash_grant");
  const item = tools.get("coc_state_item_grant");
  for (const key of ["investigator", "source", "localized_reason"]) {
    assert.ok(cash.parameters.properties[key], key);
  }
  for (const key of ["investigator", "kind", "label"]) {
    assert.ok(item.parameters.properties[key], key);
  }
  await invokeValidated("coc_state_cash_grant", "cash", {
    campaign,
    amount: 10,
    currency: "USD",
    source: "commission",
    reason: "advance",
    localized_reason: "委托预付款",
    decision_id: "cash-1",
    investigator: "current-investigator",
  });
  await invokeValidated("coc_state_item_grant", "item", {
    campaign,
    kind: "gear",
    label: "房门钥匙",
    decision_id: "item-1",
    investigator: "current-investigator",
  });

  await emit("message_start", {
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text: "我把刚才发现的线索记进调查日志。" }],
    },
  });
  await invokeValidated("coc_state_journal", "journal", {
    summary: "调查员记录了墙纸后发现的旧账页。",
  });
  const context = await invokeValidated(
    "coc_turn_output_context",
    "output-context",
    { campaign },
  );
  assert.equal(context.ok, true, JSON.stringify(context));
  assert.equal(observedCompilerContexts.length, 1);
  assert.equal(observedCompilerContexts[0].campaignId, campaign);
  assert.equal(
    observedCompilerContexts[0].envelope.data.turn_id,
    "turn-no-selector-review-1",
  );

  const reviewDraft = "我把潮湿墙纸后露出的旧账页逐行抄进笔记本。";
  const reviewArgs = {
    draft_text: reviewDraft,
    findings: [],
    state_authority_review: {
      disposition: "no_player_state_change_claimed",
      reason: "叙述没有声称调查员数值或物品发生变化。",
      claims: [],
    },
  };
  const reviewTool = tools.get("coc_narration_review");
  const callsBeforeForgedCompilation = clientCalls.length;
  const forgedCompilation = JSON.parse((await reviewTool.execute(
    "forged-state-claim-compilation",
    {
      ...reviewArgs,
      state_claim_compilation: { forged: true },
    },
    undefined,
    undefined,
    ctx,
  )).content[0].text);
  assert.equal(forgedCompilation.ok, false);
  assert.match(
    forgedCompilation.error.code,
    /forged_host_argument|bound_argument_supplied/,
  );
  assert.equal(clientCalls.length, callsBeforeForgedCompilation);

  const review = await invokeValidated(
    "coc_narration_review",
    "review",
    reviewArgs,
  );
  assert.equal(review.ok, true, JSON.stringify(review));
  assert.equal(Object.hasOwn(review.data, "state_claim_compilation"), false);
  assert.equal(compiledReviews.length, 1);
  assert.equal(compiledReviews[0].campaignId, campaign);
  assert.equal(compiledReviews[0].arguments.turn_id, "turn-no-selector-review-1");
  assert.equal(
    compiledReviews[0].arguments.source_digest,
    "sha256:no-selector-source-1",
  );
  assert.equal(compiledReviews[0].arguments.revision, 1);
  assert.equal(compiledReviews[0].arguments.draft_text, reviewDraft);

  const finalized = await invokeValidated(
    "coc_turn_finalize",
    "finalize",
    {
      draft: reviewDraft,
      coverage: [],
      agency_claims: [],
    },
  );
  assert.equal(finalized.ok, true, JSON.stringify(finalized));
  assert.equal(
    finalized.data.rendered_text,
    "档案合拢时，远处教堂的钟声正好响起。",
  );
  assert.ok(!activeSnapshots.at(-1).includes("coc_turn_finalize"));

  assertNoGenericWrappers(activeSnapshots.at(-1));
  assert.equal(
    clientCalls.filter((call) => call.operation === "setup.quick_start").length,
    1,
  );
  assert.equal(
    clientCalls.filter((call) => call.operation === "setup.complete").length,
    2,
  );
  const postHandoffCalls = clientCalls.slice(
    clientCalls.findIndex((call) => call.operation === "setup.complete") + 1,
  );
  assert.equal(postHandoffCalls[0].operation, "setup.complete");
  assert.equal(postHandoffCalls[1].operation, "session.resume");
  assert.equal(
    clientCalls.filter((call) => call.operation === "session.resume").length,
    1,
  );
  assert.equal(
    appended.filter(({ type }) => type === "coc_setup_handoff").length,
    1,
  );
  assert.equal(
    appended.find(({ type }) => type === "coc_setup_handoff").value.consumer,
    "pi-coc/same-process",
  );
  assert.equal(
    sent.filter(({ message }) => message.customType === "coc_setup_handoff").length,
    0,
  );

  for (const testCase of [
    {
      label: "missing-next-operations",
      resumeDataForCampaign: (caseCampaign) => ({
        schema_version: 1,
        campaign_id: caseCampaign,
        mode: "table_opening",
      }),
      // Semantic model input only: the retry carries the context epoch;
      // session identity is host-bound, and no party binding exists before
      // resume, so no investigator handle is supplied here.
      terminalRetryArguments: {
        context_epoch: 41,
      },
      verifyTerminalRetryRejections: true,
    },
    {
      label: "wrong-next-operation",
      resumeDataForCampaign: (caseCampaign) => ({
        schema_version: 1,
        campaign_id: caseCampaign,
        mode: "table_opening",
        next_operations: ["scene.context"],
      }),
    },
    {
      label: "duplicate-next-operation",
      resumeDataForCampaign: (caseCampaign) => ({
        schema_version: 1,
        campaign_id: caseCampaign,
        mode: "table_opening",
        next_operations: [
          "evidence.table_opening",
          "evidence.table_opening",
        ],
      }),
    },
    {
      label: "wrong-mode",
      resumeDataForCampaign: (caseCampaign) => ({
        schema_version: 1,
        campaign_id: caseCampaign,
        mode: "awaiting_player",
        next_operations: ["evidence.table_opening"],
      }),
    },
    {
      label: "wrong-campaign",
      resumeDataForCampaign: (caseCampaign) => ({
        schema_version: 1,
        campaign_id: `${caseCampaign}-wrong`,
        mode: "table_opening",
        next_operations: ["evidence.table_opening"],
      }),
    },
    {
      label: "valid-role-transition",
      resumeDataForCampaign: (caseCampaign) => ({
        schema_version: 1,
        campaign_id: caseCampaign,
        mode: "table_opening",
        next_operations: ["evidence.table_opening"],
      }),
      expectFirstResumeAccepted: true,
      omitQuickStartCampaignId: true,
    },
    {
      label: "lost-generated-id-quick-start-response",
      resumeDataForCampaign: (caseCampaign) => ({
        schema_version: 1,
        campaign_id: caseCampaign,
        mode: "awaiting_player",
        next_operations: ["interpret_current_player_message"],
      }),
      omitQuickStartCampaignId: true,
      loseQuickStartResponseAfterCommit: true,
    },
  ]) {
    await assertRoleNullResumeGateCase(testCase);
  }
} finally {
  process.exit = originalExit;
  if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
  else process.env.COC_PI_SESSION_ROLE = previousRole;
  if (previousCampaign === undefined) delete process.env.PI_COC_CAMPAIGN_ID;
  else process.env.PI_COC_CAMPAIGN_ID = previousCampaign;
}
