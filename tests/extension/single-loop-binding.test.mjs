/**
 * SL-12, binding without the LLM (contract §135.28; the spec's ruling "Parameter binding never goes to the LLM").
 *
 * - Rules defaults (pure): a closed parameter Jev does not settle takes its rules default -- the approach is the actor's
 *   highest current value among the offered approaches (ties: the first in the stated order), the dice words `none` --
 *   stamped `basis.binding: "rule-default"`; a target, a weapon, an actor or an intent the row does not declare has none,
 *   and the candidate is then the Keeper's turn.
 * - Composed explanations (pure): a `why` is composed from the candidate's own source and the player's words, quoted, in
 *   one sentence under the §135.21 ceiling.
 * - Structure (pure): no transition of the policy turns a clerk candidate into an `infer(bind)`, over every clerk
 *   authority, every binding shape and every Jev outcome.
 * - Driver (vendored `runDriver`, stub ports): a fake model engine that would answer an `infer(bind)` is never asked for
 *   one; the clerk rolls the defaulted approach; a spent Jev budget binds by default without a Jev question.
 * - Engine (hybrid engine, stub ports): the `lane: "run"`, `event: "bind"` row names the path of every parameter; the
 *   Keeper's note carries the rules-default line, or what the clerk left to it.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { runDriver } from "./pi-agent-core.mjs";
import { SENTENCE_MAX } from "../../extensions/kernel/tools.ts";
import { buildCandidates, keeperCall } from "../../runtime/jev/candidates.ts";
import { highestOffered, obligationCandidates } from "../../runtime/jev/obligation-candidates.ts";
import { composeSentence } from "../../runtime/jev/composed-arguments.ts";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { compileRows } from "../../runtime/jev/compile-rows.ts";
import { COMPILE_FAMILY } from "../../runtime/jev/route-compile.ts";
import {
	BIND_FAMILY, CLERK_AUTHORITY, createStepPolicy, initialView, interpretBind, itemsFor, next, settleBind, settleExecute, settleOrdinaryBind, settleRead, startStep,
} from "../../runtime/jev/step-policy.ts";

const scope = { owner: "campaign:test", campaign: "test", worldline: "main", loop: 0, audience: "keeper" };
const context = { scene: "morgue", clock: null, present: ["Arty"], receipts: [] };
const INPUT = "I ask the editor to let me into the clippings room";
const APPROACHES = ["Persuade", "Intimidate", "Charm", "Fast Talk"];
const points = (value) => Array.from(value).length;

/** The kernel's obligation row shape (§134.9) at the morgue, after the meeting: a check with four stated approaches. */
function morgue({ values = { Persuade: 70, Intimidate: 15, Charm: 15, "Fast Talk": 50 }, actors = ["Shen"], unbound = [] } = {}) {
	const row = { handle: "access", name: "Access to the clippings", who: "Arty", state: "open",
		trigger: { kind: "attempt", guards: { clues: ["story"] } },
		next: { kind: "check", target: "Arty", selection: "approach", approaches: APPROACHES.map((skill) => ({ skill })), difficulty: "regular" } };
	const profiles = actors.flatMap((actor) => APPROACHES.map((skill) => ({ actor, skill, availability: unbound.includes(skill) ? "unknown" : "bound",
		value: unbound.includes(skill) ? null : (typeof values[actor] === "object" ? values[actor][skill] : values[skill]) })));
	return { capsule: { present: [{ name: "Arty", role: "gatekeeper", called: { name: "Arty" } }] },
		applyOptions: { obligations: [row], candidates: [{ effect: { kind: "clue", clue: "story" }, description: { summary: "the 1918 story" }, guarded_by: "access" }],
			context: { present: ["Arty"] } },
		resolveOptions: { profiles } };
}
const checkOf = (reads) => obligationCandidates(reads, INPUT).find((candidate) => candidate.family === "obligation_check");
/** A complete Jev answer: `choices[name]` = [choice, confidence]. */
const answer = (choices) => ({ batchId: "b", status: "complete", issues: [], coverage: { required: [], answered: [], unknown: [] },
	answers: Object.fromEntries(Object.entries(choices).map(([key, [choice, confidence]]) => [key,
		{ status: "answered", type: "choice", choice, confidence, probabilities: { [choice]: confidence, unknown: Math.round(Math.max(0, 1 - confidence) * 100) / 100 } }])) });
const unavailable = { batchId: "b", status: "unavailable", answers: {}, issues: [], coverage: { required: [], answered: [], unknown: [] }, failure: { code: "x", retryable: false } };
const summary = (pending) => pending.map((item) => [item.kind, item.purpose, item.reason ?? null]);

test("§135.28: the approach Jev does not settle is the actor's highest offered value, stamped rule-default; the dice default to none; no LLM step", () => {
	const check = checkOf(morgue());
	const skill = check.unbound.find((value) => value.name === "skill");
	assert.deepEqual(skill.ruleDefault, { rule: "highest_offered_skill", value: "Persuade" }, "Persuade 70 is the highest of the four");
	assert.deepEqual(check.unbound.filter((value) => value.name === "bonus" || value.name === "penalty").map((value) => value.ruleDefault),
		[{ rule: "no_modifier", value: "none" }, { rule: "no_modifier", value: "none" }]);
	assert.equal(check.unbound.find((value) => value.name === "intent").ruleDefault, undefined, "the obligation row declares no intent");
	// SO-04's replay: the approach `unknown` 0.76, everything else above the gate.
	const bound = interpretBind(check, { questions: [] }, answer({ skill: ["unknown", 0.76], bonus: ["none", 0.83], penalty: ["none", 0.83], intent: ["social", 0.84] }), 0.6);
	assert.deepEqual(summary(bound.pending), [["direct", "execute", null]]);
	const [item] = bound.pending;
	assert.deepEqual([item.extra.skill, item.candidate.basis.binding, item.candidate.basis.rule_default],
		["Persuade", "rule-default", { skill: { value: "Persuade", rule: "highest_offered_skill" } }]);
	assert.equal(item.candidate.basis.obligation, "access", "the default is stamped beside the obligation on the same basis");
	const skillRecord = item.bindings.find((entry) => entry.name === "skill");
	assert.deepEqual([skillRecord.path, skillRecord.value, skillRecord.confidence, skillRecord.distribution.unknown], ["rule-default", "Persuade", 0.76, 0.24],
		"the Jev answer that did not clear stays on the record beside the default");
	assert.deepEqual(keeperCall(item.candidate, item.extra).args.action.skill, "Persuade");
	// Below the gate on the dice as well: none, by default.
	const dice = interpretBind(check, { questions: [] }, answer({ skill: ["Fast Talk", 0.9], bonus: ["one", 0.4], penalty: ["unknown", 0.9], intent: ["social", 0.9] }), 0.6);
	assert.deepEqual([dice.pending[0].extra.skill, dice.pending[0].extra.bonus, dice.pending[0].extra.penalty], ["Fast Talk", "none", "none"]);
	assert.deepEqual(dice.pending[0].candidate.basis.rule_default, { bonus: { value: "none", rule: "no_modifier" }, penalty: { value: "none", rule: "no_modifier" } });
});

test("§135.28: Jev's confident answer is the value even when it is not the highest; a tie goes to the first in the stated order", () => {
	const check = checkOf(morgue());
	const confident = interpretBind(check, { questions: [] }, answer({ skill: ["Intimidate", 0.9], bonus: ["none", 0.9], penalty: ["none", 0.9], intent: ["social", 0.9] }), 0.6);
	assert.equal(confident.pending[0].extra.skill, "Intimidate");
	assert.equal(confident.pending[0].candidate.basis.binding, undefined, "no default taken, nothing stamped");
	assert.ok(confident.bindings.every((entry) => entry.path === "jev"));
	// Ties: Charm and Fast Talk at 60 -> Charm (third, before Fast Talk); Persuade and Intimidate at 60 -> Persuade.
	assert.equal(checkOf(morgue({ values: { Persuade: 50, Intimidate: 15, Charm: 60, "Fast Talk": 60 } })).unbound.find((value) => value.name === "skill").ruleDefault.value, "Charm");
	assert.equal(highestOffered(morgue({ values: { Persuade: 60, Intimidate: 60, Charm: 5, "Fast Talk": 5 } }), APPROACHES, "Shen"), "Persuade");
	// A value the kernel does not bind is not compared; none bound: no default, so the approach is the Keeper's.
	assert.equal(highestOffered(morgue({ unbound: ["Persuade"] }), APPROACHES, "Shen"), "Fast Talk");
	const blind = checkOf(morgue({ unbound: APPROACHES }));
	assert.equal(blind.unbound.find((value) => value.name === "skill").ruleDefault, undefined);
	assert.deepEqual(summary(interpretBind(blind, { questions: [] }, answer({ skill: ["unknown", 0.9], bonus: ["none", 0.9], penalty: ["none", 0.9], intent: ["social", 0.9] }), 0.6).pending),
		[["infer", "adjudicate", "clerk_unbound"]]);
});

test("§135.28: with several investigators the approach default follows the actor Jev bound; an actor Jev cannot tell has no default", () => {
	const check = checkOf(morgue({ actors: ["Shen", "Ada"], values: { Shen: { Persuade: 70, Intimidate: 15, Charm: 15, "Fast Talk": 50 }, Ada: { Persuade: 20, Intimidate: 65, Charm: 15, "Fast Talk": 50 } } }));
	assert.deepEqual(check.unbound.find((value) => value.name === "skill").ruleDefault, { rule: "highest_offered_skill", by: { name: "actor", values: { Shen: "Persuade", Ada: "Intimidate" } } });
	const rest = { skill: ["unknown", 0.9], bonus: ["none", 0.9], penalty: ["none", 0.9], intent: ["social", 0.9] };
	assert.equal(interpretBind(check, { questions: [] }, answer({ actor: ["Ada", 0.9], ...rest }), 0.6).pending[0].extra.skill, "Intimidate");
	const unknownActor = interpretBind(check, { questions: [] }, answer({ actor: ["unknown", 0.9], ...rest }), 0.6);
	assert.deepEqual(summary(unknownActor.pending), [["infer", "adjudicate", "clerk_unbound"]]);
	assert.deepEqual(unknownActor.pending[0].extra.unresolved.sort(), ["actor", "skill"]);
});

test("§135.28: a target among several has no rules default: Jev's unknown hands the turn to the Keeper and drops the candidate for the run", () => {
	const session = { kind: "combat", status: "active", round: 2, turn_of: "tom", pending_defense: null,
		actions: [{ decision: "combat:attack", actor: "tom", targets: ["knott", "ruth"], weapons: ["unarmed"] }],
		participants: [{ name: "tom", side: "investigator" }, { name: "knott", side: "npc" }, { name: "ruth", side: "npc" }] };
	const candidates = buildCandidates({ capsule: {}, applyOptions: {}, resolveOptions: { context: { session } } }, "hit him");
	const attack = candidates.find((candidate) => candidate.bound.decision === "combat:attack");
	assert.equal(attack.unbound.find((value) => value.name === "target").ruleDefault, undefined);
	const view = initialView({ runId: "r", rawInput: "hit him", context, candidates: [], readFirst: false });
	settleRead(view, 1, { materials: [], summary: {} }, { context, candidates }, 0);
	view.pending = [{ kind: "decide", purpose: "bind", candidate: attack }];
	const request = next(view);
	startStep(view, request);
	settleBind(view, 2, attack, { questions: [] }, answer({ target: ["unknown", 0.7] }), 5, 0.6);
	assert.deepEqual(summary(view.pending), [["infer", "adjudicate", "clerk_unbound"]]);
	assert.deepEqual(view.pending[0].extra.unresolved, ["target"]);
	const keeper = next(view);
	assert.deepEqual([keeper.kind, keeper.purpose, keeper.reason], ["infer", "adjudicate", "clerk_unbound"]);
	startStep(view, keeper);
	assert.ok(view.consumed.includes(attack.key), "dropped for the run: not offered again");
	assert.ok(!view.candidates.some((candidate) => candidate.key === attack.key));
	// The player's manoeuvre and ending are not issued to the clerk at all: their goal and outcome have no source.
	const all = buildCandidates({ capsule: {}, applyOptions: {}, resolveOptions: { context: { session: { ...session, actions: [...session.actions,
		{ decision: "combat:maneuver", actor: "tom", targets: ["knott"] }, { decision: "combat:end", actor: "tom" }] } } } }, "hit him");
	assert.deepEqual(all.map((candidate) => candidate.bound.decision), ["combat:attack"]);
});

test("§135.28: a why is composed from the candidate's source and the player's words, quoted, in one sentence under the ceiling", () => {
	assert.equal(composeSentence("The book puts Arty here", "let me in"), 'The book puts Arty here; player: "let me in"');
	// Whitespace runs are one space: one sentence, not the player's paragraph layout.
	assert.equal(composeSentence("Lead", "a\n\n  b"), 'Lead; player: "a b"');
	// A long declaration is shortened at a code-point boundary and says so; the lead is kept whole.
	const long = "我".repeat(400);
	const composed = composeSentence("The table's own label for Arty", long);
	assert.equal(points(composed), SENTENCE_MAX);
	assert.ok(composed.startsWith('The table\'s own label for Arty; player: "我'));
	assert.ok(composed.endsWith('..."'));
	// A lead that alone passes the ceiling is shortened and carries no quote.
	assert.equal(points(composeSentence("x".repeat(500), "words")), SENTENCE_MAX);
	// The candidates carry it bound, marked composed; no explanatory parameter is left open.
	const reads = { ...morgue(), capsule: { present: [{ name: "Arty", role: "gatekeeper", untold: { label: "the editor" } }] },
		applyOptions: { ...morgue().applyOptions, obligations: [{ ...morgue().applyOptions.obligations[0], next: { kind: "meet", person: "Arty" }, then: morgue().applyOptions.obligations[0].next }] } };
	const meeting = checkOf(reads).before;
	assert.equal(meeting.bound.why, `The book puts Arty here for "Access to the clippings", named by the table's own label; player: "${INPUT}"`);
	assert.deepEqual(meeting.composed, ["why"]);
	const person = buildCandidates({ capsule: { present: [{ name: "Ruth", role: "archivist", untold: { label: "the archivist" } }] }, applyOptions: {}, resolveOptions: {} }, long)
		.find((candidate) => candidate.family === "person");
	assert.ok(points(person.bound.why) <= SENTENCE_MAX);
	assert.match(person.bound.why, /^The table's own label for Ruth in this scene, staged for the player's declared action; player: "我+\.\.\."$/);
	for (const candidate of [meeting, person]) assert.ok(!candidate.unbound.some((value) => ["why", "how", "goal"].includes(value.name)), `${candidate.key}: nothing explanatory left open`);
});

/** Every clerk candidate shape the builder can issue, bound or not, for the structural test. */
function shapes(clerk) {
	const base = { verb: "resolve", family: "x", label: "x", source: "t", bound: {}, clerk, basis: { read: "t" } };
	return [
		{ ...base, key: `${clerk}:none`, unbound: [] },
		{ ...base, key: `${clerk}:open`, unbound: [{ name: "goal", required: true, vocabulary: "open" }] },
		{ ...base, key: `${clerk}:mixed`, unbound: [{ name: "target", required: true, vocabulary: "closed", options: ["a", "b"] }, { name: "goal", required: true, vocabulary: "open" }] },
		{ ...base, key: `${clerk}:closed`, unbound: [{ name: "target", required: true, vocabulary: "closed", options: ["a", "b"] }] },
		{ ...base, key: `${clerk}:defaulted`, unbound: [{ name: "skill", required: true, vocabulary: "closed", options: ["A", "B"], ruleDefault: { rule: "highest_offered_skill", value: "B" } }] },
		{ ...base, key: `${clerk}:ordinary`, unbound: [{ name: "profile, difficulty and modifiers", required: true, vocabulary: "closed", binder: "ordinary-resolve" }] },
		{ ...base, key: `${clerk}:variants`, unbound: [{ name: "decision", required: true, vocabulary: "closed", options: ["d:attack", "d:maneuver"] }], forced: true,
			variants: { "d:attack": { label: "attack", bound: { decision: "d:attack" }, unbound: [{ name: "target", required: true, vocabulary: "closed", options: ["a", "b"] }] },
				"d:maneuver": { label: "maneuver", bound: { decision: "d:maneuver" }, unbound: [{ name: "goal", required: true, vocabulary: "open" }] } } },
		{ ...base, key: `${clerk}:carried`, unbound: [{ name: "goal", required: true, vocabulary: "open" }], before: { ...base, key: `${clerk}:before`, unbound: [{ name: "name", required: true, vocabulary: "open" }] } },
	];
}
const inferBind = (items) => items.filter((item) => item.kind === "infer" && item.purpose === "bind");

test("§135.28 structure: no transition of the policy turns a clerk candidate into an infer(bind), for every authority, shape and Jev outcome", () => {
	const outcomes = [
		unavailable,
		answer({ target: ["unknown", 0.9], skill: ["unknown", 0.9], decision: ["unknown", 0.9] }),
		answer({ target: ["a", 0.3], skill: ["A", 0.3], decision: ["d:attack", 0.3] }),
		answer({ target: ["a", 0.9], skill: ["A", 0.9], decision: ["d:maneuver", 0.9] }),
		answer({ target: ["unknown", 0.9], skill: ["A", 0.9], decision: ["d:attack", 0.9] }),
	];
	const dispositions = ["ordinary", "no_roll", "needs_player", "incumbent", "unknown", "unavailable"];
	let checked = 0;
	for (const clerk of CLERK_AUTHORITY) for (const candidate of shapes(clerk)) {
		// Issuing it: routed, forced by a fresh read, or handed on after a carried step.
		assert.deepEqual(inferBind(itemsFor(candidate)), [], `${candidate.key}: itemsFor`);
		assert.deepEqual(inferBind(itemsFor(candidate, "forced")), [], `${candidate.key}: forced`);
		// Binding it, whatever Jev says (or does not).
		for (const result of outcomes) {
			assert.deepEqual(inferBind(interpretBind(candidate, { questions: [] }, result, 0.6).pending), [], `${candidate.key}: interpretBind`);
			checked++;
		}
		for (const disposition of dispositions) {
			const view = initialView({ runId: "r", rawInput: "x", context, candidates: [], readFirst: false });
			settleOrdinaryBind(view, 1, candidate, { disposition, ...(disposition === "ordinary" ? { action: { skill: "Spot Hidden" } } : {}), unresolved: [], calls: 1, ms: 1 }, 1);
			assert.deepEqual(inferBind(view.pending), [], `${candidate.key}: ordinary ${disposition}`);
		}
		// A spent Jev budget: the bind is settled offline, never escalated to the LLM.
		const spent = initialView({ runId: "r", rawInput: "x", context, candidates: [], readFirst: false, budget: { maxJevCalls: 0 } });
		spent.pending = itemsFor(candidate);
		for (let guard = 0; guard < 6 && spent.pending.length; guard++) {
			const request = next(spent);
			assert.ok(!(request.kind === "infer" && request.purpose === "bind"), `${candidate.key}: next past the Jev budget`);
			if (request.kind !== "decide" || request.purpose !== "bind") break;
			assert.equal(request.offline, "jev_budget");
			startStep(spent, request);
			if (candidate.unbound.some((value) => value.binder)) settleOrdinaryBind(spent, 2, request.item.candidate, { disposition: "unavailable", unresolved: ["jev_budget"], calls: 0, ms: 0 }, 0);
			else settleBind(spent, 2, request.item.candidate, { questions: [] }, unavailable, 0, 0.6, true);
			assert.deepEqual(inferBind(spent.pending), [], `${candidate.key}: offline bind`);
		}
		assert.equal(spent.budget.jevCalls, 0, "an offline bind spends no Jev call");
		// A fresh read that forces it, and a carried step that hands on to it.
		const fresh = initialView({ runId: "r", rawInput: "x", context, candidates: [], readFirst: false });
		settleRead(fresh, 1, { materials: [], summary: {} }, { context, candidates: [{ ...candidate, forced: true }] }, 0);
		const carried = initialView({ runId: "r", rawInput: "x", context, candidates: [], readFirst: false });
		settleExecute(carried, 1, { kind: "direct", purpose: "execute", candidate: { ...candidate, key: "first", then: candidate.key } }, { ok: true, summary: {} }, { context, candidates: [candidate] }, 0);
		assert.deepEqual(inferBind([...fresh.pending, ...carried.pending]), [], `${candidate.key}: fresh read and carried step`);
	}
	assert.equal(checked, CLERK_AUTHORITY.length * shapes("x").length * outcomes.length);
	// The one remaining infer(bind): a candidate without clerk authority (the prototype's; a Keeper-proposed operation).
	assert.deepEqual(summary(itemsFor({ ...shapes("x")[1], clerk: undefined })), [["infer", "bind", "open_parameters"], ["direct", "llm_proposal", null]]);
});

/** One run of the product policy on the vendored driver with stub ports; `infer` is the fake model engine. */
async function drive({ candidates, decide, infer, budget = {}, rows }) {
	const log = [], events = [], inferred = [];
	const policy = createStepPolicy({ context, scope, candidates: [], budget });
	const toolResult = (proposal) => ({ role: "toolResult", toolCallId: proposal.toolCall.id, toolName: proposal.operation, content: [{ type: "text", text: "ok" }], isError: false, timestamp: 0 });
	let remaining = candidates;
	const ports = {
		clock: { now: () => 0 },
		read: { async read() { log.push("read"); return { status: "ok", artifact: { kind: "read", read: { materials: [], summary: {} }, fresh: { context, candidates: remaining, ...(rows ? { rows } : {}) } } }; } },
		decision: { async decide(request) { log.push(`decide:${request.purpose}${request.question?.offline ? ":offline" : ""}`);
			if (!request.question?.batch) return { status: "unavailable", artifact: { reason: "no_batch" } };
			return { status: "ok", artifact: { kind: request.purpose, result: decide(request.question.batch) } }; } },
		operations: {
			async execute(proposal, invocation) {
				if (proposal.origin === "model") { log.push(`model:${proposal.operation}`); return { status: "ok", toolResult: await invocation.executeModelTool(), artifact: { kind: "execute", executed: { ok: true, summary: {} } } }; }
				if (proposal.operation === "turn_close") { log.push("turn_close"); return { status: "ok", artifact: { kind: "turn_close", verdict: { status: "none", reason: "nothing_owed" } } }; }
				const { candidate, extra, bindings } = proposal.params;
				log.push({ clerk: candidate.key, args: keeperCall(candidate, extra).args, basis: candidate.basis, bindings });
				remaining = remaining.filter((value) => value.key !== candidate.key);
				return { status: "ok", artifact: { kind: "execute", executed: { ok: true, summary: {} }, fresh: { context, candidates: remaining } } };
			},
		},
		record: { record: (event) => events.push(event) },
	};
	const engine = {
		async infer(request) {
			inferred.push(request.purpose);
			// The fake port that would answer an infer(bind): it must never be asked.
			if (request.purpose === "bind") throw new Error("infer(bind) asked of the model");
			return infer(request);
		},
		async executeModelTool(proposal) { return toolResult(proposal); },
		async refuseModelTool(proposal) { return toolResult(proposal); },
		async closeTurn() { return { continueRequested: false }; },
	};
	await runDriver({ input: { runId: "r1", inputRevision: "rev", rawInput: INPUT, scopeId: "root" }, policy, ports, engine, emit: () => {}, signal: new AbortController().signal, maxSteps: 30 });
	return { log, events, inferred };
}
const prose = () => fauxAssistantMessage("The editor waves you through.", { stopReason: "stop" });
/**
 * Compile (§135.30): the ask cleared on the obligation's demand (the row whose words carry `demand`), the addressee on
 * nobody's side (`none` is a guard; left unclear here), the rest unclear. Route: `seeks`/`now` for every candidate question,
 * `finish` after -- since the §135.30 addendum the `seeks` answer selects nothing, so the compile is what selects the check.
 */
const demandAlias = (question) => Object.entries(question.criteria).find(([, value]) => value && typeof value === "object" && "demand" in value)?.[0];
const routeAll = (batch) => batch.family === COMPILE_FAMILY
	? answer(Object.fromEntries(batch.questions.map((question) => [question.key, question.key === "ask" ? [demandAlias(question), 0.95] : ["unclear", 0.9]])))
	: answer(Object.fromEntries(batch.questions.map((question) => [question.key,
		[question.key === "exit" ? "finish" : question.criteria.seeks ? "seeks" : "now", 0.95]])));
const unknownAll = (batch) => answer(Object.fromEntries(batch.questions.map((question) => [question.key, ["unknown", 0.8]])));

test("§135.28 on the driver: Jev unknown on every closed parameter -- the clerk rolls the defaulted approach, the fake infer(bind) port is never asked", async () => {
	const check = checkOf(morgue());
	// The intent is Jev's alone: give it an answer, as SO-04's replay did (social 0.84), and nothing else.
	const { log, inferred } = await drive({ candidates: [check], rows: compileRows(morgue()),
		decide: (batch) => batch.family === BIND_FAMILY ? answer({ skill: ["unknown", 0.8], bonus: ["unknown", 0.8], penalty: ["unknown", 0.8], intent: ["social", 0.84] }) : routeAll(batch),
		infer: prose });
	const clerk = log.find((entry) => entry.clerk === check.key);
	assert.ok(clerk, "the clerk rolled the obligation check");
	assert.deepEqual([clerk.args.action.skill, clerk.args.action.intent, clerk.args.action.modifiers], ["Persuade", "social", undefined], "no dice: the default is none");
	assert.equal(clerk.basis.binding, "rule-default");
	assert.deepEqual(clerk.bindings.map((entry) => [entry.name, entry.path]), [["skill", "rule-default"], ["bonus", "rule-default"], ["penalty", "rule-default"], ["intent", "jev"]]);
	assert.deepEqual(inferred, ["compose"], "one model step, the compose: no bind");
});

test("§135.28 on the driver: a clerk candidate without a default goes to the Keeper as an adjudication; a spent Jev budget binds by default with no Jev question", async () => {
	const check = checkOf(morgue());
	const unknown = await drive({ candidates: [check], rows: compileRows(morgue()), decide: (batch) => batch.family === BIND_FAMILY ? unknownAll(batch) : routeAll(batch), infer: prose });
	assert.ok(!unknown.log.some((entry) => entry.clerk), "the intent has no default: nothing executed");
	assert.deepEqual(unknown.inferred, ["adjudicate"], "the Keeper's turn, never a bind");
	// Past the Jev budget (spent by the compile that selected it), the bind is offline: no Jev call; the intent has no
	// default, so the Keeper; a candidate whose every closed parameter has a default is bound by the rules default alone.
	const defaulted = { ...check, key: "resolve:obligation:all-defaults", unbound: check.unbound.filter((value) => value.name !== "intent"), bound: { ...check.bound, intent: "social" } };
	const spent = await drive({ candidates: [defaulted], rows: compileRows(morgue()), budget: { maxJevCalls: 1 }, decide: routeAll, infer: prose });
	assert.deepEqual(spent.log.filter((entry) => typeof entry === "string" && entry.startsWith("decide")), ["decide:compile", "decide:bind:offline"], "no Jev question for the bind");
	const clerk = spent.log.find((entry) => entry.clerk);
	assert.deepEqual([clerk?.args.action.skill, clerk?.basis.binding], ["Persuade", "rule-default"]);
	assert.ok(!spent.inferred.includes("bind"));
});

test("§135.28 at the engine: the bind row names every parameter's path; the Keeper's note carries the default, or what the clerk left to it", async () => {
	const handlers = new Map(), rows = [];
	const bus = { on: (name, handler) => handlers.set(name, handler), emit: (name, value) => handlers.get(name)?.(value) };
	const engine = createHybridEngine({ env: {}, decision: null, record: (row) => rows.push(row) });
	engine.extension({ events: bus, on: () => {}, getActiveTools: () => [], setActiveTools: () => {} });
	bus.emit("coc:kernel-bridge", { campaign: "c", call: async (method) => method === "table.capsule"
		? { where: { scene: "morgue" }, present: [], _context: { version: 1, campaign: "c", worldline: "main", loop: 0, turn: 3, source_revision: "a".repeat(64) } }
		: method === "table.status" ? { turn: 3, state: "open", receipts: [] } : {} });
	bus.emit("coc:operation-dispatcher", { dispatch: async () => ({ status: "succeeded", receipts: ["roll-1"], result: { outcome: { skill: "Persuade", passed: true } } }) });
	const plan = engine.runDriver.prepare({ runId: "run-1", inputRevision: "rev", rawInput: INPUT, session: {} });
	const invocation = (step) => ({ runId: "run-1", stepId: step, operationId: `${step}/op1`, origin: "policy", inputRevision: "rev", scopeId: "root", signal: new AbortController().signal });
	await plan.ports.read.read({ origin: "policy", operation: "read", readOnly: true }, invocation("s1"));
	const check = checkOf(morgue());
	const [item] = interpretBind(check, { questions: [] }, answer({ skill: ["unknown", 0.76], bonus: ["none", 0.83], penalty: ["none", 0.83], intent: ["social", 0.84] }), 0.6).pending;
	await plan.ports.operations.execute({ origin: "policy", operation: "execute", params: { candidate: item.candidate, extra: item.extra, bindings: item.bindings } }, invocation("s2"));
	const bind = rows.find((row) => row.event === "bind");
	assert.deepEqual(bind.bindings.map((entry) => [entry.name, entry.path]), [["obligation", "stated"], ["target", "stated"], ["actor", "stated"], ["goal", "composed"], ["method", "composed"],
		["skill", "rule-default"], ["bonus", "jev"], ["penalty", "jev"], ["intent", "jev"]]);
	assert.deepEqual(bind.bindings.find((entry) => entry.name === "intent").distribution, { social: 0.84, unknown: 0.16 }, "Jev's answer keeps its distribution");
	const [message] = await plan.ports.projection.project({ view: { policyState: { view: {} } }, stepId: "s3", step: { kind: "infer", purpose: "compose", reason: "finish" } });
	const note = JSON.parse(message.content);
	assert.match(note.clerk_did[0].binding, /^rules default: skill Persuade \(the investigator's highest of the offered skills\); the player's words did not settle it/);
	// What the clerk could not bind reaches the Keeper as its own turn: left_to_you, and a bind row with outcome keeper.
	const [dropped] = interpretBind(check, { questions: [] }, answer({ skill: ["unknown", 0.76], bonus: ["none", 0.83], penalty: ["none", 0.83], intent: ["unknown", 0.7] }), 0.6).pending;
	const view = initialView({ runId: "r", rawInput: INPUT, context, candidates: [], readFirst: false });
	view.pending = [dropped];
	const policy = createStepPolicy({ context, scope, candidates: [] });
	const request = policy.next({ pendingProposals: [], policyState: { view, gate: 0.6 }, observations: [], steps: 0, pendingRequirements: [] });
	assert.deepEqual([request.kind, request.purpose, request.reason], ["infer", "adjudicate", "clerk_unbound"]);
	const [left] = await plan.ports.projection.project({ view: { policyState: { view } }, stepId: "s4", step: { purpose: request.purpose, reason: request.reason, request: request.request } });
	const leftNote = JSON.parse(left.content);
	assert.deepEqual([leftNote.left_to_you.unresolved, leftNote.left_to_you.operation.verb], [["intent"], "resolve"]);
	assert.equal(leftNote.complete, undefined, "never the parameter-filling request of an infer(bind)");
	assert.deepEqual(rows.filter((row) => row.event === "bind").at(-1).outcome, "keeper");
	assert.ok(!rows.some((row) => row.event === "llm_bound"));
});
