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
      { name: "First Aid", value: 70 },
      { name: "Spot Hidden", value: 65 },
      { name: "Library Use", value: 60 },
      { name: "Listen", value: 55 },
      { name: "Persuade", value: 50 },
      { name: "Psychology", value: 45 },
      { name: "Art and Craft (Acting)", value: 40 },
    ],
  }, {
    name: "马库斯",
    age: 32,
    occupation_or_concept: "百夫长",
    mode: "era_adaptive",
  }),
  true,
  "a successful aggregate chargen result must close the in-memory gate",
);
const playerSummary = gate.acceptVisibleAssistantFinal("");
assert.match(playerSummary.replacementText, /马库斯（32岁，百夫长）/);
assert.match(playerSummary.replacementText, /力量 80；敏捷 70；体质 60/);
assert.match(playerSummary.replacementText, /生命值 11；魔法值 10；理智 60；幸运 45/);
assert.match(playerSummary.replacementText, /母语 75；急救 70；侦查 65；图书馆使用 60/);
assert.match(playerSummary.replacementText, /聆听 55；说服 50；心理学 45；艺术与手艺（表演） 40/);
assert.doesNotMatch(
  playerSummary.replacementText,
  /\b(?:STR|DEX|CON|POW|APP|EDU|SIZ|INT|HP|MP|SAN)\b|Language \(Own\)|First Aid|Spot Hidden|Library Use|Listen|Persuade|Psychology|Art and Craft/,
);
assert.match(playerSummary.replacementText, /确认打开游戏桌/);
assert.equal(
  gate.acceptVisibleAssistantFinal("调查员卡已写入。"),
  false,
  "completed aggregate chargen must not re-inject investigator.create",
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
