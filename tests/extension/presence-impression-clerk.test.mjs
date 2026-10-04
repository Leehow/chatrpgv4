/**
 * Contract §178.4: when the clerk's own write brings the party to people (a move into a room), the kernel's first
 * impressions ride on that write's `clerk_did` row, so the Keeper's next step can let them show. The receipt ids alone
 * say only that a die was cast.
 *
 * Installed App a7f5cbe57, Blood Road `game-45cd3976` turn 1: the clerk made all three moves into the Esso station before
 * the Keeper wrote a word.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";

const INPUT = "I pull into the gas station";
const IMPRESSION = { actor: "Carl", target: "Lars Williams", handle: "lars-williams", skill: "Appearance", level: "failure",
	impression: { reaction: "guarded", disposition: "neutral" }, receipt: "roll:mod-natural-npc-t1-c1" };

test("§178.4 at the engine: a clerk move the kernel answers with first impressions carries them into the Keeper's note", async () => {
	const handlers = new Map();
	const bus = { on: (name, handler) => handlers.set(name, handler), emit: (name, value) => handlers.get(name)?.(value) };
	const engine = createHybridEngine({ env: {}, decision: null, record: () => {} });
	engine.extension({ events: bus, on: () => {}, getActiveTools: () => [], setActiveTools: () => {} });
	let receipts = [];
	bus.emit("coc:kernel-bridge", { campaign: "c", call: async (method) => {
		if (method === "table.capsule") return { where: { scene: "road" }, present: [], _context: { version: 1, campaign: "c", worldline: "main", loop: 0, turn: 1, source_revision: "a".repeat(64) } };
		if (method === "table.status") return { turn: 1, state: "open", receipts };
		if (method === "table.apply.options") return { version: 1, candidates: [{ effect: { kind: "move", to: "esso-station" }, description: { display_name: "Esso station" } }], context: {} };
		if (method === "rules.bands") return { rows: [] };
		throw new Error("not here");
	} });
	bus.emit("coc:operation-dispatcher", { dispatch: async () => {
		receipts = [{ id: "move:esso-station-t1-c1", kind: "move", call_id: "t1-c1" }, { id: IMPRESSION.receipt, kind: "roll", call_id: "t1-c1", trigger: "presence" }];
		return { status: "succeeded", receipts: receipts.map((receipt) => receipt.id),
			result: { receipts: receipts.map((receipt) => receipt.id), first_impressions: [IMPRESSION], first_impressions_note: "Let each one shape that person's manner." } };
	} });
	const plan = engine.runDriver.prepare({ runId: "run-1", inputRevision: "rev", rawInput: INPUT, session: {} });
	const invocation = (step) => ({ runId: "run-1", stepId: step, operationId: `${step}/op1`, origin: "policy", inputRevision: "rev", scopeId: "root", signal: new AbortController().signal });
	const read = await plan.ports.read.read({ origin: "policy", operation: "read", readOnly: true }, invocation("s1"));
	const move = read.artifact.fresh.candidates.find((candidate) => candidate.key === "apply:move:esso-station");
	assert.ok(move, "the read issued the move");
	const executed = await plan.ports.operations.execute({ origin: "policy", operation: "execute", params: { candidate: move } }, invocation("s2"));
	assert.equal(executed.status, "ok");
	const [message] = await plan.ports.projection.project({ view: { policyState: { view: {} } }, stepId: "s3", step: { kind: "infer", purpose: "compose", reason: "finish" } });
	const row = JSON.parse(message.content).clerk_did[0];
	assert.deepEqual(row.receipts, ["move:esso-station-t1-c1", IMPRESSION.receipt]);
	assert.deepEqual(row.result.first_impressions, [IMPRESSION]);
	assert.equal(row.result.first_impressions_note, "Let each one shape that person's manner.");
	assert.equal(row.result.effects[0].kind, "move", "the effects stay as they were");
});

test("§178.4 at the engine: a clerk write that met nobody keeps its result as it was", async () => {
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
