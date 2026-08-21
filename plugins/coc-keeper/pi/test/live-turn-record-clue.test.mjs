#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const domainUrl = pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/domain-tools.ts"),
).href;
const playPrompt = readFileSync(
  path.join(root, "plugins/coc-keeper/pi/prompts/host-system-play.md"),
  "utf8",
);
const storyGraph = JSON.parse(
  readFileSync(
    path.join(
      root,
      "plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json",
    ),
    "utf8",
  ),
);

function scene(id) {
  return storyGraph.scenes.find((row) => row.scene_id === id);
}

test("live_turn play exposes coc_state_record_clue and White War routes grant clue_id", async () => {
  const mod = await import(`${domainUrl}?t=${Date.now()}-${Math.random()}`);
  const tools = mod.activeToolsForPhase("live_turn", "play");
  assert.ok(tools.includes("coc_state_record_clue"));
  assert.equal(
    mod.evaluateExecuteAcl({
      toolName: "coc_state_record_clue",
      operation: "state.record_clue",
      phase: "live_turn",
      role: "play",
    }).ok,
    true,
  );
  assert.ok(playPrompt.includes("coc_state_record_clue"));
  assert.ok(playPrompt.includes("**before prose**"));
  assert.equal(
    playPrompt.includes("never leave a player-visible find only in narration"),
    true,
  );

  const saddle = scene("crossing-saddle");
  const saddleRoute = saddle.affordances.find(
    (row) => row.id === "scout-austrian-line-from-saddle",
  );
  assert.deepEqual(saddleRoute.grants_clue_ids, ["clue-hasty-abandonment"]);

  const austrian = scene("austrian-positions");
  const austrianRoute = austrian.affordances.find(
    (row) => row.id === "observe-positions-through-glass",
  );
  assert.deepEqual(austrianRoute.grants_clue_ids, [
    "clue-hasty-abandonment",
    "clue-guns-turned-inward",
  ]);
});
