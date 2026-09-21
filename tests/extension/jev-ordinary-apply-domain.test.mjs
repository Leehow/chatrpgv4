import { strict as assert } from "node:assert";
import { test } from "node:test";
import { bindDecisionAnswers } from "../../runtime/jev/contracts.ts";
import { createOrdinaryApplyDomain } from "../../runtime/jev/ordinary-apply-domain.ts";
import { TaskRuntime } from "../../runtime/jev/task-runtime.ts";

class Store { records = new Map(); async load(id) { return structuredClone(this.records.get(id)); } async save(record) { this.records.set(record.checkpoint.context.id, structuredClone(record)); } }
const scope = { owner: "apply-domain", campaign: "campaign", worldline: "main", loop: 0, audience: "keeper" };
const readSet = [{ kind: "world", resource: "campaign", revision: "world-r1" }];
const rawRef = { version: 1, scope, resource: "turn:1:player", revision: "input-r1", sourceType: "turn", selector: { kind: "utf16", start: 0, end: 24 } };
const plan = { goal: "Take the research lead and go to the newspaper office.", subgoals: [], constraints: [],
	evidenceRequired: ["The clue and chosen destination both settle."], completion: ["The whole effect batch settles."],
	capabilities: ["apply"], replanWhen: [], returnWhen: [] };
const candidate = (alias, effect, description = {}) => ({ alias, effect, description: { kind: effect.kind, ...description } });
const catalog = candidates => ({ version: 1, candidates, revision: "catalog-r1", world_revision: "world-r1",
	context: { scene: "Knott's Office", pending_choice: null, session: null, present: ["Steven Knott"], current_receipts: [],
		coverage: { effect_families: ["clue", "move"], other_families: "incumbent" } } });
const packet = (proposal, result, receipts = []) => ({ operationId: proposal.id, status: "succeeded", result,
	refs: [], receipts, readSet: proposal.readSet, coverage: { used: [], omitted: [], unknown: [] } });

function result(batch, choose) {
	const raw = Object.fromEntries(batch.questions.map(question => {
		const choice = choose(question, batch);
		return [question.key, { status: "answered", type: "choice", choice,
			probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === choice ? 1 : 0])) }];
	}));
	return bindDecisionAnswers(batch, raw, { inputTokens: 1, outputTokens: 1, costUsd: 0 });
}

async function fixture({ candidates, choose, applyResult, validate = () => readSet }) {
	const calls = [], batches = [], store = new Store();
	const operations = { async validate() { return validate(); }, async dispatch(proposal) {
		calls.push(structuredClone(proposal));
		if (proposal.operation === "apply.options") return packet(proposal, catalog(candidates));
		if (proposal.operation === "apply") return packet(proposal, applyResult ?? { receipts: ["effect:batch"] }, ["effect:batch"]);
		throw new Error(`unexpected ${proposal.operation}`);
	} };
	const runtime = new TaskRuntime({ store, operations, domains: [createOrdinaryApplyDomain({ rawInput: () => "I take the lead and go to the newspaper office." })],
		decision: { async decide(batch) { batches.push(structuredClone(batch)); return result(batch, choose); } } });
	const id = await runtime.begin({ domain: "ordinary-apply", intent: { id: "intent", rawInput: rawRef, limits: [], scope, turn: 1, inputRevision: rawRef.revision },
		lease: { owner: "keeper", goal: plan.goal, scope, capabilities: ["apply"], readSet,
			budget: { deadlineAt: Date.now() + 30_000, remainingInputTokens: 100_000, remainingOutputTokens: 100_000, remainingCostUsd: 10, remainingActions: 40 } } });
	const outcome = await runtime.submit(id, plan);
	return { runtime, id, outcome, calls, batches, record: runtime.snapshot(id) };
}

const clue = candidate("effect:0", { kind: "clue", clue: "knott-research-leads" }, { name: "Research leads" });
const move = candidate("effect:1", { kind: "move", to: "newspaper-morgue" }, { display_name: "Boston Globe offices" });
const unused = candidate("effect:2", { kind: "clue", clue: "knott-commission" }, { name: "Commission" });

test("selects one complete clue-and-move batch from current aliases and applies it exactly once", async () => {
	const app = await fixture({ candidates: [clue, move, unused], choose(question) {
		if (question.key === "scope") return "covered";
		if (question.key === "batch") return "supported";
		return [clue.alias, move.alias].includes(question.key) ? "include" : "exclude";
	} });
	assert.equal(app.outcome.status, "complete");
	assert.deepEqual(app.calls.map(call => call.operation), ["apply.options", "apply"]);
	assert.deepEqual(app.calls[1].args, { effects: [clue.effect, move.effect] });
	assert.deepEqual(app.outcome.receipts, ["effect:batch"]);
	assert.deepEqual(app.batches.map(batch => batch.questions.map(question => question.key)),
		[["effect:0", "effect:1", "effect:2", "scope"], ["batch"]]);
});

for (const [name, scopeChoice, expected] of [
	["no effect", "no_effect", "complete"], ["unsupported family", "unsupported", "unresolved"],
	["missing player choice", "needs_player", "needs_player"], ["unknown coverage", "unknown", "partial"],
]) test(`${name} never commits a candidate merely because it is available`, async () => {
	const app = await fixture({ candidates: [clue, move], choose(question) {
		if (question.key === "scope") return scopeChoice;
		return "include";
	} });
	assert.equal(app.outcome.status, expected);
	if (scopeChoice === "unsupported") assert.deepEqual(app.outcome.handoff, { verbs: ["apply"] });
	assert.deepEqual(app.calls.map(call => call.operation), ["apply.options"]);
});

test("a required unresolved candidate makes the dependent whole-batch verdict refuse every effect", async () => {
	let dependent;
	const app = await fixture({ candidates: [clue, move], choose(question) {
		if (question.key === "scope") return "covered";
		if (question.key === "batch") { dependent = question; return "unsupported"; }
		return question.key === clue.alias ? "include" : "unknown";
	} });
	assert.equal(app.outcome.status, "partial");
	assert.deepEqual(app.calls.map(call => call.operation), ["apply.options"]);
	assert.ok(dependent.instructions.includes("Unresolved candidates are never executed"));
	const state = app.batches.at(-1).state;
	assert.deepEqual(state.selected.map(row => row.alias), [clue.alias]);
	assert.deepEqual(state.unresolved.map(row => row.alias), [move.alias]);
});

test("an optional unresolved briefing clue is visible to the whole-batch check but never executed", async () => {
	const briefing = [
		candidate("effect:0", { kind: "clue", clue: "knott-commission" }, { name: "Commission terms", authority: "authored_candidate_not_discovered" }),
		candidate("effect:1", { kind: "clue", clue: "knott-research-leads" }, { name: "Research leads", authority: "authored_candidate_not_discovered" }),
		candidate("effect:2", { kind: "clue", clue: "knott-macario-summary" }, { name: "Macario history if recounted", authority: "authored_candidate_not_discovered" }),
		candidate("effect:3", { kind: "clue", clue: "knott-keys" }, { name: "Money and keys", authority: "authored_candidate_not_discovered" }),
		candidate("effect:4", { kind: "move", to: "newspaper-morgue" }, { display_name: "Boston Globe offices", authority: "available_route_not_player_choice" }),
		candidate("effect:5", { kind: "move", to: "central-library" }, { display_name: "Central Library", authority: "available_route_not_player_choice" }),
	];
	const app = await fixture({ candidates: briefing, choose(question) {
		if (question.key === "scope") return "covered";
		if (question.key === "batch") return "supported";
		if (["effect:0", "effect:1"].includes(question.key)) return "include";
		if (question.key === "effect:2") return "unknown";
		return "exclude";
	} });
	assert.equal(app.outcome.status, "complete");
	assert.deepEqual(app.calls.map(call => call.operation), ["apply.options", "apply"]);
	assert.deepEqual(app.calls[1].args.effects, briefing.slice(0, 2).map(row => row.effect));
	const state = app.batches.at(-1).state;
	assert.deepEqual(state.selected.map(row => row.alias), ["effect:0", "effect:1"]);
	assert.deepEqual(state.unresolved.map(row => row.alias), ["effect:2"]);
	assert.equal(app.calls[1].args.effects.some(effect => effect.clue === "knott-macario-summary"), false);
});

for (const candidates of [
	Array.from({ length: 9 }, (_, index) => candidate(`effect:${index}`, { kind: "clue", clue: `clue-${index}` })),
	[move, candidate("effect:3", { kind: "move", to: "central-library" })],
]) test("more than eight effects or more than one move cannot become an apply batch", async () => {
	const app = await fixture({ candidates, choose(question) { return question.key === "scope" ? "covered" : "include"; } });
	assert.equal(app.outcome.status, "partial");
	assert.deepEqual(app.calls.map(call => call.operation), ["apply.options"]);
});

test("stale current catalog prevents decisions and effects", async () => {
	let validations = 0;
	const app = await fixture({ candidates: [clue], validate() {
		validations++;
		return validations >= 3 ? [{ ...readSet[0], revision: "world-r2" }] : readSet;
	}, choose() { throw new Error("stale catalog must not decide"); } });
	assert.equal(app.outcome.status, "stale");
	assert.deepEqual(app.calls.map(call => call.operation), ["apply.options"]);
});

test("malformed clue and move effects are refused before they can become an apply proposal", async () => {
	for (const malformed of [
		candidate("effect:0", { kind: "clue" }, { name: "missing clue" }),
		candidate("effect:0", { kind: "move", to: "newspaper-morgue", extra: "not allowed" }, { display_name: "Boston Globe" }),
	]) {
		const app = await fixture({ candidates: [malformed], choose(question) {
			if (question.key === "scope") return "covered";
			if (question.key === "batch") return "supported";
			return "include";
		} });
		assert.equal(app.outcome.status, "partial");
		assert.deepEqual(app.calls.map(call => call.operation), ["apply.options"]);
	}
});
