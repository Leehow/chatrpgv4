import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * The packaged App ships only the pack UI files `pipicoc/runtime-dependencies.json` names
 * (its `uiFiles` list is the manifest `scripts/package-runtime.mjs` assembles from). A UI
 * contribution the coc-keeper manifest declares but the list omits is invisible at source
 * time and fails inside the packaged App with "UI entry is unavailable" — the class of miss
 * the creation-difficulty section (contract §33.5) first hit. Pin every manifest UI entry
 * that lives under pipicoc/ to the shipped list.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(REPO, "pipiui-extension.json"), "utf8"));
const dependencies = JSON.parse(readFileSync(join(REPO, "pipicoc", "runtime-dependencies.json"), "utf8"));

/** Every `entry` the manifest's app.ui contributions name, as a pipicoc/-relative path. */
function contributedEntries(ui) {
	const found = [];
	const groups = [ui?.settingsSections, ui?.panels, ui?.toolRenderers, ui?.views];
	for (const group of groups) {
		if (!Array.isArray(group)) continue;
		for (const item of group) if (typeof item?.entry === "string") found.push(item.entry);
	}
	return found;
}

test("every coc-keeper manifest UI entry under pipicoc/ ships in the packaged App", () => {
	const shipped = new Set(Array.isArray(dependencies.uiFiles) ? dependencies.uiFiles : []);
	const entries = contributedEntries(manifest?.app?.ui);
	assert.ok(entries.length > 0, "the manifest declares UI contributions; a read error is more likely than none");
	const local = entries.filter((entry) => entry.startsWith("pipicoc/"));
	assert.ok(local.length > 0, "at least one UI contribution lives under pipicoc/");
	const missing = local.map((entry) => entry.slice("pipicoc/".length)).filter((file) => !shipped.has(file));
	assert.deepEqual(missing, [], `these UI entries load in source mode but are absent from the package (add them to pipicoc/runtime-dependencies.json uiFiles):\n${missing.join("\n")}`);
});

test("every coc-keeper manifest UI entry under pipicoc/ is installed into the Pi profile", () => {
	// The profile installer (pipicoc/install) copies a second, hand-kept asset list; an entry
	// missing from it loads in source mode but is unavailable inside the App's installed profile
	// (the creation-difficulty section's second miss of the same class).
	const install = readFileSync(join(REPO, "pipicoc", "install"), "utf8");
	const match = /for\(const asset of \[([^\]]*)\]\)/.exec(install);
	assert.ok(match, "pipicoc/install keeps the asset list this test pins");
	const installed = new Set([...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]));
	const entries = contributedEntries(manifest?.app?.ui).filter((entry) => entry.startsWith("pipicoc/"));
	const missing = entries.map((entry) => entry.slice("pipicoc/".length)).filter((file) => !installed.has(file));
	assert.deepEqual(missing, [], `these UI entries are absent from the profile installer (add them to pipicoc/install):\n${missing.join("\n")}`);
});
