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
import { admissionBindings, bindRecords, createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { compileAdmission } from "../../extensions/kernel/admission.ts";
import { compileRows } from "../../runtime/jev/compile-rows.ts";
import { COMPILE_FAMILY } from "../../runtime/jev/route-compile.ts";
import {
	BIND_FAMILY, CLERK_AUTHORITY, ORDINARY_CHECK_KEY, consumedByResolve, createStepPolicy, initialView, interpretBind, itemsFor, next, settleBind, settleExecute, settleOrdinaryBind, settleRead, startStep,
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
	assert.deepEqual(skill.ruleDefault, { rule: "jev_lead", fallback: { rule: "highest_offered_skill", value: "Persuade" } },
		"Jev's lead first (SL-21); Persuade 70, the highest of the four, only when Jev answers unknown or not at all");
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
	assert.equal(checkOf(morgue({ values: { Persuade: 50, Intimidate: 15, Charm: 60, "Fast Talk": 60 } })).unbound.find((value) => value.name === "skill").ruleDefault.fallback.value, "Charm");
	assert.equal(highestOffered(morgue({ values: { Persuade: 60, Intimidate: 60, Charm: 5, "Fast Talk": 5 } }), APPROACHES, "Shen"), "Persuade");
	// A value the kernel does not bind is not compared; none bound: no fallback, so Jev's unknown leaves the approach to the Keeper.
	assert.equal(highestOffered(morgue({ unbound: ["Persuade"] }), APPROACHES, "Shen"), "Fast Talk");
	const blind = checkOf(morgue({ unbound: APPROACHES }));
	assert.deepEqual(blind.unbound.find((value) => value.name === "skill").ruleDefault, { rule: "jev_lead" });
	assert.deepEqual(summary(interpretBind(blind, { questions: [] }, answer({ skill: ["unknown", 0.9], bonus: ["none", 0.9], penalty: ["none", 0.9], intent: ["social", 0.9] }), 0.6).pending),
		[["infer", "adjudicate", "clerk_unbound"]]);
});

test("§135.28: with several investigators the approach default follows the actor Jev bound; an actor Jev cannot tell has no default", () => {
	const check = checkOf(morgue({ actors: ["Shen", "Ada"], values: { Shen: { Persuade: 70, Intimidate: 15, Charm: 15, "Fast Talk": 50 }, Ada: { Persuade: 20, Intimidate: 65, Charm: 15, "Fast Talk": 50 } } }));
	assert.deepEqual(check.unbound.find((value) => value.name === "skill").ruleDefault,
		{ rule: "jev_lead", fallback: { rule: "highest_offered_skill", by: { name: "actor", values: { Shen: "Persuade", Ada: "Intimidate" } } } });
	const rest = { skill: ["unknown", 0.9], bonus: ["none", 0.9], penalty: ["none", 0.9], intent: ["social", 0.9] };
	assert.equal(interpretBind(check, { questions: [] }, answer({ actor: ["Ada", 0.9], ...rest }), 0.6).pending[0].extra.skill, "Intimidate");
	const unknownActor = interpretBind(check, { questions: [] }, answer({ actor: ["unknown", 0.9], ...rest }), 0.6);
	assert.deepEqual(summary(unknownActor.pending), [["infer", "adjudicate", "clerk_unbound"]]);
	assert.deepEqual(unknownActor.pending[0].extra.unresolved.sort(), ["actor", "skill"]);
});

/** Jev's bind answer with an explicit distribution: `[choice, confidence, probabilities]`. */
const answerWith = (choices) => ({ batchId: "b", status: "complete", issues: [], coverage: { required: [], answered: [], unknown: [] },
	answers: Object.fromEntries(Object.entries(choices).map(([key, [choice, confidence, probabilities]]) => [key,
		{ status: "answered", type: "choice", choice, confidence, probabilities: probabilities ?? { [choice]: confidence } }])) });
/** Live gate #7's investigator: Intimidate is his highest of the four; the player explained and asked. */
const HAYES = { Persuade: 40, Intimidate: 45, Charm: 35, "Fast Talk": 40 };
const GATE7_SKILL = ["Persuade", 0.59, { "Fast Talk": 0.02, unknown: 0.31, Intimidate: 0, Persuade: 0.67, Charm: 0 }];
const REST = { bonus: ["none", 0.87], penalty: ["none", 0.79], intent: ["social", 0.84] };

test("SL-21 (§135.28): Jev's leading approach under the gate is the approach -- jev_lead with its distribution, never the actor's highest skill", () => {
	const check = checkOf(morgue({ values: HAYES }));
	const bound = interpretBind(check, { questions: [] }, answerWith({ skill: GATE7_SKILL, ...REST }), 0.6);
	assert.deepEqual(summary(bound.pending), [["direct", "execute", null]]);
	const [item] = bound.pending;
	assert.equal(item.extra.skill, "Persuade", "the manner the words took, not Intimidate 45");
	assert.equal(keeperCall(item.candidate, item.extra).args.action.skill, "Persuade");
	assert.deepEqual([item.candidate.basis.binding, item.candidate.basis.rule_default], ["rule-default", { skill: { value: "Persuade", rule: "jev_lead" } }]);
	const record = item.bindings.find((entry) => entry.name === "skill");
	assert.deepEqual(record, { name: "skill", path: "rule-default", value: "Persuade", rule: "jev_lead", confidence: 0.59, distribution: GATE7_SKILL[2] });
	assert.equal(bound.reason, "bound_rule_default");
	// Far under the gate and the margin as well: any confidence.
	assert.equal(interpretBind(check, { questions: [] }, answerWith({ skill: ["Charm", 0.2, { Charm: 0.3, Persuade: 0.28, unknown: 0.25 }], ...REST }), 0.6).pending[0].extra.skill, "Charm");
	// Above the gate it is the ordinary jev path, not a default.
	const confident = interpretBind(check, { questions: [] }, answerWith({ skill: ["Persuade", 0.9], ...REST }), 0.6);
	assert.deepEqual([confident.pending[0].extra.skill, confident.pending[0].candidate.basis.binding, confident.bindings.find((entry) => entry.name === "skill").path],
		["Persuade", undefined, "jev"]);
});

test("SL-21 (§135.28): the actor's highest offered skill only when Jev answers unknown or does not answer; a lead with no fallback still binds", () => {
	const check = checkOf(morgue({ values: HAYES }));
	const unknown = interpretBind(check, { questions: [] }, answerWith({ skill: ["unknown", 0.7, { unknown: 0.7, Persuade: 0.25 }], ...REST }), 0.6);
	assert.deepEqual([unknown.pending[0].extra.skill, unknown.pending[0].candidate.basis.rule_default.skill],
		["Intimidate", { value: "Intimidate", rule: "highest_offered_skill" }], "unknown leads: the fallback, even with Persuade second");
	// No answer: the batch unavailable, or the question left unanswered.
	assert.deepEqual(summary(interpretBind(check, { questions: [] }, unavailable, 0.6).pending), [["infer", "adjudicate", "clerk_unbound"]],
		"unavailable: the intent has no default, so the check is the Keeper's");
	const unanswered = { ...answerWith(REST), answers: { ...answerWith(REST).answers, skill: { status: "unanswered" } } };
	assert.deepEqual(interpretBind(check, { questions: [] }, unanswered, 0.6).pending[0].candidate.basis.rule_default.skill, { value: "Intimidate", rule: "highest_offered_skill" });
	// A lead that is not an offered approach is no lead.
	assert.equal(interpretBind(check, { questions: [] }, answerWith({ skill: ["Dodge", 0.5], ...REST }), 0.6).pending[0].extra.skill, "Intimidate");
	// The kernel binds no value: no fallback. The lead still binds; unknown is the Keeper's.
	const blind = checkOf(morgue({ unbound: APPROACHES }));
	assert.equal(interpretBind(blind, { questions: [] }, answerWith({ skill: GATE7_SKILL, ...REST }), 0.6).pending[0].extra.skill, "Persuade");
	assert.deepEqual(summary(interpretBind(blind, { questions: [] }, answerWith({ skill: ["unknown", 0.9], ...REST }), 0.6).pending), [["infer", "adjudicate", "clerk_unbound"]]);
	// A spent Jev budget: nothing was asked, so the fallback, with no Jev call.
	const spent = initialView({ runId: "r", rawInput: INPUT, context, candidates: [], readFirst: false, budget: { maxJevCalls: 0 } });
	spent.pending = itemsFor(check);
	const request = next(spent);
	assert.equal(request.offline, "jev_budget");
	startStep(spent, request);
	settleBind(spent, 2, check, { questions: [] }, unavailable, 0, 0.6, true);
	assert.deepEqual(summary(spent.pending), [["infer", "adjudicate", "clerk_unbound"]], "the intent is still Jev's alone");
});

test("SL-21 (§32.12.1): a compile-selected check that carries the book's meeting keeps basis.compile through the hand-on and its bind, and admission reads it", () => {
	const fresh = checkOf(morgue({ values: HAYES }));
	const meeting = { key: "apply:person:Arty", verb: "apply", family: "person", label: "meet Arty", source: "t", bound: { kind: "person", who: "Arty", name: "Arty" },
		unbound: [], clerk: "stated_obligation", basis: { obligation: "access", step: "meet" } };
	const compile = { predicate: "obligation_check", features: { ask: "obligation:access", addressee: "Arty", act: "social" },
		read_features: { ask: { row: "obligation:access", confidence: 0.91, cleared: true }, addressee: { row: "Arty", confidence: 0.51, cleared: true }, act: { row: "social", confidence: 0.97, cleared: true } } };
	const selected = { ...fresh, before: meeting, basis: { ...fresh.basis, compile } };
	const items = itemsFor(selected);
	assert.deepEqual(items.map((item) => [item.kind, item.purpose, item.candidate.key, item.candidate.then, item.candidate.thenCompile]),
		[["direct", "execute", meeting.key, fresh.key, compile]], "the meeting runs first, carrying the compile's record of the check");
	const view = initialView({ runId: "r", rawInput: INPUT, context, candidates: [], readFirst: false });
	view.pending = [...items];
	startStep(view, next(view));
	// The fresh read re-issues the check under the same key, from the kernel's row, without the compile.
	settleExecute(view, 1, items[0], { ok: true, summary: {} }, { context, candidates: [fresh] }, 0);
	const [bind] = view.pending;
	assert.deepEqual([bind.kind, bind.purpose, bind.candidate.key], ["decide", "bind", fresh.key]);
	assert.deepEqual(bind.candidate.basis, { ...fresh.basis, compile }, "the fresh row, with the compile's record");
	startStep(view, next(view));
	settleBind(view, 2, bind.candidate, { questions: [] }, answerWith({ skill: GATE7_SKILL, ...REST }), 5, 0.6);
	const [execute] = view.pending;
	assert.deepEqual(execute.candidate.basis.compile, compile, "and through the bind that stamped the default");
	assert.deepEqual(execute.candidate.basis.rule_default, { skill: { value: "Persuade", rule: "jev_lead" } });
	const bindings = admissionBindings(bindRecords(execute.candidate, execute.extra, execute.bindings), execute.extra);
	const admitted = compileAdmission({ origin: "policy", basis: execute.candidate.basis, bindings });
	assert.deepEqual([admitted?.ok, admitted?.predicate, admitted?.bindingPaths?.skill], [true, "obligation_check", "rule-default"]);
	// A route selection carries no record: the check handed on is the builder's, and admission has nothing to exempt.
	const routed = itemsFor({ ...fresh, before: meeting });
	assert.equal(routed[0].candidate.thenCompile, undefined);
});

test("SL-21 (§32.12.1): a parameter the compile settled is bound again on the re-issued candidate; when it is no longer offered, the record is not carried", () => {
	const base = { key: "resolve:x", verb: "resolve", family: "combat", label: "x", source: "t", bound: { intent: "combat" }, clerk: "first_blow", basis: { read: "t" } };
	const compile = { predicate: "first_blow", features: { act: "combat", target: "Knott" }, read_features: {}, bound: { target: { value: "Knott", confidence: 0.9, distribution: null } } };
	const carriedTo = (reissued) => {
		const view = initialView({ runId: "r", rawInput: "x", context, candidates: [], readFirst: false });
		const first = { key: "first", verb: "apply", family: "person", label: "f", source: "t", bound: {}, unbound: [], clerk: "stated_obligation", then: base.key, thenCompile: compile };
		settleExecute(view, 1, { kind: "direct", purpose: "execute", candidate: first }, { ok: true, summary: {} }, { context, candidates: [reissued] }, 0);
		return view.pending[0].candidate;
	};
	const offered = carriedTo({ ...base, unbound: [{ name: "target", required: true, vocabulary: "closed", options: ["Knott", "Ruth"] }, { name: "weapon", required: true, vocabulary: "closed", options: ["unarmed", ".38"] }] });
	assert.deepEqual([offered.bound.target, offered.unbound.map((value) => value.name), offered.basis.compile], ["Knott", ["weapon"], compile]);
	const gone = carriedTo({ ...base, unbound: [{ name: "target", required: true, vocabulary: "closed", options: ["Ruth"] }] });
	assert.deepEqual([gone.bound.target, gone.basis.compile], [undefined, undefined], "fail closed: an ordinary clerk write, reviewed");
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
		{ ...base, key: `${clerk}:lead`, unbound: [{ name: "skill", required: true, vocabulary: "closed", options: ["A", "B"], ruleDefault: { rule: "jev_lead", fallback: { rule: "highest_offered_skill", value: "B" } } }] },
		{ ...base, key: `${clerk}:lead-only`, unbound: [{ name: "skill", required: true, vocabulary: "closed", options: ["A", "B"], ruleDefault: { rule: "jev_lead" } }] },
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

/**
 * SL-19 (§11.5.3 amendment): Knott's own turn with no standing action, and his card as `look focus=npc` issues it: no
 * disposition, the inference's input, and -- when the card states a tactic the table maps -- its `default`.
 */
const DISPOSITION_WORDS = ["fights_to_the_end", "fights_then_flees", "avoids_fighting", "surrenders"];
function knottsTurn({ fallback } = {}) {
	const session = { kind: "combat", status: "active", round: 1, turn_of: "steven-knott", pending_defense: null,
		participants: [{ name: "hayes", side: "investigator", hp: 12, hp_max: 12 }, { name: "steven-knott", label: "Steven Knott", side: "npc", hp: 10, hp_max: 10 }],
		actions: [{ decision: "combat:attack", actor: "steven-knott", targets: ["hayes"], weapons: ["unarmed"] }, { decision: "combat:end", actor: "steven-knott" }] };
	const fighter = { id: "steven-knott", name: "Steven Knott", combat_standing: { action: null, basis: "rule-default" },
		combat_disposition: { disposition: null, basis: null, options: Object.fromEntries(DISPOSITION_WORDS.map((word) => [word, `${word} described`])),
			material: { agenda: "Rent the house.", fear: "Losing money." }, ...(fallback ? { default: fallback } : {}) } };
	return { capsule: { where: { scene: "office" }, present: [] }, applyOptions: { candidates: [], context: {} },
		resolveOptions: { profiles: [], decisions: [], context: { session } }, fighter };
}
const KEEPER_DODGE = { disposition: "avoids_fighting", rule: "card_disposition", from: { combat_tactic: { defense: "dodge", basis: "keeper" } } };
const inferenceOf = (reads) => buildCandidates(reads, INPUT).find((candidate) => candidate.clerk === "disposition_inference");

test("SL-19: the card's stated tactic is the disposition's rules default -- taken when Jev is unknown or below the gate, never over a clearing answer", () => {
	const candidate = inferenceOf(knottsTurn({ fallback: KEEPER_DODGE }));
	const parameter = candidate.unbound.find((value) => value.name === "disposition");
	assert.equal(parameter.ruleDefault.rule, "card_disposition");
	assert.equal(parameter.ruleDefault.value, "avoids_fighting");
	assert.deepEqual(parameter.ruleDefault.read, ["combat_tactic"]);
	for (const result of [answer({ disposition: ["unknown", 0.8] }), answer({ disposition: ["surrenders", 0.4] }), unavailable]) {
		const bound = interpretBind(candidate, { questions: [] }, result, 0.6);
		assert.deepEqual(summary(bound.pending), [["direct", "execute", null]], "the clerk writes it: no Keeper step");
		const { args } = keeperCall(bound.pending[0].candidate, bound.extra);
		assert.equal(args.effects[0].disposition, "avoids_fighting");
		assert.match(args.effects[0].why, /card states their combat tactic \(dodge, keeper\).*avoids_fighting/, "the default's own why, not the inference's");
		assert.ok(points(args.effects[0].why) <= SENTENCE_MAX);
		const basis = bound.pending[0].candidate.basis;
		assert.equal(basis.binding, "rule-default");
		assert.deepEqual(basis.rule_default, { disposition: { value: "avoids_fighting", rule: "card_disposition", read: ["combat_tactic"] } });
		const record = bound.bindings.find((entry) => entry.name === "disposition");
		assert.deepEqual([record.path, record.value, record.rule], ["rule-default", "avoids_fighting", "card_disposition"]);
		assert.deepEqual(bound.bindings.find((entry) => entry.name === "why")?.path, "composed");
	}
	// Jev's word clears the gate: it is the write, with the inference's own why and no default stamped.
	const cleared = interpretBind(candidate, { questions: [] }, answer({ disposition: ["surrenders", 0.9] }), 0.6);
	const { args } = keeperCall(cleared.pending[0].candidate, cleared.extra);
	assert.equal(args.effects[0].disposition, "surrenders");
	assert.match(args.effects[0].why, /^Inferred once for this campaign/);
	assert.equal(cleared.pending[0].candidate.basis.binding, undefined);
});

test("SL-19: a card that says nothing has no default -- the Keeper is asked, as before; a default outside the offered words is none", () => {
	for (const fallback of [undefined, { ...KEEPER_DODGE, disposition: "runs_away" }, { ...KEEPER_DODGE, rule: "highest_offered_skill" }]) {
		const candidate = inferenceOf(knottsTurn({ fallback }));
		assert.equal(candidate.unbound.find((value) => value.name === "disposition").ruleDefault, undefined);
		const bound = interpretBind(candidate, { questions: [] }, answer({ disposition: ["avoids_fighting", 0.4] }), 0.6);
		assert.deepEqual(summary(bound.pending), [["infer", "adjudicate", "clerk_unbound"]]);
	}
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

// ---- SL-26 (§135.30.3): the ordinary check's bind records, and the Keeper's roll taking the check ----------------------

test("SL-26 (§135.30.3): the ordinary binder's bind records -- decision and single actor stated, the intent the compile's, the skill Jev's with whether it cleared", () => {
	const candidate = { key: ORDINARY_CHECK_KEY, verb: "resolve", family: "core-check", label: "check", source: "table.resolve.options", clerk: "declared_check",
		bound: { decision: "core-check:ordinary-check", actor: "Hayes", intent: "investigate" },
		unbound: [{ name: "profile, difficulty and modifiers", required: true, vocabulary: "closed", binder: "ordinary-resolve" }],
		basis: { compile: { predicate: "ordinary_check", features: { act: "investigate" }, bound: { intent: { value: "investigate", confidence: 0.7, distribution: { act_1: 0.72, act_3: 0.21 } } } } } };
	const action = { actor: "Hayes", intent: "social", goal: "x", method: "x", skill: "Spot Hidden", decision: "core-check:ordinary-check",
		modifiers: { difficulty: "regular", bonus_dice: 0, penalty_dice: 0, reason: "x" } };
	const bindWith = (skill) => {
		const view = initialView({ runId: "r", rawInput: "x", context, candidates: [candidate], readFirst: false });
		settleOrdinaryBind(view, 1, candidate, { disposition: "ordinary", action, unresolved: [], calls: 2, ms: 5, ...(skill ? { skill } : {}) }, 5, 0.6);
		const [item] = view.pending;
		assert.deepEqual([item.kind, item.purpose], ["direct", "execute"]);
		return { item, records: Object.fromEntries(item.bindings.map((entry) => [entry.name, entry])) };
	};
	const { item, records } = bindWith({ choice: "Spot Hidden", confidence: 0.9, probabilities: { "Spot Hidden": 0.92, unknown: 0.08 } });
	assert.equal(item.extra.intent, "investigate", "the compile's act replaces the binder's own reading (social)");
	assert.deepEqual(Object.fromEntries(Object.entries(records).map(([name, entry]) => [name, entry.path])),
		{ actor: "stated", intent: "jev", goal: "composed", method: "composed", skill: "jev", decision: "stated", modifiers: "jev" });
	assert.deepEqual([records.intent.confidence, records.intent.distribution], [0.7, { act_1: 0.72, act_3: 0.21 }], "the intent carries the compile's answer");
	assert.deepEqual([records.skill.confidence, records.skill.distribution, records.skill.cleared], [0.9, { "Spot Hidden": 0.92, unknown: 0.08 }, true]);
	assert.equal(records.actor.cleared, undefined, "only the skill carries the flag");
	assert.equal(bindWith({ choice: "Spot Hidden", confidence: 0.5, probabilities: { "Spot Hidden": 0.72, Listen: 0.2 } }).records.skill.cleared, true, "the margin rule clears it too");
	assert.equal(bindWith({ choice: "Spot Hidden", confidence: 0.45, probabilities: { "Spot Hidden": 0.5, Listen: 0.45 } }).records.skill.cleared, false, "under both gates");
	assert.equal(bindWith(undefined).records.skill.cleared, false, "no evidence from the binder: not known to have cleared");
	assert.equal(bindWith({ choice: "Listen", confidence: 0.95 }).records.skill.cleared, false, "evidence about another skill is not this skill's");
	// A route-selected check (no compile record) keeps the binder's intent.
	const plain = { ...candidate, bound: { decision: "core-check:ordinary-check", actor: "Hayes" }, basis: {} };
	const view = initialView({ runId: "r", rawInput: "x", context, candidates: [plain], readFirst: false });
	settleOrdinaryBind(view, 1, plain, { disposition: "ordinary", action, unresolved: [], calls: 2, ms: 5 }, 5, 0.6);
	assert.equal(view.pending[0].extra.intent, "social");
	assert.deepEqual(admissionBindings(bindWith({ choice: "Spot Hidden", confidence: 0.45, probabilities: { "Spot Hidden": 0.5, Listen: 0.45 } }).item.bindings, {})
		.find((entry) => entry.name === "skill"), { name: "skill", path: "jev", cleared: false }, "admission reads the flag");
});

test("SL-26 (§135.30.3): a Keeper resolve the kernel took consumes the ordinary check for the run; a refused one does not", () => {
	const check = { key: ORDINARY_CHECK_KEY, verb: "resolve", family: "core-check", label: "check", source: "t", clerk: "declared_check",
		bound: { decision: "core-check:ordinary-check" }, unbound: [{ name: "profile, difficulty and modifiers", required: true, vocabulary: "closed", binder: "ordinary-resolve" }] };
	for (const [ok, consumed] of [[true, true], [false, false]]) {
		const view = initialView({ runId: "r", rawInput: "x", context, candidates: [check], readFirst: false });
		settleExecute(view, 1, { kind: "direct", purpose: "execute", call: { method: "resolve", params: { action: { skill: "Listen", intent: "investigate" } }, label: "resolve" } },
			{ ok, summary: {} }, { context, candidates: [check] }, 0);
		assert.equal(view.consumed.includes(ORDINARY_CHECK_KEY), consumed);
		assert.equal(view.candidates.some((candidate) => candidate.key === ORDINARY_CHECK_KEY), !consumed, ok ? "not offered again this run" : "still offered");
	}
	assert.deepEqual(consumedByResolve("apply"), []);
});

test("SL-26 (owner ruling 2026-09-24): a compile-selected check whose binder said no_roll is rolled when the skill cleared, and stays unrolled when it did not; a route-selected one is unchanged", () => {
	const compiled = { predicate: "ordinary_check", features: { act: "investigate" }, bound: { intent: { value: "investigate", confidence: 1, distribution: { act_1: 1 } } } };
	const make = (basis) => ({ key: ORDINARY_CHECK_KEY, verb: "resolve", family: "core-check", label: "check", source: "t", clerk: "declared_check",
		bound: { decision: "core-check:ordinary-check", actor: "Hayes" }, unbound: [{ name: "profile, difficulty and modifiers", required: true, vocabulary: "closed", binder: "ordinary-resolve" }], basis });
	const action = { actor: "Hayes", intent: "investigate", goal: "x", method: "x", skill: "Spot Hidden", decision: "core-check:ordinary-check",
		modifiers: { difficulty: "regular", bonus_dice: 0, penalty_dice: 0, reason: "x" } };
	const noRoll = { choice: "no_roll", confidence: 0.44, probabilities: { no_roll: 0.52, ordinary: 0.46 } };
	const run = (candidate, skill) => {
		const view = initialView({ runId: "r", rawInput: "x", context, candidates: [candidate], readFirst: false });
		const row = settleOrdinaryBind(view, 1, candidate, { disposition: "ordinary", action, unresolved: [], calls: 2, ms: 5, skill, route: noRoll }, 5, 0.6);
		return { view, row };
	};
	const cleared = run(make({ compile: compiled }), { choice: "Spot Hidden", confidence: 0.9 });
	assert.deepEqual([cleared.view.pending[0]?.purpose, cleared.row.reason], ["execute", "ordinary_compile_act"]);
	assert.deepEqual(cleared.view.pending[0].candidate.basis.roll, { rule: "compile_act", binder: "no_roll", confidence: 0.44 });
	const under = run(make({ compile: compiled }), { choice: "Spot Hidden", confidence: 0.45, probabilities: { "Spot Hidden": 0.5, Listen: 0.45 } });
	assert.deepEqual([under.view.pending.length, under.row.reason, under.view.consumed.includes(ORDINARY_CHECK_KEY)], [0, "ordinary_no_roll", true], "the binder's no_roll stands");
	// Without the compile's selection the binder never reaches a profile on no_roll (rollSettled is off), and nothing here changes.
	const plain = run(make({}), { choice: "Spot Hidden", confidence: 0.9 });
	assert.deepEqual([plain.view.pending[0]?.purpose, plain.row.reason, plain.view.pending[0].candidate.basis.roll], ["execute", "ordinary_ordinary", undefined]);
});
