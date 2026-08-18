import test from "node:test";
import assert from "node:assert/strict";

import {
  mapRpcEventToSse,
  parseSetupHandoffEvent,
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
    attachFn: async (host) => host.attachOpening(),
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
  assert.equal(created[1].attached, 1);
  assert.equal(created[1].tableIntent, "continue");
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
    attachFn: async (host) => host.attachOpening(),
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
  assert.equal(created[1].attached, 1);
  assert.equal(resolveCalls, 1);
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
  const pending = orchestrator.beginHandoff("c-in", { reason: "event" });
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
