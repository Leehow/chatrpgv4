/**
 * Contract §174: shipped investigator templates seat a `setting_up` table without a setup
 * conversation. Every case runs the emitted TypeScript kernel (`build/kernel/rpc.mjs`) over a fresh
 * workspace, so what is asserted is what the onboarding worker gets back.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTENT = join(REPO, "content");
const TEMPLATES = join(CONTENT, "investigator-templates");

/** One cold kernel over `workspace`: every request in order, each answered as `{ok, result|error}`. */
function kernel(workspace, requests, content = CONTENT) {
	const input = requests.map(([method, params], index) => JSON.stringify({ id: String(index), method, params })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", content],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	assert.equal(run.status, 0, run.stderr);
	return run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
}
function ok(frame) {
	assert.equal(frame.ok, true, JSON.stringify(frame.error));
	return frame.result;
}
function scratch(t, name) {
	const path = mkdtempSync(join(tmpdir(), `pi-coc-${name}-`));
	t.after(() => rmSync(path, { recursive: true, force: true }));
	return path;
}
const campaignJson = (workspace, id) => JSON.parse(readFileSync(join(workspace, ".coc/campaigns", id, "campaign.json"), "utf8"));
const partyFiles = (workspace, id) => readdirSync(join(workspace, ".coc/campaigns", id, "party")).filter((name) => name.endsWith(".json"));
const shipped = () => readdirSync(TEMPLATES).sort();

test("setup.templates lists every shipped template in id order, from the sheets themselves", (t) => {
	const [listed] = kernel(scratch(t, "templates-list"), [["setup.templates", {}]]);
	const { templates, unreadable } = ok(listed);
	assert.equal(unreadable, undefined);
	assert.ok(templates.length >= 3, "three templates ship");
	assert.deepEqual(templates.map((row) => row.id), shipped());
	for (const row of templates) {
		const sheet = JSON.parse(readFileSync(join(TEMPLATES, row.id, "character.json"), "utf8"));
		assert.deepEqual(row, { id: row.id, name: sheet.name, occupation: sheet.occupation, era: sheet.era, age: sheet.age, sex: sheet.sex });
		// A template is a whole sheet the table can play: the kernel's own numbers, not a seed.
		for (const field of ["characteristics", "derived", "skills"]) assert.equal(typeof sheet[field], "object", `${row.id}.${field}`);
		// It belongs to no book (§174.1).
		assert.equal(sheet.backstory?.scenario_id, undefined, `${row.id} carries no book id`);
	}
});

test("setup.template seats the sheet whole, and setup.complete hands off without a draft or a confirm", (t) => {
	const workspace = scratch(t, "templates-seat");
	const [template] = shipped();
	const frames = kernel(workspace, [
		["campaign.create", { id: "auto", module: "the-haunting" }],
		["setup.template", { campaign: "auto", template }],
		["setup.steps", { campaign: "auto" }],
		["setup.complete", { campaign: "auto" }],
	]);
	ok(frames[0]);
	const seated = ok(frames[1]);
	assert.equal(seated.template, template);
	assert.equal(seated.replayed, undefined);
	const authored = JSON.parse(readFileSync(join(TEMPLATES, template, "character.json"), "utf8"));
	const [file] = partyFiles(workspace, "auto");
	const sheet = JSON.parse(readFileSync(join(workspace, ".coc/campaigns/auto/party", file), "utf8"));
	// Byte for byte except the minted id, the provenance and the live pools filled from `derived`.
	const { id, origin, current_hp, current_san, current_mp, current_luck, ...rest } = sheet;
	const { id: _authoredId, ...authoredRest } = authored;
	assert.deepEqual(rest, authoredRest);
	assert.equal(id, seated.investigator.id);
	assert.deepEqual(origin, { template }, "no library_id: §21.4's write-back never mirrors a template");
	assert.deepEqual([current_hp, current_san, current_mp, current_luck], [authored.derived.HP, authored.derived.SAN, authored.derived.MP, authored.characteristics.LUCK]);
	// The existing-sheet lane is booked, so `complete` is reachable for the setup extension.
	const steps = ok(frames[2]);
	assert.ok(steps.completed.includes("load-investigator"));
	assert.ok(!steps.completed.includes("confirm-investigator"));
	const handoff = ok(frames[3]);
	assert.equal(handoff.status, "ready_for_table");
	assert.equal(handoff.prologue, null, "the auto path records no prologue of its own");
	const meta = campaignJson(workspace, "auto");
	assert.equal(meta.status, "ready_for_table");
	assert.deepEqual(meta.investigators, [id]);
	assert.equal(meta.setup.draft_revision, undefined, "no draft was ever written");
	assert.deepEqual(meta.setup.receipts.map(({ at, ...receipt }) => receipt), [{ id: `investigator:${id}`, kind: "investigator", investigator: id,
		name: authored.name, occupation: authored.occupation, source: "template", template }]);
});

test("a retried seat replays the card it already seated, and a template never stacks onto another card", (t) => {
	const workspace = scratch(t, "templates-replay");
	const [first, second] = shipped();
	const frames = kernel(workspace, [
		["campaign.create", { id: "auto", module: "the-haunting" }],
		["setup.template", { campaign: "auto", template: first }],
		["setup.template", { campaign: "auto", template: second }],
		["setup.complete", { campaign: "auto" }],
		["setup.template", { campaign: "auto", template: first }],
		["campaign.create", { id: "drafted", module: "the-haunting" }],
		["setup.investigator", { campaign: "drafted", name: "Helen", occupation: "Journalist", seed: 7 }],
		["setup.template", { campaign: "drafted", template: first }],
		["campaign.create", { id: "unknown", module: "the-haunting" }],
		["setup.template", { campaign: "unknown", template: "no-such-template" }],
	]);
	const seated = ok(frames[1]);
	const again = ok(frames[2]);
	assert.equal(again.replayed, true);
	assert.equal(again.template, first, "the replay answers the card already seated");
	assert.equal(again.investigator.id, seated.investigator.id);
	ok(frames[3]);
	// After completion the campaign is no longer setting_up; the replay still answers, writing nothing.
	assert.equal(ok(frames[4]).replayed, true);
	assert.equal(partyFiles(workspace, "auto").length, 1);
	assert.equal(campaignJson(workspace, "auto").setup.receipts.length, 1);
	ok(frames[6]);
	assert.equal(frames[7].ok, false);
	assert.equal(frames[7].error.code, "invalid_params");
	assert.equal(frames[7].error.code_detail, "party_not_empty");
	assert.equal(partyFiles(workspace, "drafted").length, 1);
	assert.equal(frames[9].ok, false);
	assert.equal(frames[9].error.code, "unknown_entity");
	assert.deepEqual(frames[9].error.details, { query: "no-such-template", candidates: shipped() });
	assert.equal(partyFiles(workspace, "unknown").length, 0);
});

test("a template on a table that is no longer setting up is refused, not seated", (t) => {
	const workspace = scratch(t, "templates-active");
	const frames = kernel(workspace, [
		["campaign.create", { id: "pregen", module: "the-haunting", pregen: "thomas-hayes" }],
		["setup.template", { campaign: "pregen", template: shipped()[0] }],
	]);
	ok(frames[0]);
	assert.equal(frames[1].ok, false);
	assert.equal(frames[1].error.code, "campaign_not_ready");
});

test("an era the book does not share is accepted and recorded, as a library load records it", (t) => {
	const base = scratch(t, "templates-era");
	const content = join(base, "content");
	mkdirSync(content);
	for (const name of readdirSync(CONTENT)) if (name !== "investigator-templates") symlinkSync(join(CONTENT, name), join(content, name));
	const sheet = JSON.parse(readFileSync(join(TEMPLATES, shipped()[0], "character.json"), "utf8"));
	mkdirSync(join(content, "investigator-templates", "later"), { recursive: true });
	writeFileSync(join(content, "investigator-templates", "later", "character.json"), JSON.stringify({ ...sheet, era: "modern" }));
	// A folder whose file is not a sheet is reported, never offered.
	mkdirSync(join(content, "investigator-templates", "broken"), { recursive: true });
	writeFileSync(join(content, "investigator-templates", "broken", "character.json"), JSON.stringify(["not", "a", "sheet"]));
	const workspace = join(base, "home");
	mkdirSync(workspace);
	const frames = kernel(workspace, [
		["setup.templates", {}],
		["campaign.create", { id: "era", module: "the-haunting" }],
		["setup.template", { campaign: "era", template: "later" }],
	], content);
	const listed = ok(frames[0]);
	assert.deepEqual(listed.templates.map((row) => row.id), ["later"]);
	assert.deepEqual(listed.unreadable, ["broken"]);
	ok(frames[1]);
	const seated = ok(frames[2]);
	assert.deepEqual(seated.era_mismatch, { sheet: "modern", module: "1920s" });
	assert.deepEqual(campaignJson(workspace, "era").era_mismatch, { sheet: "modern", module: "1920s" });
});
