#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const extension = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts")).href
);

const gate = new extension.OpeningTerminalContinuationGate();
gate.observeMessageStart({
  role: "user",
  content: [{ type: "text", text: "请再给我看一次地下室地图。" }],
});

const bound = gate.bindHandoutReplayRequest({
  operation: "state.replay_handout",
  campaign: "camp-1",
  arguments: {
    handout_id: "cellar-map",
    decision_id: "replay-map-1",
    request_assertion: {
      explicit_player_request: true,
      player_text: "请再给我看一次地下室地图。",
      semantic_reason: "玩家明确请求再次展示地下室地图",
    },
  },
});
assert.equal(bound.arguments.request_assertion.player_turn_epoch, 1);
assert.equal(
  bound.arguments.request_assertion.player_text,
  "请再给我看一次地下室地图。",
);

assert.throws(
  () => gate.bindHandoutReplayRequest({
    operation: "state.replay_handout",
    arguments: {
      handout_id: "cellar-map",
      decision_id: "replay-map-stale",
      request_assertion: {
        explicit_player_request: true,
        player_text: "另一条消息",
        semantic_reason: "伪造的不匹配证据",
      },
    },
  }),
  /exact current external player message/,
);

gate.observeMessageStart({ role: "user", content: "刚才那张……" });
assert.throws(
  () => gate.bindHandoutReplayRequest({
    operation: "state.replay_handout",
    arguments: {
      handout_id: "cellar-map",
      decision_id: "replay-map-old-epoch",
      request_assertion: {
        explicit_player_request: true,
        player_text: "请再给我看一次地下室地图。",
        semantic_reason: "旧消息不应被新 epoch 接受",
      },
    },
  }),
  /exact current external player message/,
);

console.log("handout replay provenance: ok");
