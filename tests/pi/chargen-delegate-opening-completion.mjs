// setup.chargen_run writes investigator.create + campaign.link_investigator
// atomically, but coc_chargen_delegate reaches it through MCP rather than the
// ordinary setup.invoke receipt observer.
import assert from "node:assert/strict";
import path from "node:path";

await import("./_lib/preload-embedded-pi.mjs");

const root = path.resolve(process.argv[2] || process.cwd());
const {
  OpeningTerminalContinuationGate,
  openingHandoffOperationForSessionRole,
} = await import(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts")
);
process.env.COC_PI_SESSION_ROLE = "setup";

assert.equal(openingHandoffOperationForSessionRole("setup"), "setup.complete");
assert.equal(
  openingHandoffOperationForSessionRole("play"),
  "evidence.table_opening",
);
assert.equal(
  openingHandoffOperationForSessionRole(null),
  "evidence.table_opening",
);

const campaignId = "chargen-delegate-opening-completion";
const gate = new OpeningTerminalContinuationGate();
const resumeParams = {
  operation: "session.resume",
  campaign: campaignId,
  arguments: {},
};

assert.equal(
  gate.openingSetupToolError("coc_invoke", resumeParams, "resume"),
  null,
);
assert.equal(
  gate.observeOpeningSetupInvocation(
    "session.resume",
    resumeParams,
    {
      ok: false,
      tool: "session.resume",
      error: {
        code: "opening_setup_incomplete",
        details: {
          schema_version: 1,
          status: "blocked",
          hard_gate: true,
          activation_allowed: false,
          phase: "opening_character_setup_required",
          campaign_id: campaignId,
          character_setup_policy: "guided_quick_fire",
          next_operation: null,
          instruction: "complete character creation",
        },
      },
    },
    "resume",
  ).accepted,
  true,
);

gate.observeMessageStart({
  role: "user",
  content: [{ type: "text", text: "直接创建调查员。" }],
});
assert.equal(
  gate.acceptVisibleAssistantFinal("请先确认这份完整调查员草案。"),
  true,
  "guided setup prose must remain visible before the delegate write",
);

assert.equal(
  gate.observeChargenDelegateCompletion(campaignId, {
    ok: true,
    investigator_id: "inv-delegate",
    characteristics: {
      STR: 80,
      DEX: 70,
      CON: 60,
      POW: 50,
      APP: 40,
      EDU: 75,
      SIZ: 55,
      INT: 65,
    },
    derived: { hp: 11, mp: 10, san: 60, luck: 45 },
    skill_top: [
      { name: "Language (Own)", value: 75 },
      { name: "Language (English)", value: 70 },
      { name: "Language (Spanish)", value: 65 },
      { name: "Spot Hidden", value: 65 },
      { name: "Library Use", value: 60 },
      { name: "Persuade", value: 50 },
      { name: "Psychology", value: 45 },
      { name: "Art and Craft (Acting)", value: 40 },
    ],
  }, {
    name: "马库斯",
    age: 32,
    occupation_or_concept: "Journalist",
    occupation_label: "记者",
    backstory: {
      personal_description: "瘦高，常穿沾着油墨味的旧风衣。",
      ideology_beliefs: "相信真相必须见报。",
      significant_people: "提携他的老编辑。",
      scenario_bound: "因追查远征队失踪案来到利马。",
    },
    equipment: ["速记本", "袖珍相机"],
    key_connection: {
      backstory_field: "ideology_beliefs",
      summary: "相信真相必须见报。",
    },
    mode: "era_adaptive",
  }),
  true,
  "a successful aggregate chargen result must close the in-memory gate",
);
const playerSummary = gate.acceptVisibleAssistantFinal("");
assert.match(playerSummary.replacementText, /马库斯（32岁，记者）/);
assert.doesNotMatch(playerSummary.replacementText, /Journalist/);
assert.match(playerSummary.replacementText, /力量 80；敏捷 70；体质 60/);
assert.match(playerSummary.replacementText, /生命值 11；魔法值 10；理智 60；幸运 45/);
assert.match(playerSummary.replacementText, /母语 75；语言（英语） 70；语言（西班牙语） 65；侦查 65/);
assert.match(playerSummary.replacementText, /图书馆使用 60；说服 50；心理学 45；艺术与手艺（表演） 40/);
assert.match(playerSummary.replacementText, /人物背景/);
assert.match(playerSummary.replacementText, /外貌与来历：瘦高，常穿沾着油墨味的旧风衣。/);
assert.match(playerSummary.replacementText, /人格信念 ★：相信真相必须见报。/);
assert.match(playerSummary.replacementText, /重要之人：提携他的老编辑。/);
assert.match(playerSummary.replacementText, /如何卷入：因追查远征队失踪案来到利马。/);
assert.match(playerSummary.replacementText, /随身物品：速记本；袖珍相机/);
assert.doesNotMatch(
  playerSummary.replacementText,
  /\b(?:STR|DEX|CON|POW|APP|EDU|SIZ|INT|HP|MP|SAN)\b|Language \(Own\)|First Aid|Spot Hidden|Library Use|Listen|Persuade|Psychology|Art and Craft/,
);
assert.match(playerSummary.replacementText, /确认打开游戏桌/);
assert.equal(
  gate.acceptVisibleAssistantFinal("调查员卡已写入。"),
  false,
  "a tool-free handoff promise must stay hidden until setup.complete succeeds",
);
const starterDecision = gate.openingTableDecisionContext();
assert.ok(starterDecision, JSON.stringify(gate.takeOpeningSetupAudits()));
assert.equal(starterDecision.player_decision_required, true);
assert.equal(starterDecision.typed_tool, "coc_setup_complete");
assert.equal(starterDecision.next_operation.operation, "setup.complete");
assert.equal(starterDecision.next_operation.missing_arguments.length, 0);
assert.equal(
  starterDecision.next_operation.prefilled_arguments.campaign_id,
  campaignId,
);
assert.match(
  starterDecision.next_operation.prefilled_arguments.decision_id,
  /^pi-setup-handoff-[a-f0-9]{32}$/,
);
assert.equal(
  gate.requiredOpeningSetupContinuation(),
  null,
  "decision-pending starter must not auto-complete before semantic consent",
);
const completeParams = {
  operation: "setup.complete",
  campaign: campaignId,
  arguments: structuredClone(starterDecision.next_operation.prefilled_arguments),
};
gate.observeMessageStart({
  role: "user",
  content: [{ type: "text", text: "确认打开游戏桌。" }],
});
const completeEnvelope = ({
  resultCampaignId = campaignId,
  receiptCampaignId = campaignId,
  decisionId = completeParams.arguments.decision_id,
} = {}) => ({
  ok: true,
  tool: "setup.complete",
  data: {
    schema_version: 1,
    status: "PASS",
    kind: "campaign.complete",
    result: {
      campaign_id: resultCampaignId,
      ready_for_table: true,
      next: "table_opening",
      handoff: {
        schema_version: 1,
        campaign_id: receiptCampaignId,
        decision_id: decisionId,
        investigator_ids: ["inv-delegate"],
        completed_at: "2026-08-22T00:00:00Z",
        opening_projection_ref: null,
        lane_interrupted_at_handoff: false,
      },
    },
  },
});
assert.equal(
  gate.openingSetupToolError("coc_invoke", completeParams, "starter-complete"),
  null,
);
assert.equal(
  gate.observeOpeningSetupInvocation(
    "setup.complete",
    completeParams,
    { ok: true, tool: "setup.complete", data: {} },
    "starter-complete",
  ).accepted,
  false,
  "an ok wrapper without the exact completion result must retain the route",
);
assert.equal(gate.hasActiveOpeningSetupFor(campaignId), true);
assert.ok(gate.openingTableDecisionContext());
assert.equal(
  gate.acceptVisibleAssistantFinal("正席已交接，现在开始游戏。"),
  false,
  "an invalid completion envelope must not release a verbal handoff",
);

assert.equal(
  gate.openingSetupToolError(
    "coc_invoke",
    completeParams,
    "starter-complete-wrong-campaign",
  ),
  null,
);
assert.equal(
  gate.observeOpeningSetupInvocation(
    "setup.complete",
    completeParams,
    completeEnvelope({ resultCampaignId: "other-campaign" }),
    "starter-complete-wrong-campaign",
  ).accepted,
  false,
);
assert.equal(gate.hasActiveOpeningSetupFor(campaignId), true);

assert.equal(
  gate.openingSetupToolError(
    "coc_invoke",
    completeParams,
    "starter-complete-late",
  ),
  null,
);
gate.markAgentStart();
assert.equal(
  gate.observeOpeningSetupInvocation(
    "setup.complete",
    completeParams,
    completeEnvelope(),
    "starter-complete-late",
  ).accepted,
  false,
  "an old agent-turn completion result must not clear the current route",
);
assert.equal(gate.hasActiveOpeningSetupFor(campaignId), true);

assert.equal(
  gate.openingSetupToolError(
    "coc_invoke",
    completeParams,
    "starter-complete-wrong-decision",
  ),
  null,
);
assert.equal(
  gate.observeOpeningSetupInvocation(
    "setup.complete",
    completeParams,
    completeEnvelope({ decisionId: "other-decision" }),
    "starter-complete-wrong-decision",
  ).accepted,
  false,
);
assert.equal(gate.hasActiveOpeningSetupFor(campaignId), true);

assert.equal(
  gate.openingSetupToolError(
    "coc_invoke",
    completeParams,
    "starter-complete-exact",
  ),
  null,
);
assert.equal(
  gate.observeOpeningSetupInvocation(
    "setup.complete",
    completeParams,
    completeEnvelope(),
    "starter-complete-exact",
  ).accepted,
  true,
);
assert.equal(gate.hasActiveOpeningSetupFor(campaignId), false);

const unownedDelegateGate = new OpeningTerminalContinuationGate();
assert.equal(
  unownedDelegateGate.observeChargenDelegateCompletion(
    "source-bound-route-not-hydrated",
    {
      ok: true,
      investigator_id: "inv-source-bound",
      characteristics: {},
      derived: {},
      skill_top: [],
    },
  ),
  false,
  "missing volatile route state cannot prove a campaign is a non-source starter",
);
assert.equal(unownedDelegateGate.openingTableDecisionContext(), null);
assert.equal(
  unownedDelegateGate.hasActiveOpeningSetupFor("source-bound-route-not-hydrated"),
  false,
);

const quickStartCampaignId = "fresh-terminal-quick-start";
const quickStartParams = {
  operation: "setup.quick_start",
  root: "/tmp",
  arguments: {
    scenario_id: "the-haunting",
    campaign_id: quickStartCampaignId,
  },
};
const quickStartEnvelope = (overrides = {}) => ({
  ok: true,
  tool: "setup.quick_start",
  data: {
    schema_version: 1,
    status: "PASS",
    kind: "campaign.quick_start",
    result: {
      campaign_id: quickStartCampaignId,
      investigator_id: null,
      needs_investigator: true,
      scenario_id: "the-haunting",
      pregen_id: null,
      character_path: null,
      campaign_dir: `/tmp/.coc/campaigns/${quickStartCampaignId}`,
    },
    state_refs: [`.coc/campaigns/${quickStartCampaignId}`],
  },
  ...overrides,
});
const quickStartGate = new OpeningTerminalContinuationGate();
assert.equal(
  quickStartGate.openingSetupToolError(
    "coc_invoke", quickStartParams, "fresh-quick-start",
  ),
  null,
);
assert.equal(
  quickStartGate.observeOpeningSetupInvocation(
    "setup.quick_start",
    quickStartParams,
    quickStartEnvelope(),
    "fresh-quick-start",
  ).accepted,
  true,
  "exact canonical investigator-less quick_start must hydrate character setup",
);
assert.equal(quickStartGate.hasActiveOpeningSetupFor(quickStartCampaignId), true);
assert.equal(
  quickStartGate.observeChargenDelegateCompletion(
    quickStartCampaignId,
    {
      ok: true,
      investigator_id: "inv-quick-start",
      characteristics: {},
      derived: {},
      skill_top: [],
    },
  ),
  true,
);
assert.equal(
  quickStartGate.openingTableDecisionContext().next_operation.operation,
  "setup.complete",
);

const linkedPregenCampaignId = `${quickStartCampaignId}-linked-pregen`;
const linkedPregenParams = {
  ...quickStartParams,
  arguments: {
    ...quickStartParams.arguments,
    campaign_id: linkedPregenCampaignId,
    pregen_id: "catalog-slot",
  },
};
const linkedPregenEnvelope = quickStartEnvelope();
linkedPregenEnvelope.data.result.campaign_id = linkedPregenCampaignId;
linkedPregenEnvelope.data.result.investigator_id = "sheet-id";
linkedPregenEnvelope.data.result.needs_investigator = false;
linkedPregenEnvelope.data.result.pregen_id = "catalog-slot";
linkedPregenEnvelope.data.result.character_path = (
  "/tmp/.coc/investigators/sheet-id/character.json"
);
linkedPregenEnvelope.data.result.campaign_dir = (
  `/tmp/.coc/campaigns/${linkedPregenCampaignId}`
);
linkedPregenEnvelope.data.state_refs = [
  `.coc/campaigns/${linkedPregenCampaignId}`,
  ".coc/investigators/sheet-id/character.json",
];
const linkedPregenGate = new OpeningTerminalContinuationGate();
assert.equal(
  linkedPregenGate.openingSetupToolError(
    "coc_invoke", linkedPregenParams, "fresh-quick-start-linked-pregen",
  ),
  null,
);
assert.equal(
  linkedPregenGate.observeOpeningSetupInvocation(
    "setup.quick_start",
    linkedPregenParams,
    linkedPregenEnvelope,
    "fresh-quick-start-linked-pregen",
  ).accepted,
  true,
  "canonical linked pregen must hydrate the separate handoff decision",
);
assert.equal(
  linkedPregenGate.openingTableDecisionContext().next_operation.operation,
  "setup.complete",
);
assert.equal(
  linkedPregenGate.requiredOpeningSetupContinuation(),
  null,
  "linked pregen still requires the player's semantic table-open confirmation",
);
const linkedCompleteParams = {
  operation: "setup.complete",
  campaign: linkedPregenCampaignId,
  arguments: structuredClone(
    linkedPregenGate.openingTableDecisionContext()
      .next_operation.prefilled_arguments,
  ),
};
assert.notEqual(
  linkedPregenGate.openingSetupToolError(
    "coc_invoke",
    linkedCompleteParams,
    "linked-pregen-same-player-turn",
  ),
  null,
  "quick_start must not auto-complete a linked pregen in the same player turn",
);
linkedPregenGate.markAgentStart();
linkedPregenGate.observeMessageStart({
  role: "assistant",
  content: [{ type: "text", text: "internal followup" }],
});
linkedPregenGate.observeMessageStart({ role: "user", content: [] });
assert.notEqual(
  linkedPregenGate.openingSetupToolError(
    "coc_invoke",
    linkedCompleteParams,
    "linked-pregen-internal-followup",
  ),
  null,
  "an internal followup or empty user-role event must not satisfy player confirmation",
);
linkedPregenGate.observeMessageStart({
  role: "user",
  content: [{ type: "text", text: "可以开桌" }],
});
assert.equal(
  linkedPregenGate.openingSetupToolError(
    "coc_invoke",
    linkedCompleteParams,
    "linked-pregen-new-player-turn",
  ),
  null,
  "a new external player message may admit the exact setup.complete card",
);

for (const [label, mutate] of [
  ["wrong-campaign", (envelope) => {
    envelope.data.result.campaign_id = "other-campaign";
  }],
  ["inconsistent-pregen", (envelope) => {
    envelope.data.result.needs_investigator = false;
    envelope.data.result.investigator_id = "pregen-investigator";
    envelope.data.result.pregen_id = "starter-pregen";
    envelope.data.result.character_path = "/tmp/investigator.json";
  }],
  ["source-like", (envelope) => {
    envelope.data.result.source = { source_id: "pdf:source-bound" };
  }],
  ["malformed", (envelope) => {
    delete envelope.data.status;
  }],
  ["linked-character-path-mismatch", (envelope, params) => {
    params.arguments.pregen_id = "catalog-slot";
    envelope.data.result.needs_investigator = false;
    envelope.data.result.investigator_id = "sheet-id";
    envelope.data.result.pregen_id = "catalog-slot";
    envelope.data.result.character_path = "/tmp/arbitrary/character.json";
    envelope.data.state_refs = [
      `.coc/campaigns/${envelope.data.result.campaign_id}`,
      ".coc/investigators/sheet-id/character.json",
    ];
  }],
  ["linked-campaign-dir-mismatch", (envelope, params) => {
    params.arguments.pregen_id = "catalog-slot";
    envelope.data.result.needs_investigator = false;
    envelope.data.result.investigator_id = "sheet-id";
    envelope.data.result.pregen_id = "catalog-slot";
    envelope.data.result.character_path = (
      "/tmp/.coc/investigators/sheet-id/character.json"
    );
    envelope.data.result.campaign_dir = "/tmp/.coc/campaigns/other-campaign";
    envelope.data.state_refs = [
      `.coc/campaigns/${envelope.data.result.campaign_id}`,
      ".coc/investigators/sheet-id/character.json",
    ];
  }],
]) {
  const campaignIdForCase = `${quickStartCampaignId}-${label}`;
  const params = {
    ...quickStartParams,
    arguments: {
      ...quickStartParams.arguments,
      campaign_id: campaignIdForCase,
    },
  };
  const envelope = quickStartEnvelope();
  envelope.data.result.campaign_id = campaignIdForCase;
  envelope.data.result.campaign_dir = `/tmp/.coc/campaigns/${campaignIdForCase}`;
  envelope.data.state_refs = [`.coc/campaigns/${campaignIdForCase}`];
  mutate(envelope, params);
  const rejectedGate = new OpeningTerminalContinuationGate();
  assert.equal(
    rejectedGate.openingSetupToolError(
      "coc_invoke", params, `fresh-quick-start-${label}`,
    ),
    null,
  );
  assert.equal(
    rejectedGate.observeOpeningSetupInvocation(
      "setup.quick_start",
      params,
      envelope,
      `fresh-quick-start-${label}`,
    ).accepted,
    false,
    `${label} quick_start must not hydrate character setup`,
  );
  assert.equal(rejectedGate.hasActiveOpeningSetupFor(campaignIdForCase), false);
}

const freshStarterCampaignId = "fresh-fixed-starter";
const freshStarterGate = new OpeningTerminalContinuationGate();
const freshStarterResumeParams = {
  operation: "session.resume",
  campaign: freshStarterCampaignId,
  arguments: {},
};
assert.equal(
  freshStarterGate.openingSetupToolError(
    "coc_invoke",
    freshStarterResumeParams,
    "fresh-starter-resume",
  ),
  null,
);
assert.equal(
  freshStarterGate.observeOpeningSetupInvocation(
    "session.resume",
    freshStarterResumeParams,
    {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: freshStarterCampaignId,
        mode: "awaiting_player",
        character_creation: {
          status: "incomplete",
          campaign_id: freshStarterCampaignId,
          era: "1920s",
          play_language: "zh-Hans",
          title: "The Haunting",
          briefing_path: (
            ".coc/campaigns/fresh-fixed-starter/assets/character-creation/"
            + "the-haunting-briefing.md"
          ),
          language: "zh-Hans",
        },
      },
    },
    "fresh-starter-resume",
  ).accepted,
  true,
  "the canonical fresh-starter resume receipt must hydrate character setup",
);
assert.equal(freshStarterGate.hasActiveOpeningSetupFor(freshStarterCampaignId), true);
assert.equal(
  freshStarterGate.observeChargenDelegateCompletion(
    freshStarterCampaignId,
    {
      ok: true,
      investigator_id: "inv-fresh-starter",
      characteristics: {},
      derived: {},
      skill_top: [],
    },
  ),
  true,
);
assert.equal(
  freshStarterGate.openingTableDecisionContext().next_operation.operation,
  "setup.complete",
);

const decisionGate = new OpeningTerminalContinuationGate();
decisionGate.openingSetupToolError("coc_invoke", resumeParams, "selection-resume");
decisionGate.observeOpeningSetupInvocation(
  "session.resume",
  resumeParams,
  {
    ok: false,
    tool: "session.resume",
    error: {
      code: "opening_setup_incomplete",
      details: {
        schema_version: 1,
        status: "blocked",
        hard_gate: true,
        activation_allowed: false,
        phase: "opening_selection",
        opening_phase: "opening_selection",
        campaign_id: campaignId,
        next_operation: {
          operation: "progressive.prepare_opening",
          invoke_via: "coc_invoke",
          prefilled_arguments: {},
          missing_arguments: [],
          hard_gate: true,
          authority: "canonical_setup",
        },
      },
    },
  },
  "selection-resume",
);
const decisionContext = decisionGate.openingTableDecisionContext();
assert.equal(decisionContext.player_decision_required, true);
assert.equal(decisionContext.next_operation.operation, "progressive.prepare_opening");
assert.equal(
  decisionGate.bindRetainedOpeningRoute({
    operation: "progressive.prepare_opening",
    arguments: {},
  }).campaign,
  campaignId,
);

console.log("chargen-delegate-opening-completion ok");
