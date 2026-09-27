/**
 * SL-85 (ticket `docs/specs/pi-native-single-loop-tickets/85-execute-mode-reporting-gaps.md`; contract §135.32
 * addendum 2's own "once per turn, at turn close" ruling, which the implementation did not yet keep): one
 * `lane:"residual"` row per turn, written on the turn's true close whichever path closes it -- a `turn_close`
 * proposal that comes back `steer` is not that close (the run continues); the Keeper's own `narrate`/`ask`
 * delivering directly (`modelStep`, never proposing `turn_close` at all, since §135.11's `turn_close` is proposed
 * only for "a run with no delivery evidence") is. An executed candidate's pairing row excludes the clerk's own
 * receipt (never pairs against itself) and carries `executed: true`; an unexecuted class's row still carries
 * `shadow: true` even under `COC_JEV_STEPS=on`.
 *
 * Engine seam (`hybrid-engine.ts` driven directly, no Pi session, no fake-kernel subprocess): the same harness
 * shape `consequence-execute-mode.test.mjs` uses, extended with a mutable turn-close verdict so a test can make
 * the first `turn_close` proposal come back `steer` and a later one the true close.
 *
 * No Jev, no kernel, no Pi session.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { CONSEQUENCE_FAMILY } from "../../runtime/jev/consequence-route.ts";
import { NPC_REACTION_DECISION } from "../../runtime/jev/consequence-candidates.ts";

const CONTEXT = { version: 1, campaign: "c", worldline: "main", loop: 0, turn: 2, source_revision: "a".repeat(64) };

function clearAllConsequence(batch) {
	const answers = {};
	for (const question of batch.questions) answers[question.key] = { status: "answered", type: "noul", noul: 0.95 };
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}

/** Same shape as `consequence-execute-mode.test.mjs`'s harness, plus `setVerdict` (a turn-close proposal can steer once, then close) and a `state.receipts` a test can grow to simulate a later, independent Keeper write landing on the kernel side. */
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
		const call_id = `t2-c${dispatches.length}`;
		return { status: "succeeded", receipts: [`receipt:${call_id}`], result: {} };
	};
	bus.emit("coc:operation-dispatcher", { dispatch: async (operation, context) => { dispatches.push(operation); return dispatchImpl(operation, context); } });
	let verdictImpl = async () => ({ status: "none" });
	bus.emit("coc:turn-close", { verdict: async () => verdictImpl() });
	const plan = engine.runDriver.prepare({ runId: "run-1", inputRevision: "rev", rawInput: "I search the room", session: {} });
	const invocation = (step, extra = {}) => ({ runId: "run-1", stepId: step, operationId: `${step}/op1`, origin: "policy",
		inputRevision: "rev", scopeId: "root", signal: new AbortController().signal, ...extra });
	return { plan, rows, dispatches, decisions, state, invocation, setDispatch: (fn) => { dispatchImpl = fn; }, setVerdict: (fn) => { verdictImpl = fn; },
		read: (step) => plan.ports.read.read({ origin: "policy", operation: "read", readOnly: true }, invocation(step)),
		clerkExecute: (step, candidate, extra = {}) => plan.ports.operations.execute(
			{ origin: "policy", operation: "execute", params: { candidate, extra } }, invocation(step)),
		modelExecute: (step, operation, toolResult) => plan.ports.operations.execute(
			{ origin: "model", operation, assistantMessage: { step }, toolCall: { id: `${step}-tc` } },
			invocation(step, { origin: "model", executeModelTool: async () => toolResult })),
		turnClose: (step) => plan.ports.operations.execute({ origin: "policy", operation: "turn_close" }, invocation(step)) };
}

const seedCandidate = { key: "apply:clue:seed", verb: "apply", family: "clue", label: "Reveal the seed clue", source: "t",
	bound: { kind: "clue", clue: "seed" }, unbound: [], clerk: "declared_bookkeeping" };
const clueRow = (clue, summary = "x") => ({ effect: { kind: "clue", clue }, description: { summary } });
const npcRow = (target = "thomas-hayes") => ({ decision: NPC_REACTION_DECISION, target, actor: "hayes" });

const consequenceRows = (h) => h.rows.filter((row) => row.lane === "route" && row.purpose === "consequence" && !row.exists);
const residualRows = (h) => h.rows.filter((row) => row.lane === "residual");

test("SL-85: a `turn_close` that comes back `steer` writes no residual/pairing row; the later, truly final close writes exactly one of each", async () => {
	const h = harness({ env: { COC_JEV_STEPS: "on" }, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearAllConsequence(batch) });
	h.state.applyOptions = { candidates: [clueRow("globe-story")] };
	let calls = 0;
	h.setVerdict(() => { calls++; return calls === 1 ? { status: "steer", message: { role: "custom", text: "go on" } } : { status: "none" }; });
	await h.read("s1");
	await h.clerkExecute("s2", seedCandidate);
	const first = await h.turnClose("s3");
	assert.equal(first.artifact.verdict.status, "steer", "the first close is a steer, not a real close");
	// Between the steer and the real close, the Keeper (nudged by the steer) makes one more tool call -- this is
	// exactly what "last writer wins" means: the row written must reflect the state as of the *final* call, not
	// a snapshot taken at the steer.
	await h.modelExecute("s3b", "look", { isError: false });
	const second = await h.turnClose("s4");
	assert.equal(second.artifact.verdict.status, "none");
	assert.equal(residualRows(h).length, 1, "one residual row for the turn, not two -- the steer call wrote none");
	assert.equal(residualRows(h)[0].keeper_calls.look, 1, "the row reflects the look call made between the steer and the real close -- proving the LAST call wrote it, not the steer's own earlier snapshot");
	const clueKeys = new Set(consequenceRows(h).filter((row) => row.class === "clue_follow_up").map((row) => row.key));
	assert.equal(clueKeys.size, 1, "one distinct clue_follow_up key");
	const clueRowsForKey = consequenceRows(h).filter((row) => row.class === "clue_follow_up" && row.key === [...clueKeys][0]);
	assert.equal(clueRowsForKey.length, 1, "that key's pairing row was written exactly once, from the call that actually closed, not the steer");
});

test("SL-85: a turn delivered by the Keeper's own narrate (turn_close never proposed at all) still writes exactly one residual row", async () => {
	const h = harness({ env: { COC_JEV_STEPS: "on" }, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearAllConsequence(batch) });
	h.state.applyOptions = { candidates: [clueRow("globe-story")] };
	await h.read("s1");
	await h.clerkExecute("s2", seedCandidate);
	const decisionsBeforeDelivery = h.decisions.filter((batch) => batch.family === CONSEQUENCE_FAMILY).length;
	const delivered = await h.modelExecute("s3", "narrate", { isError: false });
	assert.equal(delivered.delivery, "accepted");
	assert.equal(residualRows(h).length, 1, "the bypass path (no turn_close proposal at all) still wrote its one residual row");
	assert.ok(consequenceRows(h).some((row) => row.class === "clue_follow_up"), "the pairing rows were written too, off whatever this run's own writes already routed -- no extra Jev call needed");
	assert.equal(h.decisions.filter((batch) => batch.family === CONSEQUENCE_FAMILY).length, decisionsBeforeDelivery,
		"no new consequence batch was asked on the delivery path itself: it only writes telemetry over what routeConsequencesAfterWrite already routed while the declared write settled");
});

test("SL-85: a turn delivered directly a second time in the same run (defensive) still writes only one residual row -- the once-per-run guard covers both paths", async () => {
	const h = harness({ env: { COC_JEV_STEPS: "on" }, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearAllConsequence(batch) });
	h.state.applyOptions = { candidates: [clueRow("globe-story")] };
	await h.read("s1");
	await h.clerkExecute("s2", seedCandidate);
	await h.modelExecute("s3", "narrate", { isError: false });
	await h.turnClose("s4"); // a defensive, out-of-order call: should never happen on a real table, must still not double-write
	assert.equal(residualRows(h).length, 1);
});

test("SL-85: an executed candidate's row carries `executed: true`, is not `shadow`, and pairs `keeper_did: false` against its own receipt alone", async () => {
	const h = harness({ env: { COC_JEV_STEPS: "on" }, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearAllConsequence(batch) });
	h.state.applyOptions = { candidates: [clueRow("globe-story")] };
	// Only the executed consequence's own write produces a clue-kind receipt this turn -- the declared "seed"
	// write is a different kind (its effect's `clue` field is absent), matching ticket 85's own evidence: a
	// single clue was executed and nothing else touched a clue that turn.
	h.setDispatch(async (operation) => {
		const call_id = `t2-c${h.dispatches.length}`, clue = operation.args?.effects?.[0]?.clue, receiptId = `receipt:${call_id}`;
		if (clue === "globe-story") h.state.receipts = [...h.state.receipts, { id: receiptId, kind: "clue", clue }];
		return { status: "succeeded", receipts: [receiptId], result: {} };
	});
	await h.read("s1");
	await h.clerkExecute("s2", seedCandidate); // executes: seed (declared) + globe-story (consequence, listed class)
	await h.turnClose("s6");
	const row = consequenceRows(h).find((r) => r.class === "clue_follow_up" && r.key.includes("globe-story"));
	assert.ok(row, "the clue_follow_up row was recorded");
	assert.equal(row.executed, true);
	assert.equal(row.shadow, false, "an executed row is not shadow, even though this is `on` mode");
	assert.equal(row.keeper_did, false, "the only clue receipt this turn is the clerk's own execution; excluded from the pairing, nothing else filed it");
});

test("SL-85: when a receipt other than the clerk's own execution also names the same clue, the executed row pairs `keeper_did: true`", async () => {
	const h = harness({ env: { COC_JEV_STEPS: "on" }, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearAllConsequence(batch) });
	h.state.applyOptions = { candidates: [clueRow("globe-story")] };
	h.setDispatch(async (operation) => {
		const call_id = `t2-c${h.dispatches.length}`, clue = operation.args?.effects?.[0]?.clue, receiptId = `receipt:${call_id}`;
		if (clue === "globe-story") h.state.receipts = [...h.state.receipts, { id: receiptId, kind: "clue", clue }];
		return { status: "succeeded", receipts: [receiptId], result: {} };
	});
	await h.read("s1");
	await h.clerkExecute("s2", seedCandidate);
	// A receipt the clerk's own execution never produced: an independent Keeper write for the same clue.
	h.state.receipts = [...h.state.receipts, { id: "receipt:keeper-independent", kind: "clue", clue: "globe-story" }];
	await h.read("s5"); // refresh run.turnReceipts with the kernel's latest state
	await h.turnClose("s6");
	const row = consequenceRows(h).find((r) => r.class === "clue_follow_up" && r.key.includes("globe-story"));
	assert.equal(row.executed, true);
	assert.equal(row.keeper_did, true, "a genuinely separate receipt for this clue exists -- not the clerk's own");
});

test("SL-85: in `on` mode, a class not on the execute list still carries `shadow: true` on its candidate row (unexecuted, unlisted)", async () => {
	const h = harness({ env: { COC_JEV_STEPS: "on" }, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearAllConsequence(batch) });
	h.state.applyOptions = { candidates: [clueRow("globe-story")] };
	h.state.capsule = { mods: { pending_contacts: [npcRow()] } };
	await h.read("s1");
	await h.clerkExecute("s2", seedCandidate);
	await h.turnClose("s6");
	const npcReactionRow = consequenceRows(h).find((r) => r.class === "npc_reaction");
	assert.ok(npcReactionRow, "the npc_reaction row exists (it clears; SL-78 already proves this class is never executed)");
	assert.equal(npcReactionRow.executed, undefined, "never executed: not in the data file's execute list");
	assert.equal(npcReactionRow.shadow, true, "an unexecuted class's row reads shadow:true even under `on`");
	const clueFollowUpRow = consequenceRows(h).find((r) => r.class === "clue_follow_up" && r.key.includes("globe-story"));
	assert.equal(clueFollowUpRow.shadow, false, "the executed class's own row is not shadow");
});

test("SL-85: `shadow` mode is unaffected -- every row, executed-list or not, still reads shadow:true, and no row ever carries `executed`", async () => {
	const h = harness({ env: {}, decide: (batch) => batch.family === CONSEQUENCE_FAMILY ? clearAllConsequence(batch) : clearAllConsequence(batch) });
	h.state.applyOptions = { candidates: [clueRow("globe-story")] };
	await h.read("s1");
	await h.clerkExecute("s2", seedCandidate);
	await h.turnClose("s6");
	const row = consequenceRows(h).find((r) => r.class === "clue_follow_up" && r.key.includes("globe-story"));
	assert.equal(row.shadow, true);
	assert.equal(row.executed, undefined);
});
