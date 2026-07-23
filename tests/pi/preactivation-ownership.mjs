import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const runtime = await import(path.join(root, "plugins/coc-keeper/pi/lib/runtime.ts"));
if (Number(process.versions.node.split(".")[0]) !== 22) {
  throw new Error(`real pre-activation ownership regression requires Node 22, got ${process.version}`);
}
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-preactivation-ownership-"));
const coordinatorInstruction = path.join(root, "plugins/coc-keeper/agents/coc-source-coordinator.md");
const leafInstruction = path.join(root, "plugins/coc-keeper/agents/coc-source-pack-worker.md");
const launch = { cwd: root, provider: "offline", modelId: "offline", thinking: "off" };

function coordinatorTask(packetId) {
  return {
    schema_version: 1,
    contract_id: "coc.pi-source-coordinator-task.v1",
    instruction_ref: coordinatorInstruction,
    model_policy: "inherit_parent",
    packet: {
      schema_version: 1,
      contract_id: "coc.source-coordinator.v1",
      packet_id: packetId,
      workspace_root: root,
      campaign_id: "ownership-fixture",
      max_leaves: 1,
      claim_operation: {
        operation: "progressive.claim_host_work",
        prefilled_arguments: {
          executor_id: "pi:ownership-fixture",
          limit: 1,
          result_delivery: "task_return_to_parent",
        },
      },
      fulfill_operation: { operation: "progressive.fulfill_host_work" },
    },
  };
}

function leafTask(packetId) {
  return {
    schema_version: 1,
    contract_id: "coc.pi-source-pack-task.v1",
    instruction_ref: leafInstruction,
    model_policy: "inherit_parent",
    packet: {
      schema_version: 1,
      contract_id: "coc.source-pack-worker.v1",
      packet_id: packetId,
      work_group_id: `${packetId}-group`,
      requests: [{ job_id: `${packetId}-job`, cached_page_refs: [] }],
    },
  };
}

async function managerFailure(command, packetId, abort) {
  process.env.COC_PI_COMMAND = command;
  let launched;
  const manager = new runtime.CoordinatorDispatchManager((task, context, signal) => {
    launched = runtime.spawnPiChild({ role: "coordinator", task, ...context, signal });
    return launched;
  });
  const controller = new AbortController();
  const pending = manager.submit(coordinatorTask(packetId), launch, controller.signal);
  if (abort) setTimeout(() => controller.abort(), 20);
  let error = "";
  try { await pending; }
  catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  let completionError = "";
  try { await launched.completion; }
  catch (caught) { completionError = caught instanceof Error ? caught.message : String(caught); }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  const active = manager.activeCount();
  await manager.shutdown();
  return { error, completionError, active };
}

async function leafFailure(command, packetId, abort) {
  process.env.COC_PI_COMMAND = command;
  const controller = new AbortController();
  const run = runtime.spawnPiChild({
    role: "leaf", task: leafTask(packetId), ...launch, signal: controller.signal,
  });
  const owned = new Set();
  const pending = runtime.awaitOwnedChild(run, owned);
  if (abort) setTimeout(() => controller.abort(), 20);
  let error = "";
  try { await pending; }
  catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  let completionError = "";
  try { await run.completion; }
  catch (caught) { completionError = caught instanceof Error ? caught.message : String(caught); }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  return { error, completionError, owned: owned.size };
}

try {
  const nonzero = path.join(temp, "nonzero.sh");
  const slow = path.join(temp, "slow.sh");
  await fs.writeFile(nonzero, "#!/bin/sh\nexit 7\n", { mode: 0o700 });
  await fs.writeFile(slow, "#!/bin/sh\nsleep 10\n", { mode: 0o700 });
  const result = {
    node: process.version,
    managerNonzero: await managerFailure(nonzero, "manager-nonzero", false),
    managerAbort: await managerFailure(slow, "manager-abort", true),
    leafNonzero: await leafFailure(nonzero, "leaf-nonzero", false),
    leafAbort: await leafFailure(slow, "leaf-abort", true),
  };
  delete process.env.COC_PI_COMMAND;
  process.stdout.write(JSON.stringify(result));
} finally {
  delete process.env.COC_PI_COMMAND;
  await fs.rm(temp, { recursive: true, force: true });
}
