/**
 * SL-13, typed-feature routing (contract §135.30; the spec's ruling "Routing asks what the player does, never whether a
 * candidate is due").
 *
 * - Rows (pure): every option of every feature is a kernel row the read carried, plus `none` and `unclear`; a family
 *   with no rows is not asked; nothing the rows do not carry is ever an option.
 * - Predicates (pure, stub answers on the policy seam): each fires only on a cleared row -- never below the gate, never
 *   on `unclear`, never on an option the question did not offer -- and a decided candidate is the Keeper's for the run
 *   while an undecided one reaches the route's `need` question.
 * - Replacement (vendored driver, stub ports): a compile that selects replaces the first route question, so the run's Jev
 *   calls equal the SL-12 policy's.
 * - Engine (hybrid engine, stub Jev and kernel): the `lane: "route"`, `purpose: "compile"` row names every feature's
 *   distribution and the predicates that fired; the selected step carries `basis.compile`.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRealCampaign } from "./harness.mjs";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { runDriver } from "./pi-agent-core.mjs";
import { fanAsk } from "./compile-ask.mjs";
import { buildCandidates } from "../../runtime/jev/candidates.ts";
import { compileRows } from "../../runtime/jev/compile-rows.ts";
import { COMPILE_FAMILY, NONE, UNCLEAR, compileBatch, compileOnly, compileReaches, interpretCompile, predicateOf } from "../../runtime/jev/route-compile.ts";
import { bindRecords, createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { ROUTE_FAMILY, compileDue, createStepPolicy, initialView, interpretRoute, next, routeBatch, settleCompile, settleExecute, settleInfer, settleRead, settleRoute, startStep } from "../../runtime/jev/step-policy.ts";

const scope = { owner: "campaign:test", campaign: "test", worldline: "main", loop: 0, audience: "keeper" };
const context = { scene: "office", clock: null, present: ["史蒂文·诺特"], receipts: [] };
const INPUT = "I take the job and go to the Globe's morgue first";

/** The office: two exits, the employer present, a clue, a handout, a carried notebook. No fight. */
function office({ items = true } = {}) {
	return {
		capsule: { where: { scene: "office", assets: [{ name: "The Letter", kind: "handout" }] },
			present: [{ name: "Steven Knott", role: "employer", called: { name: "史蒂文·诺特" } }],
			known: { investigator: { id: "hayes", name: "Hayes" } },
			mods: { objects: { instances: items ? [{ name: "notebook", owner: "Hayes" }, { name: "ledger", owner: "Steven Knott" }] : [] } } },
		applyOptions: { candidates: [
			{ effect: { kind: "move", to: "morgue" }, description: { display_name: "The Globe offices" } },
			{ effect: { kind: "move", to: "library" }, description: { display_name: "Central Library" } },
			{ effect: { kind: "clue", clue: "keys" }, description: { summary: "Knott hands over the keys." } }],
		context: { present: ["Steven Knott"] } },
		resolveOptions: { profiles: [{ actor: "Hayes", skill: "Persuade", value: 70, availability: "bound" }], decisions: [] },
	};
}
/** The morgue after the meeting: the gate's check, the editor and the archivist present, one unguarded clue. */
function morgue() {
	const approaches = ["Persuade", "Intimidate"];
	return {
		capsule: { where: { scene: "morgue" }, present: [{ name: "Arty", role: "gatekeeper", called: { name: "the editor" } },
			{ name: "Ruth", role: "helpful_staff", untold: { label: "the filing woman" } }], known: { investigator: { name: "Hayes" } } },
		applyOptions: {
			obligations: [{ handle: "access", name: "Access to the clippings", who: "Arty", state: "open", trigger: { kind: "attempt", guards: { clues: ["story"] } },
				next: { kind: "check", target: "Arty", selection: "approach", approaches: approaches.map((skill) => ({ skill })), difficulty: "regular" } }],
			candidates: [{ effect: { kind: "clue", clue: "story" }, description: { summary: "the 1918 story" }, guarded_by: "access" },
				{ effect: { kind: "clue", clue: "cutoff" }, description: { summary: "The files stop at 1878." } }],
			context: { present: ["Arty", "Ruth"] } },
		resolveOptions: { profiles: approaches.map((skill) => ({ actor: "Hayes", skill, value: skill === "Persuade" ? 70 : 15, availability: "bound" })), decisions: [] },
	};
}
/** A fight on the investigator's turn: an attack with two targets and one weapon, and a dodge. */
function fight() {
	const session = { kind: "combat", status: "active", round: 1, turn_of: "Hayes",
		participants: [{ name: "Hayes", side: "investigator" }, { name: "Knott", side: "npc", label: "诺特" }, { name: "Wilmot", side: "npc", label: "the editor" }],
		actions: [{ decision: "combat:attack", actor: "Hayes", targets: ["Knott", "Wilmot"], weapons: ["unarmed"] }, { decision: "combat:dodge", actor: "Hayes" }] };
	return { capsule: { where: { scene: "office" }, present: [], known: { investigator: { name: "Hayes" } } },
		applyOptions: { candidates: [], context: {} }, resolveOptions: { profiles: [], decisions: [], context: { session } } };
}
const built = (reads) => ({ candidates: buildCandidates(reads, INPUT), rows: compileRows(reads) });

/** A complete Jev answer: `choices[key]` = [choice, confidence, probabilities?]; a single `ask` choice is fanned out (§135.30.9). */
const answer = (choices) => ({ batchId: "b", status: "complete", issues: [], coverage: { required: [], answered: [], unknown: [] },
	answers: fanAsk(Object.fromEntries(Object.entries(choices).map(([key, [choice, confidence, probabilities]]) => [key,
		{ status: "answered", type: "choice", choice, confidence, probabilities: probabilities ?? { [choice]: confidence } }]))) });
/** The alias the compile question gives a row, read from the question itself (never assumed); an `ask` row's is its own key. */
const alias = (batch, family, id, rows) => {
	if (family === "ask") return batch.questions.find((value) => value.key === `ask_${rows.ask.findIndex((row) => row.id === id) + 1}`)?.key;
	const question = batch.questions.find((value) => value.key === family);
	const index = rows[family].findIndex((row) => row.id === id);
	return Object.keys(question.criteria)[index];
};
const compileView = (reads, overrides = {}) => { const { candidates, rows } = built(reads);
	return initialView({ runId: "r", rawInput: INPUT, context, candidates, rows, readFirst: false, ...overrides }); };
/** Ask the compile on `view` and fold `choices` (by family, a row id or none/unclear) back in; returns the view and the row. */
function compileWith(view, choices) {
	const request = next(view);
	assert.deepEqual([request.kind, request.purpose], ["decide", "compile"], "the compile is the first question");
	const batch = compileBatch(view, scope, [], []);
	const answers = Object.fromEntries(Object.entries(choices).map(([family, [id, confidence, probabilities]]) =>
		[family, [id === NONE || id === UNCLEAR || id.startsWith?.("!") ? id.replace(/^!/, "") : alias(batch, family, id, view.rows), confidence, probabilities]]));
	const step = startStep(view, request);
	const row = settleCompile(view, step, batch, answer(answers), 5, 0.6);
	return { view, row, batch };
}

test("§135.30 rows: every option is a kernel row plus none and unclear; a family with no rows is not asked", () => {
	const reads = office(), { rows } = built(reads);
	assert.deepEqual(rows.destination.map((row) => row.id), ["morgue", "library"]);
	assert.deepEqual(rows.addressee.map((row) => [row.id, row.describe.label]), [["Steven Knott", "史蒂文·诺特"]], "the person by the table's own label");
	assert.deepEqual(rows.ask.map((row) => row.id), ["clue:keys", "handout:The Letter"]);
	assert.deepEqual(rows.item.map((row) => row.id), ["notebook"], "only what an investigator carries");
	assert.ok(rows.act.some((row) => row.id === "social") && rows.act.every((row) => typeof row.id === "string"), "outside a fight the acts are the resolve intents");
	assert.deepEqual(rows.target, [], "outside a fight there are no fighters");
	const batch = compileBatch(initialView({ runId: "r", rawInput: INPUT, context, candidates: [], rows }), scope, [], []);
	assert.equal(batch.family, COMPILE_FAMILY);
	assert.deepEqual(batch.questions.map((question) => question.key), ["destination", "addressee", "ask_1", "ask_2", "act", "item"],
		"target has no rows: not asked; §135.30.9: one question per ask row, in the rows' order");
	for (const question of batch.questions) {
		const keys = Object.keys(question.criteria), family = question.key;
		if (family.startsWith("ask_")) { assert.deepEqual(keys, ["yes", "no", "unclear"], `${family}: its own yes/no`); continue; }
		assert.deepEqual(keys, [...rows[family].map((_, index) => `${family}_${index + 1}`), NONE, UNCLEAR], `${family}: rows, then none and unclear`);
	}
	assert.deepEqual(batch.questions[0].criteria.destination_1, { place: "The Globe offices", handle: "morgue" }, "the row's own words");
	assert.ok(!JSON.stringify(batch).includes("apply:move"), "no host key reaches Jev");
	const bare = compileRows(office({ items: false }));
	assert.equal(compileBatch(initialView({ runId: "r", rawInput: INPUT, context, candidates: [], rows: bare }), scope, [], []).questions.some((question) => question.key === "item"), false,
		"no carried item: no item question");
	const fought = compileRows(fight());
	assert.deepEqual(fought.act.map((row) => row.id), ["combat:attack", "combat:dodge"], "in a fight the acts are the session's issued actions");
	assert.deepEqual(fought.target.map((row) => [row.id, row.describe.fighter]), [["Knott", "诺特"], ["Wilmot", "the editor"]]);
	const obligations = compileRows(morgue());
	assert.deepEqual(obligations.ask.map((row) => row.id), ["obligation:access", "clue:cutoff"], "the demand and the unguarded clue; the guarded clue is not a row");
	assert.match(JSON.stringify(obligations.ask[0].describe), /Access to the clippings.*the 1918 story/);
});

test("§135.30: a compile that selects is the first fan-out: the move runs next, a decided sibling is consumed, the rest reach the route", () => {
	const { view, row } = compileWith(compileView(office()), { destination: ["morgue", 0.9] });
	const head = next(view);
	assert.deepEqual([head.kind, head.item?.purpose, head.item?.candidate?.key], ["direct", "execute", "apply:move:morgue"], "no route question before the selected move");
	assert.deepEqual(head.item.candidate.basis.compile, { predicate: "move", features: { destination: "morgue" },
		read_features: { destination: { row: "morgue", confidence: 0.9, cleared: true } } });
	assert.ok(view.consumed.includes("apply:move:library") && !view.candidates.some((value) => value.key === "apply:move:library"), "the other exit was decided: not asked again");
	assert.ok(view.candidates.some((value) => value.key === "apply:clue:keys"), "a clue no predicate reads falls through");
	assert.deepEqual([row.detail.selected, row.detail.decided, row.jev_calls], [["apply:move:morgue"], ["apply:move:library"], 1]);
	assert.equal(view.budget.jevCalls, 1, "one Jev call spent");
	// Not asked again over the same candidates (§135.30 addendum: only a candidate no compile of the run was asked over owes one).
	view.pending = [];
	assert.equal(compileDue(view), false);
	assert.deepEqual([next(view).kind, next(view).purpose], ["decide", "route"]);
});

test("§135.30: a predicate never fires below the gate, on unclear, or on an option the question did not offer; the margin rule still clears", () => {
	// 0.55 against 0.40: below the gate and inside the margin -- nothing selected, nothing decided, both exits reach the route.
	const low = compileWith(compileView(office()), { destination: ["morgue", 0.55, { destination_1: 0.55, destination_2: 0.4, none: 0.05 }] }).view;
	assert.deepEqual(low.pending, [], "nothing selected");
	assert.deepEqual(low.consumed, [], "nothing decided");
	const request = next(low);
	assert.deepEqual([request.kind, request.purpose], ["decide", "route"], "the route question follows at once");
	const offered = routeBatch(low, scope, []).offered.map((candidate) => candidate.key);
	assert.ok(offered.includes("apply:move:morgue") && offered.includes("apply:move:library"), "the moves reach the need question");
	// The margin rule (top >= 0.35 and >= 1.8x the runner-up) clears a low reported confidence, exactly as the route's.
	const margin = compileWith(compileView(office()), { destination: ["morgue", 0.5, { destination_1: 0.72, destination_2: 0.2, none: 0.08 }] }).view;
	assert.equal(next(margin).item?.candidate?.key, "apply:move:morgue");
	// unclear, however sure, decides nothing.
	const unclear = compileWith(compileView(office()), { destination: [UNCLEAR, 0.97] }).view;
	assert.deepEqual([unclear.pending.length, unclear.consumed.length], [0, 0]);
	// An option the question never offered (a raw handle, an alias past the rows) never clears.
	for (const invented of ["!morgue", "!destination_9"]) {
		const { view } = compileWith(compileView(office()), { destination: [invented, 0.99] });
		assert.deepEqual([view.pending.length, view.consumed.length], [0, 0], `${invented} selects and decides nothing`);
	}
	// none, cleared, decides every exit: the player goes nowhere, so no move is asked again this run.
	const none = compileWith(compileView(office()), { destination: [NONE, 0.9] }).view;
	assert.deepEqual(none.consumed.sort(), ["apply:move:library", "apply:move:morgue"]);
	assert.equal(none.pending.length, 0);
});

test("§135.30 obligation predicates: the demand asked of the check's person selects the check (its bind stays SL-12's); another person, a combat act or another ask does not", () => {
	const selected = compileWith(compileView(morgue(), { context: { ...context, scene: "morgue" } }),
		{ ask: ["obligation:access", 0.9], addressee: ["Arty", 0.88], act: ["social", 0.9] }).view;
	const head = next(selected);
	assert.deepEqual([head.kind, head.purpose, head.item?.candidate?.key], ["decide", "bind", "resolve:obligation:access"], "selected; its closed parameters are SL-12's bind");
	assert.deepEqual(head.item.candidate.basis.compile.features, { addressee: "Arty", ask: "obligation:access", act: "social" });
	// The demand alone (the addressee not cleared) is enough.
	assert.equal(next(compileWith(compileView(morgue()), { ask: ["obligation:access", 0.9], addressee: [UNCLEAR, 0.9] }).view).item?.candidate?.key, "resolve:obligation:access");
	// The addressee cleared on someone else, a cleared none, a combat act, or another ask: decided, not selected, the Keeper's.
	for (const [label, choices] of [["another person", { ask: ["obligation:access", 0.9], addressee: ["Ruth", 0.9] }],
		["nobody present", { ask: ["obligation:access", 0.9], addressee: [NONE, 0.9] }],
		["a combat act", { ask: ["obligation:access", 0.9], act: ["combat", 0.9] }],
		["another ask", { ask: ["clue:cutoff", 0.9] }]]) {
		const { view } = compileWith(compileView(morgue()), choices);
		assert.ok(!view.pending.some((item) => item.candidate?.key === "resolve:obligation:access"), `${label}: not selected`);
		assert.ok(view.consumed.includes("resolve:obligation:access"), `${label}: decided, so not asked again this run`);
	}
	// The ask not cleared: the obligation reaches the route's fact question (§135.26), as before.
	const open = compileWith(compileView(morgue()), { ask: [UNCLEAR, 0.9], addressee: ["Arty", 0.95] }).view;
	const route = routeBatch(open, scope, []);
	assert.ok(route.batch.questions.some((question) => question.criteria.seeks), "the fact question is asked");
});

test("§135.30 stated meeting: the person the book puts there is staged when the player addresses them", () => {
	const reads = morgue();
	reads.applyOptions.obligations[0] = { handle: "archivist", name: "The archivist", who: "Ruth", state: "open", trigger: { kind: "attempt", guards: { clues: ["cutoff"] } },
		next: { kind: "meet", person: "Ruth" } };
	const { view } = compileWith(compileView(reads), { addressee: ["Ruth", 0.9] });
	const head = next(view);
	assert.deepEqual([head.kind, head.item?.candidate?.key, head.item?.candidate?.basis?.compile?.predicate], ["direct", "apply:person:Ruth", "stated_meeting"]);
});

test("§135.30 attack: act and target cleared select the investigator's attack with the target bound; the bind row reads it as Jev's", () => {
	const { view } = compileWith(compileView(fight()), { act: ["combat:attack", 0.9], target: ["Wilmot", 0.86, { target_1: 0.1, target_2: 0.86, none: 0.02, unclear: 0.02 }] });
	const head = next(view);
	assert.deepEqual([head.kind, head.item?.purpose], ["direct", "execute"], "one weapon issued: nothing left to bind");
	const attack = head.item.candidate;
	assert.deepEqual([attack.bound.target, attack.bound.weapon, attack.unbound.some((value) => value.name === "target")], ["Wilmot", "unarmed", false]);
	assert.deepEqual(attack.basis.compile.bound.target, { value: "Wilmot", confidence: 0.86, distribution: { target_1: 0.1, target_2: 0.86, none: 0.02, unclear: 0.02 } });
	const record = bindRecords(attack, {}, []).find((entry) => entry.name === "target");
	assert.deepEqual([record.path, record.value, record.confidence], ["jev", "Wilmot", 0.86], "the compile's answer, with its distribution, is the target's record");
	// A target the kernel did not issue for the attack cannot be selected; an attack with the target unclear falls through.
	const unclear = compileWith(compileView(fight()), { act: ["combat:attack", 0.9], target: [UNCLEAR, 0.9] }).view;
	assert.ok(!unclear.consumed.length && !unclear.pending.length, "falls through: the route and the attack's own bind decide");
	const dodge = compileWith(compileView(fight()), { act: ["combat:dodge", 0.9], target: ["Knott", 0.9] }).view;
	assert.ok(dodge.consumed.some((key) => key.startsWith("resolve:combat:attack")), "another act decided: the attack is not the player's this turn");
});

test("§135.30: nothing a predicate can reach, no compile; the rows alone never make one", () => {
	const reads = office();
	reads.applyOptions.candidates = reads.applyOptions.candidates.filter((row) => row.effect.kind !== "move" && row.effect.kind !== "clue");
	const view = compileView(reads);
	assert.ok(view.rows.act.length > 0 && view.rows.ask.length > 0, "there are rows");
	assert.equal(compileReaches(view.candidates, view.rows), false, "a handout: no predicate reads it");
	// §135.30.9 (SL-52): an issued clue with its ask row is reachable (`ask_clue`), so it owes a compile.
	const clue = compileView({ ...office(), applyOptions: { ...office().applyOptions, candidates: office().applyOptions.candidates.filter((row) => row.effect.kind === "clue") } });
	assert.equal(compileReaches(clue.candidates, clue.rows), true, "a clue with its ask row: ask_clue reaches it");
	assert.deepEqual([next(view).kind, next(view).purpose], ["decide", "route"]);
	// Without rows (a reader that builds none) there is never a compile, and `compile: false` turns it off for the run.
	const { candidates } = built(office());
	assert.equal(next(initialView({ runId: "r", rawInput: INPUT, context, candidates, readFirst: false })).purpose, "route");
	assert.equal(next(initialView({ runId: "r", rawInput: INPUT, context, candidates, rows: compileRows(office()), readFirst: false, compile: false })).purpose, "route");
	// §135.30 addendum (2026-09-24): a route question asked earlier in the run no longer rules the compile out -- a later
	// read that brings rows reaching a candidate no compile was asked over owes one before the next route.
	const late = initialView({ runId: "r", rawInput: INPUT, context, candidates, readFirst: false });
	const route = next(late), step = startStep(late, route);
	settleRoute(late, step, routeBatch(late, scope, []).batch, routeBatch(late, scope, []).offered, answer({ exit: ["ask_llm", 0.9] }), 5, 0.6);
	late.rows = compileRows(office()); late.pending = [];
	assert.equal(compileDue(late), true);
	assert.deepEqual([next(late).kind, next(late).purpose], ["decide", "compile"]);
	// Switched off for the run, never.
	const off = initialView({ runId: "r", rawInput: INPUT, context, candidates, rows: compileRows(office()), readFirst: false, compile: false });
	assert.equal(compileDue(off), false);
});

/** The emitted kernel over its JSONL RPC, one process per request list, on a prepared workspace; returns results by index. */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
function kernelRun(workspace, campaign, requests) {
	const input = requests.map(([method, params = {}], index) => JSON.stringify({ id: String(index), method, params: { campaign, ...params } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")], { cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} (${requests[Number(frame.id)][0]}) failed: ${JSON.stringify(frame.error)}`);
	return frames.sort((a, b) => Number(a.id) - Number(b.id)).map((frame) => frame.result);
}
const kernelReads = (workspace, campaign) => {
	const [capsule, applyOptions, resolveOptions] = kernelRun(workspace, campaign, [["table.capsule"], ["table.apply.options"], ["table.resolve.options"]]);
	return { capsule, applyOptions, resolveOptions };
};

test("§135.30 addendum (live gate #4, turn 1): an exit the Keeper's clue unlocks after the run's first route gets the compile before the next route", (t) => {
	// The state of gate #4's turn 1 on the emitted kernel: the haunting's opening office, the commission's clues not yet
	// revealed, so every research exit is gated on `knott-research-leads` (`unlock_when.met: false`) and the builder issues
	// no move. The first route runs without a compile (nothing a predicate can select); the Keeper reveals the clue; the
	// fresh read issues the exits; the compile is due before the next route. Before the addendum it was never asked.
	const workspace = mkdtempSync(join(tmpdir(), "sl13b-gate4-"));
	t.after(() => rmSync(workspace, { recursive: true, force: true }));
	const campaign = "gate4";
	createRealCampaign(workspace, campaign);
	const words = "我接。先去《环球报》剪报室，翻科比特宅这些年的旧报道。";
	const [, opened] = kernelRun(workspace, campaign, [["table.open"], ["table.player_input", { text: words }]]);
	const first = kernelReads(workspace, campaign), firstRows = compileRows(first), firstCandidates = buildCandidates(first, words);
	const scene = { scene: first.capsule.where?.scene ?? null, clock: null, present: [], receipts: [] };
	assert.ok(firstRows.destination.some((row) => row.id === "newspaper-morgue"), "the morgue is a destination row (withheld exits included)");
	assert.ok(!firstCandidates.some((candidate) => candidate.family === "move"), "no move is issued: the exits wait on the commission's clue");
	const view = initialView({ runId: "r", rawInput: words, context: scene, candidates: [], readFirst: false });
	settleRead(view, 1, { materials: [], summary: {} }, { context: scene, candidates: firstCandidates, rows: firstRows }, 0);
	// §135.30.3 (SL-26): the ordinary check is reachable at every read outside a session, so this read owes a compile now
	// (at the table there was none: no move was issued). It reads the act as a move: nothing fires, the check falls through.
	const opening = next(view);
	assert.deepEqual([opening.kind, opening.purpose], ["decide", "compile"], "the ordinary check owes the compile at the first read");
	const openingBatch = compileBatch(view, scope, [], []);
	const opened_ = settleCompile(view, startStep(view, opening), openingBatch, answer({ act: [alias(openingBatch, "act", "move", view.rows), 0.9] }), 5, 0.6);
	assert.deepEqual([opened_.detail.selected, opened_.detail.decided, opened_.detail.fell_through.includes("resolve:core-check:ordinary-check")], [[], [], true]);
	const route = next(view);
	assert.deepEqual([route.kind, route.purpose], ["decide", "route"], "nothing a predicate selected: the route, as at the table");
	const { batch, offered } = routeBatch(view, scope, []);
	settleRoute(view, startStep(view, route), batch, offered, answer({ exit: ["ask_llm", 0.83] }), 5, 0.6);
	const adjudicate = next(view);
	settleInfer(view, startStep(view, adjudicate), adjudicate, { items: [], detail: { proposals: ["apply"] } }, 0, 0);
	// The Keeper's write (its tool call, run by the driver and folded as a model-origin execute): the commission's clue.
	const effects = [{ kind: "clue", clue: "knott-research-leads", how: "诺特列出该去查的地方。", label: "查档的路" }];
	kernelRun(workspace, campaign, [["table.apply", { call_id: `t${opened.turn}-c1`, effects }]]);
	const second = kernelReads(workspace, campaign), secondCandidates = buildCandidates(second, words);
	assert.ok(secondCandidates.some((candidate) => candidate.key === "apply:move:newspaper-morgue"), "the clue unlocked the morgue exit");
	settleExecute(view, ++view.budget.steps, { kind: "direct", purpose: "execute", call: { method: "apply", params: { effects }, label: "apply" } },
		{ ok: true, summary: {} }, { context: scene, candidates: secondCandidates, rows: compileRows(second) }, 0);
	const request = next(view);
	assert.deepEqual([request.kind, request.purpose], ["decide", "compile"], "the compile runs before the next route");
	const question = compileBatch(view, scope, [], []);
	const destination = question.questions.find((value) => value.key === "destination");
	const morgue = Object.entries(destination.criteria).find(([, value]) => value?.handle === "newspaper-morgue")[0];
	settleCompile(view, startStep(view, request), question, answer({ destination: [morgue, 0.99] }), 5, 0.6);
	assert.equal(next(view).item?.candidate?.key, "apply:move:newspaper-morgue", "the compile selects the move");
});

test("§135.30 addendum (owner, 2026-09-24): the route's seeks never selects an obligation check or a stated meeting; its answer is recorded and the candidate is the Keeper's", () => {
	const reads = morgue();
	const { candidates } = built(reads);
	const check = candidates.find((candidate) => candidate.family === "obligation_check");
	assert.equal(compileOnly(check), true, "an obligation check is the compile's alone");
	assert.equal(compileOnly(candidates.find((candidate) => candidate.key === "apply:clue:cutoff")), false, "a clue keeps the route's need question");
	const meetingReads = morgue();
	meetingReads.applyOptions.obligations[0] = { handle: "archivist", name: "The archivist", who: "Ruth", state: "open", trigger: { kind: "attempt", guards: { clues: ["cutoff"] } },
		next: { kind: "meet", person: "Ruth" } };
	const meeting = buildCandidates(meetingReads, INPUT).find((candidate) => candidate.clerk === "stated_obligation");
	assert.equal(compileOnly(meeting), true, "a stated meeting is the compile's alone");
	for (const candidate of [check, meeting]) {
		const view = initialView({ runId: "r", rawInput: INPUT, context, candidates: [candidate], readFirst: false });
		const request = next(view);
		assert.equal(request.purpose, "route", "no rows: no compile, the route asks");
		const { batch, offered } = routeBatch(view, scope, []);
		assert.ok(batch.questions[0].criteria.seeks, "the fact question is still asked");
		const result = answer({ need_1: ["seeks", 0.95], exit: ["continue", 0.9] });
		assert.deepEqual(interpretRoute(view, offered, result, 0.6).selected, [], `${candidate.family}: seeks at 0.95 selects nothing`);
		const row = settleRoute(view, startStep(view, request), batch, offered, result, 5, 0.6);
		assert.equal(row.detail.answers.need_1.choice, "seeks", "the answer is recorded");
		assert.ok(view.consumed.includes(candidate.key) && !view.candidates.length, "the Keeper's for the rest of the run");
		assert.ok(!view.pending.some((item) => item.candidate?.key === candidate.key || item.candidate?.then === candidate.key), "nothing queued for the clerk");
	}
	// The now/later question of an obligation that guards nothing selects nothing either.
	const bare = morgue();
	bare.applyOptions.obligations[0].trigger = { kind: "attempt", guards: {} };
	const plain = buildCandidates(bare, INPUT).find((candidate) => candidate.family === "obligation_check");
	assert.equal(plain.routeFact, undefined);
	const view = initialView({ runId: "r", rawInput: INPUT, context, candidates: [plain], readFirst: false });
	const nowResult = answer({ need_1: ["now", 0.95], exit: ["continue", 0.9] });
	assert.deepEqual(interpretRoute(view, [plain], nowResult, 0.6).selected, []);
	settleRoute(view, startStep(view, next(view)), routeBatch(view, scope, []).batch, [plain], nowResult, 5, 0.6);
	assert.ok(view.consumed.includes(plain.key), "consumed after the route, like a fact-question candidate");
	// A move keeps the route's need question.
	const office_ = built(office()).candidates.find((candidate) => candidate.key === "apply:move:morgue");
	const moved = initialView({ runId: "r", rawInput: INPUT, context, candidates: [office_], readFirst: false });
	assert.deepEqual(interpretRoute(moved, [office_], answer({ need_1: ["now", 0.95], exit: ["continue", 0.9] }), 0.6).selected, ["apply:move:morgue"]);
});

/**
 * SL-19 (§135.30.2): the office outside a fight with the kernel's first-blow row -- Knott and the filing woman have stat
 * blocks, the editor has none, so he is present (an addressee, a target row) but not a target the kernel issues.
 */
function brawl({ targets = ["Steven Knott", "Ruth"], weapons = ["unarmed", ".38 Revolver"] } = {}) {
	const reads = office();
	reads.capsule.present = [{ name: "Steven Knott", role: "employer", called: { name: "史蒂文·诺特" } },
		{ name: "Ruth", role: "helpful_staff", untold: { label: "the filing woman" } }, { name: "Arty", role: "gatekeeper", called: { name: "the editor" } }];
	reads.resolveOptions.context = { first_blow: { decision: "combat:attack", intent: "combat", actor: "Hayes", targets, weapons } };
	return reads;
}
const FIRST_BLOW = "resolve:combat:first-blow";

test("SL-19 rows: outside a fight the target rows are the people present -- the addressee rows -- only when the kernel issues a first blow", () => {
	const rows = compileRows(brawl());
	assert.deepEqual(rows.target, rows.addressee, "the same identities and the same words");
	assert.deepEqual(rows.target.map((row) => row.id), ["Steven Knott", "Ruth", "Arty"], "everyone present, the editor without a stat block included");
	assert.ok(rows.act.some((row) => row.id === "combat"), "outside a session the act rows are the resolve intents");
	assert.equal(compileRows(office()).target.length, 0, "no first-blow row: nothing to attack, target not asked");
	const none = brawl({ targets: [] });
	assert.equal(compileRows(none).target.length, 0, "a row that names no one issues no target rows");
	assert.equal(buildCandidates(none, INPUT).some((candidate) => candidate.key === FIRST_BLOW), false);
	// In a running fight the rows stay the investigator's issued attack targets, and no first blow is built.
	const inFight = fight();
	inFight.resolveOptions.context.first_blow = brawl().resolveOptions.context.first_blow;
	assert.deepEqual(compileRows(inFight).target.map((row) => row.id), ["Knott", "Wilmot"]);
	assert.equal(buildCandidates(inFight, INPUT).some((candidate) => candidate.key === FIRST_BLOW), false);
});

test("SL-19 candidate: the first blow is the kernel's row as a clerk candidate, compile-only; the in-session attack predicate does not read it", () => {
	const blow = buildCandidates(brawl(), INPUT).find((candidate) => candidate.key === FIRST_BLOW);
	assert.equal(blow.clerk, "first_blow");
	assert.deepEqual([blow.bound.intent, blow.bound.decision, blow.bound.goal], ["combat", "combat:attack", INPUT]);
	assert.deepEqual(blow.unbound.map((value) => [value.name, value.options]), [["target", ["Steven Knott", "Ruth"]], ["weapon", ["unarmed", ".38 Revolver"]]]);
	assert.equal(blow.unbound.some((value) => value.ruleDefault), false, "a target and a weapon have no rules default (§135.28)");
	assert.equal(compileOnly(blow), true);
	assert.equal(predicateOf(blow, compileRows(brawl())).name, "first_blow", "read by its own predicate, not the in-session attack's");
	const attack = buildCandidates(fight(), INPUT).find((candidate) => candidate.bound.decision === "combat:attack");
	assert.equal(predicateOf(attack, compileRows(fight())).name, "attack");
	const single = buildCandidates(brawl({ targets: ["Steven Knott"], weapons: ["unarmed"] }), INPUT).find((candidate) => candidate.key === FIRST_BLOW);
	assert.deepEqual([single.bound.target, single.bound.weapon, single.unbound.length], ["Steven Knott", "unarmed", 0], "one value issued: stated");
});

test("SL-19 predicate: act combat and a fightable target select the first blow with the target bound; below the gate, another act, or someone the kernel cannot fight do not", () => {
	const { view } = compileWith(compileView(brawl()), { act: ["combat", 0.9], target: ["Ruth", 0.86, { target_1: 0.1, target_2: 0.86, none: 0.02, unclear: 0.02 }], addressee: ["Ruth", 0.9] });
	assert.ok(!view.consumed.includes(FIRST_BLOW));
	const head = next(view);
	assert.deepEqual([head.kind, head.purpose], ["decide", "bind"], "the weapon is still a closed choice: Jev binds it");
	const blow = head.item.candidate;
	assert.equal(blow.key, FIRST_BLOW);
	assert.equal(blow.bound.target, "Ruth");
	assert.equal(blow.basis.compile.predicate, "first_blow");
	assert.deepEqual(blow.basis.compile.bound.target, { value: "Ruth", confidence: 0.86, distribution: { target_1: 0.1, target_2: 0.86, none: 0.02, unclear: 0.02 } });
	assert.deepEqual(bindRecords(blow, {}, []).find((entry) => entry.name === "target").path, "jev");
	// Below the gate: nothing selected, nothing decided; the route never selects it either (compile-only).
	const low = compileWith(compileView(brawl()), { act: ["combat", 0.45, { act_4: 0.45, act_2: 0.4 }], target: ["Steven Knott", 0.9] }).view;
	assert.ok(!low.pending.some((item) => item.candidate?.key === FIRST_BLOW) && !low.consumed.includes(FIRST_BLOW), "falls through");
	// Another act decided: not the player's attack this turn.
	const social = compileWith(compileView(brawl()), { act: ["social", 0.9], target: ["Steven Knott", 0.9] }).view;
	assert.ok(social.consumed.includes(FIRST_BLOW) && !social.pending.some((item) => item.candidate?.key === FIRST_BLOW));
	// The editor is present but has no stat block: the kernel did not issue him, so it is decided without firing.
	const editor = compileWith(compileView(brawl()), { act: ["combat", 0.9], target: ["Arty", 0.9] }).view;
	assert.ok(editor.consumed.includes(FIRST_BLOW) && !editor.pending.some((item) => item.candidate?.key === FIRST_BLOW));
	// Combat with the target unclear: undecided, left to the Keeper through the route (which never selects it).
	const unclear = compileWith(compileView(brawl()), { act: ["combat", 0.9], target: [UNCLEAR, 0.9] }).view;
	assert.ok(!unclear.consumed.includes(FIRST_BLOW) && !unclear.pending.some((item) => item.candidate?.key === FIRST_BLOW));
	const request = next(unclear);
	assert.equal(request.purpose, "route");
	const { batch, offered } = routeBatch(unclear, scope, []);
	const index = offered.findIndex((candidate) => candidate.key === FIRST_BLOW);
	assert.ok(index >= 0, "its need question is still asked and recorded");
	const result = answer({ ...Object.fromEntries(offered.map((_, at) => [`need_${at + 1}`, ["later", 0.9]])), [`need_${index + 1}`]: ["now", 0.97], exit: ["continue", 0.9] });
	assert.equal(interpretRoute(unclear, offered, result, 0.6).selected.includes(FIRST_BLOW), false, "now at 0.97 selects nothing");
	settleRoute(unclear, startStep(unclear, request), batch, offered, result, 5, 0.6);
	assert.ok(unclear.consumed.includes(FIRST_BLOW), "the Keeper's for the rest of the run");
});

/** One run on the vendored driver with stub ports; `compile` switches the typed-feature compile. Returns the decide log. */
async function drive({ compile }) {
	const log = [];
	const reads = office(), policy = createStepPolicy({ context, scope, candidates: [], ...(compile ? {} : { compile: false }) });
	const morgueContext = { scene: "morgue", clock: null, present: [], receipts: [] };
	let at = "office";
	const fresh = () => at === "office" ? { context, candidates: buildCandidates(reads, INPUT), rows: compileRows(reads) }
		: { context: morgueContext, candidates: [], rows: {} };
	const answers = (batch) => batch.family === COMPILE_FAMILY
		? answer({ ...Object.fromEntries(batch.questions.map((question) => [question.key, [UNCLEAR, 0.9]])), destination: ["destination_1", 0.9] })
		: answer(Object.fromEntries(batch.questions.map((question) => [question.key,
			[question.key === "exit" ? "finish" : /The Globe offices/.test(question.target) ? "now" : "later", 0.9]])));
	const ports = {
		clock: { now: () => 0 },
		read: { async read() { log.push("read"); return { status: "ok", artifact: { kind: "read", read: { materials: [], summary: {} }, fresh: fresh() } }; } },
		decision: { async decide(request) { log.push(`decide:${request.purpose}`); return { status: "ok", artifact: { kind: request.purpose, result: answers(request.question.batch) } }; } },
		operations: { async execute(proposal) {
			if (proposal.operation === "turn_close") { log.push("turn_close"); return { status: "ok", artifact: { kind: "turn_close", verdict: { status: "none", reason: "nothing_owed" } } }; }
			log.push(`clerk:${proposal.params.candidate.key}`);
			at = "morgue";
			return { status: "ok", artifact: { kind: "execute", executed: { ok: true, summary: {} }, fresh: fresh() } };
		} },
		record: { record: () => {} },
	};
	const engine = {
		async infer() { log.push("infer"); return fauxAssistantMessage("You reach the Globe.", { stopReason: "stop" }); },
		async executeModelTool() { throw new Error("no model tool"); }, async refuseModelTool() { throw new Error("no model tool"); },
		async closeTurn() { return { continueRequested: false }; },
	};
	await runDriver({ input: { runId: "r1", inputRevision: "rev", rawInput: INPUT, scopeId: "root" }, policy, ports, engine, emit: () => {}, signal: new AbortController().signal, maxSteps: 30 });
	return log;
}

test("§135.30 on the driver: the compile replaces the first route, so the run's Jev calls do not go up", async () => {
	const compiled = await drive({ compile: true }), routed = await drive({ compile: false });
	assert.deepEqual(compiled.slice(0, 5), ["read", "decide:compile", "clerk:apply:move:morgue", "read", "decide:route"], "no route between the compile and the clerk's move");
	assert.deepEqual(routed.slice(0, 5), ["read", "decide:route", "clerk:apply:move:morgue", "read", "decide:route"], "the SL-12 policy: the route selects the move");
	const decides = (log) => log.filter((entry) => entry.startsWith("decide:")).length;
	assert.equal(decides(compiled), decides(routed), "one compile in place of the first route");
	assert.equal(decides(compiled), 2);
});

test("§135.30 at the engine: the compile row carries each feature's distribution and the predicates that fired; the clerk's step carries basis.compile", async () => {
	const handlers = new Map(), rows = [], dispatched = [];
	const bus = { on: (name, handler) => handlers.set(name, handler), emit: (name, value) => handlers.get(name)?.(value) };
	const families = [];
	const decision = { decide: async (batch) => { families.push(batch.family);
		return batch.family === COMPILE_FAMILY
			? answer(Object.fromEntries(batch.questions.map((question) => [question.key, question.key === "destination" ? ["destination_1", 0.91, { destination_1: 0.91, destination_2: 0.05, none: 0.02, unclear: 0.02 }] : [UNCLEAR, 0.8]])))
			: answer(Object.fromEntries(batch.questions.map((question) => [question.key, [question.key === "exit" ? "finish" : "later", 0.9]]))); } };
	const engine = createHybridEngine({ env: {}, decision, record: (row) => rows.push(row) });
	engine.extension({ events: bus, on: () => {}, getActiveTools: () => [], setActiveTools: () => {} });
	const reads = office(), source = "a".repeat(64);
	bus.emit("coc:kernel-bridge", { campaign: "c", call: async (method) => method === "table.capsule"
		? { ...reads.capsule, _context: { version: 1, campaign: "c", worldline: "main", loop: 0, turn: 3, source_revision: source } }
		: method === "table.status" ? { turn: 3, state: "open", receipts: [] }
			: method === "table.apply.options" ? reads.applyOptions : method === "table.resolve.options" ? reads.resolveOptions : {} });
	bus.emit("coc:operation-dispatcher", { dispatch: async (operation, hostContext) => { dispatched.push({ operation, origin: hostContext.origin });
		return { status: "succeeded", receipts: ["move-1"], result: {} }; } });
	const plan = engine.runDriver.prepare({ runId: "run-1", inputRevision: "rev", rawInput: INPUT, session: {} });
	const modelEngine = {
		async infer() { return fauxAssistantMessage("You set off.", { stopReason: "stop" }); },
		async executeModelTool() { throw new Error("no model tool"); }, async refuseModelTool() { throw new Error("no model tool"); },
		async closeTurn() { return { continueRequested: false }; },
	};
	await runDriver({ input: { runId: "run-1", inputRevision: "rev", rawInput: INPUT, scopeId: "root" }, policy: plan.policy, ports: plan.ports, engine: modelEngine,
		emit: () => {}, signal: new AbortController().signal, maxSteps: 30 });
	assert.equal(families[0], COMPILE_FAMILY, "the compile is the run's first Jev question");
	// §135.6 (2026-09-24): a read without the prescreen says why -- here the preselect setting is off, as at live gate #4.
	assert.deepEqual(rows.find((entry) => entry.lane === "run" && entry.event === "read")?.prescreen, { status: "not_run", reason: "preselect_off" });
	const row = rows.find((entry) => entry.lane === "route" && entry.purpose === "compile");
	assert.ok(row, "one compile row");
	assert.deepEqual([row.features.destination.row, row.features.destination.cleared, row.features.destination.probabilities.destination_1], ["morgue", true, 0.91]);
	assert.deepEqual(row.features.destination.rows, { destination_1: "morgue", destination_2: "library" });
	assert.equal(row.features.addressee.cleared, false, "unclear never clears");
	assert.deepEqual(row.fired, [{ predicate: "move", candidate: "apply:move:morgue", features: { destination: "morgue" } }]);
	assert.deepEqual([row.selected, row.decided], [["apply:move:morgue"], ["apply:move:library"]]);
	assert.ok(row.fell_through.includes("apply:clue:keys"));
	assert.equal(rows.filter((entry) => entry.lane === "route" && entry.purpose === "compile").length, 1, "once per run");
	const clerk = dispatched.find((entry) => entry.origin?.origin === "policy");
	assert.deepEqual(clerk.operation.args.effects, [{ kind: "move", to: "morgue" }]);
	assert.deepEqual(clerk.origin.basis.compile, { predicate: "move", features: { destination: "morgue" },
		read_features: { destination: { row: "morgue", confidence: 0.91, cleared: true } } }, "the tool and admission rows carry what the compile read");
	// §32.12: the bind records travel to admission on the host origin, computed before the dispatch.
	assert.deepEqual(clerk.origin.bindings, [{ name: "to", path: "stated" }]);
	assert.ok(!families.slice(0, 2).includes(ROUTE_FAMILY) || families.indexOf(ROUTE_FAMILY) > 0, "no route before the compile");
});

// ---- SL-26 (§135.30.3): the declared ordinary check ----------------------------------------------------------------

/** The long gate's bedroom (turn 12), reduced: two exits, one person present, an open obligation, the ordinary check offered. */
function bedroom({ obligation = false } = {}) {
	return {
		capsule: { where: { scene: "upper-floor-bedroom" }, present: [{ name: "Corbitt", role: "spirit", called: { name: "the presence" } }],
			known: { investigator: { name: "Hayes" } } },
		applyOptions: { candidates: [
			{ effect: { kind: "move", to: "corbitt-house-ground" }, description: { display_name: "Ground floor" } },
			{ effect: { kind: "move", to: "commission-briefing" }, description: { display_name: "Knott's office" } },
			{ effect: { kind: "clue", clue: "poltergeist-bed" }, description: { summary: "The bed moves by itself." } }],
		obligations: obligation ? [{ handle: "calm", name: "Calm the presence", who: "Corbitt", state: "open", trigger: { kind: "attempt", guards: {} },
			next: { kind: "check", target: "Corbitt", selection: "approach", approaches: [{ skill: "Persuade" }], difficulty: "regular" } }] : [],
		context: { present: ["Corbitt"] } },
		resolveOptions: { profiles: [{ actor: "Hayes", skill: "Spot Hidden", value: 60, availability: "bound" }, { actor: "Hayes", skill: "Listen", value: 50, availability: "bound" },
			{ actor: "Hayes", skill: "Persuade", value: 40, availability: "bound" }],
			decisions: [{ name: "core-check:ordinary-check", family: "core-check", description: "One ordinary skill check." }] },
	};
}
const ORDINARY = "resolve:core-check:ordinary-check";
const bedroomView = (reads = bedroom()) => { const candidates = buildCandidates(reads, "我在主卧里搜床底、床垫和衣柜。"), rows = compileRows(reads);
	return initialView({ runId: "r", rawInput: "我在主卧里搜床底、床垫和衣柜。", context: { scene: "upper-floor-bedroom", clock: null, present: [], receipts: [] }, candidates, rows, readFirst: false }); };

test("SL-26 (§135.30.3): the ordinary check owes a compile; investigate at the gate selects it with the act as its intent; the bind comes next", () => {
	const view = bedroomView();
	assert.ok(view.candidates.some((candidate) => candidate.key === ORDINARY), "the builder offers the check");
	assert.equal(predicateOf(view.candidates.find((candidate) => candidate.key === ORDINARY), view.rows)?.name, "ordinary_check");
	// Only the check is reachable (no move offered): the compile is still owed.
	const alone = initialView({ runId: "r", rawInput: "x", context, candidates: view.candidates.filter((candidate) => candidate.key === ORDINARY), rows: view.rows, readFirst: false });
	assert.equal(compileDue(alone), true, "the check alone owes the compile");
	// The long gate's turn 12: act investigate 1.0, destination none 0.96.
	const { row } = compileWith(view, { act: ["investigate", 1], destination: [NONE, 0.96, { none: 0.97, unclear: 0.03 }] });
	assert.deepEqual(row.detail.selected, [ORDINARY]);
	assert.deepEqual(row.detail.fired, [{ predicate: "ordinary_check", candidate: ORDINARY, features: { destination: null, act: "investigate" } }]);
	const head = next(view);
	assert.deepEqual([head.kind, head.purpose, head.item?.candidate?.key], ["decide", "bind", ORDINARY], "the binder next, no route question before it");
	const chosen = head.item.candidate;
	assert.equal(chosen.bound.intent, "investigate", "the act the compile read is the check's intent");
	assert.deepEqual([chosen.basis.compile.bound.intent.value, chosen.basis.compile.bound.intent.confidence], ["investigate", 1], "with the act answer's confidence");
	assert.equal(Object.values(chosen.basis.compile.bound.intent.distribution)[0], 1, "and its distribution");
	assert.deepEqual(chosen.basis.compile.read_features, { act: { row: "investigate", confidence: 1, cleared: true }, addressee: { row: null, confidence: null, cleared: false },
		ask: { row: null, rows: [], confidence: null, cleared: false }, destination: { row: null, confidence: 0.96, cleared: true } },
		"every family it reads, the unanswered guards as not cleared (§135.30.9: the ask as the sought rows, none here)");
	assert.ok(chosen.unbound.some((value) => value.binder === "ordinary-resolve"), "the profile is still the binder's");
	assert.ok(!view.consumed.includes(ORDINARY));
});

test("SL-26 (§135.30.3): the predicate fires only on investigate, or social aimed at someone present; never below the gate, with a destination, or on an obligation's demand; never decided", () => {
	const cases = [
		["investigate under the gate (0.5 against move 0.4)", { act: ["investigate", 0.5, { investigate: 0.5, move: 0.4 }] }, false],
		["social with no addressee", { act: ["social", 0.9] }, false],
		["social aimed at no one (a cleared none)", { act: ["social", 0.9], addressee: [NONE, 0.9] }, false],
		["social at the presence", { act: ["social", 0.9], addressee: ["Corbitt", 0.9] }, true],
		["move", { act: ["move", 0.9] }, false],
		["investigate with a destination: the check is the destination's", { act: ["investigate", 0.9], destination: ["corbitt-house-ground", 0.9] }, false],
		["investigate with the ask unclear", { act: ["investigate", 0.9], ask: [UNCLEAR, 0.9] }, true],
		["unclear", { act: [UNCLEAR, 0.9] }, false],
	];
	for (const [label, choices, fires] of cases) {
		const { view, row } = compileWith(bedroomView(), choices);
		assert.equal(row.detail.selected.includes(ORDINARY), fires, label);
		assert.ok(!row.detail.decided.includes(ORDINARY), `${label}: never decided`);
		if (!fires) assert.ok(row.detail.fell_through.includes(ORDINARY) && view.candidates.some((candidate) => candidate.key === ORDINARY), `${label}: left to the route`);
	}
	// The destination case: the move fires, the check falls through to the scene the declaration ends in.
	const { row: moved } = compileWith(bedroomView(), { act: ["investigate", 0.9], destination: ["corbitt-house-ground", 0.9] });
	assert.deepEqual(moved.detail.selected, ["apply:move:corbitt-house-ground"]);
	// An ask on an open obligation's demand: that obligation's check is the declared check, not the ordinary one.
	const { row: owed } = compileWith(bedroomView(bedroom({ obligation: true })), { act: ["social", 0.9], addressee: ["Corbitt", 0.9], ask: ["obligation:calm", 0.9] });
	assert.deepEqual(owed.detail.selected, ["resolve:obligation:calm"], "the obligation's check, alone");
});
