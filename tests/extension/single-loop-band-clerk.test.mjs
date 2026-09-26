/**
 * BR-06 (contract §138.10): the clerk lands the banded time of the player's declared action and the banded damage of a
 * book-stated step that leaves its amount unstated.
 *
 * - Builder (pure): the time candidate from the `rules.bands` rows -- the road rows left out, the shadow lane's own
 *   question as its bind, a fact about the declaration as its route, the gate the engine read; never in a session,
 *   without a declaration, without rows, or once the turn holds a time receipt. The damage candidate from the kernel's
 *   `unstated_damage` row: forced, its subject the roll's actor, its bind the shadow's Score.
 * - Policy (pure): the Score bind question; a banded record with its table; the table's own gate, not the run's; below
 *   the gate or `unknown` the Keeper's (no rules default); a model-origin time consumes the candidate.
 * - Driver (vendored `runDriver`, stub ports): route → bind → the clerk writes `apply time {band}`; `unknown` → the
 *   Keeper's adjudication; a declaration judged not to cost time is never bound.
 * - Engine (hybrid engine, stub bridge): the rows read once per engine; the bind row carries the kernel's roll; the
 *   Keeper's note carries the band line.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { runDriver } from "./pi-agent-core.mjs";
import { buildCandidates, keeperCall } from "../../runtime/jev/candidates.ts";
import { damageQuestion, timeQuestion } from "../../runtime/jev/band-shadow-domain.ts";
import { bandRolls, createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { ROUTE_TRAVEL_ROWS } from "../../kernel-ts/modules/route-travel.ts";
import {
	BIND_FAMILY, bindBatch, bindingOf, CLERK_AUTHORITY, consumedByEffects, createStepPolicy, initialView, interpretBind, itemsFor, next, routeBatch, settleRead, startStep,
	TIME_CANDIDATE_KEY,
} from "../../runtime/jev/step-policy.ts";

const scope = { owner: "campaign:test", campaign: "test", worldline: "main", loop: 0, audience: "keeper" };
const context = { scene: "office", clock: null, present: [], receipts: [] };
const INPUT = "I go through every drawer of the desk";
const TIME_ROWS = [
	{ handle: "speak_briefly", min: 0, max: 3, default: 1 }, { handle: "quick_observation", min: 0, max: 5, default: 1 },
	{ handle: "single_room_search", min: 10, max: 45, default: 20 }, { handle: "careful_house_search", min: 60, max: 360, default: 120 },
	{ handle: "local_travel", min: 10, max: 120, default: 30 }, { handle: "long_travel", min: 120, max: 1440, default: 360 },
];
const DAMAGE_ROWS = [
	{ handle: "minor", dice: "1D3", note: "A person could survive numerous occurrences of this level of damage." }, { handle: "moderate", dice: "1D6" },
	{ handle: "severe", dice: "1D10" }, { handle: "deadly", dice: "2D10" }, { handle: "terminal", dice: "4D10" }, { handle: "splat", dice: "8D10" },
];
const HARM = { alias: "unstated:0", rule: "dark-ledge", step: 0, level: "failure", actor: "thomas-hayes", actor_label: "Thomas Hayes", book: "They fall into the dark.", receipt: "roll:jump-t3-c1" };
const bands = (extra = {}) => ({ time: TIME_ROWS, damage: DAMAGE_ROWS, gates: { time: 0.5, damage: 0.5 }, ...extra });
const reads = (extra = {}) => ({ capsule: {}, applyOptions: {}, resolveOptions: {}, bands: bands(), ...extra });
const timeOf = (candidates) => candidates.find((candidate) => candidate.key === TIME_CANDIDATE_KEY);
/** A complete Jev answer: `choices[name]` = [choice, confidence]. */
const answer = (choices) => ({ batchId: "b", status: "complete", issues: [], coverage: { required: [], answered: [], unknown: [] },
	answers: Object.fromEntries(Object.entries(choices).map(([key, [choice, confidence]]) => [key,
		{ status: "answered", type: "choice", choice, confidence, probabilities: { [choice]: confidence, unknown: Math.round(Math.max(0, 1 - confidence) * 100) / 100 } }])) });
/** A complete Score answer for one question: probabilities by level index. */
const scored = (key, probabilities, confidence, score) => ({ batchId: "b", status: "complete", issues: [], coverage: { required: [], answered: [], unknown: [] },
	answers: { [key]: { status: "answered", type: "score", score, confidence, legend: {}, probabilities } } });
const summary = (pending) => pending.map((item) => [item.kind, item.purpose, item.reason ?? null]);

test("§138.10 builder: the declared action's time is one candidate over the time-costs rows without the road rows, routed by a fact and bound by the shadow's question", () => {
	const candidates = buildCandidates(reads(), INPUT);
	const time = timeOf(candidates);
	assert.ok(time, "issued");
	assert.deepEqual([time.verb, time.family, time.clerk, time.source, bindingOf(time), time.forced], ["apply", "time", "declared_time", "rules.bands", "closed", undefined]);
	assert.ok(CLERK_AUTHORITY.includes(time.clerk));
	const [band] = time.unbound;
	assert.equal(band.name, "band");
	assert.deepEqual(band.options, TIME_ROWS.map((row) => row.handle).filter((handle) => !ROUTE_TRAVEL_ROWS.includes(handle)), "the road rows are the move's, never the clerk's");
	assert.ok(!band.options.includes("local_travel") && !band.options.includes("long_travel"));
	assert.deepEqual(band.band, { table: "time-costs", field: "time.band", primitive: "choice", gate: 0.5 });
	// The bind is exactly the shadow lane's time question (§138.8), so the clerk asks what the shadow measured.
	const shadow = timeQuestion(TIME_ROWS);
	assert.equal(band.instruction, shadow.instructions);
	assert.deepEqual(band.descriptions, shadow.criteria);
	assert.equal(band.descriptions.single_room_search, "single room search: 10 to 45 minutes");
	assert.equal(band.ruleDefault, undefined, "a band has no rules default (spec D4)");
	// Routed by a fact about the declaration; the `why` is composed from the player's words; the minutes are never here.
	assert.equal(time.routeFact.selects, "costs");
	assert.deepEqual(Object.keys(time.routeFact.criteria), ["costs", "none", "unknown"]);
	assert.deepEqual(time.composed, ["why"]);
	assert.equal(time.bound.why, `The time the player's declared action takes, read as a row of the time-costs table and rolled by the kernel; player: "${INPUT}"`);
	assert.deepEqual(keeperCall(time, { band: "single_room_search" }), { tool: "apply", args: { effects: [{ kind: "time", why: time.bound.why, band: "single_room_search" }] } });
	assert.ok(!("minutes" in keeperCall(time, { band: "x" }).args.effects[0]));
	// What Jev reads of it: no host key, basis, clerk or gate.
	const { batch } = routeBatch(initialView({ runId: "r", rawInput: INPUT, context, candidates, readFirst: false }), scope, []);
	const shown = JSON.stringify(batch.state) + JSON.stringify(batch.questions);
	for (const hidden of ['"basis"', '"clerk"', "declared_time", TIME_CANDIDATE_KEY, '"gate"']) assert.ok(!shown.includes(hidden), `Jev never sees ${hidden}`);
	assert.ok(batch.questions.some((question) => question.criteria.costs && question.target.includes("costs table time")), "the route asks the fact, not now/later");
});

test("§138.10 builder: no time band inside a session, without a declaration, without rows, or once the turn holds a time receipt", () => {
	const session = { kind: "combat", status: "active", round: 1, turn_of: "tom", actions: [], participants: [{ name: "tom", side: "investigator" }] };
	assert.equal(timeOf(buildCandidates(reads({ resolveOptions: { context: { session } } }), INPUT)), undefined, "a session's time is rounds");
	assert.equal(timeOf(buildCandidates(reads(), "   ")), undefined, "no declaration, no activity to judge");
	assert.equal(timeOf(buildCandidates(reads({ bands: undefined }), INPUT)), undefined, "no rows, no candidate");
	assert.equal(timeOf(buildCandidates(reads({ bands: bands({ time: [] }) }), INPUT)), undefined);
	assert.equal(timeOf(buildCandidates(reads({ bands: bands({ time: TIME_ROWS.filter((row) => ROUTE_TRAVEL_ROWS.includes(row.handle)) }) }), INPUT)), undefined, "only road rows: nothing to offer");
	assert.equal(timeOf(buildCandidates(reads({ applyOptions: { context: { current_receipts: [{ kind: "time" }] } } }), INPUT)), undefined, "time is charged once a turn");
	assert.ok(timeOf(buildCandidates(reads({ applyOptions: { context: { current_receipts: [{ kind: "move" }, { kind: "roll" }] } } }), INPUT)), "other receipts do not charge time");
	assert.equal(timeOf(buildCandidates(reads(), INPUT, new Set([TIME_CANDIDATE_KEY]))), undefined, "consumed this run");
	// A gate the engine did not read leaves the parameter to the run's gate.
	const ungated = timeOf(buildCandidates(reads({ bands: bands({ gates: undefined }) }), INPUT));
	assert.deepEqual(ungated.unbound[0].band, { table: "time-costs", field: "time.band", primitive: "choice" });
});

test("§138.10 builder: the harm a stated step leaves unstated is a forced damage candidate on the roll's actor, bound to a severity rung by the shadow's Score", () => {
	const candidates = buildCandidates(reads({ applyOptions: { unstated_damage: [HARM] } }), INPUT);
	const damage = candidates.find((candidate) => candidate.family === "damage");
	assert.ok(damage, "issued");
	assert.deepEqual([damage.key, damage.verb, damage.clerk, damage.forced, damage.source, bindingOf(damage)],
		["apply:damage:dark-ledge:thomas-hayes", "apply", "stated_hazard", true, "table.apply.options", "closed"]);
	assert.deepEqual([damage.bound.kind, damage.bound.subject], ["damage", "thomas-hayes"]);
	assert.deepEqual(damage.composed, ["why"]);
	assert.equal(damage.bound.why, `dark-ledge step 0 (failure) states harm to Thomas Hayes and leaves the amount unstated; the host read its severity as a rung of the rulebook's ladder; player: "${INPUT}"`);
	const [band] = damage.unbound;
	assert.deepEqual(band.options, DAMAGE_ROWS.map((row) => row.handle), "the ladder in the table's order");
	assert.deepEqual(band.band, { table: "hazards", field: "damage.band", primitive: "score", gate: 0.5 });
	const shadow = damageQuestion(DAMAGE_ROWS);
	assert.equal(band.instruction, shadow.instructions);
	assert.deepEqual(Object.values(band.descriptions), shadow.criteria);
	assert.equal(band.descriptions.minor, "minor, 1D3: A person could survive numerous occurrences of this level of damage.");
	assert.deepEqual(damage.detail, { rule: "dark-ledge", step: 0, level: "failure", book: "They fall into the dark." });
	assert.deepEqual(damage.basis, { read: "table.apply.options", path: "unstated_damage[0]", row: HARM });
	assert.deepEqual(keeperCall(damage, { band: "severe" }).args, { effects: [{ kind: "damage", subject: "thomas-hayes", why: damage.bound.why, band: "severe" }] });
	assert.equal(damage.label, "Thomas Hayes is hurt by dark-ledge (step 0): the book states the harm and leaves its amount unstated");
	// No rows, no candidate; a row without its rule or actor is not guessed at.
	assert.equal(buildCandidates(reads({ applyOptions: { unstated_damage: [HARM] }, bands: bands({ damage: [] }) }), INPUT).find((candidate) => candidate.family === "damage"), undefined);
	assert.equal(buildCandidates(reads({ applyOptions: { unstated_damage: [{ ...HARM, actor: "" }] } }), INPUT).find((candidate) => candidate.family === "damage"), undefined);
	// Folded into a run by a fresh read, structure puts it first as a bind: no route question.
	const view = initialView({ runId: "r", rawInput: INPUT, context, candidates: [], readFirst: false });
	settleRead(view, 1, { materials: [], summary: {} }, { context, candidates }, 0);
	assert.deepEqual(summary(view.pending).slice(0, 1), [["decide", "bind", "forced"]]);
	assert.equal(view.pending[0].candidate.key, damage.key);
	// The Score question, over the rows in order, no exit: the harm happened, only its severity is open.
	const batch = bindBatch(view, damage, scope, []);
	assert.equal(batch.questions.length, 1);
	assert.deepEqual([batch.questions[0].key, batch.questions[0].type, batch.questions[0].criteria], ["band", "score", shadow.criteria]);
	assert.equal(batch.questions[0].instructions, shadow.instructions);
	assert.ok(JSON.stringify(batch.state).includes("They fall into the dark."), "the book's line is state for the severity");
	// The time candidate's bind keeps the shadow's own unknown text as its exit.
	const time = timeOf(candidates);
	const timeBatch = bindBatch(view, time, scope, []);
	assert.equal(timeBatch.questions[0].type, "choice");
	assert.equal(timeBatch.questions[0].criteria.unknown, timeQuestion(TIME_ROWS).criteria.unknown);
	assert.ok(!("local_travel" in timeBatch.questions[0].criteria));
});

test("§138.10 policy: a band clears its table's gate, not the run's; it is recorded banded with its table; below the gate or unknown it is the Keeper's, with no default", () => {
	const time = timeOf(buildCandidates(reads(), INPUT));
	// 0.55 is under the run's 0.6 and over the table's 0.5: bound.
	const bound = interpretBind(time, { questions: [] }, answer({ band: ["single_room_search", 0.55] }), 0.6);
	assert.deepEqual(summary(bound.pending), [["direct", "execute", null]]);
	assert.deepEqual([bound.reason, bound.confidence, bound.pending[0].extra], ["bound", 0.55, { band: "single_room_search" }]);
	assert.deepEqual(bound.bindings, [{ name: "band", path: "banded", value: "single_room_search", confidence: 0.55, distribution: { single_room_search: 0.55, unknown: 0.45 }, table: "time-costs", band: "single_room_search" }]);
	assert.equal(bound.pending[0].candidate.basis.binding, undefined, "no default taken, nothing stamped");
	// Below the table's gate: the Keeper's turn, the answer on record, nothing executed.
	const low = interpretBind(time, { questions: [] }, answer({ band: ["single_room_search", 0.45] }), 0.6);
	assert.deepEqual(summary(low.pending), [["infer", "adjudicate", "clerk_unbound"]]);
	assert.deepEqual([low.pending[0].extra.cause, low.pending[0].extra.unresolved], ["low_confidence", ["band"]]);
	assert.deepEqual(low.bindings, [{ name: "band", path: "banded", value: null, confidence: 0.45, distribution: { single_room_search: 0.45, unknown: 0.55 }, table: "time-costs" }]);
	const unknown = interpretBind(time, { questions: [] }, answer({ band: ["unknown", 0.9] }), 0.6);
	assert.deepEqual([unknown.pending[0].reason, unknown.pending[0].extra.cause], ["clerk_unbound", "unknown_binding"]);
	// A row the table does not hold is not written; Jev unavailable is the Keeper's too; the run's gate applies without a table gate.
	assert.equal(interpretBind(time, { questions: [] }, answer({ band: ["mythos_study", 0.9] }), 0.6).pending[0].reason, "clerk_unbound", "a row the table does not hold is never written");
	assert.equal(interpretBind(time, { questions: [] }, { batchId: "b", status: "unavailable", answers: {}, issues: [], coverage: { required: [], answered: [], unknown: [] } }, 0.6).pending[0].extra.cause, "jev_unavailable");
	const ungated = timeOf(buildCandidates(reads({ bands: bands({ gates: undefined }) }), INPUT));
	assert.equal(interpretBind(ungated, { questions: [] }, answer({ band: ["single_room_search", 0.55] }), 0.6).reason, "clerk_unbound");
	// A Score: the argmax level is the row at that index, the distribution keyed by row, the first on a tie.
	const damage = buildCandidates(reads({ applyOptions: { unstated_damage: [HARM] } }), INPUT).find((candidate) => candidate.family === "damage");
	const severe = interpretBind(damage, { questions: [] }, scored("band", { 0: 0.1, 1: 0.2, 2: 0.5, 3: 0.1, 4: 0.05, 5: 0.05 }, 0.6, 2.15), 0.6);
	assert.deepEqual([severe.reason, severe.pending[0].extra], ["bound", { band: "severe" }]);
	assert.deepEqual(severe.bindings[0], { name: "band", path: "banded", value: "severe", confidence: 0.6, distribution: { minor: 0.1, moderate: 0.2, severe: 0.5, deadly: 0.1, terminal: 0.05, splat: 0.05 }, table: "hazards", band: "severe" });
	assert.equal(interpretBind(damage, { questions: [] }, scored("band", { 0: 0.4, 1: 0.4, 2: 0.2, 3: 0, 4: 0, 5: 0 }, 0.7, 0.8), 0.6).pending[0].extra.band, "minor", "a tie goes to the first in the table's order");
	assert.equal(interpretBind(damage, { questions: [] }, scored("band", { 0: 0.1, 1: 0.2, 2: 0.5, 3: 0.1, 4: 0.05, 5: 0.05 }, 0.3, 2.15), 0.6).pending[0].reason, "clerk_unbound");
	// Structure: never an infer(bind), forced or routed, whatever Jev says.
	for (const candidate of [time, damage]) for (const items of [itemsFor(candidate), itemsFor(candidate, "forced")]) assert.ok(!items.some((item) => item.kind === "infer" && item.purpose === "bind"));
	// A model-origin time consumes the candidate; nothing else does.
	assert.deepEqual(consumedByEffects([{ kind: "time", minutes: 30 }, { kind: "clue", clue: "c" }]), [TIME_CANDIDATE_KEY, "apply:clue:c"]);
	assert.deepEqual(consumedByEffects([{ kind: "damage", dice: "1D6" }]), []);
});

/** One run of the product policy on the vendored driver with stub ports; `infer` is the fake model engine. */
async function drive({ candidates, decide, infer }) {
	const log = [], inferred = [];
	const policy = createStepPolicy({ context, scope, candidates: [] });
	const toolResult = (proposal) => ({ role: "toolResult", toolCallId: proposal.toolCall.id, toolName: proposal.operation, content: [{ type: "text", text: "ok" }], isError: false, timestamp: 0 });
	let remaining = candidates;
	const ports = {
		clock: { now: () => 0 },
		read: { async read() { log.push("read"); return { status: "ok", artifact: { kind: "read", read: { materials: [], summary: {} }, fresh: { context, candidates: remaining } } }; } },
		decision: { async decide(request) { log.push(`decide:${request.purpose}`);
			if (!request.question?.batch) return { status: "unavailable", artifact: { reason: "no_batch" } };
			return { status: "ok", artifact: { kind: request.purpose, result: decide(request.question.batch) } }; } },
		operations: {
			async execute(proposal, invocation) {
				if (proposal.origin === "model") { log.push(`model:${proposal.operation}`); return { status: "ok", toolResult: await invocation.executeModelTool(), artifact: { kind: "execute", executed: { ok: true, summary: {} } } }; }
				if (proposal.operation === "turn_close") { log.push("turn_close"); return { status: "ok", artifact: { kind: "turn_close", verdict: { status: "none", reason: "nothing_owed" } } }; }
				const { candidate, extra, bindings } = proposal.params;
				log.push({ clerk: candidate.key, args: keeperCall(candidate, extra).args, bindings });
				remaining = remaining.filter((value) => value.key !== candidate.key);
				return { status: "ok", artifact: { kind: "execute", executed: { ok: true, summary: {} }, fresh: { context, candidates: remaining } } };
			},
		},
		record: { record: () => {} },
	};
	const engine = {
		async infer(request) {
			inferred.push(request.purpose);
			if (request.purpose === "bind") throw new Error("infer(bind) asked of the model");
			return infer(request);
		},
		async executeModelTool(proposal) { return toolResult(proposal); },
		async refuseModelTool(proposal) { return toolResult(proposal); },
		async closeTurn() { return { continueRequested: false }; },
	};
	await runDriver({ input: { runId: "r1", inputRevision: "rev", rawInput: INPUT, scopeId: "root" }, policy, ports, engine, emit: () => {}, signal: new AbortController().signal, maxSteps: 30 });
	return { log, inferred };
}
const prose = () => fauxAssistantMessage("You turn out every drawer.", { stopReason: "stop" });
const route = (fact) => (batch) => answer(Object.fromEntries(batch.questions.map((question) => [question.key, [question.key === "exit" ? "finish" : question.criteria.costs ? fact : "now", 0.95]])));

test("§138.10 on the driver: the route's fact selects the time band, Jev names the row, the clerk writes apply time {band}; unknown is the Keeper's; a declaration that costs no time is never bound", async () => {
	const [time] = buildCandidates(reads(), INPUT);
	const landed = await drive({ candidates: [time], decide: (batch) => batch.family === BIND_FAMILY ? answer({ band: ["single_room_search", 0.8] }) : route("costs")(batch), infer: prose });
	const clerk = landed.log.find((entry) => entry.clerk === TIME_CANDIDATE_KEY);
	assert.ok(clerk, "the clerk charged the time");
	assert.deepEqual(clerk.args.effects, [{ kind: "time", why: time.bound.why, band: "single_room_search" }]);
	assert.deepEqual(clerk.bindings.map((entry) => [entry.name, entry.path, entry.value, entry.table]), [["band", "banded", "single_room_search", "time-costs"]]);
	assert.deepEqual(landed.log.filter((entry) => typeof entry === "string" && entry.startsWith("decide")), ["decide:route", "decide:bind", "decide:route"]);
	assert.deepEqual(landed.inferred, ["compose"], "one model step, the compose: no bind");
	const unknown = await drive({ candidates: [time], decide: (batch) => batch.family === BIND_FAMILY ? answer({ band: ["unknown", 0.8] }) : route("costs")(batch), infer: prose });
	assert.ok(!unknown.log.some((entry) => entry.clerk), "nothing executed");
	assert.deepEqual(unknown.inferred, ["adjudicate"], "the Keeper's turn, never a bind");
	const none = await drive({ candidates: [time], decide: route("none"), infer: prose });
	assert.ok(!none.log.some((entry) => entry.clerk));
	assert.deepEqual(none.log.filter((entry) => typeof entry === "string" && entry.startsWith("decide")), ["decide:route"], "not selected: no bind, and not asked again");
	assert.deepEqual(none.inferred, ["compose"]);
});

test("§138.10 at the engine: the rows are read once, the bind row carries the kernel's roll, and the Keeper's note carries the band line", async () => {
	const handlers = new Map(), rows = [], calls = [];
	const bus = { on: (name, handler) => handlers.set(name, handler), emit: (name, value) => handlers.get(name)?.(value) };
	const engine = createHybridEngine({ env: { PI_COC_BAND_MIN_CONFIDENCE: "0.7" }, decision: null, record: (row) => rows.push(row) });
	engine.extension({ events: bus, on: () => {}, getActiveTools: () => [], setActiveTools: () => {} });
	let receipts = [];
	bus.emit("coc:kernel-bridge", { campaign: "c", call: async (method, params) => {
		calls.push([method, params]);
		if (method === "table.capsule") return { where: { scene: "office" }, present: [], _context: { version: 1, campaign: "c", worldline: "main", loop: 0, turn: 3, source_revision: "a".repeat(64) } };
		if (method === "table.status") return { turn: 3, state: "open", receipts };
		// As the kernel's own read lists them (§135.2): the turn's receipts by kind, which the builder reads for "time is charged".
		if (method === "table.apply.options") return { version: 1, candidates: [], context: { current_receipts: receipts.map((receipt) => ({ kind: receipt.kind })) } };
		if (method === "rules.bands") return params.field === "time.band" ? { field: "time.band", table: "time-costs", rows: TIME_ROWS } : { field: "damage.band", table: "hazards", rows: DAMAGE_ROWS };
		throw new Error("not here");
	} });
	bus.emit("coc:operation-dispatcher", { dispatch: async (operation) => {
		receipts = [{ id: "time:t3-c1", kind: "time", call_id: "t3-c1", minutes: 23, basis: "banded", band: operation.args.effects[0].band, band_roll: { min: 10, max: 45, total: 23 } }];
		return { status: "succeeded", receipts: ["time:t3-c1"], result: { receipts: ["time:t3-c1"] } };
	} });
	const plan = engine.runDriver.prepare({ runId: "run-1", inputRevision: "rev", rawInput: INPUT, session: {} });
	const invocation = (step) => ({ runId: "run-1", stepId: step, operationId: `${step}/op1`, origin: "policy", inputRevision: "rev", scopeId: "root", signal: new AbortController().signal });
	const read = await plan.ports.read.read({ origin: "policy", operation: "read", readOnly: true }, invocation("s1"));
	const time = timeOf(read.artifact.fresh.candidates);
	assert.ok(time, "the read issued the time candidate from the kernel's own rows");
	assert.deepEqual(time.unbound[0].band, { table: "time-costs", field: "time.band", primitive: "choice", gate: 0.7 }, "the configured gate rides on the parameter");
	await plan.ports.read.read({ origin: "policy", operation: "read", readOnly: true }, invocation("s2"));
	assert.equal(calls.filter(([method]) => method === "rules.bands").length, 2, "the two tables are read once per engine, not per read");
	const [item] = interpretBind(time, { questions: [] }, answer({ band: ["single_room_search", 0.8] }), 0.6).pending;
	const executed = await plan.ports.operations.execute({ origin: "policy", operation: "execute", params: { candidate: item.candidate, extra: item.extra, bindings: item.bindings } }, invocation("s3"));
	assert.equal(executed.status, "ok");
	const bind = rows.find((row) => row.event === "bind");
	assert.deepEqual([bind.clerk, bind.status], ["declared_time", "succeeded"]);
	assert.deepEqual(bind.bindings.map((entry) => [entry.name, entry.path]), [["why", "composed"], ["band", "banded"]]);
	assert.deepEqual(bind.bindings[1], { name: "band", path: "banded", value: "single_room_search", confidence: 0.8, distribution: { single_room_search: 0.8, unknown: 0.2 }, table: "time-costs", band: "single_room_search", roll: { min: 10, max: 45, total: 23 } });
	assert.ok(!executed.artifact.fresh.candidates.some((candidate) => candidate.key === TIME_CANDIDATE_KEY), "the fresh read holds a time receipt: time is charged");
	const [message] = plan.ports.projection.project({ view: { policyState: { view: {} } }, stepId: "s4", step: { kind: "infer", purpose: "compose", reason: "finish" } });
	const note = JSON.parse(message.content);
	assert.equal(note.clerk_did[0].binding, "band: band single_room_search (time-costs, confidence 0.80), the kernel rolled 23 minutes inside 10-45; the host read the player's declared action as this row. To rule otherwise, settle it with your own operation.");
	assert.deepEqual(note.clerk_did[0].result, { effects: [{ kind: "time", why: time.bound.why, band: "single_room_search" }] });
	// The roll reader on its own: a damage roll receipt, a record without its receipt, a record that is not banded.
	const damaged = bandRolls([{ name: "band", path: "banded", value: "severe", table: "hazards", band: "severe" }, { name: "subject", path: "stated", value: "tom" }], ["roll:damage-t3-c2", "delta:hp-t3-c2"],
		[{ id: "roll:damage-t3-c2", kind: "roll", expression: "1D10", total: 7, basis: "banded", band: "severe" }, { id: "delta:hp-t3-c2", kind: "delta", basis: "banded", band: "severe" }]);
	assert.deepEqual(damaged, [{ name: "band", path: "banded", value: "severe", table: "hazards", band: "severe", roll: { expression: "1D10", total: 7 } }, { name: "subject", path: "stated", value: "tom" }]);
	assert.deepEqual(bandRolls([{ name: "band", path: "banded", value: "severe", table: "hazards" }], [], []), [{ name: "band", path: "banded", value: "severe", table: "hazards" }]);
});
