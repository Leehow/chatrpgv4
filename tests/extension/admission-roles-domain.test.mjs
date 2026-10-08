/**
 * SL-97 phase 2b (contract §32.12.3.2): the role-first typed admission design as the product ships it
 * (`runtime/jev/admission-roles-domain.ts`).
 *
 * - The request retains measured revision 2a.3 except explicit handover semantics and the current-execution boundary.
 *   The historical experiment requests are never edited to match the product.
 * - The host arithmetic: the role mixture, the weakest-judgment min over gate and order, the two-option confidence, and
 *   the lane-shaped verdict of each line.
 * - The family interface: every non-verdict is a named fallback, as §32.10's v1.
 *
 * Synthetic input only, no call.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { packDecisionBatch } from "../../runtime/jev/question-packing.ts";
import {
	ADMISSION_ROLES_FAMILIES,
	ADMISSION_ROLES_FAMILY,
	ADMISSION_ROLES_VERSION,
	admissionRolesBatches,
	admissionRolesBindings,
	rolesAdmitProbability,
	rolesConfidence,
	rolesLineVerdict,
	runAdmissionRoles,
} from "../../runtime/jev/admission-roles-domain.ts";
import { rolesBatches } from "../../experiments/admission-jev-bank/admission-roles.ts";
import { PLAYER_EXECUTION_CHOICE_NOTE } from "../../runtime/jev/action-field-semantics.ts";

const kindOf = (line) => line.startsWith("resolve") ? "resolve" : line.slice("apply ".length, line.indexOf(":"));
const input = (overrides = {}) => {
	const proposal = overrides.proposal ?? ['apply time: minutes=45; why="Travel back to Knott\'s office."', 'apply clue: clue="corbitt-diaries"; from="Steven Knott"'];
	return {
		campaign: "c1", turn: 8, tool: "apply", proposal, kinds: proposal.map(kindOf),
		playerText: "我回诺特办公室，把查到的告诉他。然后问他那栋房子的事。",
		investigators: [{ name: "Thomas Hayes", occupation: "journalist" }], scene: "Knott's office", present: ["Steven Knott"],
		delivered: [
			{ turn: 6, player: "我去档案馆。", keeper: "The clerk slides the ledger across the counter. The Corbitt entries stop in 1918." },
			{ turn: 7, player: "我看完就回去。", keeper: "The afternoon light is going. Knott said he would be in his office until six." },
		],
		landed: [], refused: [], ...overrides,
	};
};
const options = (name) => name === "role" ? ["investigator_act", "world_response", "time_passing"] : ADMISSION_ROLES_FAMILIES.find((family) => family.name === name).options;
const full = (name, chosen, p = 1) => Object.fromEntries(options(name).map((option) => [option, option === chosen ? p : 0]));
function lease(value) {
	const bindings = admissionRolesBindings(value);
	return new TaskLease({ owner: ADMISSION_ROLES_FAMILY, goal: "test", scope: bindings.scope, capabilities: ["decision"], readSet: bindings.readSet,
		budget: { deadlineAt: Date.now() + 5000, remainingInputTokens: 400000, remainingOutputTokens: 40000, remainingCostUsd: 1, remainingActions: 8 } });
}
/** A port answering every question from `pick(question) -> probabilities` (the choice is the most probable option). */
const port = (pick) => ({ calls: 0, async decide(batch) {
	this.calls++;
	const answers = Object.fromEntries(batch.questions.map((question) => {
		const probabilities = pick(question);
		const choice = Object.entries(probabilities).reduce((a, b) => b[1] > a[1] ? b : a)[0];
		return [question.key, { status: "answered", type: "choice", choice, confidence: probabilities[choice], probabilities }];
	}));
	const keys = batch.questions.map((question) => question.key);
	return { batchId: batch.id, status: "complete", answers, issues: [], coverage: { required: keys, answered: keys, unknown: [] } };
} });
/** Every line's questions answered fully admitting, except `line`'s choice at `p` chosen / 1-p keeper's choice. */
const answering = (line, p, extra = {}) => (question) => {
	const family = question.key.slice(0, question.key.lastIndexOf("_")), index = Number(question.key.slice(question.key.lastIndexOf("_") + 1));
	const keys = Object.keys(question.criteria);
	if (family === "missing") return Object.fromEntries(keys.map((key) => [key, key === (extra.missing ?? "none") ? 1 : 0]));
	if (family === "basis") return Object.fromEntries(keys.map((key) => [key, key === (extra.basis ?? "none") ? 1 : 0]));
	if (family === "role") return full("role", "investigator_act");
	if (family === "choice" && index === line) return { chosen: p, routine_step: 0, keeper_choice: 1 - p, unclear: 0 };
	return full(family, ADMISSION_ROLES_FAMILIES.find((row) => row.name === family).admitting[0]);
};

// ---- the measured request ------------------------------------------------------------------------------------------------

test("§32.12.3.2: only handover semantics and the execution-choice question differ from measured requests", () => {
	const cases = [
		input(),
		input({ proposal: ['apply time: minutes=10; why="search"'] }),
		input({ tool: "resolve", proposal: ['resolve (roll the dice for an action): intent="social"; skill="Persuade"; target="Steven Knott"'] }),
		input({ interruptedPlayerText: "我想先去报社。", bookText: [{ where: "scene knott-office", text: "Steven Knott waits in his office." }] }),
		input({ delivered: [], landed: ["resolve settled (social)"], refused: ["apply move: to=\"asylum\" -> not_authorized: the player has not chosen this destination"] }),
		input({ proposal: Array.from({ length: 8 }, (_, index) => `apply clue: clue="clue-${index}"; how="${"a long rationale ".repeat(40)}"`) }),
	];
	for (const value of cases) {
		// The experiment read each line's kind off the host's line grammar; the product carries the proposal's own kinds.
		const product = admissionRolesBatches({ ...value, kinds: value.tool === "apply" ? value.kinds : undefined });
		const { kinds: _kinds, ...measured } = value;
		const experiment = rolesBatches(measured, undefined, { revision: "2a.3" });
		const expectedRequests = experiment.batches.map((batch) => packDecisionBatch(batch).request);
		const expectedQuestions = Object.assign({}, ...expectedRequests.map((request) => request.questions));
		const actualQuestions = {};
		for (const batch of product.batches) {
			const actual = structuredClone(packDecisionBatch(batch).request);
			assert.ok(actual.state.fieldNotes.handover.includes("consent ground"));
			delete actual.state.fieldNotes.handover;
			for (const [key, question] of Object.entries(actual.questions)) {
				if (!key.startsWith("choice_")) continue;
				assert.ok(question.instructions.instruction.endsWith(` ${PLAYER_EXECUTION_CHOICE_NOTE}`));
				question.instructions.instruction = question.instructions.instruction.slice(0, -(PLAYER_EXECUTION_CHOICE_NOTE.length + 1));
				assert.match(question.criteria.chosen.what, /choose execution of this action now/);
				assert.match(question.criteria.chosen.not_for, /utterance itself may be chosen/);
				question.criteria.chosen = expectedQuestions[key].criteria.chosen;
			}
			assert.deepEqual(actual.state, expectedRequests[0].state);
			assert.equal(actual.model, expectedRequests[0].model);
			Object.assign(actualQuestions, actual.questions);
			assert.deepEqual([batch.family, batch.familyVersion], [experiment.batches[0].family, "2a.5"]);
		}
		// The added policy can change byte-bounded batch cuts, but never drops or adds a semantic question.
		assert.deepEqual(actualQuestions, expectedQuestions);
		assert.deepEqual([...product.passages.keys()], [...experiment.passages.keys()]);
	}
	assert.deepEqual([ADMISSION_ROLES_FAMILY, ADMISSION_ROLES_VERSION], ["action-admission-roles", "2a.5"]);
});

test("§32.12.3.2: per line the design asks role, choice, result, span, target, gate, order, missing and basis; each line carries its closed kind", () => {
	const { batches: [batch] } = admissionRolesBatches(input());
	assert.deepEqual(batch.questions.map((question) => question.key),
		["role_0", "choice_0", "result_0", "span_0", "target_0", "gate_0", "order_0", "missing_0", "basis_0",
			"role_1", "choice_1", "result_1", "span_1", "target_1", "gate_1", "order_1", "missing_1", "basis_1"]);
	assert.deepEqual(batch.state.proposal.map((line) => line.kind), ["time", "clue"]);
	assert.equal(batch.state.rules, undefined, "policy lives in the questions, not in state");
});

// ---- the host arithmetic -------------------------------------------------------------------------------------------------

test("§32.12.3.2: P(admit) is the role mixture capped by the weakest of gate and order; confidence is |2p - 1|", () => {
	const answers = {
		role: { investigator_act: 0.5, world_response: 0.25, time_passing: 0.25 },
		choice: { chosen: 0.6, routine_step: 0.2, keeper_choice: 0.2, unclear: 0 },
		target: { addressed: 0.9, no_target: 0, not_addressed: 0.1 },
		result: { answers_player: 0.4, world_on_its_own: 0.4, needs_unchosen_act: 0.2, unclear: 0 },
		span: { activity_time: 0.5, imposed_time: 0.1, unchosen_time: 0.4, unclear: 0 },
		gate: full("gate", "no_obstacle"), order: full("order", "in_step"),
	};
	// act: min(0.8, 0.9) = 0.8; world 0.8; time 0.6 -> 0.5*0.8 + 0.25*0.8 + 0.25*0.6 = 0.75.
	assert.equal(rolesAdmitProbability(answers), 0.75);
	assert.equal(rolesAdmitProbability({ ...answers, gate: { no_obstacle: 0.3, player_takes_it_on: 0.3, skips_obstacle: 0.4 } }), 0.6, "gate caps it");
	assert.equal(rolesAdmitProbability({ ...answers, order: { in_step: 0.2, ahead_of_plan: 0.8 } }), 0.2, "order caps it");
	assert.equal(rolesConfidence(0.75), 0.5);
	assert.equal(rolesConfidence(0.935), 0.87);
	assert.equal(rolesConfidence(0.2), 0.6);
});

test("§32.12.3.2: a line's lane-shaped verdict follows its dominant role and the reading within it", () => {
	const base = { target: full("target", "addressed"), gate: full("gate", "no_obstacle"), order: full("order", "in_step"),
		result: full("result", "answers_player"), span: full("span", "activity_time") };
	const act = full("role", "investigator_act"), world = full("role", "world_response"), time = full("role", "time_passing");
	assert.equal(rolesLineVerdict(true, { ...base, role: act, choice: { chosen: 0.6, routine_step: 0.4, keeper_choice: 0, unclear: 0 } }), "authorized");
	assert.equal(rolesLineVerdict(true, { ...base, role: act, choice: { chosen: 0.3, routine_step: 0.7, keeper_choice: 0, unclear: 0 } }), "entailed");
	assert.equal(rolesLineVerdict(true, { ...base, role: world, choice: full("choice", "chosen") }), "not_player_action");
	assert.equal(rolesLineVerdict(true, { ...base, role: time, choice: full("choice", "chosen") }), "entailed");
	assert.equal(rolesLineVerdict(false, { ...base, role: act, choice: { chosen: 0.2, routine_step: 0, keeper_choice: 0.8, unclear: 0 } }), "not_authorized");
	assert.equal(rolesLineVerdict(false, { ...base, role: act, choice: { chosen: 0.2, routine_step: 0, keeper_choice: 0.1, unclear: 0.7 } }), "uncertain");
});

// ---- the family interface ------------------------------------------------------------------------------------------------

test("§32.12.3.2: a complete answer reads back per line; a refusing line names the batch with host-derived grounds and missing", async () => {
	const value = input();
	const owned = lease(value);
	const decision = port(answering(1, 0.2, { missing: "interest_only", basis: "said:1" }));
	const result = await runAdmissionRoles(value, decision, owned);
	owned.close();
	assert.equal(decision.calls, 1, "both lines in one request");
	assert.equal(result.status, "decided");
	assert.deepEqual(result.lines.map((line) => [line.verdict, line.confidence, line.pAdmit]), [["authorized", 1, 1], ["not_authorized", 0.6, 0.2]]);
	assert.equal(result.verdict, "not_authorized");
	assert.equal(result.confidence, 0.6);
	assert.match(result.grounds, /^Decided by the player's words this turn: "然后问他那栋房子的事。"; typed review judged line 2 not_authorized/);
	assert.match(result.missing, /^the player has only shown interest; they have not chosen to act on it: apply clue/);
});

test("§32.12.3.2: every non-verdict is a named fallback, as §32.10's", async () => {
	const value = input();
	const cases = [
		[{ async decide(batch) { return { batchId: batch.id, status: "unavailable", answers: {}, issues: [], coverage: { required: [], answered: [], unknown: [] },
			failure: { code: "service_error", retryable: false, status: 529 } }; } }, "service_error", 529],
		[port((question) => question.key.startsWith("basis") ? { none: 0, "said:99": 1 } : answering(0, 1)(question)), "invalid_typed_answer"],
		[port((question) => question.key.startsWith("order") ? { in_step: 1 } : answering(0, 1)(question)), "invalid_typed_answer"],
		[{ async decide() { throw new Error("boom"); } }, "admission_owner_error"],
	];
	for (const [decision, reason, status] of cases) {
		const owned = lease(value);
		const result = await runAdmissionRoles(value, decision, owned);
		owned.close();
		assert.equal(result.status, "fallback");
		assert.equal(result.reason, reason);
		assert.equal(result.jevStatus, status);
	}
	const other = lease(input({ turn: 9 }));
	assert.equal((await runAdmissionRoles(value, port(answering(0, 1)), other)).reason, "attempt_binding_mismatch");
	other.close();
	const many = input({ proposal: Array.from({ length: 9 }, (_, index) => `apply clue: clue="c${index}"`) });
	const owned = lease(many);
	assert.equal((await runAdmissionRoles(many, port(answering(0, 1)), owned)).reason, "too_many_lines");
	owned.close();
});
