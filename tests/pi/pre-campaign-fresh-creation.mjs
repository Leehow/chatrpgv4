#!/usr/bin/env node
// A campaign.create is as pre-campaign as a quick_start. The inline check that
// preceded this named only quick_start, so on the typed surface -- the only
// surface a live Keeper has -- campaign.create kept the mirrored transport
// selector and could never satisfy the fresh-setup gate. Seen live on
// 2026-09-02: five refusals of the very operation the refusal told the Keeper
// to call, after which the Keeper fell back to the built-in starter and told
// the player the requested PDF module was ready. PDF -> playable campaign was
// impossible through the product's own surface.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const { isPreCampaignFreshCreation } = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/domain-tools.ts")
);

assert.equal(isPreCampaignFreshCreation("setup.quick_start", {}), true);
assert.equal(
  isPreCampaignFreshCreation("setup.invoke", { kind: "campaign.create" }),
  true,
  "campaign.create creates the campaign it names",
);

// Everything else keeps the selector: those operations act on a campaign that
// already exists, and stripping it would strand them.
assert.equal(
  isPreCampaignFreshCreation("setup.invoke", { kind: "scenario.bind_pdf" }),
  false,
);
assert.equal(
  isPreCampaignFreshCreation("setup.invoke", { kind: "campaign.link_investigator" }),
  false,
);
assert.equal(isPreCampaignFreshCreation("setup.complete", {}), false);
assert.equal(isPreCampaignFreshCreation("scene.context", {}), false);
assert.equal(isPreCampaignFreshCreation(undefined, null), false);
assert.equal(isPreCampaignFreshCreation("setup.invoke", null), false);

console.log(JSON.stringify({ ok: true, module: "pre-campaign-fresh-creation" }));
