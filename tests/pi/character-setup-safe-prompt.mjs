import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const {
  OpeningTerminalContinuationGate,
  chargenDelegateSchema,
  shouldTriggerOpeningSetupContinuation,
} = await import(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts")
);

assert.equal(chargenDelegateSchema.properties.occupation_skill_names.type, "array");
assert.equal(chargenDelegateSchema.properties.occupation_skill_names.items.type, "string");
assert.equal(chargenDelegateSchema.properties.occupation_skill_names.items.minLength, 1);
assert.equal(chargenDelegateSchema.properties.occupation_skill_names.items.enum, undefined);
assert.ok(chargenDelegateSchema.properties.mode.enum.includes("era_adaptive"));

const campaignId = "safe-character-setup";
const sourceReviewCampaignId = "source-review-before-guidance";

const sourceReviewGate = new OpeningTerminalContinuationGate();
const sourceResumeParams = {
  operation: "session.resume",
  campaign: sourceReviewCampaignId,
  arguments: {},
};
assert.equal(
  sourceReviewGate.openingSetupToolError(
    "coc_invoke", sourceResumeParams, "source-review-resume",
  ),
  null,
);
assert.equal(
  sourceReviewGate.observeOpeningSetupInvocation(
    "session.resume",
    sourceResumeParams,
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
          phase: "opening_source_review_required",
          campaign_id: sourceReviewCampaignId,
          scenario_id: "source-review-scenario",
          source_provenance: "selection_hint_only_not_provenance",
          required_source_owner: "coc-opening-source-coordinator",
          opening_review_generation: 1,
          character_setup_complete: false,
          next_operation: null,
          instruction: "wait for canonical source review",
        },
      },
    },
    "source-review-resume",
  ).accepted,
  true,
);
assert.equal(
  sourceReviewGate.acceptVisibleAssistantFinal(
    "例如做一位 1920 年代波士顿的古董商。",
  ),
  false,
  "era-specific guidance must stay hidden until source facts are adopted",
);

const gate = new OpeningTerminalContinuationGate();
const resumeParams = {
  operation: "session.resume",
  campaign: campaignId,
  arguments: {},
};
const invocationId = "safe-character-setup-resume";

assert.equal(
  gate.openingSetupToolError("coc_invoke", resumeParams, invocationId),
  null,
  "incomplete character setup resume must be admitted",
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
          instruction: "complete the retained character creation route",
        },
      },
    },
    invocationId,
  ).accepted,
  true,
  "incomplete setup state must hydrate",
);

// Guided setup is a player conversation owned by the live KP. The transcript
// gate must not replace a natural one-question-at-a-time prompt with hidden
// host/tool instructions; the setup host prompt and typed chargen tool own the
// eventual confirmed write.
gate.observeMessageStart({
  role: "user",
  content: [{
    type: "text",
    text: "我选择预设卡林晓，不修改，直接创建。",
  }],
});
const safeDecision = gate.acceptVisibleAssistantFinal("好的，请确认职业和技能。");
assert.equal(
  safeDecision,
  true,
  "guided character questions must remain player-visible verbatim",
);

// A successful investigator contract is evidence that the KP may now ask a
// source/era-safe creation question. It must authorize the KP's wording, not
// replace that wording with a fixed host sentence.
const contractGate = new OpeningTerminalContinuationGate();
contractGate.observeMessageStart({
  role: "user",
  content: [{ type: "text", text: "开始为这份模组创建调查员。" }],
});
assert.equal(
  contractGate.openingSetupToolError(
    "coc_invoke", resumeParams, "contract-guidance-resume",
  ),
  null,
);
assert.equal(
  contractGate.observeOpeningSetupInvocation(
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
          instruction: "complete the retained character creation route",
        },
      },
    },
    "contract-guidance-resume",
  ).accepted,
  true,
);
const contractParams = {
  operation: "setup.investigator_contract",
  campaign: campaignId,
  arguments: { campaign_id: campaignId },
};
assert.equal(
  contractGate.openingSetupToolError(
    "coc_invoke", contractParams, "contract-guidance-contract",
  ),
  null,
);
assert.equal(
  contractGate.observeOpeningSetupInvocation(
    "setup.investigator_contract",
    contractParams,
    {
      ok: true,
      tool: "setup.investigator_contract",
      data: {
        schema_version: 1,
        status: "PASS",
        kind: "investigator.contract",
        result: {
          ruleset_id: "coc7",
          payload_schema: { type: "object" },
        },
      },
    },
    "contract-guidance-contract",
  ).accepted,
  true,
);
const immersiveGuidance = (
  "煤烟压在伦敦屋脊上。你想先告诉我这位调查员的名字，"
  + "还是先说他靠什么本领在这座城里立足？"
);
assert.equal(
  contractGate.acceptVisibleAssistantFinal(immersiveGuidance),
  true,
  "investigator contract must preserve immersive KP guidance verbatim",
);
assert.equal(
  shouldTriggerOpeningSetupContinuation(true),
  false,
  "a visible guided question must not queue another hidden setup turn",
);
assert.equal(
  shouldTriggerOpeningSetupContinuation(false),
  true,
  "a suppressed premature answer must still force the retained setup route",
);
assert.equal(
  shouldTriggerOpeningSetupContinuation({
    replacementText: "调查员已正式加入战役。",
    triggerSetupContinuation: true,
  }),
  true,
  "an exact setup receipt may explicitly request the next retained route",
);

const hostSystem = await readFile(
  path.join(root, "plugins/coc-keeper/pi/prompts/host-system-setup.md"),
  "utf8",
);
for (const expected of [
  "Default guided character path",
  "one more meaningful creation question",
  "coc_chargen_delegate",
  "complete player-visible draft",
]) {
  assert.ok(hostSystem.includes(expected), `host system is missing ${expected}`);
}

process.stdout.write(JSON.stringify({
  ok: true,
  guidedPromptPreserved: true,
  hostCharacterPathComplete: true,
}));
