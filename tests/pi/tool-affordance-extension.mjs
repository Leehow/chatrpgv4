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
} = await import(path.join(
  root,
  "plugins/coc-keeper/pi/lib/state-claim-compiler.ts",
));

const ROLE_ENV = "COC_PI_SESSION_ROLE";
const CAMPAIGN_ENV = "PI_COC_CAMPAIGN_ID";

const exactTextSha256 = (text) => (
  `sha256:${createHash("sha256").update(JSON.stringify(text), "utf8").digest("hex")}`
);

function makeHarness(callTool, compiler = undefined, hostFaults = {}) {
  const tools = new Map();
  const handlers = new Map();
  const active = [];
  const sent = [];
  const appended = [];
  let hideRead = false;
  const pi = {
    registerTool(tool) {
      hostFaults.beforeRegisterTool?.(tool);
      tools.set(tool.name, tool);
    },
    registerCommand() {},
    registerShortcut() {},
    on(type, handler) {
      const rows = handlers.get(type) || [];
      rows.push(handler);
      handlers.set(type, rows);
    },
    appendEntry(type, value) { appended.push({ type, value }); },
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
  };
  const emit = async (type, message) => {
    let projected;
    for (const handler of handlers.get(type) || []) {
      projected = await handler({ type, message }, ctx);
    }
    return projected;
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
    tools, handlers, active, sent, appended, clientCalls, ctx, emit, start, shutdown,
    hideRead() { hideRead = true; },
  };
}

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
), hostFaults = {}) {
  const priorRole = process.env[ROLE_ENV];
  const priorCampaign = process.env[CAMPAIGN_ENV];
  process.env[ROLE_ENV] = "play";
  process.env[CAMPAIGN_ENV] = "tool-affordance-campaign";
  try {
    const harness = makeHarness(callTool, undefined, hostFaults);
    await harness.start();
    await harness.tools.get("coc_invoke").execute(
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
    await fn(harness);
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
    const callContext = (probe, decisionId) => h.tools.get("coc_invoke").execute(
      `context-${probe}-${decisionId}`,
      {
        operation: "turn.output_context",
        campaign: "tool-affordance-campaign",
        arguments: { probe, decision_id: decisionId },
      },
      undefined, undefined, h.ctx,
    );
    const first = JSON.parse((await callContext("same", "host-id-1")).content[0].text);
    assert.equal(first.error.code, "invalid_param");
    const repeated = JSON.parse((await callContext("same", "host-id-2")).content[0].text);
    assert.equal(repeated.error.code, "nonretryable_repeat_blocked");
    assert.equal(contextAttempts, 1);

    const corrected = JSON.parse((await callContext("corrected", "host-id-3")).content[0].text);
    assert.equal(corrected.ok, true);
    assert.equal(contextAttempts, 2);
    const afterProgress = JSON.parse((await callContext("same", "host-id-4")).content[0].text);
    assert.equal(afterProgress.error.code, "invalid_param");
    assert.equal(contextAttempts, 3);
  }, (_name, params) => {
    if (params.operation === "state.journal") {
      return { ok: true, tool: "state.journal", data: { turn_id: "turn-affordance-1" } };
    }
    if (params.operation === "turn.output_context") {
      contextAttempts += 1;
      if (params.arguments.probe !== "corrected") {
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
            agency_authority: { pc_subject_refs: ["pc:affordance"] },
          },
          agency_review_operation: { prefilled_arguments: { revision: 1 } },
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
      /^pi-state-journal:player-epoch-1:revision-1$/,
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

test("projected same-destination scene routes preserve exact optional travel through canonical invoke", async () => {
  const forwarded = [];
  const sceneEnvelope = contextReceipt("multi-route", {
    active_scene_id: "study",
    exits: [
      { to: "archive", kind: "travel", open: true, travel_minutes: 5 },
      { to: "archive", kind: "travel", open: true, travel_minutes: 10 },
      { to: "archive", kind: "travel", open: true },
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
        "scene-route:archive:travel:1",
        "scene-route:archive:travel:2",
        "scene-route:archive:travel:3",
      ],
    );
    await h.tools.get("coc_state_move_scene").execute(
      "multi-route-ten",
      { candidate_id: "scene-route:archive:travel:2", reason: "走较长的回廊" },
      undefined,
      undefined,
      h.ctx,
    );
    assert.equal(forwarded.at(-1).arguments.scene_id, "archive");
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
      { candidate_id: "scene-route:archive:travel:1", reason: "走近路" },
      undefined,
      undefined,
      h.ctx,
    );
    assert.equal(forwarded.at(-1).arguments.scene_id, "archive");
    assert.equal(forwarded.at(-1).arguments.travel_minutes, 5);

    await invokeCompat(h, "multi-scene-untimed-refresh", "scene.context");
    const untimed = await h.tools.get("coc_state_move_scene").execute(
      "multi-route-untimed",
      { candidate_id: "scene-route:archive:travel:3", reason: "走未标注时长的通路" },
      undefined,
      undefined,
      h.ctx,
    );
    const untimedEnvelope = JSON.parse(untimed.content[0].text);
    assert.equal(untimedEnvelope.isError, true);
    assert.equal(untimedEnvelope.error.code, "invalid_param");
    assert.equal(forwarded.at(-1).arguments.scene_id, "archive");
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
    const unboundMoveSchema = h.tools.get("coc_state_move_scene").parameters;
    assert.ok(Object.hasOwn(unboundMoveSchema.properties, "campaign"));
    assert.ok(Object.hasOwn(unboundMoveSchema.properties, "decision_id"));
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
        exits: [{ to: "archive", open: true, travel_minutes: 5 }],
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
          exits: [{ to: "archive", open: true, travel_minutes: "5" }],
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
          exits: [{ to: "archive", open: true, travel_minutes: 7 }],
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
          [staleMoveTool, `atomic-stale-move-${stage}`, { scene_id: "archive", reason: "旧 schema" }],
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
          assert.ok(Object.hasOwn(schema.properties, "campaign"));
          assert.ok(Object.hasOwn(schema.properties, "decision_id"));
        }

        sceneEnvelope = contextReceipt(`atomic-rearm-success-${stage}`, {
          active_scene_id: "hall",
          exits: [{ to: "archive", open: true, travel_minutes: 9 }],
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
          { scene_id: "archive", reason: "完整 re-arm 后执行" },
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
      { to: "archive", open: true, travel_minutes: 35 },
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
    assert.deepEqual(moveDiscovery.data.operation_card.parameters.properties.scene_id.enum, ["archive"]);
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
      "move-bound", { scene_id: "archive", reason: "去档案室" },
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
      active_scene_id: "archive",
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

    await invokeCompat(h, "journal-stage-change", "state.journal");
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
      const response = JSON.parse((await invokeCompat(
        h, `malformed-${operation}`, operation,
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

test("faulted turn advances only through the exact session-resume recovery receipt", async () => {
  let recoveryResume = false;
  await withPlayHarness(async (h) => {
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我搜查房间。" }],
    });
    for (const text of ["草稿一。", "草稿二。", "草稿三。"]) {
      await h.emit("message_end", {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text }],
      });
    }
    assert.deepEqual(h.active.at(-1), ["coc_session_resume"]);
    recoveryResume = true;
    await invokeCompat(h, "resume-fault", "session.resume");
    assert.deepEqual(h.active.at(-1), ["coc_session_resume", "coc_state_journal"]);
    await invokeCompat(h, "journal-recovery", "state.journal");
    const progress = h.appended
      .filter((row) => row.type === "coc-canonical-turn-progress")
      .map((row) => row.value);
    assert.equal(progress.at(-1).stage, "journaled");
    assert.equal(progress.at(-1).reason, "authorized_fault_recovery_receipt");
    assert.ok(h.active.at(-1).includes("coc_turn_output_context"));
    assert.ok(!h.active.at(-1).includes("coc_state_journal"));
  }, (_name, params) => {
    if (params.operation === "session.resume") {
      return recoveryResume
        ? {
            ok: true,
            tool: "session.resume",
            data: {
              mode: "pending_finalization",
              next_operations: ["state.journal", "turn.output_context"],
            },
          }
        : { ok: true, tool: "session.resume", data: { mode: "awaiting_player", next_operations: [] } };
    }
    if (params.operation === "state.journal") {
      return { ok: true, tool: "state.journal", data: { turn_id: "turn-recovered" } };
    }
    return { ok: true, tool: params.operation, data: {} };
  });
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
    const h = makeHarness((_name, params) => {
      if (params.operation === "session.resume") {
        return { ok: true, tool: "session.resume", data: { mode: "awaiting_player", next_operations: [] } };
      }
      if (params.operation === "turn.output_context") {
        return {
          ok: true,
          tool: "turn.output_context",
          data: {
            turn_id: "turn-compiler-fault",
            source_digest: `sha256:${"d".repeat(64)}`,
            settlement_snapshot_id: "turn-settlement-v1:compiler-fault",
            mechanics_bundle_sha256: `sha256:${"e".repeat(64)}`,
            contract_projection: { agency_authority: { pc_subject_refs: ["pc:probe"] } },
            agency_review_operation: { prefilled_arguments: { revision: 1 } },
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
        turn_id: "turn-compiler-fault",
        source_digest: `sha256:${"d".repeat(64)}`,
        revision: 1,
        decision_id: "review-compiler-fault",
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
