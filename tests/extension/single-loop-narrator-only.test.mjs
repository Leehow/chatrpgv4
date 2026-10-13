// Controller-only cases retired with single-keeper-streaming-turns; retained cases exercise current shared utilities.
/**
 * §151.5 (ticket `docs/specs/jev-decides-llm-writes-tickets/06-narrator-only-setting.md`; SL-79 behind a setting; design
 * `docs/specs/jev-driven-steps.md` D5): the narrator-only compose catalog.
 *
 * - Setting seam: `narrator_only` in `content/rulesets/coc7/host-budgets.json` (shipped off, cap 2), the env switch
 *   `COC_NARRATOR_ONLY` over it.
 * - Engine seam (`hybrid-engine.ts` driven through its ports, a stub decision port and a stub operation gateway, as
 *   `consequence-execute-mode.test.mjs` does): the compose note's catalog and offered keys, the refusal the engine
 *   announces for a call outside the step's catalog (the kernel extension's tool gate honours it), `propose` on an offered
 *   key, on a free handle, past the per-turn cap, the registered tool.
 * - Policy seam (`createStepPolicy`, pure): a queued `propose` is one more clerk step and then the compose; a narrowed
 *   compose's fallen batch returns to the compose once; a prose-only compose on a settled run finishes on the turn close
 *   with no Keeper tool call.
 *
 * No Jev, no kernel, no Pi session.
 */
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { NARRATOR_ONLY_FALLBACK, narratorOnlyBudget } from "../../runtime/jev/host-budgets.ts";
import { NARRATOR_CATALOG, narratorOnlySetting, offeredForPropose, proposedCandidate, stepCatalog } from "../../runtime/jev/narrator-catalog.ts";
import { CONSEQUENCE_FAMILY } from "../../runtime/jev/consequence-route.ts";
import { createStepPolicy, NARRATOR_FALLEN, PROPOSED_REASON } from "../../runtime/jev/step-policy.ts";

const CONTEXT = { version: 1, campaign: "c", worldline: "main", loop: 0, turn: 2, source_revision: "a".repeat(64) };
const SEVEN = ["look", "lookup", "recall", "resolve", "apply", "ask", "narrate"];
const clueRow = (clue, summary = "x") => ({ effect: { kind: "clue", clue }, description: { summary } });
/** Every question answered no: nothing any route asks clears, so only what a test does runs. */
const nothing = (batch) => {
	const answers = {};
	for (const question of batch.questions) answers[question.key] = { status: "answered", type: "noul", noul: 0.05 };
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
};

/**
 * The engine's raw ports with a stub kernel bridge, a logging stub gateway, a stub `pi` whose tool surface is the seven
 * verbs, and a stand-in for Pi's tool pipeline: a call the engine announced with `refuse` is answered with that refusal
 * (what the kernel extension's gate does), a `propose` runs the tool the engine registered, anything else returns `result`.
 */
function harness({ env, decide = nothing }) {
	const bus = new Map(), handlers = new Map(), rows = [], dispatches = [], announced = [], registered = [];
	let active = [...SEVEN];
	const pi = {
		events: { on: (name, handler) => bus.set(name, handler), emit: (name, value) => { if (name === "coc:model-step") announced.push(value); bus.get(name)?.(value); } },
		on: (name, handler) => handlers.set(name, handler),
		registerTool: (tool) => registered.push(tool),
		getActiveTools: () => [...active],
		setActiveTools: (names) => { active = [...names]; },
	};
	const engine = createHybridEngine({ env, decision: { decide: async (batch) => decide(batch) }, record: (row) => rows.push(row) });
	engine.extension(pi);
	const state = { applyOptions: { candidates: [] }, resolveOptions: {}, capsule: {} };
	pi.events.emit("coc:kernel-bridge", {
		campaign: "c",
		call: async (method) => {
			if (method === "table.capsule") return { where: { scene: "office" }, present: [], known: { investigator: { name: "Hayes" } }, ...state.capsule, _context: CONTEXT };
			if (method === "table.status") return { turn: 2, state: "open", receipts: [] };
			if (method === "table.apply.options") return state.applyOptions;
			if (method === "table.resolve.options") return state.resolveOptions;
			return {};
		},
	});
	pi.events.emit("coc:operation-dispatcher", { dispatch: async (operation, context) => {
		dispatches.push({ operation, origin: context.origin });
		return { status: "succeeded", receipts: [`receipt:${dispatches.length}`], result: {} };
	} });
	pi.events.emit("coc:turn-close", { verdict: async () => ({ status: "delivered", delivery: "accepted", implicit: true }) });
	const plan = engine.runDriver.prepare({ runId: "run-1", inputRevision: "rev", rawInput: "I look through the desk", session: {} });
	const invocation = (step, extra = {}) => ({ runId: "run-1", stepId: step, operationId: `${step}/op1`, origin: "policy",
		inputRevision: "rev", scopeId: "root", signal: new AbortController().signal, ...extra });
	let calls = 0;
	return {
		plan, rows, dispatches, announced, registered, state, invocation, active: () => active,
		sessionStart: () => handlers.get("session_start")?.({}, {}),
		read: (step) => plan.ports.read.read({ origin: "policy", operation: "read", readOnly: true }, invocation(step)),
		/** The note before a model step of `purpose`/`reason`, parsed; `candidates` stands for the policy view's own list. */
		project: async (step, purpose, reason, candidates, request = {}) => {
			const view = candidates ? { policyState: { view: { candidates } } } : { policyState: { view: {} } };
			const [message] = await plan.ports.projection.project({ view, stepId: step, step: { kind: "infer", purpose, reason, request } }) ?? [];
			return message ? JSON.parse(message.content) : {};
		},
		/** One model call of the response `message` (one object per response), through the stand-in pipeline. */
		model: (step, operation, params = {}, message = { step, n: ++calls }, result = { isError: false, content: [{ type: "text", text: "ok" }] }) => {
			const toolCall = { id: `${step}-tc${++calls}` };
			return plan.ports.operations.execute({ origin: "model", operation, params, assistantMessage: message, toolCall },
				invocation(step, { origin: "model", executeModelTool: async () => {
					const refusal = announced.find((row) => row.toolCallId === toolCall.id)?.refuse;
					if (refusal) return { toolCallId: toolCall.id, isError: true, content: [{ type: "text", text: refusal }] };
					if (operation === "propose") {
						const tool = registered.find((value) => value.name === "propose");
						if (!tool) return { toolCallId: toolCall.id, isError: true, content: [{ type: "text", text: "Tool propose not found" }] };
						try { return { toolCallId: toolCall.id, isError: false, ...(await tool.execute(toolCall.id, params)) }; }
						catch (error) { return { toolCallId: toolCall.id, isError: true, content: [{ type: "text", text: error.message }] }; }
					}
					return { toolCallId: toolCall.id, ...result };
				} }));
		},
		clerkExecute: (step, candidate) => plan.ports.operations.execute({ origin: "policy", operation: "execute", params: { candidate, extra: {} } }, invocation(step)),
	};
}
const text = (outcome) => outcome.toolResult?.content?.map((part) => part.text).join("") ?? "";

// ---------------------------------------------------------------------------------------------------------------------
// The setting.

function budgetRoot(t, narratorOnly) {
	const root = mkdtempSync(join(tmpdir(), "narrator-only-budget-"));
	mkdirSync(join(root, "rulesets", "coc7"), { recursive: true });
	writeFileSync(join(root, "rulesets", "coc7", "host-budgets.json"), JSON.stringify({ schema_version: 1, ...(narratorOnly === undefined ? {} : { narrator_only: narratorOnly }) }));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

test("§151.5 setting: the data file's narrator_only is read (enabled, propose_per_turn); a bad shape falls back; the shipped file is off with a cap of 2", async (t) => {
	assert.deepEqual(await narratorOnlyBudget(budgetRoot(t, { enabled: true, propose_per_turn: 3 })), { enabled: true, proposePerTurn: 3 });
	assert.deepEqual(await narratorOnlyBudget(budgetRoot(t, { enabled: "yes", propose_per_turn: -1 })), NARRATOR_ONLY_FALLBACK);
	assert.deepEqual(await narratorOnlyBudget(budgetRoot(t, undefined)), NARRATOR_ONLY_FALLBACK);
	assert.deepEqual(await narratorOnlyBudget(), { enabled: false, proposePerTurn: 2 }, "the shipped default is off");
});

test("§151.5 setting: the env switch is over the data default -- on/off say so with source env; anything else leaves the data's", () => {
	const off = { enabled: false, proposePerTurn: 2 }, on = { enabled: true, proposePerTurn: 2 };
	assert.deepEqual(narratorOnlySetting({ COC_NARRATOR_ONLY: "on" }, off), { on: true, source: "env", proposePerTurn: 2 });
	assert.deepEqual(narratorOnlySetting({ COC_NARRATOR_ONLY: "off" }, on), { on: false, source: "env", proposePerTurn: 2 });
	assert.deepEqual(narratorOnlySetting({}, on), { on: true, source: "data", proposePerTurn: 2 });
	assert.deepEqual(narratorOnlySetting({ COC_NARRATOR_ONLY: " yes " }, off), { on: false, source: "data", proposePerTurn: 2 });
});

test("§151.5 catalog: only a compose step with a decision port narrows; the spent-budget compose, adjudicate and bind keep the whole loadout", () => {
	const on = { on: true };
	assert.deepEqual(stepCatalog(on, { purpose: "compose", reason: "settled" }, true).narrowed, NARRATOR_CATALOG);
	assert.equal(stepCatalog(on, { purpose: "compose", reason: "settled" }, false).narrowed, undefined, "a Jev outage keeps today's catalog");
	assert.equal(stepCatalog(on, { purpose: "compose", reason: "jev_budget" }, true).narrowed, undefined);
	assert.equal(stepCatalog(on, { purpose: "adjudicate", reason: "ask_llm" }, true).narrowed, undefined);
	assert.equal(stepCatalog(on, { purpose: "adjudicate", reason: "ask_llm" }, true).propose, true);
	assert.deepEqual(stepCatalog(on, { purpose: "bind", reason: "open_parameters" }, true), { purpose: "bind", propose: false });
	assert.deepEqual(stepCatalog({ on: false }, { purpose: "compose", reason: "settled" }, true), { purpose: "compose", propose: false });
});

test("§151.5 offered: clerk candidates the policy can settle without the Keeper; open parameters, npc acts, forced steps and taken keys are out", () => {
	const clue = { key: "apply:clue:a", verb: "apply", family: "clue", label: "Reveal a", bound: { kind: "clue", clue: "a" }, unbound: [{ name: "how", required: false, vocabulary: "open" }], clerk: "declared_bookkeeping" };
	const open = { ...clue, key: "apply:move:x", family: "move", unbound: [{ name: "to", required: true, vocabulary: "open" }] };
	const keeper = { ...clue, key: "apply:clue:b", clerk: undefined };
	const act = { ...clue, key: "npc:act", clerk: "npc_act" };
	const forced = { ...clue, key: "resolve:defend", forced: true };
	const closed = { key: "consequence:npc_reaction:hayes:knott", verb: "resolve", family: "npc_reaction", label: "First impression", bound: { target: "knott" },
		unbound: [{ name: "intent", required: true, vocabulary: "closed", options: ["social"] }], clerk: "consequence_bookkeeping" };
	const twin = { key: "consequence:clue_follow_up:a", verb: "apply", family: "clue_follow_up", label: "a", bound: { kind: "clue", clue: "a", how: "h" }, unbound: [], clerk: "consequence_bookkeeping" };
	const taken = { ...clue, key: "apply:clue:c", bound: { kind: "clue", clue: "c" } };
	const offered = offeredForPropose([clue, open, keeper, act, forced, taken], [closed, twin], new Set(["apply:clue:c"]));
	assert.deepEqual(offered.map((candidate) => candidate.key), ["apply:clue:a"],
		"check choices belong to Jev even through propose; the consequence twin of an issued clue is not listed twice");
});

test("§151.5 proposedCandidate: the Keeper's request rides on the basis; a compile's or a consequence route's evidence never does", () => {
	const candidate = { key: "apply:clue:a", verb: "apply", family: "clue", label: "Reveal a", bound: { kind: "clue", clue: "a" }, unbound: [], clerk: "declared_bookkeeping",
		basis: { read: "table.apply.options", row: { clue: "a" }, compile: { predicate: "declared_clue" }, consequence: { class: "clue_follow_up" } } };
	assert.deepEqual(proposedCandidate(candidate, { run: "r", step: "s3" }).basis,
		{ read: "table.apply.options", row: { clue: "a" }, proposed: { by: "keeper", run: "r", step: "s3" } });
});

// ---------------------------------------------------------------------------------------------------------------------
// The policy.

const CANDIDATE = { key: "apply:clue:a", verb: "apply", family: "clue", label: "Reveal a", source: "t", bound: { kind: "clue", clue: "a" }, unbound: [], clerk: "declared_bookkeeping" };

/** A run of the real step policy, folded observation by observation the way the vendored driver folds them. */
function policyRun() {
	const policy = createStepPolicy({ context: { scene: "office", clock: null, present: [], receipts: [] }, readFirst: false, compile: false });
	let state = policy.initial({ runId: "r", rawInput: "I look through the desk", inputRevision: "rev" });
	state.view.pending = [{ kind: "infer", purpose: "compose", reason: "settled" }];
	const observations = [];
	let sequence = 0;
	const driver = (extra = {}) => ({ pendingProposals: [], pendingRequirements: [], delivery: "none", steps: sequence, observations, lastObservation: observations.at(-1), policyState: state, ...extra });
	const fold = (observation) => { observations.push(observation); state = policy.reduce(state, observation, driver()); };
	return {
		next: (extra) => policy.next(driver(extra)),
		/** The compose step answered by `calls` (the model's tool calls), then their operate step with `outcomes`. */
		compose: (calls, outcomes) => {
			const proposals = calls.map(([operation, params], index) => ({ origin: "model", operation, params, toolCall: { id: `tc${sequence}-${index}` } }));
			fold({ kind: "infer", purpose: "compose", origin: "model", status: "ok", proposals, message: { stopReason: calls.length ? "toolUse" : "stop" }, sequence: ++sequence, ms: 1 });
			if (!calls.length) return;
			fold({ kind: "operate", origin: "model", status: "ok", sequence: ++sequence, ms: 1,
				toolResults: proposals.map((proposal, index) => ({ toolCallId: proposal.toolCall.id, toolName: proposal.operation, isError: outcomes[index].status !== "ok" })),
				outcomes });
		},
		fold,
	};
}

test("§151.5 policy: an accepted propose is one more clerk step through the policy's own items, then the compose -- not a fall", () => {
	const run = policyRun();
	const proposed = { ...CANDIDATE, basis: { proposed: { by: "keeper" } } };
	run.compose([["propose", { key: CANDIDATE.key }], ["output", { text: "x" }]],
		[{ status: "ok", artifact: { kind: "execute", executed: { ok: true, summary: { tool: "propose" } }, narrator: true, proposed } },
			{ status: "refused", artifact: { kind: "execute", executed: { ok: false, summary: { tool: "output" } }, narrator: true, fell: "propose_pending" } }]);
	const step = run.next();
	assert.equal(step.kind, "operate");
	assert.deepEqual(step.proposals.map((value) => [value.origin, value.operation, value.params.candidate.key]), [["policy", "execute", CANDIDATE.key]]);
	assert.deepEqual(step.proposals[0].params.candidate.basis.proposed, { by: "keeper" });
	run.fold({ kind: "operate", origin: "policy", status: "ok", sequence: 9, ms: 1, outcomes: [{ status: "ok", artifact: { kind: "execute", executed: { ok: true, summary: { tool: "apply" } } } }] });
	// §143.4: a clerk step that landed owes the people present their act before the Keeper's next step (nobody is here).
	const scan = run.next();
	assert.equal(scan.proposals[0].params.candidate.clerk, "npc_act");
	run.fold({ kind: "operate", origin: "policy", status: "ok", sequence: 10, ms: 1, outcomes: [{ status: "ok", artifact: { kind: "execute", executed: { ok: true, summary: { clerk: "npc_act" } } } }] });
	const compose = run.next();
	assert.deepEqual([compose.kind, compose.purpose, compose.reason], ["infer", "compose", PROPOSED_REASON]);
});

test("§151.5 policy: a narrowed compose's fallen batch returns to the compose once, never to the adjudicate; the second fall ends the run", () => {
	const run = policyRun();
	const refused = { status: "refused", artifact: { kind: "execute", executed: { ok: false, summary: { tool: "apply" } }, narrator: true, fell: "narrator_catalog" } };
	run.compose([["apply", { effects: [] }]], [refused]);
	const again = run.next();
	assert.deepEqual([again.kind, again.purpose, again.reason], ["infer", "compose", NARRATOR_FALLEN]);
	run.compose([["look", {}]], [refused]);
	const end = run.next();
	assert.deepEqual([end.kind, end.proposals?.[0]?.operation], ["operate", "turn_close"], "the run finishes; the turn close owes the delivery");
	// Without the narrator flag (the setting off, or an adjudicate step) the fall is the Keeper's adjudication, as before.
	const plain = policyRun();
	plain.compose([["apply", { effects: [] }]], [{ status: "refused", artifact: { kind: "execute", executed: { ok: false, summary: { tool: "apply" } }, fell: "apply_refused" } }]);
	const adjudicate = plain.next();
	assert.deepEqual([adjudicate.kind, adjudicate.purpose, adjudicate.reason], ["infer", "adjudicate", "batch_fallen"]);
});
