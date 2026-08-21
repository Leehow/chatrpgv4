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

test("live_turn play exposes coc_state_item_grant and play prompt requires before prose", async () => {
  const mod = await import(`${domainUrl}?t=${Date.now()}-${Math.random()}`);
  const tools = mod.activeToolsForPhase("live_turn", "play");
  assert.ok(tools.includes("coc_state_item_grant"));
  assert.equal(
    mod.evaluateExecuteAcl({
      toolName: "coc_state_item_grant",
      operation: "state.item_grant",
      phase: "live_turn",
      role: "play",
    }).ok,
    true,
  );
  assert.ok(playPrompt.includes("coc_state_item_grant"));
  assert.ok(playPrompt.includes("**before prose**"));
  assert.ok(playPrompt.includes("One grant per item, unique `decision_id` each"));
});
