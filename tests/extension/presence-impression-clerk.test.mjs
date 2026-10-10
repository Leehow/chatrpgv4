/**
 * Contract §224.3 (user ruling 2026-10-10, re-rules §178): a first impression is a host check option Jev selects only when
 * it matters this turn. A `presence` row of `mods.pending_contacts` becomes the clerk's `mod_contact` candidate with its own
 * route question; only `now` past the gate selects the roll, and a `contact` row keeps the generic question. A clerk move
 * that brings people together rolls nothing, so its row keeps its effects alone.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { buildCandidates } from "../../runtime/jev/candidates.ts";
import { initialView, interpretRoute } from "../../runtime/jev/step-policy.ts";

const INPUT = "I pull into the gas station";
const presence = { actor: "Carl", target: "Lars Williams", handle: "lars-williams", decision: "natural-npc:first-impression",
	when: "only when this person's first impression of the investigator matters this turn, not merely because they share the scene",
	rule: { trigger: "presence", scope: "actor-target", reusable: true } };
const reads = (row) => ({ capsule: { where: { scene: "road" }, present: [], mods: { pending_contacts: [row] } }, applyOptions: {}, resolveOptions: {} });
const contactOf = (candidates) => candidates.find((candidate) => candidate.clerk === "mod_contact");
const answer = (choice, confidence, probabilities = { now: choice === "now" ? confidence : 0.05, later: choice === "later" ? confidence : 0.05, unknown: 0.05 }) => ({ status: "complete", answers: {
	need_1: { status: "answered", type: "choice", choice, confidence, probabilities },
	exit: { status: "answered", type: "choice", choice: "compose", confidence: 0.9, probabilities: { compose: 0.9 } } } });

test("§224.3: a presence row is offered with the impression-matters question; a contact row keeps the generic one", () => {
	const offered = contactOf(buildCandidates(reads(presence), INPUT));
	assert.ok(offered, "the host offers the first impression as a check option");
	assert.equal(offered.routeFact.selects, "now");
	assert.match(offered.routeFact.instructions, /seeks something/);
	assert.match(offered.routeFact.instructions, /hostile or suspicious/);
	assert.match(offered.routeFact.instructions, /Merely sharing the scene/);
	const legacy = contactOf(buildCandidates(reads({ ...presence, rule: { ...presence.rule, trigger: "contact" } }), INPUT));
	assert.equal(legacy.routeFact, undefined, "natural-npc 1.4.4's contact check keeps the generic route question");
});

test("§224.3: only now past the gate selects the roll; later or gray rolls nothing", () => {
	const offered = contactOf(buildCandidates(reads(presence), INPUT));
	const context = { scene: "road", clock: {}, present: [] };
	const run = () => initialView({ runId: "r", rawInput: INPUT, context, candidates: [offered], readFirst: false });
	const selected = interpretRoute(run(), [offered], answer("now", 0.95), 0.85);
	assert.deepEqual(selected.selected, [offered.key]);
	for (const [choice, confidence, probabilities] of [["later", 0.95], ["now", 0.45, { now: 0.45, later: 0.4, unknown: 0.15 }]]) {
		const routed = interpretRoute(run(), [offered], answer(choice, confidence, probabilities), 0.85);
		assert.equal((routed.selected ?? []).includes(offered.key), false, `${choice} ${confidence} selects nothing`);
		assert.equal(routed.forced, undefined, "an impression that does not matter is no forced no-roll");
	}
});

test("§224.3 at the engine: a clerk move that brings people together keeps its result as it was", async () => {
	const handlers = new Map();
	const bus = { on: (name, handler) => handlers.set(name, handler), emit: (name, value) => handlers.get(name)?.(value) };
	const engine = createHybridEngine({ env: {}, decision: null, record: () => {} });
	engine.extension({ events: bus, on: () => {}, getActiveTools: () => [], setActiveTools: () => {} });
	bus.emit("coc:kernel-bridge", { campaign: "c", call: async (method) => {
		if (method === "table.capsule") return { where: { scene: "road" }, present: [], _context: { version: 1, campaign: "c", worldline: "main", loop: 0, turn: 1, source_revision: "a".repeat(64) } };
		if (method === "table.status") return { turn: 1, state: "open", receipts: [] };
		if (method === "table.apply.options") return { version: 1, candidates: [{ effect: { kind: "move", to: "empty-lot" }, description: { display_name: "Empty lot" } }], context: {} };
		if (method === "rules.bands") return { rows: [] };
		throw new Error("not here");
	} });
	bus.emit("coc:operation-dispatcher", { dispatch: async () => ({ status: "succeeded", receipts: ["move:empty-lot-t1-c1"], result: { receipts: ["move:empty-lot-t1-c1"] } }) });
	const plan = engine.runDriver.prepare({ runId: "run-1", inputRevision: "rev", rawInput: INPUT, session: {} });
	const invocation = (step) => ({ runId: "run-1", stepId: step, operationId: `${step}/op1`, origin: "policy", inputRevision: "rev", scopeId: "root", signal: new AbortController().signal });
	const read = await plan.ports.read.read({ origin: "policy", operation: "read", readOnly: true }, invocation("s1"));
	const move = read.artifact.fresh.candidates.find((candidate) => candidate.key === "apply:move:empty-lot");
	await plan.ports.operations.execute({ origin: "policy", operation: "execute", params: { candidate: move } }, invocation("s2"));
	const [message] = await plan.ports.projection.project({ view: { policyState: { view: {} } }, stepId: "s3", step: { kind: "infer", purpose: "compose", reason: "finish" } });
	const row = JSON.parse(message.content).clerk_did[0];
	assert.deepEqual(Object.keys(row.result), ["effects"]);
});
