#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const gateUrl = pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/startup-resume-gate.ts"),
).href;

async function loadGate() {
  return import(`${gateUrl}?t=${Date.now()}-${Math.random()}`);
}

const GATE = {
  phase: "pending",
  workspaceRoot: "/tmp/sandbox",
  campaignId: "the-haunting-qs-mt8q9tv3",
};

test("typed session.resume with optional investigator is still the exact startup resume", async () => {
  const { isExactStartupResumeParams, bindStartupResumeParams } = await loadGate();
  const wrapped = {
    operation: "session.resume",
    root: GATE.workspaceRoot,
    campaign: GATE.campaignId,
    arguments: { investigator: "inv-x04557fc8-4cee0891" },
  };
  assert.equal(isExactStartupResumeParams("coc_session_resume", wrapped, GATE), true);
  assert.deepEqual(
    bindStartupResumeParams("coc_session_resume", {
      operation: "session.resume",
      campaign: GATE.campaignId,
      arguments: { investigator: "inv-x04557fc8-4cee0891" },
    }, GATE),
    {
      operation: "session.resume",
      root: GATE.workspaceRoot,
      campaign: GATE.campaignId,
      arguments: { investigator: "inv-x04557fc8-4cee0891" },
    },
  );
});

test("typed session.resume with empty arguments still binds root and campaign", async () => {
  const { isExactStartupResumeParams, bindStartupResumeParams } = await loadGate();
  const bound = bindStartupResumeParams("coc_session_resume", {
    operation: "session.resume",
    arguments: {},
  }, GATE);
  assert.deepEqual(bound, {
    operation: "session.resume",
    root: GATE.workspaceRoot,
    campaign: GATE.campaignId,
    arguments: {},
  });
  assert.equal(isExactStartupResumeParams("coc_session_resume", bound, GATE), true);
});

test("a different campaign or non-identity argument is not an exact startup resume", async () => {
  const { isExactStartupResumeParams, bindStartupResumeParams } = await loadGate();
  assert.equal(isExactStartupResumeParams("coc_session_resume", {
    operation: "session.resume",
    root: GATE.workspaceRoot,
    campaign: "other-campaign",
    arguments: {},
  }, GATE), false);
  assert.equal(isExactStartupResumeParams("coc_session_resume", {
    operation: "session.resume",
    root: GATE.workspaceRoot,
    campaign: GATE.campaignId,
    arguments: { extra: true },
  }, GATE), false);
  for (const drifted of [
    { campaign: "other-campaign" },
    { root: "/tmp/other-sandbox" },
  ]) {
    const invocation = {
      operation: "session.resume",
      ...drifted,
      arguments: { investigator: "investigator-thomas-hayes" },
    };
    assert.deepEqual(
      bindStartupResumeParams("coc_session_resume", invocation, {
        ...GATE,
        origin: "role_null_handoff",
        phase: "terminal_failure",
      }),
      invocation,
    );
  }
});

test("only a role-null handoff may retry an exact resume after terminal failure", async () => {
  const { isExactStartupResumeParams, bindStartupResumeParams } = await loadGate();
  const invocation = {
    operation: "session.resume",
    arguments: { context_epoch: 41 },
  };
  const roleNullGate = {
    ...GATE,
    origin: "role_null_handoff",
    phase: "terminal_failure",
  };
  const bound = bindStartupResumeParams(
    "coc_session_resume",
    invocation,
    roleNullGate,
  );
  assert.deepEqual(bound, {
    ...invocation,
    root: GATE.workspaceRoot,
    campaign: GATE.campaignId,
  });
  assert.equal(
    isExactStartupResumeParams("coc_session_resume", bound, roleNullGate),
    true,
  );
  assert.deepEqual(
    bindStartupResumeParams("coc_session_resume", invocation, {
      ...roleNullGate,
      origin: "startup_selector",
    }),
    invocation,
  );
});

test("resume identity arguments share one closed schema and exact campaign/root match", async () => {
  const { startupResumeIdentityArgumentsMatch } = await loadGate();
  assert.equal(startupResumeIdentityArgumentsMatch({
    campaign: GATE.campaignId,
    campaign_id: GATE.campaignId,
    root: GATE.workspaceRoot,
    investigator: "investigator-thomas-hayes",
    host_session_id: "pi-session-haunting-1",
    context_epoch: 41,
  }, GATE), true);
  for (const argumentsObject of [
    { campaign: "other-campaign" },
    { campaign: GATE.campaignId, campaign_id: "other-campaign" },
    { root: "/tmp/other-sandbox" },
    { investigator: 41 },
    { host_session_id: false },
    { context_epoch: 0 },
    { context_epoch: 1.5 },
    { unsupported: "drift" },
  ]) {
    assert.equal(
      startupResumeIdentityArgumentsMatch(argumentsObject, GATE),
      false,
      JSON.stringify(argumentsObject),
    );
  }
});
