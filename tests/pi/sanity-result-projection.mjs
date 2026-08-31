#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const projection = await import(
  pathToFileURL(
    path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts"),
  ).href
);

function project(operation, envelope) {
  const diagnostics = { unmapped: [] };
  const visible = projection.projectModelVisibleCanonicalResult(
    operation,
    envelope,
    null,
    diagnostics,
  );
  return { visible, diagnostics: diagnostics.unmapped };
}

test("sanity.execute hides scheduled and pending-choice machine identities", () => {
  const canonical = {
    ok: true,
    tool: "sanity.execute",
    data: {
      schema_version: 1,
      authority: "deterministic_subsystem",
      investigator_id: "thomas-hayes",
      results: [{
        command_id: "pi-sanity-execute:sanity_check:see-corbitt-body:revision-1",
        kind: "sanity_check",
        status: "pending_choice",
        events: [{
          event_id: "se4",
          trigger_id: "trg-3e3e1d283010",
          due_elapsed_minutes: 420,
          summary: "temporary-insanity recovery scheduled",
        }],
        pending_choice: {
          choice_id: "pi-sanity-execute:sanity_check:see-corbitt-body:revision-1:bout",
          command_id: "pi-sanity-execute:sanity_check:see-corbitt-body:revision-1",
          kind: "bout_keeper_action",
          responder: "keeper",
          prompt: "Advance or end the active bout?",
          options: [{ action: "tick", label: "Advance round" }],
        },
      }],
    },
  };

  const { visible, diagnostics } = project("sanity.execute", canonical);
  assert.deepEqual(diagnostics, []);
  assert.equal(visible.ok, true);
  assert.equal(visible.data.results[0].status, "pending_choice");
  assert.equal(visible.data.results[0].events[0].summary,
    "temporary-insanity recovery scheduled");
  assert.equal(visible.data.results[0].events[0].trigger_id, undefined);
  assert.equal(visible.data.results[0].pending_choice.choice_id, undefined);
  assert.equal(visible.data.results[0].pending_choice.command_id, undefined);
  assert.ok(!JSON.stringify(visible).includes("3e3e1d283010"));
});

test("sanity.context keeps semantic rules and hides snapshot event identities", () => {
  const canonical = {
    ok: true,
    tool: "sanity.context",
    data: {
      investigator_id: "thomas-hayes",
      active: true,
      snapshot: {
        investigator_id: "thomas-hayes",
        active_bout_id: "thomas-hayes:bout:1",
        bouts_of_madness: [{
          bout_id: "thomas-hayes:bout:1",
          summary: "Amnesia",
        }],
        involuntary_actions: [{
          kind: "freeze",
          summary: "你僵在原地。",
          rule_ref: "core.sanity.failure_involuntary_action",
        }],
        events: [{
          event_id: "se1",
          type: "involuntary_action",
          payload: {
            bout_id: "thomas-hayes:bout:1",
            trigger_id: "trg-3e3e1d283010",
            rule_ref: "core.sanity.failure_involuntary_action",
          },
        }],
      },
      pending_choices: [],
    },
  };

  const { visible, diagnostics } = project("sanity.context", canonical);
  assert.deepEqual(diagnostics, []);
  assert.equal(visible.ok, true);
  assert.equal(
    visible.data.snapshot.involuntary_actions[0].rule_ref,
    "core.sanity.failure_involuntary_action",
  );
  assert.equal(visible.data.snapshot.active_bout_id, undefined);
  assert.equal(visible.data.snapshot.bouts_of_madness[0].bout_id, undefined);
  assert.equal(visible.data.snapshot.events[0].event_id, undefined);
  assert.equal(visible.data.snapshot.events[0].payload.bout_id, undefined);
  assert.equal(visible.data.snapshot.events[0].payload.trigger_id, undefined);
  assert.ok(!JSON.stringify(visible).includes("3e3e1d283010"));
});
