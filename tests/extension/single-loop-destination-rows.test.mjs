/**
 * SL-25 (spec pi-native-single-loop, Ruling "A place the kernel offers must be recognisable from what the player says";
 * contract §135.30.4).
 *
 * - Rows (pure): a destination row is the place as the player can name it -- the table's label, else the book's name,
 *   with the book's other names, summary, where-words, people and things the kernel's move row carries; a move the
 *   kernel holds back carries its guard beside the words, never in them, and nothing of the guard reaches Jev.
 * - The guarded report (pure, the policy seam): `destination` cleared on a held-back row reports `guarded: [{to, place,
 *   guard}]` on the compile outcome and the policy's compile step; below the gate, on `none`, or on an issued move it
 *   does not.
 * - On the emitted kernel over the haunting (the vendored driver, the faux Keeper, a stub Jev): the player heads for the
 *   Corbitt House before Knott has handed over the keys; the compile row carries the guard -- the keys clue in the book's
 *   own words and the office's cue -- and the Keeper's `coc-clerk` note carries the same entry once.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { buildCandidates } from "../../runtime/jev/candidates.ts";
import { compileRows } from "../../runtime/jev/compile-rows.ts";
import { COMPILE_FAMILY, NONE, compileBatch, guardedDestinations, interpretCompile } from "../../runtime/jev/route-compile.ts";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { initialView, next, settleCompile, startStep } from "../../runtime/jev/step-policy.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "test-camp";
const scope = { owner: "campaign:test", campaign: "test", worldline: "main", loop: 0, audience: "keeper" };
const context = { scene: "street", clock: null, present: [], receipts: [] };
const INPUT = "I go down to the cellar with my torch";

/** The kernel's words for the cellar's guard: the condition, and the clue as the book states it. */
const CELLAR_GUARD = { condition: "clue_discovered: diaries", clue: { clue: "diaries", says: "Three bound diaries of W. Corbitt.",
	found_at: [{ scene: "house", display_name: "The House", cues: ["Pry open the nailed-shut cupboard."] }] } };
/** At the house: the upstairs is open, the cellar held by an unmet unlock, the garden by an open obligation. */
function house() {
	return {
		capsule: { where: { scene: "house" }, present: [], known: { investigator: { name: "Hayes" } } },
		applyOptions: {
			obligations: [{ handle: "gate", name: "Leave to enter the garden", state: "open" }],
			candidates: [
				{ effect: { kind: "move", to: "upstairs" }, description: { kind: "move", to: "upstairs", display_name: "Corbitt House upper floor",
					unlock_when: { condition: "clue_discovered: noise", met: true },
					destination: { names: ["the upper story"], where: ["upstairs", "bedroom"], things: ["a bed"] } } },
				{ effect: { kind: "move", to: "cellar" }, description: { kind: "move", to: "cellar", display_name: "Corbitt House basement",
					unlock_when: { ...CELLAR_GUARD, met: false }, destination: { where: ["basement", "cellar"], people: ["the rats"] } } },
				{ effect: { kind: "move", to: "garden" }, description: { kind: "move", to: "garden" }, guarded_by: "gate" },
				{ effect: { kind: "clue", clue: "noise" }, description: { summary: "Thumps upstairs." } }],
			context: {} },
		resolveOptions: { profiles: [{ actor: "Hayes", skill: "Spot Hidden", value: 60, availability: "bound" }], decisions: [] },
	};
}
const built = (reads) => ({ candidates: buildCandidates(reads, INPUT), rows: compileRows(reads) });
const answer = (choices) => ({ batchId: "b", status: "complete", issues: [], coverage: { required: [], answered: [], unknown: [] },
	answers: Object.fromEntries(Object.entries(choices).map(([key, [choice, confidence, probabilities]]) => [key,
		{ status: "answered", type: "choice", choice, confidence, probabilities: probabilities ?? { [choice]: confidence } }])) });
/** Ask the compile over the house and answer `destination` with the row `id` (or none) at `confidence`. */
function compileAt(id, confidence, probabilities) {
	const { candidates, rows } = built(house());
	const view = initialView({ runId: "r", rawInput: INPUT, context, candidates, rows, readFirst: false });
	const request = next(view);
	assert.deepEqual([request.kind, request.purpose], ["decide", "compile"]);
	const batch = compileBatch(view, scope, [], []);
	const choice = id === NONE ? NONE : `destination_${rows.destination.findIndex((row) => row.id === id) + 1}`;
	const result = answer({ destination: [choice, confidence, probabilities] });
	return { view, rows, candidates, batch, result, row: settleCompile(view, startStep(view, request), batch, result, 5, 0.6) };
}

test("§135.30.4 rows: the place by its label with the kernel's words; a held-back move's guard beside the words and never before Jev", () => {
	const { rows, candidates } = built(house());
	assert.deepEqual(rows.destination.map((row) => row.id), ["upstairs", "cellar", "garden"], "every move row, a held-back one included");
	assert.deepEqual(rows.destination[0].describe, { place: "Corbitt House upper floor", handle: "upstairs", names: ["the upper story"],
		where: ["upstairs", "bedroom"], things: ["a bed"] }, "the label, the handle and the kernel's destination words");
	assert.equal(rows.destination[0].guard, undefined, "an issued move has no guard");
	assert.deepEqual(rows.destination[1].guard, CELLAR_GUARD, "the unmet unlock without `met`: the condition and the clue as the kernel states it");
	assert.deepEqual(rows.destination[2].describe, { place: "garden" }, "no label: the handle is the place");
	assert.deepEqual(rows.destination[2].guard, { obligation: "gate", demand: "Leave to enter the garden" }, "the obligation the row is guarded by, by its demand");
	assert.deepEqual(candidates.filter((candidate) => candidate.family === "move").map((candidate) => candidate.bound.to), ["upstairs"],
		"the builder still issues only the open move");
	const batch = compileBatch(initialView({ runId: "r", rawInput: INPUT, context, candidates, rows }), scope, [], []);
	const destination = batch.questions.find((question) => question.key === "destination");
	assert.deepEqual(destination.criteria.destination_2, { place: "Corbitt House basement", handle: "cellar", where: ["basement", "cellar"], people: ["the rats"] });
	assert.deepEqual(destination.criteria.destination_3, { place: "garden" }, "the obligation's guard is not in the destination's words");
	const sent = JSON.stringify(batch);
	for (const word of ["diaries", "nailed-shut", "clue_discovered", "guard"]) assert.ok(!sent.includes(word), `${word}: the unlock guard never reaches Jev`);
});

test("§135.30.4 guarded: the destination cleared on a held-back row is reported with the kernel's guard; nothing is selected or consumed for it", () => {
	const { view, row } = compileAt("cellar", 0.96);
	assert.deepEqual(row.detail.guarded, [{ to: "cellar", place: "Corbitt House basement", guard: CELLAR_GUARD }]);
	assert.deepEqual(row.detail.selected, [], "the held-back move is never a candidate");
	assert.deepEqual(row.detail.decided, ["apply:move:upstairs"], "the open exit was decided, as before");
	assert.ok(!view.consumed.some((key) => key.includes("cellar")), "nothing consumed for the cellar");
	assert.deepEqual(compileAt("garden", 0.9).row.detail.guarded, [{ to: "garden", place: "garden", guard: { obligation: "gate", demand: "Leave to enter the garden" } }]);
});

test("§135.30.4 guarded: not below the gate, not on none, not on an issued move", () => {
	assert.equal(compileAt("cellar", 0.5, { destination_2: 0.5, destination_1: 0.4, none: 0.1 }).row.detail.guarded, undefined, "below the gate and the margin");
	assert.equal(compileAt(NONE, 0.95).row.detail.guarded, undefined);
	const opened = compileAt("upstairs", 0.9);
	assert.equal(opened.row.detail.guarded, undefined);
	assert.deepEqual(opened.row.detail.selected, ["apply:move:upstairs"]);
	// The pure reader: a cleared row with a guard is not reported while an issued move goes there.
	const { rows, candidates } = built(house());
	const issued = [...candidates, { key: "apply:move:cellar", family: "move", bound: { kind: "move", to: "cellar" }, unbound: [] }];
	assert.deepEqual(guardedDestinations(rows, issued, { destination: { row: "cellar", confidence: 0.9, distribution: null } }), []);
	assert.deepEqual(interpretCompile({ candidates, rows }, { status: "failed", failure: { code: "x" } }, 0.6).guarded, undefined, "no answer, no report");
});

// ---------------------------------------------------------------------------------------------------
// On the emitted kernel over the haunting.
// ---------------------------------------------------------------------------------------------------

function kernelSteps(workspace, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign: CAMPAIGN, ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
	return frames.map((frame) => frame.result);
}
/** Knott has named the research leads (the research exits open) and not yet handed over the keys (the house is held). */
const leadsNoKeys = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "我听着" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "clue", clue: "knott-research-leads", how: "he said so" }] }],
	["table.narrate", { call_id: "t1-c2", text: "他递给你一张写着地方的纸。" }],
]);
const clerkNotes = (context) => context.messages.flatMap((message) => {
	const text = typeof message.content === "string" ? message.content : (message.content ?? []).map((block) => block.text ?? "").join("");
	const start = text.indexOf('{"kind":"single_loop_step"');
	return start < 0 ? [] : [JSON.parse(text.slice(start, text.lastIndexOf("}") + 1))];
});

test("§135.30.4 on the emitted kernel: heading for the house before the keys, the compile row and the Keeper's note carry the keys clue in the book's words", async (t) => {
	const decisions = [], requests = [], rows = [];
	const graph = JSON.parse(readFileSync(join(REPO, "content/starters/the-haunting/module-graph.json"), "utf8"));
	const node = (id) => graph.nodes.find((entry) => entry.node_id === id);
	const office = node("scene-commission-briefing").properties.runtime_projection.record;
	const keysCues = office.affordances.filter((aff) => aff.clue_id === "clue-knott-keys").map((aff) => aff.cue);
	const engine = createHybridEngine({ env: process.env, record: (row) => rows.push(row), decision: { decide: async (batch) => {
		decisions.push(batch);
		// The compile: the destination is the row whose handle is the house; everything else unclear. The route: finish.
		const pick = (question) => batch.family === COMPILE_FAMILY
			? (question.key === "destination" ? Object.entries(question.criteria).find(([, words]) => words?.handle === "corbitt-house-ground")?.[0] : "unclear")
			: question.key === "exit" ? "finish" : Object.keys(question.criteria)[0] === "now" ? "later" : "unknown";
		const answers = Object.fromEntries(batch.questions.map((question) => { const choice = pick(question);
			return [question.key, { status: "answered", type: "choice", choice, confidence: 0.95, probabilities: { [choice]: 0.95 } }]; }));
		return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
	} } });
	const table = await openTable({ realKernel: true, prepareWorkspace: leadsNoKeys, env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		// Two model steps (a look, then the prose), so a note repeated on the second step would show.
		responses: [(context) => { requests.push(context); return fauxAssistantMessage([fauxToolCall("look", { focus: "scene" })], { stopReason: "toolUse" }); },
			(context) => { requests.push(context); return fauxAssistantMessage([fauxToolCall("narrate", { text: "门锁着，钥匙还在诺特那里。" })], { stopReason: "toolUse" }); }] });
	t.after(() => table.dispose());
	await table.session.prompt("我去科比特宅。");

	const destination = decisions.find((batch) => batch.family === COMPILE_FAMILY)?.questions.find((question) => question.key === "destination");
	assert.ok(destination, "the compile was asked (the research exits are reachable)");
	const house = Object.values(destination.criteria).find((words) => words?.handle === "corbitt-house-ground");
	assert.equal(house.place, "The Corbitt House", "the house by the name the book gives it, not its file name");
	const guard = { condition: "clue_discovered: knott-keys", clue: { clue: "knott-keys", says: node("clue-knott-keys").summary,
		found_at: [{ scene: "commission-briefing", display_name: "Knott's Office", cues: keysCues }] } };
	assert.ok(keysCues.length, "the book grants the keys at the office");
	const compiled = rows.find((row) => row.lane === "route" && row.purpose === "compile");
	assert.deepEqual(compiled.guarded, [{ to: "corbitt-house-ground", place: "The Corbitt House", guard }], "the compile row reports the guard");
	assert.deepEqual(compiled.selected, []);
	assert.equal(requests.length, 2, "two model steps");
	// A note is one message: the second request carries the first one again in its history; count distinct notes.
	const notes = [...new Map(requests.flatMap(clerkNotes).filter((note) => note.guarded).map((note) => [JSON.stringify(note), note])).values()];
	assert.equal(notes.length, 1, "the Keeper is told once");
	assert.ok(clerkNotes(requests[0]).some((note) => note.guarded), "before the first model step");
	assert.deepEqual(notes[0].guarded, compiled.guarded, "the note carries the kernel's guard, not a sentence of the host's");
	assert.match(notes[0].guarded_note, /closed by the book's own condition/);
});
