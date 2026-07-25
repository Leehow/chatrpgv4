#!/usr/bin/env node
/**
 * Fake MCP JSONL child for McpJsonlClient transport regression probes.
 *
 * Strictly FIFO, like the real Python stdio server: one JSONL request per
 * line in, one JSONL response per line out, processed in arrival order.
 *
 * Environment controls:
 * - FAKE_CHILD_DELAY_MS: respond to each request after this delay.
 * - FAKE_CHILD_HANG_ID: when this request id arrives, wedge permanently —
 *   never respond again (simulates a hung child).
 *
 * Each response echoes the request params, its method, and the arrival id
 * order seen so far, so the parent probe can assert dispatch-order and
 * response-matching guarantees.
 */
let buffer = "";
const arrival = [];
const delayMs = Number(process.env.FAKE_CHILD_DELAY_MS || "0");
const hangId = process.env.FAKE_CHILD_HANG_ID ? Number(process.env.FAKE_CHILD_HANG_ID) : null;
const queue = [];
let busy = false;
let wedged = false;

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length > 0 && !wedged) {
    const message = queue.shift();
    arrival.push(message.id);
    if (hangId !== null && message.id === hangId) {
      wedged = true;
      break;
    }
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const result = { method: message.method, echoed: message.params ?? null, arrivalOrder: arrival.slice() };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
  }
  busy = false;
}

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    queue.push(JSON.parse(line));
  }
  void pump();
});
process.stdin.on("end", () => process.exit(0));
