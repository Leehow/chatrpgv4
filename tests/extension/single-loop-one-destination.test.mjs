/**
 * One declaration, one destination (contract §135.30.10; the §135.30.8 rule "a declaration's act is settled once", for the
 * place it goes).
 *
 * Environment acceptance, 2026-10-04 (`environment-v225-baseline-20261004`, flapcode/gpt-6-luna low, source 7b83acc22), turn 2:
 * "我接下委托，收好诺特给我的钥匙和地址，先去那栋住宅，站在街边查看外观。" The route moved the party to the Corbitt house (need now
 * 0.84). The fresh read there issued a new exit, so a compile was owed (§135.30.1); it read the same sentence from the house,
 * where the house is no row, and cleared `destination` on the neighbourhood at 0.92 -- "站在街边". The clerk moved the party a
 * second time (`t2-c3`, another 30 minutes). A third compile there read the house back at 0.84; only the house's move key,
 * already consumed, kept a third move from landing.
 *
 * - At the policy seam (pure, the kernel's row shapes): after a declared move the clerk executed, taken or refused, a later
 *   compile's `move` predicate selects nothing and decides every move, and the route selects no move whatever `need` answered;
 *   only that selected clerk move counts (not the Keeper's own move, an owed one, or a person's movement); a cleared held
 *   destination after the move is not reported as the player's. Controls: the same answers without a move select it.
 * - On the emitted kernel over the haunting through the hybrid engine (a stub Jev with the live turn's declared endpoint
 *   positively bound under §135.11, the faux
 *   Keeper): one move, to the house. With the compile off (the route alone), a move the route's need says `now` to at the
 *   house selects nothing, and the engine's route row says so.
 *
 * Assertions are on rows, selections and receipts, never on prose.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { fanAsk, isAskRow } from "./compile-ask.mjs";
import { buildCandidates } from "../../runtime/jev/candidates.ts";
import { compileRows } from "../../runtime/jev/compile-rows.ts";
import { COMPILE_FAMILY, NONE, REASK_FAMILY, UNCLEAR, compileBatch, interpretCompile } from "../../runtime/jev/route-compile.ts";
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { ROUTE_FAMILY, initialView, next, routeBatch, settleCompile, settleExecute, settleRead, settleRoute, startStep } from "../../runtime/jev/step-policy.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INPUT = "我接下委托，收好诺特给我的钥匙和地址，先去那栋住宅，站在街边查看外观。";
const scope = { owner: "campaign:test", campaign: "test", worldline: "main", loop: 0, audience: "keeper" };
const HOUSE = "apply:move:house", STREET = "apply:move:street", OFFICE = "apply:move:office";

// ---------------------------------------------------------------------------------------------------
// At the policy seam: the office, the house and the street, in the kernel's own row shapes.
// ---------------------------------------------------------------------------------------------------

/** A place with its exits (`[to, display name]`) and its clues. */
function place(scene, exits, clues = []) {
	return {
		capsule: { where: { scene }, present: [], known: { investigator: { name: "Hayes" } } },
		applyOptions: { candidates: [...exits.map(([to, name]) => ({ effect: { kind: "move", to }, description: { display_name: name } })),
			...clues.map((clue) => ({ effect: { kind: "clue", clue }, description: { summary: clue } }))], context: { present: [] } },
		resolveOptions: { profiles: [], decisions: [] },
	};
}
const office = () => place("office", [["house", "The Corbitt house"], ["street", "The neighbourhood"]], ["keys"]);
const house = () => place("house", [["street", "The neighbourhood"], ["office", "Knott's office"]], ["nailed-windows"]);
const contextOf = (scene) => ({ scene, clock: null, present: [], receipts: [] });
const fresh = (reads) => ({ context: contextOf(reads.capsule.where.scene), candidates: buildCandidates(reads, INPUT), rows: compileRows(reads) });
const answer = (choices) => ({ batchId: "b", status: "complete", issues: [], coverage: { required: [], answered: [], unknown: [] },
	answers: fanAsk(Object.fromEntries(Object.entries(choices).map(([key, [choice, confidence, probabilities]]) => [key,
		{ status: "answered", type: "choice", choice, confidence, probabilities: probabilities ?? { [choice]: confidence } }]))) });
const alias = (rows, family, id) => id === NONE || id === UNCLEAR ? id : `${family}_${rows[family].findIndex((row) => row.id === id) + 1}`;
function viewAt(reads) {
	const { context, candidates, rows } = fresh(reads);
	return initialView({ runId: "r", rawInput: INPUT, context, candidates, rows, readFirst: false });
}
/** The compile owed on `view`, answered by row id (`{destination: [id, confidence, {id: p}]}`), folded in. */
function compileWith(view, choices) {
	const request = next(view);
	assert.deepEqual([request.kind, request.purpose], ["decide", "compile"], "a compile is owed");
	const batch = compileBatch(view, scope, [], []);
	const result = answer(Object.fromEntries(Object.entries(choices).map(([family, [id, confidence, probabilities]]) => [family, [alias(view.rows, family, id), confidence,
		probabilities && Object.fromEntries(Object.entries(probabilities).map(([key, value]) => [alias(view.rows, family, key), value]))]])));
	return settleCompile(view, startStep(view, request), batch, result, 5, 0.6);
}
/** The route owed on `view`: `needs` by candidate key (the rest `later`), then the exit. */
function routeWith(view, needs, exit = ["continue", 0.9]) {
	const request = next(view);
	assert.deepEqual([request.kind, request.purpose], ["decide", "route"], "a route question is owed");
	const { batch, offered } = routeBatch(view, scope, []);
	const result = answer({ ...Object.fromEntries(offered.map((candidate, index) => [`need_${index + 1}`, needs[candidate.key] ?? ["later", 0.9]])), exit });
	return { row: settleRoute(view, startStep(view, request), batch, offered, result, 5, 0.6), offered };
}
/** Execute the step at the head (it must be `key`); the fresh read is `after`, and a move's read of the new scene follows. */
function execute(view, key, after, ok = true) {
	const run = next(view);
	assert.deepEqual([run.kind, run.item?.purpose, run.item?.candidate?.key], ["direct", "execute", key], `the clerk executes ${key}`);
	settleExecute(view, startStep(view, run), run.item, { ok, summary: {} }, fresh(after), 3);
	readOwed(view, after);
}
/** The read a step owes (a move's new scene), settled on `after`'s rows; none owed is fine. */
function readOwed(view, after) {
	const read = next(view);
	if (read.kind === "direct" && read.item?.purpose === "read") settleRead(view, startStep(view, read), { materials: [], summary: {} }, fresh(after), 0);
}
/** The same declared endpoint, positively bound: §135.11 no longer permits a route to override an unclear compile. */
const TO_HOUSE = { destination: ["house", 0.91, { house: 0.92, street: 0.06 }], act: ["investigate", 0.89] };
/** Its compile at the house: the neighbourhood 0.92 ("站在街边"), read from where the party now stands. */
const AT_HOUSE = { destination: ["street", 0.91, { street: 0.92, none: 0.08 }], act: ["investigate", 0.96] };

/** Turn 2 up to the house: the compile binds the player's house, then the move executes (refused: the party stays). */
function toTheHouse({ ok = true, compileOff = false } = {}) {
	const view = viewAt(office());
	if (compileOff) {
		view.compileOff = true;
		assert.deepEqual(routeWith(view, { [HOUSE]: ["now", 0.84], [STREET]: ["now", 0.29, { later: 0.47, now: 0.52 }] }).row.detail.selected,
			[HOUSE], "the explicit compile-off control still routes the declared house");
	} else {
		const first = compileWith(view, TO_HOUSE);
		assert.deepEqual(first.detail.selected, [HOUSE], "the compile binds the player's declared house before execution");
	}
	execute(view, HOUSE, ok ? house() : office(), ok);
	return view;
}

test("§135.30.10 policy: live turn 2 -- after the declared move, the compile at the house reads the neighbourhood and selects no second move", () => {
	const view = toTheHouse();
	assert.deepEqual(view.moved, [HOUSE], "the clerk's move carried the declaration's destination");
	const second = compileWith(view, AT_HOUSE);
	assert.deepEqual(second.detail.features.destination.row, "street", "the compile still reads what it reads");
	assert.deepEqual(second.detail.selected, [], "no second move");
	assert.ok(view.consumed.includes(STREET) && second.detail.decided.includes(OFFICE), "the first compile consumed the sibling street; the new office move is decided after arrival");
	assert.ok(view.consumed.includes(STREET) && !view.candidates.some((candidate) => candidate.family === "move"), "consumed");
	assert.deepEqual(second.detail.moved, [HOUSE], "the compile row names the run's move");
	assert.ok(second.detail.fell_through.includes("apply:clue:nailed-windows"), "the house's own steps still reach the route");
	// Control: the same answer at the house with no move this run selects the neighbourhood, as §135.30 says.
	const alone = viewAt(house());
	const control = compileWith(alone, AT_HOUSE);
	assert.deepEqual(control.detail.selected, [STREET]);
	assert.equal(control.detail.moved, undefined);
});

test("§135.30.10 policy: a refused declared move still carries the destination -- the clerk does not route around its own refusal", () => {
	const view = toTheHouse({ ok: false });
	assert.deepEqual(view.moved, [HOUSE]);
	// A later compile of the run (a read that issues a new exit, §135.30.1) reading the neighbourhood selects no move.
	const { candidates, rows } = fresh(office());
	const street = answer({ destination: [alias(rows, "destination", "street"), 0.95] });
	assert.deepEqual(interpretCompile({ candidates, rows, moved: view.moved }, street, 0.6).selected, []);
	assert.deepEqual(interpretCompile({ candidates, rows }, street, 0.6).selected.map((entry) => entry.candidate.key), [STREET], "control: no move this run");
	// With the destination unclear, the moves are decided at the compile all the same (not left to the route's need).
	const unclear = interpretCompile({ candidates, rows, moved: view.moved }, answer({ destination: [UNCLEAR, 0.9] }), 0.6);
	assert.deepEqual([unclear.decided.sort(), unclear.fellThrough.includes(STREET)], [[HOUSE, STREET], false]);
	assert.ok(interpretCompile({ candidates, rows }, answer({ destination: [UNCLEAR, 0.9] }), 0.6).fellThrough.includes(STREET), "control: undecided without a move");
});

test("§135.30.10 policy: after the run moved, the route selects no move whatever need answered, and holds it for the Keeper", () => {
	const view = toTheHouse({ compileOff: true });
	const { row, offered } = routeWith(view, { [STREET]: ["now", 0.97], [OFFICE]: ["now", 0.95], "apply:clue:nailed-windows": ["now", 0.9] });
	assert.ok(offered.some((candidate) => candidate.key === STREET), "its need question is still asked and recorded");
	assert.deepEqual(row.detail.selected, ["apply:clue:nailed-windows"], "the house's clue is still the clerk's");
	assert.deepEqual(row.detail.move_gated.sort(), [OFFICE, STREET]);
	assert.ok(view.consumed.includes(STREET) && view.consumed.includes(OFFICE), "the Keeper's for the run");
	// Control: the same route with no move this run selects the street.
	const alone = viewAt(house());
	alone.compileOff = true;
	assert.ok(routeWith(alone, { [STREET]: ["now", 0.97] }).row.detail.selected.includes(STREET));
});

test("§135.30.10 policy: only the clerk's selected move joins -- not the Keeper's own move, an owed one, or a person's own movement", () => {
	const keeper = (effects) => {
		const view = viewAt(office());
		view.pending = [{ kind: "direct", purpose: "execute", call: { method: "apply", params: { effects }, label: "apply" } }];
		const run = next(view);
		settleExecute(view, startStep(view, run), run.item, { ok: true, summary: {} }, fresh(house()), 3);
		readOwed(view, house());
		return view;
	};
	assert.equal(keeper([{ kind: "move", to: "house" }]).moved, undefined, "the Keeper's own apply move is not the declaration's selected move");
	assert.equal(keeper([{ kind: "move", to: "house", owed: "t1-c2" }]).moved, undefined, "an owed move lands what was told");
	assert.equal(keeper([{ kind: "npc", name: "Steven Knott", to: "street" }]).moved, undefined, "a person's movement moves no party");
	const after = keeper([{ kind: "move", to: "house" }]);
	assert.deepEqual(compileWith(after, AT_HOUSE).detail.selected, [STREET], "so the declaration's own move is still the clerk's to select");
});

test("§135.30.10 policy: after the run moved, a cleared held destination is not reported as the player's", () => {
	const rows = { destination: [{ id: "cellar", describe: { place: "The cellar" }, guard: { clue: { clue: "cellar-key" } } }] };
	const result = answer({ destination: ["destination_1", 0.95] });
	assert.deepEqual(interpretCompile({ candidates: [], rows }, result, 0.6).guarded?.map((entry) => entry.to), ["cellar"], "control: reported with its guard (§135.30.4)");
	assert.equal(interpretCompile({ candidates: [], rows, moved: [HOUSE] }, result, 0.6).guarded, undefined);
});

// ---------------------------------------------------------------------------------------------------
// On the emitted kernel over the haunting, through the hybrid engine: live turn 2's answers.
// ---------------------------------------------------------------------------------------------------

function kernelSteps(workspace, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign: "test-camp", ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}
const choice = ([value, confidence, probabilities]) => ({ status: "answered", type: "choice", choice: value, confidence, probabilities: probabilities ?? { [value]: confidence } });
const complete = (out) => ({ batchId: "b", status: "complete", answers: out, issues: [], coverage: { required: Object.keys(out), answered: Object.keys(out), unknown: [] } });
const place_ = (question, id) => Object.entries(question.criteria).find(([, value]) => value?.handle === id || value?.place === id)?.[0];
const GROUND = "corbitt-house-ground", NEIGHBOURHOOD = "neighborhood-gossip";
/**
 * The live turn's same declaration, with its house positively bound at the office (§135.11), staged after acceptance.
 * The commission's demand remains yes 0.92, its clues no, and the re-ask after acceptance files nothing. The house still
 * reads the neighbourhood at 0.92, preserving the original second-move pressure. Every route finishes after the compile.
 */
function declaredTurnTwo() {
	const compiles = [];
	const decide = async (batch) => {
		if (batch.family === COMPILE_FAMILY) {
			const destination = batch.questions.find((question) => question.key === "destination");
			const at = compiles.length === 0 ? "office" : place_(destination, NEIGHBOURHOOD) ? "house" : "neighbourhood";
			compiles.push(at);
			return complete(Object.fromEntries(batch.questions.map((question) => {
				if (isAskRow(question)) return [question.key, choice(at === "office" && JSON.stringify(question).includes("Accept Knott's commission") ? ["yes", 0.92] : ["no", 0.9])];
				if (question.key === "act") return [question.key, choice([Object.entries(question.criteria).find(([, value]) => typeof value === "string" && value.startsWith("investigate"))[0], 0.9])];
				if (question.key !== "destination") return [question.key, choice([UNCLEAR, 0.9])];
				const [to, p, other, q] = { office: [GROUND, 0.92, NEIGHBOURHOOD, 0.06],
					house: [NEIGHBOURHOOD, 0.92, null, 0], neighbourhood: [GROUND, 0.87, null, 0] }[at];
				const probabilities = { [place_(question, to)]: p, ...(other ? { [place_(question, other)]: q } : {}), none: Math.max(0, 1 - p - q) };
				return [question.key, choice([place_(question, to), p - 0.01, probabilities])];
			})));
		}
		// The re-ask after the accept filed nothing live.
		if (batch.family === REASK_FAMILY) return complete(Object.fromEntries(batch.questions.map((question) => [question.key, choice(["no", 0.9])])));
		return complete(Object.fromEntries(batch.questions.map((question) => {
			if (question.key === "exit") return [question.key, choice(["finish", 0.9])];
			const keys = Object.keys(question.criteria);
			return [question.key, choice([keys[0] === "now" ? "later" : question.criteria.seeks ? "not" : keys.includes("unknown") ? "unknown" : keys[0], 0.9])];
		})));
	};
	return { decide, compiles };
}

test("§135.30.10 on the emitted kernel: live turn 2's sentence with a bound endpoint moves the party once, to the house", async (t) => {
	const rows = [];
	let workspace;
	const { decide, compiles } = declaredTurnTwo();
	const engine = createHybridEngine({ env: process.env, record: (row) => rows.push(row), decision: { decide } });
	const table = await openTable({ realKernel: true, prepareWorkspace: (at) => { workspace = at; kernelSteps(at, [
		["table.open", {}], ["table.player_input", { text: "我听他说完。" }], ["table.narrate", { call_id: "t1-c1", text: "诺特把委托说了一遍。" }]]); },
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "你收下钥匙，来到科比特宅前，站在街边看着它。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt(INPUT);

	const record = JSON.parse(readFileSync(join(workspace, ".coc/campaigns/test-camp/turns/0002.json"), "utf8"));
	const moves = record.receipts.filter((receipt) => receipt.kind === "move").map((receipt) => [receipt.from, receipt.to]);
	assert.deepEqual(moves, [["commission-briefing", GROUND]], "one move: the house the player declared");
	assert.deepEqual(compiles, ["office", "house"], "positive binding stages the house after acceptance; the next compile is at the house");
	const compiled = rows.filter((row) => row.lane === "route" && row.purpose === "compile");
	assert.equal(compiled[0].features.destination.row, GROUND, "the initial compile binds the declared house");
	const atHouse = compiled[1];
	assert.equal(atHouse.features.destination.row, NEIGHBOURHOOD, "it still reads the neighbourhood at the house");
	assert.deepEqual(atHouse.selected, [], "and selects no second move");
	assert.deepEqual(atHouse.moved, [`apply:move:${GROUND}`]);
	assert.ok(rows.filter((row) => row.lane === "route" && row.purpose === "route").every((row) => !(row.selected ?? []).some((key) => key.startsWith("apply:move:"))), "later routes select no second move");
	const world = JSON.parse(readFileSync(join(workspace, ".coc/campaigns/test-camp/world.json"), "utf8"));
	assert.equal(world.active_scene, GROUND, "the party stands at the house");
});

test("§135.30.10 on the emitted kernel, the route alone: at the house the need for the neighbourhood says now, and nothing moves the party again", async (t) => {
	const rows = [];
	let workspace;
	// Turn 1 closed with the commission's leads and keys revealed (the exits are open); the compile off (the SL-12 policy).
	const decide = async (batch) => {
		const scene = batch.state?.now?.scene, candidates = batch.state?.candidates ?? {};
		return complete(Object.fromEntries(batch.questions.map((question) => {
			if (question.key === "exit") return [question.key, choice(scene === GROUND ? ["finish", 0.9] : ["continue", 0.9])];
			const to = candidates[`candidate_${question.key.slice("need_".length)}`]?.bound?.to;
			if (batch.family === ROUTE_FAMILY && scene !== GROUND && to === GROUND) return [question.key, choice(["now", 0.84])];
			if (batch.family === ROUTE_FAMILY && scene === GROUND && to === NEIGHBOURHOOD) return [question.key, choice(["now", 0.95])];
			const keys = Object.keys(question.criteria);
			return [question.key, choice([keys[0] === "now" ? "later" : question.criteria.seeks ? "not" : keys.includes("unknown") ? "unknown" : keys[0], 0.9])];
		})));
	};
	const engine = createHybridEngine({ env: process.env, record: (row) => rows.push(row), decision: { decide }, compile: false });
	const table = await openTable({ realKernel: true, prepareWorkspace: (at) => { workspace = at; kernelSteps(at, [
		["table.open", {}], ["table.player_input", { text: "我听他说完，接下委托。" }],
		["table.apply", { call_id: "t1-c1", effects: [{ kind: "clue", clue: "knott-research-leads", how: "诺特列出该去查的地方。", label: "查档的路" },
			{ kind: "clue", clue: "knott-keys", how: "诺特把钥匙和地址交给你。", label: "钥匙和地址" }] }],
		["table.narrate", { call_id: "t1-c2", text: "诺特把要查的地方一一列给你。" }]]); },
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "你来到科比特宅前，站在街边看着它。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt(INPUT);

	assert.equal(rows.filter((row) => row.lane === "route" && row.purpose === "compile").length, 0, "the compile is off");
	const record = JSON.parse(readFileSync(join(workspace, ".coc/campaigns/test-camp/turns/0002.json"), "utf8"));
	assert.deepEqual(record.receipts.filter((receipt) => receipt.kind === "move").map((receipt) => [receipt.from, receipt.to]), [["commission-briefing", GROUND]]);
	const atHouse = rows.find((row) => row.lane === "route" && row.purpose === "route" && row.offered?.includes(`apply:move:${NEIGHBOURHOOD}`)
		&& row.answers?.[`need_${row.offered.indexOf(`apply:move:${NEIGHBOURHOOD}`) + 1}`]?.choice === "now");
	assert.ok(atHouse, "the route at the house was asked about the neighbourhood, and said now");
	assert.deepEqual(atHouse.selected, [], "the engine's row selects what the policy selects: nothing");
	assert.ok(atHouse.move_gated?.includes(`apply:move:${NEIGHBOURHOOD}`), "and says why");
});
