#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const projection = await import(pathToFileURL(path.join(
  root,
  "plugins/coc-keeper/pi/lib/tool-contract-projection.ts",
)).href);

const directorEnvelope = (dangerId = "walter-corbitt") => ({
  ok: true,
  tool: "director.advise",
  data: {
    schema_version: 1,
    advice_id: "director:1:d57c6f1841d66247f610",
    authority: "advisory",
    hard_gate: false,
    candidate_plan: {
      decision_id: "ask-director-advise-dramatic-goal-v1",
      turn_input: { active_scene_id: "corbitt-confrontation", turn_number: 1 },
      time_signals: { location_id: "corbitt-confrontation" },
      npc_moves: [{ npc_id: "npc-walter-corbitt", display_name: "Walter Corbitt" }],
      rules_requests: [{
        kind: "sanity_check",
        san_trigger_id: "see-corbitt-body",
      }],
      narrative_directives: {
        must_not_reveal: [{
          id: "secret-corbitt-undead-sorcerer",
          category: "keeper_secret",
        }],
      },
    },
    context_summary: {
      active_scene_id: "corbitt-confrontation",
      threat_fronts: {
        fronts: [{
          front_id: "corbitt-haunting",
          dangers: [{
            id: dangerId,
            monster_ref: "Walter Corbitt",
            impulse: "drive out intruders",
          }],
          clocks: [{ clock_id: "corbitt-awareness", segments: 4 }],
        }],
      },
      time_signals: { location_id: "corbitt-confrontation" },
    },
  },
});

test("director.advise keeps semantic graph refs and hides display-only monster refs", () => {
  const diagnostics = { unmapped: [] };
  const visible = projection.projectModelVisibleCanonicalResult(
    "director.advise",
    directorEnvelope(),
    null,
    diagnostics,
  );

  assert.deepEqual(diagnostics.unmapped, []);
  assert.equal(visible.ok, true);
  assert.equal(visible.data.candidate_plan.decision_id, undefined);
  assert.equal(
    visible.data.candidate_plan.turn_input.active_scene_id,
    "corbitt-confrontation",
  );
  assert.equal(
    visible.data.candidate_plan.time_signals.location_id,
    "corbitt-confrontation",
  );
  assert.equal(
    visible.data.candidate_plan.npc_moves[0].npc_id,
    "npc-walter-corbitt",
  );
  assert.equal(
    visible.data.candidate_plan.rules_requests[0].san_trigger_id,
    "see-corbitt-body",
  );
  assert.equal(
    visible.data.candidate_plan.narrative_directives.must_not_reveal[0].id,
    "secret-corbitt-undead-sorcerer",
  );
  const front = visible.data.context_summary.threat_fronts.fronts[0];
  assert.equal(front.front_id, "corbitt-haunting");
  assert.equal(front.dangers[0].id, "walter-corbitt");
  assert.equal(front.dangers[0].monster_ref, undefined);
  assert.equal(front.clocks[0].clock_id, "corbitt-awareness");
  assert.equal(
    visible.data.context_summary.time_signals.location_id,
    "corbitt-confrontation",
  );
});

test("director operation-local id declaration still rejects opaque identity", () => {
  const opaque = `danger-${"a".repeat(32)}`;
  const diagnostics = { unmapped: [] };
  const visible = projection.projectModelVisibleCanonicalResult(
    "director.advise",
    directorEnvelope(opaque),
    null,
    diagnostics,
  );

  assert.equal(visible.data.context_summary.threat_fronts.fronts[0].dangers[0].id,
    undefined);
  assert.ok(diagnostics.unmapped.some((row) => (
    row.field === "id" && row.domain === "unknown"
  )));
  assert.ok(!JSON.stringify(visible).includes(opaque));
});
