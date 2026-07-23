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
      workspace_root: root, campaign_id: "fixture", max_leaves: maxLeaves,
      claim_operation: { operation: "progressive.claim_host_work", prefilled_arguments: { executor_id: "pi:test", limit: maxLeaves, result_delivery: "task_return_to_parent" } },
      fulfill_operation: { operation: "progressive.fulfill_host_work" },
    },
  };
}
function terminal(value) {
  return [{ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: JSON.stringify(value) }] } }];
}
function coordinatorEvents(toolValue, assistantValue = toolValue) {
  return [
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
  const partial = await runtime.runCoordinatorLifecycle(coordinatorTask(), {
    call: async (_name, args) => {
      if (args.operation === "progressive.claim_host_work") return { data: { dispatch_tasks: [task1, task2] } };
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
      rejectedRows.push(args.arguments.worker_result);
      return { data: { accepted: true } };
    },
    spawnLeaf: async (task) => {
      if (task.packet.packet_id === "packet-1") return failure("process", "leaf_dispatch_failed");
      return success(result2);
    },
  });
  const allFailed = await runtime.runCoordinatorLifecycle(coordinatorTask("coord-failed"), {
    call: async (_name, args) => args.operation === "progressive.claim_host_work"
      ? { data: { dispatch_tasks: [task1, task2] } }
      : { data: { accepted: true } },
    spawnLeaf: async () => failure("activation", "leaf_dispatch_failed"),
  });
  const invalidRows = [];
  const invalidLeafPartial = await runtime.runCoordinatorLifecycle(coordinatorTask("coord-invalid"), {
    call: async (_name, args) => {
      if (args.operation === "progressive.claim_host_work") return { data: { dispatch_tasks: [task1, task2] } };
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
      framingRows.push(args.arguments.worker_result);
      return { data: { accepted: true } };
    },
    spawnLeaf: async (task) => task.packet.packet_id === "packet-1" ? productionFailures[0] : success(result2),
  });
  const framingSiblingExact = framingRows.length === 1 && framingRows[0] === result2.results[0];

  const validTerminal = runtime.validateCoordinatorResult(partial, coordinatorTask());
  let absentRejected = false, duplicateRejected = false, bindingRejected = false, authorityRejected = false, impossibleRejected = false, designIssueRejected = false;
  try { runtime.parseStrictCoordinatorResult([], coordinatorTask()); } catch { absentRejected = true; }
  try { runtime.parseStrictCoordinatorResult([...coordinatorEvents(validTerminal), ...coordinatorEvents(validTerminal)], coordinatorTask()); } catch { duplicateRejected = true; }
  try { runtime.parseStrictCoordinatorResult(coordinatorEvents({ ...validTerminal, packet_id: "other" }), coordinatorTask()); } catch { bindingRejected = true; }
  try {
    runtime.parseStrictCoordinatorResult(coordinatorEvents(
      { ...validTerminal, status: "failed", fulfilled_result_count: 0, failure_class: "claim_failed" },
      validTerminal,
    ), coordinatorTask());
  } catch { authorityRejected = true; }
  try { runtime.validateCoordinatorResult({ ...validTerminal, claimed_packet_count: 999, leaf_task_count: 999, fulfilled_result_count: 999 }, coordinatorTask()); } catch { impossibleRejected = true; }
  try { runtime.validateCoordinatorResult({ ...validTerminal, status: "design_issue", failure_class: "claim_failed" }, coordinatorTask()); } catch { designIssueRejected = true; }

  const notifications = [];
  const dispatchTask = coordinatorTask("coord-manager");
  let complete;
  const fakeRun = {
    child: {}, terminate: async () => {}, activation: Promise.resolve({ type: "agent_start" }),
    completion: new Promise((resolve) => complete = resolve),
  };
  const manager = new runtime.CoordinatorDispatchManager(() => fakeRun, (receipt) => notifications.push(receipt));
  await manager.submit(dispatchTask, { cwd: root, provider: "p", modelId: "m", thinking: "off" });
  const managerReceipt = { ...partial, packet_id: "coord-manager" };
  complete(coordinatorEvents(managerReceipt));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const duplicateDiagnostic = await manager.submit(dispatchTask, { cwd: root, provider: "p", modelId: "m", thinking: "off" });
  const absentNotifications = [];
  const absentTask = coordinatorTask("coord-manager-absent");
  const absentManager = new runtime.CoordinatorDispatchManager(() => ({
    child: {}, terminate: async () => {}, activation: Promise.resolve({ type: "agent_start" }), completion: Promise.resolve([]),
  }), (receipt) => absentNotifications.push(receipt));
  await absentManager.submit(absentTask, { cwd: root, provider: "p", modelId: "m", thinking: "off" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const throwingTask = coordinatorTask("coord-manager-notify-failure");
  const throwingRun = {
    child: {}, terminate: async () => {}, activation: Promise.resolve({ type: "agent_start" }),
    completion: Promise.resolve(coordinatorEvents({ ...managerReceipt, packet_id: "coord-manager-notify-failure" })),
  };
  const throwingManager = new runtime.CoordinatorDispatchManager(() => throwingRun, () => { throw new Error("notify failed"); });
  await throwingManager.submit(throwingTask, { cwd: root, provider: "p", modelId: "m", thinking: "off" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  let terminateRelease;
  const raceTask = coordinatorTask("coord-manager-race");
  const raceRun = {
    child: {}, activation: Promise.resolve({ type: "agent_start" }), completion: new Promise(() => {}),
    terminate: () => new Promise((resolve) => terminateRelease = resolve),
  };
  const raceManager = new runtime.CoordinatorDispatchManager(() => raceRun);
  await raceManager.submit(raceTask, { cwd: root, provider: "p", modelId: "m", thinking: "off" });
  const shutdownPromise = raceManager.shutdown();
  let closingRejected = false;
  try { await raceManager.submit(coordinatorTask("coord-manager-race-new"), { cwd: root, provider: "p", modelId: "m", thinking: "off" }); } catch { closingRejected = true; }
  terminateRelease();
  await shutdownPromise;

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
    terminal: { absentRejected, duplicateRejected, bindingRejected, authorityRejected, impossibleRejected, designIssueRejected },
    manager: {
      notifications: notifications.length, duplicateDiagnostic,
      absentState: absentManager.state("coord-manager-absent"),
      absentNotifications: absentNotifications.length,
      throwingState: throwingManager.state("coord-manager-notify-failure"),
      closingRejected, raceActive: raceManager.activeCount(),
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
