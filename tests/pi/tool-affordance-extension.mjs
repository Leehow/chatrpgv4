#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));

const ROLE_ENV = "COC_PI_SESSION_ROLE";
const CAMPAIGN_ENV = "PI_COC_CAMPAIGN_ID";

function makeHarness(callTool) {
  const tools = new Map();
  const handlers = new Map();
  const active = [];
  const sent = [];
  const appended = [];
  let hideRead = false;
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand() {},
    registerShortcut() {},
    on(type, handler) {
      const rows = handlers.get(type) || [];
      rows.push(handler);
      handlers.set(type, rows);
    },
    appendEntry(type, value) { appended.push({ type, value }); },
    sendMessage(message, options) { sent.push({ message, options }); return true; },
    setActiveTools(names) { active.push([...names]); },
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
    createClient: () => ({
      async callTool(name, params) {
        clientCalls.push({ name, params });
        if (params.operation === "session.resume") {
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
        return callTool(name, params);
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
  return {
    tools, handlers, active, sent, appended, clientCalls, ctx, emit, start,
    hideRead() { hideRead = true; },
  };
}

async function withPlayHarness(fn, callTool = (_name, params) => ({
  ok: true,
  tool: params.operation,
  data: {},
})) {
  const priorRole = process.env[ROLE_ENV];
  const priorCampaign = process.env[CAMPAIGN_ENV];
  process.env[ROLE_ENV] = "play";
  process.env[CAMPAIGN_ENV] = "tool-affordance-campaign";
  try {
    const harness = makeHarness(callTool);
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

    const tooLarge = await h.tools.get("coc_discover").execute(
      "discover-state", { domain: "state" }, undefined, undefined, h.ctx,
    );
    const tooLargeEnvelope = JSON.parse(tooLarge.content[0].text);
    assert.equal(tooLargeEnvelope.ok, false);
    assert.equal(tooLargeEnvelope.error.code, "namespace_too_large");
    assert.ok(h.active.at(-1).includes("coc_state_move_scene"));

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
