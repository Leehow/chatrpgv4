import "./_lib/preload-embedded-pi.mjs";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const root = path.resolve(process.argv[2] || process.cwd());
const runtime = await import(path.join(root, "plugins/coc-keeper/pi/lib/runtime.ts"));
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "pi-revision-")));
const instructionLeaf = path.join(root, "plugins/coc-keeper/agents/coc-source-pack-worker.md");
const instructionCoordinator = path.join(root, "plugins/coc-keeper/agents/coc-source-coordinator.md");

function leafTask(packetId, groupId, jobId, pagePath, digest, pdfIndex = 1) {
  return {
    schema_version: 1, contract_id: "coc.pi-source-pack-task.v1",
    instruction_ref: instructionLeaf, model_policy: "inherit_parent",
    packet: {
      schema_version: 1, contract_id: "coc.source-pack-worker.v1",
      packet_id: packetId, work_group_id: groupId, source_id: "pdf:test",
      cached_scope_complete: true, requested_pdf_indices: [pdfIndex],
      requests: [{ job_id: jobId, cached_scope_complete: true, requested_pdf_indices: [pdfIndex], cached_page_refs: [{ source_id: "pdf:test", pdf_index: pdfIndex, path: pagePath, text_sha256: digest }] }],
    },
  };
}
function worker(task, status = "usable", jobOverride = null) {
  return {
    schema_version: 1, contract_id: "coc.source-pack-worker.v1",
    packet_id: task.packet.packet_id, work_group_id: task.packet.work_group_id,
    status, results: [{ job_id: jobOverride || task.packet.requests[0].job_id, pack: {}, related_packs: [] }],
  };
}
function terminal(value) { return [{ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: JSON.stringify(value) }] } }]; }
function coordinatorResult(task, status = "fulfilled", claimed = 2, fulfilled = 2, failure = null) {
  return {
    schema_version: 1, contract_id: "coc.source-coordinator-result.v1",
    packet_id: task.packet.packet_id, status, claim_calls: 1,
    claimed_packet_count: claimed, leaf_task_count: claimed,
    fulfilled_result_count: fulfilled, failure_class: failure,
    design_issue_threshold: 3,
  };
}
function coordinatorTask(maxLeaves = 2) {
  return {
    schema_version: 1, contract_id: "coc.pi-source-coordinator-task.v1",
    instruction_ref: instructionCoordinator, model_policy: "inherit_parent",
    packet: {
      schema_version: 1, contract_id: "coc.source-coordinator.v1", packet_id: "coord-1",
      workspace_root: root, campaign_id: "fixture", max_leaves: maxLeaves,
      claim_operation: { operation: "progressive.claim_host_work", prefilled_arguments: { executor_id: "pi:test", limit: maxLeaves, result_delivery: "task_return_to_parent" } },
      fulfill_operation: { operation: "progressive.fulfill_host_work" },
    },
  };
}

async function privateSurface(role, task) {
  const script = path.join(root, "tests/pi/private-surface.mjs");
  const modulePath = path.join(root, `plugins/coc-keeper/pi/extensions/${role}.ts`);
  const child = spawn(process.execPath, ["--experimental-strip-types", script, modulePath], { stdio: ["ignore", "pipe", "pipe", "pipe"] });
  child.stdio[3].end(JSON.stringify({ nonce: "a".repeat(64), task }));
  let out = "", err = "";
  child.stdout.on("data", (chunk) => out += chunk);
  child.stderr.on("data", (chunk) => err += chunk);
  const code = await new Promise((resolveExit) => child.on("exit", resolveExit));
  if (code !== 0) throw new Error(err);
  return JSON.parse(out);
}

async function privateLoaderSurface(role, task) {
  const script = path.join(root, "tests/pi/private-loader-smoke.mjs");
  const child = spawn(process.execPath, ["--experimental-strip-types", script, root, role], { stdio: ["ignore", "pipe", "pipe", "pipe"] });
  child.stdio[3].end(JSON.stringify({ nonce: "b".repeat(64), task }));
  let out = "", err = "";
  child.stdout.on("data", (chunk) => out += chunk);
  child.stderr.on("data", (chunk) => err += chunk);
  const code = await new Promise((resolveClose) => child.on("close", resolveClose));
  if (code !== 0) throw new Error(err);
  return JSON.parse(out);
}

try {
  const page = path.join(temp, "0001.md");
  await fs.writeFile(page, "page text\n", { mode: 0o600 });
  const digest = createHash("sha256").update("page text\n").digest("hex");
  const leaf1 = leafTask("packet-1", "group-1", "job-1", page, digest);
  const leaf2 = leafTask("packet-2", "group-2", "job-2", page, digest);
  const result1 = worker(leaf1), result2 = worker(leaf2);

  const strictHappy = runtime.parseStrictWorkerResult(terminal(result1), leaf1);
  const rejects = {};
  for (const [name, events, task] of [
    ["multipleTerminal", [...terminal(result1), ...terminal(result1)], leaf1],
    ["wrongPacket", terminal({ ...result1, packet_id: "other" }), leaf1],
    ["wrongStatus", terminal(worker(leaf1, "abstain")), leaf1],
    ["wrongJobs", terminal(worker(leaf1, "usable", "other-job")), leaf1],
  ]) {
    try { runtime.parseStrictWorkerResult(events, task); rejects[name] = false; } catch { rejects[name] = true; }
  }

  const calls = [];
  const leafObjects = [result1, result2];
  const lifecycle = await runtime.runCoordinatorLifecycle(coordinatorTask(), {
    call: async (_name, args) => {
      calls.push(args);
      if (args.operation === "progressive.claim_host_work") return { data: { dispatch_tasks: [leaf1, leaf2] } };
      return { data: { accepted: true } };
    },
    spawnLeaf: async (task) => ({ kind: "success", result: task.packet.packet_id === "packet-1" ? result1 : result2 }),
  });
  const forwardedIdentity = calls.slice(1).every((call, index) => call.arguments.worker_result === leafObjects[index].results[0]);

  let activationResolve, activationReject, completionResolve, completionReject;
  const fakeRun = {
    child: {}, terminate: async () => {},
    activation: new Promise((resolve, reject) => { activationResolve = resolve; activationReject = reject; }),
    completion: new Promise((resolve, reject) => { completionResolve = resolve; completionReject = reject; }),
  };
  let secondCompletionResolve;
  const secondRun = {
    child: {}, terminate: async () => {}, activation: Promise.resolve({ type: "agent_start" }),
    completion: new Promise((resolve) => { secondCompletionResolve = resolve; }),
  };
  const launchRuns = [fakeRun, secondRun];
  const capturedLaunches = [];
  const manager = new runtime.CoordinatorDispatchManager((_task, context) => {
    capturedLaunches.push(context);
    return launchRuns.shift();
  });
  let submittedSettled = false;
  const launchOne = { cwd: root, provider: "provider-1", modelId: "model-1", thinking: "low" };
  const submittedPromise = manager.submit(coordinatorTask(), launchOne).then((value) => { submittedSettled = true; return value; });
  await Promise.resolve();
  const waitedForActivation = !submittedSettled;
  let concurrentRejected = false;
  try { await manager.submit({ ...coordinatorTask(), packet: { ...coordinatorTask().packet, packet_id: "coord-2" } }, launchOne); } catch { concurrentRejected = true; }
  activationResolve({ type: "agent_start" });
  const submitted = await submittedPromise;
  completionResolve(terminal(coordinatorResult(coordinatorTask())));
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));
  const secondTask = { ...coordinatorTask(), packet: { ...coordinatorTask().packet, packet_id: "coord-2" } };
  const launchTwo = { cwd: root, provider: "provider-2", modelId: "model-2", thinking: "high" };
  const secondSubmitted = await manager.submit(secondTask, launchTwo);
  secondCompletionResolve(terminal(coordinatorResult(secondTask)));
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));
  await manager.shutdown();

  let activeShutdownTerminated = false;
  const activeRun = {
    child: {}, activation: Promise.resolve({ type: "agent_start" }),
    completion: new Promise(() => {}),
    terminate: async () => { activeShutdownTerminated = true; },
  };
  const shutdownManager = new runtime.CoordinatorDispatchManager(() => activeRun);
  await shutdownManager.submit(coordinatorTask(), launchOne);
  await shutdownManager.shutdown();

  let failureReject;
  const failureRun = { child: {}, terminate: async () => {}, activation: new Promise((_r, reject) => failureReject = reject), completion: Promise.resolve([]) };
  const failureManager = new runtime.CoordinatorDispatchManager(() => failureRun);
  const failurePromise = failureManager.submit(coordinatorTask(), launchOne).catch(() => null);
  failureReject(new Error("activation failed"));
  await failurePromise;
  const failureDuplicate = await failureManager.submit(coordinatorTask(), launchOne);

  const readHappy = await runtime.readPacketPage(leaf1, 1);
  const duplicateTask = structuredClone(leaf1);
  duplicateTask.packet.requests.push({ job_id: "job-extra", cached_page_refs: [structuredClone(leaf1.packet.requests[0].cached_page_refs[0])] });
  let duplicateRefsRejected = false;
  try { await runtime.readPacketPage(duplicateTask, 1); } catch { duplicateRefsRejected = true; }
  const link = path.join(temp, "link.md");
  await fs.symlink(page, link);
  const symlinkTask = leafTask("packet-link", "group-link", "job-link", link, digest);
  let symlinkRejected = false;
  try { await runtime.readPacketPage(symlinkTask, 1); } catch { symlinkRejected = true; }

  const secretDir = path.join(temp, "secret");
  await fs.mkdir(secretDir, { mode: 0o700 });
  const secretFile = path.join(secretDir, "secrets.env");
  await fs.writeFile(secretFile, "BAIDUOCR_TOKEN=top-secret\n", { mode: 0o600 });
  const secrets = await runtime.loadSecrets(secretFile);
  let tokenValueRejected = false, tokenKeyRejected = false;
  try { runtime.rejectSecretDisclosure({ nested: ["top-secret"] }, secrets); } catch { tokenValueRejected = true; }
  try { runtime.rejectSecretDisclosure({ BAIDUOCR_TOKEN: "redacted" }, secrets); } catch { tokenKeyRejected = true; }
  const linkedDir = path.join(temp, "secret-link");
  await fs.symlink(secretDir, linkedDir);
  let directorySymlinkRejected = false;
  try { await runtime.loadSecrets(path.join(linkedDir, "secrets.env")); } catch { directorySymlinkRejected = true; }
  await fs.chmod(secretFile, 0o644);
  let badModeRejected = false;
  try { await runtime.loadSecrets(secretFile); } catch { badModeRejected = true; }
  await fs.chmod(secretFile, 0o600);
  await fs.chmod(secretDir, 0o755);
  let badDirectoryModeRejected = false;
  try { await runtime.loadSecrets(secretFile); } catch { badDirectoryModeRejected = true; }
  await fs.chmod(secretDir, 0o700);

  async function ocrOutput(jsonText) {
    const script = path.join(temp, `ocr-${Math.random().toString(16).slice(2)}.sh`);
    await fs.writeFile(script, `#!/bin/sh\nprintf '%s' '${jsonText}'\n`, { mode: 0o700 });
    process.env.COC_PROGRESSIVE_OCR_COMMAND = script;
    process.env.COC_KEEPER_ENV_FILE = secretFile;
    try { return await main.__test.runOcr({ operation: "status", corpus_path: temp }); }
    finally { delete process.env.COC_PROGRESSIVE_OCR_COMMAND; delete process.env.COC_KEEPER_ENV_FILE; }
  }
  let tokenEchoRejected = false, secretKeyOutputRejected = false;
  try { await ocrOutput('{"echo":"top-secret"}'); } catch { tokenEchoRejected = true; }
  try { await ocrOutput('{"nested":{"BAIDUOCR_TOKEN":"redacted"}}'); } catch { secretKeyOutputRejected = true; }
  const ocrGood = await ocrOutput('{"status":"ok","layout_noise":"tolerated"}');
  const delayedOcr = path.join(temp, "ocr-delayed.sh");
  await fs.writeFile(delayedOcr, "#!/bin/sh\n(sleep 0.05; printf '%s' '{\"status\":\"delayed-close\"}') &\nexit 0\n", { mode: 0o700 });
  process.env.COC_PROGRESSIVE_OCR_COMMAND = delayedOcr;
  process.env.COC_KEEPER_ENV_FILE = secretFile;
  const ocrDelayed = await main.__test.runOcr({ operation: "status", corpus_path: temp });
  delete process.env.COC_PROGRESSIVE_OCR_COMMAND;
  delete process.env.COC_KEEPER_ENV_FILE;
  const slowOcr = path.join(temp, "ocr-slow.sh");
  await fs.writeFile(slowOcr, "#!/bin/sh\nsleep 10\n", { mode: 0o700 });
  process.env.COC_PROGRESSIVE_OCR_COMMAND = slowOcr;
  process.env.COC_KEEPER_ENV_FILE = secretFile;
  const ocrAbortController = new AbortController();
  const ocrAbortPromise = main.__test.runOcr(
    { operation: "status", corpus_path: temp }, ocrAbortController.signal,
  ).then(() => false, () => true);
  setTimeout(() => ocrAbortController.abort(), 20);
  const ocrAbortRejected = await ocrAbortPromise;
  delete process.env.COC_PROGRESSIVE_OCR_COMMAND;
  delete process.env.COC_KEEPER_ENV_FILE;

  const coordinatorSurface = await privateSurface("coordinator", coordinatorTask());
  const leafSurface = await privateSurface("leaf", leaf1);
  const coordinatorLoaderSurface = await privateLoaderSurface("coordinator", coordinatorTask());
  const leafLoaderSurface = await privateLoaderSurface("leaf", leaf1);

  const capturedArgs = path.join(temp, "captured-args.txt");
  const fakePi = path.join(temp, "fake-pi.sh");
  await fs.writeFile(fakePi, `#!/bin/sh\nprintf '%s\n' "$@" > "$COC_PI_TEST_ARGS"\nprintf '%s\n' '{"type":"agent_start"}'\nprintf '%s\n' '{"type":"agent_end"}'\n`, { mode: 0o700 });
  process.env.COC_PI_COMMAND = fakePi;
  process.env.COC_PI_TEST_ARGS = capturedArgs;
  const childRun = runtime.spawnPiChild({
    role: "coordinator", task: coordinatorTask(), cwd: root,
    provider: "provider-x", modelId: "model-y", thinking: "high",
  });
  await childRun.activation;
  await childRun.completion;
  const launchArgs = (await fs.readFile(capturedArgs, "utf8")).trim().split("\n");
  const leafArgRun = runtime.spawnPiChild({
    role: "leaf", task: leaf1, cwd: root,
    provider: "provider-x", modelId: "model-y", thinking: "high",
  });
  await leafArgRun.activation;
  await leafArgRun.completion;
  const leafLaunchArgs = (await fs.readFile(capturedArgs, "utf8")).trim().split("\n");
  let invalidRoleRejected = false;
  try {
    runtime.spawnPiChild({
      role: "arbitrary-tool", task: leaf1, cwd: root,
      provider: "provider-x", modelId: "model-y", thinking: "high",
    });
  } catch { invalidRoleRejected = true; }
  delete process.env.COC_PI_COMMAND;
  delete process.env.COC_PI_TEST_ARGS;
  const exactModelThinking = launchArgs.includes("provider-x/model-y") && launchArgs.includes("high");
  const noTaskInArgv = !launchArgs.some((value) => value.includes("coord-1") || value.includes("source-coordinator.v1"));

  const delayedPi = path.join(temp, "fake-pi-delayed.sh");
  const delayedWorker = worker(leaf1);
  const delayedEvent = JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: JSON.stringify(delayedWorker) }] } });
  await fs.writeFile(delayedPi, `#!/bin/sh\nprintf '%s\\n' '{"type":"agent_start"}'\n(sleep 0.05; printf '%s\\n' '${delayedEvent}') &\nexit 0\n`, { mode: 0o700 });
  process.env.COC_PI_COMMAND = delayedPi;
  const delayedRun = runtime.spawnPiChild({
    role: "leaf", task: leaf1, cwd: root,
    provider: "provider-x", modelId: "model-y", thinking: "high",
  });
  await delayedRun.activation;
  const delayedEvents = await delayedRun.completion;
  const delayedLeafResult = runtime.parseStrictWorkerResult(delayedEvents, leaf1);
  delete process.env.COC_PI_COMMAND;

  const slowPi = path.join(temp, "fake-pi-slow.sh");
  await fs.writeFile(slowPi, "#!/bin/sh\nprintf '%s\\n' '{\"type\":\"agent_start\"}'\nsleep 10\n", { mode: 0o700 });
  process.env.COC_PI_COMMAND = slowPi;
  const childAbortController = new AbortController();
  const abortRun = runtime.spawnPiChild({
    role: "leaf", task: leaf1, cwd: root,
    provider: "provider-x", modelId: "model-y", thinking: "high",
    signal: childAbortController.signal,
  });
  await abortRun.activation;
  childAbortController.abort();
  const childAbortRejected = await abortRun.completion.then(() => false, () => true);
  delete process.env.COC_PI_COMMAND;

  process.stdout.write(JSON.stringify({
    strictHappy: strictHappy.status,
    rejects,
    lifecycle,
    claimCount: calls.filter((call) => call.operation === "progressive.claim_host_work").length,
    fulfillCount: calls.filter((call) => call.operation === "progressive.fulfill_host_work").length,
    forwardedIdentity,
    waitedForActivation, concurrentRejected, submitted, activeShutdownTerminated,
    secondSubmitted, capturedLaunches,
    failureDuplicate,
    readHappy,
    duplicateRefsRejected, symlinkRejected,
    tokenValueRejected, tokenKeyRejected, directorySymlinkRejected, badModeRejected, badDirectoryModeRejected,
    tokenEchoRejected, secretKeyOutputRejected, ocrGood, ocrDelayed, ocrAbortRejected,
    coordinatorSurface, leafSurface,
    coordinatorLoaderSurface, leafLoaderSurface,
    exactModelThinking, noTaskInArgv,
    delayedLeafStatus: delayedLeafResult.status,
    childAbortRejected,
    isolationFlags: ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools"].every((flag) => launchArgs.includes(flag)),
    exactCoordinatorAllowlist: launchArgs[launchArgs.indexOf("--tools") + 1] === "coc_run_source_coordinator",
    exactLeafNoTools: leafLaunchArgs.includes("--no-tools") && !leafLaunchArgs.includes("--tools"),
    invalidRoleRejected,
    productionProbeBypassAbsent: !("COC_PI_SOURCE_COMPONENT_PROBE" in process.env),
    mainExports: Object.keys(main.__test),
  }));
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
