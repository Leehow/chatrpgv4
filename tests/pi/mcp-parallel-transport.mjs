#!/usr/bin/env node
/**
 * Regression probe: McpJsonlClient parallel dispatch over one FIFO child.
 *
 * Guards the fix for the "parallel writes crash child" incident:
 * - queueTolerance: parallel requests queued server-side longer than the
 *   per-request timeout must all still resolve (head-of-line hang detection
 *   only trips on a genuine wedge), in dispatch order, matched by id.
 * - hangDetection: a genuinely wedged child trips the head timer exactly
 *   once, rejects every pending request with a timeout, and the next request
 *   respawns a fresh child.
 * - abortIsolation: aborting one parallel request rejects only that request;
 *   siblings resolve and the transport stays usable.
 */
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeUrl = pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/runtime.ts"),
).href;

const { CanonicalToolError, McpJsonlClient } = await import(runtimeUrl);
const fixture = path.join(root, "tests/pi/fixtures/mcp-fake-child.mjs");

const results = {};

// (a) Queued parallel requests tolerate cumulative server time > timeout.
try {
  process.env.FAKE_CHILD_DELAY_MS = "500";
  delete process.env.FAKE_CHILD_HANG_ID;
  const client = new McpJsonlClient(root, "probe-parallel", false, { launchPath: fixture, timeoutMs: 1000 });
  const tags = ["a", "b", "c", "d", "e"];
  const settled = await Promise.all(tags.map((tag) => client.request("test/echo", { tag })));
  const echoed = settled.map((entry) => entry.echoed?.tag);
  const order = settled[settled.length - 1].arrivalOrder;
  // initialize is id 1; the five parallel requests must arrive in dispatch
  // order as ids 2..6 on the FIFO child.
  const orderOk = Array.isArray(order) && order.length === 6 && order.every((value, index) => value === index + 1);
  results.queueTolerance = {
    ok: JSON.stringify(echoed) === JSON.stringify(tags) && orderOk,
    echoed,
    arrivalOrder: order,
  };
  await client.close();
} catch (error) {
  results.queueTolerance = { ok: false, detail: String(error) };
}

// (b) A wedged child trips the head-of-line timer once; transport recovers.
try {
  process.env.FAKE_CHILD_DELAY_MS = "50";
  process.env.FAKE_CHILD_HANG_ID = "2";
  const client = new McpJsonlClient(root, "probe-hang", false, { launchPath: fixture, timeoutMs: 800 });
  const settled = await Promise.allSettled([0, 1, 2].map((index) => client.request("test/echo", { tag: `h${index}` })));
  const allTimedOut = settled.every((entry) => entry.status === "rejected" && /timed out/.test(String(entry.reason)));
  delete process.env.FAKE_CHILD_HANG_ID;
  const recovery = await client.request("test/echo", { tag: "recovery" });
  results.hangDetection = {
    ok: allTimedOut && recovery.echoed?.tag === "recovery",
    statuses: settled.map((entry) => entry.status),
    reasons: settled.map((entry) => (entry.status === "rejected" ? String(entry.reason) : null)),
    recovery: recovery.echoed?.tag ?? null,
  };
  await client.close();
} catch (error) {
  results.hangDetection = { ok: false, detail: String(error) };
}

// (c) Abort rejects only the aborted request; siblings and transport survive.
try {
  process.env.FAKE_CHILD_DELAY_MS = "200";
  delete process.env.FAKE_CHILD_HANG_ID;
  const client = new McpJsonlClient(root, "probe-abort", false, { launchPath: fixture, timeoutMs: 2000 });
  const controller = new AbortController();
  const keep1 = client.request("test/echo", { tag: "keep1" });
  const drop = client.request("test/echo", { tag: "drop" }, controller.signal);
  const keep2 = client.request("test/echo", { tag: "keep2" });
  setTimeout(() => controller.abort(), 50);
  const [r1, r2, r3] = await Promise.allSettled([keep1, drop, keep2]);
  const shapeOk = r1.status === "fulfilled" && r1.value.echoed?.tag === "keep1"
    && r2.status === "rejected" && /aborted/.test(String(r2.reason))
    && r3.status === "fulfilled" && r3.value.echoed?.tag === "keep2";
  const after = await client.request("test/echo", { tag: "after" });
  results.abortIsolation = {
    ok: shapeOk && after.echoed?.tag === "after",
    statuses: [r1.status, r2.status, r3.status],
    after: after.echoed?.tag ?? null,
  };
  await client.close();
} catch (error) {
  results.abortIsolation = { ok: false, detail: String(error) };
}

// (d) Canonical MCP business failures retain their structured envelope so a
// host route can distinguish them from transport exceptions without parsing
// provider-facing prose.
try {
  process.env.FAKE_CHILD_DELAY_MS = "0";
  delete process.env.FAKE_CHILD_HANG_ID;
  const client = new McpJsonlClient(
    root,
    "probe-canonical-error",
    false,
    { launchPath: fixture, timeoutMs: 1000 },
  );
  let caught;
  try {
    await client.callTool("coc_invoke", {
      operation: "session.resume",
      root,
      campaign: "canonical-error-campaign",
      arguments: {},
    });
  } catch (error) {
    caught = error;
  }
  results.canonicalErrorMetadata = {
    ok: (
      caught instanceof CanonicalToolError
      && caught.toolName === "coc_invoke"
      && caught.code === "opening_setup_incomplete"
      && caught.envelope?.tool === "session.resume"
      && caught.envelope?.error?.details?.phase === "opening_selection"
      && caught.envelope?.error?.details?.campaign_id
        === "canonical-error-campaign"
    ),
    errorName: caught?.name ?? null,
    code: caught?.code ?? null,
    tool: caught?.envelope?.tool ?? null,
    phase: caught?.envelope?.error?.details?.phase ?? null,
  };
  await client.close();
} catch (error) {
  results.canonicalErrorMetadata = { ok: false, detail: String(error) };
}

// (e) The actual Python MCP server dispatches a contiguous reviewed-read run
// through its bounded pool, then preserves the read → serial → read barrier.
// The child-side Barrier is the witness of true overlap; no timing guesswork.
let probeDir;
try {
  probeDir = await mkdtemp(path.join(os.tmpdir(), "coc-mcp-parallel-"));
  const probePath = path.join(probeDir, "probe.py");
  const launchPath = path.join(probeDir, "launch");
  await writeFile(probePath, `
import importlib.util
import os
import sys
from pathlib import Path
from threading import Barrier, Event, Lock

root = Path(sys.argv[1])
# This scheduler probe replaces _call_tool before serving requests. Preload a
# test-only live archive so unrelated dirty registry work cannot prevent the
# transport lifecycle from importing.
archive_spec = importlib.util.spec_from_file_location(
    "coc_mcp_contract_archive_mcp", root / "plugins/coc-keeper/scripts/coc_mcp_contract_archive.py",
)
archive = importlib.util.module_from_spec(archive_spec)
sys.modules[archive_spec.name] = archive
archive_spec.loader.exec_module(archive)
archive.load_and_validate = lambda _path, toolbox: archive.build_archive(toolbox)
spec = importlib.util.spec_from_file_location("coc_mcp_parallel_probe", root / "plugins/coc-keeper/mcp/server.py")
server = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = server
spec.loader.exec_module(server)
rendezvous = Barrier(2)
cancel_gate = Event()
state_lock = Lock()
read_count = 0
mutation_count = 0
events = []

def fake_call(name, arguments):
    global read_count, mutation_count
    operation = arguments.get("operation") if name == "coc_invoke" else name
    if operation.startswith("probe.read."):
        with state_lock:
            read_count += 1
            ordinal = read_count
        if ordinal <= 2 and not os.environ.get("COC_MCP_PROBE_NO_LATCH"):
            rendezvous.wait(timeout=5)
            overlap = True
        else:
            overlap = False
        if os.environ.get("COC_MCP_PROBE_FAIL_SECOND_READ") and operation == "probe.read.two":
            raise RuntimeError("probe read failure")
        if os.environ.get("COC_MCP_CANCEL_PROBE"):
            # The test releases this only after the cancellation notification
            # is already behind the queued mutation in stdin order.
            cancel_gate.wait()
        with state_lock:
            events.append(f"read-{ordinal}")
    else:
        overlap = False
        with state_lock:
            if operation == "state.test_serial":
                mutation_count += 1
            events.append(f"serial:{operation}")
    return {"ok": True, "tool": operation, "data": {"operation": operation, "overlap": overlap, "events": list(events), "mutation_count": mutation_count}}

server._call_tool = fake_call
original_execution_class = server._request_execution_class
def probe_execution_class(message):
    params = message.get("params") or {}
    arguments = params.get("arguments") or {}
    operation = arguments.get("operation") if params.get("name") == "coc_invoke" else params.get("name")
    if isinstance(operation, str) and operation.startswith("probe.read."):
        return "parallel_read"
    return original_execution_class(message)
server._request_execution_class = probe_execution_class
original_handle = server._handle
def probe_handle(message):
    if message.get("method") == "probe/release":
        cancel_gate.set()
        return None
    return original_handle(message)
server._handle = probe_handle
raise SystemExit(server.main())
`, "utf8");
  await writeFile(
    launchPath,
    `#!/bin/sh\nexec ${JSON.stringify(path.join(root, ".venv/bin/python"))} ${JSON.stringify(probePath)} ${JSON.stringify(root)}\n`,
    "utf8",
  );
  await chmod(launchPath, 0o755);
  const priorWidth = process.env.COC_MCP_PARALLEL_READ_WIDTH;
  const priorNoLatch = process.env.COC_MCP_PROBE_NO_LATCH;
  process.env.COC_MCP_PARALLEL_READ_WIDTH = "4";
  const client = new McpJsonlClient(root, "probe-real-parallel", false, { launchPath, timeoutMs: 10000 });
  const invoke = (operation) => client.requestWithTransportMeta("tools/call", {
    name: "coc_invoke",
    arguments: { operation, root, campaign: "parallel-probe", arguments: {} },
  });
  const [firstReceipt, secondReceipt, serialReceipt, serialTwoReceipt, lastReceipt] = await Promise.all([
    invoke("probe.read.one"),
    invoke("probe.read.two"),
    // These unregistered operations must fail closed to serial_campaign;
    // the scheduler receipt, not Promise launch order, is the witness.
    invoke("state.test_serial"),
    invoke("state.test_serial_two"),
    invoke("probe.read.three"),
  ]);
  await client.close();
  console.error("mcp probe: barrier complete");
  const first = firstReceipt.result;
  const second = secondReceipt.result;
  const serial = serialReceipt.result;
  const serialTwo = serialTwoReceipt.result;
  const last = lastReceipt.result;
  const firstData = first.structuredContent?.data;
  const secondData = second.structuredContent?.data;
  const lastData = last.structuredContent?.data;
  results.serverBarrier = {
    ok: firstData?.operation === "probe.read.one"
      && secondData?.operation === "probe.read.two"
      && firstData?.overlap === true
      && secondData?.overlap === true
      && serial.structuredContent?.data?.operation === "state.test_serial"
      && serialTwo.structuredContent?.data?.operation === "state.test_serial_two"
      && firstReceipt.transport?.execution_class === "parallel_read"
      && secondReceipt.transport?.execution_class === "parallel_read"
      && serialReceipt.transport?.execution_class === "serial_campaign"
      && serialTwoReceipt.transport?.execution_class === "serial_campaign"
      && firstData?.overlap === true
      && secondData?.overlap === true
      && Array.isArray(lastData?.events)
      && new Set(lastData.events.slice(0, 2)).size === 2
      && new Set(lastData.events.slice(0, 2)).has("read-1")
      && new Set(lastData.events.slice(0, 2)).has("read-2")
      && JSON.stringify(lastData.events.slice(2)) === JSON.stringify([
        "serial:state.test_serial", "serial:state.test_serial_two", "read-3",
      ]),
    first: firstData,
    second: secondData,
    serial: serial.structuredContent?.data,
    serialTwo: serialTwo.structuredContent?.data,
    last: lastData,
    transport: {
      first: firstReceipt.transport,
      second: secondReceipt.transport,
      serial: serialReceipt.transport,
      serialTwo: serialTwoReceipt.transport,
    },
  };
  process.env.COC_MCP_PARALLEL_READ_WIDTH = "1";
  process.env.COC_MCP_PROBE_NO_LATCH = "1";
  const serialClient = new McpJsonlClient(root, "probe-width-one", false, { launchPath, timeoutMs: 10000 });
  const serialInvoke = (operation) => serialClient.requestWithTransportMeta("tools/call", {
    name: "coc_invoke",
    arguments: { operation, root, campaign: "parallel-probe", arguments: {} },
  });
  const [, widthOneLast] = await Promise.all([
    serialInvoke("probe.read.one"), serialInvoke("probe.read.two"),
  ]);
  await serialClient.close();
  results.widthOneFifo = {
    ok: JSON.stringify(widthOneLast.result.structuredContent?.data?.events) === JSON.stringify([
      "read-1", "read-2",
    ]) && widthOneLast.transport?.fallback_reason === "parallel_read_width_1"
      && widthOneLast.transport?.active_count === 1,
    events: widthOneLast.result.structuredContent?.data?.events,
    transport: widthOneLast.transport,
  };
  // The invalid-width probe has one read only, so retain the fixture's
  // no-latch mode. Otherwise its proof barrier times out before metadata can
  // be observed, masking the real scheduler result as BrokenBarrierError.
  process.env.COC_MCP_PARALLEL_READ_WIDTH = "not-a-number";
  const invalidClient = new McpJsonlClient(root, "probe-invalid-width", false, { launchPath, timeoutMs: 10000 });
  const invalid = await invalidClient.requestWithTransportMeta("tools/call", {
    name: "coc_invoke",
    arguments: { operation: "probe.read.one", root, campaign: "parallel-probe", arguments: {} },
  });
  await invalidClient.close();
  const stripClient = new McpJsonlClient(root, "probe-meta-strip", false, { launchPath, timeoutMs: 10000 });
  const modelResult = await stripClient.callTool("coc_invoke", {
    operation: "probe.read.one", root, campaign: "parallel-probe", arguments: {},
  });
  await stripClient.close();
  // callTool is the model-facing boundary: scheduler data may accompany the
  // internal request receipt, but cannot enter the canonical tool envelope.
  results.modelResultStripsTransport = {
    ok: modelResult.ok === true && !JSON.stringify(modelResult).includes("coc_transport"),
    tool: modelResult.tool,
  };
  delete process.env.COC_MCP_PROBE_NO_LATCH;
  results.invalidWidthFallback = {
    ok: invalid.transport?.fallback_reason === "invalid_parallel_read_width"
      && invalid.transport?.parallel_read_width === 1
      && invalid.transport?.active_count === 1,
    transport: invalid.transport,
  };
  process.env.COC_MCP_PARALLEL_READ_WIDTH = "4";
  process.env.COC_MCP_PROBE_FAIL_SECOND_READ = "1";
  const failureClient = new McpJsonlClient(root, "probe-read-failure", false, { launchPath, timeoutMs: 10000 });
  const failureInvoke = (operation) => failureClient.request("tools/call", {
    name: "coc_invoke",
    arguments: { operation, root, campaign: "parallel-probe", arguments: {} },
  });
  const [healthy, failed] = await Promise.allSettled([
    failureInvoke("probe.read.one"), failureInvoke("probe.read.two"),
  ]);
  const afterFailure = await failureInvoke("probe.read.three");
  await failureClient.close();
  results.readFailureIsolation = {
    ok: healthy.status === "fulfilled"
      && failed.status === "rejected"
      && afterFailure.structuredContent?.data?.operation === "probe.read.three",
    statuses: [healthy.status, failed.status],
    after: afterFailure.structuredContent?.data?.operation,
  };
  delete process.env.COC_MCP_PROBE_FAIL_SECOND_READ;
  // Two reads occupy the width while a serial mutation is queued. The abort
  // frame follows that mutation in stdin order and the release notification
  // follows the abort, so no timing/sleep assumption is involved.
  process.env.COC_MCP_PARALLEL_READ_WIDTH = "2";
  process.env.COC_MCP_CANCEL_PROBE = "1";
  const cancelClient = new McpJsonlClient(root, "probe-queued-cancel", false, { launchPath, timeoutMs: 10000 });
  await cancelClient.request("initialize", {
    protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cancel-probe", version: "1" },
  });
  const cancelInvoke = (operation, signal) => cancelClient.request("tools/call", {
    name: "coc_invoke",
    arguments: { operation, root, campaign: "parallel-probe", arguments: {} },
  }, signal);
  const cancellation = new AbortController();
  const activeOne = cancelInvoke("probe.read.cancel_one");
  const activeSibling = cancelInvoke("probe.read.cancel_two");
  const queuedMutation = cancelInvoke("state.test_serial", cancellation.signal);
  // request() resumes in FIFO microtask order after the already-ready client;
  // this checkpoint puts all three JSONL requests ahead of cancellation.
  await Promise.resolve();
  cancellation.abort();
  cancelClient["child"].stdin.write(`${JSON.stringify({
    jsonrpc: "2.0", method: "probe/release", params: {},
  })}\n`);
  const [activeOneResult, activeSiblingResult, cancelledMutation] = await Promise.allSettled([
    activeOne, activeSibling, queuedMutation,
  ]);
  const afterCancel = await cancelInvoke("probe.read.after_cancel");
  await cancelClient.close();
  results.queuedMutationCancellation = {
    ok: activeOneResult.status === "fulfilled"
      && activeSiblingResult.status === "fulfilled"
      && cancelledMutation.status === "rejected"
      && /aborted/.test(String(cancelledMutation.reason))
      && afterCancel.structuredContent?.data?.mutation_count === 0,
    statuses: [activeOneResult.status, activeSiblingResult.status, cancelledMutation.status],
    mutationCount: afterCancel.structuredContent?.data?.mutation_count,
  };
  delete process.env.COC_MCP_CANCEL_PROBE;
  console.error("mcp probe: cancellation complete");
  // EOF first cancels queued work, then waits for the already-active Python
  // call. FD 3 is a deterministic control channel: no wall-clock delay is
  // used to guess whether the serial mutation reached the scheduler.
  const eofProbePath = path.join(probeDir, "eof-probe.py");
  await writeFile(eofProbePath, `
import importlib.util
import os
import sys
from pathlib import Path

root = Path(sys.argv[1])
control_fd = int(os.environ["COC_MCP_CONTROL_FD"])
os.write(control_fd, b"boot\\n")
archive_spec = importlib.util.spec_from_file_location(
    "coc_mcp_contract_archive_mcp", root / "plugins/coc-keeper/scripts/coc_mcp_contract_archive.py",
)
archive = importlib.util.module_from_spec(archive_spec)
sys.modules[archive_spec.name] = archive
archive_spec.loader.exec_module(archive)
archive.load_and_validate = lambda _path, toolbox: archive.build_archive(toolbox)
spec = importlib.util.spec_from_file_location("coc_mcp_eof_probe", root / "plugins/coc-keeper/mcp/server.py")
server = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = server
spec.loader.exec_module(server)
state = {"mutation_count": 0}

def fake_call(name, arguments):
    operation = arguments.get("operation") if name == "coc_invoke" else name
    if operation == "setup.phase":
        os.write(control_fd, b"active\\n")
        os.read(control_fd, 1)
    elif operation == "state.test_serial":
        state["mutation_count"] += 1
    return {"ok": True, "tool": operation, "data": {"mutation_count": state["mutation_count"]}}

server._call_tool = fake_call
original_handle = server._handle
def probe_handle(message):
    if message.get("method") == "probe/queued":
        os.write(control_fd, b"queued\\n")
        return None
    return original_handle(message)
server._handle = probe_handle
raise SystemExit(server.main())
`, "utf8");
  const eofChild = spawn(path.join(root, ".venv/bin/python"), [eofProbePath, root], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe", "pipe"],
    env: { ...process.env, COC_MCP_PARALLEL_READ_WIDTH: "1", COC_MCP_CONTROL_FD: "3" },
  });
  let eofStdout = "";
  let eofStderr = "";
  eofChild.stdout.on("data", (chunk) => { eofStdout += chunk; });
  eofChild.stderr.on("data", (chunk) => { eofStderr += chunk; console.error(`mcp probe EOF stderr: ${chunk}`); });
  eofChild.on("exit", (code) => { console.error(`mcp probe EOF exit: ${code}`); });
  let controlText = "";
  const queuedSeen = new Promise((resolve) => {
    const control = eofChild.stdio[3];
    const receive = (chunk) => {
      controlText += chunk;
      console.error(`mcp probe EOF control: ${chunk}`);
      if (controlText.includes("queued\n")) {
        control.off("data", receive);
        resolve();
      }
    };
    control.on("data", receive);
  });
  const eofInvoke = (id, operation) => JSON.stringify({
    jsonrpc: "2.0", id, method: "tools/call", params: {
      name: "coc_invoke",
      arguments: { operation, root, campaign: "parallel-probe", arguments: {} },
    },
  }) + "\n";
  eofChild.stdin.write(eofInvoke(101, "setup.phase"));
  eofChild.stdin.write(eofInvoke(102, "state.test_serial"));
  eofChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "probe/queued", params: {} })}\n`);
  await queuedSeen;
  console.error("mcp probe: EOF queue observed");
  eofChild.stdin.end();
  await once(eofChild.stdin, "finish");
  eofChild.stdio[3].write("x");
  const [eofCode] = await once(eofChild, "close");
  const eofResponses = eofStdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const eofActive = eofResponses.find((response) => response.id === 101);
  const eofQueued = eofResponses.find((response) => response.id === 102);
  results.eofShutdown = {
    ok: eofCode === 0
      && eofActive?.result?.structuredContent?.data?.mutation_count === 0
      && eofQueued?.error?.code === -32800
      && !/cannot schedule new futures after shutdown/.test(eofStderr),
    code: eofCode,
    control: controlText.trim(),
    queuedCode: eofQueued?.error?.code ?? null,
    mutationCount: eofActive?.result?.structuredContent?.data?.mutation_count ?? null,
    stderr: eofStderr.trim(),
  };
  if (priorWidth === undefined) delete process.env.COC_MCP_PARALLEL_READ_WIDTH;
  else process.env.COC_MCP_PARALLEL_READ_WIDTH = priorWidth;
  if (priorNoLatch === undefined) delete process.env.COC_MCP_PROBE_NO_LATCH;
  else process.env.COC_MCP_PROBE_NO_LATCH = priorNoLatch;
} catch (error) {
  results.serverBarrier = { ok: false, detail: String(error) };
} finally {
  if (probeDir) await rm(probeDir, { recursive: true, force: true });
}

const ok = Object.values(results).every((entry) => entry.ok);
process.stdout.write(JSON.stringify({ ok, ...results }, null, 2) + "\n");
process.exit(ok ? 0 : 1);
