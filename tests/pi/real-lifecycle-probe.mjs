#!/usr/bin/env node
/*
 * engineering-probe: real isolated Pi source-coordinator lifecycle probe.
 *
 * STATUS: engineering probe. NOT an acceptance test and NOT product/playtest
 * evidence. It exists only to produce the real, isolated Pi 0.81.1
 * claim -> nested leaf -> exact fulfill lifecycle proof that the
 * coc_source_coordinator_v1 capability gate requires before promotion.
 *
 * Two modes:
 *
 *   precheck  (faux, zero tokens)
 *     - boots the REAL pi-coding-agent CLI through the exact spawnPiChild
 *       wiring (COC_PI_COMMAND wrapper -> dist/cli.js),
 *     - validates the fd-3 private handshake by loading coordinator.ts
 *       against the repository-produced pi_task (fail-closed on drift),
 *     - captures and asserts the isolation argv spawnPiChild constructs,
 *     - proves the MCP child (mcp/launch -> uv -> server.py) answers a
 *       read-only progressive.status call in the fresh workspace.
 *     It deliberately does NOT drive the lifecycle (faux model emits "{}"
 *     and never calls the tool), so it performs no claim/fulfill.
 *
 *   run       (real model, consumes coding-relay tokens)
 *     - prepares a fresh isolated workspace with one claimable
 *       partial_opening work group (tests/pi/prepare_probe_workspace.py),
 *     - spawnPiChild(role=coordinator, provider/model from flags) with the
 *       repository-produced pi_task,
 *     - the coordinator claims once, spawns the nested real leaf, and
 *       exact-fulfills; we await completion and parseStrictCoordinatorResult,
 *     - verifies the durable host-work row is marked fulfilled and emits
 *       structured evidence.
 *
 * Usage (from the repository root):
 *   node --experimental-strip-types tests/pi/real-lifecycle-probe.mjs \
 *        <root> <precheck|run> [--provider coding-relay] [--model gpt-5.6-luna] \
 *        [--thinking low] [--timeout-min 20] [--keep]
 *
 * Prints one JSON object on stdout. Diagnostics go to stderr.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------
const root = path.resolve(process.argv[2] || process.cwd());
const mode = process.argv[3] || "precheck";
const flags = {};
for (let i = 4; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (next !== undefined && !next.startsWith("--")) { flags[key] = next; i += 1; } else { flags[key] = true; }
}
if (!["precheck", "run"].includes(mode)) {
  process.stderr.write(`unknown mode "${mode}" (expected precheck|run)\n`);
  process.exit(2);
}
const provider = typeof flags.provider === "string" ? flags.provider : "coding-relay";
const modelId = typeof flags.model === "string" ? flags.model : "gpt-5.6-luna";
const thinking = typeof flags.thinking === "string" ? flags.thinking : "low";
const timeoutMin = Number(flags["timeout-min"]) > 0 ? Number(flags["timeout-min"]) : 20;
const keepWorkspace = Boolean(flags.keep);

// The MCP launcher and the prepare script both shell out to `uv`; inside the
// sandbox the default cache dir is not writable, so pin a writable one and let
// safeEnv() propagate it to every Pi child and MCP grandchild.
if (!process.env.UV_CACHE_DIR) process.env.UV_CACHE_DIR = "/tmp/uv-cache-probe";

const runtime = await import(path.join(root, "plugins/coc-keeper/pi/lib/runtime.ts"));

const CLI_PATH = path.join(root, "runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
const CLI_PKG = path.join(root, "runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/package.json");
const PREPARE_SCRIPT = path.join(root, "tests/pi/prepare_probe_workspace.py");
const FAUX_EXTENSION = path.join(root, "tests/pi/cli-faux-provider.ts");
const FAUX_PROVIDER = "pi-leaf-cli-faux";
const FAUX_MODEL = "leaf";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function log(...parts) { process.stderr.write(parts.join(" ") + "\n"); }

async function readCliVersion() {
  try { return JSON.parse(await fs.readFile(CLI_PKG, "utf8")).version; } catch { return null; }
}

// Run the Phase-0 recipe to materialize one claimable partial_opening group.
async function runPrepare(workspace) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("uv", ["run", "--frozen", "python", PREPARE_SCRIPT, workspace], {
      cwd: root,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      if (code !== 0) rejectPromise(new Error(`prepare_probe_workspace failed (${code}): ${stderr.trim().slice(-2000)}`));
      else {
        try { resolvePromise(JSON.parse(stdout)); }
        catch (error) { rejectPromise(new Error(`prepare emitted malformed JSON: ${error.message}`)); }
      }
    });
  });
}

// COC_PI_COMMAND wrapper: records each invocation's argv (marker-delimited so
// the nested leaf spawn is captured separately) then execs the REAL CLI,
// preserving fd 3 (the private capability pipe) across exec.
async function makeWrapper(dir, captureFile, injectFaux) {
  const wrapper = path.join(dir, "pi-real-wrapper.sh");
  const lines = ["#!/bin/sh"];
  if (captureFile) {
    lines.push(`printf -- '---invocation---\\n' >> "${captureFile}"`);
    lines.push(`printf '%s\\n' "$@" >> "${captureFile}"`);
  }
  const faux = injectFaux ? ` --extension "${FAUX_EXTENSION}"` : "";
  lines.push(`exec "${process.execPath}" "${CLI_PATH}"${faux} "$@"`);
  await fs.writeFile(wrapper, lines.join("\n") + "\n", { mode: 0o700 });
  return wrapper;
}

async function parseCaptures(captureFile) {
  let raw;
  try { raw = await fs.readFile(captureFile, "utf8"); } catch { return []; }
  return raw
    .split("---invocation---\n")
    .map((block) => block.split("\n").filter(Boolean))
    .filter((args) => args.length > 0);
}

const ISOLATION_FLAGS = [
  "--no-extensions", "--no-skills", "--no-prompt-templates",
  "--no-context-files", "--no-builtin-tools",
];

function coordinatorIsolation(args, piTask) {
  const packet = piTask.packet;
  return {
    isolation_flags: ISOLATION_FLAGS.every((flag) => args.includes(flag)),
    exact_allowlist: args[args.indexOf("--tools") + 1] === "coc_run_source_coordinator",
    has_coordinator_extension: args.includes(runtime.COORDINATOR_EXTENSION),
    no_task_in_argv: !args.some((value) => value.includes("source-coordinator.v1") || value.includes(String(packet.packet_id))),
  };
}

function leafIsolation(args) {
  return {
    isolation_flags: ISOLATION_FLAGS.every((flag) => args.includes(flag)),
    no_tools: args.includes("--no-tools") && !args.includes("--tools"),
    has_leaf_extension: args.includes(runtime.LEAF_EXTENSION),
  };
}

async function readJobFile(workspace, assetRootId, jobId) {
  const dir = path.join(workspace, ".coc", "module-assets", assetRootId, "host-work");
  try { return JSON.parse(await fs.readFile(path.join(dir, `${jobId}.json`), "utf8")); } catch { /* fall through */ }
  try {
    for (const entry of await fs.readdir(dir)) {
      if (!entry.endsWith(".json")) continue;
      const content = JSON.parse(await fs.readFile(path.join(dir, entry), "utf8"));
      if (content.job_id === jobId) return content;
    }
  } catch { /* missing dir */ }
  return null;
}

// Read-only MCP round trip against the fresh workspace (proves the child
// transport used by the coordinator for claim/fulfill is reachable).
async function mcpProgressiveStatus(workspace, campaignId) {
  const client = new runtime.McpJsonlClient(workspace, `pi-probe-${mode}-${process.pid}`);
  try {
    const envelope = await client.callTool("coc_invoke", {
      operation: "progressive.status",
      root: workspace,
      campaign: campaignId,
      arguments: {},
    });
    return { ok: envelope.ok === true, data: envelope.data ?? null };
  } finally {
    await client.close();
  }
}

function withTimeout(milliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

// ---------------------------------------------------------------------------
// precheck (faux, zero tokens)
// ---------------------------------------------------------------------------
async function precheckMode(prepared, workspace, probeTemp, cliVersion) {
  const captureFile = path.join(probeTemp, "precheck-args.txt");
  const counterFile = path.join(probeTemp, "precheck-provider-count.txt");
  await fs.writeFile(counterFile, "");
  const wrapper = await makeWrapper(probeTemp, captureFile, true);
  process.env.COC_PI_COMMAND = wrapper;
  process.env.COC_PI_TEST_PROVIDER_COUNTER = counterFile;

  const piTask = prepared.pi_task;
  log(`[precheck] booting real CLI ${cliVersion ?? "?"} via spawnPiChild (faux model ${FAUX_PROVIDER}/${FAUX_MODEL})`);
  const { signal, dispose } = withTimeout(5 * 60 * 1000);
  let activationType = null;
  let exitClean = false;
  try {
    const run = runtime.spawnPiChild({
      role: "coordinator", task: piTask, cwd: workspace,
      provider: FAUX_PROVIDER, modelId: FAUX_MODEL, thinking: "low",
      signal,
    });
    const activation = await run.activation;
    activationType = String(activation.type);
    await run.completion; // faux model emits "{}" and exits 0; no tool call, no claim
    exitClean = true;
  } finally {
    dispose();
    delete process.env.COC_PI_COMMAND;
    delete process.env.COC_PI_TEST_PROVIDER_COUNTER;
  }

  const captures = await parseCaptures(captureFile);
  const coordinatorArgs = captures[0] ?? [];
  const providerCalls = (await fs.readFile(counterFile, "utf8")).split("\n").filter(Boolean).length;
  const isolation = coordinatorIsolation(coordinatorArgs, piTask);

  // The faux run must not have claimed or fulfilled anything.
  const jobAfter = await readJobFile(workspace, prepared.asset_root_id, prepared.job_id);
  const stillClaimable = Boolean(jobAfter)
    && jobAfter.status !== "fulfilled"
    && jobAfter.dispatch_state !== "leased";

  log("[precheck] probing MCP child transport (read-only progressive.status)");
  const mcp = await mcpProgressiveStatus(workspace, prepared.campaign_id);

  const checks = {
    cli_activated: activationType !== null,
    cli_exit_clean: exitClean,
    handshake_validated: exitClean && isolation.has_coordinator_extension,
    provider_called: providerCalls >= 1,
    mcp_connected: mcp.ok,
    still_claimable: stillClaimable,
    ...isolation,
  };
  return {
    mode: "precheck",
    ok: Object.values(checks).every(Boolean),
    cli: {
      version: cliVersion, path: CLI_PATH,
      activation_type: activationType, exit_clean: exitClean, provider_calls: providerCalls,
    },
    checks,
    coordinator_args: coordinatorArgs,
    mcp_status_ok: mcp.ok,
    job_dispatch_state_after: jobAfter?.dispatch_state ?? null,
  };
}

// ---------------------------------------------------------------------------
// run (real model)
// ---------------------------------------------------------------------------
async function runMode(prepared, workspace, probeTemp, cliVersion) {
  const captureFile = path.join(probeTemp, "run-args.txt");
  const wrapper = await makeWrapper(probeTemp, captureFile, false);
  process.env.COC_PI_COMMAND = wrapper;

  const piTask = prepared.pi_task;
  const packetId = String(piTask.packet.packet_id);
  log(`[run] driving real lifecycle: provider=${provider} model=${modelId} thinking=${thinking} packet=${packetId}`);
  const started = Date.now();
  const { signal, dispose } = withTimeout(timeoutMin * 60 * 1000);
  let activationType = null;
  let events = [];
  let receipt = null;
  let parseError = null;
  try {
    const run = runtime.spawnPiChild({
      role: "coordinator", task: piTask, cwd: workspace,
      provider, modelId, thinking, signal,
    });
    const activation = await run.activation;
    activationType = String(activation.type);
    log("[run] coordinator activated; awaiting completion (claim -> leaf -> fulfill)...");
    events = await run.completion;
    try { receipt = runtime.parseStrictCoordinatorResult(events, piTask); }
    catch (error) { parseError = error.message; }
  } finally {
    dispose();
    delete process.env.COC_PI_COMMAND;
  }
  const durationMs = Date.now() - started;

  const captures = await parseCaptures(captureFile);
  const coordinatorArgs = captures[0] ?? [];
  const leafArgs = captures.slice(1);
  const jobAfter = await readJobFile(workspace, prepared.asset_root_id, prepared.job_id);
  const workspaceFulfilled = Boolean(jobAfter)
    && jobAfter.status === "fulfilled"
    && jobAfter.dispatch_state === "fulfilled";

  const result = {
    mode: "run",
    ok: Boolean(receipt) && receipt.status === "fulfilled" && workspaceFulfilled,
    cli: { version: cliVersion, path: CLI_PATH, activation_type: activationType },
    model: { provider, model_id: modelId, thinking },
    packet_id: packetId,
    receipt,
    ...(parseError ? { parse_error: parseError } : {}),
    claim_calls: receipt?.claim_calls ?? null,
    leaf_task_count: receipt?.leaf_task_count ?? null,
    fulfilled_result_count: receipt?.fulfilled_result_count ?? null,
    failure_class: receipt?.failure_class ?? null,
    nested_leaf_spawns: leafArgs.length,
    coordinator_isolation: coordinatorIsolation(coordinatorArgs, piTask),
    leaf_isolation: leafArgs.map(leafIsolation),
    coordinator_args: coordinatorArgs,
    leaf_args: leafArgs,
    workspace_fulfilled: workspaceFulfilled,
    job_after: jobAfter,
    duration_ms: durationMs,
    event_count: events.length,
  };

  if (!result.ok) {
    // Structured diagnosis surface for Phase-2 iteration.
    result.diagnosis = {
      stage: parseError ? "framing/validation" : (receipt?.failure_class ?? "activation"),
      parse_error: parseError,
      receipt_status: receipt?.status ?? null,
      failure_class: receipt?.failure_class ?? null,
      terminal_texts: events
        .filter((event) => event.type === "message_end" && event.message?.role === "assistant")
        .map((event) => (event.message.content ?? [])
          .filter((part) => part?.type === "text")
          .map((part) => String(part.text).slice(0, 400)))
        .flat()
        .slice(0, 4),
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const cliVersion = await readCliVersion();
const probeTemp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "pi-real-probe-")));
let workspace = path.join(probeTemp, "workspace");
await fs.mkdir(workspace, { recursive: true });

try {
  log(`[probe] mode=${mode} cli=${cliVersion ?? "?"} temp=${probeTemp}`);
  log("[probe] preparing fresh isolated workspace (Phase-0 recipe)...");
  const prepared = await runPrepare(workspace);
  workspace = prepared.workspace; // resolved, symlink-free path
  log(`[probe] prepared workspace=${workspace} job=${prepared.job_id} group=${prepared.work_group_id}`);

  const body = mode === "run"
    ? await runMode(prepared, workspace, probeTemp, cliVersion)
    : await precheckMode(prepared, workspace, probeTemp, cliVersion);

  process.stdout.write(JSON.stringify({
    engineering_probe: true,
    acceptance: false,
    node: process.version,
    workspace,
    campaign_id: prepared.campaign_id,
    asset_root_id: prepared.asset_root_id,
    job_id: prepared.job_id,
    work_group_id: prepared.work_group_id,
    requested_pdf_indices: prepared.requested_pdf_indices,
    result_contract_id: prepared.result_contract_id,
    ...body,
  }, null, 2) + "\n");
  if (!body.ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(JSON.stringify({
    engineering_probe: true,
    acceptance: false,
    mode,
    ok: false,
    error: error.message,
    stack: String(error.stack ?? "").split("\n").slice(0, 8),
  }, null, 2) + "\n");
  process.exitCode = 1;
} finally {
  if (keepWorkspace) log(`[probe] --keep: artifacts retained at ${probeTemp}`);
  else await fs.rm(probeTemp, { recursive: true, force: true });
}
