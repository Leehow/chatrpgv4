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

const ok = Object.values(results).every((entry) => entry.ok);
process.stdout.write(JSON.stringify({ ok, ...results }, null, 2) + "\n");
process.exit(ok ? 0 : 1);
