#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.cwd());
const handoffUrl = pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/handoff.ts"),
).href;

const receipt = {
  schema_version: 1,
  decision_id: "handoff-3",
  campaign_id: "builtin-ready",
  completed_at: "2026-04-08T00:00:00Z",
  builder_summary_hash: "sha256:abc",
};

function successEnvelope(overrides = {}) {
  return {
    ok: true,
    operation: "setup.complete",
    tool: "setup.complete",
    data: {
      schema_version: 1,
      status: "PASS",
      kind: "campaign.complete",
      result: {
        campaign_id: "builtin-ready",
        ready_for_table: true,
        status: "ready_for_table",
        handoff: receipt,
      },
    },
    ...overrides,
  };
}

test("exit code constant is 42", async () => {
  const mod = await import(handoffUrl);
  assert.equal(mod.COC_SETUP_HANDOFF_EXIT_CODE, 42);
});

test("setup.complete ok with handoff receipt", async () => {
  const mod = await import(handoffUrl);
  assert.deepEqual(mod.handoffFromEnvelope(successEnvelope()), {
    campaign_id: "builtin-ready",
    receipt,
  });
});

test("setup.complete ok with handoff_receipt alias", async () => {
  const mod = await import(handoffUrl);
  const envelope = successEnvelope();
  delete envelope.data.result.handoff;
  envelope.data.result.handoff_receipt = receipt;
  assert.deepEqual(mod.handoffFromEnvelope(envelope), {
    campaign_id: "builtin-ready",
    receipt,
  });
});

test("other operation is null", async () => {
  const mod = await import(handoffUrl);
  assert.equal(
    mod.handoffFromEnvelope(successEnvelope({ operation: "setup.inspect", tool: "setup.inspect" })),
    null,
  );
});

test("ok false is null", async () => {
  const mod = await import(handoffUrl);
  assert.equal(
    mod.handoffFromEnvelope(successEnvelope({ ok: false })),
    null,
  );
});

test("missing receipt is null", async () => {
  const mod = await import(handoffUrl);
  const envelope = successEnvelope();
  delete envelope.data.result.handoff;
  assert.equal(mod.handoffFromEnvelope(envelope), null);
});

test("malformed envelope is null", async () => {
  const mod = await import(handoffUrl);
  assert.equal(mod.handoffFromEnvelope(null), null);
  assert.equal(mod.handoffFromEnvelope("setup.complete"), null);
  assert.equal(mod.handoffFromEnvelope([]), null);
  assert.equal(mod.handoffFromEnvelope({ ok: true, operation: "setup.complete", data: { result: { handoff: "nope" } } }), null);
  assert.equal(mod.handoffFromEnvelope({ ok: true, operation: "setup.complete", data: { result: { handoff: [] } } }), null);
  assert.equal(
    mod.handoffFromEnvelope({
      ok: true,
      operation: "setup.complete",
      data: { result: { handoff: { decision_id: "x" } } },
    }),
    null,
  );
});
