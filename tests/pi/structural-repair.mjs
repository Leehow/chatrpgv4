import "./_lib/preload-embedded-pi.mjs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const runtime = await import(path.join(root, "plugins/coc-keeper/pi/lib/runtime.ts"));
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "pi-structural-repair-")));
const leafInstruction = path.join(root, "plugins/coc-keeper/agents/coc-source-pack-worker.md");
const coordinatorInstruction = path.join(root, "plugins/coc-keeper/agents/coc-source-coordinator.md");
const sentinel = "PI_LEAF_PROVIDER_ONLY_SENTINEL_4f8f";

function leafTask(packetId, groupId, rows, pagePath, digest, pdfIndex = 7) {
  return {
    schema_version: 1, contract_id: "coc.pi-source-pack-task.v1",
    instruction_ref: leafInstruction, model_policy: "inherit_parent",
    packet: {
      schema_version: 1, contract_id: "coc.source-pack-worker.v1",
      packet_id: packetId, work_group_id: groupId, source_id: "pdf:test",
      cached_scope_complete: true, requested_pdf_indices: [pdfIndex],
      requests: rows.map((jobId) => ({
        job_id: jobId, cached_scope_complete: true, requested_pdf_indices: [pdfIndex],
        cached_page_refs: [{ source_id: "pdf:test", pdf_index: pdfIndex, path: pagePath, text_sha256: digest }],
      })),
    },
  };
}
function worker(task) {
  return {
    schema_version: 1, contract_id: "coc.source-pack-worker.v1",
    packet_id: task.packet.packet_id, work_group_id: task.packet.work_group_id,
    status: "usable",
    results: task.packet.requests.map((request) => ({ job_id: request.job_id, pack: {}, related_packs: [] })),
  };
}
function coordinatorTask(packetId = "coord-structural", maxLeaves = 2) {
  return {
    schema_version: 1, contract_id: "coc.pi-source-coordinator-task.v1",
    instruction_ref: coordinatorInstruction, model_policy: "inherit_parent",
    packet: {
      schema_version: 1, contract_id: "coc.source-coordinator.v1", packet_id: packetId,
      workspace_root: root, campaign_id: "fixture", asset_root_id: "asset-fixture", max_leaves: maxLeaves,
      claim_operation: { operation: "progressive.claim_host_work", prefilled_arguments: { executor_id: "pi:test", limit: maxLeaves, result_delivery: "task_return_to_parent" } },
      fulfill_operation: { operation: "progressive.fulfill_host_work" },
    },
  };
}
function terminal(value) {
  return [{ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: JSON.stringify(value) }] } }];
}
function assistantParts(parts) {
  return { type: "message_end", message: { role: "assistant", content: parts } };
}
function coordinatorCallEvent(id = "coordinator-call", preamble = null) {
  return assistantParts([
    ...(preamble === null ? [] : [{ type: "text", text: preamble }]),
    { type: "toolCall", id, name: "coc_run_source_coordinator", arguments: {} },
  ]);
}
function coordinatorEvents(toolValue, assistantValue = toolValue) {
  return [
    coordinatorCallEvent(),
    {
      type: "message_end",
      message: {
        role: "toolResult", toolCallId: "coordinator-call", toolName: "coc_run_source_coordinator",
        content: [{ type: "text", text: JSON.stringify(toolValue) }], details: toolValue,
        isError: false, timestamp: Date.now(),
      },
    },
    ...terminal(assistantValue),
  ];
}
const success = (result) => ({ kind: "success", result });
const failure = (stage, failure_class) => ({ kind: "failure", stage, failure_class });
function rejects(call, predicate = () => true) {
  try { call(); return false; }
  catch (error) { return predicate(error); }
}
function check(label, condition) {
  if (!condition) throw new Error(`structural repair assertion failed: ${label}`);
}
const FIXTURE_JOBS_BY_LEASE = new Map([
  ["packet-1", ["job-1a", "job-1b", "job-1c"]],
  ["packet-2", ["job-2"]],
]);
function leaseLifecycleSuccess(args) {
  const jobs = (args.arguments?.lease_ids || []).flatMap(
    (leaseId) => FIXTURE_JOBS_BY_LEASE.get(leaseId) || [],
  );
  if (args.operation === "progressive.renew_host_work_leases") {
    return { data: { renewed_job_ids: jobs, skipped_job_ids: [] } };
  }
  if (args.operation === "progressive.release_host_work_leases") {
    return { data: { released_job_ids: jobs, skipped_job_ids: [] } };
  }
  return null;
}
async function leafProbe(task, mode) {
  const child = spawn(process.execPath, [
    "--experimental-strip-types", path.join(root, "tests/pi/leaf-context-probe.mjs"), root, mode, sentinel,
  ], { cwd: root, stdio: ["ignore", "pipe", "pipe", "pipe"] });
  child.stdio[3].end(JSON.stringify({ nonce: "c".repeat(64), task }));
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => stdout += chunk);
  child.stderr.on("data", (chunk) => stderr += chunk);
  const code = await new Promise((resolve) => child.on("close", resolve));
  if (code !== 0) throw new Error(`leaf probe failed: ${stderr}`);
  return { parsed: JSON.parse(stdout), rawStdoutHasSentinel: stdout.includes(sentinel) };
}
async function leafCliProbe(task) {
  const counter = path.join(temp, `provider-counter-${Math.random().toString(16).slice(2)}.txt`);
  await fs.writeFile(counter, "");
  const cli = path.join(root, "runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
  const child = spawn(process.execPath, [
    cli, "--mode", "json", "-p", "--no-session",
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-tools",
    "--model", "pi-leaf-cli-faux/leaf",
    "--extension", path.join(root, "tests/pi/cli-faux-provider.ts"),
    "--extension", path.join(root, "plugins/coc-keeper/pi/extensions/leaf.ts"),
    "--append-system-prompt", leafInstruction,
  ], {
    cwd: root,
    env: { ...process.env, COC_PI_TEST_PROVIDER_COUNTER: counter },
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  });
  child.stdio[3].end(JSON.stringify({ nonce: "d".repeat(64), task }));
  child.stdin.end("Compile exact injected evidence.\n");
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => stdout += chunk);
  child.stderr.on("data", (chunk) => stderr += chunk);
  const code = await new Promise((resolve) => child.on("close", resolve));
  const providerCalls = (await fs.readFile(counter, "utf8")).trim().split("\n").filter(Boolean).length;
  return {
    exitCode: code,
    exitFailedClosed: code !== 0,
    providerCalls,
    stdoutHasSentinel: stdout.includes(sentinel),
    stderrHasSentinel: stderr.includes(sentinel),
    stdoutIsJsonLines: stdout.trim().split("\n").filter(Boolean).every((line) => { try { JSON.parse(line); return true; } catch { return false; } }),
    stderrBytes: Buffer.byteLength(stderr),
  };
}

try {
  const page = path.join(temp, "page.md");
  const text = `page before ${sentinel} page after\n`;
  await fs.writeFile(page, text);
  const digest = createHash("sha256").update(text).digest("hex");
  const task1 = leafTask("packet-1", "group-1", ["job-1a", "job-1b", "job-1c"], page, digest);
  const task2 = leafTask("packet-2", "group-2", ["job-2"], page, digest);

  const evidence = await runtime.buildLeafEvidenceContext(task1);
  const evidenceJson = JSON.stringify(evidence);
  const immutable = Object.isFrozen(evidence) && Object.isFrozen(evidence.task) && Object.isFrozen(evidence.pages) && Object.isFrozen(evidence.pages[0]);
  const pageProjectionHasPath = Object.hasOwn(evidence.pages[0], "path");
  const happyProbe = await leafProbe(leafTask("packet-context", "group-context", ["job-context"], page, digest), "happy");

  const badHashTask = structuredClone(task1);
  badHashTask.packet.requests.forEach((request) => request.cached_page_refs[0].text_sha256 = "0".repeat(64));
  const validCliProbe = await leafCliProbe(leafTask("packet-cli-valid", "group-cli-valid", ["job-cli-valid"], page, digest));
  const badHashProbe = await leafCliProbe(badHashTask);
  const badRefTask = structuredClone(task1);
  badRefTask.packet.requested_pdf_indices = [8];
  badRefTask.packet.requests.forEach((request) => request.requested_pdf_indices = [8]);
  const badRefProbe = await leafCliProbe(badRefTask);
  const missingFlagTask = structuredClone(task1);
  delete missingFlagTask.packet.requests[0].cached_scope_complete;
  const missingFlagProbe = await leafCliProbe(missingFlagTask);
  const secondPage = path.join(temp, "page-2.md");
  await fs.writeFile(secondPage, "second page\n");
  const secondDigest = createHash("sha256").update("second page\n").digest("hex");
  const crossedTask = leafTask("packet-crossed", "group-crossed", ["job-cross-a", "job-cross-b"], page, digest);
  crossedTask.packet.requested_pdf_indices = [7, 8];
  crossedTask.packet.requests[0].requested_pdf_indices = [7];
  crossedTask.packet.requests[0].cached_page_refs = [{ source_id: "pdf:test", pdf_index: 8, path: secondPage, text_sha256: secondDigest }];
  crossedTask.packet.requests[1].requested_pdf_indices = [8];
  crossedTask.packet.requests[1].cached_page_refs = [{ source_id: "pdf:test", pdf_index: 7, path: page, text_sha256: digest }];
  const crossedProbe = await leafCliProbe(crossedTask);
  const largePage = path.join(temp, "large.md");
  await fs.writeFile(largePage, "x".repeat(runtime.MAX_BYTES + 10));
  const largeDigest = createHash("sha256").update("x".repeat(runtime.MAX_BYTES + 10)).digest("hex");
  const largeProbe = await leafCliProbe(leafTask("packet-large", "group-large", ["job-large"], largePage, largeDigest));

  const forwarded = [];
  const result1 = worker(task1), result2 = worker(task2);

  // Typed thinking is the only ignorable message metadata. Every other part
  // remains inside the strict leaf/coordinator framing boundary.
  const thinking = { type: "thinking", thinking: "private reasoning" };
  const resultText = { type: "text", text: JSON.stringify(result1) };
  check("leaf thinking+text passes", JSON.stringify(runtime.parseStrictWorkerResult(
    [assistantParts([thinking, resultText])], task1,
  )) === JSON.stringify(result1));
  check("leaf multiple thinking around text passes", JSON.stringify(runtime.parseStrictWorkerResult(
    [assistantParts([thinking, resultText, { type: "thinking", thinking: "more" }])], task1,
  )) === JSON.stringify(result1));
  for (const [label, parts] of [
    ["leaf thinking+tool+text rejected", [thinking, { type: "toolCall", id: "x", name: "x", arguments: {} }, resultText]],
    ["leaf thinking+text+image rejected", [thinking, resultText, { type: "image", data: "x" }]],
    ["leaf thinking+text+unknown rejected", [thinking, resultText, { type: "futurePart" }]],
    ["leaf multi-text rejected", [resultText, resultText]],
    ["leaf blank-text rejected", [{ type: "text", text: "   " }]],
    ["leaf thinking-only rejected", [thinking]],
    ["leaf malformed-json rejected", [{ type: "text", text: "{" }]],
  ]) {
    check(label, rejects(
      () => runtime.parseStrictWorkerResult([assistantParts(parts)], task1),
      (error) => error instanceof runtime.LeafStageError && error.failureClass === "leaf_result_not_bare",
    ));
  }
  check("leaf duplicate terminal rejected", rejects(
    () => runtime.parseStrictWorkerResult([
      assistantParts([resultText]), assistantParts([resultText]),
    ], task1),
    (error) => error instanceof runtime.LeafStageError && error.failureClass === "leaf_result_not_bare",
  ));
  check("leaf binding remains validation failure", rejects(
    () => runtime.parseStrictWorkerResult(
      terminal({ ...result1, packet_id: "wrong-packet" }), task1,
    ),
    (error) => error instanceof runtime.LeafStageError && error.failureClass === "leaf_result_invalid",
  ));

  const partial = await runtime.runCoordinatorLifecycle(coordinatorTask(), {
    call: async (_name, args) => {
      if (args.operation === "progressive.claim_host_work") return { data: { dispatch_tasks: [task1, task2] } };
      const leaseResult = leaseLifecycleSuccess(args);
      if (leaseResult) return leaseResult;
      forwarded.push(args.arguments.worker_result);
      if (args.arguments.worker_result.job_id === "job-1b") throw new Error("fixture reject");
      return { data: { accepted: true } };
    },
    spawnLeaf: async (task) => success(task.packet.packet_id === "packet-1" ? result1 : result2),
  });
  const siblingContinued = forwarded.map((row) => row.job_id).join(",") === "job-1a,job-1b,job-2";
  const identityPreserved = forwarded[0] === result1.results[0] && forwarded[1] === result1.results[1] && forwarded[2] === result2.results[0];

  const rejectedRows = [];
  const rejectedLeafPartial = await runtime.runCoordinatorLifecycle(coordinatorTask("coord-rejected"), {
    call: async (_name, args) => {
      if (args.operation === "progressive.claim_host_work") return { data: { dispatch_tasks: [task1, task2] } };
      const leaseResult = leaseLifecycleSuccess(args);
      if (leaseResult) return leaseResult;
      rejectedRows.push(args.arguments.worker_result);
      return { data: { accepted: true } };
    },
    spawnLeaf: async (task) => {
      if (task.packet.packet_id === "packet-1") return failure("process", "leaf_dispatch_failed");
      return success(result2);
    },
  });
  const allFailed = await runtime.runCoordinatorLifecycle(coordinatorTask("coord-failed"), {
    call: async (_name, args) => {
      if (args.operation === "progressive.claim_host_work") return { data: { dispatch_tasks: [task1, task2] } };
      return leaseLifecycleSuccess(args) ?? { data: { accepted: true } };
    },
    spawnLeaf: async () => failure("activation", "leaf_dispatch_failed"),
  });
  const invalidRows = [];
  const invalidLeafPartial = await runtime.runCoordinatorLifecycle(coordinatorTask("coord-invalid"), {
    call: async (_name, args) => {
      if (args.operation === "progressive.claim_host_work") return { data: { dispatch_tasks: [task1, task2] } };
      const leaseResult = leaseLifecycleSuccess(args);
      if (leaseResult) return leaseResult;
      invalidRows.push(args.arguments.worker_result);
      return { data: { accepted: true } };
    },
    spawnLeaf: async (task) => task.packet.packet_id === "packet-1"
      ? success({ ...result1, packet_id: "wrong-packet" })
      : success(result2),
  });

  const toolCallThenTerminalEvents = [
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "hallucinated-call", name: "not-available", arguments: {} }],
      },
    },
    ...terminal(result1),
  ];
  const framingRun = { child: {}, terminate: async () => {}, activation: Promise.resolve({ type: "agent_start" }), completion: Promise.resolve(toolCallThenTerminalEvents) };
  const invalidRun = { child: {}, terminate: async () => {}, activation: Promise.resolve({ type: "agent_start" }), completion: Promise.resolve(terminal({ ...result1, packet_id: "wrong" })) };
  const activationRun = { child: {}, terminate: async () => {}, activation: Promise.reject(new Error("activation")), completion: Promise.resolve([]) };
  const productionOwned = new Set();
  const productionFailures = [
    await runtime.collectLeafExecution(framingRun, productionOwned, task1),
    await runtime.collectLeafExecution(invalidRun, productionOwned, task1),
    await runtime.collectLeafExecution(activationRun, productionOwned, task1),
  ];
  const framingRows = [];
  const framingLeafPartial = await runtime.runCoordinatorLifecycle(coordinatorTask("coord-framing"), {
    call: async (_name, args) => {
      if (args.operation === "progressive.claim_host_work") return { data: { dispatch_tasks: [task1, task2] } };
      const leaseResult = leaseLifecycleSuccess(args);
      if (leaseResult) return leaseResult;
      framingRows.push(args.arguments.worker_result);
      return { data: { accepted: true } };
    },
    spawnLeaf: async (task) => task.packet.packet_id === "packet-1" ? productionFailures[0] : success(result2),
  });
  const framingSiblingExact = framingRows.length === 1 && framingRows[0] === result2.results[0];

  // Private lease lifecycle: exact ownership is renewed while a leaf is
  // running, and successful fulfillment closes the lease without release.
  const renewCalls = [], renewAudit = [];
  let resolveRenewLeaf;
  let leafExecutionCompleted = false;
  let renewDuringFulfill = 0;
  const renewLifecyclePromise = runtime.runCoordinatorLifecycle(coordinatorTask("coord-renew", 1), {
    call: async (_name, args, signal) => {
      if (args.operation === "progressive.claim_host_work") return { data: { dispatch_tasks: [task1] } };
      renewCalls.push({ args, signalAborted: signal?.aborted === true });
      if (args.operation === "progressive.renew_host_work_leases") {
        if (leafExecutionCompleted) renewDuringFulfill += 1;
        return { data: { renewed_job_ids: ["job-1a", "job-1b", "job-1c"], skipped_job_ids: [] } };
      }
      if (args.operation === "progressive.fulfill_host_work") {
        if (args.arguments.worker_result.job_id === "job-1a") {
          await new Promise((resolve) => setTimeout(resolve, 8));
        }
        return { data: { accepted: true } };
      }
      throw new Error("release must not run after exact fulfillment");
    },
    spawnLeaf: async () => new Promise((resolveLeaf) => { resolveRenewLeaf = resolveLeaf; }),
    leaseHeartbeatMs: 2,
    leaseCallGraceMs: 50,
    onLeaseLifecycle: (entry) => renewAudit.push(entry),
  });
  await new Promise((resolve) => setTimeout(resolve, 8));
  leafExecutionCompleted = true;
  resolveRenewLeaf(success(result1));
  const renewLifecycleResult = await renewLifecyclePromise;
  const exactRenewCalls = renewCalls.filter((entry) => entry.args.operation === "progressive.renew_host_work_leases");
  const releaseAfterFulfill = renewCalls.filter((entry) => entry.args.operation === "progressive.release_host_work_leases");
  check("renew heartbeat uses exact lease ownership", exactRenewCalls.length >= 1
    && exactRenewCalls.every((entry) => (
      entry.signalAborted === false
      && entry.args.arguments.asset_root_id === "asset-fixture"
      && entry.args.arguments.executor_id === "pi:test"
      && JSON.stringify(entry.args.arguments.lease_ids) === JSON.stringify(["packet-1"])
      && entry.args.arguments.lease_seconds === runtime.LEASE_RENEW_SECONDS
    )));
  check("successful fulfill is not downgraded or released",
    renewLifecycleResult.status === "fulfilled"
    && releaseAfterFulfill.length === 0
    && renewDuringFulfill >= 1
    && renewAudit.some((entry) => entry.phase === "renew" && entry.status === "succeeded")
    && !renewAudit.some((entry) => entry.phase === "ttl_fallback"));

  const COVERAGE_MODES = ["exact", "subset", "mixed", "foreign", "duplicate", "overlap", "malformed"];
  function coverageResponse(mode, positiveField, skippedField) {
    const positive = {
      exact: ["job-1a", "job-1b", "job-1c"],
      subset: ["job-1a"],
      mixed: ["job-1a"],
      foreign: ["foreign-job"],
      duplicate: ["job-1a", "job-1a", "job-1b", "job-1c"],
      overlap: ["job-1a", "job-1b", "job-1c"],
      malformed: ["job-1a", 7, "job-1b", "job-1c"],
    }[mode];
    const skipped = mode === "mixed"
      ? ["job-1b", "job-1c"]
      : mode === "overlap" ? ["job-1a"] : [];
    return { data: { [positiveField]: positive, [skippedField]: skipped } };
  }
  function coverageSummary(resultValue, audit, phase) {
    const disposition = audit.find((entry) => entry.phase === phase);
    return {
      resultStatus: resultValue.status,
      lifecycleStatus: disposition?.status ?? null,
      failureClass: disposition?.failure_class ?? null,
      ttlFallback: audit.some((entry) => (
        entry.phase === "ttl_fallback"
        && entry.status === "ttl_fallback"
        && entry.recovery === "bounded_ttl"
      )),
    };
  }
  async function renewCoverageProbe(mode) {
    const audit = [];
    let resolveLeaf;
    const lifecycle = runtime.runCoordinatorLifecycle(coordinatorTask(`coord-renew-coverage-${mode}`, 1), {
      call: async (_name, args) => {
        if (args.operation === "progressive.claim_host_work") return { data: { dispatch_tasks: [task1] } };
        if (args.operation === "progressive.renew_host_work_leases") {
          return coverageResponse(mode, "renewed_job_ids", "skipped_job_ids");
        }
        if (args.operation === "progressive.fulfill_host_work") return { data: { accepted: true } };
        throw new Error("renew coverage probe must not release a fulfilled lease");
      },
      spawnLeaf: async () => new Promise((resolveExecution) => { resolveLeaf = resolveExecution; }),
      leaseHeartbeatMs: 1,
      leaseCallGraceMs: 50,
      onLeaseLifecycle: (entry) => audit.push(entry),
    });
    await new Promise((resolve) => setTimeout(resolve, 4));
    resolveLeaf(success(result1));
    const lifecycleResult = await lifecycle;
    return coverageSummary(lifecycleResult, audit, "renew");
  }
  const renewCoverage = {};
  for (const mode of COVERAGE_MODES) renewCoverage[mode] = await renewCoverageProbe(mode);
  check("renew response coverage is exact and conservative",
    renewCoverage.exact.lifecycleStatus === "succeeded"
    && renewCoverage.exact.ttlFallback === false
    && renewCoverage.subset.lifecycleStatus === "partial"
    && renewCoverage.subset.failureClass === "lease_ownership_partial"
    && renewCoverage.subset.ttlFallback === true
    && renewCoverage.mixed.lifecycleStatus === "partial"
    && renewCoverage.mixed.failureClass === "lease_ownership_partial"
    && renewCoverage.mixed.ttlFallback === true
    && ["foreign", "duplicate", "overlap", "malformed"].every((mode) => (
      renewCoverage[mode].lifecycleStatus === "failed"
      && renewCoverage[mode].failureClass === "lease_response_invalid"
      && renewCoverage[mode].ttlFallback === true
    ))
    && COVERAGE_MODES.every((mode) => renewCoverage[mode].resultStatus === "fulfilled"));

  // Interrupt/shutdown gets a separate, non-aborted cleanup grace and exact
  // release. It never reuses the already-aborted leaf signal.
  const interruptController = new AbortController();
  const interruptCalls = [], interruptAudit = [];
  const interruptPromise = runtime.runCoordinatorLifecycle(coordinatorTask("coord-interrupt", 1), {
    signal: interruptController.signal,
    call: async (_name, args, signal) => {
      if (args.operation === "progressive.claim_host_work") return { data: { dispatch_tasks: [task1] } };
      interruptCalls.push({ args, signalAborted: signal?.aborted === true });
      if (args.operation === "progressive.release_host_work_leases") {
        return { data: { released_job_ids: ["job-1a", "job-1b", "job-1c"], skipped_job_ids: [] } };
      }
      throw new Error("unexpected interrupt lifecycle call");
    },
    spawnLeaf: async (_task, signal) => new Promise((resolveLeaf) => {
      const aborted = () => resolveLeaf(failure("process", "leaf_dispatch_failed"));
      if (signal?.aborted) aborted();
      else signal?.addEventListener("abort", aborted, { once: true });
    }),
    leaseHeartbeatMs: 1_000,
    leaseCallGraceMs: 50,
    onLeaseLifecycle: (entry) => interruptAudit.push(entry),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  interruptController.abort("session_shutdown");
  const interruptResult = await interruptPromise;
  const interruptRelease = interruptCalls.find((entry) => entry.args.operation === "progressive.release_host_work_leases");
  check("interrupt gracefully releases exact ownership with independent grace",
    interruptResult.status === "failed"
    && interruptRelease?.signalAborted === false
    && interruptRelease.args.arguments.asset_root_id === "asset-fixture"
    && interruptRelease.args.arguments.executor_id === "pi:test"
    && JSON.stringify(interruptRelease.args.arguments.lease_ids) === JSON.stringify(["packet-1"])
    && interruptRelease.args.arguments.reason === "coordinator_shutdown"
    && interruptAudit.some((entry) => entry.phase === "release" && entry.status === "succeeded"));

  async function releaseFailureProbe(mode) {
    const calls = [], audit = [];
    const lifecycleResult = await runtime.runCoordinatorLifecycle(coordinatorTask(`coord-release-${mode}`, 1), {
      call: async (_name, args, signal) => {
        if (args.operation === "progressive.claim_host_work") return { data: { dispatch_tasks: [task1] } };
        calls.push({ args, signalAborted: signal?.aborted === true });
        if (args.operation !== "progressive.release_host_work_leases") throw new Error("unexpected release probe call");
        if (mode === "wrong-owner") {
          return { data: { released_job_ids: [], skipped_job_ids: ["job-1a", "job-1b", "job-1c"] } };
        }
        if (COVERAGE_MODES.includes(mode)) return coverageResponse(mode, "released_job_ids", "skipped_job_ids");
        throw new Error("raw release transport failure");
      },
      spawnLeaf: async () => failure("process", "leaf_dispatch_failed"),
      leaseHeartbeatMs: 1_000,
      leaseCallGraceMs: 50,
      onLeaseLifecycle: (entry) => audit.push(entry),
    });
    return { lifecycleResult, calls, audit };
  }
  const wrongOwnerRelease = await releaseFailureProbe("wrong-owner");
  const releaseCoverage = {};
  for (const mode of COVERAGE_MODES) {
    const probe = await releaseFailureProbe(mode);
    releaseCoverage[mode] = coverageSummary(probe.lifecycleResult, probe.audit, "release");
  }
  const failedRelease = await releaseFailureProbe("transport");
  check("wrong-owner release fails closed and falls back only to TTL",
    wrongOwnerRelease.lifecycleResult.status === "failed"
    && wrongOwnerRelease.audit.some((entry) => (
      entry.phase === "release"
      && entry.status === "rejected"
      && entry.failure_class === "lease_ownership_mismatch"
    ))
    && wrongOwnerRelease.audit.some((entry) => (
      entry.phase === "ttl_fallback"
      && entry.status === "ttl_fallback"
      && entry.recovery === "bounded_ttl"
      && entry.status !== "succeeded"
    )));
  check("release response coverage is exact and conservative",
    releaseCoverage.exact.lifecycleStatus === "succeeded"
    && releaseCoverage.exact.ttlFallback === false
    && releaseCoverage.subset.lifecycleStatus === "partial"
    && releaseCoverage.subset.failureClass === "lease_ownership_partial"
    && releaseCoverage.subset.ttlFallback === true
    && releaseCoverage.mixed.lifecycleStatus === "partial"
    && releaseCoverage.mixed.failureClass === "lease_ownership_partial"
    && releaseCoverage.mixed.ttlFallback === true
    && ["foreign", "duplicate", "overlap", "malformed"].every((mode) => (
      releaseCoverage[mode].lifecycleStatus === "failed"
      && releaseCoverage[mode].failureClass === "lease_response_invalid"
      && releaseCoverage[mode].ttlFallback === true
    )));

  // One row fulfills canonically, the next rejects, and release confirms only
  // the still-open rows. A skipped already-closed row is not misclassified.
  const partialFulfillAudit = [];
  const partialFulfillRelease = await runtime.runCoordinatorLifecycle(coordinatorTask("coord-release-after-partial-fulfill", 1), {
    call: async (_name, args) => {
      if (args.operation === "progressive.claim_host_work") return { data: { dispatch_tasks: [task1] } };
      if (args.operation === "progressive.fulfill_host_work") {
        if (args.arguments.worker_result.job_id === "job-1a") return { data: { accepted: true } };
        throw new Error("fixture fulfill rejection");
      }
      if (args.operation === "progressive.release_host_work_leases") {
        return {
          data: {
            released_job_ids: ["job-1b", "job-1c"],
            skipped_job_ids: ["job-1a"],
          },
        };
      }
      throw new Error("unexpected partial fulfill lifecycle call");
    },
    spawnLeaf: async () => success(result1),
    leaseHeartbeatMs: 1_000,
    leaseCallGraceMs: 50,
    onLeaseLifecycle: (entry) => partialFulfillAudit.push(entry),
  });
  check("partial fulfill releases only remaining jobs without false TTL fallback",
    partialFulfillRelease.status === "partial"
    && partialFulfillRelease.fulfilled_result_count === 1
    && partialFulfillAudit.some((entry) => entry.phase === "release" && entry.status === "succeeded")
    && !partialFulfillAudit.some((entry) => entry.phase === "ttl_fallback"));
  check("release transport failure keeps terminal audit without raw error",
    failedRelease.lifecycleResult.status === "failed"
    && failedRelease.audit.some((entry) => (
      entry.phase === "release"
      && entry.status === "failed"
      && entry.failure_class === "lease_call_failed"
    ))
    && failedRelease.audit.some((entry) => (
      entry.phase === "ttl_fallback"
      && entry.status === "ttl_fallback"
      && entry.recovery === "bounded_ttl"
    ))
    && !JSON.stringify(failedRelease.audit).includes("raw release transport failure"));

  const validTerminal = runtime.validateCoordinatorResult(partial, coordinatorTask());
  const lifecycleEvent = coordinatorEvents(validTerminal)[1];
  const coordinatorText = { type: "text", text: JSON.stringify(validTerminal) };
  const coordinatorThinkingEvents = [
    assistantParts([thinking, { type: "toolCall", id: "coordinator-call", name: "coc_run_source_coordinator", arguments: {} }]),
    lifecycleEvent,
    assistantParts([thinking, coordinatorText]),
  ];
  check("coordinator thinking+tool and thinking+text pass", JSON.stringify(
    runtime.parseStrictCoordinatorResult(coordinatorThinkingEvents, coordinatorTask()),
  ) === JSON.stringify(validTerminal));
  const coordinatorPreambleEvents = [
    assistantParts([
      thinking,
      { type: "text", text: "I will run the exact coordinator lifecycle now." },
      { type: "toolCall", id: "coordinator-call", name: "coc_run_source_coordinator", arguments: {} },
    ]),
    lifecycleEvent,
    assistantParts([thinking, coordinatorText]),
  ];
  check("coordinator ordinary pre-tool text plus exact tool call passes", JSON.stringify(
    runtime.parseStrictCoordinatorResult(coordinatorPreambleEvents, coordinatorTask()),
  ) === JSON.stringify(validTerminal));
  for (const [label, events] of [
    ["coordinator tool+image rejected", [
      assistantParts([thinking, { type: "toolCall", id: "x", name: "coc_run_source_coordinator", arguments: {} }, { type: "image", data: "x" }]),
      lifecycleEvent,
      assistantParts([coordinatorText]),
    ]],
    ["coordinator foreign tool rejected", [
      assistantParts([
        { type: "text", text: "Calling a tool." },
        { type: "toolCall", id: "x", name: "foreign_tool", arguments: {} },
      ]),
      lifecycleEvent,
      assistantParts([coordinatorText]),
    ]],
    ["coordinator multiple tools rejected", [
      assistantParts([
        { type: "toolCall", id: "x", name: "coc_run_source_coordinator", arguments: {} },
        { type: "toolCall", id: "y", name: "coc_run_source_coordinator", arguments: {} },
      ]),
      lifecycleEvent,
      assistantParts([coordinatorText]),
    ]],
    ["coordinator post-tool text rejected", [
      assistantParts([
        { type: "toolCall", id: "x", name: "coc_run_source_coordinator", arguments: {} },
        { type: "text", text: "This is not a pre-tool preamble." },
      ]),
      lifecycleEvent,
      assistantParts([coordinatorText]),
    ]],
    ["coordinator terminal image rejected", [
      coordinatorCallEvent(),
      lifecycleEvent,
      assistantParts([thinking, coordinatorText, { type: "image", data: "x" }]),
    ]],
    ["coordinator terminal unknown rejected", [
      coordinatorCallEvent(),
      lifecycleEvent,
      assistantParts([thinking, coordinatorText, { type: "futurePart" }]),
    ]],
    ["coordinator terminal multi-text rejected", [
      coordinatorCallEvent(),
      lifecycleEvent,
      assistantParts([coordinatorText, coordinatorText]),
    ]],
    ["coordinator terminal thinking-only rejected", [
      coordinatorCallEvent(),
      lifecycleEvent,
      assistantParts([thinking]),
    ]],
    ["coordinator separate duplicate calls rejected", [
      coordinatorCallEvent("coordinator-call"),
      coordinatorCallEvent("coordinator-call-2"),
      lifecycleEvent,
      assistantParts([coordinatorText]),
    ]],
    ["coordinator call after terminal rejected", [
      coordinatorCallEvent("coordinator-call"),
      lifecycleEvent,
      assistantParts([coordinatorText]),
      coordinatorCallEvent("coordinator-call-2"),
    ]],
    ["coordinator tool-only plus preamble tool rejected", [
      coordinatorCallEvent("coordinator-call"),
      coordinatorCallEvent(
        "coordinator-call-2",
        "I will call the coordinator a second time.",
      ),
      lifecycleEvent,
      assistantParts([coordinatorText]),
    ]],
    ["coordinator lifecycle call id drift rejected", [
      coordinatorCallEvent("wrong-call-id"),
      lifecycleEvent,
      assistantParts([coordinatorText]),
    ]],
  ]) check(label, rejects(() => runtime.parseStrictCoordinatorResult(events, coordinatorTask())));

  let absentRejected = false, duplicateRejected = false, bindingRejected = false, authorityRejected = false, contentDetailsRejected = false, impossibleRejected = false, designIssueRejected = false;
  try { runtime.parseStrictCoordinatorResult([], coordinatorTask()); } catch { absentRejected = true; }
  try { runtime.parseStrictCoordinatorResult([...coordinatorEvents(validTerminal), ...coordinatorEvents(validTerminal)], coordinatorTask()); } catch { duplicateRejected = true; }
  try { runtime.parseStrictCoordinatorResult(coordinatorEvents({ ...validTerminal, packet_id: "other" }), coordinatorTask()); } catch { bindingRejected = true; }
  try {
    runtime.parseStrictCoordinatorResult(coordinatorEvents(
      { ...validTerminal, status: "failed", fulfilled_result_count: 0, failure_class: "claim_failed" },
      validTerminal,
    ), coordinatorTask());
  } catch { authorityRejected = true; }
  try {
    const mismatched = coordinatorEvents(validTerminal);
    mismatched[1].message.details = {
      ...validTerminal,
      status: "failed",
      fulfilled_result_count: 0,
      failure_class: "claim_failed",
    };
    runtime.parseStrictCoordinatorResult(mismatched, coordinatorTask());
  } catch { contentDetailsRejected = true; }
  try { runtime.validateCoordinatorResult({ ...validTerminal, claimed_packet_count: 999, leaf_task_count: 999, fulfilled_result_count: 999 }, coordinatorTask()); } catch { impossibleRejected = true; }
  try { runtime.validateCoordinatorResult({ ...validTerminal, status: "design_issue", failure_class: "claim_failed" }, coordinatorTask()); } catch { designIssueRejected = true; }
  check("coordinator strict receipt gates preserved", [
    absentRejected, duplicateRejected, bindingRejected, authorityRejected,
    contentDetailsRejected, impossibleRejected, designIssueRejected,
  ].every(Boolean));

  const notifications = [], lifecycle = [];
  const dispatchTask = coordinatorTask("coord-manager");
  let complete;
  const fakeRun = {
    child: {}, terminate: async () => {}, activation: Promise.resolve({ type: "agent_start" }),
    completion: new Promise((resolve) => complete = resolve),
  };
  const manager = new runtime.CoordinatorDispatchManager(
    () => fakeRun,
    (receipt) => notifications.push(receipt),
    (observation) => lifecycle.push(observation),
  );
  await manager.submit(dispatchTask, { cwd: root, provider: "p", modelId: "m", thinking: "off" });
  const managerReceipt = { ...partial, packet_id: "coord-manager" };
  complete(coordinatorEvents(managerReceipt));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const duplicateDiagnostic = await manager.submit(dispatchTask, { cwd: root, provider: "p", modelId: "m", thinking: "off" });
  const absentNotifications = [], absentLifecycle = [];
  const absentTask = coordinatorTask("coord-manager-absent");
  const absentManager = new runtime.CoordinatorDispatchManager(() => ({
    child: {}, terminate: async () => {}, activation: Promise.resolve({ type: "agent_start" }), completion: Promise.resolve([]),
  }), (receipt) => absentNotifications.push(receipt), (observation) => absentLifecycle.push(observation));
  await absentManager.submit(absentTask, { cwd: root, provider: "p", modelId: "m", thinking: "off" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const throwingTask = coordinatorTask("coord-manager-notify-failure");
  const throwingRun = {
    child: {}, terminate: async () => {}, activation: Promise.resolve({ type: "agent_start" }),
    completion: Promise.resolve(coordinatorEvents({ ...managerReceipt, packet_id: "coord-manager-notify-failure" })),
  };
  const throwingLifecycle = [];
  const throwingManager = new runtime.CoordinatorDispatchManager(
    () => throwingRun,
    () => { throw new Error("notify failed"); },
    (observation) => throwingLifecycle.push(observation),
  );
  await throwingManager.submit(throwingTask, { cwd: root, provider: "p", modelId: "m", thinking: "off" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const rejectedLifecycle = [];
  const rejectedManager = new runtime.CoordinatorDispatchManager(() => ({
    child: {}, terminate: async () => {}, activation: Promise.resolve({ type: "agent_start" }),
    completion: Promise.reject(new Error("raw provider completion text")),
  }), undefined, (observation) => rejectedLifecycle.push(observation));
  await rejectedManager.submit(coordinatorTask("coord-manager-rejected"), { cwd: root, provider: "p", modelId: "m", thinking: "off" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  let terminateRelease, completeRace;
  const raceLifecycle = [];
  const raceTask = coordinatorTask("coord-manager-race");
  const raceRun = {
    child: {}, activation: Promise.resolve({ type: "agent_start" }),
    completion: new Promise((resolve) => completeRace = resolve),
    terminate: () => new Promise((resolve) => terminateRelease = resolve),
  };
  const raceManager = new runtime.CoordinatorDispatchManager(
    () => raceRun,
    undefined,
    (observation) => raceLifecycle.push(observation),
  );
  await raceManager.submit(raceTask, { cwd: root, provider: "p", modelId: "m", thinking: "off" });
  const shutdownPromise = raceManager.shutdown();
  let closingRejected = false;
  try { await raceManager.submit(coordinatorTask("coord-manager-race-new"), { cwd: root, provider: "p", modelId: "m", thinking: "off" }); } catch { closingRejected = true; }
  terminateRelease();
  await shutdownPromise;
  completeRace(coordinatorEvents({ ...managerReceipt, packet_id: "coord-manager-race" }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  check("validated completion observed once", lifecycle.length === 1
    && lifecycle[0].status === "completed"
    && lifecycle[0].dispatch_key === "coord-manager");
  check("parse failure observed once", absentLifecycle.length === 1
    && absentLifecycle[0].status === "terminal_failure"
    && absentLifecycle[0].failure_stage === "framing"
    && !Object.hasOwn(absentLifecycle[0], "error"));
  check("process rejection observed once and bounded", rejectedLifecycle.length === 1
    && rejectedLifecycle[0].status === "terminal_failure"
    && rejectedLifecycle[0].failure_stage === "process"
    && !JSON.stringify(rejectedLifecycle[0]).includes("raw provider completion text"));
  check("notification failure preserves one completed observation", throwingLifecycle.length === 1
    && throwingLifecycle[0].status === "completed"
    && throwingManager.state("coord-manager-notify-failure").notification.failure_class === "notification_callback_failed");
  check("shutdown race observed once", raceLifecycle.length === 1
    && raceLifecycle[0].status === "terminal_failure"
    && raceLifecycle[0].failure_stage === "shutdown");

  const appended = [], sent = [];
  const notificationReport = main.publishCoordinatorTerminal({
    appendEntry: (...args) => appended.push(args),
    sendMessage: (...args) => sent.push(args),
  }, managerReceipt);
  const partialAppended = [], partialSent = [];
  const partialNotificationReport = main.publishCoordinatorTerminal({
    appendEntry: (...args) => partialAppended.push(args),
    sendMessage: (...args) => { partialSent.push(args); throw new Error("send failed"); },
  }, managerReceipt);
  const notificationText = JSON.stringify({ appended, sent });

  process.stdout.write(JSON.stringify({
    evidence: {
      contract: evidence.contract_id, immutable, pageProjectionHasPath,
      containsNonce: evidenceJson.includes("c".repeat(64)),
      containsSecretKey: evidenceJson.includes("BAIDUOCR_TOKEN"),
    },
    happyProbe,
    validCliProbe,
    preloadFailures: [badHashProbe, badRefProbe, missingFlagProbe, crossedProbe, largeProbe],
    partial, siblingContinued, identityPreserved,
    rejectedLeafPartial, rejectedLeafForwarded: rejectedRows.map((row) => row.job_id),
    invalidLeafPartial, invalidLeafForwarded: invalidRows.map((row) => row.job_id),
    productionFailures,
    framingLeafPartial, framingLeafForwarded: framingRows.map((row) => row.job_id), framingSiblingExact,
    allFailed,
    leaseLifecycle: {
      renewExact: exactRenewCalls.length >= 1,
      renewCount: exactRenewCalls.length,
      renewDuringFulfill,
      fulfillPreserved: renewLifecycleResult.status === "fulfilled",
      renewAudit,
      renewCoverage,
      releaseAfterFulfill: releaseAfterFulfill.length,
      interruptRelease: interruptRelease ? {
        signalAborted: interruptRelease.signalAborted,
        arguments: interruptRelease.args.arguments,
      } : null,
      interruptStatus: interruptResult.status,
      wrongOwnerAudit: wrongOwnerRelease.audit,
      releaseCoverage,
      partialFulfillRelease: {
        resultStatus: partialFulfillRelease.status,
        fulfilledResultCount: partialFulfillRelease.fulfilled_result_count,
        audit: partialFulfillAudit,
      },
      releaseFailureAudit: failedRelease.audit,
      hardCrashRecoveryClaim: "bounded TTL only; no graceful release receipt exists after abrupt process loss",
    },
    terminal: { absentRejected, duplicateRejected, bindingRejected, authorityRejected, contentDetailsRejected, impossibleRejected, designIssueRejected },
    manager: {
      notifications: notifications.length, lifecycle: lifecycle.length, duplicateDiagnostic,
      absentState: absentManager.state("coord-manager-absent"),
      absentNotifications: absentNotifications.length,
      absentLifecycle: absentLifecycle.length,
      rejectedLifecycle: rejectedLifecycle.length,
      throwingState: throwingManager.state("coord-manager-notify-failure"),
      throwingLifecycle: throwingLifecycle.length,
      closingRejected, raceActive: raceManager.activeCount(), raceLifecycle: raceLifecycle.length,
    },
    notification: {
      appended: appended.length,
      sent: sent.length,
      options: sent[0][1],
      customTypes: [appended[0][0], sent[0][0].customType],
      leaksSource: notificationText.includes(sentinel) || notificationText.includes("pack\":{}"),
      report: notificationReport,
      partialReport: partialNotificationReport,
      partialAppendCalls: partialAppended.length,
      partialSendCalls: partialSent.length,
    },
  }));
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
