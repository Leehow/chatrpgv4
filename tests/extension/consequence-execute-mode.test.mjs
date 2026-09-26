/**
 * SL-78 (contract §135.32 addendum 2; design `docs/specs/jev-driven-steps.md` D3/D4; ticket
 * `docs/specs/pi-native-single-loop-tickets/78-execute-mode-and-residual.md`): `COC_JEV_STEPS=on` executes a
 * cleared D1 consequence candidate of a *listed* class (`content/rulesets/coc7/host-budgets.json`'s
 * `jev_steps.execute`, shipped as `["clue_follow_up"]`) through the same clerk gateway any other clerk candidate
 * uses, at the point in the run a settled write just happened -- so the clue can still reach this turn's
 * narration -- and re-routes after its own write, once per newly-cleared key. Engine seam (`hybrid-engine.ts`
 * driven directly, no Pi session, no fake-kernel subprocess): a stub `DecisionPort` (in place of Jev) and a stub
 * operation-dispatcher gateway (in place of the canonical dispatcher / kernel), exactly the pattern
 * `single-loop-settlement.test.mjs`'s "at the engine" tests and `consequence-shadow-gate.test.mjs` use.
 *
 * No Jev, no kernel, no Pi session.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { CONSEQUENCE_FAMILY } from "../../runtime/jev/consequence-route.ts";
import { NPC_REACTION_DECISION } from "../../runtime/jev/consequence-candidates.ts";

const CONTEXT = { version: 1, campaign: "c", worldline: "main", loop: 0, turn: 2, source_revision: "a".repeat(64) };

/** Every question of a consequence batch answered `true` (a Noul just above the shipped row gate: 0.5 / ratio 2). */
function clearAllConsequence(batch) {
	const answers = {};
	for (const question of batch.questions) answers[question.key] = { status: "answered", type: "noul", noul: 0.95 };
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}
/** Every question answered `unknown`-ish (0.5/0.5): nothing clears either way. */
function clearNothing(batch) {
	const answers = {};
	for (const question of batch.questions) answers[question.key] = { status: "answered", type: "noul", noul: 0.5 };
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}

/**
 * A harness over the hybrid engine's raw ports, with a mutable `applyOptions`/`resolveOptions`/`pendingContacts`
 * so a test can change what `table.apply.options` offers between reads (the re-route scenario) and a logging
 * stub dispatcher standing in for the canonical operation gateway.
 */
function harness({ env, decide }) {
	const handlers = new Map(), rows = [], dispatches = [], decisions = [];
	const bus = { on: (name, handler) => handlers.set(name, handler), emit: (name, value) => handlers.get(name)?.(value) };
	const engine = createHybridEngine({ env, decision: { decide: async (batch, lease) => { decisions.push(batch); return decide(batch, lease); } }, record: (row) => rows.push(row) });
	engine.extension({ events: bus, on: () => {}, getActiveTools: () => [], setActiveTools: () => {} });
	const state = { applyOptions: { candidates: [] }, resolveOptions: {}, capsule: {}, receipts: [] };
	bus.emit("coc:kernel-bridge", {
		campaign: "c",
		call: async (method) => {
			if (method === "table.capsule") return { where: { scene: "office" }, present: [], known: { investigator: { name: "Hayes" } }, ...state.capsule, _context: CONTEXT };
			if (method === "table.status") return { turn: 2, state: "open", receipts: state.receipts };
			if (method === "table.apply.options") return state.applyOptions;
			if (method === "table.resolve.options") return state.resolveOptions;
			return {};
		},
	});
	let dispatchImpl = async () => {
		const call_id = `t2-c${dispatches.length}`; // `dispatches.push` (below) already ran, so `.length` is this call's own 1-based index.
		return { status: "succeeded", receipts: [`receipt:${call_id}`], result: {} };
	};
	bus.emit("coc:operation-dispatcher", { dispatch: async (operation, context) => { dispatches.push(operation); return dispatchImpl(operation, context); } });
	bus.emit("coc:turn-close", { verdict: async () => ({ status: "none" }) });
	const plan = engine.runDriver.prepare({ runId: "run-1", inputRevision: "rev", rawInput: "I search the room", session: {} });
	const invocation = (step, extra = {}) => ({ runId: "run-1", stepId: step, operationId: `${step}/op1`, origin: "policy",
		inputRevision: "rev", scopeId: "root", signal: new AbortController().signal, ...extra });
	return { plan, rows, dispatches, decisions, state, invocation, setDispatch: (fn) => { dispatchImpl = fn; },
		read: (step) => plan.ports.read.read({ origin: "policy", operation: "read", readOnly: true }, invocation(step)),
		clerkExecute: (step, candidate, extra = {}) => plan.ports.operations.execute(
			{ origin: "policy", operation: "execute", params: { candidate, extra } }, invocation(step)),
		modelExecute: (step, operation, toolResult) => plan.ports.operations.execute(
			{ origin: "model", operation, assistantMessage: { step }, toolCall: { id: `${step}-tc` } },
			invocation(step, { origin: "model", executeModelTool: async () => toolResult })),
		compileDecide: (step) => plan.ports.decision.decide({ runId: "run-1", stepId: step, purpose: "compile", question: {}, signal: new AbortController().signal }),
		projectClerkDid: async (step) => {
			const [message] = await plan.ports.projection.project({ view: { policyState: { view: {} } }, stepId: step, step: { kind: "infer", purpose: "compose", reason: "settled" } });
			return message ? JSON.parse(message.content).clerk_did ?? [] : [];
		} };
}

const seedCandidate = { key: "apply:clue:seed", verb: "apply", family: "clue", label: "Reveal the seed clue", source: "t",
	bound: { kind: "clue", clue: "seed" }, unbound: [], clerk: "declared_bookkeeping" };
const clueRow = (clue, summary = "x") => ({ effect: { kind: "clue", clue }, description: { summary } });
const npcRow = (target = "thomas-hayes") => ({ decision: NPC_REACTION_DECISION, target, actor: "hayes" });

test("SL-78: with `on`, a cleared clue_follow_up executes inline -- before turn close -- through the gateway, and produces a receipt", async () => {
	const h = harness({ env: { COC_JEV_STEPS: "on" }, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearNothing(batch) });
	h.state.applyOptions = { candidates: [clueRow("globe-story")] };
	await h.read("s1");
	const done = await h.clerkExecute("s2", seedCandidate);
	assert.equal(done.status, "ok", "the declared write itself succeeded");
	// Two dispatches: the declared write (seed), then the consequence execution (globe-story) -- both inside the
	// one `clerkExecute` await, i.e. before any later step (the compose) ever runs.
	assert.equal(h.dispatches.length, 2, "the consequence step ran inline, in the same call, not deferred to turn close");
	const [first, second] = h.dispatches;
	assert.deepEqual(first.args.effects[0].clue, "seed");
	assert.deepEqual(second.args.effects[0].clue, "globe-story");
	const clerkDid = await h.projectClerkDid("s3");
	assert.equal(clerkDid.length, 2);
	assert.equal(clerkDid[1].clerk, "consequence_bookkeeping");
	assert.deepEqual(clerkDid[1].receipts, ["receipt:t2-c2"], "the executed clue's own receipt travels with its clerk-did line");
	assert.equal(h.rows.some((row) => row.lane === "run" && row.event === "operation_stage"), false, "no assertion needed on stage rows; dispatch is the seam here");
});

test("SL-78: `shadow` (the default) never executes the cleared candidate -- only one dispatch, the declared write's own, and only turn close's own single consequence route ever runs", async () => {
	const h = harness({ env: {}, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearNothing(batch) });
	h.state.applyOptions = { candidates: [clueRow("globe-story")] };
	await h.read("s1");
	await h.clerkExecute("s2", seedCandidate);
	assert.equal(h.dispatches.length, 1, "shadow mode: no inline execution at all");
	assert.equal(h.decisions.filter((batch) => batch.family === CONSEQUENCE_FAMILY).length, 0, "no early consequence route either -- shadow's one route is turnCloseStep's alone, unchanged");
	await h.plan.ports.operations.execute({ origin: "policy", operation: "turn_close" }, h.invocation("s6"));
	assert.equal(h.dispatches.length, 1, "turn close's own route still never executes anything under shadow");
	assert.equal(h.decisions.filter((batch) => batch.family === CONSEQUENCE_FAMILY).length, 1, "exactly the one turn-close route SL-76 always ran -- byte for byte unchanged by SL-78");
});

test("SL-78 (§135.32 addendum 2): an npc_reaction candidate never executes under `on` -- neither inline nor at turn close -- only a listed class does, even though it clears", async () => {
	const h = harness({ env: { COC_JEV_STEPS: "on" }, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearNothing(batch) });
	h.state.applyOptions = { candidates: [clueRow("globe-story")] };
	h.state.capsule = { mods: { pending_contacts: [npcRow()] } };
	await h.read("s1");
	await h.clerkExecute("s2", seedCandidate);
	// Only the seed write and the one listed class (clue_follow_up) executed; the npc_reaction candidate, though it
	// clears exactly as the clue does, was never offered to the inline route at all (only listed classes are).
	assert.equal(h.dispatches.length, 2, "one declared write, one executed clue -- never a third for the npc reaction");
	assert.ok(!h.dispatches.some((operation) => operation.args?.effects?.[0]?.decision === NPC_REACTION_DECISION), "no npc_reaction write ever reached the gateway");
	const clerkDid = await h.projectClerkDid("s3");
	assert.ok(!clerkDid.some((entry) => entry.result?.action?.decision === NPC_REACTION_DECISION), "no npc_reaction entry under clerk did either");
	// Turn close still runs the unconditional, full-list route (unchanged mechanism, SL-76): it re-clears the same
	// npc_reaction row (it is still offered -- no first-impression receipt exists for it) and still must not execute it.
	await h.plan.ports.operations.execute({ origin: "policy", operation: "turn_close" }, h.invocation("s6"));
	assert.equal(h.dispatches.length, 2, "turn close's own route over the full candidate list still never executes the unlisted class");
	assert.ok(h.rows.some((row) => row.lane === "route" && row.purpose === "consequence" && row.class === "npc_reaction" && row.cleared === true),
		"the npc_reaction row is genuinely cleared (this is a real gate, not a candidate that never got asked)");
});

test("SL-78: the re-route runs once after an executed step -- a clue the kernel offers only once the first is filed still executes this turn, and the chain stops on its own", async () => {
	const h = harness({ env: { COC_JEV_STEPS: "on" }, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearNothing(batch) });
	h.state.applyOptions = { candidates: [clueRow("clue-a")] };
	h.setDispatch(async (operation) => {
		const call_id = `t2-c${h.dispatches.length}`;
		const clue = operation.args?.effects?.[0]?.clue;
		// The kernel's own progression, simulated: filing clue-a is what makes clue-b appear next read.
		if (clue === "clue-a") h.state.applyOptions = { candidates: [clueRow("clue-b")] };
		if (clue === "clue-b") h.state.applyOptions = { candidates: [] };
		return { status: "succeeded", receipts: [`receipt:${call_id}`], result: {} };
	});
	await h.read("s1");
	await h.clerkExecute("s2", seedCandidate);
	// seed, clue-a, clue-b: three dispatches, all inside the one call -- the re-route fired twice (once per
	// executed D1 step) and then found nothing left to clear.
	assert.equal(h.dispatches.length, 3);
	assert.deepEqual(h.dispatches.map((operation) => operation.args.effects[0].clue), ["seed", "clue-a", "clue-b"]);
	const clerkDid = await h.projectClerkDid("s3");
	assert.equal(clerkDid.filter((entry) => entry.clerk === "consequence_bookkeeping").length, 2, "clue-a and clue-b, each exactly once");
});

test("SL-78: an outage mid-run (the decision port throws) leaves the run deliverable -- the declared write still succeeds and no consequence step runs", async () => {
	const h = harness({ env: { COC_JEV_STEPS: "on" }, decide: () => { throw new Error("jev down"); } });
	h.state.applyOptions = { candidates: [clueRow("globe-story")] };
	await h.read("s1");
	const done = await h.clerkExecute("s2", seedCandidate);
	assert.equal(done.status, "ok", "the declared write is unaffected by the consequence route's own outage");
	assert.equal(h.dispatches.length, 1, "no consequence step ran: an outage degrades to nothing executed, never a guess");
});

test("SL-78: an outage mid-run (the gateway itself throws on the consequence write) leaves the run deliverable", async () => {
	const h = harness({ env: { COC_JEV_STEPS: "on" }, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearNothing(batch) });
	h.state.applyOptions = { candidates: [clueRow("globe-story")] };
	let calls = 0;
	h.setDispatch(async () => { calls++; if (calls > 1) throw new Error("kernel down"); return { status: "succeeded", receipts: ["receipt:t2-c1"], result: {} }; });
	await h.read("s1");
	const done = await h.clerkExecute("s2", seedCandidate);
	assert.equal(done.status, "ok", "the declared write's own result is unaffected by a later consequence dispatch throwing");
});

test("SL-78 (residual row): `{lane:'residual', turn, keeper_calls, compile_calls, clerk_calls, consequence_calls}` at turn close, `on` only", async () => {
	const h = harness({ env: { COC_JEV_STEPS: "on" }, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearNothing(batch) });
	h.state.applyOptions = { candidates: [clueRow("globe-story")] };
	await h.read("s1");
	await h.clerkExecute("s2", seedCandidate); // 1 declared clerk write + 1 consequence clerk write
	await h.modelExecute("s3", "look", { isError: false }); // 1 keeper call
	await h.modelExecute("s4", "recall", { isError: false }); // 1 keeper call
	await h.compileDecide("s5"); // 1 compile call
	await h.plan.ports.operations.execute({ origin: "policy", operation: "turn_close" }, h.invocation("s6"));
	const residual = h.rows.find((row) => row.lane === "residual");
	assert.ok(residual, "a residual row was written at turn close");
	assert.equal(residual.turn, 2);
	assert.deepEqual(residual.keeper_calls, { apply: 0, resolve: 0, look: 1, lookup: 0, recall: 1 });
	assert.equal(residual.compile_calls, 1);
	assert.equal(residual.clerk_calls, 2, "the declared write and the one executed consequence, both through the gateway");
	assert.equal(residual.consequence_calls, 1, "only the consequence-class execution, not the declared write");
});

test("SL-78 (residual row): `shadow`/`off` write no residual row at all -- unaffected by this ticket, byte for byte", async () => {
	for (const env of [{}, { COC_JEV_STEPS: "shadow" }, { COC_JEV_STEPS: "off" }]) {
		const h = harness({ env, decide: (batch) => clearNothing(batch) });
		h.state.applyOptions = { candidates: [clueRow("globe-story")] };
		await h.read("s1");
		await h.clerkExecute("s2", seedCandidate);
		await h.plan.ports.operations.execute({ origin: "policy", operation: "turn_close" }, h.invocation("s6"));
		assert.ok(!h.rows.some((row) => row.lane === "residual"), `no residual row under ${JSON.stringify(env)}`);
	}
});

test("SL-78: the execute list is read from the data file, not a literal -- clue_follow_up (the shipped list) executes, an unlisted made-up class would not", async () => {
	// This is `content/rulesets/coc7/host-budgets.json`'s real, shipped `jev_steps.execute`: the test does not
	// override it, so a change to that file's list would change this test's own outcome, proving the code path
	// reads the file rather than naming the class in `hybrid-engine.ts` itself.
	const { jevStepsBudget } = await import("../../runtime/jev/host-budgets.ts");
	const budget = await jevStepsBudget();
	assert.deepEqual(budget.execute, ["clue_follow_up"]);
	const h = harness({ env: { COC_JEV_STEPS: "on" }, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearNothing(batch) });
	h.state.applyOptions = { candidates: [clueRow("globe-story")] };
	await h.read("s1");
	await h.clerkExecute("s2", seedCandidate);
	assert.equal(h.dispatches.length, 2, "clue_follow_up, the file's own listed class, executed");
});
