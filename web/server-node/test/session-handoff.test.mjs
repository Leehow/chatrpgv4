import test from "node:test";
import assert from "node:assert/strict";

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  mapRpcEventToSse,
  parseSetupHandoffEvent,
  PiCocRpcHost,
  PLAY_TABLE_OPENING_PROMPT,
} from "../pi-coc-rpc.mjs";
import {
  CampaignHostOrchestrator,
  parseSessionRoleStdout,
  SESSION_BUSY_CODE,
  SESSION_TRANSITIONING_CODE,
  transitioningInputError,
} from "../session-handoff.mjs";

function fakeHost({ campaignId = "c1" } = {}) {
  const listeners = new Set();
  const host = {
    campaignId,
    sessionId: `web-${campaignId}`,
    closed: false,
    lastExitCode: null,
    repoRoot: "/tmp/repo",
    workspace: "/tmp/ws",
    agentDir: "",
    launcherPath: "/tmp/pi-coc",
    tableIntent: "character-setup",
    provider: "",
    model: "",
    thinking: "",
    spawnFn: null,
    attached: 0,
    prompted: 0,
    lastPrompt: null,
    readyCalls: 0,
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(event) {
      for (const fn of listeners) fn(event);
    },
    async waitUntilReady() {
      this.readyCalls += 1;
    },
    async attachOpening() {
      this.attached += 1;
      throw new Error("handoff must not attachOpening without prompting play");
    },
    async promptPlayOpening({ onSse } = {}) {
      this.prompted += 1;
      this.lastPrompt = PLAY_TABLE_OPENING_PROMPT;
      onSse?.({ event: "delta", data: { text: "雾中的宅邸在你面前显出轮廓。" } });
      return { opened: true };
    },
    async close() {
      this.closed = true;
      this.emit({ type: "process_exit", code: 0, signal: "SIGTERM" });
    },
  };
  return host;
}

test("parseSetupHandoffEvent reads custom_message details", () => {
  const payload = {
    type: "coc_setup_handoff",
    campaign_id: "haunting-1",
    receipt: { decision_id: "d1" },
    at: "2026-04-08T00:00:00.000Z",
  };
  assert.deepEqual(
    parseSetupHandoffEvent({
      type: "custom_message",
      customType: "coc_setup_handoff",
      details: payload,
    }),
    payload,
  );
  assert.deepEqual(
    mapRpcEventToSse({
      type: "custom_message",
      customType: "coc_setup_handoff",
      content: JSON.stringify(payload),
      details: payload,
    }),
    [{ event: "coc_setup_handoff", data: payload }],
  );
});

test("handoff event path: spawn + attach + role flip", async () => {
  const created = [];
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = fakeHost({ campaignId: opts.campaignId });
      host.tableIntent = opts.tableIntent;
      created.push(host);
      return host;
    },
    resolveRoleFn: async () => "play",
  });
  await orchestrator.acquire("haunting-1", { tableIntent: "character-setup" });
  assert.equal(created.length, 1);

  created[0].emit({
    type: "custom_message",
    customType: "coc_setup_handoff",
    details: {
      type: "coc_setup_handoff",
      campaign_id: "haunting-1",
      receipt: { decision_id: "setup.complete" },
      at: "2026-04-08T12:00:00.000Z",
    },
  });

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(created.length, 2);
  assert.equal(created[0].closed, true);
  assert.equal(created[1].prompted, 0);
  assert.equal(created[1].attached, 0);
  assert.equal(created[1].tableIntent, "continue");
  assert.deepEqual(orchestrator.statusOf("haunting-1"), {
    session_role: "play",
    transitioning: true,
  });
  const frames = [];
  await orchestrator.completeHandoffOpening("haunting-1", {
    onSse: (frame) => frames.push(frame),
  });
  assert.equal(created[1].prompted, 1);
  assert.equal(created[1].attached, 0);
  assert.equal(created[1].lastPrompt, PLAY_TABLE_OPENING_PROMPT);
  assert.deepEqual(frames, [
    { event: "delta", data: { text: "雾中的宅邸在你面前显出轮廓。" } },
  ]);
  assert.deepEqual(orchestrator.statusOf("haunting-1"), {
    session_role: "play",
    transitioning: false,
  });
  assert.equal(orchestrator.getHost("haunting-1"), created[1]);
});

test("exit code 42 fallback starts the same handoff", async () => {
  const created = [];
  let resolveCalls = 0;
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = fakeHost({ campaignId: opts.campaignId });
      created.push(host);
      return host;
    },
    resolveRoleFn: async () => {
      resolveCalls += 1;
      return "play";
    },
  });
  await orchestrator.acquire("c42", { tableIntent: "character-setup" });
  created[0].emit({ type: "process_exit", code: 42, signal: null });
  created[0].closed = true;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(created.length, 2);
  assert.equal(created[1].prompted, 0);
  assert.equal(created[1].attached, 0);
  assert.equal(resolveCalls, 1);
  assert.deepEqual(orchestrator.statusOf("c42"), {
    session_role: "play",
    transitioning: true,
  });
  await orchestrator.completeHandoffOpening("c42");
  assert.equal(created[1].prompted, 1);
  assert.equal(created[1].attached, 0);
  assert.deepEqual(orchestrator.statusOf("c42"), {
    session_role: "play",
    transitioning: false,
  });
});

test("player input is rejected while transitioning", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => fakeHost({ campaignId: opts.campaignId }),
    attachFn: async () => gate,
    resolveRoleFn: async () => "play",
  });
  await orchestrator.acquire("c-in", { tableIntent: "character-setup" });
  const pending = orchestrator.completeHandoffOpening("c-in", { reason: "event" });
  assert.equal(orchestrator.isTransitioning("c-in"), true);
  const err = transitioningInputError();
  assert.equal(err.code, SESSION_TRANSITIONING_CODE);
  assert.equal(err.status, 409);
  assert.throws(
    () => orchestrator.assertAcceptsPlayerInput("c-in"),
    (caught) => caught.code === SESSION_TRANSITIONING_CODE,
  );
  release();
  await pending;
  orchestrator.assertAcceptsPlayerInput("c-in");
});

test("opening attach failure preserves the exact handoff error", async () => {
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => fakeHost({ campaignId: opts.campaignId }),
    attachFn: async () => {
      throw new Error("play respawn lost RPC readiness");
    },
    resolveRoleFn: async () => "play",
  });
  await orchestrator.acquire("broken", { tableIntent: "character-setup" });
  await assert.rejects(
    () => orchestrator.completeHandoffOpening("broken", { reason: "exit_42" }),
    (err) => {
      assert.equal(err.code, "session_handoff_failed");
      assert.equal(
        err.message,
        "建卡到开桌交接失败：play respawn lost RPC readiness",
      );
      return true;
    },
  );
});

test("same campaign refuses a second live child", async () => {
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => fakeHost({ campaignId: opts.campaignId }),
    resolveRoleFn: async () => "play",
  });
  await orchestrator.acquire("solo", { tableIntent: "setup" });
  await assert.rejects(
    () => orchestrator.acquire("solo", { tableIntent: "play" }, { reuse: false, exclusive: true }),
    (err) => err.code === SESSION_BUSY_CODE,
  );
  assert.equal(orchestrator.hosts.size, 1);
});

test("parseSessionRoleStdout reads play from JSON or token", () => {
  assert.equal(parseSessionRoleStdout('{"role":"play","status":"ready_for_table"}'), "play");
  assert.equal(parseSessionRoleStdout("play"), "play");
});

function fakeRpcChild({ prompts } = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter();
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = () => child.emit("exit", 0, null);
  stdin.on("data", (chunk) => {
    for (const line of String(chunk).split("\n")) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.type === "get_state") {
        stdout.write(`${JSON.stringify({
          id: msg.id,
          type: "response",
          command: "get_state",
          success: true,
        })}\n`);
        continue;
      }
      if (msg.type === "prompt") {
        prompts?.push(msg);
        stdout.write(`${JSON.stringify({
          id: msg.id,
          type: "response",
          command: "prompt",
          success: true,
        })}\n`);
        stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
        stdout.write(`${JSON.stringify({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "宅邸的门缝里漏出一丝冷光。" },
        })}\n`);
        stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
      }
    }
  });
  return child;
}

test("respawned play child receives opening prompt and agent_start", async () => {
  const setupPrompts = [];
  const playPrompts = [];
  const children = [];
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => new PiCocRpcHost({
      ...opts,
      repoRoot: "/tmp/missing-repo",
      workspace: "/tmp/ws",
      launcherPath: process.execPath,
      spawnFn: () => {
        const prompts = children.length === 0 ? setupPrompts : playPrompts;
        const child = fakeRpcChild({ prompts });
        children.push(child);
        return child;
      },
    }),
    resolveRoleFn: async () => "play",
  });

  await orchestrator.acquire("rpc-order", { tableIntent: "character-setup" });
  assert.equal(children.length, 1);
  orchestrator.getHost("rpc-order").child.emit("exit", 42, null);

  const frames = [];
  await orchestrator.completeHandoffOpening("rpc-order", {
    reason: "exit_42",
    onSse: (frame) => frames.push(frame),
  });

  assert.equal(children.length, 2);
  assert.equal(setupPrompts.length, 0);
  assert.equal(playPrompts.length, 1);
  assert.equal(playPrompts[0].type, "prompt");
  assert.equal(playPrompts[0].message, PLAY_TABLE_OPENING_PROMPT);
  assert.deepEqual(frames, [
    { event: "delta", data: { text: "宅邸的门缝里漏出一丝冷光。" } },
  ]);
  assert.deepEqual(orchestrator.statusOf("rpc-order"), {
    session_role: "play",
    transitioning: false,
  });
});
