import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const { OpeningTerminalContinuationGate } = await import(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts")
);

const campaignId = "safe-character-setup";
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

// The host does not classify player free prose. It preserves the player turn,
// then the SAFE replacement directs the KP's next tool turn to the canonical
// contract/create path rather than issuing a second confirmation request.
gate.observeMessageStart({
  role: "user",
  content: [{
    type: "text",
    text: "我选择预设卡林晓，不修改，直接创建。",
  }],
});
const safeDecision = gate.acceptVisibleAssistantFinal("好的，请确认职业和技能。");
assert.equal(typeof safeDecision, "object");
assert.equal(safeDecision?.triggerSetupContinuation, true);
const safePrompt = safeDecision?.replacementText ?? "";
for (const expected of [
  "coc-character",
  "setup.investigator_contract",
  "payload_schema",
  "investigator.create",
  "不要再次向玩家索要职业、特征或技能确认",
]) {
  assert.ok(safePrompt.includes(expected), `SAFE prompt is missing ${expected}`);
}
assert.equal(
  safePrompt.includes("请继续确认调查员的职业、特征与技能"),
  false,
  "SAFE prompt must not restore the old repeat-confirmation wording",
);

const hostSystem = await readFile(
  path.join(root, "plugins/coc-keeper/pi/prompts/host-system.md"),
  "utf8",
);
for (const expected of [
  "`coc-character`",
  "contract → create",
  "without asking for that selection a\n  second time",
  "`stats_ref` is a\n  source reference",
  "canonical steward\n  delivery/notebook",
]) {
  assert.ok(hostSystem.includes(expected), `host system is missing ${expected}`);
}

process.stdout.write(JSON.stringify({
  ok: true,
  safePromptActionDirected: true,
  hostCharacterPathComplete: true,
}));
