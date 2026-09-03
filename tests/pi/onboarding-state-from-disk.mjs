#!/usr/bin/env node
// Onboarding position is read from the campaign directory, never from a
// counter. These assertions pin the reads that were wrong when written:
// the fact envelope carries two non-answer keys, and `.coc/investigators/`
// is shared across campaigns rather than owned by one.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const repo = path.resolve(process.argv[2] || process.cwd());
const { readState } = await import(pathToFileURL(
  path.join(repo, "plugins/coc-keeper/pi/extensions/onboarding/state.ts"),
).href);

const root = mkdtempSync(path.join(tmpdir(), "coc-onboarding-"));
const campaignDir = path.join(root, ".coc", "campaigns", "probe");
mkdirSync(campaignDir, { recursive: true });
const writeCampaign = (body) =>
  writeFileSync(path.join(campaignDir, "campaign.json"), JSON.stringify(body));
const choice = {
  starterId: null, bundlePath: "/w/b", sourceTitle: "M",
  scenarioId: "m", playLanguage: "zh-Hans",
};
const read = () => readState(root, "probe", choice);

// The envelope keys are a string and an integer. Folding them into the row
// scan makes a fully adopted campaign read as un-adopted, which parks
// onboarding on source review forever.
writeCampaign({
  campaign_id: "probe",
  source_fast_facts: {
    schema_version: 1,
    contract_id: "coc.opening-fast-facts.v1",
    era: { status: "source", value: "roman" },
    place: { status: "source", value: "Britannia" },
    investigator_hook: { status: "source", value: "h" },
    investigator_constraints: { status: "source", value: "c" },
    player_safe_summary: { status: "source", value: "s" },
    content_flags: { status: "unresolved" },
  },
});
assert.equal(read().factsAdopted, true, "adopted facts must read as adopted");

// One unanswered question is not adoption. A bind-guessed default carries no
// status at all, and that is how a Roman module was labelled 1920s.
writeCampaign({
  campaign_id: "probe",
  source_fast_facts: {
    schema_version: 1,
    contract_id: "coc.opening-fast-facts.v1",
    era: { value: "1920s" },
  },
});
assert.equal(read().factsAdopted, false, "a guessed default is not an adopted fact");

// An envelope with no answers at all is not adoption either.
writeCampaign({
  campaign_id: "probe",
  source_fast_facts: { schema_version: 1, contract_id: "coc.opening-fast-facts.v1" },
});
assert.equal(read().factsAdopted, false, "an empty answer set is not adoption");

// Investigators are campaign-scoped. `.coc/investigators/` holds every table's
// characters, so a character there proves nothing about this campaign.
writeCampaign({ campaign_id: "probe" });
mkdirSync(path.join(root, ".coc", "investigators", "someone-elses-pc"), { recursive: true });
assert.equal(read().investigatorId, null, "another table's character is not this campaign's");
assert.equal(read().investigatorLinked, false);

writeFileSync(
  path.join(campaignDir, "party.json"),
  JSON.stringify({ investigator_ids: ["ours"] }),
);
assert.equal(read().investigatorId, "ours");
assert.equal(read().investigatorLinked, true);

// Handoff requires both the status and the receipt: status alone is what an
// interrupted complete leaves behind.
writeCampaign({ campaign_id: "probe", status: "ready_for_table" });
assert.equal(read().readyForTable, false, "status without a receipt is not a handoff");
writeCampaign({
  campaign_id: "probe", status: "ready_for_table",
  setup_handoff: { schema_version: 1, decision_id: "d" },
});
assert.equal(read().readyForTable, true);

console.log(JSON.stringify({ ok: true, module: "onboarding-state-from-disk" }));
