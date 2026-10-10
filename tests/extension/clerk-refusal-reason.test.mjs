/**
 * §215 (issue #112, live table 9e7g turns 30-31): the policy clerk's declared move was refused by a pre-tool gate, and the
 * Keeper saw only `coc_error: {code: "refused"}` -- the gate's words were dropped between the canonical gateway's packet
 * (`{reason, terminate}`) and the clerk's record -- while the bind row said only `status: "refused"`. A refused clerk write
 * now carries a code and the gate's own words to the Keeper's next step and to its telemetry row.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";

const INPUT = "I thank the cook, pay, and take the streetcar back to last night's street to circle the house in daylight.";
const GATE_TEXT = 'Required package detail was absent from the current request. Read the next expanded request and re-decide the whole batch. No world change was committed. {"status":"expansion","requested":["narration-craft: Establishing a place"],"loaded":[],"missing_capability":["narration-craft: Establishing a place"],"no_commit":true}';
// The candidate exactly as the evidence's clerk_did basis names it (an available exit the compile's destination cleared).
const MOVE = { key: "apply:move:neighborhood-gossip", verb: "apply", family: "move", label: "Move the party to the street outside the house", source: "table.apply.options",
	bound: { kind: "move", to: "neighborhood-gossip" }, unbound: [], clerk: "declared_bookkeeping",
	basis: { read: "table.apply.options", path: "candidates[0]", row: { alias: "effect:0", effect: { kind: "move", to: "neighborhood-gossip" } },
		compile: { predicate: "move", features: { destination: "neighborhood-gossip", act: "investigate", target: null, item: null },
			read_features: { destination: { row: "neighborhood-gossip", confidence: 0.87, cleared: true } } } } };

async function refusedClerk(packetResult) {
	const handlers = new Map(), rows = [];
	const bus = { on: (name, handler) => handlers.set(name, handler), emit: (name, value) => handlers.get(name)?.(value) };
	const engine = createHybridEngine({ env: {}, decision: null, record: (row) => rows.push(row) });
	engine.extension({ events: bus, on: () => {}, getActiveTools: () => [], setActiveTools: () => {} });
	bus.emit("coc:kernel-bridge", { campaign: "c", call: async (method) => method === "table.capsule"
		? { where: { scene: "rooming-house" }, present: [], _context: { version: 1, campaign: "c", worldline: "main", loop: 0, turn: 30, source_revision: "a".repeat(64) } }
		: method === "table.status" ? { turn: 30, state: "open", receipts: [] } : {} });
	// The canonical gateway's packet for a write a `tool_call` gate blocked: status refused, nothing ran, no call id.
	bus.emit("coc:operation-dispatcher", { dispatch: async (operation) => ({ operationId: operation.id, status: "refused", receipts: [], refs: [],
		result: packetResult, readSet: [], coverage: { used: [], omitted: [], unknown: [] } }) });
	const plan = engine.runDriver.prepare({ runId: "run-30", inputRevision: "rev", rawInput: INPUT, session: {} });
	const invocation = (step) => ({ runId: "run-30", stepId: step, operationId: `${step}/op1`, origin: "policy", inputRevision: "rev", scopeId: "root", signal: new AbortController().signal });
	await plan.ports.read.read({ origin: "policy", operation: "read", readOnly: true }, invocation("s2"));
	const done = await plan.ports.operations.execute({ origin: "policy", operation: "execute", params: { candidate: MOVE, extra: {} } }, invocation("s4"));
	const [message] = await plan.ports.projection.project({ view: { policyState: { view: {} } }, stepId: "s6", step: { kind: "infer", purpose: "adjudicate", reason: "clerk_refused" } });
	return { done, did: JSON.parse(message.content).clerk_did[0], bind: rows.find((row) => row.lane === "run" && row.event === "bind") };
}

test("§215 the captured gate packet {reason, terminate}: the Keeper's clerk_did and the bind row carry a code and the gate's words", async () => {
	const { done, did, bind } = await refusedClerk({ reason: GATE_TEXT });
	assert.equal(done.status, "refused");
	assert.equal(done.reason, "blocked", "the operation's settled reason names the refusal, not the bare status");
	assert.equal(did.not_landed, true);
	assert.equal(did.coc_error.code, "blocked");
	assert.equal(did.coc_error.message, GATE_TEXT, "the Keeper reads why nothing ran");
	assert.equal(bind.status, "refused");
	assert.equal(bind.refusal, "blocked");
	assert.equal(bind.refusal_reason, GATE_TEXT.slice(0, 300), "telemetry records the reason beside the status");
});

test("§215 the gateway's coded block and a kernel coc_error both reach the Keeper unchanged", async () => {
	const coded = await refusedClerk({ code: "blocked", message: "A fixture gate held this write.", reason: "A fixture gate held this write." });
	assert.deepEqual(coded.did.coc_error, { code: "blocked", message: "A fixture gate held this write." });
	assert.equal(coded.bind.refusal_reason, "A fixture gate held this write.");
	const kernel = await refusedClerk({ coc_error: { code: "invalid_params", message: "no such exit", fix: "Name an exit the scene lists." } });
	assert.deepEqual(kernel.did.coc_error, { code: "invalid_params", message: "no such exit", fix: "Name an exit the scene lists." });
	assert.equal(kernel.bind.refusal, "invalid_params");
	assert.equal(kernel.bind.refusal_reason, "no such exit");
});
