/**
 * The opening the player chose, on a book with more than one (contract §14.19, SL-98), and what the
 * player is told while setup waits or refuses (§14.19.4, SL-100).
 *
 * The Masks PDF table (masks-1350-20260926T175048Z): `prepare-module` answered `needs_choice` with two
 * openings, the player chose New York, and `prepare-module {start_scene}` then waited on the opening's
 * reading three times. Nothing recorded the choice, so `create-campaign` ran with no opening, guidance
 * threw `preparation_failed` ("The selected opening scene is unavailable"), and every later call --
 * `prepare-module {start_scene}` for both openings among them -- was refused `setup_blocked` before it
 * could act. The table ended in setup. Every case here drives the real `setup` tool through the
 * onboarding extension; the reader is either the real reading service over the fake kernel or, where
 * the case needs a preparation that finished without recording a choice, a stub reading bridge.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";

const setupCall = (params) => fauxAssistantMessage([fauxToolCall("setup", params)], { stopReason: "toolUse" });

/** Every `setup` result, parsed, in call order. */
function setupResults(session) {
	return session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === "setup")
		.map((message) => JSON.parse((message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("")));
}

/** The last assistant message's text blocks, as the screen shows them after `message_end`. */
function lastAssistantTextBlocks(session) {
	const last = session.messages.filter((message) => message.role === "assistant").at(-1);
	return (last?.content ?? []).filter((block) => block.type === "text").map((block) => block.text);
}

/** The book's two openings as the kernel reports them (`module.status` `opening_candidates`, §14.14). */
const OPENINGS = [
	{ node_id: "scene-dock", scene: "dock", name: "The Dock", summary: "Investigators meet a courier at the harbour in 1921." },
	{ node_id: "scene-tower", scene: "tower", name: "The Tower", summary: "A telegram calls the investigators to a tower in 1925." },
];

/**
 * The book on disk, as the guidance preparer reads it: a graph with the scenes, and `module.json`
 * with the kernel's `opening` report. With two openings the report carries the choice and no start
 * scene, as the Masks book's did; with one it names it.
 */
function installBook(table, moduleId, openings) {
	const folder = join(table.workspace, ".coc/modules", moduleId);
	mkdirSync(folder, { recursive: true });
	const opening = openings.length > 1
		? { opening_ready: false, start_scene: null, missing: [`start_scene_ambiguous:${openings.map((row) => row.node_id).join(",")}`],
			choice: { field: "start_scene", reason: "start_scene_ambiguous", candidates: openings, method: "module.opening.choose" } }
		: { opening_ready: true, start_scene: openings[0].node_id, missing: [] };
	writeFileSync(join(folder, "module.json"), JSON.stringify({ id: moduleId, source: "pdf", opening }));
	writeFileSync(join(folder, "module-graph.json"), JSON.stringify({ nodes: [
		{ node_id: `module-${moduleId}`, node_kind: "module", name: "A book", summary: "A book with a way in." },
		...openings.map((row) => ({ node_id: row.node_id, node_kind: "scene", name: row.name, summary: row.summary }))], relations: [] }));
}

/**
 * The guidance author and reviewer: the author's packet names the opening it was asked to write for,
 * and every packet is kept so a case can read which one that was.
 */
function withGuidanceReader(table, packets) {
	const current = table.runtimeBridges().at(-1);
	table.emit("coc:kernel-bridge", { ...current, runtime: { ...current.runtime, async runTask(task) {
		const review = task.request.systemPrompt.endsWith("character-guidance-review.md");
		if (!review) packets.push(JSON.parse(readFileSync(join(task.request.cwd, "packet.json"), "utf8")));
		writeFileSync(join(task.request.cwd, review ? "review.json" : "guidance.json"), JSON.stringify(review
			? { approved: true, issues: [] }
			: { protocol: "setup-guidance-reference-v2", opening: "A letter arrives.", advice: "Choose a fitting investigator.", guide: null, handoff: "Continue." }));
		return { ok: true };
	} } });
}

const moduleEnv = (moduleId, openings) => ({ FAKE_KERNEL_MODULE: JSON.stringify({ module_id: moduleId, opening_candidates: openings }) });
const draftProfile = { name: { generated: "Helen" }, occupation: "journalist", age: 29, sex: "female", concept: "A cautious reporter.", own_language: "English" };

test("a choice made while its opening is still being read is recorded when it is made, rejoined without repeating it, and pinned by create-campaign (§14.19)", async (t) => {
	const gateDir = mkdtempSync(join(tmpdir(), "sl98-gate-")), gate = join(gateDir, "opening-reading");
	writeFileSync(gate, "");
	t.after(() => rmSync(gateDir, { recursive: true, force: true }));
	const table = await openTable({
		mode: "setup", campaign: null,
		env: { ...moduleEnv("two-door", OPENINGS), FAKE_KERNEL_READING_GATE: gate, PI_COC_READ_WAIT_MS: "400" },
		responses: [
			setupCall({ step: "choose-source", kind: "module", module: "two-door" }),
			setupCall({ step: "prepare-module" }),
			setupCall({ step: "prepare-module", start_scene: "tower" }),
			fauxAssistantMessage("The book is still being read."),
		],
	});
	t.after(() => table.dispose());
	installBook(table, "two-door", OPENINGS);
	const packets = [];
	withGuidanceReader(table, packets);

	await table.session.prompt("Let's play the book with two doors.");
	await waitForIdle(table.session);
	const [, asked, waited] = setupResults(table.session);
	assert.equal(asked.code, "needs_choice", JSON.stringify(asked));
	assert.deepEqual(asked.details.candidates, OPENINGS, "the candidates survive every projection to the guide");
	assert.equal(typeof asked.player_reason, "string", "the question carries the player's reason");
	assert.equal(waited.ok, false);
	assert.equal(waited.details.reason, "reading_timeout", `the opening read outlasted the wait: ${JSON.stringify(waited)}`);
	assert.deepEqual([waited.details.read.purpose, waited.details.read.focus], ["opening", "tower"]);

	// SL-100: the wait tells the player what is happening in their terms; the machine half stays the guide's.
	assert.equal(typeof waited.player_reason, "string");
	assert.ok(waited.player_reason.length > 0);
	for (const internal of [waited.details.job_id, "prepare-module", "module.prepare", "retain", "host"])
		assert.ok(!waited.player_reason.includes(internal), `the player's reason names no ${internal}: ${waited.player_reason}`);

	// Five minutes on, the guide rejoins without repeating the choice and the opening is still being read:
	// the wait is for the chosen opening, and the player hears roughly how long it has been.
	const realNow = Date.now.bind(Date);
	t.mock.method(Date, "now", () => realNow() + 5 * 60_000);
	table.faux.setResponses([setupCall({ step: "prepare-module" }), fauxAssistantMessage("Still reading.")]);
	await table.session.prompt("Is it ready?");
	await waitForIdle(table.session);
	const stillWaiting = setupResults(table.session).at(-1);
	assert.equal(stillWaiting.details?.reason, "reading_timeout", JSON.stringify(stillWaiting));
	assert.equal(stillWaiting.details.read.focus, "tower", "the rejoin waits on the opening the player chose, not a new question");
	assert.match(stillWaiting.player_reason, /about 5 minutes/, "measured from the call that first waited on this reading");

	// The reading lands; the guide rejoins once more, then creates the campaign.
	rmSync(gate);
	table.faux.setResponses([
		setupCall({ step: "prepare-module" }),
		setupCall({ step: "create-campaign", id: "two-door-table", title: "Two doors", play_language: "en" }),
		fauxAssistantMessage("Tell me who you are."),
	]);
	await table.session.prompt("OK, I'll wait.");
	await waitForIdle(table.session);
	const [rejoined, created] = setupResults(table.session).slice(4);
	assert.equal(rejoined.ok, true, `the rejoined preparation keeps the choice: ${JSON.stringify(rejoined)}`);
	const openingReads = table.kernelRequests().filter((row) => row.method === "module.read.request" && row.params.purpose === "opening");
	assert.equal(openingReads.at(-1).params.focus, "tower", "the rejoin reads the opening the player chose");
	assert.equal(created.ok, true, JSON.stringify(created));
	const create = table.kernelRequests().find((row) => row.method === "campaign.create");
	assert.equal(create.params.start_scene, "tower", "the campaign pins the recorded opening");
	assert.equal(created.character_guidance.scene, "The Tower");
	assert.deepEqual(packets.map((packet) => packet.opening), ["The Tower"], "guidance is written for the chosen opening");
});

test("create-campaign with no recorded opening on a two-opening book is a question with the candidates, not a failure, and records nothing (§14.19)", async (t) => {
	const table = await openTable({
		mode: "setup", campaign: null, env: moduleEnv("two-door", OPENINGS),
		responses: [
			setupCall({ step: "choose-source", kind: "module", module: "two-door" }),
			setupCall({ step: "prepare-module" }),
			setupCall({ step: "create-campaign", id: "two-door-table", title: "Two doors", play_language: "en" }),
			setupCall({ step: "prepare-module", start_scene: "dock" }),
			setupCall({ step: "create-campaign", id: "two-door-table", title: "Two doors", play_language: "en" }),
			fauxAssistantMessage("Who are you?"),
		],
	});
	t.after(() => table.dispose());
	installBook(table, "two-door", OPENINGS);
	const packets = [];
	withGuidanceReader(table, packets);
	// A preparation that finished without recording a choice: the Masks host's own state before this fix.
	const prepared = [];
	table.emit("coc:reading-bridge", { async prepare(params) { prepared.push(params); return { ok: true, module_id: "two-door", opening_ready: true }; } });

	await table.session.prompt("Let's play the book with two doors.");
	await waitForIdle(table.session);
	const [, , asked, chose, created] = setupResults(table.session);
	assert.equal(asked.ok, false);
	assert.equal(asked.code, "needs_choice", `a question, never preparation_failed: ${JSON.stringify(asked)}`);
	assert.deepEqual(asked.details.candidates, OPENINGS);
	assert.match(asked.fix, /prepare-module .*start_scene/, "the fix names the step that records the answer");
	assert.equal(typeof asked.player_reason, "string");
	assert.equal(chose.ok, true, `the step that records the choice is open again: ${JSON.stringify(chose)}`);
	assert.equal(prepared.at(-1).start_scene, "dock");
	assert.equal(created.ok, true, JSON.stringify(created));
	const creates = table.kernelRequests().filter((row) => row.method === "campaign.create");
	assert.equal(creates.length, 1, "no campaign was created before the opening was chosen");
	assert.equal(creates[0].params.start_scene, "dock");
	assert.deepEqual(packets.map((packet) => packet.opening), ["The Dock"]);
	assert.ok(!setupResults(table.session).some((row) => row.code === "setup_blocked" || row.cause === "preparation_failed"), "nothing blocked");
});

test("a campaign created without its opening: the block asks, keeps the guide's question on screen, and prepare-module records the choice and prepares guidance (§98 addendum 9)", async (t) => {
	// The Masks campaign as it was left: created, PDF source, no opening pinned, prepare-module not done.
	const resume = { completed: ["choose-source", "create-campaign"],
		state: { campaign: "legacy-masks", module_id: "two-door", module: "two-door", source: { kind: "pdf", module_id: "two-door" }, source_kind: "pdf", play_language: "en", start_scene: null } };
	const question = "This book can start at the dock or at the tower. Which one?";
	const prompts = [];
	const table = await openTable({
		mode: "setup", campaign: "legacy-masks", env: { ...moduleEnv("two-door", OPENINGS), FAKE_SETUP_RESUME: JSON.stringify(resume) },
		responses: [
			setupCall({ step: "create-investigator", profile: draftProfile }),
			(context) => { prompts.push(getCurrentSystemPrompt(context.messages)); return fauxAssistantMessage(question); },
		],
	});
	t.after(() => table.dispose());
	installBook(table, "two-door", OPENINGS);
	const packets = [];
	withGuidanceReader(table, packets);

	await table.session.prompt("I want to make my character.");
	await waitForIdle(table.session);
	const refused = setupResults(table.session).at(-1);
	assert.equal(refused.code, "setup_blocked");
	assert.equal(refused.cause, "needs_choice", `the cause is the missing opening, not a failed preparation: ${JSON.stringify(refused)}`);
	assert.deepEqual(refused.details.candidates, OPENINGS, "the block carries the candidates");
	assert.match(refused.error, /prepare-module with that candidate's scene as start_scene/);
	assert.equal(typeof refused.player_reason, "string", "SL-100: the refusal carries the player's reason");
	assert.ok(!refused.player_reason.includes("setup_blocked") && !refused.player_reason.includes("needs_choice"));
	assert.ok(prompts[0].includes("more than one opening") && prompts[0].includes("The Tower"), "the guide is told to ask, with the openings");
	assert.deepEqual(lastAssistantTextBlocks(table.session), [question], "the guide's question is not suppressed as invented prose");
	assert.deepEqual(table.ui.notifications.filter((row) => row.type === "error"), [], "a question is not announced as a failure");
	assert.deepEqual(packets, [], "no guidance attempt ran on a missing choice");

	table.faux.setResponses([
		setupCall({ step: "prepare-module", start_scene: "the cellar" }),
		setupCall({ step: "prepare-module", start_scene: "tower" }),
		setupCall({ step: "create-investigator", profile: draftProfile }),
		fauxAssistantMessage("Here is Helen."),
	]);
	await table.session.prompt("The tower.");
	await waitForIdle(table.session);
	const [misnamed, chose, drafted] = setupResults(table.session).slice(1);
	assert.equal(misnamed.code, "needs_choice", `a scene the book does not offer is asked again: ${JSON.stringify(misnamed)}`);
	assert.equal(misnamed.failed_on, "module.opening.choose");
	assert.deepEqual(misnamed.details.candidates, OPENINGS);
	assert.equal(typeof misnamed.player_reason, "string");
	assert.equal(chose.ok, true, `the block does not block its own remedy: ${JSON.stringify(chose)}`);
	const pinned = table.kernelRequests().filter((row) => row.method === "module.opening.choose").at(-1);
	assert.deepEqual(pinned && [pinned.params.module_id, pinned.params.scene, pinned.params.campaign], ["two-door", "tower", "legacy-masks"],
		"the choice is recorded on this campaign's own module scope");
	assert.equal(chose.character_guidance?.scene, "The Tower", "the preparation is retried in the same call");
	assert.ok(chose.opening_shown, "and the accepted opening is shown");
	assert.deepEqual(packets.map((packet) => packet.opening), ["The Tower"]);
	const prologue = table.kernelRequests().find((row) => row.method === "setup.prologue");
	assert.equal(prologue.params.scene, "The Tower");
	assert.equal(drafted.ok, true, `card steps open once the cause is cleared: ${JSON.stringify(drafted)}`);
});

test("a single-opening book is unchanged: no question, no pin, create-campaign carries no opening (§14.19)", async (t) => {
	const only = [OPENINGS[0]];
	const table = await openTable({
		mode: "setup", campaign: null, env: moduleEnv("one-door", only),
		responses: [
			setupCall({ step: "choose-source", kind: "module", module: "one-door" }),
			setupCall({ step: "prepare-module" }),
			setupCall({ step: "create-campaign", id: "one-door-table", title: "One door", play_language: "en" }),
			fauxAssistantMessage("Who are you?"),
		],
	});
	t.after(() => table.dispose());
	installBook(table, "one-door", only);
	const packets = [];
	withGuidanceReader(table, packets);

	await table.session.prompt("Let's play.");
	await waitForIdle(table.session);
	const results = setupResults(table.session);
	assert.deepEqual(results.map((row) => row.ok), [true, true, true], JSON.stringify(results));
	assert.ok(!results.some((row) => row.code === "needs_choice" || row.player_reason), "nothing to ask and nothing to explain");
	const create = table.kernelRequests().find((row) => row.method === "campaign.create");
	assert.equal(create.params.start_scene, undefined, "no opening was chosen, so none is carried");
	assert.ok(!table.kernelRequests().some((row) => row.method === "module.opening.choose"));
	assert.deepEqual(packets.map((packet) => packet.opening), ["The Dock"], "guidance takes the book's one opening");
});

/** One cold kernel process over the workspace: each request in order, every one must succeed. */
function coldKernel(workspace, requests) {
	const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
	const input = requests.map(([method, params], index) => JSON.stringify({ id: String(index), method, params })).join("\n");
	const run = spawnSync(process.execPath, [join(repo, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(repo, "content")],
		{ cwd: repo, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`cold ${requests[Number(frame.id)][0]} failed: ${JSON.stringify(frame.error)}`);
	return frames.map((frame) => frame.result);
}

test("the Haunting starter is unchanged on the real kernel: no opening question, the kernel pins its authored opening (§14.19)", async (t) => {
	const table = await openTable({
		mode: "setup", campaign: null, realKernel: true, seedCampaign: false,
		responses: [
			setupCall({ step: "choose-source", kind: "starter", module: "the-haunting" }),
			setupCall({ step: "create-campaign", id: "haunting-unchanged", title: "A haunted house", play_language: "en" }),
			fauxAssistantMessage("Who are you?"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("I want to play the haunted house.");
	await waitForIdle(table.session);
	assert.deepEqual(table.extensionErrors, []);
	const results = setupResults(table.session);
	assert.deepEqual(results.map((row) => row.ok), [true, true], JSON.stringify(results));
	assert.ok(results[1].character_guidance?.opening, "the starter's bundled opening is delivered as before");
	assert.ok(!results.some((row) => row.code === "needs_choice" || row.player_reason));
	const [{ state }] = coldKernel(table.workspace, [["setup.steps", { campaign: "haunting-unchanged" }]]);
	assert.equal(typeof state.start_scene, "string", "the kernel pinned the starter's own opening");
	assert.equal(state.prologue.opening, results[1].character_guidance.opening, "the shown prologue is recorded against it");
});
