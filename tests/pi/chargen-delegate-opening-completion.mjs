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
assert.equal(
  gate.openingSetupToolError("coc_invoke", completeParams, "starter-complete"),
  null,
);
assert.equal(
  gate.observeOpeningSetupInvocation(
    "setup.complete",
    completeParams,
    {
      ok: true,
      tool: "setup.complete",
      data: {
        result: {
          campaign_id: campaignId,
          ready_for_table: true,
          handoff: {
            schema_version: 1,
            campaign_id: campaignId,
            decision_id: completeParams.arguments.decision_id,
          },
        },
      },
    },
    "starter-complete",
  ).accepted,
  true,
);
assert.equal(gate.hasActiveOpeningSetupFor(campaignId), false);

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
