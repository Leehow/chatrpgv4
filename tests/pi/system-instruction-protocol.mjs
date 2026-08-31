#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const protocol = await import(path.join(
  root,
  "plugins/coc-keeper/pi/lib/system-instruction.ts",
));

const sent = [];
const commands = new Map();
const pi = {
  registerCommand(name, options) { commands.set(name, options); },
  sendMessage(message, options) { sent.push({ message, options }); },
};

const wrapped = protocol.sendCocSystemInstruction(pi, {
  sourceType: "coc-mechanical-output-gate",
  customType: "coc-mechanical-output-gate",
  instruction: "只补齐缺失的 finalization。",
  context: {
    contract_id: "coc.pi-settled-output-gate.v1",
    kind: "settled_output_gate",
    player_turn_epoch: 7,
  },
}, { triggerTurn: true, deliverAs: "followUp" });
assert.equal(wrapped.contract_id, "coc.pi-system-instruction.v1");
assert.equal(wrapped.player_input, false);
assert.equal(wrapped.journal_policy, "never");
assert.equal(wrapped.context_kind, "settled_output_gate");
assert.equal(
  wrapped.context_contract_id,
  "coc.pi-settled-output-gate.v1",
);
assert.equal(wrapped.player_turn_epoch, 7);
assert.equal(sent[0].message.customType, "coc-mechanical-output-gate");
assert.equal(JSON.parse(sent[0].message.content).instruction, wrapped.instruction);

const branch = [
  {
    type: "message",
    message: {
      role: "user",
      content: [{ type: "text", text: "我背靠墙盯着那张床。" }],
    },
  },
  {
    type: "message",
    message: {
      role: "custom",
      customType: "coc-system-instruction",
      content: JSON.stringify(wrapped),
    },
  },
  {
    type: "message",
    message: { role: "assistant", content: [{ type: "thinking", thinking: "..." }] },
  },
];
assert.equal(
  protocol.latestExternalUserText(branch),
  "我背靠墙盯着那张床。",
);
assert.deepEqual(
  protocol.recoveredOpenTurnPlayerText(
    { rows: [{ tool: "sanity.context", ok: true }] },
    "我背靠墙盯着那张床。",
  ),
  {
    text: "我背靠墙盯着那张床。",
    source: "pi_session_branch",
  },
);
assert.deepEqual(
  protocol.recoveredOpenTurnPlayerText(
    { player_input_text: "canonical player text" },
    "stale branch text",
  ),
  {
    text: "canonical player text",
    source: "canonical_current_turn",
  },
);

let rebound = null;
protocol.registerCocSystemInstructionCommand(pi, {
  beforeDispatch(instruction, context) {
    rebound = {
      instruction,
      playerText: protocol.latestExternalUserText(
        context.sessionManager.getBranch(),
      ),
    };
  },
});
assert.ok(commands.has("system"));
await commands.get("system").handler(
  "恢复当前未结算回合，只补缺失写入。",
  {
    isIdle: () => true,
    sessionManager: { getBranch: () => branch },
    ui: { notify() {} },
  },
);
assert.deepEqual(rebound, {
  instruction: "恢复当前未结算回合，只补缺失写入。",
  playerText: "我背靠墙盯着那张床。",
});
const commandMessage = sent.at(-1);
assert.equal(
  commandMessage.message.customType,
  protocol.COC_SYSTEM_INSTRUCTION_CUSTOM_TYPE,
);
assert.deepEqual(commandMessage.options, { triggerTurn: true });
const commandEnvelope = JSON.parse(commandMessage.message.content);
assert.equal(commandEnvelope.source_type, "operator_command");
assert.equal(commandEnvelope.player_input, false);
assert.equal(commandEnvelope.journal_policy, "never");
assert.deepEqual(
  protocol.cocSystemInstructionOperations("play"),
  [
    "session.resume",
    "scene.context",
    "state.move_scene",
    "state.journal",
    "turn.output_context",
    "narration.review",
    "turn.finalize",
  ],
);
assert.ok(
  !protocol.cocSystemInstructionOperations("play")
    .some((operation) => operation.startsWith("rules.")),
);

let dispatchError = null;
protocol.registerCocSystemInstructionCommand({
  registerCommand(name, options) { commands.set(`${name}-failure`, options); },
  sendMessage() { throw new Error("dispatch failed"); },
}, {
  onDispatchError(instruction, _context, error) {
    dispatchError = { instruction, message: error.message };
  },
});
await assert.rejects(
  commands.get("system-failure").handler(
    "恢复工具域。",
    { isIdle: () => true, ui: { notify() {} } },
  ),
  /dispatch failed/,
);
assert.deepEqual(dispatchError, {
  instruction: "恢复工具域。",
  message: "dispatch failed",
});

const debugSent = [];
const debugCommands = new Map();
const debugNotifications = [];
const debugDispatches = [];
let ordinaryBeforeDispatches = 0;
protocol.registerCocSystemInstructionCommand({
  registerCommand(name, options) { debugCommands.set(name, options); },
  sendMessage(message, options) { debugSent.push({ message, options }); },
}, {
  beforeDispatch() { ordinaryBeforeDispatches += 1; },
  async hostControl(command, context) {
    debugDispatches.push({ command, cwd: context.cwd });
    return { status: "started", experiment_id: "debug-haunting-r1" };
  },
});
const debugContext = {
  cwd: "/tmp/pi-coc-debug-host",
  isIdle: () => true,
  ui: {
    notify(message, level) { debugNotifications.push({ message, level }); },
  },
};
await debugCommands.get("system").handler(
  'debug run {"player_input":"我检查伤口。"}',
  debugContext,
);
assert.deepEqual(debugDispatches, [{
  command: 'run {"player_input":"我检查伤口。"}',
  cwd: "/tmp/pi-coc-debug-host",
}]);
assert.equal(debugSent.length, 0);
assert.equal(ordinaryBeforeDispatches, 0);
assert.deepEqual(debugNotifications, [{
  message: "Debug experiment started: debug-haunting-r1",
  level: "info",
}]);

await debugCommands.get("system").handler("debugx 保持普通系统指令", debugContext);
assert.equal(debugSent.length, 1);
assert.equal(ordinaryBeforeDispatches, 1);
assert.equal(
  JSON.parse(debugSent[0].message.content).instruction,
  "debugx 保持普通系统指令",
);

const unavailableSent = [];
const unavailableCommands = new Map();
const unavailableNotifications = [];
protocol.registerCocSystemInstructionCommand({
  registerCommand(name, options) { unavailableCommands.set(name, options); },
  sendMessage(message) { unavailableSent.push(message); },
});
await unavailableCommands.get("system").handler("debug status current", {
  isIdle: () => true,
  ui: {
    notify(message, level) {
      unavailableNotifications.push({ message, level });
    },
  },
});
assert.equal(unavailableSent.length, 0);
assert.deepEqual(unavailableNotifications, [{
  message: "/system debug is unavailable in this host.",
  level: "warning",
}]);

for (const prompt of [
  "host-system.md",
  "host-system-setup.md",
  "host-system-play.md",
]) {
  const text = readFileSync(path.join(
    root,
    "plugins/coc-keeper/pi/prompts",
    prompt,
  ), "utf8");
  assert.match(text, /coc\.pi-system-instruction\.v1/);
  assert.match(text, /player_input=false/);
  assert.match(text, /journal_policy=never/);
}

console.log(JSON.stringify({
  ok: true,
  command: "/system",
  customType: protocol.COC_SYSTEM_INSTRUCTION_CUSTOM_TYPE,
  contract: protocol.COC_SYSTEM_INSTRUCTION_CONTRACT_ID,
}));
