import "./_lib/preload-embedded-pi.mjs";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

// One coordinator is a wakeup that re-reads the canonical queue, so draining a
// whole-book batch means letting one wakeup claim more work — not running more
// wakeups. That only holds if leaves are spawned through a bounded pool: the
// claim ceiling now bounds batch size, and the pool bounds live processes.
const root = path.resolve(process.argv[2] || process.cwd());
const runtime = await import(path.join(root, "plugins/coc-keeper/pi/lib/runtime.ts"));
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "pi-leaf-pool-")));
const leafInstruction = path.join(root, "plugins/coc-keeper/agents/coc-source-pack-worker.md");
const coordinatorInstruction = path.join(root, "plugins/coc-keeper/agents/coc-source-coordinator.md");

function leafTask(index, pagePath, digest) {
  const packetId = `packet-${index}`;
  return {
    schema_version: 1, contract_id: "coc.pi-source-pack-task.v1",
    instruction_ref: leafInstruction, model_policy: "inherit_parent",
    packet: {
      schema_version: 1, contract_id: "coc.source-pack-worker.v1",
      packet_id: packetId, work_group_id: `group-${index}`, source_id: "pdf:test",
      cached_scope_complete: true, requested_pdf_indices: [7],
      requests: [{
        job_id: `job-${index}`, cached_scope_complete: true,
        requested_pdf_indices: [7],
        cached_page_refs: [{
          source_id: "pdf:test", pdf_index: 7, path: pagePath, text_sha256: digest,
        }],
      }],
    },
  };
}

function worker(task) {
  return {
    schema_version: 1, contract_id: "coc.source-pack-worker.v1",
    packet_id: task.packet.packet_id, work_group_id: task.packet.work_group_id,
    status: "usable",
    results: [{ job_id: task.packet.requests[0].job_id, pack: {}, related_packs: [] }],
  };
}

function coordinatorTask(maxLeaves) {
  return {
    schema_version: 1, contract_id: "coc.pi-source-coordinator-task.v1",
    instruction_ref: coordinatorInstruction, model_policy: "inherit_parent",
    packet: {
      schema_version: 1, contract_id: "coc.source-coordinator.v1",
      packet_id: "coord-pool", workspace_root: root, campaign_id: "fixture",
      asset_root_id: "asset-fixture", max_leaves: maxLeaves,
      claim_operation: {
        operation: "progressive.claim_host_work",
        prefilled_arguments: {
          executor_id: "pi:test", limit: maxLeaves,
          result_delivery: "task_return_to_parent",
        },
      },
      fulfill_operation: { operation: "progressive.fulfill_host_work" },
    },
  };
}

try {
  const page = path.join(temp, "0007.md");
  await fs.writeFile(page, "page text\n", { mode: 0o600 });
  const digest = createHash("sha256").update("page text\n").digest("hex");

  const batch = 24;
  const tasks = Array.from({ length: batch }, (_, i) => leafTask(i + 1, page, digest));

  let live = 0;
  let peakLive = 0;
  const startOrder = [];
  const fulfilledOrder = [];

  const lifecycle = await runtime.runCoordinatorLifecycle(coordinatorTask(batch), {
    call: async (_name, args) => {
      if (args.operation === "progressive.claim_host_work") {
        return { data: { dispatch_tasks: tasks } };
      }
      fulfilledOrder.push(args.arguments.worker_result.job_id);
      return { data: { accepted: true } };
    },
    spawnLeaf: async (task) => {
      live += 1;
      peakLive = Math.max(peakLive, live);
      startOrder.push(task.packet.packet_id);
      // Yield so genuinely concurrent spawns overlap in the same tick window.
      await new Promise((resolveTick) => setTimeout(resolveTick, 1));
      live -= 1;
      return { kind: "success", result: worker(task) };
    },
  });

  const expectedJobs = tasks.map((task) => task.packet.requests[0].job_id);
  const checks = {
    // A batch far larger than the pool is claimed in one coordinator pass.
    batchClaimedInOnePass: lifecycle.claimed_packet_count === batch,
    allFulfilled: lifecycle.fulfilled_result_count === batch,
    statusFulfilled: lifecycle.status === "fulfilled",
    // Live leaf processes never exceed the pool width, whatever was claimed.
    peakWithinPool: peakLive <= runtime.LEAF_POOL_SIZE,
    // The pool is actually used rather than degenerating to serial.
    poolActuallyConcurrent: peakLive > 1,
    // Every claimed task ran exactly once.
    everyTaskStarted: startOrder.length === batch
      && new Set(startOrder).size === batch,
    // Results stay index-aligned with the claim, so fulfillment order is
    // still exact claim order despite out-of-order completion.
    fulfilledInClaimOrder:
      JSON.stringify(fulfilledOrder) === JSON.stringify(expectedJobs),
    // The claim ceiling and the process ceiling are separate numbers now.
    limitsAreDistinct: runtime.MAX_LEAVES > runtime.LEAF_POOL_SIZE,
    diagnosticsCapStaysSmall: runtime.MAX_DIAGNOSTICS === 4,
  };

  const ok = Object.values(checks).every(Boolean);
  process.stdout.write(JSON.stringify({
    checks,
    batch,
    peakLive,
    poolSize: runtime.LEAF_POOL_SIZE,
    maxLeaves: runtime.MAX_LEAVES,
    ok,
  }) + "\n");
  process.exitCode = ok ? 0 : 1;
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
