#!/usr/bin/env node
// Startup lifecycle contract for Pi-Coc's durable memory-extraction re-arm.
//
// A continuing campaign's first canonical campaign operation is always the
// typed session.resume call.  The extension may inspect the extraction backlog
// only after that exact resume succeeded and its model-visible projection was
// accepted.  The inspection stays fire-and-forget, runs at most once per
// campaign/session boundary, and stale async results cannot land in a later
// epoch.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

delete process.env.PI_SUBAGENT_CHILD;
const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));

const campaignId = "resume-first-memory-rearm-campaign";
const pendingBacklog = {
  backlog_id: `backlog-${campaignId}-t1-extract`,
  timeline_id: "tl-main",
  turn_number: 1,
  status: "pending",
};

const resumeSuccess = (extraData = {}) => ({
  ok: true,
  tool: "session.resume",
  data: {
    schema_version: 1,
    campaign_id: campaignId,
    mode: "awaiting_player",
    next_operations: [],
    ...extraData,
  },
  warnings: [],
  hints: [],
});

const extractionStatus = (entries = []) => ({
  ok: true,
  tool: "memory.extraction_status",
  data: {
    schema_version: 1,
    campaign_id: campaignId,
    count: entries.length,
    pending_count: entries.filter((row) => row.status === "pending").length,
    entries,
  },
  warnings: [],
  hints: [],
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeHarness({
  role = "play",
  startupCampaignId = campaignId,
  resumeEnvelope = resumeSuccess(),
  statusResponse = extractionStatus(),
} = {}) {
  const priorRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_SESSION_ROLE = role;

  const tools = new Map();
  const handlers = new Map();
  const canonicalCalls = [];
  const bridgeCalls = [];
  const active = [];
  const sent = [];
  const appended = [];
  const welcomeAgentDir = mkdtempSync(
    path.join(tmpdir(), "pi-coc-resume-first-memory-"),
  );
  const fakePi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand() {},
    registerShortcut() {},
    on(type, handler) {
      const rows = handlers.get(type) || [];
      rows.push(handler);
      handlers.set(type, rows);
    },
    appendEntry(type, value) { appended.push({ type, value }); },
    sendMessage(message, options) {
      sent.push({ message, options });
      return true;
    },
    setActiveTools(names) { active.push([...names]); },
    getActiveTools() { return active.at(-1) || []; },
    getAllTools() {
      return [...tools.values()].map((tool) => ({
        name: tool.name,
        parameters: tool.parameters,
      }));
    },
    getThinkingLevel: () => "off",
  };

  const callTool = async (name, params = {}) => {
    if (name === "coc_capabilities") return { ok: true, host: "pi" };
    assert.equal(name, "coc_invoke");
    canonicalCalls.push(structuredClone(params));
    if (params.operation === "session.resume") {
      return typeof resumeEnvelope === "function"
        ? resumeEnvelope(params)
        : structuredClone(resumeEnvelope);
    }
    if (params.operation === "memory.extraction_status") {
      return typeof statusResponse === "function"
        ? statusResponse(params)
        : structuredClone(statusResponse);
    }
    return {
      ok: true,
      tool: params.operation,
      data: { schema_version: 1 },
      warnings: [],
      hints: [],
    };
  };

  main.default(fakePi, {
    coordinatorEnabled: async () => false,
    startupCampaignId: () => startupCampaignId,
    welcomeAgentDir,
    createClient: () => ({
      callTool,
      callToolWithTransportMeta: async (name, params) => ({
        value: await callTool(name, params),
        transport: null,
      }),
      close: async () => {},
    }),
    launchCoordinator: () => ({
      child: {},
      activation: Promise.resolve({ type: "agent_start" }),
      completion: Promise.resolve([]),
      terminate: async () => {},
    }),
    launchMemoryExtractor: () => {
      throw new Error("stale re-arm must not launch a memory extractor");
    },
    runMemoryHostBridge: async (request) => {
      bridgeCalls.push(structuredClone(request));
      return {
        status: "skipped",
        reason: "probe",
        backlog_id: request.backlog_id,
        backlog_status: "pending",
      };
    },
  });

  if (priorRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
  else process.env.COC_PI_SESSION_ROLE = priorRole;

  const ctx = {
    cwd: root,
    mode: "rpc",
    model: { provider: "probe", id: "probe" },
    sessionManager: {
      getSessionId: () => `resume-first-memory-${role}`,
      getEntries: () => [],
      getBranch: () => [],
    },
    hasUI: false,
    ui: {
      setHeader() {},
      setStatus() {},
      setFooter() {},
      setWidget() {},
      notify() {},
    },
  };

  const emit = async (type) => {
    for (const handler of handlers.get(type) || []) {
      await handler({ type, reason: "resume-first-memory-probe" }, ctx);
    }
  };
  const invokeTypedResume = async (id = "resume-first-memory") => {
    const tool = tools.get("coc_session_resume");
    assert.ok(tool, "typed session.resume is registered");
    return tool.execute(id, {}, undefined, undefined, ctx);
  };

  return {
    tools,
    canonicalCalls,
    bridgeCalls,
    active,
    sent,
    appended,
    start: () => emit("session_start"),
    shutdown: () => emit("session_shutdown"),
    invokeTypedResume,
  };
}

const operations = (h) => h.canonicalCalls.map((call) => call.operation);
const visibleEnvelope = (toolResult) => JSON.parse(toolResult.content[0].text);

// Welcome/startup may assemble local role context, but setup and play sessions
// alike issue no canonical campaign read before session.resume.  Fresh setup
// without a campaign selector is held to the same zero-call boundary.
for (const [label, options] of [
  ["setup-existing", { role: "setup", startupCampaignId: campaignId }],
  ["play-existing", { role: "play", startupCampaignId: campaignId }],
  ["setup-fresh", { role: "setup", startupCampaignId: null }],
]) {
  const h = makeHarness(options);
  await h.start();
  await flush();
  assert.deepEqual(
    operations(h),
    [],
    `${label}: session_start must issue zero canonical campaign calls`,
  );
  await h.shutdown();
}

// A successful typed resume is the exact first canonical campaign operation;
// its one backlog probe is scheduled only afterwards and never polled.
{
  const h = makeHarness({
    statusResponse: extractionStatus([pendingBacklog]),
  });
  await h.start();
  const resumed = visibleEnvelope(await h.invokeTypedResume("resume-success"));
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  await flush();
  await flush();
  assert.deepEqual(operations(h), [
    "session.resume",
    "memory.extraction_status",
  ]);
  assert.equal(
    h.bridgeCalls.filter((call) => call.command === "prepare").length,
    1,
    "the one post-resume snapshot re-arms its pending row",
  );

  // A repeated success in the same host epoch is not a second re-arm boundary.
  const repeated = visibleEnvelope(await h.invokeTypedResume("resume-repeat"));
  assert.equal(repeated.ok, true, JSON.stringify(repeated));
  await flush();
  assert.deepEqual(operations(h), [
    "session.resume",
    "memory.extraction_status",
    "session.resume",
  ]);
  assert.equal(
    h.bridgeCalls.filter((call) => call.command === "prepare").length,
    1,
    "the same epoch never re-arms the pending row twice",
  );
  await h.shutdown();
}

// Canonical resume failure is not a memory-extraction boundary.
{
  const h = makeHarness({
    resumeEnvelope: {
      ok: false,
      tool: "session.resume",
      error: {
        code: "resume_probe_failed",
        message: "injected resume failure",
        retryable: false,
      },
      warnings: [],
      hints: [],
    },
  });
  await h.start();
  await h.invokeTypedResume("resume-failure");
  await flush();
  assert.deepEqual(operations(h), ["session.resume"]);
  await h.shutdown();
}

// A canonical success whose model projection fails closed also cannot re-arm.
{
  const h = makeHarness({
    resumeEnvelope: resumeSuccess({
      scene_context: {
        schema_version: 1,
        unexpected_identity_id: "opaque",
      },
    }),
  });
  await h.start();
  const projected = visibleEnvelope(await h.invokeTypedResume("resume-projection-failure"));
  assert.equal(projected.ok, false, JSON.stringify(projected));
  assert.equal(projected.error?.code, "semantic_identity_unavailable");
  await flush();
  assert.deepEqual(operations(h), ["session.resume"]);
  await h.shutdown();
}

// The status read is fire-and-forget.  If its old promise settles after a
// shutdown/restart, the old epoch may not enqueue or materialize any work in
// the new dispatcher.
{
  const oldStatus = deferred();
  const h = makeHarness({ statusResponse: () => oldStatus.promise });
  await h.start();
  const resumePromise = h.invokeTypedResume("resume-stale-epoch");
  await flush();
  const resumed = visibleEnvelope(await resumePromise);
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.deepEqual(operations(h), [
    "session.resume",
    "memory.extraction_status",
  ]);

  await h.shutdown();
  await h.start();
  oldStatus.resolve(extractionStatus([pendingBacklog]));
  await flush();
  await flush();
  assert.equal(h.bridgeCalls.length, 0, "stale status result landed after epoch restart");
  assert.deepEqual(operations(h), [
    "session.resume",
    "memory.extraction_status",
  ]);
  await h.shutdown();
}

console.log("resume-first-memory-rearm: startup and epoch boundaries hold");
