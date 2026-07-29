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
    let result;
    if (
      message.method === "tools/call"
      && message.params?.name === "coc_invoke"
      && message.params?.arguments?.operation === "session.resume"
    ) {
      const campaignId = message.params.arguments.campaign;
      const openingGate = {
        schema_version: 1,
        status: "blocked",
        hard_gate: true,
        activation_allowed: false,
        phase: "opening_selection",
        campaign_id: campaignId,
        asset_root_id: "asset-fake-child",
        next_operation: {
          operation: "progressive.prepare_opening",
          invoke_via: "coc_invoke",
          prefilled_arguments: {},
          missing_arguments: [],
          hard_gate: true,
          authority: "canonical_setup",
        },
      };
      const envelope = {
        ok: false,
        tool: "session.resume",
        error: {
          code: "opening_setup_incomplete",
          message: "TOP_SECRET_FAKE_CHILD_ERROR_PROSE",
          details: openingGate,
        },
      };
      result = {
        content: [{
          type: "text",
          text: JSON.stringify(envelope),
        }],
        structuredContent: envelope,
        isError: true,
      };
    } else {
      result = {
        method: message.method,
        echoed: message.params ?? null,
        arrivalOrder: arrival.slice(),
      };
    }
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
