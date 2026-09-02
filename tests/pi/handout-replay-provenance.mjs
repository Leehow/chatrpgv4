#!/usr/bin/env node
// The embedded Pi runtime must resolve before any extension module is
// imported; without it this file cannot load tool-render.ts at all.
import "./_lib/preload-embedded-pi.mjs";
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

const failedCanonicalAttempt = gate.bindHandoutReplayRequest({
  operation: "state.replay_handout",
  campaign: "camp-1",
  arguments: {
    handout_id: "cellar-map",
    decision_id: "replay-map-invalid-first-attempt",
    request_assertion: {
      explicit_player_request: false,
      player_text: "请再给我看一次地下室地图。",
      semantic_reason: "canonical toolbox will reject this assertion",
    },
  },
});
assert.equal(
  failedCanonicalAttempt.arguments.request_assertion.player_turn_epoch,
  1,
);

const correctedSameMessage = gate.bindHandoutReplayRequest({
  operation: "state.replay_handout",
  campaign: "camp-1",
  arguments: {
    handout_id: "cellar-map",
    decision_id: "replay-map-corrected-same-message",
    request_assertion: {
      explicit_player_request: true,
      player_text: "请再给我看一次地下室地图。",
      semantic_reason: "玩家明确请求再次展示地下室地图",
    },
  },
});
assert.equal(correctedSameMessage.arguments.request_assertion.player_turn_epoch, 1);
assert.equal(
  correctedSameMessage.arguments.request_assertion.player_text,
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

gate.observeMessageStart({
  role: "user",
  content: [{ type: "text", text: "刚才那张……" }],
});
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

const later = gate.bindHandoutReplayRequest({
  operation: "state.replay_handout",
  arguments: {
    handout_id: "cellar-map",
    decision_id: "replay-map-later-epoch",
    request_assertion: {
      explicit_player_request: true,
      player_text: "刚才那张……",
      semantic_reason: "玩家在后续回合明确补全了同一地图请求",
    },
  },
});
assert.equal(later.arguments.request_assertion.player_turn_epoch, 2);

console.log("handout replay provenance: ok");
