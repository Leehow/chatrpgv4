#!/usr/bin/env node
// The step table is the single source of truth for onboarding sequencing.
// These assertions pin the two properties the old path kept violating:
// the tool surface and the refusal wording come from the same row, and a
// step is complete only when its canonical receipt is on disk.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const dir = path.join(root, "plugins/coc-keeper/pi/extensions/onboarding");
const { STEPS, applicableSteps, currentStep, activeTools, refusal } = await import(
  pathToFileURL(path.join(dir, "steps.ts")).href
);

const base = {
  root, campaignId: "probe", isStarter: false, starterId: null,
  bundlePath: null, sourceTitle: null, scenarioId: null, playLanguage: "zh-Hans",
  source: null, campaignExists: false, scenarioBound: false,
  factsAdopted: false, briefingPath: null, investigatorId: null, investigatorLinked: false,
  readyForTable: false,
};
const s = (over) => ({ ...base, ...over });

// A fresh run starts by asking the player, and nothing else is legal yet.
assert.equal(currentStep(s({})).id, "choose-source");
assert.deepEqual([...activeTools(s({}))], ["coc_setup_inspect"]);

// The starter path skips the whole source half rather than pretending to run it.
const starter = s({ isStarter: true, starterId: "the-haunting", source: "the-haunting" });
const starterIds = applicableSteps(starter).map((step) => step.id);
assert.ok(!starterIds.includes("build-bundle"));
assert.ok(!starterIds.includes("bind-source"));
assert.equal(currentStep(starter).id, "create-campaign");

// A PDF run must build a bundle before it may bind one.
const pdf = s({ source: "/w/.coc/module-library/m", sourceTitle: "M" });
assert.equal(currentStep(pdf).id, "build-bundle");
assert.deepEqual([...activeTools(pdf)], [], "nothing at the table advances an external producer");

// A PDF run reaches the briefing once the bundle is bound. Nothing between
// bind and briefing reads the source: the module graph is the only thing
// allowed to do that, and it is not a step in this table.
const bound = s({
  source: "/w/b", bundlePath: "/w/b", campaignExists: true, scenarioBound: true,
});
assert.equal(currentStep(bound).id, "briefing");

// Every step's own action tool is in its own tool list. A row that instructs a
// call it does not permit is the exact defect this table exists to prevent.
for (const step of STEPS) {
  if (step.action.kind !== "operation") continue;
  assert.ok(
    step.tools.includes(step.action.tool),
    `step ${step.id} performs ${step.action.tool} but does not allow it`,
  );
}

// A refusal names the current step and repeats its instruction, so the wording
// cannot drift from the surface.
const text = refusal(bound, "coc_turn_finalize");
assert.ok(text.includes("briefing"), text);
assert.ok(text.includes(currentStep(bound).say(bound)), "the refusal carries the step's own instruction");

// Finished onboarding offers nothing and says so.
const finished = s({
  source: "x", bundlePath: "/w/b", campaignExists: true, scenarioBound: true,
  factsAdopted: true, briefingPath: "/w/b.md",
  investigatorId: "inv-x", investigatorLinked: true, readyForTable: true,
});
assert.equal(currentStep(finished), null);
assert.deepEqual([...activeTools(finished)], []);
assert.ok(refusal(finished, "coc_setup_invoke").includes("已经完成"));

// The handoff receipt outranks upstream ones: a campaign an older path built
// carries no briefing receipt, and must still read as finished rather than
// being sent back to re-render a briefing for a table already playing.
assert.equal(
  currentStep(s({ source: "x", campaignExists: true, investigatorLinked: true, readyForTable: true })),
  null,
);

// Every tool the table names must exist on the extension's own surface. The
// old path's most common failure was an instruction naming a tool the session
// did not carry, and this is the assertion that makes that unrepresentable.
const source = await readFile(path.join(dir, "index.ts"), "utf8");
const registered = new Set([
  ...[...source.matchAll(/\{ tool: "([a-z_]+)"/g)].map((m) => m[1]),
  "onboarding_choose_source",
  // Supplied by the subagent plugin and the host's own built-ins.
  "subagent", "subagent_status", "subagent_result", "await_subagent",
]);
for (const step of STEPS) {
  for (const tool of step.tools) {
    assert.ok(registered.has(tool), `step ${step.id} names unregistered tool ${tool}`);
  }
}

// A step that has to follow a method must name a document that exists, because
// the session has no `read` tool: the extension delivers the text, and a path
// the Keeper cannot open is the same defect as an instruction naming a tool it
// does not carry.
const chargen = STEPS.find((step) => step.id === "create-investigator");
assert.equal(
  chargen.guide,
  "docs/methods/immersive-character-creation.md",
  "character creation follows a written method, not the model's recollection",
);
for (const step of STEPS) {
  if (step.guide === undefined) continue;
  const text = await readFile(path.join(root, step.guide), "utf8");
  assert.ok(text.trim().length > 0, `${step.id} names an empty method document`);
  assert.ok(
    !/照\s*docs\//.test(step.say(base)),
    `${step.id} must carry its method, not point at a path the session cannot open`,
  );
}

// The opening-fast-facts review is deliberately absent: it read three pages of
// a twenty-page module and answered six fields while the book's real structure
// sat untouched in an exact-confidence outline. Reading the source belongs to
// the module graph, and no step here may quietly grow that job back.
for (const step of STEPS) {
  assert.ok(
    !step.tools.some((tool) => /adopt_source_facts|subagent|capabilities/.test(tool)),
    `${step.id} carries a source-review tool; that path is retired`,
  );
  assert.ok(step.action.kind !== "subagent", `${step.id} dispatches a subagent`);
}

console.log(JSON.stringify({ ok: true, module: "onboarding-step-table" }));
