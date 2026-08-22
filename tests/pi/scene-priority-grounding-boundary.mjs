#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const { PiSemanticSupplyCoordinator } = await import(
  path.join(root, "plugins/coc-keeper/pi/extensions/coordinator.ts")
);

const hidden = [];
const supply = new PiSemanticSupplyCoordinator();
supply.start({
  isCurrent: () => true,
  coordinatorEnabled: async () => false,
  launchContext: () => null,
  launchCoordinator: () => { throw new Error("unexpected coordinator launch"); },
  callCanonical: async () => { throw new Error("source is deliberately pending"); },
  appendAudit: () => {},
  sendHidden: (context, options) => hidden.push({ context, options }),
  projectTerminal: () => ({ status: "delivered" }),
});

const campaignId = "grounding-boundary";
supply.observeCanonical(
  "state.move_scene",
  {
    operation: "state.move_scene",
    root,
    campaign: campaignId,
    arguments: { scene_id: "source-gap", decision_id: "move-source-gap" },
  },
  {
    ok: true,
    tool: "state.move_scene",
    data: {
      campaign_id: campaignId,
      to_scene_id: "source-gap",
      scene: {
        parse_state: "named_only",
        evidence_gap: true,
        source_context_mentions: [{ kind: "location", ref_id: "source-location" }],
      },
      progressive: { asset_root_id: "asset-grounding-boundary" },
    },
  },
);

const waiting = hidden.find((entry) => entry.context?.reason === "scene_priority_waiting");
assert.equal(waiting?.context?.scene_priority?.hard_gate, false);
assert.equal(
  waiting?.context?.scene_priority?.exact_source_dependency?.status,
  "unresolved",
);
assert.equal(
  waiting?.context?.scene_priority?.exact_source_dependency?.keeper_action,
  "do_not_assert_or_improvise_source_specific_facts",
);

const prompt = readFileSync(
  path.join(root, "plugins/coc-keeper/pi/prompts/host-system-play.md"),
  "utf8",
);
assert.match(prompt, /exact_source_dependency\.status=unresolved/);
assert.match(prompt, /do not assert, negate, or\s+improvise that fact/);
assert.match(prompt, /not a gate on unrelated play/);

await supply.shutdown();
process.stdout.write(JSON.stringify({ ok: true }));
