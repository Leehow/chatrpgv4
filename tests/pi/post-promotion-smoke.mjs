#!/usr/bin/env node
/*
 * engineering smoke: post-promotion runtime route check for the Pi source
 * coordinator capability.
 *
 * STATUS: engineering smoke. NOT an acceptance test and NOT playtest evidence.
 * It only verifies that the capability promotion is effective at runtime on
 * the two paths that gate real dispatch:
 *
 *   1. the Pi extension's own fail-closed gate in coc_dispatch_source_work
 *      (piCoordinatorEnabled() reading references/host-capabilities.json), and
 *   2. the canonical capability discovery the main Keeper consults
 *      (MCP coc_capabilities with COC_HOST=pi).
 *
 * It performs no claim/fulfill and consumes no model tokens. The full
 * claim -> leaf -> fulfill lifecycle is proven separately by
 * tests/pi/real-lifecycle-probe.mjs (mode=run); a window-equivalent playtest
 * remains the separate acceptance path.
 *
 * Usage (from the repository root):
 *   node --experimental-strip-types tests/pi/post-promotion-smoke.mjs <root>
 *
 * Prints one JSON object on stdout.
 */
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
// mcp/launch shells out to uv; pin a writable cache dir for sandboxed runs.
if (!process.env.UV_CACHE_DIR) process.env.UV_CACHE_DIR = "/tmp/uv-cache-probe";

const runtime = await import(path.join(root, "plugins/coc-keeper/pi/lib/runtime.ts"));
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));

// 1. The exact fail-closed gate inside coc_dispatch_source_work is open.
const gateOpen = (await main.__test.piCoordinatorEnabled()) === true;

// 2. Canonical capability discovery (COC_HOST=pi) reports the promotion.
const client = new runtime.McpJsonlClient(root, "pi-post-promotion-smoke");
let discovery = null;
try {
  const envelope = await client.callTool("coc_capabilities", {});
  discovery = envelope.data;
} finally {
  await client.close();
}

const pi = (discovery && typeof discovery === "object" ? discovery.capabilities : {}) ?? {};
const checks = {
  dispatch_gate_open: gateOpen,
  discovery_host_is_pi: discovery?.host === "pi",
  capability_flag: pi.coc_source_coordinator_v1 === true,
  capability_status_experimental: pi.coc_source_coordinator_v1_status === "experimental",
  capability_adapter: pi.coc_source_coordinator_v1_adapter === "pi_private_lifecycle",
  max_leaves: pi.max_source_coordinator_leaves === 4,
};
const ok = Object.values(checks).every(Boolean);

process.stdout.write(JSON.stringify({
  engineering_probe: true,
  acceptance: false,
  smoke: "post-promotion-runtime-route",
  ok,
  checks,
  discovered_host: discovery?.host ?? null,
  discovered_pi_capabilities: pi,
}, null, 2) + "\n");
if (!ok) process.exitCode = 1;
