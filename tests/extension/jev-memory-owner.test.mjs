/** T09 memory owner/dispatcher conformance. Controlled decisions are fixtures, not gameplay. */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createCanonicalOperationDispatcher } from "../../extensions/kernel/canonical-operation-dispatcher.ts";
import { bindDecisionAnswers, ContractError } from "../../runtime/jev/contracts.ts";
import { memoryReadSet, registerMemoryOperations } from "../../runtime/jev/memory-owner-operations.ts";
import { createMemoryWriteDomain, MEMORY_WRITE_CAPABILITY } from "../../runtime/jev/memory-write-domain.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { TaskRuntime } from "../../runtime/jev/task-runtime.ts";

const scope = { owner: "campaign:memory-campaign", campaign: "memory-campaign", worldline: "main", loop: 0, audience: "keeper" };
const sha = value => createHash("sha256").update(value).digest("hex");

class MemoryStore {
	records = new Map();
	async load(id) { return structuredClone(this.records.get(id)); }
	async save(record) { this.records.set(record.checkpoint.context.id, structuredClone(record)); }
}

function ref(alias, role, text) {
	return { version: 1, scope, resource: `turn:4:${role}`, revision: sha(`${role}:${text}`), sourceType: "turn",
		selector: { kind: "utf16", start: 0, end: text.length }, alias };
}

const player = ref("player:0", "player", "Nothing durable happens here.");
const keeper = ref("keeper:0", "keeper", "The room remains quiet.");
function segment(source, role, text) {
	const { alias, ...sourceRef } = source;
	return { alias, role, text, ref: sourceRef };
}
const playerSegment = segment(player, "player", "Nothing durable happens here.");
const keeperSegment = segment(keeper, "keeper", "The room remains quiet.");

function packet(sequence, current, status = "open") {
	const segments = status === "done" ? [] : [current];
	return {
		protocol: "memory-reference-v1",
		job_id: "extract:memory-campaign:t4",
		turn: 4,
		commit: "1".repeat(40),
		status,
		origin: { scope, revision: "memory-origin-r1" },
		step: { key: `step-${sequence}`, sequence, total: 2, remaining: status === "done" ? 0 : 2 - sequence, segments },
		known_entities: [{ alias: "name:investigator", name: "Thomas Hayes", kind: "investigator" }],
		prior: [],
		prior_coverage: { total: 0, included: 0, omitted: 0 },
		story_sources: [playerSegment, keeperSegment],
		story_complete: true,
		...(status === "done" ? { result: { status: "done" } } : {}),
	};
}

function result(status, remaining, next) {
	return { job_id: "extract:memory-campaign:t4", turn: 4, status, remaining, candidates: 0, written: [], superseded: [], next };
}

function plan(capabilities = [MEMORY_WRITE_CAPABILITY]) {
	return { goal: "Organize committed evidence.", subgoals: [], constraints: ["No world effects."], evidenceRequired: [],
		completion: ["Resolve every issued occurrence."], capabilities, replanWhen: [], returnWhen: [] };
}

function intent(raw = playerSegment.ref) {
	return { id: "memory-intent", rawInput: raw, goal: "Organize committed evidence.", limits: ["committed_memory_only"],
		scope, turn: 4, inputRevision: raw.revision };
}

function answerSkip(batch) {
	const raw = Object.fromEntries(batch.questions.map(question => [question.key,
		{ status: "answered", type: "choice", choice: question.key.startsWith("retain_") ? "skip" : Object.keys(question.criteria)[0] }]));
	return bindDecisionAnswers(batch, raw, { inputTokens: 1, outputTokens: 1, costUsd: 0 });
}

function dispatcher(ordinary) {
	return createCanonicalOperationDispatcher({
		async prepare() {},
		async execute(...args) { ordinary.push(args); throw new Error("memory owner must not enter the ordinary tool executor"); },
		async finalize() {},
		preparedCallId() { return undefined; },
	});
}

function operationContext(task, journal, traces) {
	return { session: {}, task, journal, async validateCurrent() {},
		async recover() { throw new Error("memory publication uses kernel step replay"); },
		trace(event) { traces.push(structuredClone(event)); } };
}

test("one committed-memory root uses the canonical owned dispatcher and retains every kernel-issued next packet", async () => {
	const first = packet(0, playerSegment), second = packet(1, keeperSegment), done = packet(2, keeperSegment, "done");
	const calls = [], traces = [], ordinary = [], bindings = new Map(), store = new MemoryStore();
	const gateway = dispatcher(ordinary);
	const release = registerMemoryOperations({
		registerOwned: (name, owner) => gateway.registerOwned(name, owner),
		binding: task => {
			const value = bindings.get(task.id);
			if (!value || task.kind !== "committed_memory" || task.owner !== "memory") throw new ContractError("memory_owner_stale");
			return value;
		},
		async call(method, params) {
			calls.push({ method, params: structuredClone(params) });
			if (method === "memory.job") return structuredClone(first);
			if (method === "memory.submit" && params.referenced.step === first.step.key) return result("open", 1, structuredClone(second));
			if (method === "memory.submit" && params.referenced.step === second.step.key) return result("done", 0, structuredClone(done));
			throw new Error(`unexpected memory owner call ${method}`);
		},
	});
	const runtime = new TaskRuntime({
		decision: { decide: answerSkip }, store, domains: [createMemoryWriteDomain()],
		operations: {
			async validate(task) { return memoryReadSet(bindings.get(task.id).packet); },
			async dispatch(proposal, task, journal) { return gateway.dispatch(proposal, operationContext(task, journal, traces)); },
		},
	});
	const id = await runtime.begin({ domain: "memory-write", intent: intent(), lease: {
		owner: "memory", kind: "committed_memory", goal: "Organize committed evidence.", scope,
		capabilities: [MEMORY_WRITE_CAPABILITY], readSet: memoryReadSet(first), origin: { turn: 4, sourceRefs: [playerSegment.ref, keeperSegment.ref] },
		budget: { deadlineAt: Date.now() + 30_000, remainingInputTokens: 100_000, remainingOutputTokens: 100_000,
			remainingCostUsd: 1, remainingActions: 30 },
	} });
	bindings.set(id, { packet: structuredClone(first), intent: intent() });
	const completed = await runtime.submit(id, plan());
	const record = runtime.snapshot(id);

	assert.equal(completed.status, "complete");
	assert.equal(record.checkpoint.context.kind, "committed_memory");
	assert.equal(record.checkpoint.context.rootId, id);
	assert.equal(record.checkpoint.context.parentId, undefined);
	assert.deepEqual(calls.map(row => row.method), ["memory.job", "memory.submit", "memory.submit"]);
	assert.deepEqual(calls[0].params, { campaign: scope.campaign, mode: "referenced", turn: 4 });
	assert.deepEqual(calls.slice(1).map(row => row.params.referenced.step), [first.step.key, second.step.key]);
	assert.equal(JSON.stringify(calls).includes("model"), false, "the owner never sends a model identity to the kernel");
	assert.deepEqual(memoryReadSet(first), [
		{ kind: "source", resource: "memory-turn:4", revision: "memory-origin-r1" },
		{ kind: "family", resource: "memory-write", revision: "3" },
	]);
	assert.deepEqual(bindings.get(id).packet, done, "the binding retains the exact final packet returned by the owner");
	assert.equal(record.observations.filter(row => row.proposal.operation === "memory.job").length, 1);
	assert.equal(record.observations.filter(row => row.proposal.operation === "memory.submit").length, 2);
	assert.equal(traces.filter(row => row.stage === "owner-execute").length, 3);
	assert.deepEqual(ordinary, []);
	release();
	await runtime.shutdown();
});

for (const code of ["invalid_params", "idempotency_conflict", "campaign_not_ready"]) {
	test(`an exact kernel ${code} refusal is terminal evidence, not unknown settlement`, async () => {
		const ordinary = [], gateway = dispatcher(ordinary), identities = new Map(), traces = [];
		const lease = new TaskLease({ owner: "memory", kind: "committed_memory", goal: "Publish one memory step.", scope,
			capabilities: [MEMORY_WRITE_CAPABILITY], readSet: memoryReadSet(packet(0, playerSegment)),
			origin: { turn: 4, sourceRefs: [playerSegment.ref] },
			budget: { deadlineAt: Date.now() + 30_000, remainingInputTokens: 0, remainingOutputTokens: 0,
				remainingCostUsd: 0, remainingActions: 4 } });
		const binding = { packet: packet(0, playerSegment), intent: intent() };
		const release = registerMemoryOperations({
			registerOwned: (name, owner) => gateway.registerOwned(name, owner),
			binding: task => {
				if (task.id !== lease.context.id) throw new ContractError("memory_owner_stale");
				return binding;
			},
			async call() { throw { code }; },
		});
		const proposal = { id: `refusal-${code}`, taskId: lease.context.id, operation: "memory.submit",
			args: { referenced: { step: "step-0", decisions: [{ source: "player:0", outcome: "skip" }] } },
			capability: MEMORY_WRITE_CAPABILITY, scope, readSet: lease.context.readSet, basis: [] };
		const observed = await gateway.dispatch(proposal, operationContext(lease, {
			async load(id) { return identities.get(id); },
			async save(identity) { identities.set(identity.operationId, structuredClone(identity)); },
		}, traces));

		assert.equal(observed.status, "refused");
		assert.deepEqual(observed.result, { code });
		assert.deepEqual(observed.diagnostics ?? [], []);
		assert.equal(identities.size, 1);
		assert.equal(traces.filter(row => row.stage === "owner-execute").length, 1);
		assert.deepEqual(ordinary, []);
		release();
		lease.close();
	});
}

test("a committed-memory task cannot dispatch a world apply even if a hostile plan names it", async () => {
	let dispatches = 0;
	const domain = { id: "memory-write", version: "hostile", capabilities: [MEMORY_WRITE_CAPABILITY, "apply"],
		next: () => ({ kind: "operation", key: "forbidden-world-effect", operation: "apply", args: { effects: [] }, capability: "apply", basis: [] }) };
	const runtime = new TaskRuntime({
		decision: { async decide() { throw new Error("the hostile task does not decide"); } },
		store: new MemoryStore(), domains: [domain], operations: {
			async validate(task) { return task.readSet; },
			async dispatch() { dispatches++; throw new Error("background world mutation reached dispatch"); },
		},
	});
	const id = await runtime.begin({ domain: domain.id, intent: intent(), lease: {
		owner: "memory", kind: "committed_memory", goal: "Hostile fixture.", scope,
		capabilities: [MEMORY_WRITE_CAPABILITY, "apply"], readSet: memoryReadSet(packet(0, playerSegment)),
		origin: { turn: 4, sourceRefs: [playerSegment.ref] },
		budget: { deadlineAt: Date.now() + 30_000, remainingInputTokens: 0, remainingOutputTokens: 0,
			remainingCostUsd: 0, remainingActions: 4 },
	} });
	const observed = await runtime.submit(id, plan([MEMORY_WRITE_CAPABILITY, "apply"]));
	assert.equal(observed.status, "failed");
	assert.deepEqual(observed.remainingNeeds, ["task_operation_out_of_scope"]);
	assert.equal(dispatches, 0);
});
