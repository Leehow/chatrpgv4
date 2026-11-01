/**
 * Who chooses the opening of a book with several (contract §14.19.10, live7 1101).
 *
 * Live7 du-1101a-gksevr, du-1101b-mmsev, cs-1101b-gksev and cs-1101b-mmsev: `create-campaign` answered `needs_choice`
 * and, in that same turn and before the player had read the question, the guide called `prepare-module {start_scene:
 * <second candidate>}` and `create-campaign`, which both succeeded. The player's answer one turn later ("the first
 * opening") was refused because both steps were "already done and not redone". Every case drives the real `setup` tool
 * through the onboarding extension over the fake kernel; the preparation is a stub reading bridge, as in
 * setup-opening-choice.test.mjs, so what is asserted is the host's authority over the choice.
 */

import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";
import { createSetupEngine } from "../../runtime/jev/setup-engine.ts";
import { SETUP_ROUTE_FAMILY } from "../../runtime/jev/setup-decisions.ts";

const setupCall = (params) => fauxAssistantMessage([fauxToolCall("setup", params)], { stopReason: "toolUse" });

function setupResults(session) {
	return session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === "setup")
		.map((message) => JSON.parse((message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("")));
}

const OPENINGS = [
	{ node_id: "scene-dock", scene: "dock", name: "The Dock", summary: "Investigators meet a courier at the harbour in 1921." },
	{ node_id: "scene-tower", scene: "tower", name: "The Tower", summary: "A telegram calls the investigators to a tower in 1925." },
];
const NUMBERED = OPENINGS.map((row, index) => ({ ...row, ordinal: index + 1 }));
const CREATE = { step: "create-campaign", id: "two-door-table", title: "Two doors", play_language: "en" };

function installBook(table, moduleId, openings) {
	const folder = join(table.workspace, ".coc/modules", moduleId);
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, "module.json"), JSON.stringify({ id: moduleId, source: "pdf", opening: { opening_ready: false, start_scene: null,
		missing: [`start_scene_ambiguous:${openings.map((row) => row.node_id).join(",")}`],
		choice: { field: "start_scene", reason: "start_scene_ambiguous", candidates: openings, method: "module.opening.choose" } } }));
	writeFileSync(join(folder, "module-graph.json"), JSON.stringify({ nodes: [
		{ node_id: `module-${moduleId}`, node_kind: "module", name: "A book", summary: "A book with a way in." },
		...openings.map((row) => ({ node_id: row.node_id, node_kind: "scene", name: row.name, summary: row.summary }))], relations: [] }));
}

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

/** A two-opening book whose preparation finishes at once; `prepared` keeps every preparation's parameters. */
async function twoDoorTable(t, { responses, campaign = null, env = {}, ...options }) {
	const table = await openTable({ mode: "setup", campaign, env: { FAKE_KERNEL_MODULE: JSON.stringify({ module_id: "two-door", opening_candidates: OPENINGS }), ...env },
		responses, ...options });
	t.after(() => table.dispose());
	installBook(table, "two-door", OPENINGS);
	const packets = [], prepared = [];
	withGuidanceReader(table, packets);
	table.emit("coc:reading-bridge", { async prepare(params) { prepared.push(params); return { ok: true, module_id: "two-door", opening_ready: true }; } });
	return { table, packets, prepared, creates: () => table.kernelRequests().filter((row) => row.method === "campaign.create") };
}

/** The live sequence's first turn: the question, then the guide choosing the second opening for the player. */
const ASKING_TURN = [
	setupCall({ step: "choose-source", kind: "module", module: "two-door" }),
	setupCall({ step: "prepare-module" }),
	setupCall(CREATE),
	setupCall({ step: "prepare-module", start_scene: "tower" }),
	setupCall(CREATE),
	setupCall({ step: "prepare-module", start_scene: "tower", retry: true }),
	setupCall({ step: "prepare-module", start_scene: "tower" }),
	fauxAssistantMessage("Which opening: 1. The Dock or 2. The Tower?"),
];

function assertAskingTurn(run) {
	const [, , asked, selfChosen, stillAsked, ...repeats] = setupResults(run.table.session);
	assert.equal(asked.code, "needs_choice", JSON.stringify(asked));
	assert.deepEqual(asked.details.candidates, NUMBERED, "every candidate carries the ordinal it is offered at");
	assert.equal(selfChosen.ok, false);
	assert.equal(selfChosen.code, "opening_not_chosen_by_player", `the guide's own pick in the asking turn is refused: ${JSON.stringify(selfChosen)}`);
	assert.equal(selfChosen.details.reason, "no_player_reply_since_question");
	assert.equal(selfChosen.details.given, "tower");
	assert.deepEqual(selfChosen.details.candidates, NUMBERED);
	assert.match(selfChosen.fix, /ask the player which opening/);
	assert.equal(typeof selfChosen.player_reason, "string");
	assert.equal(stillAsked.code, "needs_choice", "nothing was recorded, so create-campaign still asks");
	for (const repeat of repeats) assert.equal(repeat.code, "opening_not_chosen_by_player", `a repeat is refused the same way, never "already done": ${JSON.stringify(repeat)}`);
	assert.ok(!setupResults(run.table.session).some((row) => row.code === "setup_blocked"), "repeating the refused call does not block setup");
	assert.equal(run.creates().length, 0, "no campaign was created on the guide's pick");
	assert.ok(!run.prepared.some((row) => row.start_scene), "no opening was prepared on the guide's pick");
}

test("live7 1101: a start_scene the guide sends in the turn that asked is refused, and the player's 'first' answer prepares and creates the first opening (§14.19.10)", async (t) => {
	const run = await twoDoorTable(t, { responses: ASKING_TURN });
	await run.table.session.prompt("Let's play the book with two doors.");
	await waitForIdle(run.table.session);
	assertAskingTurn(run);

	// The player answers by position; the guide maps "the first" to the candidate with ordinal 1 and passes its scene.
	run.table.faux.setResponses([setupCall({ step: "prepare-module", start_scene: NUMBERED.find((row) => row.ordinal === 1).scene }), setupCall(CREATE),
		fauxAssistantMessage("Who are you?")]);
	await run.table.session.prompt("The first opening.");
	await waitForIdle(run.table.session);
	const [chose, created] = setupResults(run.table.session).slice(-2);
	assert.equal(chose.ok, true, JSON.stringify(chose));
	assert.equal(run.prepared.at(-1).start_scene, "dock");
	assert.equal(created.ok, true, JSON.stringify(created));
	assert.deepEqual(run.creates().map((row) => row.params.start_scene), ["dock"], "the campaign is created once, on the player's opening");
	assert.deepEqual(run.packets.map((packet) => packet.opening), ["The Dock"]);
});

test("live7 1101 on the driven engine: the player's 'first' answer goes through Jev's pick_opening o0 and the host prepares and creates the first opening (§14.19.10)", async (t) => {
	const batches = [];
	// Jev answers only the route: the opening by its index when one is offered, otherwise the input is the Keeper's.
	const decide = async (batch) => {
		batches.push(batch);
		const answers = {};
		for (const question of batch.questions) {
			if (question.type === "noul") answers[question.key] = { status: "answered", type: "noul", noul: question.key === "move_pick_opening" ? 0.97 : 0.03 };
			else {
				const choice = question.key === "opening" ? "o0" : question.key === "exit" ? (batch.questions.some((row) => row.key === "opening") ? "continue" : "ask_llm") : "none";
				answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.97, probabilities: { [choice]: 0.97 } };
			}
		}
		return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
	};
	const engine = createSetupEngine({ env: process.env, decision: { decide } });
	const run = await twoDoorTable(t, { campaign: "two-door-table", responses: ASKING_TURN,
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", EXT_JEV_APIKEY: undefined, TYPESAFE_API_KEY: undefined },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-setup-engine", factory: engine.extension }] });
	await run.table.session.prompt("Let's play the book with two doors.");
	await waitForIdle(run.table.session);
	assertAskingTurn(run);

	run.table.faux.setResponses([fauxAssistantMessage("Who are you?")]);
	await run.table.session.prompt("The first opening.");
	await waitForIdle(run.table.session);
	const route = batches.filter((batch) => batch.family === SETUP_ROUTE_FAMILY).at(-1);
	assert.deepEqual(route.state.openings.map((row) => [row.key, row.name]), [["o0", "The Dock"], ["o1", "The Tower"]], "Jev is offered the openings in their ordinal order");
	assert.equal(run.prepared.at(-1).start_scene, "dock", "o0 is the first candidate, resolved by index on the host");
	assert.deepEqual(run.creates().map((row) => row.params.start_scene), ["dock"], "the host creates the campaign on the player's opening");
});

test("§14.19.10 correction: before the campaign exists, a later answer naming the other opening re-prepares it instead of 'already done'", async (t) => {
	const run = await twoDoorTable(t, { responses: [
		setupCall({ step: "choose-source", kind: "module", module: "two-door" }),
		setupCall({ step: "prepare-module" }),
		setupCall(CREATE),
		fauxAssistantMessage("Which opening: 1. The Dock or 2. The Tower?"),
	] });
	await run.table.session.prompt("Let's play the book with two doors.");
	await waitForIdle(run.table.session);
	run.table.faux.setResponses([setupCall({ step: "prepare-module", start_scene: "tower" }), fauxAssistantMessage("The tower it is. Shall I set it up?")]);
	await run.table.session.prompt("The second one.");
	await waitForIdle(run.table.session);
	assert.equal(setupResults(run.table.session).at(-1).ok, true);

	run.table.faux.setResponses([
		setupCall({ step: "prepare-module", start_scene: "scene-dock" }),
		setupCall({ step: "prepare-module", start_scene: "dock" }),
		setupCall(CREATE),
		fauxAssistantMessage("Who are you?"),
	]);
	await run.table.session.prompt("Actually, the dock instead.");
	await waitForIdle(run.table.session);
	const [rechose, same, created] = setupResults(run.table.session).slice(-3);
	assert.equal(rechose.ok, true, `the different choice re-prepares: ${JSON.stringify(rechose)}`);
	assert.equal(run.prepared.at(-1).start_scene, "scene-dock");
	assert.equal(same.ok, false, "the same opening again, by its other spelling, is still done once");
	assert.match(String(same.rejected), /already done/);
	assert.equal(created.ok, true, JSON.stringify(created));
	assert.deepEqual(run.creates().map((row) => row.params.start_scene), ["scene-dock"], "the campaign is created on the corrected opening");
	assert.deepEqual(run.packets.map((packet) => packet.opening), ["The Dock"], "guidance is written only for the opening the campaign binds");
});

test("§14.19.10: once the campaign exists on the chosen opening, a different later choice is refused with the reason, not 'already done'", async (t) => {
	const run = await twoDoorTable(t, { responses: [
		setupCall({ step: "choose-source", kind: "module", module: "two-door" }),
		setupCall({ step: "prepare-module" }),
		setupCall(CREATE),
		fauxAssistantMessage("Which opening: 1. The Dock or 2. The Tower?"),
	] });
	await run.table.session.prompt("Let's play the book with two doors.");
	await waitForIdle(run.table.session);
	run.table.faux.setResponses([setupCall({ step: "prepare-module", start_scene: "tower" }), setupCall(CREATE), fauxAssistantMessage("Who are you?")]);
	await run.table.session.prompt("The tower.");
	await waitForIdle(run.table.session);
	assert.equal(setupResults(run.table.session).at(-1).ok, true);

	run.table.faux.setResponses([setupCall({ step: "prepare-module", start_scene: "dock" }), fauxAssistantMessage("This table begins at the tower.")]);
	await run.table.session.prompt("Hmm, can we start at the dock instead?");
	await waitForIdle(run.table.session);
	const refused = setupResults(run.table.session).at(-1);
	assert.equal(refused.code, "opening_already_bound", JSON.stringify(refused));
	assert.equal(refused.details.bound, "tower");
	assert.equal(refused.details.given, "dock");
	assert.equal(typeof refused.player_reason, "string", "the player is told why in their terms");
	assert.equal(run.creates().length, 1);
	assert.ok(!run.table.kernelRequests().some((row) => row.method === "module.opening.choose"), "nothing re-pins the bound campaign");
});

test("§14.19.10: the turn-start question tells the guide to stop in the asking turn and to take the answer in a later one", async (t) => {
	const resume = { completed: ["choose-source", "create-campaign"],
		state: { campaign: "legacy-two", module_id: "two-door", module: "two-door", source: { kind: "pdf", module_id: "two-door" }, source_kind: "pdf", play_language: "en", start_scene: null } };
	const prompts = [];
	const capture = (text) => (context) => { prompts.push(getCurrentSystemPrompt(context.messages)); return fauxAssistantMessage(text); };
	const run = await twoDoorTable(t, { campaign: "legacy-two", env: { FAKE_SETUP_RESUME: JSON.stringify(resume) },
		responses: [setupCall({ step: "prepare-module", start_scene: "tower" }), capture("Which opening?")] });
	await run.table.session.prompt("I want to make my character.");
	await waitForIdle(run.table.session);
	assert.equal(setupResults(run.table.session).at(-1).code, "opening_not_chosen_by_player");
	assert.match(prompts[0], /end your reply there/);
	assert.ok(prompts[0].includes(JSON.stringify(NUMBERED)), "the turn-start list carries the ordinals");

	run.table.faux.setResponses([(context) => { prompts.push(getCurrentSystemPrompt(context.messages)); return setupCall({ step: "prepare-module", start_scene: "dock" }); }, fauxAssistantMessage("The dock.")]);
	await run.table.session.prompt("The first.");
	await waitForIdle(run.table.session);
	assert.match(prompts.at(-1), /If their message answers it/);
	const chose = setupResults(run.table.session).at(-1);
	assert.equal(chose.ok, true, JSON.stringify(chose));
	const pinned = run.table.kernelRequests().filter((row) => row.method === "module.opening.choose").at(-1);
	assert.deepEqual([pinned.params.scene, pinned.params.campaign], ["dock", "legacy-two"]);
});

test("§14.19.10 restart: a setup reopened on the same session takes back when its openings were asked, so the player's answer is not the asking turn", async (t) => {
	const resume = { completed: ["choose-source", "create-campaign"],
		state: { campaign: "legacy-two", module_id: "two-door", module: "two-door", source: { kind: "pdf", module_id: "two-door" }, source_kind: "pdf", play_language: "en", start_scene: null } };
	const env = { FAKE_SETUP_RESUME: JSON.stringify(resume) };
	const first = await twoDoorTable(t, { campaign: "legacy-two", env, responses: [fauxAssistantMessage("Which opening: 1. The Dock or 2. The Tower?")] });
	await first.table.session.prompt("I want to make my character.");
	await waitForIdle(first.table.session);
	const asked = first.table.entries("coc-setup-opening-asked");
	assert.deepEqual(asked, [{ ordinal: 1, offered: ["scene-dock", "scene-tower"] }], "the asking turn is recorded in the session");
	const carried = [...first.table.entries("coc-setup-input-epoch").map((data) => ({ customType: "coc-setup-input-epoch", data })),
		...asked.map((data) => ({ customType: "coc-setup-opening-asked", data }))];

	const answer = [setupCall({ step: "prepare-module", start_scene: "dock" }), fauxAssistantMessage("The dock.")];
	const resumed = await twoDoorTable(t, { campaign: "legacy-two", env, priorEntries: carried, responses: answer });
	await resumed.table.session.prompt("The first.");
	await waitForIdle(resumed.table.session);
	const chose = setupResults(resumed.table.session).at(-1);
	assert.equal(chose.ok, true, `the answer after a restart is taken: ${JSON.stringify(chose)}`);
	const pinned = resumed.table.kernelRequests().filter((row) => row.method === "module.opening.choose").at(-1);
	assert.deepEqual([pinned.params.scene, pinned.params.campaign], ["dock", "legacy-two"]);

	// Without the session's record the same answer would be read as the asking turn: the edge this closes.
	const cold = await twoDoorTable(t, { campaign: "legacy-two", env, responses: answer });
	await cold.table.session.prompt("The first.");
	await waitForIdle(cold.table.session);
	assert.equal(setupResults(cold.table.session).at(-1).code, "opening_not_chosen_by_player");
});
