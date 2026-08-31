#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));
const {
  PiStateClaimCompiler,
  PiStateClaimCompilerFailure,
  canonicalDigest,
  draftParagraphs,
} = await import(path.join(
  root,
  "plugins/coc-keeper/pi/lib/state-claim-compiler.ts",
));

const ROLE_ENV = "COC_PI_SESSION_ROLE";
const CAMPAIGN_ENV = "PI_COC_CAMPAIGN_ID";
const PROFILE_ENV = "COC_PI_ACCEPTANCE_PROFILE";

// This harness drives the root KP extension surface directly. A worker-shell
// PI_SUBAGENT_CHILD=1 would silence applyKpActiveTools/setActiveTools and
// make the active-tool projection unobservable (same guard as
// recovery-kp-guidance.mjs).
delete process.env.PI_SUBAGENT_CHILD;

const exactTextSha256 = (text) => (
  `sha256:${createHash("sha256").update(JSON.stringify(text), "utf8").digest("hex")}`
);

function makeHarness(callTool, compiler = undefined, hostFaults = {}) {
  const tools = new Map();
  const commands = new Map();
  const handlers = new Map();
  const active = [];
  const sent = [];
  const appended = [];
  const notifications = [];
  let aborts = 0;
  let hideRead = false;
  const pi = {
    registerTool(tool) {
      hostFaults.beforeRegisterTool?.(tool);
      tools.set(tool.name, tool);
    },
    registerCommand(name, command) { commands.set(name, command); },
    registerShortcut() {},
    on(type, handler) {
      const rows = handlers.get(type) || [];
      rows.push(handler);
      handlers.set(type, rows);
    },
    appendEntry(type, value) {
      hostFaults.beforeAppendEntry?.(type, value);
      appended.push({ type, value });
    },
    sendMessage(message, options) { sent.push({ message, options }); return true; },
    setActiveTools(names) {
      hostFaults.beforeSetActiveTools?.(names);
      active.push([...names]);
    },
    getAllTools() {
      return [...tools.values()]
        .filter((tool) => !hideRead || tool.name !== "read")
        .map((tool) => ({ name: tool.name, parameters: tool.parameters }));
    },
    getActiveTools() { return active.at(-1) ?? []; },
    getThinkingLevel: () => "off",
  };
  const clientCalls = [];
  main.default(pi, {
    coordinatorEnabled: () => false,
    startupCampaignId: () => null,
    ...(compiler === undefined ? {} : { createStateClaimCompiler: () => compiler }),
    createClient: () => ({
      async callTool(name, params) {
        clientCalls.push({ name, params });
        const result = await callTool(name, params);
        if (
          params.operation === "session.resume"
          && typeof result?.data?.mode !== "string"
        ) {
          return {
            ok: true,
            tool: "session.resume",
            data: {
              mode: "awaiting_player",
              evidence: { table_opening_id: "table-opening:affordance" },
              next_operations: [],
            },
          };
        }
        return result;
      },
      async callToolWithTransportMeta(name, params) {
        return { value: await this.callTool(name, params), transport: null };
      },
      async close() {},
    }),
    ...(hostFaults.dispatchDebugExperiment === undefined
      ? {}
      : { dispatchDebugExperiment: hostFaults.dispatchDebugExperiment }),
  });
  const ctx = {
    cwd: root,
    mode: "rpc",
    model: { provider: "probe", id: "probe" },
    sessionManager: {
      getSessionId: () => "tool-affordance-extension",
      getEntries: () => [],
      getBranch: () => [],
    },
    hasUI: false,
    ui: { notify(message, level) { notifications.push({ message, level }); } },
    abort() { aborts += 1; },
  };
  const emit = async (type, message, eventExtra = {}) => {
    let projected;
    for (const handler of handlers.get(type) || []) {
      projected = await handler({ type, message, ...eventExtra }, ctx);
    }
    return projected;
  };
  const emitAll = async (type, message, eventExtra = {}) => {
    const results = [];
    for (const handler of handlers.get(type) || []) {
      results.push(await handler({ type, message, ...eventExtra }, ctx));
    }
    return results;
  };
  const start = async () => {
    for (const handler of handlers.get("session_start") || []) {
      await handler({ type: "session_start" }, ctx);
    }
  };
  const shutdown = async () => {
    for (const handler of handlers.get("session_shutdown") || []) {
      await handler({ type: "session_shutdown" }, ctx);
    }
  };
  return {
    tools, commands, handlers, active, sent, appended, notifications, clientCalls, ctx, emit, emitAll, start, shutdown,
    get aborts() { return aborts; },
    hideRead() { hideRead = true; },
  };
}

test("/system opens one hidden bounded recovery scope and restores normal tools", async () => {
  await withPlayHarness(async (h) => {
    assert.ok(h.commands.has("system"));
    assert.deepEqual(h.active.at(-1), []);

    await h.commands.get("system").handler(
      "先 session.resume，再对齐当前场景；这不是玩家行动。",
      h.ctx,
    );
    assert.deepEqual(h.active.at(-1), [
      "coc_session_resume",
      "coc_scene_context",
      "coc_state_move_scene",
      "coc_state_journal",
      "coc_turn_output_context",
      "coc_narration_review",
      "coc_turn_finalize",
    ]);
    assert.ok(!h.active.at(-1).some((name) => name.startsWith("coc_rules_")));
    await h.tools.get("coc_session_resume").execute(
      "operator-system-resume",
      {},
      undefined,
      undefined,
      h.ctx,
    );
    const operatorResumeCall = h.clientCalls.findLast((call) => (
      call.params.operation === "session.resume"
      && call.params.campaign === "tool-affordance-campaign"
    ));
    assert.ok(operatorResumeCall);
    assert.equal(
      operatorResumeCall.params.campaign,
      "tool-affordance-campaign",
    );
    assert.equal(operatorResumeCall.params.root, root);

    const projected = await h.emit("message_end", {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "内部恢复完成。" }],
    });
    assert.equal(
      projected.message.content.some((part) => part.type === "text"),
      false,
    );
    assert.ok(h.appended.some((row) => (
      row.type === "coc-system-instruction-result"
      && row.value.status === "completed"
      && row.value.player_input === false
      && row.value.journal_policy === "never"
    )));

    await h.emit("agent_end", null);
    assert.deepEqual(h.active.at(-1), []);
    assert.ok(h.appended.some((row) => (
      row.type === "coc-system-instruction-tool-scope"
      && row.value.status === "closed"
    )));
  });
});

test("/system debug dispatches host-side without model or tool-scope mutation", async () => {
  const dispatches = [];
  const priorAgentHome = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, ".pi", "coc-agent");
  try {
    await withPlayHarness(async (h) => {
      const activeBefore = structuredClone(h.active.at(-1));
      const sentBefore = h.sent.length;
      const scopeRowsBefore = h.appended.filter((row) => (
        row.type === "coc-system-instruction-tool-scope"
      )).length;
      await h.commands.get("system").handler(
        'debug run {"player_input":"我检查伤口。","lanes":[{"id":"production-1","profile":"production"}]}',
        h.ctx,
      );
      assert.equal(h.sent.length, sentBefore);
      assert.deepEqual(h.active.at(-1), activeBefore);
      assert.equal(h.appended.filter((row) => (
        row.type === "coc-system-instruction-tool-scope"
      )).length, scopeRowsBefore);
      assert.deepEqual(dispatches, [{
        command: 'run {"player_input":"我检查伤口。","lanes":[{"id":"production-1","profile":"production"}]}',
        campaignId: "tool-affordance-campaign",
        provider: "probe",
        model: "probe",
        thinking: "off",
      }]);
      assert.deepEqual(h.notifications.at(-1), {
        message: "Debug experiment started: debug-tool-affordance-r1",
        level: "info",
      });
    }, undefined, {
      async dispatchDebugExperiment(command, context) {
        dispatches.push({
          command,
          campaignId: context.campaignId,
          provider: context.provider,
          model: context.model,
          thinking: context.thinking,
        });
        return { status: "started", experiment_id: "debug-tool-affordance-r1" };
      },
    });
  } finally {
    if (priorAgentHome === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = priorAgentHome;
  }
});

async function withPlayHarness(fn, callTool = (_name, params) => (
  params.operation === "session.resume"
    ? {
        ok: true,
        tool: "session.resume",
        data: {
          mode: "awaiting_player",
          evidence: { table_opening_id: "table-opening:affordance" },
          next_operations: [],
        },
      }
    : { ok: true, tool: params.operation, data: {} }
), hostFaults = {}, compiler = undefined) {
  const priorRole = process.env[ROLE_ENV];
  const priorCampaign = process.env[CAMPAIGN_ENV];
  process.env[ROLE_ENV] = "play";
  process.env[CAMPAIGN_ENV] = "tool-affordance-campaign";
  try {
    const harness = makeHarness(callTool, compiler, hostFaults);
    await harness.start();
    const initialResume = await harness.tools.get("coc_invoke").execute(
      "resume-live",
      {
        operation: "session.resume",
        campaign: "tool-affordance-campaign",
        arguments: {},
      },
      undefined,
      undefined,
      harness.ctx,
    );
    await fn(harness, initialResume);
  } finally {
    if (priorRole === undefined) delete process.env[ROLE_ENV];
    else process.env[ROLE_ENV] = priorRole;
    if (priorCampaign === undefined) delete process.env[CAMPAIGN_ENV];
    else process.env[CAMPAIGN_ENV] = priorCampaign;
  }
}

test("Pi host projects a bounded role-manifest set and exact discovery load", async () => {
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我检查通往地下室的门。" }],
    });
    const initial = h.active.at(-1);
    assert.ok(initial.length <= 20);
    assert.ok(initial.includes("read"), JSON.stringify({ initial, appended: h.appended.slice(-3) }));
    assert.ok(initial.includes("coc_source_assets"));
    assert.ok(initial.includes("coc_discover"));
    assert.ok(!initial.includes("coc_state_move_scene"));

    const before = h.clientCalls.length;
    const compact = await h.tools.get("coc_discover").execute(
      "discover-compact", {}, undefined, undefined, h.ctx,
    );
    assert.equal(h.clientCalls.length, before, "no-arg discover must not fetch the archive");
    const compactEnvelope = JSON.parse(compact.content[0].text);
    assert.equal(compactEnvelope.ok, true);
    assert.ok(compactEnvelope.data.namespaces.length > 0);

    const loaded = await h.tools.get("coc_discover").execute(
      "discover-exact",
      { operation: "state.move_scene" },
      undefined,
      undefined,
      h.ctx,
    );
    const loadedEnvelope = JSON.parse(loaded.content[0].text);
    assert.equal(loadedEnvelope.ok, true);
    assert.equal(loadedEnvelope.data.operation_card.operation, "state.move_scene");
    assert.ok(h.active.at(-1).includes("coc_state_move_scene"));
    assert.ok(h.active.at(-1).length <= 20);
    const granted = [...h.active.at(-1)];

    const invalidResult = await h.tools.get("coc_discover").execute(
      "discover-invalid",
      { operation: "state.move_scene", domain: "state" },
      undefined,
      undefined,
      h.ctx,
    );
    const invalidEnvelope = JSON.parse(invalidResult.content[0].text);
    assert.equal(invalidResult.isError, true);
    assert.equal(invalidEnvelope.ok, false);
    assert.equal(invalidEnvelope.isError, true);
    assert.equal(invalidEnvelope.error.code, "invalid_request");
    assert.equal(invalidEnvelope.error.class, "schema_validation");
    assert.equal(invalidEnvelope.error.recoverable_by, "model_next_action");
    assert.equal(invalidEnvelope.error.allowed_next_actions[0].action, "correct_discovery_selector");
    assert.deepEqual(h.active.at(-1), granted);

    const unknownResult = await h.tools.get("coc_discover").execute(
      "discover-unknown",
      { operation: "state.does_not_exist" },
      undefined,
      undefined,
      h.ctx,
    );
    const unknownEnvelope = JSON.parse(unknownResult.content[0].text);
    assert.equal(unknownResult.isError, true);
    assert.equal(unknownEnvelope.isError, true);
    assert.equal(unknownEnvelope.error.code, "unknown_operation");
    assert.equal(unknownEnvelope.error.class, "dynamic_candidate");
    assert.equal(unknownEnvelope.error.allowed_next_actions[0].action, "list_available_namespaces");
    assert.deepEqual(h.active.at(-1), granted);

    const tooLarge = await h.tools.get("coc_discover").execute(
      "discover-state", { domain: "state" }, undefined, undefined, h.ctx,
    );
    const tooLargeEnvelope = JSON.parse(tooLarge.content[0].text);
    assert.equal(tooLarge.isError, true);
    assert.equal(tooLargeEnvelope.ok, false);
    assert.equal(tooLargeEnvelope.isError, true);
    assert.equal(tooLargeEnvelope.error.code, "namespace_too_large");
    assert.equal(tooLargeEnvelope.error.class, "dynamic_candidate");
    assert.equal(tooLargeEnvelope.error.allowed_next_actions[0].action, "select_exact_operation");
    assert.deepEqual(h.active.at(-1), granted);

    h.hideRead();
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我换一种方式继续调查。" }],
    });
    assert.deepEqual(h.active.at(-1), []);
    assert.ok(h.appended.some((row) => (
      row.type === "coc-tool-working-set"
      && row.value.status === "rejected"
    )));
  });
});

test("working-set invalidation requests a sequential replan but stable reads do not", async () => {
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我检查当前场景。" }],
    });

    await h.emit("tool_execution_start", null, {
      toolCallId: "stable-capabilities",
      toolName: "coc_capabilities",
      args: {},
    });
    const stable = await h.tools.get("coc_capabilities").execute(
      "stable-capabilities", {}, undefined, undefined, h.ctx,
    );
    const stableHooks = await h.emitAll("tool_result", null, {
      toolCallId: "stable-capabilities",
      toolName: "coc_capabilities",
      input: {},
      content: stable.content,
      details: stable.details,
      isError: false,
    });
    assert.equal(
      stableHooks.some((hook) => hook?.replan === true),
      false,
      "stable read-only result must not replan",
    );
    assert.equal(
      h.appended.filter((row) => row.type === "coc-tool-working-set-replan").length,
      0,
      "stable read-only result must not append a replan audit",
    );

    await h.emit("tool_execution_start", null, {
      toolCallId: "journal-stage-change",
      toolName: "coc_invoke",
      args: {
        operation: "state.journal",
        campaign: "tool-affordance-campaign",
        arguments: { summary: "记录本轮调查。" },
      },
    });
    const journal = await h.tools.get("coc_invoke").execute(
      "journal-stage-change",
      {
        operation: "state.journal",
        campaign: "tool-affordance-campaign",
        arguments: { summary: "记录本轮调查。" },
      },
      undefined,
      undefined,
      h.ctx,
    );
    const changedHooks = await h.emitAll("tool_result", null, {
      toolCallId: "journal-stage-change",
      toolName: "coc_invoke",
      input: {
        operation: "state.journal",
        campaign: "tool-affordance-campaign",
        arguments: { summary: "记录本轮调查。" },
      },
      content: journal.content,
      details: journal.details,
      isError: false,
    });
    assert.ok(
      changedHooks.some((hook) => hook?.replan === true),
      JSON.stringify({ active: h.active.slice(-4), journal, changedHooks }),
    );
    const replanAudits = h.appended.filter(
      (row) => row.type === "coc-tool-working-set-replan",
    );
    assert.equal(replanAudits.length, 1);
    assert.deepEqual(
      Object.keys(replanAudits[0].value).sort(),
      [
        "after",
        "before",
        "canonical_progress_revision",
        "contract_id",
        "operation",
        "player_turn_epoch",
        "reason",
        "schema_version",
        "stage",
        "status",
        "tool_name",
      ],
    );
    assert.deepEqual({
      schema_version: replanAudits[0].value.schema_version,
      contract_id: replanAudits[0].value.contract_id,
      status: replanAudits[0].value.status,
      reason: replanAudits[0].value.reason,
      tool_name: replanAudits[0].value.tool_name,
      operation: replanAudits[0].value.operation,
      stage: replanAudits[0].value.stage,
      player_turn_epoch: replanAudits[0].value.player_turn_epoch,
      canonical_progress_revision:
        replanAudits[0].value.canonical_progress_revision,
    }, {
      schema_version: 1,
      contract_id: "coc.pi-tool-working-set-replan.v1",
      status: "requested",
      reason: "active_tool_interface_changed",
      tool_name: "coc_invoke",
      operation: "state.journal",
      stage: "journaled",
      player_turn_epoch: 1,
      canonical_progress_revision: 1,
    });
    assert.equal(typeof replanAudits[0].value.before.working_set_revision, "string");
    assert.equal(typeof replanAudits[0].value.after.working_set_revision, "string");
    assert.match(
      replanAudits[0].value.before.active_tool_interface_sha256,
      /^sha256:[0-9a-f]{64}$/u,
    );
    assert.match(
      replanAudits[0].value.after.active_tool_interface_sha256,
      /^sha256:[0-9a-f]{64}$/u,
    );
    assert.notEqual(
      replanAudits[0].value.before.active_tool_interface_sha256,
      replanAudits[0].value.after.active_tool_interface_sha256,
    );
    assert.doesNotMatch(
      JSON.stringify(journal.content),
      /coc\.pi-tool-working-set-replan|active_tool_interface_sha256/u,
      "host audit identity must not enter model-visible tool-result content",
    );
    assert.equal(
      h.sent.some((row) => (
        JSON.stringify(row).includes("coc.pi-tool-working-set-replan")
      )),
      false,
      "host audit must not be sent as model-visible follow-up content",
    );

    const repeatedHooks = await h.emitAll("tool_result", null, {
      toolCallId: "journal-stage-change",
      toolName: "coc_invoke",
      input: {
        operation: "state.journal",
        campaign: "tool-affordance-campaign",
        arguments: { summary: "记录本轮调查。" },
      },
      content: journal.content,
      details: journal.details,
      isError: false,
    });
    assert.equal(
      repeatedHooks.some((hook) => hook?.replan === true),
      false,
      "a consumed execution fingerprint cannot request another replan",
    );
    assert.equal(
      h.appended.filter((row) => row.type === "coc-tool-working-set-replan").length,
      1,
      "a repeated stale result cannot append another replan audit",
    );
  }, (_name, params) => (
    params.operation === "state.journal"
      ? {
          ok: true,
          tool: "state.journal",
          data: { turn_id: "turn-affordance-replan" },
        }
      : {
          ok: true,
          tool: params.operation,
          data: {},
        }
  ));
});

test("late, failed, and prior-session results do not append replan audits", async () => {
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我检查当前场景。" }],
    });

    const lateHooks = await h.emitAll("tool_result", null, {
      toolCallId: "late-without-start",
      toolName: "coc_capabilities",
      input: {},
      content: [{ type: "text", text: "late" }],
      details: {},
      isError: false,
    });
    assert.equal(lateHooks.some((hook) => hook?.replan === true), false);

    await h.emit("tool_execution_start", null, {
      toolCallId: "failed-stable-read",
      toolName: "coc_capabilities",
      args: {},
    });
    await h.emit("tool_execution_end", null, {
      toolCallId: "failed-stable-read",
      toolName: "coc_capabilities",
      isError: true,
    });
    const failedHooks = await h.emitAll("tool_result", null, {
      toolCallId: "failed-stable-read",
      toolName: "coc_capabilities",
      input: {},
      content: [{ type: "text", text: "failed" }],
      details: {},
      isError: true,
    });
    assert.equal(failedHooks.some((hook) => hook?.replan === true), false);

    await h.emit("tool_execution_start", null, {
      toolCallId: "prior-session-read",
      toolName: "coc_capabilities",
      args: {},
    });
    await h.start();
    const priorSessionHooks = await h.emitAll("tool_result", null, {
      toolCallId: "prior-session-read",
      toolName: "coc_capabilities",
      input: {},
      content: [{ type: "text", text: "stale session" }],
      details: {},
      isError: false,
    });
    assert.equal(
      priorSessionHooks.some((hook) => hook?.replan === true),
      false,
    );
    assert.equal(
      h.appended.filter((row) => row.type === "coc-tool-working-set-replan").length,
      0,
    );
  });
});

test("replan audit append failure cannot suppress the replan request", async () => {
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我记录当前调查。" }],
    });
    await h.emit("tool_execution_start", null, {
      toolCallId: "journal-audit-failure",
      toolName: "coc_invoke",
      args: {
        operation: "state.journal",
        campaign: "tool-affordance-campaign",
        arguments: { summary: "记录本轮调查。" },
      },
    });
    const journal = await h.tools.get("coc_invoke").execute(
      "journal-audit-failure",
      {
        operation: "state.journal",
        campaign: "tool-affordance-campaign",
        arguments: { summary: "记录本轮调查。" },
      },
      undefined,
      undefined,
      h.ctx,
    );
    const hooks = await h.emitAll("tool_result", null, {
      toolCallId: "journal-audit-failure",
      toolName: "coc_invoke",
      input: {
        operation: "state.journal",
        campaign: "tool-affordance-campaign",
        arguments: { summary: "记录本轮调查。" },
      },
      content: journal.content,
      details: journal.details,
      isError: false,
    });
    const visibleJournal = JSON.parse(journal.content[0].text);
    assert.equal(visibleJournal.ok, true);
    assert.equal(visibleJournal.tool, "state.journal");
    assert.equal(hooks.some((hook) => hook?.replan === true), true);
    assert.equal(
      h.appended.filter((row) => row.type === "coc-tool-working-set-replan").length,
      0,
    );
  }, (_name, params) => (
    params.operation === "state.journal"
      ? {
          ok: true,
          tool: "state.journal",
          data: { turn_id: "turn-affordance-audit-failure" },
        }
      : { ok: true, tool: params.operation, data: {} }
  ), {
    beforeAppendEntry(type) {
      if (type === "coc-tool-working-set-replan") {
        throw new Error("audit unavailable");
      }
    },
  });
});

test("only tools that can invalidate the working set declare sequential execution", async () => {
  await withPlayHarness(async (h) => {
    assert.equal(h.tools.get("coc_capabilities").executionMode, undefined);
    assert.equal(h.tools.get("coc_discover").executionMode, "sequential");
    assert.equal(h.tools.get("coc_invoke").executionMode, "sequential");
    assert.equal(h.tools.get("coc_rules_context").executionMode, "parallel");
    assert.equal(h.tools.get("coc_state_journal").executionMode, "sequential");
  });
});

test("settled-output recovery schedules exactly two hidden follow-ups then faults", async () => {
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我继续搜查房间。" }],
    });
    const assistant = (text) => ({
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text }],
    });
    await h.emit("message_end", assistant("你掀开了积灰的木板。"));
    await h.emit("message_end", assistant("木板下方传来一阵冷风。"));
    await h.emit("message_end", assistant("黑暗里似乎有什么正在移动。"));

    const hidden = h.sent.filter((row) => (
      row.message.customType === "coc-settled-output-gate"
      && row.options?.triggerTurn === true
    ));
    assert.equal(hidden.length, 2, JSON.stringify(h.sent));
    const faults = h.sent.filter((row) => (
      row.message.customType === main.TURN_PROCESSING_FAULT_CUSTOM_TYPE
    ));
    assert.equal(faults.length, 1);
    assert.equal(faults[0].message.details.code, "settled_output_recovery_exhausted");
    assert.equal(faults[0].options?.triggerTurn, false);
    assert.deepEqual(h.active.at(-1), ["coc_session_resume"]);
  });
});

test("leading whitespace stream aborts early and schedules one same-epoch recovery", async () => {
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我沿着走廊继续调查。" }],
    });
    const streaming = {
      role: "assistant",
      content: [{ type: "text", text: "\n" }],
    };
    await h.emit("message_start", streaming);
    for (let index = 0; index < 40; index += 1) {
      await h.emit("message_update", streaming, {
        assistantMessageEvent: { type: "text_delta", delta: "\n" },
      });
    }
    assert.equal(h.aborts, 1);
    const recoveries = h.sent.filter((row) => (
      row.message.customType === main.EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE
    ));
    assert.equal(recoveries.length, 1);
    assert.equal(recoveries[0].options.triggerTurn, true);
    assert.equal(recoveries[0].options.deliverAs, "followUp");
    const audits = h.appended.filter((row) => (
      row.type === "coc-leading-whitespace-stream-abort"
    ));
    assert.equal(audits.length, 1);
    assert.equal(audits[0].value.failure_class, "leading_whitespace_stream_limit");
  });
});

test("extension nonretry scope ignores host identity churn and clears on real progress", async () => {
  let contextAttempts = 0;
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我整理这一轮调查结果。" }],
    });
    await h.tools.get("coc_invoke").execute(
      "journal",
      {
        operation: "state.journal",
        campaign: "tool-affordance-campaign",
        arguments: {},
      },
      undefined, undefined, h.ctx,
    );
    // The model-owned surface for turn.output_context is EMPTY (campaign and
    // root are host-bound): repeated identical calls share one circuit key,
    // so the first canonical failure arms the circuit and the repeat is
    // blocked with zero further transport.
    const callContext = (probe, decisionId, extra) => h.tools.get("coc_invoke").execute(
      `context-${probe}-${decisionId}`,
      {
        operation: "turn.output_context",
        campaign: "tool-affordance-campaign",
        arguments: { ...(extra ?? {}) },
      },
      undefined, undefined, h.ctx,
    );
    const first = JSON.parse((await callContext("same", "journal-host-churn-1")).content[0].text);
    assert.equal(first.error.code, "invalid_param");
    const repeated = JSON.parse((await callContext("same", "journal-host-churn-2")).content[0].text);
    assert.equal(repeated.error.code, "nonretryable_repeat_blocked");
    assert.equal(contextAttempts, 1);

    // The model-owned surface for turn.output_context is campaign+root only:
    // there is no model-owned churn lever, and unknown churn fields reject at
    // the argument-shape gate with zero canonical attempts and zero transport.
    const unknownChurn = JSON.parse((await callContext("churn-unknown", "journal-host-churn-3", { probe: "x" })).content[0].text);
    assert.equal(unknownChurn.error.code, "unknown_model_argument");
    assert.equal(contextAttempts, 1);
  }, (_name, params) => {
    if (params.operation === "state.journal") {
      return { ok: true, tool: "state.journal", data: { turn_id: "turn-affordance-1" } };
    }
    if (params.operation === "turn.output_context") {
      contextAttempts += 1;
      if (contextAttempts === 1) {
        return {
          ok: false,
          tool: "turn.output_context",
          error: { code: "invalid_param", class: "schema_validation", message: "probe" },
          retryable: false,
          will_retry: false,
        };
      }
      return {
        ok: true,
        tool: "turn.output_context",
        data: {
          turn_id: "turn-affordance-1",
          source_digest: "sha256:source-affordance-1",
          settlement_snapshot_id: "turn-settlement-v1:affordance-1",
          mechanics_bundle_sha256: "sha256:mechanics-affordance-1",
          contract_projection: {
            agency_review_required: true,
            agency_authority: { pc_subject_refs: ["pc:affordance"] },
          },
          agency_review_operation: {
            operation: "narration.review",
            prefilled_arguments: { revision: 1 },
          },
          finalize_operation: {
            operation: "turn.finalize",
            prefilled_arguments: { revision: 1 },
          },
        },
      };
    }
    return { ok: true, tool: params.operation, data: {} };
  });
});

test("typed journal hides host identity and restores it from independent live turn facts", async () => {
  let forwarded = null;
  await withPlayHarness(async (h) => {
    const playerText = "我把这一轮发现记入调查日志。";
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: playerText }],
    });
    await h.emit("message_start", {
      role: "user",
      customType: main.EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE,
      content: [{ type: "text", text: "host recovery control" }],
      details: { player_turn_epoch: 1 },
    });
    const journal = h.tools.get("coc_state_journal");
    for (const hostField of ["root", "campaign", "player_text", "decision_id", "run_id"]) {
      assert.equal(
        Object.hasOwn(journal.parameters.properties, hostField),
        false,
        `${hostField}: ${JSON.stringify({
          properties: Object.keys(journal.parameters.properties),
          appended: h.appended.slice(-5),
        })}`,
      );
    }
    const response = JSON.parse((await journal.execute(
      "typed-journal", {}, undefined, undefined, h.ctx,
    )).content[0].text);
    assert.equal(response.ok, true);
    assert.equal(forwarded.root, root);
    assert.equal(forwarded.campaign, "tool-affordance-campaign");
    assert.equal(forwarded.arguments.player_text, playerText);
    assert.match(
      forwarded.arguments.decision_id,
      /^pi-state-journal:[0-9a-f]{8}:player-epoch-1:revision-1$/,
    );
  }, (_name, params) => {
    if (params.operation === "state.journal") {
      forwarded = params;
      return {
        ok: true,
        tool: "state.journal",
        data: { turn_id: "turn-typed-journal-1" },
      };
    }
    return { ok: true, tool: params.operation, data: {} };
  });
});

const contextReceipt = (revision, data) => ({
  ok: true,
  tool: "scene.context",
  wire: {
    full_result_sha256: `sha256:${revision.padEnd(64, "a").slice(0, 64)}`,
  },
  cache: { revision: `scene-context:${revision}` },
  data,
});

const PRODUCTION_HEALING_DECISION_CARD = {
  schema_version: 1,
  decision_ref: "decision:coc7:healing:first-aid-ordinary",
  family: "healing",
  label: "Administer First Aid to a non-dying injured character",
  applicability: "applicable",
  required_inputs: [
    { name: "assistant_rescuer_ref", owner: "optional-semantic", type: "string" },
    { name: "rescuer_ref", owner: "optional-semantic", type: "string" },
  ],
  locked_inputs: [
    "assistant_rescuer_id", "assistant_skill_value", "first_aid_pushed",
    "first_aid_skill", "pushed", "rescuer_id", "skill_value",
  ],
  rule_refs: ["rule:coc7:healing:first-aid-stabilization"],
  source_refs: ["span-wounds-and-healing-page-131-block-18"],
  capability_ref: "capability:coc7:first-aid",
  effect_refs: ["effect:coc7:healing:temporary-stabilization"],
  possible_continuations: [
    "decision:coc7:healing:medicine-ordinary",
  ],
  authority: {
    selection: "keeper-semantic",
    execution: "current-ruleset-adapter",
    hard_gate: false,
  },
};

const healingCardBlock = (card = PRODUCTION_HEALING_DECISION_CARD) => ({
  schema_version: 1,
  family: "healing",
  investigator_id: "thomas-hayes",
  status: "ok",
  cards: [structuredClone(card)],
  authority: {
    hard_gate: false,
    role: "affordance",
    note: "advisory healing affordances; settle via rules.settle; absence never blocks play",
  },
});

const healingSceneData = (card = PRODUCTION_HEALING_DECISION_CARD) => ({
  active_scene_id: "infirmary-treatment-room",
  party: ["thomas-hayes"],
  exits: [],
  time: { elapsed_minutes: 0 },
  npcs_present: [],
  action_routes: [],
  rule_decision_cards: healingCardBlock(card),
  recovery: { healing: healingCardBlock(card) },
});

test("RuleDecisionCard survives resume, scene, exact context, and typed settle", async () => {
  const forwarded = [];
  const resumeEnvelope = {
    ok: true,
    tool: "session.resume",
    wire: { full_result_sha256: `sha256:${"1".repeat(64)}` },
    data: {
      schema_version: 1,
      campaign_id: "tool-affordance-campaign",
      mode: "awaiting_player",
      next_operations: [],
      scene_context: healingSceneData(),
    },
  };
  const sceneEnvelope = contextReceipt("ruledecision-card", healingSceneData());
  const rulesContextEnvelope = {
    ok: true,
    tool: "rules.context",
    data: {
      schema_version: 1,
      status: "ok",
      family: "healing",
      cards: [structuredClone(PRODUCTION_HEALING_DECISION_CARD)],
      family_status: [{
        family: "healing",
        coverage: "accepted",
        runtime_owner: "graph",
        legacy_surface: "hidden",
      }],
    },
  };
  await withPlayHarness(async (h, initialResume) => {
    const resumed = JSON.parse(initialResume.content[0].text);
    assert.equal(resumed.ok, true, JSON.stringify({ resumed, details: initialResume.details }));
    assert.deepEqual(
      resumed.data.scene_context.rule_decision_cards.cards[0],
      PRODUCTION_HEALING_DECISION_CARD,
    );

    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我请同伴立刻为伤口做急救。" }],
    });
    const sceneResult = await invokeCompat(h, "ruledecision-scene", "scene.context");
    const sceneVisible = JSON.parse(sceneResult.content[0].text);
    assert.equal(sceneVisible.ok, true, JSON.stringify({ sceneVisible, details: sceneResult.details }));
    assert.deepEqual(
      sceneVisible.data.rule_decision_cards.cards[0],
      PRODUCTION_HEALING_DECISION_CARD,
    );
    assert.equal(
      h.active.at(-1).filter((name) => name === "coc_rules_settle").length,
      1,
      JSON.stringify(h.active.at(-1)),
    );
    for (const legacy of [
      "coc_rules_first_aid", "coc_rules_dying_check",
      "coc_rules_medicine", "coc_rules_weekly_recovery",
    ]) {
      assert.equal(h.active.at(-1).includes(legacy), false, legacy);
    }

    const loaded = JSON.parse((await h.tools.get("coc_discover").execute(
      "load-rule-context",
      { operation: "rules.context" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(loaded.ok, true, JSON.stringify(loaded));
    const exactContext = await h.tools.get("coc_rules_context").execute(
      "ruledecision-exact-context",
      {
        root,
        campaign: "tool-affordance-campaign",
        investigator: "current-investigator",
        family: "healing",
      },
      undefined,
      undefined,
      h.ctx,
    );
    const exactVisible = JSON.parse(exactContext.content[0].text);
    assert.equal(exactVisible.ok, true, JSON.stringify({ exactVisible, details: exactContext.details }));
    assert.deepEqual(exactVisible.data.cards[0], PRODUCTION_HEALING_DECISION_CARD);

    const settle = await h.tools.get("coc_rules_settle").execute(
      "ruledecision-settle",
      {
        root,
        campaign: "tool-affordance-campaign",
        investigator: "current-investigator",
        decision_ref: exactVisible.data.cards[0].decision_ref,
        semantic_inputs: {},
        decision_id: "roll-healing-ruledecision-first-aid-v1",
      },
      undefined,
      undefined,
      h.ctx,
    );
    const settledVisible = JSON.parse(settle.content[0].text);
    assert.equal(settledVisible.ok, true, JSON.stringify({ settledVisible, details: settle.details }));
    const canonicalSettle = forwarded.findLast((row) => row.operation === "rules.settle");
    assert.equal(
      canonicalSettle.arguments.decision_ref,
      PRODUCTION_HEALING_DECISION_CARD.decision_ref,
    );
  }, (_name, params) => {
    forwarded.push(structuredClone(params));
    if (params.operation === "session.resume") return resumeEnvelope;
    if (params.operation === "scene.context") return sceneEnvelope;
    if (params.operation === "rules.context") return rulesContextEnvelope;
    if (params.operation === "rules.settle") {
      return {
        ok: true,
        tool: "rules.settle",
        data: {
          schema_version: 1,
          decision_ref: params.arguments.decision_ref,
          family: "healing",
          status: "settled",
          next_decisions: [],
          authority: "canonical-resolver-state-receipts",
        },
      };
    }
    return { ok: true, tool: params.operation, data: {} };
  });
});

test("rules-director profile activates healing card without discovery or broad tools", async () => {
  const priorProfile = process.env[PROFILE_ENV];
  process.env[PROFILE_ENV] = "rules-director-single-draft";
  try {
    const resumeEnvelope = {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: "tool-affordance-campaign",
        mode: "awaiting_player",
        next_operations: [],
        scene_context: healingSceneData(),
      },
    };
    const sceneEnvelope = contextReceipt(
      "ruledecision-profile-card",
      healingSceneData(),
    );
    const turnId = "turn-rules-director-single-draft-1";
    const sourceDigest = `sha256:${"c7".repeat(32)}`;
    await withPlayHarness(async (h) => {
      await h.emit("message_start", {
        role: "user",
        content: [{ type: "text", text: "我按住伤口，重新仔细包扎。" }],
      });
      const scene = await invokeCompat(
        h,
        "ruledecision-profile-scene",
        "scene.context",
      );
      assert.equal(JSON.parse(scene.content[0].text).ok, true);
      assert.deepEqual(h.active.at(-1), [
        "coc_actions_list",
        "coc_rules_settle",
        "coc_scene_context",
        "coc_state_journal",
      ]);
      const settled = await h.tools.get("coc_rules_settle").execute(
        "ruledecision-profile-settle",
        {
          campaign: "tool-affordance-campaign",
          decision_ref: PRODUCTION_HEALING_DECISION_CARD.decision_ref,
          semantic_inputs: {},
          decision_id: "recovery-profile-first-aid-v1",
        },
        undefined,
        undefined,
        h.ctx,
      );
      assert.equal(JSON.parse(settled.content[0].text).ok, true);
      const journal = await h.tools.get("coc_state_journal").execute(
        "rules-director-profile-journal",
        {
          summary: "调查员按住右手伤口并完成急救尝试。",
          player_action: "按住伤口并仔细包扎",
          intent_class: "treat_wound",
          player_speaker: "调查员",
          tension: "medium",
        },
        undefined,
        undefined,
        h.ctx,
      );
      assert.equal(JSON.parse(journal.content[0].text).ok, true);
      const output = await invokeCompat(
        h,
        "rules-director-profile-output",
        "turn.output_context",
      );
      assert.equal(JSON.parse(output.content[0].text).ok, true);
      assert.ok(h.active.at(-1).includes("coc_turn_finalize"));
      assert.ok(!h.active.at(-1).includes("coc_invoke"));
      assert.ok(!h.active.at(-1).includes("coc_narration_review"));
      const finalized = await h.tools.get("coc_turn_finalize").execute(
        "rules-director-profile-finalize",
        { draft: "你按住伤口，布条很快被血浸透。", coverage: [] },
        undefined,
        undefined,
        h.ctx,
      );
      assert.equal(JSON.parse(finalized.content[0].text).ok, true);
      const call = h.clientCalls.findLast((row) => (
        row.name === "coc_invoke" && row.params.operation === "turn.finalize"
      ));
      assert.equal(call.params.arguments.revision, 1);
      assert.equal(call.params.arguments.narration_review_id, undefined);
    }, (_name, params) => {
      if (params.operation === "session.resume") return resumeEnvelope;
      if (params.operation === "scene.context") return sceneEnvelope;
      if (params.operation === "rules.settle") {
        return {
          ok: true,
          tool: "rules.settle",
          data: {
            schema_version: 1,
            decision_ref: params.arguments.decision_ref,
            family: "healing",
            status: "settled",
            next_decisions: [],
            authority: "canonical-resolver-state-receipts",
          },
        };
      }
      if (params.operation === "state.journal") {
        return {
          ok: true,
          tool: "state.journal",
          data: { turn_id: turnId, turn_number: 1 },
        };
      }
      if (params.operation === "turn.output_context") {
        return {
          ok: true,
          tool: "turn.output_context",
          data: {
            turn_id: turnId,
            journal_decision_id: params.arguments?.decision_id
              ?? "pi-state-journal:profile:player-epoch-1:revision-1",
            source_digest: sourceDigest,
            settlement_snapshot_id: "turn-settlement-v1:profile-single-draft",
            mechanics_bundle_sha256: `sha256:${"c8".repeat(32)}`,
            obligations: [],
            required_obligation_ids: [],
            mechanics_summary: {
              public_check: [], state_delta: [], exceptional_effect: [],
              concealed_consequence: [],
            },
            contract_projection: {
              player_input: {
                source_ref: "player_input:profile-single-draft",
                text: "我按住伤口，重新仔细包扎。",
              },
              agency_review_required: false,
              agency_authority: { pc_subject_refs: ["pc:thomas-hayes"] },
              control_overrides: [],
            },
            finalize_operation: {
              operation: "turn.finalize",
              invoke_via: "coc_turn_finalize",
              prefilled_arguments: {
                decision_id:
                  "pi-state-journal:profile:player-epoch-1:revision-1:finalize",
                revision: 1,
                coverage: [],
              },
              missing_arguments: ["draft"],
            },
          },
        };
      }
      if (params.operation === "turn.finalize") {
        return {
          ok: true,
          tool: "turn.finalize",
          data: {
            finalized: true,
            finalization_id: "finalization-v1:profile-single-draft",
            turn_id: turnId,
            rendered_text: params.arguments.draft,
            rendered_text_sha256: canonicalDigest(params.arguments.draft),
          },
        };
      }
      return { ok: true, tool: params.operation, data: {} };
    });
  } finally {
    if (priorProfile === undefined) delete process.env[PROFILE_ENV];
    else process.env[PROFILE_ENV] = priorProfile;
  }
});

test("RuleDecisionCard rejects opaque or malformed semantic references", async () => {
  for (const [field, value] of [
    ["decision_ref", "7c9e6679-7425-40de-944b-e07fc1f90ae7"],
    ["decision_ref", "capability:coc7:first-aid"],
    ["capability_ref", `sha256:${"a".repeat(64)}`],
    ["capability_ref", "decision:coc7:healing:first-aid-ordinary"],
    ["rule_refs", ["effect:coc7:healing:wrong-domain"]],
    ["effect_refs", ["rule:coc7:healing:wrong-domain"]],
    ["possible_continuations", ["capability:coc7:first-aid"]],
    ["source_refs", ["/private/rule-graph.json"]],
  ]) {
    const card = structuredClone(PRODUCTION_HEALING_DECISION_CARD);
    card[field] = value;
    await withPlayHarness(async (_h, initialResume) => {
      const visible = JSON.parse(initialResume.content[0].text);
      assert.equal(visible.ok, false, `${field}: ${JSON.stringify(visible)}`);
      assert.equal(visible.error.code, "semantic_identity_unavailable", field);
      assert.equal(JSON.stringify(visible).includes(String(value)), false, field);
    }, (_name, params) => (
      params.operation === "session.resume"
        ? {
            ok: true,
            tool: "session.resume",
            wire: { full_result_sha256: `sha256:${"2".repeat(64)}` },
            data: {
              schema_version: 1,
              campaign_id: "tool-affordance-campaign",
              mode: "awaiting_player",
              next_operations: [],
              scene_context: healingSceneData(card),
            },
          }
        : { ok: true, tool: params.operation, data: {} }
    ));
  }
});

const invokeCompat = (h, id, operation, arguments_ = {}) => (
  h.tools.get("coc_invoke").execute(
    id,
    { operation, campaign: "tool-affordance-campaign", arguments: arguments_ },
    undefined, undefined, h.ctx,
  )
);

const latestWorkingSetAudit = (h) => h.appended
  .filter((row) => row.type === "coc-tool-working-set" && row.value.status === "projected")
  .at(-1)?.value;

const actualActiveSchemaBytes = (h) => h.active.at(-1).reduce((total, name) => (
  total + Buffer.byteLength(JSON.stringify(h.tools.get(name).parameters), "utf8")
), 0);

test("scene plus npc query bind social and Psychology identity without model ids", async () => {
  const forwarded = [];
  const scene = contextReceipt("social-scene", {
    active_scene_id: "commission-briefing",
    party: ["thomas-hayes"],
    exits: [],
    time: { elapsed_minutes: 0 },
    npcs_present: [{ npc_id: "npc-steven-knott" }],
    action_routes: [],
    clues_here: [],
  });
  const npcQuery = {
    ok: true,
    tool: "npc.query",
    wire: { full_result_sha256: `sha256:${"b".repeat(64)}` },
    cache: { revision: "npc-query:social-scene" },
    data: {
      npcs: [{
        npc_id: "npc-steven-knott",
        facts: [{ fact_id: "fact-knott-commission" }],
        first_contact_readiness: {
          requested_pair_first_impression: {
            status: "settled",
            investigator_id: "thomas-hayes",
            receipt_exists: true,
            first_impression_ref: "first-impression:npc-steven-knott:thomas-hayes",
          },
        },
      }],
    },
  };
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我观察诺特并说服他合作。" }],
    });
    await invokeCompat(h, "social-scene", "scene.context");
    await invokeCompat(h, "social-npc", "npc.query", { npc_id: "npc-steven-knott" });

    const social = h.tools.get("coc_rules_social_adjudicate");
    const psychology = h.tools.get("coc_rules_psychology_observe");
    for (const field of [
      "campaign", "investigator", "npc_id", "conversation_window_id", "decision_id",
    ]) assert.equal(Object.hasOwn(social.parameters.properties, field), false, field);
    for (const field of [
      "campaign", "investigator", "npc_id", "conversation_window_id", "decision_id",
      "observation_revision", "observer_scope", "observable_fact_refs",
    ]) assert.equal(Object.hasOwn(psychology.parameters.properties, field), false, field);

    const socialResult = JSON.parse((await social.execute(
      "bound-social",
      {
        commitment_id: "commitment:raise-knott-cooperation",
        approach: "charm",
        goal_summary: "请诺特更充分地配合调查",
      },
      undefined, undefined, h.ctx,
    )).content[0].text);
    assert.equal(socialResult.ok, true, JSON.stringify({ socialResult, appended: h.appended.slice(-20), properties: Object.keys(social.parameters.properties) }));
    assert.equal(socialResult.data.npc_id, "npc-steven-knott");
    assert.equal(socialResult.data.commitment_id, "commitment:raise-knott-cooperation");
    assert.equal(socialResult.data.source_digest, undefined);
    assert.equal(socialResult.data.request_digest, undefined);
    assert.equal(socialResult.data.goal_key, undefined);
    assert.equal(
      socialResult.data.roll_operation.prefilled_arguments.social_adjudication_ref,
      undefined,
    );
    const socialCall = forwarded.findLast((row) => row.operation === "rules.social_adjudicate");
    assert.equal(socialCall.arguments.investigator, "thomas-hayes");
    assert.equal(socialCall.arguments.npc_id, "npc-steven-knott");
    assert.equal(
      socialCall.arguments.conversation_window_id,
      "conversation:commission-briefing:thomas-hayes:npc-steven-knott",
    );
    assert.match(socialCall.arguments.decision_id, /^pi-rules-social_adjudicate:/u);

    const psychologyResult = JSON.parse((await psychology.execute(
      "bound-psychology",
      { question: "诺特此刻在回避什么可见问题？" },
      undefined, undefined, h.ctx,
    )).content[0].text);
    assert.equal(psychologyResult.ok, true, JSON.stringify(psychologyResult));
    assert.equal(psychologyResult.data.insight_id, undefined);
    assert.equal(psychologyResult.data.conversation_window_id, undefined);
    assert.match(psychologyResult.data.roll_id, /^roll:/u);
    assert.notEqual(psychologyResult.data.roll_id, "toolbox-social-surface-000001");
    assert.deepEqual(psychologyResult.data.observable_fact_refs, [{
      source_ref: "npc_fact:npc-steven-knott/fact-knott-commission",
      kind: "npc_fact",
      identifier: "npc-steven-knott/fact-knott-commission",
      player_known: false,
      grounding_scope: "keeper_target_truth",
    }]);
    assert.equal(psychologyResult.data.request_digest, undefined);
    const psychologyCall = forwarded.findLast((row) => row.operation === "rules.psychology_observe");
    assert.equal(psychologyCall.arguments.investigator, "thomas-hayes");
    assert.equal(psychologyCall.arguments.npc_id, "npc-steven-knott");
    assert.equal(psychologyCall.arguments.observation_revision, 0);
    assert.deepEqual(psychologyCall.arguments.observable_fact_refs, [
      "npc_fact:npc-steven-knott/fact-knott-commission",
    ]);
  }, (_name, params) => {
    forwarded.push(structuredClone(params));
    if (params.operation === "scene.context") return scene;
    if (params.operation === "npc.query") return npcQuery;
    if (params.operation === "rules.social_adjudicate") return {
      ok: true,
      tool: params.operation,
      data: {
        investigator_id: "thomas-hayes",
        npc_id: "npc-steven-knott",
        conversation_window_id: "conversation:commission-briefing:thomas-hayes:npc-steven-knott",
        commitment_id: "commitment:raise-knott-cooperation",
        approach: "charm",
        goal_summary: "请诺特更充分地配合调查",
        goal_key: "cb45f81061371aa8",
        source_digest: `sha256:${"c".repeat(64)}`,
        request_digest: `sha256:${"d".repeat(64)}`,
        roll_operation: {
          operation: "rules.roll",
          invoke_via: "coc_rules_roll",
          prefilled_arguments: {
            investigator: "thomas-hayes",
            npc_id: "npc-steven-knott",
            skill: "Charm",
            social_adjudication_ref: "cb45f81061371aa8",
          },
          missing_arguments: ["stakes", "decision_id"],
        },
      },
    };
    if (params.operation === "rules.psychology_observe") return {
      ok: true,
      tool: params.operation,
      data: {
        resolution: "settled",
        insight_id: "psych-insight-56f70e80826a",
        window_key: "team:party:opaque-window",
        question: "诺特此刻在回避什么可见问题？",
        conversation_window_id: "conversation:commission-briefing:thomas-hayes:npc-steven-knott",
        observation_revision: 0,
        outcome: "hard",
        roll_id: "toolbox-social-surface-000001",
        observable_fact_refs: [{
          source_ref: "npc_fact:npc-steven-knott/fact-knott-commission",
          kind: "npc_fact",
          identifier: "npc-steven-knott/fact-knott-commission",
          player_known: false,
          record_digest: `sha256:${"e".repeat(64)}`,
          grounding_scope: "keeper_target_truth",
        }],
        request_digest: `sha256:${"f".repeat(64)}`,
      },
    };
    return { ok: true, tool: params.operation, data: { accepted: true } };
  });
});

test("structured scene combat affordances survive into the next player turn", async () => {
  let confrontationActive = true;
  const sceneEnvelope = () => contextReceipt("structured-combat", {
    active_scene_id: confrontationActive ? "corbitt-confrontation" : "street",
    exits: [],
    time: { elapsed_minutes: 0 },
    npcs_present: confrontationActive
      ? [{ npc_id: "npc-walter-corbitt" }]
      : [],
    action_routes: confrontationActive ? [{
      route_id: "conventional-assault",
      resolution_kind: "keeper_judgment",
    }] : [],
    clues_here: [],
    keeper_mechanics: {
      affordance_operations: confrontationActive ? [{
        affordance_id: "strike-with-his-dagger",
        kind: "combat_engagement",
        tool: "combat.resolve",
      }] : [],
    },
  });
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我用科比特自己的匕首攻击他。" }],
    });
    await invokeCompat(h, "combat-affordance-scene", "scene.context");
    assert.ok(h.active.at(-1).includes("coc_combat_resolve"));

    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我继续这一击。" }],
    });
    assert.ok(
      h.active.at(-1).includes("coc_combat_resolve"),
      "the authored combat operation remains available while the scene is unchanged",
    );

    confrontationActive = false;
    await invokeCompat(h, "combat-affordance-refresh", "scene.context");
    assert.equal(
      h.active.at(-1).includes("coc_combat_resolve"),
      false,
      "a fresh scene snapshot retires stale combat affordances",
    );
  }, (_name, params) => {
    if (params.operation === "scene.context") return sceneEnvelope();
    return { ok: true, tool: params.operation, data: {} };
  });
});

test("scene context directly binds a single combat target without combat context", async () => {
  const forwarded = [];
  const sceneEnvelope = contextReceipt("direct-combat-single", {
    active_scene_id: "cellar",
    party: ["thomas-hayes"],
    exits: [],
    time: { time_precision: "imprecise", local_datetime: null },
    npcs_present: [{ npc_id: "walter-corbitt" }],
    action_routes: [],
    clues_here: [],
  });
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我冲向科比特，挥拳攻击。" }],
    });
    await invokeCompat(h, "direct-combat-scene", "scene.context");
    const discovered = JSON.parse((await h.tools.get("coc_discover").execute(
      "discover-direct-combat",
      { operation: "combat.resolve" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(discovered.ok, true, JSON.stringify(discovered));
    for (const field of [
      "root", "campaign", "decision_id", "candidate_id", "target_npc_id",
    ]) {
      assert.equal(Object.hasOwn(
        discovered.data.operation_card.parameters.properties,
        field,
      ), false, field);
    }

    const resolved = JSON.parse((await h.tools.get("coc_combat_resolve").execute(
      "direct-combat-resolve",
      { investigator: "current-investigator" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(resolved.ok, true, JSON.stringify(resolved));
    const combatCall = forwarded.findLast(
      (params) => params.operation === "combat.resolve",
    );
    assert.equal(combatCall.campaign, "tool-affordance-campaign");
    assert.equal(combatCall.arguments.investigator, "thomas-hayes");
    assert.equal(combatCall.arguments.target_npc_id, "walter-corbitt");
    assert.match(combatCall.arguments.decision_id, /^pi-combat-resolve:/u);
  }, (_name, params) => {
    forwarded.push(structuredClone(params));
    if (params.operation === "scene.context") return sceneEnvelope;
    return { ok: true, tool: params.operation, data: { accepted: true } };
  });
});

test("scene combat choices are explicit and combat context replaces them authoritatively", async () => {
  const forwarded = [];
  let sceneEnvelope = contextReceipt("direct-combat-ambiguous", {
    active_scene_id: "cellar",
    party: ["thomas-hayes"],
    exits: [],
    time: { time_precision: "imprecise", local_datetime: null },
    npcs_present: [{ npc_id: "walter-corbitt" }],
    action_routes: [{
      route_id: "floating-knife",
      resolution_kind: "combat_engagement",
    }],
    clues_here: [],
  });
  const pendingDefenseEnvelope = {
    ok: true,
    tool: "combat.context",
    wire: { full_result_sha256: `sha256:${"d".repeat(64)}` },
    cache: { revision: "combat-context:pending-defense" },
    data: {
      active: true,
      pending_defense: { defender: "thomas-hayes" },
      combat: { value: { combat_id: "corbitt", revision: 3 } },
    },
  };
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我在科比特和飞刀之间判断应对目标。" }],
    });
    await invokeCompat(h, "direct-combat-ambiguous-scene", "scene.context");
    const sceneDiscovery = JSON.parse((await h.tools.get("coc_discover").execute(
      "discover-direct-combat-ambiguous",
      { operation: "combat.resolve" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.deepEqual(
      sceneDiscovery.data.operation_card.parameters.properties.candidate_id.enum,
      ["attack:walter-corbitt", "combat-route:floating-knife"],
    );

    await invokeCompat(h, "pending-defense-context", "combat.context");
    const defenseDiscovery = JSON.parse((await h.tools.get("coc_discover").execute(
      "discover-pending-defense",
      { operation: "combat.resolve" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(Object.hasOwn(
      defenseDiscovery.data.operation_card.parameters.properties,
      "candidate_id",
    ), false, "one pending defense replaces the earlier ambiguous attack choices");
    const defense = JSON.parse((await h.tools.get("coc_combat_resolve").execute(
      "resolve-pending-defense",
      { investigator: "current-investigator" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(defense.ok, true, JSON.stringify(defense));
    const defenseCall = forwarded.findLast(
      (params) => params.operation === "combat.resolve",
    );
    assert.equal(Object.hasOwn(defenseCall.arguments, "target_npc_id"), false);
    assert.equal(Object.hasOwn(defenseCall.arguments, "affordance_id"), false);
    assert.match(defenseCall.arguments.decision_id, /^pi-combat-resolve:/u);

    await invokeCompat(h, "rearm-ambiguous-scene", "scene.context");
    const staleCombatTool = h.tools.get("coc_combat_resolve");
    sceneEnvelope = contextReceipt("direct-combat-cleared", {
      active_scene_id: "street",
      party: ["thomas-hayes"],
      exits: [],
      time: { time_precision: "imprecise", local_datetime: null },
      npcs_present: [],
      action_routes: [],
      clues_here: [],
    });
    await invokeCompat(h, "clear-direct-combat-scene", "scene.context");
    const callsBeforeStale = forwarded.filter(
      (params) => params.operation === "combat.resolve",
    ).length;
    const stale = JSON.parse((await staleCombatTool.execute(
      "stale-direct-combat",
      { investigator: "current-investigator", candidate_id: "attack:walter-corbitt" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(stale.ok, false, JSON.stringify(stale));
    assert.equal(stale.error.code, "binding_context_missing");
    assert.equal(forwarded.filter(
      (params) => params.operation === "combat.resolve",
    ).length, callsBeforeStale, "stale scene combat choice must not transport");
  }, (_name, params) => {
    forwarded.push(structuredClone(params));
    if (params.operation === "scene.context") return sceneEnvelope;
    if (params.operation === "combat.context") return pendingDefenseEnvelope;
    return { ok: true, tool: params.operation, data: { accepted: true } };
  });
});

test("resume-projected combat tool rebinds before a stale tool object executes", async () => {
  const forwarded = [];
  const resumeEnvelope = {
    ok: true,
    tool: "session.resume",
    wire: { full_result_sha256: `sha256:${"e".repeat(64)}` },
    cache: { revision: "resume:combat-scene" },
    data: {
      schema_version: 1,
      campaign_id: "tool-affordance-campaign",
      mode: "awaiting_player",
      evidence: { table_opening_id: "table-opening:combat-rebind" },
      next_operations: [],
      scene_context: {
        active_scene_id: "corbitt-confrontation",
        party: ["thomas-hayes"],
        exits: [],
        time: { time_precision: "imprecise", local_datetime: null },
        npcs_present: [{ npc_id: "npc-walter-corbitt" }],
        action_routes: [{
          route_id: "conventional-assault",
          resolution_kind: "combat_engagement",
        }],
        clues_here: [],
      },
    },
  };
  await withPlayHarness(async (h) => {
    const resumeProjectedTool = h.tools.get("coc_combat_resolve");
    assert.deepEqual(
      resumeProjectedTool.parameters.properties.candidate_id.enum,
      ["attack:npc-walter-corbitt", "combat-route:conventional-assault"],
    );

    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我迎向科比特，准备闪避。" }],
    });
    const resolved = JSON.parse((await resumeProjectedTool.execute(
      "stale-resume-projected-combat",
      {
        candidate_id: "attack:npc-walter-corbitt",
        defense_kind: "dodge",
        investigator: "current-investigator",
      },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(resolved.ok, true, JSON.stringify(resolved));
    const combatCall = forwarded.findLast(
      (params) => params.operation === "combat.resolve",
    );
    assert.equal(combatCall.arguments.target_npc_id, "npc-walter-corbitt");
    assert.equal(Object.hasOwn(combatCall.arguments, "candidate_id"), false);
    assert.match(
      combatCall.arguments.decision_id,
      /^pi-combat-resolve:[^:]+:player-epoch-1:revision-/u,
    );
  }, (_name, params) => {
    forwarded.push(structuredClone(params));
    if (params.operation === "session.resume") return resumeEnvelope;
    if (params.operation === "combat.resolve") {
      if (typeof params.arguments.decision_id !== "string") {
        return {
          ok: false,
          tool: "combat.resolve",
          error: {
            code: "missing_param",
            message: "required parameter: decision_id",
            retryable: false,
          },
        };
      }
      return { ok: true, tool: "combat.resolve", data: { accepted: true } };
    }
    return { ok: true, tool: params.operation, data: {} };
  });
});

test("campaign-bound typed semantic calls use the active campaign before restoration", async () => {
  const forwarded = [];
  const campaign = "tool-affordance-campaign";
  const sceneEnvelope = contextReceipt("typed-active-campaign", {
    active_scene_id: "front-hall",
    party: ["thomas-hayes"],
    exits: [],
    time: { elapsed_minutes: 0 },
    npcs_present: [{ npc_id: "walter-corbitt" }],
    action_routes: [],
    clues_here: [],
  });
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我检查大厅，准备应对危险。" }],
    });
    const scene = JSON.parse((await invokeCompat(
      h,
      "typed-active-campaign-scene",
      "scene.context",
    )).content[0].text);
    assert.equal(scene.ok, true, JSON.stringify(scene));

    for (const operation of ["combat.resolve", "rules.roll"]) {
      const discovered = JSON.parse((await h.tools.get("coc_discover").execute(
        `discover-${operation}`,
        { operation },
        undefined,
        undefined,
        h.ctx,
      )).content[0].text);
      assert.equal(discovered.ok, true, JSON.stringify(discovered));
    }

    const combat = JSON.parse((await h.tools.get("coc_combat_resolve").execute(
      "typed-active-campaign-combat",
      { investigator: "current-investigator" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(combat.ok, true, JSON.stringify(combat));
    const combatForwarded = forwarded.findLast(
      (params) => params.operation === "combat.resolve",
    );
    assert.equal(combatForwarded.campaign, campaign);
    assert.equal(combatForwarded.arguments.investigator, "thomas-hayes");

    const roll = JSON.parse((await h.tools.get("coc_rules_roll").execute(
      "typed-active-campaign-roll",
      {
        investigator: "current-investigator",
        skill: "Spot Hidden",
        difficulty: "regular",
        difficulty_basis: "environment",
        goal: "检查大厅里的异常",
      },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(roll.ok, true, JSON.stringify(roll));
    const rollForwarded = forwarded.findLast(
      (params) => params.operation === "rules.roll",
    );
    assert.equal(rollForwarded.campaign, campaign);
    assert.equal(rollForwarded.arguments.investigator, "thomas-hayes");
  }, (_name, params) => {
    forwarded.push(structuredClone(params));
    if (params.operation === "session.resume") {
      return {
        ok: true,
        tool: "session.resume",
        data: {
          schema_version: 1,
          campaign_id: campaign,
          mode: "awaiting_player",
          evidence: { table_opening_id: "table-opening:typed-active-campaign" },
          next_operations: [],
          scene_context: { party: ["thomas-hayes"] },
        },
      };
    }
    if (params.operation === "scene.context") return sceneEnvelope;
    return { ok: true, tool: params.operation, data: { schema_version: 1 } };
  });
});

test("campaign-bound typed semantic calls fail closed without an active campaign", async () => {
  const priorRole = process.env[ROLE_ENV];
  const priorCampaign = process.env[CAMPAIGN_ENV];
  process.env[ROLE_ENV] = "play";
  delete process.env[CAMPAIGN_ENV];
  const forwarded = [];
  try {
    const h = makeHarness((_name, params) => {
      forwarded.push(structuredClone(params));
      if (params.operation === "session.resume") {
        return {
          ok: true,
          tool: "session.resume",
          data: {
            schema_version: 1,
            mode: "awaiting_player",
            evidence: { table_opening_id: "table-opening:no-active-campaign" },
            next_operations: [],
            scene_context: { party: ["thomas-hayes"] },
          },
        };
      }
      if (params.operation === "scene.context") {
        return contextReceipt("no-active-campaign", {
          active_scene_id: "front-hall",
          party: ["thomas-hayes"],
          exits: [],
          npcs_present: [],
          action_routes: [],
          clues_here: [],
        });
      }
      return { ok: true, tool: params.operation, data: { schema_version: 1 } };
    });
    await h.start();
    await h.tools.get("coc_invoke").execute(
      "resume-without-active-campaign",
      { operation: "session.resume", arguments: {} },
      undefined,
      undefined,
      h.ctx,
    );
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我检查大厅。" }],
    });
    await h.tools.get("coc_invoke").execute(
      "scene-without-active-campaign",
      { operation: "scene.context", arguments: {} },
      undefined,
      undefined,
      h.ctx,
    );
    const combat = JSON.parse((await h.tools.get("coc_combat_resolve").execute(
      "combat-without-active-campaign",
      { investigator: "current-investigator" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(combat.ok, false, JSON.stringify(combat));
    assert.equal(combat.error.code, "binding_context_missing");
    assert.equal(
      forwarded.filter((params) => params.operation === "combat.resolve").length,
      0,
      "campaign-less typed calls must never reach transport",
    );
  } finally {
    if (priorRole === undefined) delete process.env[ROLE_ENV];
    else process.env[ROLE_ENV] = priorRole;
    if (priorCampaign === undefined) delete process.env[CAMPAIGN_ENV];
    else process.env[CAMPAIGN_ENV] = priorCampaign;
  }
});

test("projected same-destination scene routes preserve exact optional travel through canonical invoke", async () => {
  const forwarded = [];
  const sceneEnvelope = contextReceipt("multi-route", {
    active_scene_id: "study",
    exits: [
      { to: "archive-scene", kind: "travel", open: true, travel_minutes: 5 },
      { to: "archive-scene", kind: "travel", open: true, travel_minutes: 10 },
      { to: "archive-scene", kind: "travel", open: true },
    ],
    time: { time_precision: "precise", local_datetime: "1920-10-12T10:00:00" },
    npcs_present: [],
    action_routes: [],
  });
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我选择去档案室的具体路线。" }],
    });
    await invokeCompat(h, "multi-scene", "scene.context");
    const discovery = JSON.parse((await h.tools.get("coc_discover").execute(
      "discover-multi-move",
      { operation: "state.move_scene" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(discovery.ok, true);
    assert.equal(Object.hasOwn(
      discovery.data.operation_card.parameters.properties,
      "scene_id",
    ), false);
    assert.deepEqual(
      discovery.data.operation_card.parameters.properties.candidate_id.enum,
      [
        "scene-route:archive-scene:travel:1",
        "scene-route:archive-scene:travel:2",
        "scene-route:archive-scene:travel:3",
      ],
    );
    await h.tools.get("coc_state_move_scene").execute(
      "multi-route-ten",
      { candidate_id: "scene-route:archive-scene:travel:2", reason: "走较长的回廊" },
      undefined,
      undefined,
      h.ctx,
    );
    assert.equal(forwarded.at(-1).arguments.scene_id, "archive-scene");
    assert.equal(forwarded.at(-1).arguments.travel_minutes, 10);
    assert.equal(Object.hasOwn(forwarded.at(-1).arguments, "candidate_id"), false);

    await invokeCompat(h, "multi-scene-refresh", "scene.context");
    await h.tools.get("coc_discover").execute(
      "discover-multi-move-refresh",
      { operation: "state.move_scene" },
      undefined,
      undefined,
      h.ctx,
    );
    await h.tools.get("coc_state_move_scene").execute(
      "multi-route-five",
      { candidate_id: "scene-route:archive-scene:travel:1", reason: "走近路" },
      undefined,
      undefined,
      h.ctx,
    );
    assert.equal(forwarded.at(-1).arguments.scene_id, "archive-scene");
    assert.equal(forwarded.at(-1).arguments.travel_minutes, 5);

    await invokeCompat(h, "multi-scene-untimed-refresh", "scene.context");
    const untimed = await h.tools.get("coc_state_move_scene").execute(
      "multi-route-untimed",
      { candidate_id: "scene-route:archive-scene:travel:3", reason: "走未标注时长的通路" },
      undefined,
      undefined,
      h.ctx,
    );
    const untimedEnvelope = JSON.parse(untimed.content[0].text);
    assert.equal(untimedEnvelope.isError, true);
    assert.equal(untimedEnvelope.error.code, "invalid_param");
    assert.equal(forwarded.at(-1).arguments.scene_id, "archive-scene");
    assert.equal(Object.hasOwn(forwarded.at(-1).arguments, "travel_minutes"), false);
  }, (_name, params) => {
    if (params.operation === "scene.context") return sceneEnvelope;
    if (params.operation === "state.move_scene") {
      forwarded.push(structuredClone(params));
      if (!Object.hasOwn(params.arguments, "travel_minutes")) {
        return {
          ok: false,
          isError: true,
          tool: params.operation,
          error: {
            code: "invalid_param",
            message: "multiple source-authored travel durations require travel_minutes",
          },
        };
      }
      assert.ok(Number.isInteger(params.arguments.travel_minutes));
      assert.ok(params.arguments.travel_minutes >= 0);
    }
    return { ok: true, tool: params.operation, data: { accepted: true } };
  });
});

test("zero-open scene receipt keeps move host-bound while canonical owns manual destination", async () => {
  const forwarded = [];
  const sceneEnvelope = contextReceipt("closed-only", {
    active_scene_id: "commission-briefing",
    exits: [{
      to: "newspaper-morgue",
      kind: "unlock",
      open: false,
      when: { kind: "clue_discovered", clue_id: "clue-knott-research-leads" },
    }],
    time: { time_precision: "precise", local_datetime: "1920-10-12T10:00:00" },
    npcs_present: [],
    action_routes: [],
  });
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我离开办公室，直接去报馆门口。" }],
    });
    await invokeCompat(h, "closed-scene", "scene.context");
    const discovery = JSON.parse((await h.tools.get("coc_discover").execute(
      "discover-manual-move",
      { operation: "state.move_scene" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(discovery.ok, true);
    const properties = discovery.data.operation_card.parameters.properties;
    for (const field of ["root", "campaign", "decision_id", "travel_minutes"]) {
      assert.equal(Object.hasOwn(properties, field), false, field);
    }
    assert.equal(Object.hasOwn(properties.scene_id, "enum"), false);
    assert.equal(latestWorkingSetAudit(h).schema_bytes, actualActiveSchemaBytes(h));

    const forged = JSON.parse((await h.tools.get("coc_state_move_scene").execute(
      "manual-move-forged",
      { scene_id: "newspaper-morgue", reason: "猜测耗时", travel_minutes: 35 },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(forged.ok, false);
    assert.equal(forged.isError, true);
    assert.equal(forged.error.code, "forged_host_argument");
    assert.equal(forwarded.length, 0, "forged travel must fail before MCP");

    const moved = JSON.parse((await h.tools.get("coc_state_move_scene").execute(
      "manual-move",
      { scene_id: "newspaper-morgue", reason: "去报馆门口" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(moved.ok, true);
    assert.equal(forwarded.length, 1);
    assert.equal(forwarded[0].arguments.scene_id, "newspaper-morgue");
    assert.equal(Object.hasOwn(forwarded[0].arguments, "travel_minutes"), false);
    assert.equal(forwarded[0].campaign, "tool-affordance-campaign");
    assert.match(forwarded[0].arguments.decision_id, /^pi-state-move_scene:/);
  }, (_name, params) => {
    if (params.operation === "scene.context") return sceneEnvelope;
    if (params.operation === "state.move_scene") {
      forwarded.push(structuredClone(params));
      return {
        ok: true,
        tool: params.operation,
        data: {
          from_scene_id: "commission-briefing",
          to_scene_id: params.arguments.scene_id,
          travel_minutes: 0,
          travel_time_source: "none",
        },
        warnings: ["authored gate is advisory; canonical movement accepted"],
      };
    }
    return { ok: true, tool: params.operation, data: {} };
  });
});

test("new invalid scene context revokes prior scene bindings before surfacing failure", async () => {
  const forwarded = [];
  let sceneEnvelope = contextReceipt("scene-valid", {
    active_scene_id: "hall",
    exits: [{ to: "old-route", kind: "travel", open: true, travel_minutes: 5 }],
    time: { time_precision: "precise", local_datetime: "1920-10-12T10:00:00" },
    npcs_present: [],
    action_routes: [],
  });
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我重新确认当前路线。" }],
    });
    await invokeCompat(h, "scene-valid", "scene.context");
    for (const operation of ["state.move_scene", "state.advance_time"]) {
      const discovery = JSON.parse((await h.tools.get("coc_discover").execute(
        `discover-${operation}`,
        { operation },
        undefined,
        undefined,
        h.ctx,
      )).content[0].text);
      assert.equal(discovery.ok, true);
    }
    assert.ok(h.active.at(-1).includes("coc_state_move_scene"));
    assert.ok(h.active.at(-1).includes("coc_state_advance_time"));

    sceneEnvelope = contextReceipt("scene-invalid-newer", {
      active_scene_id: "hall",
      exits: [{ to: "new-route", kind: "travel", open: true, travel_minutes: "5" }],
      time: { time_precision: "precise", local_datetime: "1920-10-12T10:01:00" },
      npcs_present: [],
      action_routes: [],
    });
    await assert.rejects(
      invokeCompat(h, "scene-invalid-newer", "scene.context"),
      (error) => error?.code === "binding_context_invalid",
    );

    assert.equal(h.active.at(-1).includes("coc_state_move_scene"), false);
    assert.equal(h.active.at(-1).includes("coc_state_advance_time"), false);
    // Registered model-owned schema: host-owned campaign/decision_id are
    // projected out; the binding candidate remains host-managed.
    const unboundMoveSchema = h.tools.get("coc_state_move_scene").parameters;
    assert.ok(Object.hasOwn(unboundMoveSchema.properties, "campaign") === false);
    assert.ok(Object.hasOwn(unboundMoveSchema.properties, "decision_id") === false);
    assert.equal(Object.hasOwn(unboundMoveSchema.properties, "candidate_id"), false);
    assert.equal(latestWorkingSetAudit(h).schema_bytes, actualActiveSchemaBytes(h));

    const beforeStaleMove = forwarded.filter((row) => (
      row.operation === "state.move_scene"
    )).length;
    const staleMove = JSON.parse((await h.tools.get("coc_state_move_scene").execute(
      "stale-after-invalid",
      { scene_id: "old-route", reason: "不得使用旧路线" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(staleMove.ok, false);
    assert.equal(staleMove.isError, true);
    assert.equal(staleMove.error.code, "binding_context_missing");
    assert.equal(forwarded.filter((row) => (
      row.operation === "state.move_scene"
    )).length, beforeStaleMove, "revoked route must fail before MCP");

    const beforeStaleTime = forwarded.filter((row) => (
      row.operation === "state.advance_time"
    )).length;
    const staleTime = JSON.parse((await h.tools.get("coc_state_advance_time").execute(
      "stale-time-after-invalid",
      { minutes: 5, reason: "不得沿用旧时钟上下文" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(staleTime.error.code, "binding_context_missing");
    assert.equal(forwarded.filter((row) => (
      row.operation === "state.advance_time"
    )).length, beforeStaleTime, "revoked clock must fail before MCP");

    sceneEnvelope = contextReceipt("scene-valid-recovery", {
      active_scene_id: "hall",
      exits: [{ to: "new-route", kind: "travel", open: true, travel_minutes: 7 }],
      time: { time_precision: "precise", local_datetime: "1920-10-12T10:02:00" },
      npcs_present: [],
      action_routes: [],
    });
    await invokeCompat(h, "scene-valid-recovery", "scene.context");
    const recoveryDiscovery = JSON.parse((await h.tools.get("coc_discover").execute(
      "discover-recovered-move",
      { operation: "state.move_scene" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.deepEqual(
      recoveryDiscovery.data.operation_card.parameters.properties.scene_id.enum,
      ["new-route"],
    );
  }, (_name, params) => {
    forwarded.push(structuredClone(params));
    if (params.operation === "scene.context") return sceneEnvelope;
    return { ok: true, tool: params.operation, data: { accepted: true } };
  });
});

test("initial invalid scene context keeps scene-derived tools unarmed", async () => {
  let forwardedMoves = 0;
  const invalidEnvelope = contextReceipt("scene-invalid-initial", {
    active_scene_id: "hall",
    exits: [{ to: "bad-route", open: true, travel_minutes: null }],
    time: { time_precision: "precise", local_datetime: "1920-10-12T10:00:00" },
    npcs_present: [],
    action_routes: [],
  });
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我先确认路线。" }],
    });
    await assert.rejects(
      invokeCompat(h, "scene-invalid-initial", "scene.context"),
      (error) => error?.code === "binding_context_invalid",
    );
    assert.equal(h.active.at(-1).includes("coc_state_move_scene"), false);
    const rejected = JSON.parse((await h.tools.get("coc_state_move_scene").execute(
      "initial-invalid-stale",
      { scene_id: "bad-route", reason: "无有效绑定" },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(rejected.error.code, "binding_context_missing");
    assert.equal(forwardedMoves, 0);
  }, (_name, params) => {
    if (params.operation === "scene.context") return invalidEnvelope;
    if (params.operation === "state.move_scene") forwardedMoves += 1;
    return { ok: true, tool: params.operation, data: { accepted: true } };
  });
});

test("scene binding re-arm rolls back atomically across host presentation failures", async (t) => {
  for (const stage of ["move-schema", "time-schema", "active-tools"]) {
    await t.test(stage, async () => {
      let faultArmed = false;
      let failureCount = 0;
      const fail = () => {
        failureCount += 1;
        throw new Error(failureCount === 1 ? `REGFAIL:${stage}` : `CLEANFAIL:${stage}`);
      };
      const hostFaults = {
        beforeRegisterTool(tool) {
          if (!faultArmed || failureCount >= 2) return;
          if (stage === "move-schema" && tool.name === "coc_state_move_scene") fail();
          if (stage === "time-schema" && tool.name === "coc_state_advance_time") fail();
        },
        beforeSetActiveTools() {
          if (faultArmed && failureCount < 2 && stage === "active-tools") fail();
        },
      };
      const forwarded = [];
      let sceneEnvelope = contextReceipt(`atomic-valid-${stage}`, {
        active_scene_id: "hall",
        exits: [{ to: "archive-scene", open: true, travel_minutes: 5 }],
        time: { time_precision: "precise", local_datetime: "1920-10-12T10:00:00" },
        npcs_present: [],
        action_routes: [],
      });
      await withPlayHarness(async (h) => {
        await h.emit("message_start", {
          role: "user",
          content: [{ type: "text", text: "我重新核对路线与时间。" }],
        });
        await invokeCompat(h, `atomic-valid-${stage}`, "scene.context");
        for (const operation of ["state.move_scene", "state.advance_time"]) {
          await h.tools.get("coc_discover").execute(
            `atomic-discover-${stage}-${operation}`,
            { operation },
            undefined,
            undefined,
            h.ctx,
          );
        }
        const staleMoveTool = h.tools.get("coc_state_move_scene");
        const staleTimeTool = h.tools.get("coc_state_advance_time");

        sceneEnvelope = contextReceipt(`atomic-invalid-${stage}`, {
          active_scene_id: "hall",
          exits: [{ to: "archive-scene", open: true, travel_minutes: "5" }],
          time: { time_precision: "precise", local_datetime: "1920-10-12T10:01:00" },
          npcs_present: [],
          action_routes: [],
        });
        await assert.rejects(
          invokeCompat(h, `atomic-invalid-${stage}`, "scene.context"),
          (error) => error?.code === "binding_context_invalid",
        );

        sceneEnvelope = contextReceipt(`atomic-rearm-fails-${stage}`, {
          active_scene_id: "hall",
          exits: [{ to: "archive-scene", open: true, travel_minutes: 7 }],
          time: { time_precision: "precise", local_datetime: "1920-10-12T10:02:00" },
          npcs_present: [],
          action_routes: [],
        });
        faultArmed = true;
        await assert.rejects(
          invokeCompat(h, `atomic-rearm-fails-${stage}`, "scene.context"),
          (error) => error?.message === `REGFAIL:${stage}`,
        );
        faultArmed = false;
        assert.equal(failureCount, 2, "primary and cleanup fault must both be exercised");

        const beforeMutation = forwarded.filter((row) => (
          row.operation === "state.move_scene" || row.operation === "state.advance_time"
        )).length;
        for (const [tool, id, args] of [
          [staleMoveTool, `atomic-stale-move-${stage}`, { scene_id: "archive-scene", reason: "旧 schema" }],
          [staleTimeTool, `atomic-stale-time-${stage}`, { minutes: 5, reason: "旧 schema" }],
        ]) {
          const rejected = JSON.parse((await tool.execute(
            id,
            args,
            undefined,
            undefined,
            h.ctx,
          )).content[0].text);
          assert.equal(rejected.error.code, "binding_context_missing");
        }
        assert.equal(forwarded.filter((row) => (
          row.operation === "state.move_scene" || row.operation === "state.advance_time"
        )).length, beforeMutation, "partial re-arm must not reach MCP");
        assert.equal(h.active.at(-1).includes("coc_state_move_scene"), false);
        assert.equal(h.active.at(-1).includes("coc_state_advance_time"), false);
        for (const name of ["coc_state_move_scene", "coc_state_advance_time"]) {
          const schema = h.tools.get(name).parameters;
          // Model-owned registration keeps transport identity projected out.
          assert.ok(!Object.hasOwn(schema.properties, "campaign"), name);
          assert.ok(!Object.hasOwn(schema.properties, "decision_id"), name);
        }

        sceneEnvelope = contextReceipt(`atomic-rearm-success-${stage}`, {
          active_scene_id: "hall",
          exits: [{ to: "archive-scene", open: true, travel_minutes: 9 }],
          time: { time_precision: "precise", local_datetime: "1920-10-12T10:03:00" },
          npcs_present: [],
          action_routes: [],
        });
        await invokeCompat(h, `atomic-rearm-success-${stage}`, "scene.context");
        for (const operation of ["state.move_scene", "state.advance_time"]) {
          const discovery = JSON.parse((await h.tools.get("coc_discover").execute(
            `atomic-rediscover-${stage}-${operation}`,
            { operation },
            undefined,
            undefined,
            h.ctx,
          )).content[0].text);
          assert.equal(discovery.ok, true);
          assert.equal(Object.hasOwn(
            discovery.data.operation_card.parameters.properties,
            "campaign",
          ), false);
        }
        await h.tools.get("coc_state_move_scene").execute(
          `atomic-move-success-${stage}`,
          { scene_id: "archive-scene", reason: "完整 re-arm 后执行" },
          undefined,
          undefined,
          h.ctx,
        );
        assert.equal(
          forwarded.filter((row) => row.operation === "state.move_scene").at(-1)
            .arguments.travel_minutes,
          9,
        );
      }, (_name, params) => {
        forwarded.push(structuredClone(params));
        if (params.operation === "scene.context") return sceneEnvelope;
        return { ok: true, tool: params.operation, data: { accepted: true } };
      }, hostFaults);
    });
  }
});

test("scene, precise-clock, and combat cards bind discovered production tools and reject stale use", async () => {
  const forwarded = [];
  let sceneEnvelope = contextReceipt("scene-a", {
    active_scene_id: "study",
    exits: [
      { to: "archive-scene", open: true, travel_minutes: 35 },
      { to: "sealed-cellar", open: false, travel_minutes: 5 },
    ],
    time: { time_precision: "precise", local_datetime: "1920-10-12T10:00:00" },
    npcs_present: [{ npc_id: "walter-corbitt" }],
    action_routes: [{
      route_id: "floating-knife",
      resolution_kind: "combat_engagement",
    }],
  });
  const combatEnvelope = {
    ok: true,
    tool: "combat.context",
    wire: { full_result_sha256: `sha256:${"c".repeat(64)}` },
    cache: { revision: "combat-context:round-2" },
    data: {
      active: true,
      pending_defense: null,
      combat: { value: { combat_id: "corbitt", revision: 2 } },
    },
  };
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我在书房判断路线和威胁。" }],
    });

    await invokeCompat(h, "scene-a", "scene.context");
    const moveDiscovery = JSON.parse((await h.tools.get("coc_discover").execute(
      "discover-move", { operation: "state.move_scene" }, undefined, undefined, h.ctx,
    )).content[0].text);
    assert.equal(moveDiscovery.ok, true);
    assert.deepEqual(moveDiscovery.data.operation_card.parameters.properties.scene_id.enum, ["archive-scene"]);
    for (const field of ["root", "campaign", "decision_id", "travel_minutes"]) {
      assert.equal(Object.hasOwn(
        moveDiscovery.data.operation_card.parameters.properties,
        field,
      ), false, field);
    }
    assert.equal(latestWorkingSetAudit(h).schema_bytes, actualActiveSchemaBytes(h));
    assert.match(latestWorkingSetAudit(h).revision, /:schemas-[a-f0-9]{24}$/);
    const armedMoveRevision = latestWorkingSetAudit(h).revision;
    assert.ok(h.active.at(-1).includes("coc_state_move_scene"));
    const moved = JSON.parse((await h.tools.get("coc_state_move_scene").execute(
      "move-bound", { scene_id: "archive-scene", reason: "去档案室" },
      undefined, undefined, h.ctx,
    )).content[0].text);
    assert.equal(moved.ok, true);
    const moveForwarded = forwarded.find((row) => row.operation === "state.move_scene");
    assert.equal(moveForwarded.arguments.travel_minutes, 35);
    assert.equal(moveForwarded.campaign, "tool-affordance-campaign");
    assert.match(moveForwarded.arguments.decision_id, /^pi-state-move_scene:/);
    assert.equal(latestWorkingSetAudit(h).schema_bytes, actualActiveSchemaBytes(h));
    assert.notEqual(latestWorkingSetAudit(h).revision, armedMoveRevision);
    assert.ok(
      h.active.at(-1).includes("coc_state_move_scene"),
      "retained registration stays projected after its binding is cleared",
    );

    sceneEnvelope = contextReceipt("scene-b", {
      active_scene_id: "archive-scene",
      exits: [{ to: "street", open: true }],
      time: { time_precision: "precise", local_datetime: "1920-10-12T10:35:00" },
      npcs_present: [{ npc_id: "walter-corbitt" }],
      action_routes: [{
        route_id: "floating-knife",
        resolution_kind: "combat_engagement",
      }],
    });
    await invokeCompat(h, "scene-b", "scene.context");
    const timeDiscovery = JSON.parse((await h.tools.get("coc_discover").execute(
      "discover-time", { operation: "state.advance_time" }, undefined, undefined, h.ctx,
    )).content[0].text);
    assert.equal(timeDiscovery.ok, true);
    for (const field of ["root", "campaign", "decision_id", "day_phase_after", "display_after"]) {
      assert.equal(Object.hasOwn(
        timeDiscovery.data.operation_card.parameters.properties,
        field,
      ), false, field);
    }
    const advanced = JSON.parse((await h.tools.get("coc_state_advance_time").execute(
      "time-bound", { minutes: 10, reason: "检查档案耗时" },
      undefined, undefined, h.ctx,
    )).content[0].text);
    assert.equal(advanced.ok, true);
    const timeForwarded = forwarded.find((row) => row.operation === "state.advance_time");
    assert.equal(timeForwarded.arguments.minutes, 10);
    assert.equal(Object.hasOwn(timeForwarded.arguments, "day_phase_after"), false);

    sceneEnvelope = contextReceipt("scene-c", {
      active_scene_id: "cellar",
      exits: [{ to: "stairs", open: true }],
      time: { time_precision: "imprecise", local_datetime: null },
      npcs_present: [{ npc_id: "walter-corbitt" }],
      action_routes: [{
        route_id: "floating-knife",
        resolution_kind: "combat_engagement",
      }],
    });
    await invokeCompat(h, "scene-c", "scene.context");
    await invokeCompat(h, "combat-context", "combat.context");
    const combatDiscovery = JSON.parse((await h.tools.get("coc_discover").execute(
      "discover-combat", { operation: "combat.resolve" }, undefined, undefined, h.ctx,
    )).content[0].text);
    assert.equal(combatDiscovery.ok, true);
    assert.deepEqual(
      combatDiscovery.data.operation_card.parameters.properties.candidate_id.enum,
      ["attack:walter-corbitt", "combat-route:floating-knife"],
    );
    for (const field of ["root", "campaign", "decision_id", "target_npc_id", "affordance_id"]) {
      assert.equal(Object.hasOwn(
        combatDiscovery.data.operation_card.parameters.properties,
        field,
      ), false, field);
    }
    const combat = JSON.parse((await h.tools.get("coc_combat_resolve").execute(
      "combat-bound", { candidate_id: "attack:walter-corbitt" },
      undefined, undefined, h.ctx,
    )).content[0].text);
    assert.equal(combat.ok, true);
    const combatForwarded = forwarded.find((row) => row.operation === "combat.resolve");
    assert.equal(combatForwarded.arguments.target_npc_id, "walter-corbitt");
    assert.equal(Object.hasOwn(combatForwarded.arguments, "candidate_id"), false);

    sceneEnvelope = contextReceipt("scene-stale-a", {
      active_scene_id: "hall",
      exits: [{ to: "old-route", open: true, travel_minutes: 5 }],
      time: { time_precision: "imprecise", local_datetime: null },
      npcs_present: [],
      action_routes: [],
    });
    await invokeCompat(h, "scene-stale-a", "scene.context");
    await h.tools.get("coc_discover").execute(
      "discover-stale-move", { operation: "state.move_scene" }, undefined, undefined, h.ctx,
    );
    sceneEnvelope = contextReceipt("scene-stale-b", {
      active_scene_id: "hall",
      exits: [{ to: "new-route", open: true, travel_minutes: 7 }],
      time: { time_precision: "imprecise", local_datetime: null },
      npcs_present: [],
      action_routes: [],
    });
    await invokeCompat(h, "scene-stale-b", "scene.context");
    const beforeStale = forwarded.length;
    const candidateStale = JSON.parse((await h.tools.get("coc_state_move_scene").execute(
      "stale-candidate", { scene_id: "old-route", reason: "旧路线" },
      undefined, undefined, h.ctx,
    )).content[0].text);
    assert.equal(candidateStale.ok, false);
    assert.equal(candidateStale.isError, true);
    assert.equal(candidateStale.error.code, "semantic_candidate_stale");
    assert.equal(candidateStale.error.class, "dynamic_candidate");
    assert.equal(candidateStale.error.allowed_next_actions[0].operation, "scene.context");
    assert.equal(forwarded.length, beforeStale, "stale candidate must fail before MCP");

    await invokeCompat(h, "journal-stage-change", "state.journal", {
      summary: "阶段推进：这一轮调查整理完成。",
    });
    const bindingStale = JSON.parse((await h.tools.get("coc_state_move_scene").execute(
      "stale-binding", { scene_id: "new-route", reason: "阶段已变" },
      undefined, undefined, h.ctx,
    )).content[0].text);
    assert.equal(bindingStale.ok, false);
    assert.equal(bindingStale.isError, true);
    assert.equal(bindingStale.error.code, "binding_context_stale");
    assert.equal(bindingStale.error.recoverable_by, "host_binding_refresh");
    assert.match(bindingStale.error.automatic_action, /scene\.context/);
    assert.equal(forwarded.length, beforeStale + 1, "only journal may reach MCP after stale probes");
  }, (_name, params) => {
    forwarded.push(structuredClone(params));
    if (params.operation === "scene.context") return sceneEnvelope;
    if (params.operation === "combat.context") return combatEnvelope;
    if (params.operation === "state.journal") {
      return { ok: true, tool: "state.journal", data: { turn_id: "turn-stage-change" } };
    }
    return { ok: true, tool: params.operation, data: { accepted: true } };
  });
});

test("late canonical result cannot mutate a restarted Pi session", async () => {
  let releaseJournal;
  const pendingJournal = new Promise((resolve) => { releaseJournal = resolve; });
  const priorRole = process.env[ROLE_ENV];
  const priorCampaign = process.env[CAMPAIGN_ENV];
  process.env[ROLE_ENV] = "play";
  process.env[CAMPAIGN_ENV] = "tool-affordance-campaign";
  try {
    const h = makeHarness((_name, params) => {
      if (params.operation === "session.resume") {
        return { ok: true, tool: "session.resume", data: { mode: "awaiting_player", next_operations: [] } };
      }
      if (params.operation === "state.journal") return pendingJournal;
      return { ok: true, tool: params.operation, data: {} };
    });
    await h.start();
    await invokeCompat(h, "resume-live", "session.resume");
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "旧会话输入。" }],
    });
    const pending = invokeCompat(h, "late-journal", "state.journal");
    await new Promise((resolve) => setImmediate(resolve));
    await h.shutdown();
    const restartBoundary = h.appended.length;
    await h.start();
    releaseJournal({
      ok: true,
      tool: "state.journal",
      data: { turn_id: "turn-from-closed-session" },
    });
    await pending;
    assert.deepEqual(
      h.appended.slice(restartBoundary).filter((row) => (
        row.type === "coc-canonical-turn-progress"
      )),
      [],
    );
    assert.deepEqual(h.active.at(-1), []);
  } finally {
    if (priorRole === undefined) delete process.env[ROLE_ENV];
    else process.env[ROLE_ENV] = priorRole;
    if (priorCampaign === undefined) delete process.env[CAMPAIGN_ENV];
    else process.env[CAMPAIGN_ENV] = priorCampaign;
  }
});

test("malformed output-context and finalization successes fault without progress", async () => {
  for (const operation of ["turn.output_context", "turn.finalize"]) {
    await withPlayHarness(async (h) => {
      await h.emit("message_start", {
        role: "user",
        content: [{ type: "text", text: `验证 ${operation}。` }],
      });
      // The finalize coverage obligation resolves through the registry, so
      // observe one real roll first and reference its projected handle.
      let obligationHandle = null;
      if (operation === "turn.finalize") {
        const rollRoute = h.clientCalls;
        const rollResult = JSON.parse((await invokeCompat(
          h, `roll-for-${operation}`, "rules.roll",
          {
            difficulty: "regular",
            goal: "推开通往书房的门",
            stakes: { on_success: "门开了", on_failure: "门纹丝不动" },
            difficulty_basis: "keeper_judgment",
            decision_id: "roll-malformed-finalize-probe",
          },
        )).content[0].text);
        obligationHandle = rollResult.data?.roll_id;
        assert.ok(
          typeof obligationHandle === "string" && obligationHandle.startsWith("roll:"),
          JSON.stringify(rollResult),
        );
        assert.notEqual(rollRoute, null);
      }
      const modelOwnedSettleArgs = operation === "turn.finalize"
        ? {
          draft: "探针草稿：你推开书房的门。",
          coverage: [{
            obligation_id: obligationHandle,
            player_input_handling: "not_applicable",
            realization: "concealed_no_player_visible_beat",
            exact_excerpt: null,
            action_realization: null,
            causal_explanation: null,
            exceptional_beat: null,
            persona_fit: null,
            response: null,
          }],
        }
        : {};
      const response = JSON.parse((await invokeCompat(
        h, `malformed-${operation}`, operation, modelOwnedSettleArgs,
      )).content[0].text);
      assert.equal(response.ok, false);
      assert.equal(response.isError, true);
      assert.equal(
        response.error.code,
        operation === "turn.finalize"
          ? "finalization_receipt_invalid"
          : "output_context_receipt_invalid",
      );
      const stages = h.appended
        .filter((row) => row.type === "coc-canonical-turn-progress")
        .map((row) => row.value.stage);
      assert.equal(stages.at(-1), "faulted");
      assert.equal(stages.includes("finalized"), false);
      assert.equal(stages.includes("output_context_ready"), false);
      assert.deepEqual(h.active.at(-1), ["coc_session_resume"]);
    }, (_name, params) => {
      if (params.operation === "rules.roll") {
        return {
          ok: true,
          tool: "rules.roll",
          data: {
            roll_id: "toolbox-affordance-malformed-000001",
            skill: "侦查",
            passed: true,
            resolution_context: { attempt_id: "attempt-affordance-malformed" },
          },
        };
      }
      if (params.operation === operation) {
        return operation === "turn.finalize"
          ? {
              ok: true,
              tool: operation,
              data: { rendered_text_sha256: `sha256:${"f".repeat(64)}` },
            }
          : {
              ok: true,
              tool: operation,
              data: { turn_id: "turn-incomplete-without-source" },
            };
      }
      return { ok: true, tool: params.operation, data: {} };
    });
  }
});

const completeOutputContextData = ({
  turnId,
  agencyReviewRequired,
  reviewRevision = 1,
  finalizeRevision = 1,
  includeReviewCard = agencyReviewRequired,
}) => ({
  turn_id: turnId,
  source_digest: `sha256:source-${turnId}`,
  settlement_snapshot_id: `turn-settlement-v1:${turnId}`,
  mechanics_bundle_sha256: `sha256:${"8".repeat(64)}`,
  obligations: [],
  mechanics_summary: {
    public_check: [], state_delta: [], exceptional_effect: [],
    concealed_consequence: [],
  },
  contract_projection: {
    agency_review_required: agencyReviewRequired,
    agency_authority: { pc_subject_refs: ["pc:receipt-probe"] },
  },
  ...(includeReviewCard
    ? {
        agency_review_operation: {
          operation: "narration.review",
          prefilled_arguments: { revision: reviewRevision },
        },
      }
    : {}),
  finalize_operation: {
    operation: "turn.finalize",
    invoke_via: agencyReviewRequired ? "coc_turn_finalize" : "coc_invoke",
    prefilled_arguments: { revision: finalizeRevision },
  },
});

test("non-review output-context accepts the canonical finalize-card revision", async () => {
  let compilerObservations = 0;
  const compiler = new PiStateClaimCompiler(async () => {
    throw new Error("non-review output must not compile review state claims");
  });
  compiler.observeOutputContext = () => { compilerObservations += 1; };
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "验证无需审查的结算上下文。" }],
    });
    const journal = JSON.parse((await invokeCompat(
      h, "non-review-journal", "state.journal",
      { summary: "无需审查的结算：整理这一轮的线索与行动。" },
    )).content[0].text);
    assert.equal(journal.ok, true);

    const outputContext = JSON.parse((await invokeCompat(
      h, "non-review-context", "turn.output_context",
    )).content[0].text);
    assert.equal(outputContext.ok, true, JSON.stringify(outputContext));
    const stages = h.appended
      .filter((row) => row.type === "coc-canonical-turn-progress")
      .map((row) => row.value.stage);
    assert.equal(stages.at(-1), "output_context_ready");
    assert.equal(stages.includes("faulted"), false);
    assert.equal(compilerObservations, 0);
    assert.equal(h.appended.some((row) => (
      row.type === "coc-typed-tool-binding"
      && row.value.operation === "narration.review"
    )), false);
    assert.ok(h.active.at(-1).includes("coc_invoke"), JSON.stringify(h.active.at(-1)));
    assert.ok(!h.active.at(-1).includes("coc_narration_review"));
    assert.ok(!h.active.at(-1).includes("coc_turn_finalize"));
  }, (_name, params) => {
    if (params.operation === "state.journal") {
      return { ok: true, tool: params.operation, data: { turn_id: "turn-non-review" } };
    }
    if (params.operation === "turn.output_context") {
      return {
        ok: true,
        tool: params.operation,
        data: completeOutputContextData({
          turnId: "turn-non-review",
          agencyReviewRequired: false,
        }),
      };
    }
    return { ok: true, tool: params.operation, data: {} };
  }, {}, compiler);
});

test("review-required output-context without its review card faults closed", async () => {
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "验证审查卡缺失。" }],
    });
    await invokeCompat(h, "missing-review-journal", "state.journal");
    const response = JSON.parse((await invokeCompat(
      h, "missing-review-context", "turn.output_context",
    )).content[0].text);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "output_context_receipt_invalid");
    const stages = h.appended
      .filter((row) => row.type === "coc-canonical-turn-progress")
      .map((row) => row.value.stage);
    assert.equal(stages.at(-1), "faulted");
    assert.equal(stages.includes("output_context_ready"), false);
  }, (_name, params) => {
    if (params.operation === "state.journal") {
      return { ok: true, tool: params.operation, data: { turn_id: "turn-missing-review" } };
    }
    if (params.operation === "turn.output_context") {
      return {
        ok: true,
        tool: params.operation,
        data: completeOutputContextData({
          turnId: "turn-missing-review",
          agencyReviewRequired: true,
          includeReviewCard: false,
        }),
      };
    }
    return { ok: true, tool: params.operation, data: {} };
  });
});

test("review-required output-context rejects mismatched operation-card revisions", async () => {
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "验证审查与终结版本不一致。" }],
    });
    await invokeCompat(h, "mismatch-review-journal", "state.journal");
    const response = JSON.parse((await invokeCompat(
      h, "mismatch-review-context", "turn.output_context",
    )).content[0].text);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "output_context_receipt_invalid");
    assert.equal(
      h.appended
        .filter((row) => row.type === "coc-canonical-turn-progress")
        .at(-1)?.value.stage,
      "faulted",
    );
  }, (_name, params) => {
    if (params.operation === "state.journal") {
      return { ok: true, tool: params.operation, data: { turn_id: "turn-revision-mismatch" } };
    }
    if (params.operation === "turn.output_context") {
      return {
        ok: true,
        tool: params.operation,
        data: completeOutputContextData({
          turnId: "turn-revision-mismatch",
          agencyReviewRequired: true,
          reviewRevision: 2,
          finalizeRevision: 1,
        }),
      };
    }
    return { ok: true, tool: params.operation, data: {} };
  });
});

test("non-review output-context rejects any agency-review card presence", async (t) => {
  for (const [name, agencyReviewOperation] of [
    ["object-valued", {
      operation: "narration.review",
      prefilled_arguments: { revision: 1 },
    }],
    ["malformed", "unexpected-review-card"],
  ]) {
    await t.test(name, async () => {
      await withPlayHarness(async (h) => {
        await h.emit("message_start", {
          role: "user",
          content: [{ type: "text", text: `验证非审查回执拒绝 ${name} 审查卡。` }],
        });
        await invokeCompat(h, `extra-review-journal-${name}`, "state.journal");
        const response = JSON.parse((await invokeCompat(
          h, `extra-review-context-${name}`, "turn.output_context",
        )).content[0].text);
        assert.equal(response.ok, false);
        assert.equal(response.error.code, "output_context_receipt_invalid");
        assert.equal(
          h.appended
            .filter((row) => row.type === "coc-canonical-turn-progress")
            .at(-1)?.value.stage,
          "faulted",
        );
      }, (_name, params) => {
        if (params.operation === "state.journal") {
          return { ok: true, tool: params.operation, data: { turn_id: `turn-${name}` } };
        }
        if (params.operation === "turn.output_context") {
          const data = completeOutputContextData({
            turnId: `turn-${name}`,
            agencyReviewRequired: false,
          });
          data.agency_review_operation = agencyReviewOperation;
          return { ok: true, tool: params.operation, data };
        }
        return { ok: true, tool: params.operation, data: {} };
      });
    });
  }
});

test("output-context operation cards require exact names and positive integer revisions", async (t) => {
  const cases = [
    {
      name: "wrong-finalize-operation",
      agencyReviewRequired: false,
      mutate(data) { data.finalize_operation.operation = "turn.output_context"; },
    },
    {
      name: "wrong-review-operation",
      agencyReviewRequired: true,
      mutate(data) { data.agency_review_operation.operation = "turn.finalize"; },
    },
    {
      name: "string-revision",
      agencyReviewRequired: true,
      mutate(data) {
        data.agency_review_operation.prefilled_arguments.revision = "1";
        data.finalize_operation.prefilled_arguments.revision = "1";
      },
    },
    {
      name: "zero-revision",
      agencyReviewRequired: false,
      mutate(data) { data.finalize_operation.prefilled_arguments.revision = 0; },
    },
    {
      name: "negative-revision",
      agencyReviewRequired: true,
      mutate(data) {
        data.agency_review_operation.prefilled_arguments.revision = -1;
        data.finalize_operation.prefilled_arguments.revision = -1;
      },
    },
  ];
  for (const probe of cases) {
    await t.test(probe.name, async () => {
      await withPlayHarness(async (h) => {
        await h.emit("message_start", {
          role: "user",
          content: [{ type: "text", text: `验证严格回执：${probe.name}。` }],
        });
        await invokeCompat(h, `strict-journal-${probe.name}`, "state.journal");
        const response = JSON.parse((await invokeCompat(
          h, `strict-context-${probe.name}`, "turn.output_context",
        )).content[0].text);
        assert.equal(response.ok, false);
        assert.equal(response.error.code, "output_context_receipt_invalid");
      }, (_name, params) => {
        if (params.operation === "state.journal") {
          return {
            ok: true,
            tool: params.operation,
            data: { turn_id: `turn-${probe.name}` },
          };
        }
        if (params.operation === "turn.output_context") {
          const data = completeOutputContextData({
            turnId: `turn-${probe.name}`,
            agencyReviewRequired: probe.agencyReviewRequired,
          });
          probe.mutate(data);
          return { ok: true, tool: params.operation, data };
        }
        return { ok: true, tool: params.operation, data: {} };
      });
    });
  }
});

test("faulted turn advances only through the exact session-resume recovery receipt", async () => {
  // Current contract: the only authorized exit from the faulted stage is the
  // validated turn.output_context receipt (authorized_fault_recovery_receipt);
  // any other step — e.g. state.journal — is rejected as regressive until the
  // exact receipt arrives. The pending-finalization resume routes the fault
  // lane to that exact first host step (never straight to turn.finalize).
  const compiler = new PiStateClaimCompiler(async () => {
    throw new PiStateClaimCompilerFailure(
      "state_claim_response_invalid",
      "protocol_invalid",
      { provider: "probe", id: "probe", api: "openai-responses" },
      1,
    );
  });
  const priorRole = process.env[ROLE_ENV];
  const priorCampaign = process.env[CAMPAIGN_ENV];
  process.env[ROLE_ENV] = "play";
  process.env[CAMPAIGN_ENV] = "tool-affordance-campaign";
  try {
    let recoveryResume = false;
    const h = makeHarness((_name, params) => {
      if (params.operation === "session.resume") {
        return recoveryResume
          ? {
              ok: true,
              tool: "session.resume",
              data: {
                schema_version: 1,
                campaign_id: "tool-affordance-campaign",
                mode: "pending_finalization",
                next_operations: ["turn.finalize"],
              },
            }
          : { ok: true, tool: "session.resume", data: { mode: "awaiting_player", next_operations: [] } };
      }
      if (params.operation === "turn.output_context") {
        return {
          ok: true,
          tool: "turn.output_context",
          data: {
            turn_id: "turn-recovery-fault",
            source_digest: `sha256:${"f".repeat(64)}`,
            settlement_snapshot_id: "turn-settlement-v1:recovery-fault",
            mechanics_bundle_sha256: `sha256:${"0".repeat(64)}`,
            obligations: [],
            mechanics_summary: {
              public_check: [], state_delta: [], exceptional_effect: [],
              concealed_consequence: [],
            },
            contract_projection: {
              agency_review_required: true,
              agency_authority: { pc_subject_refs: ["pc:probe"] },
            },
            agency_review_operation: {
              operation: "narration.review",
              invoke_via: "coc_narration_review",
              prefilled_arguments: {
                turn_id: "turn-recovery-fault",
                source_digest: `sha256:${"f".repeat(64)}`,
                revision: 1,
              },
              missing_arguments: [
                "decision_id", "draft_text", "findings",
                "state_authority_review",
              ],
            },
            finalize_operation: {
              operation: "turn.finalize",
              invoke_via: "coc_turn_finalize",
              prefilled_arguments: { revision: 1 },
              missing_arguments: ["draft", "narration_review_id", "agency_claims"],
            },
          },
        };
      }
      if (params.operation === "state.journal") {
        return { ok: true, tool: "state.journal", data: { turn_id: "turn-recovery-fault" } };
      }
      return { ok: true, tool: params.operation, data: {} };
    }, compiler);
    await h.start();
    await invokeCompat(h, "resume-live", "session.resume");
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "继续调查。" }],
    });
    await invokeCompat(h, "recovery-context", "turn.output_context");
    // Host-owned settle identity (turn_id/source_digest/revision) is bound by
    // the gateway; the model payload carries only the semantic review shape.
    const reviewResponse = JSON.parse((await invokeCompat(
      h,
      "recovery-review",
      "narration.review",
      {
        draft_text: "调查继续。",
        findings: [],
        state_authority_review: {
          disposition: "no_player_state_change_claimed",
          reason: "无状态变化。",
          claims: [],
        },
      },
    )).content[0].text);
    assert.equal(reviewResponse.error.code, "state_claim_compiler_invalid");
    const progressRows = () => h.appended
      .filter((row) => row.type === "coc-canonical-turn-progress")
      .map((row) => row.value);
    assert.equal(progressRows().at(-1).stage, "faulted");
    assert.equal(
      h.sent.filter((row) => (
        row.message.customType === main.TURN_PROCESSING_FAULT_CUSTOM_TYPE
      )).length,
      1,
    );
    // From faulted, a non-receipt step never advances: state.journal is
    // rejected as regressive (the rejected row records the attempted
    // candidate stage) and the fault stays latched.
    recoveryResume = true;
    await invokeCompat(h, "journal-recovery", "state.journal", {
      summary: "恢复阶段：以日志推进回合阶段。",
    });
    assert.equal(progressRows().at(-1).status, "rejected");
    assert.equal(progressRows().at(-1).reason, "turn_stage_regressed");
    assert.equal(progressRows().at(-1).stage, "journaled");
    // The exact session.resume recovery receipt routes the lane to the
    // output-context refresh, never straight to turn.finalize.
    await invokeCompat(h, "resume-fault", "session.resume");
    assert.ok(h.active.at(-1).includes("coc_turn_output_context"));
    assert.ok(!h.active.at(-1).includes("coc_state_journal"));
    assert.ok(!h.active.at(-1).includes("coc_turn_finalize"));
    // The exact validated output-context receipt advances the faulted turn
    // with the authorized recovery reason and reprojects the review tool.
    await invokeCompat(h, "recovery-context-2", "turn.output_context");
    const authorized = progressRows().at(-1);
    assert.equal(authorized.status, "advanced");
    assert.equal(authorized.stage, "output_context_ready");
    assert.equal(authorized.reason, "authorized_fault_recovery_receipt");
    assert.equal(authorized.recovery_operation, "turn.output_context");
    assert.ok(h.active.at(-1).includes("coc_narration_review"));
    assert.ok(!h.active.at(-1).includes("coc_turn_output_context"));
    assert.equal(
      h.sent.filter((row) => (
        row.message.customType === main.TURN_PROCESSING_FAULT_CUSTOM_TYPE
      )).length,
      1,
      "the authorized receipt clears the fault without a second fault notice",
    );
  } finally {
    if (priorRole === undefined) delete process.env[ROLE_ENV];
    else process.env[ROLE_ENV] = priorRole;
    if (priorCampaign === undefined) delete process.env[CAMPAIGN_ENV];
    else process.env[CAMPAIGN_ENV] = priorCampaign;
  }
});

// The explicit coc_invoke output-context lane binds the invocation campaign
// before authorizing the faulted→output_context_ready recovery: a fully
// valid receipt for ANOTHER campaign validates nothing, accepts no
// cards/refresh, and leaves the fault latched; the matching campaign
// authorizes the exact recovery receipt as before.
test("explicit output-context receipt campaign binds fault recovery authorization", async () => {
  const compiler = new PiStateClaimCompiler(async () => {
    throw new PiStateClaimCompilerFailure(
      "state_claim_response_invalid",
      "protocol_invalid",
      { provider: "probe", id: "probe", api: "openai-responses" },
      1,
    );
  });
  const priorRole = process.env[ROLE_ENV];
  const priorCampaign = process.env[CAMPAIGN_ENV];
  process.env[ROLE_ENV] = "play";
  process.env[CAMPAIGN_ENV] = "tool-affordance-campaign";
  try {
    // Fully valid canonical receipt; only campaign_id varies between the
    // matching and mismatched variants.
    const frozenReceiptFor = (campaignId) => {
      const reviewDecisionId = "pi-narration-review:campaign-binding:revision-1";
      const draftText = "诺特仍坐在桌后等你的答复。";
      const receipt = {
        schema_version: 1,
        kind: "pending_narration_draft",
        secrecy: "keeper_only",
        campaign_id: campaignId,
        receipt_id: `pending-narration-draft:${reviewDecisionId}:revision-1`,
        review_decision_id: reviewDecisionId,
        review_id: "narration-review-v1:campaign-binding-1",
        turn_id: "turn-recovery-fault",
        source_digest: `sha256:${"f".repeat(64)}`,
        revision: 1,
        draft_sha256: canonicalDigest(draftText),
        draft_text: draftText,
        draft_utf8_bytes: Buffer.byteLength(draftText, "utf8"),
        review_digest: `sha256:${"a1".repeat(32)}`,
        request_digest: `sha256:${"b1".repeat(32)}`,
        producer_kind: "narration_review_submission",
        source_operation: "narration.review",
        materialization_decision_id: reviewDecisionId,
        provenance: { kind: "direct_review_submission" },
      };
      receipt.receipt_digest = canonicalDigest(receipt);
      return receipt;
    };
    // Host-owned settle identity (turn_id/source_digest/revision) is bound
    // by the gateway; the model payload carries only the semantic shape.
    const reviewArguments = {
      draft_text: "调查继续。",
      findings: [],
      state_authority_review: {
        disposition: "no_player_state_change_claimed",
        reason: "无状态变化。",
        claims: [],
      },
    };
    const driveToFaultedAndRefresh = async (receiptCampaign) => {
      let recoveryResume = false;
      const h = makeHarness((_name, params) => {
        if (params.operation === "session.resume") {
          return recoveryResume
            ? {
                ok: true,
                tool: "session.resume",
                data: {
                  schema_version: 1,
                  campaign_id: "tool-affordance-campaign",
                  mode: "pending_finalization",
                  next_operations: ["turn.finalize"],
                },
              }
            : { ok: true, tool: "session.resume", data: { mode: "awaiting_player", next_operations: [] } };
        }
        if (params.operation === "turn.output_context") {
          return {
            ok: true,
            tool: "turn.output_context",
            data: {
              turn_id: "turn-recovery-fault",
              source_digest: `sha256:${"f".repeat(64)}`,
              settlement_snapshot_id: "turn-settlement-v1:recovery-fault",
              mechanics_bundle_sha256: `sha256:${"0".repeat(64)}`,
              obligations: [],
              mechanics_summary: {
                public_check: [], state_delta: [], exceptional_effect: [],
                concealed_consequence: [],
              },
              contract_projection: {
                agency_review_required: true,
                agency_authority: { pc_subject_refs: ["pc:probe"] },
              },
              frozen_narration_draft: frozenReceiptFor(receiptCampaign),
              agency_review_operation: {
                operation: "narration.review",
                invoke_via: "coc_narration_review",
                prefilled_arguments: {
                  turn_id: "turn-recovery-fault",
                  source_digest: `sha256:${"f".repeat(64)}`,
                  revision: 1,
                },
                missing_arguments: [
                  "decision_id", "draft_text", "findings",
                  "state_authority_review",
                ],
              },
              finalize_operation: {
                operation: "turn.finalize",
                invoke_via: "coc_turn_finalize",
                prefilled_arguments: { revision: 1 },
                missing_arguments: ["draft", "narration_review_id", "agency_claims"],
              },
            },
          };
        }
        return { ok: true, tool: params.operation, data: {} };
      }, compiler);
      await h.start();
      await invokeCompat(h, "resume-live", "session.resume");
      await h.emit("message_start", {
        role: "user",
        content: [{ type: "text", text: "继续调查。" }],
      });
      await invokeCompat(h, "recovery-context", "turn.output_context");
      const reviewResponse = JSON.parse((await invokeCompat(
        h,
        "recovery-review",
        "narration.review",
        reviewArguments,
      )).content[0].text);
      assert.equal(reviewResponse.error.code, "state_claim_compiler_invalid");
      recoveryResume = true;
      await invokeCompat(h, "resume-fault", "session.resume");
      await invokeCompat(h, "recovery-context-2", "turn.output_context");
      return h;
    };
    const progressRows = (h) => h.appended
      .filter((row) => row.type === "coc-canonical-turn-progress")
      .map((row) => row.value);
    // Correct campaign: the exact validated receipt authorizes the recovery.
    {
      const h = await driveToFaultedAndRefresh("tool-affordance-campaign");
      const authorized = progressRows(h).at(-1);
      assert.equal(authorized.status, "advanced");
      assert.equal(authorized.stage, "output_context_ready");
      assert.equal(authorized.reason, "authorized_fault_recovery_receipt");
      assert.equal(authorized.recovery_operation, "turn.output_context");
      assert.ok(h.active.at(-1).includes("coc_narration_review"));
      await h.shutdown();
    }
    // Mismatched receipt campaign: structurally valid but foreign — the
    // explicit lane accepts no cards, authorizes no recovery, and the
    // fault stays latched with the review tool unprojected.
    {
      const h = await driveToFaultedAndRefresh("other-campaign");
      const denied = progressRows(h).at(-1);
      assert.equal(denied.status, "rejected");
      assert.equal(denied.stage, "output_context_ready");
      assert.notEqual(denied.reason, "authorized_fault_recovery_receipt");
      assert.ok(h.active.at(-1).includes("coc_turn_output_context"));
      assert.ok(!h.active.at(-1).includes("coc_narration_review"));
      assert.equal(
        h.sent.filter((row) => (
          row.message.customType === main.TURN_PROCESSING_FAULT_CUSTOM_TYPE
        )).length,
        1,
        "a foreign-campaign receipt clears no fault",
      );
      await h.shutdown();
    }
  } finally {
    if (priorRole === undefined) delete process.env[ROLE_ENV];
    else process.env[ROLE_ENV] = priorRole;
    if (priorCampaign === undefined) delete process.env[CAMPAIGN_ENV];
    else process.env[CAMPAIGN_ENV] = priorCampaign;
  }
});

test("state-claim compiler terminal failure enters the same narrow fault working set", async () => {
  const compiler = new PiStateClaimCompiler(async () => {
    throw new PiStateClaimCompilerFailure(
      "state_claim_response_invalid",
      "protocol_invalid",
      { provider: "probe", id: "probe", api: "openai-responses" },
      1,
    );
  });
  const priorRole = process.env[ROLE_ENV];
  const priorCampaign = process.env[CAMPAIGN_ENV];
  process.env[ROLE_ENV] = "play";
  process.env[CAMPAIGN_ENV] = "tool-affordance-campaign";
  try {
    let recoveryResume = false;
    const h = makeHarness((_name, params) => {
      if (params.operation === "session.resume") {
        return recoveryResume
          ? {
              ok: true,
              tool: "session.resume",
              data: {
                schema_version: 1,
                campaign_id: "tool-affordance-campaign",
                mode: "pending_finalization",
                next_operations: ["turn.finalize"],
              },
            }
          : { ok: true, tool: "session.resume", data: { mode: "awaiting_player", next_operations: [] } };
      }
      if (params.operation === "turn.output_context") {
        // Current kernel producer shape (coc_operation_turn_output.py):
        // complete card chain with exact invoke_via, prefilled turn/source
        // identities, and missing_arguments. The authorized fault-recovery
        // refresh requires a validated receipt; a stale cardless fixture
        // can never clear the fault.
        return {
          ok: true,
          tool: "turn.output_context",
          data: {
            turn_id: "turn-compiler-fault",
            source_digest: `sha256:${"d".repeat(64)}`,
            settlement_snapshot_id: "turn-settlement-v1:compiler-fault",
            mechanics_bundle_sha256: `sha256:${"e".repeat(64)}`,
            obligations: [],
            mechanics_summary: {
              public_check: [], state_delta: [], exceptional_effect: [],
              concealed_consequence: [],
            },
            contract_projection: {
              agency_review_required: true,
              agency_authority: { pc_subject_refs: ["pc:probe"] },
            },
            agency_review_operation: {
              operation: "narration.review",
              invoke_via: "coc_narration_review",
              prefilled_arguments: {
                turn_id: "turn-compiler-fault",
                source_digest: `sha256:${"d".repeat(64)}`,
                revision: 1,
              },
              missing_arguments: [
                "decision_id", "draft_text", "findings",
                "state_authority_review",
              ],
            },
            finalize_operation: {
              operation: "turn.finalize",
              invoke_via: "coc_turn_finalize",
              prefilled_arguments: { revision: 1 },
              missing_arguments: ["draft", "narration_review_id", "agency_claims"],
            },
          },
        };
      }
      return { ok: true, tool: params.operation, data: {} };
    }, compiler);
    await h.start();
    await invokeCompat(h, "resume-live", "session.resume");
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "继续调查。" }],
    });
    await invokeCompat(h, "compiler-context", "turn.output_context");
    const response = JSON.parse((await invokeCompat(
      h,
      "compiler-review",
      "narration.review",
      {
        draft_text: "调查继续。",
        findings: [],
        state_authority_review: {
          disposition: "no_player_state_change_claimed",
          reason: "无状态变化。",
          claims: [],
        },
      },
    )).content[0].text);
    assert.equal(response.error.code, "state_claim_compiler_invalid");
    assert.equal(response.isError, true);
    assert.deepEqual(h.active.at(-1), ["coc_session_resume"]);
    assert.equal(
      h.appended.filter((row) => row.type === "coc-canonical-turn-progress").at(-1).value.stage,
      "faulted",
    );
    assert.equal(h.sent.filter((row) => (
      row.message.customType === main.TURN_PROCESSING_FAULT_CUSTOM_TYPE
    )).length, 1);

    recoveryResume = true;
    await invokeCompat(h, "compiler-resume", "session.resume");
    assert.ok(h.active.at(-1).includes("coc_turn_output_context"));
    assert.ok(!h.active.at(-1).includes("coc_turn_finalize"));
    assert.ok(!h.active.at(-1).includes("coc_narration_review"));
    await invokeCompat(h, "compiler-context-recovery", "turn.output_context");
    assert.ok(h.active.at(-1).includes("coc_narration_review"));
    assert.ok(!h.active.at(-1).includes("coc_turn_output_context"));
  } finally {
    if (priorRole === undefined) delete process.env[ROLE_ENV];
    else process.env[ROLE_ENV] = priorRole;
    if (priorCampaign === undefined) delete process.env[CAMPAIGN_ENV];
    else process.env[CAMPAIGN_ENV] = priorCampaign;
  }
});

test("valid ending receipt advances finalized then exact delivery", async () => {
  const endingText = "结局已经由权威收据闭合。";
  const priorRole = process.env[ROLE_ENV];
  const priorCampaign = process.env[CAMPAIGN_ENV];
  process.env[ROLE_ENV] = "play";
  process.env[CAMPAIGN_ENV] = "tool-affordance-campaign";
  try {
    const h = makeHarness((_name, params) => ({
      ok: true,
      tool: params.operation,
      data: {
        mode: "ending",
        next_operations: [],
        ending_output: {
          rendered_text: endingText,
          rendered_sha256: exactTextSha256(endingText),
        },
      },
    }));
    await h.start();
    await invokeCompat(h, "resume-ending", "session.resume");
    await h.emit("message_end", {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: endingText }],
    });
    const stages = h.appended
      .filter((row) => row.type === "coc-canonical-turn-progress")
      .map((row) => row.value.stage);
    assert.deepEqual(stages.slice(-2), ["finalized", "delivered"]);
    assert.deepEqual(h.active.at(-1), []);
  } finally {
    if (priorRole === undefined) delete process.env[ROLE_ENV];
    else process.env[ROLE_ENV] = priorRole;
    if (priorCampaign === undefined) delete process.env[CAMPAIGN_ENV];
    else process.env[CAMPAIGN_ENV] = priorCampaign;
  }
});

test("accepted-review hydration projects finalize-only and host-binds exact review identity", async () => {
  const compiler = new PiStateClaimCompiler(async (input) => ({
    result: {
      schema_version: 1,
      contract_id: "coc.pi-state-claim-compiler-result.v1",
      disposition: "no_claims_detected",
      reason: "每一段草稿都已复核。",
      claims: [],
      paragraph_coverage: draftParagraphs(input.draft_text).map((text, paragraph_index) => ({
        paragraph_index,
        paragraph_sha256: canonicalDigest(text),
        claim_indices: [],
      })),
    },
    responseModel: { provider: "offline", id: "offline", api: "openai-responses" },
  }));
  const turnId = "turn-affordance-pending-1";
  const sourceDigest = `sha256:${"c7".repeat(32)}`;
  const draftText = (
    "你当着他的面抡起右拳，空着手，对着桌角一下一下砸下去。"
    + "硬木棱反复撞上骨节，直到指节的皮裂开，血顺着拳面往下淌。\n\n"
    + "诺特盯着那只手，没有退。房间里的沉默没有因此松动。"
  );
  const draftSha256 = canonicalDigest(draftText);
  const stateExcerpt = "直到指节的皮裂开，血顺着拳面往下淌。";
  const stateAuthorityReview = {
    disposition: "claims_listed",
    reason: "精确记录草稿里的指节伤势。",
    claims: [{
      claim_id: "claim-knuckle-injury",
      subject_ref: "pc:affordance-investigator",
      claim_kind: "condition",
      exact_excerpt: stateExcerpt,
      source_effect_id: "effect:knuckle-injury",
      reason: "已由冻结的伤势效果授权。",
    }],
  };
  const buildFrozenReceipt = (options = {}) => {
    const revision = options.revision ?? 2;
    const draft = options.draft_text ?? draftText;
    const reviewDecisionId = (
      `pi-narration-review:affordance:player-epoch-7:revision-${revision}`
    );
    const receipt = {
      schema_version: 1,
      kind: "pending_narration_draft",
      secrecy: "keeper_only",
      campaign_id: "tool-affordance-campaign",
      receipt_id: `pending-narration-draft:${reviewDecisionId}:revision-${revision}`,
      review_decision_id: reviewDecisionId,
      review_id: "narration-review-v1:63f1f618b6c3d8fc5ad75f41040c313ec1acd668",
      turn_id: turnId,
      source_digest: sourceDigest,
      revision,
      draft_sha256: canonicalDigest(draft),
      draft_text: draft,
      draft_utf8_bytes: Buffer.byteLength(draft, "utf8"),
      review_digest: `sha256:${("a" + revision).repeat(32)}`,
      request_digest: `sha256:${("b" + revision).repeat(32)}`,
      producer_kind: "narration_review_submission",
      source_operation: "narration.review",
      // A direct submission materializes under the review's own decision id.
      materialization_decision_id: reviewDecisionId,
      provenance: { kind: "direct_review_submission" },
    };
    receipt.receipt_digest = canonicalDigest(receipt);
    return receipt;
  };
  const frozenDraft = () => buildFrozenReceipt();
  const liveReviewCard = (revision = 2, extra = null) => {
    const card = {
      operation: "narration.review",
      invoke_via: "coc_narration_review",
      prefilled_arguments: { turn_id: turnId, source_digest: sourceDigest, revision },
      missing_arguments: [
        "decision_id", "draft_text", "findings", "state_authority_review",
      ],
      discovery_required: false,
      authority: "semantic_agency_and_player_state_review",
      host_state_claim_compiler_required: true,
    };
    if (extra) Object.assign(card, extra);
    return card;
  };
  const liveFinalizeCard = (invokeVia = "coc_turn_finalize", revision = 2) => ({
    operation: "turn.finalize",
    invoke_via: invokeVia,
    prefilled_arguments: {
      decision_id: `pi-state-journal:2a383743:player-epoch-7:revision-${revision}:finalize`,
      revision,
    },
    missing_arguments: ["draft", "coverage", "narration_review_id", "agency_claims"],
    discovery_required: false,
    authority: "settled_output_completeness",
    hard_gate: true,
  });
  const liveContextEnvelope = (reviewCard = liveReviewCard(), finalizeCard = liveFinalizeCard(), receipt = frozenDraft()) => {
    const obligations = [
      {
        obligation_id: "first-impression:first-impression-receipt-affordance-pending-1",
        source_kind: "first_impression",
        source_id: "first-impression-receipt-affordance-pending-1",
        npc_display_name: "史蒂文·诺特",
        visibility: "context_effect",
        skill: null,
        goal: "realize the NPC's first observable response",
        outcome: null,
        required_level: null,
        achieved_level: null,
        passed: null,
        surplus_levels: null,
        exceptional_required: false,
        substantive_effect_required: false,
        substantive_effect_direction: null,
        substantive_effect_ids: [],
        substantive_effect_status: "not_required",
      },
      {
        obligation_id: "roll:toolbox-first-impression-affordance-pending-000001",
        source_kind: "check",
        source_id: "toolbox-first-impression-affordance-pending-000001",
        npc_display_name: "史蒂文·诺特",
        visibility: "public",
        skill: "APP",
        goal: "resolve the first material meeting",
        outcome: "failure",
        required_level: "regular",
        achieved_level: "failure",
        passed: false,
        surplus_levels: -1,
        exceptional_required: false,
        substantive_effect_required: false,
        substantive_effect_direction: null,
        substantive_effect_ids: [],
        substantive_effect_status: "not_required",
      },
    ];
    const contractProjection = {
      agency_review_required: true,
      player_input: {
        source_ref: "player_input:affordance-pending-1",
        text: "我用右拳砸桌角，直到指节破裂流血。",
      },
      control_overrides: [],
      agency_authority: {
        pc_subject_refs: ["pc:affordance-investigator"],
        involuntary_physiology_sources: [{
          source_ref: "narration_contract:involuntary_physiology",
          source_type: "ownership_contract",
        }],
      },
    };
    const contractProjectionSha256 = canonicalDigest(contractProjection);
    const acceptedReviewEvidence = {
      schema_version: 1,
      contract_id: "coc.accepted-review-evidence.v2",
      visibility: "host_only",
      review_id: receipt.review_id,
      turn_id: turnId,
      source_digest: sourceDigest,
      revision: receipt.revision,
      draft_sha256: receipt.draft_sha256,
      review_digest: receipt.review_digest,
      pending_draft_receipt_digest: receipt.receipt_digest,
      contract_projection_sha256: contractProjectionSha256,
      verification: {
        agency_gate: "clear",
        state_authority_gate: "clear",
      },
      state_authority_review: structuredClone(stateAuthorityReview),
      player_input_source_ref: contractProjection.player_input.source_ref,
      agency_authority: structuredClone(contractProjection.agency_authority),
      control_overrides: [],
      coverage_binding_facts: {
        schema_version: 1,
        contract_id: "coc.reviewed-coverage-binding-facts.v1",
        settlement_snapshot_id: "turn-settlement-v1:affordance-pending-1",
        mechanics_bundle_sha256: `sha256:${"e9".repeat(32)}`,
        obligations: structuredClone(obligations),
        public_check_source_ids: [
          "toolbox-first-impression-affordance-pending-000001",
        ],
        state_delta_source_ids: ["effect:knuckle-injury"],
        exceptional_effect_source_ids: [],
      },
    };
    acceptedReviewEvidence.evidence_sha256 = canonicalDigest(
      acceptedReviewEvidence,
    );
    return {
      ok: true,
      tool: "turn.output_context",
      data: {
        turn_id: turnId,
        source_digest: sourceDigest,
        journal_decision_id:
          "pi-state-journal:2a383743:player-epoch-7:revision-2",
        settlement_snapshot_id: "turn-settlement-v1:affordance-pending-1",
        mechanics_bundle_sha256: `sha256:${"e9".repeat(32)}`,
        obligations: structuredClone(obligations),
        mechanics_summary: {
          public_check: [{
            roll_id: "toolbox-first-impression-affordance-pending-000001",
            display_skill: "APP",
            outcome: "failure",
          }],
          state_delta: [{
            effect_id: "effect:knuckle-injury",
            resource: "HP",
            effect_kind: "scalar",
          }],
          exceptional_effect: [],
          concealed_consequence: [],
        },
        contract_projection_sha256: contractProjectionSha256,
        contract_projection: contractProjection,
        frozen_narration_draft: receipt,
        accepted_review_evidence: acceptedReviewEvidence,
        agency_review_operation: reviewCard,
        finalize_operation: finalizeCard,
      },
    };
  };
  let contextFetches = 0;
  const priorRole = process.env[ROLE_ENV];
  const priorCampaign = process.env[CAMPAIGN_ENV];
  process.env[ROLE_ENV] = "play";
  process.env[CAMPAIGN_ENV] = "tool-affordance-campaign";
  try {
    const h = makeHarness((_name, params) => {
      if (params.operation === "session.resume") {
        return {
          ok: true,
          tool: "session.resume",
          data: {
            schema_version: 1,
            campaign_id: "tool-affordance-campaign",
            mode: "pending_finalization",
            next_operations: ["turn.finalize"],
            pending_output_context: {
              schema_version: 1,
              turn_id: turnId,
              source_digest: sourceDigest,
              revision: 2,
            },
          },
        };
      }
      if (params.operation === "turn.output_context") {
        contextFetches += 1;
        return liveContextEnvelope();
      }
      if (params.operation === "narration.review") {
        return {
          ok: true,
          tool: "narration.review",
          data: {
            accepted: true,
            review_id: "narration-review-v1:affordance-accepted-1",
            turn_id: turnId,
            source_digest: sourceDigest,
            revision: 2,
            draft_sha256: canonicalDigest(params.arguments.draft_text),
            findings: [],
            agency_gate: "clear",
            state_authority_review: params.arguments.state_authority_review,
            state_claim_compilation: params.arguments.state_claim_compilation,
            state_authority_gate: "clear",
            recommendation: "no_revision_suggested",
          },
        };
      }
      if (params.operation === "turn.finalize") {
        return {
          ok: true,
          tool: "turn.finalize",
          data: {
            finalized: true,
            finalization_id: "finalization-v1:affordance-1",
            turn_id: turnId,
            rendered_text: params.arguments.draft,
            rendered_text_sha256: canonicalDigest(params.arguments.draft),
          },
        };
      }
      return { ok: true, tool: params.operation, data: {} };
    }, compiler);
    await h.start();
    // The initial resume inside withPlayHarness already triggered the
    // host-owned hydration; re-invoking the same pending identity coalesces.
    const resumedResult = await h.tools.get("coc_invoke").execute(
      "resume-pending",
      { operation: "session.resume", campaign: "tool-affordance-campaign", arguments: {} },
      undefined,
      undefined,
      h.ctx,
    );
    const resumed = JSON.parse(resumedResult.content[0].text);
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(contextFetches, 1, "exactly one host output-context fetch");
    assert.equal(
      h.clientCalls.filter((call) => (
        call.name === "coc_invoke"
        && String(call.params?.operation || "").startsWith("rules.")
      )).length
        + h.clientCalls.filter((call) => (
          call.name === "coc_invoke"
          && String(call.params?.operation || "").startsWith("state.")
        )).length
        + h.clientCalls.filter((call) => (
          call.name === "coc_invoke"
          && (call.params?.operation === "narration.review"
            || call.params?.operation === "turn.finalize")
        )).length,
      0,
      "hydration must never invoke review, finalize, rules, or state operations",
    );
    assert.equal(
      h.appended
        .filter((row) => row.type === "coc-canonical-turn-progress")
        .every((row) => row.value?.player_turn_epoch === 0),
      true,
      "hydration must never create a new player epoch",
    );
    const guidance = resumed.data.host_recovery_guidance;
    assert.equal(guidance.output_context_status, "host_refreshed_live");
    assert.equal(guidance.status, "review_accepted_pending_finalization");
    assert.deepEqual(guidance.next_call, { tool: "coc_turn_finalize" });
    assert.equal(
      guidance.review_recovery,
      undefined,
      "an accepted review must never be offered as the next model action",
    );
    assert.equal(guidance.model_calls.review, undefined);
    assert.deepEqual(guidance.accepted_review, {
      status: "accepted",
      instruction: guidance.accepted_review.instruction,
    });
    // The model-facing finalize card carries only model-owned prefilled and
    // missing arguments. Every exact identity is listed as host-attached and
    // remains available only in canonical details.
    assert.deepEqual(guidance.then.card, {
      operation: "turn.finalize",
      invoke_via: "coc_turn_finalize",
      prefilled_arguments: {},
      missing_arguments: ["coverage", "agency_claims"],
      host_bound_auto_attached_arguments: [
        "campaign", "decision_id", "draft", "mechanics_placements",
        "narration_review_id", "repair_finalization_id", "revision", "root",
      ],
      discovery_required: false,
      authority: "settled_output_completeness",
      hard_gate: true,
    });
    for (const field of [
      "decision_id", "narration_review_id", "repair_finalization_id",
      "revision", "source_digest", "review_id", "receipt_id",
    ]) {
      assert.equal(
        Object.hasOwn(guidance.then.card.prefilled_arguments, field),
        false,
        `model-facing finalize card leaked host-bound ${field}`,
      );
    }
    assert.deepEqual(guidance.then.finalize_input, {
      visibility: "keeper_only",
      source: "turn.output_context.data.accepted_review_evidence",
      mode: "accepted_review_semantic",
      reviewed_spans: [
        "reviewed-state-claim:1",
        "reviewed-sentence:paragraph-1:1",
        "reviewed-sentence:paragraph-1:2",
        "reviewed-paragraph:1",
        "reviewed-sentence:paragraph-2:1",
        "reviewed-sentence:paragraph-2:2",
        "reviewed-paragraph:2",
      ],
      authorities: [
        {
          authority: "current-player-input",
          claim_types: [
            "voluntary_action", "voluntary_speech", "voluntary_plan",
            "voluntary_belief", "voluntary_trust",
            "voluntary_active_emotion",
          ],
        },
        {
          authority: "involuntary-physiology",
          claim_types: ["involuntary_physiology"],
        },
      ],
      coverage_obligations: [
        {
          obligation: "roll:史蒂文-诺特",
          source_kind: "first_impression",
          visibility: "context_effect",
          npc_display_name: "史蒂文·诺特",
          goal: "realize the NPC's first observable response",
          exceptional_required: false,
          allowed_reviewed_spans: [
            "reviewed-state-claim:1",
            "reviewed-sentence:paragraph-1:1",
            "reviewed-sentence:paragraph-1:2",
            "reviewed-paragraph:1",
            "reviewed-sentence:paragraph-2:1",
            "reviewed-sentence:paragraph-2:2",
            "reviewed-paragraph:2",
          ],
          realization: "fictional_beat",
          placement_mode: "host_safe_default",
        },
        {
          obligation: "roll:史蒂文-诺特-2",
          source_kind: "check",
          visibility: "public",
          npc_display_name: "史蒂文·诺特",
          skill: "APP",
          goal: "resolve the first material meeting",
          outcome: "failure",
          exceptional_required: false,
          allowed_reviewed_spans: [
            "reviewed-sentence:paragraph-2:1",
            "reviewed-sentence:paragraph-2:2",
            "reviewed-paragraph:2",
          ],
          realization: "fictional_beat",
          placement_mode: "host_safe_default_before_result",
        },
      ],
      mechanics_placement: {
        mode: "host_safe_default",
        public_check_count: 1,
        state_delta_count: 1,
        exceptional_effect_count: 0,
      },
      model_arguments: ["coverage", "agency_claims"],
      instruction: guidance.then.finalize_input.instruction,
    });
    // Host-only details retain both exact canonical cards and accepted-review
    // identity/digest evidence for audit and binding.
    assert.equal(
      JSON.stringify(
        resumedResult.details.data.host_recovery_guidance.accepted_review.card,
      ),
      JSON.stringify(liveReviewCard()),
      "host-only details must retain the exact canonical review card",
    );
    assert.equal(
      JSON.stringify(resumedResult.details.data.host_recovery_guidance.then.card),
      JSON.stringify(liveFinalizeCard()),
      "host-only details must retain the exact canonical finalize card",
    );
    const guidanceJson = JSON.stringify(guidance);
    assert.equal(
      guidanceJson.split(draftText).length - 1,
      0,
      "accepted-review recovery guidance never exposes the frozen draft",
    );
    assert.equal(guidanceJson.includes(stateExcerpt), false);
    assert.equal(guidanceJson.includes("accepted_review_evidence"), true);
    for (const hostOnlyValue of [
      turnId,
      sourceDigest,
      liveFinalizeCard().prefilled_arguments.decision_id,
      frozenDraft().review_id,
      draftSha256,
    ]) {
      assert.equal(
        guidanceJson.includes(hostOnlyValue),
        false,
        "model recovery guidance leaked host-only identity or integrity",
      );
    }
    assert.equal(
      guidanceJson.includes("coc_turn_output_context"),
      false,
      "host-refreshed guidance must be pointer-free",
    );
    assert.deepEqual(guidance.model_calls.finalize.model_owned_required_arguments, [
      "coverage", "agency_claims",
    ]);
    assert.deepEqual(
      guidance.model_calls.finalize.model_owned_optional_arguments,
      [],
    );
    assert.ok(
      guidance.model_calls.finalize.host_bound_auto_attached_arguments
        .includes("draft"),
    );
    assert.equal(guidance.model_calls.finalize.invoke_via, "coc_turn_finalize");
    assert.equal(
      h.clientCalls.some((call) => call.params?.operation === "narration.review"),
      false,
      "resume and finalize-only recovery must not repeat the accepted review",
    );
    assert.ok(h.active.at(-1).includes("coc_turn_finalize"));
    assert.equal(
      h.active.at(-1).includes("coc_narration_review"),
      false,
      "accepted review advances the working set to finalize-only",
    );
    // Complete through finalize using the generated finalize projection's
    // typed_flat surface: model-owned arguments only; the host attaches
    // decision/revision/review identities — no alias or forged rejection.
    assert.equal(guidance.model_calls.finalize.invocation_shape, "typed_flat");
    const semanticCoverage = [
      {
        obligation_ref: "roll:史蒂文-诺特",
        reviewed_span: "reviewed-sentence:paragraph-2:1",
        realization: "fictional_beat",
        action_realization: "诺特看见海斯以拳击打桌角。",
        response: "诺特盯着那只手，没有退。",
        causal_explanation: "第一次实质接触形成冷硬回应。",
        persona_fit: "诺特保持克制，没有放弃职责。",
        player_input_handling: "specific_preserved",
        exceptional_beat: null,
      },
      {
        obligation_ref: "roll:史蒂文-诺特-2",
        reviewed_span: "reviewed-sentence:paragraph-2:2",
        realization: "fictional_beat",
        action_realization: "公开的第一印象检定在交谈中得到结果。",
        response: "房间里的沉默没有因此松动。",
        causal_explanation: "检定失败没有让诺特改变态度。",
        persona_fit: "冷硬而克制的反应符合诺特的立场。",
        player_input_handling: "specific_preserved",
        exceptional_beat: null,
      },
    ];
    for (const [label, arguments_] of [
      ["stale obligation", {
        coverage: [
          { ...semanticCoverage[0], obligation_ref: "roll:不存在的义务" },
          semanticCoverage[1],
        ],
        agency_claims: [],
      }],
      ["model-written exact excerpt", {
        coverage: [
          { ...semanticCoverage[0], exact_excerpt: "史蒂文·诺特" },
          semanticCoverage[1],
        ],
        agency_claims: [],
      }],
      ["model-written placement", {
        coverage: semanticCoverage,
        agency_claims: [],
        mechanics_placements: [{
          after_paragraph: 0,
          segment_type: "public_check",
          source_ids: ["roll:史蒂文-诺特-2"],
        }],
      }],
    ]) {
      const beforeRejected = h.clientCalls.filter((call) => (
        call.name === "coc_invoke" && call.params?.operation === "turn.finalize"
      )).length;
      const rejected = JSON.parse((await h.tools.get("coc_turn_finalize").execute(
        `typed-finalize-coverage-reject-${label}`,
        arguments_,
        undefined,
        undefined,
        h.ctx,
      )).content[0].text);
      assert.equal(rejected.ok, false, label);
      assert.equal(
        h.clientCalls.filter((call) => (
          call.name === "coc_invoke"
          && call.params?.operation === "turn.finalize"
        )).length,
        beforeRejected,
        `${label} must fail before canonical transport`,
      );
    }
    for (const [label, agencyClaim] of [
      ["stale reviewed span", {
        reviewed_span: "reviewed-sentence:paragraph-99:1",
        claim_type: "voluntary_action",
        authority: "current-player-input",
      }],
      ["mismatched reviewed authority", {
        reviewed_span: "reviewed-state-claim:1",
        claim_type: "voluntary_action",
        authority: "involuntary-physiology",
      }],
    ]) {
      const beforeRejected = h.clientCalls.filter((call) => (
        call.name === "coc_invoke" && call.params?.operation === "turn.finalize"
      )).length;
      const rejected = JSON.parse((await h.tools.get("coc_turn_finalize").execute(
        `typed-finalize-reject-${label}`,
        { coverage: semanticCoverage, agency_claims: [agencyClaim] },
        undefined,
        undefined,
        h.ctx,
      )).content[0].text);
      assert.equal(rejected.ok, false, label);
      assert.equal(
        h.clientCalls.filter((call) => (
          call.name === "coc_invoke"
          && call.params?.operation === "turn.finalize"
        )).length,
        beforeRejected,
        `${label} must fail before canonical transport`,
      );
    }
    const finalize = JSON.parse((await h.tools.get("coc_turn_finalize").execute(
      "typed-finalize",
      {
        coverage: semanticCoverage,
        agency_claims: [
          {
            reviewed_span: "reviewed-sentence:paragraph-1:1",
            claim_type: "voluntary_action",
            authority: "current-player-input",
          },
          {
            reviewed_span: "reviewed-state-claim:1",
            claim_type: "involuntary_physiology",
            authority: "involuntary-physiology",
          },
        ],
      },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(finalize.ok, true, JSON.stringify(finalize));
    const finalizeCalls = h.clientCalls.filter((call) => (
      call.name === "coc_invoke" && call.params?.operation === "turn.finalize"
    ));
    assert.equal(finalizeCalls.length, 1);
    const finalizeWire = finalizeCalls[0].params.arguments;
    assert.equal(finalizeWire.draft, draftText);
    assert.equal(Object.hasOwn(finalizeWire, "mechanics_placements"), false);
    assert.deepEqual(
      finalizeWire.coverage.map((row) => ({
        obligation_id: row.obligation_id,
        exact_excerpt: row.exact_excerpt,
      })),
      [
        {
          obligation_id:
            "first-impression:first-impression-receipt-affordance-pending-1",
          exact_excerpt: "诺特盯着那只手，没有退。",
        },
        {
          obligation_id:
            "roll:toolbox-first-impression-affordance-pending-000001",
          exact_excerpt: "房间里的沉默没有因此松动。",
        },
      ],
      "host restores canonical obligation ids and exact reviewed spans",
    );
    assert.equal(
      finalizeWire.agency_claims[0].exact_excerpt,
      "你当着他的面抡起右拳，空着手，对着桌角一下一下砸下去。",
    );
    assert.equal(finalizeWire.agency_claims[1].exact_excerpt, stateExcerpt);
    assert.equal(
      finalizeWire.agency_claims[0].source_ref,
      "player_input:affordance-pending-1",
    );
    assert.equal(
      finalizeWire.agency_claims[1].source_ref,
      "narration_contract:involuntary_physiology",
    );
    assert.equal(finalizeWire.revision, 2);
    assert.equal(
      finalizeWire.decision_id,
      liveFinalizeCard().prefilled_arguments.decision_id,
      "host restores the exact validated finalize decision",
    );
    assert.equal(
      finalizeWire.narration_review_id,
      frozenDraft().review_id,
      "host restores the accepted frozen review without repeating review",
    );
    // No player-visible leak of the draft, the receipt, or the guidance.
    assert.ok(
      h.sent.every((entry) => {
        const serialized = JSON.stringify(entry);
        return !serialized.includes(draftText)
          && !serialized.includes("frozen_narration_draft")
          && !serialized.includes("host_recovery_guidance")
          && !serialized.includes(turnId);
      }),
      "keeper-only frozen draft must never leak into player-visible sends",
    );

    // Fallback: a review-required live context without the frozen draft is
    // unusable — hydration fails closed to the pointer guidance.
    const fallbackHarness = makeHarness((_name, params) => {
      if (params.operation === "session.resume") {
        return {
          ok: true,
          tool: "session.resume",
          data: {
            schema_version: 1,
            campaign_id: "tool-affordance-campaign",
            mode: "pending_finalization",
            next_operations: ["turn.finalize"],
            pending_output_context: {
              schema_version: 1,
              turn_id: turnId,
              source_digest: sourceDigest,
              revision: 2,
            },
          },
        };
      }
      if (params.operation === "turn.output_context") {
        const envelope = liveContextEnvelope();
        delete envelope.data.frozen_narration_draft;
        return envelope;
      }
      return { ok: true, tool: params.operation, data: {} };
    }, compiler);
    await fallbackHarness.start();
    const fallbackResumed = JSON.parse((await fallbackHarness.tools.get("coc_invoke").execute(
      "resume-pending-fallback",
      { operation: "session.resume", campaign: "tool-affordance-campaign", arguments: {} },
      undefined,
      undefined,
      fallbackHarness.ctx,
    )).content[0].text);
    assert.equal(fallbackResumed.ok, true);
    const fallbackGuidance = fallbackResumed.data.host_recovery_guidance;
    assert.equal(fallbackGuidance.output_context_status, undefined);
    assert.deepEqual(fallbackGuidance.next_call, {
      tool: "coc_turn_output_context",
      arguments: { root, campaign: "tool-affordance-campaign" },
    });
    assert.equal(fallbackGuidance.review_recovery.card, undefined);
    assert.equal(fallbackGuidance.then.card, undefined);
    assert.equal(fallbackGuidance.model_calls, undefined);
    assert.deepEqual(
      fallbackResumed.data.pending_output_context,
      {
        status: "read_via_exact_typed_call",
        next_call: {
          tool: "coc_turn_output_context",
          arguments: { root, campaign: "tool-affordance-campaign" },
        },
      },
      "fallback keeps exactly one explicit output-context pointer",
    );
    assert.ok(
      fallbackHarness.sent.every((entry) => {
        const serialized = JSON.stringify(entry);
        return !serialized.includes(draftText)
          && !serialized.includes("host_recovery_guidance");
      }),
      "fallback guidance never leaks into player-visible sends",
    );
    await fallbackHarness.shutdown();
  } finally {
    if (priorRole === undefined) delete process.env[ROLE_ENV];
    else process.env[ROLE_ENV] = priorRole;
    if (priorCampaign === undefined) delete process.env[CAMPAIGN_ENV];
    else process.env[CAMPAIGN_ENV] = priorCampaign;
  }
});

test("pending-finalization direct finalize executes through the coc_invoke generic envelope projection", async () => {
  const compiler = new PiStateClaimCompiler(async (input) => ({
    result: {
      schema_version: 1,
      contract_id: "coc.pi-state-claim-compiler-result.v1",
      disposition: "no_claims_detected",
      reason: "每一段草稿都已复核。",
      claims: [],
      paragraph_coverage: draftParagraphs(input.draft_text).map((text, paragraph_index) => ({
        paragraph_index,
        paragraph_sha256: canonicalDigest(text),
        claim_indices: [],
      })),
    },
    responseModel: { provider: "offline", id: "offline", api: "openai-responses" },
  }));
  const turnId = "turn-affordance-direct-1";
  const sourceDigest = `sha256:${"d5".repeat(32)}`;
  const finalizeCard = {
    operation: "turn.finalize",
    invoke_via: "coc_invoke",
    prefilled_arguments: {
      decision_id: `${turnId}:player-epoch-7:revision-2:finalize`,
      revision: 2,
      coverage: [],
    },
    missing_arguments: ["draft"],
    discovery_required: false,
    authority: "settled_output_completeness",
    hard_gate: true,
  };
  const priorRole = process.env[ROLE_ENV];
  const priorCampaign = process.env[CAMPAIGN_ENV];
  process.env[ROLE_ENV] = "play";
  process.env[CAMPAIGN_ENV] = "tool-affordance-campaign";
  try {
    const h = makeHarness((_name, params) => {
      if (params.operation === "session.resume") {
        return {
          ok: true,
          tool: "session.resume",
          data: {
            schema_version: 1,
            campaign_id: "tool-affordance-campaign",
            mode: "pending_finalization",
            next_operations: ["turn.finalize"],
            pending_output_context: {
              schema_version: 1,
              turn_id: turnId,
              source_digest: sourceDigest,
              revision: 2,
            },
          },
        };
      }
      if (params.operation === "turn.output_context") {
        return {
          ok: true,
          tool: "turn.output_context",
          data: {
            turn_id: turnId,
            source_digest: sourceDigest,
            settlement_snapshot_id: "turn-settlement-v1:affordance-direct-1",
            mechanics_bundle_sha256: `sha256:${"f1".repeat(32)}`,
            obligations: [],
            mechanics_summary: {
              public_check: [], state_delta: [], exceptional_effect: [],
              concealed_consequence: [],
            },
            contract_projection: { agency_review_required: false },
            finalize_operation: finalizeCard,
          },
        };
      }
      if (params.operation === "turn.finalize") {
        return {
          ok: true,
          tool: "turn.finalize",
          data: {
            finalized: true,
            finalization_id: "finalization-v1:affordance-direct-1",
            turn_id: turnId,
            rendered_text: params.arguments.draft,
            rendered_text_sha256: canonicalDigest(params.arguments.draft),
          },
        };
      }
      return { ok: true, tool: params.operation, data: {} };
    }, compiler);
    await h.start();
    const resumed = JSON.parse((await h.tools.get("coc_invoke").execute(
      "resume-direct",
      { operation: "session.resume", campaign: "tool-affordance-campaign", arguments: {} },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(resumed.ok, true);
    const guidance = resumed.data.host_recovery_guidance;
    assert.equal(guidance.output_context_status, "host_refreshed_live");
    assert.equal(guidance.model_calls.finalize.invoke_via, "coc_invoke");
    // The generic gateway surface must be projected as the real envelope:
    // {operation, arguments} with the model-owned arguments nested inside.
    assert.equal(guidance.model_calls.finalize.invocation_shape, "generic_envelope");
    assert.equal(guidance.model_calls.finalize.envelope_operation, "turn.finalize");
    assert.deepEqual(
      guidance.model_calls.finalize.model_owned_required_arguments,
      ["coverage", "draft"],
    );
    assert.equal(guidance.model_calls.review, undefined);
    assert.equal(guidance.review_recovery.review_input, undefined);
    const finalize = JSON.parse((await h.tools.get("coc_invoke").execute(
      "generic-envelope-finalize",
      {
        operation: "turn.finalize",
        campaign: "tool-affordance-campaign",
        arguments: { draft: "大堂重新安静下来。", coverage: [] },
      },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(finalize.ok, true, JSON.stringify(finalize));
    const finalizeCalls = h.clientCalls.filter((call) => (
      call.name === "coc_invoke" && call.params?.operation === "turn.finalize"
    ));
    assert.equal(finalizeCalls.length, 1);
    assert.equal(finalizeCalls[0].params.arguments.draft, "大堂重新安静下来。");
    await h.shutdown();
  } finally {
    if (priorRole === undefined) delete process.env[ROLE_ENV];
    else process.env[ROLE_ENV] = priorRole;
    if (priorCampaign === undefined) delete process.env[CAMPAIGN_ENV];
    else process.env[CAMPAIGN_ENV] = priorCampaign;
  }
});

test("excerpt-only revision-2 repair requires an edited draft and completes through finalize", async () => {
  const compiler = new PiStateClaimCompiler(async (input) => ({
    result: {
      schema_version: 1,
      contract_id: "coc.pi-state-claim-compiler-result.v1",
      disposition: "no_claims_detected",
      reason: "每一段草稿都已复核。",
      claims: [],
      paragraph_coverage: draftParagraphs(input.draft_text).map((text, paragraph_index) => ({
        paragraph_index,
        paragraph_sha256: canonicalDigest(text),
        claim_indices: [],
      })),
    },
    responseModel: { provider: "offline", id: "offline", api: "openai-responses" },
  }));
  const turnId = "turn-affordance-repair-1";
  const sourceDigest = `sha256:${"e2".repeat(32)}`;
  const rejectedDraft = "你把撬棒塞进大衣内袋，转身离开旅店大门。";
  const repairedDraft = "你把一根铁棍模样的事物收好，转身离开旅店大门。";
  const spanRepairs = {
    schema_version: 1,
    contract_id: "coc.span-repairs.v1",
    mode: "excerpt_only",
    spans: [
      {
        exact_excerpt: "你把撬棒塞进大衣内袋",
        claim_kind: "item",
        reason: "未落账的撬棒取得。",
        repair: "rephrase_or_remove",
      },
    ],
    instruction: "Only change the listed excerpts. Leave every other sentence byte-stable.",
  };
  const frozenReceipt = (() => {
    const reviewDecisionId = "pi-narration-review:affordance-repair:player-epoch-7:revision-1";
    const receipt = {
      schema_version: 1,
      kind: "pending_narration_draft",
      secrecy: "keeper_only",
      campaign_id: "tool-affordance-campaign",
      receipt_id: `pending-narration-draft:${reviewDecisionId}:revision-1`,
      review_decision_id: reviewDecisionId,
      review_id: "narration-review-v1:affordance-rejected-1",
      turn_id: turnId,
      source_digest: sourceDigest,
      revision: 1,
      draft_sha256: canonicalDigest(rejectedDraft),
      draft_text: rejectedDraft,
      draft_utf8_bytes: Buffer.byteLength(rejectedDraft, "utf8"),
      review_digest: `sha256:${"a1".repeat(32)}`,
      request_digest: `sha256:${"b1".repeat(32)}`,
      producer_kind: "narration_review_submission",
      source_operation: "narration.review",
      materialization_decision_id: reviewDecisionId,
      provenance: { kind: "direct_review_submission" },
    };
    receipt.receipt_digest = canonicalDigest(receipt);
    return receipt;
  })();
  const priorRole = process.env[ROLE_ENV];
  const priorCampaign = process.env[CAMPAIGN_ENV];
  process.env[ROLE_ENV] = "play";
  process.env[CAMPAIGN_ENV] = "tool-affordance-campaign";
  try {
    let reviewDraftSeen = null;
    const h = makeHarness((_name, params) => {
      if (params.operation === "session.resume") {
        return {
          ok: true,
          tool: "session.resume",
          data: {
            schema_version: 1,
            campaign_id: "tool-affordance-campaign",
            mode: "pending_finalization",
            next_operations: ["turn.finalize"],
            pending_output_context: {
              schema_version: 1,
              turn_id: turnId,
              source_digest: sourceDigest,
              revision: 2,
            },
          },
        };
      }
      if (params.operation === "turn.output_context") {
        return {
          ok: true,
          tool: "turn.output_context",
          data: {
            turn_id: turnId,
            source_digest: sourceDigest,
            settlement_snapshot_id: "turn-settlement-v1:affordance-repair-1",
            mechanics_bundle_sha256: `sha256:${"f2".repeat(32)}`,
            obligations: [],
            mechanics_summary: {
              public_check: [], state_delta: [], exceptional_effect: [],
              concealed_consequence: [],
            },
            contract_projection: {
              agency_review_required: true,
              player_input: {
                source_ref: "player_input:affordance-repair-1",
                text: "我把东西收好后离开旅店。",
              },
              control_overrides: [],
              agency_authority: {
                pc_subject_refs: ["pc:affordance-investigator"],
                involuntary_physiology_sources: [{
                  source_ref: "narration_contract:involuntary_physiology",
                  source_type: "ownership_contract",
                }],
              },
            },
            frozen_narration_draft: frozenReceipt,
            agency_review_operation: {
              operation: "narration.review",
              invoke_via: "coc_narration_review",
              prefilled_arguments: { turn_id: turnId, source_digest: sourceDigest, revision: 2 },
              missing_arguments: [
                "decision_id", "draft_text", "findings", "state_authority_review",
              ],
              discovery_required: false,
              authority: "semantic_agency_and_player_state_review",
              host_state_claim_compiler_required: true,
              span_repairs: spanRepairs,
            },
            finalize_operation: {
              operation: "turn.finalize",
              invoke_via: "coc_turn_finalize",
              prefilled_arguments: {
                decision_id: `${turnId}:player-epoch-7:revision-2:finalize`,
                revision: 2,
                coverage: [],
              },
              missing_arguments: ["draft", "narration_review_id", "agency_claims"],
              discovery_required: false,
              authority: "settled_output_completeness",
              hard_gate: true,
            },
          },
        };
      }
      if (params.operation === "narration.review") {
        reviewDraftSeen = params.arguments.draft_text;
        return {
          ok: true,
          tool: "narration.review",
          data: {
            accepted: true,
            review_id: "narration-review-v1:affordance-repair-accepted-1",
            turn_id: turnId,
            source_digest: sourceDigest,
            revision: 2,
            draft_sha256: canonicalDigest(params.arguments.draft_text),
            findings: [],
            agency_gate: "clear",
            state_authority_review: params.arguments.state_authority_review,
            state_claim_compilation: params.arguments.state_claim_compilation,
            state_authority_gate: "clear",
            recommendation: "no_revision_suggested",
          },
        };
      }
      if (params.operation === "turn.finalize") {
        return {
          ok: true,
          tool: "turn.finalize",
          data: {
            finalized: true,
            finalization_id: "finalization-v1:affordance-repair-1",
            turn_id: turnId,
            rendered_text: params.arguments.draft,
            rendered_text_sha256: canonicalDigest(params.arguments.draft),
          },
        };
      }
      return { ok: true, tool: params.operation, data: {} };
    }, compiler);
    await h.start();
    const resumed = JSON.parse((await h.tools.get("coc_invoke").execute(
      "resume-repair",
      { operation: "session.resume", campaign: "tool-affordance-campaign", arguments: {} },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(resumed.ok, true);
    const guidance = resumed.data.host_recovery_guidance;
    assert.equal(guidance.output_context_status, "host_refreshed_live");
    // The rejected revision-1 baseline rides once with the repair contract.
    assert.equal(guidance.review_recovery.review_input.mode, "excerpt_only_repair");
    assert.equal(guidance.review_recovery.review_input.baseline_draft_text, rejectedDraft);
    assert.deepEqual(
      guidance.review_recovery.review_input.span_repairs,
      spanRepairs,
    );
    assert.equal(
      guidance.review_recovery.review_input.instruction.includes("Never resubmit the unchanged baseline"),
      true,
    );
    assert.equal(
      JSON.stringify(guidance).split(rejectedDraft).length - 1,
      1,
      "the rejected baseline appears exactly once in the guidance",
    );
    // The model submits the EDITED revision-2 text — never the baseline.
    const review = JSON.parse((await h.tools.get("coc_narration_review").execute(
      "typed-repair-review",
      {
        draft_text: repairedDraft,
        findings: [],
        state_authority_review: {
          disposition: "no_player_state_change_claimed",
          reason: "修复后的草稿没有宣告玩家状态变化。",
          claims: [],
        },
      },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(review.ok, true, JSON.stringify(review));
    assert.equal(reviewDraftSeen, repairedDraft);
    assert.notEqual(reviewDraftSeen, rejectedDraft);
    const reviewCalls = h.clientCalls.filter((call) => (
      call.name === "coc_invoke" && call.params?.operation === "narration.review"
    ));
    assert.equal(reviewCalls[0].params.arguments.revision, 2);
    assert.equal(reviewCalls[0].params.arguments.draft_text, repairedDraft);
    // Then finalize the repaired revision-2 draft.
    const finalize = JSON.parse((await h.tools.get("coc_turn_finalize").execute(
      "typed-repair-finalize",
      { coverage: [], agency_claims: [] },
      undefined,
      undefined,
      h.ctx,
    )).content[0].text);
    assert.equal(finalize.ok, true, JSON.stringify(finalize));
    const finalizeCalls = h.clientCalls.filter((call) => (
      call.name === "coc_invoke" && call.params?.operation === "turn.finalize"
    ));
    assert.equal(finalizeCalls[0].params.arguments.draft, repairedDraft);
    assert.equal(finalizeCalls[0].params.arguments.revision, 2);
    await h.shutdown();
  } finally {
    if (priorRole === undefined) delete process.env[ROLE_ENV];
    else process.env[ROLE_ENV] = priorRole;
    if (priorCampaign === undefined) delete process.env[CAMPAIGN_ENV];
    else process.env[CAMPAIGN_ENV] = priorCampaign;
  }
});
