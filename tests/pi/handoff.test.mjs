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
  investigator_ids: ["inv-ok"],
  completed_at: "2026-04-08T00:00:00Z",
  opening_projection_ref: null,
  lane_interrupted_at_handoff: false,
};

const expected = {
  campaignId: "builtin-ready",
  decisionId: "handoff-3",
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
        next: "table_opening",
        status: "ready_for_table",
        handoff: structuredClone(receipt),
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
  assert.deepEqual(mod.handoffFromEnvelope(successEnvelope(), expected), {
    campaign_id: "builtin-ready",
    receipt: structuredClone(receipt),
  });
});

test("setup.complete ok with handoff_receipt alias", async () => {
  const mod = await import(handoffUrl);
  const envelope = successEnvelope();
  delete envelope.data.result.handoff;
  envelope.data.result.handoff_receipt = receipt;
  assert.deepEqual(mod.handoffFromEnvelope(envelope, expected), {
    campaign_id: "builtin-ready",
    receipt: structuredClone(receipt),
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
  envelope.data.result.receipt = structuredClone(receipt);
  assert.equal(
    mod.handoffFromEnvelope(envelope, expected),
    null,
    "generic receipt is not a canonical setup handoff alias",
  );
});

test("setup.complete receipt is bound to the exact campaign and decision", async () => {
  const mod = await import(handoffUrl);
  assert.equal(mod.handoffFromEnvelope(successEnvelope(), {
    ...expected,
    campaignId: "other-campaign",
  }), null);
  assert.equal(mod.handoffFromEnvelope(successEnvelope(), {
    ...expected,
    decisionId: "other-decision",
  }), null);
  const wrongResultCampaign = successEnvelope();
  wrongResultCampaign.data.result.campaign_id = "other-campaign";
  assert.equal(mod.handoffFromEnvelope(wrongResultCampaign, expected), null);
  const notReady = successEnvelope();
  notReady.data.result.ready_for_table = false;
  assert.equal(mod.handoffFromEnvelope(notReady, expected), null);
});

test("setup.complete receipt is exact schema v1", async () => {
  const mod = await import(handoffUrl);
  const extra = successEnvelope();
  extra.data.result.handoff.unexpected = true;
  assert.equal(mod.handoffFromEnvelope(extra, expected), null);
  const unsafe = successEnvelope();
  unsafe.data.result.handoff.investigator_ids = ["../outside"];
  assert.equal(mod.handoffFromEnvelope(unsafe, expected), null);
  const duplicate = successEnvelope();
  duplicate.data.result.handoff.investigator_ids = ["inv-ok", "inv-ok"];
  assert.equal(mod.handoffFromEnvelope(duplicate, expected), null);
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
