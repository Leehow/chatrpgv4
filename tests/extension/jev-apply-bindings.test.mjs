/** T12 host-only fulfillment binding conformance. Bindings are controlled metadata, not gameplay. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createCanonicalOperationDispatcher, operationCapability } from "../../extensions/kernel/canonical-operation-dispatcher.ts";
import { COC_TOOLS } from "../../extensions/kernel/tools.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";

const campaign = "apply-bindings";
const scope = { owner: "apply-binding-test", campaign, worldline: "main", loop: 0, audience: "keeper" };
const readSet = [{ kind: "world", resource: campaign, revision: "world-r1" }];

function lease(capabilities = ["apply"]) {
	return new TaskLease({ owner: "apply-binding-test", goal: "Verify one bound effect.", scope, capabilities,
		budget: { deadlineAt: Date.now() + 30_000, remainingInputTokens: 0, remainingOutputTokens: 0,
			remainingCostUsd: 0, remainingActions: 20 }, readSet });
}

function proposal(owner, { id = "bound-apply", operation = "apply", args = { effects: [{ kind: "clue", clue: "knott-commission" }] }, bindings }) {
	return { id, taskId: owner.context.id, operation, args, capability: operationCapability(operation, args),
		scope: owner.context.scope, readSet: owner.context.readSet, basis: [], ...(bindings ? { bindings } : {}) };
}

function fixture() {
	const identities = new Map(), publicArgs = [], preparedRequests = [], hooks = [], validations = [], traces = [], callIds = new Map();
	let gateway;
	const stages = {
		async prepare(event) { hooks.push({ type: "tool_call", input: structuredClone(event.input) }); callIds.set(event.toolCallId, "t1-c1"); },
		async execute(spec, toolCallId, params) {
			publicArgs.push(structuredClone(params));
			const request = { ...structuredClone(params), campaign, call_id: callIds.get(toolCallId) };
			await gateway.beforeKernelInvoke(toolCallId, spec.method, request);
			preparedRequests.push(structuredClone(request));
			return { content: [{ type: "text", text: JSON.stringify({ code: "needs", reason: "unsupported_terms" }) }],
				details: { coc_error: { code: "needs", details: { reason: "unsupported_terms" } } } };
		},
		async finalize(event) { hooks.push({ type: "tool_result", input: structuredClone(event.input) }); },
		preparedCallId(id) { return callIds.get(id); },
	};
	const applySpec = COC_TOOLS.find(tool => tool.name === "apply");
	const lookSpec = COC_TOOLS.find(tool => tool.name === "look");
	const definitions = new Map([["apply", { execute: (...args) => stages.execute(applySpec, ...args) }],
		["look", { execute: (...args) => stages.execute(lookSpec, ...args) }]]);
	const runner = {
		getToolDefinition(name) { return definitions.get(name); },
		emitToolCall(event) { return stages.prepare(event); },
		emitToolResult(event) { return stages.finalize(event); },
		createContext() { return {}; },
	};
	const session = { extensionRunner: runner };
	gateway = createCanonicalOperationDispatcher(stages);
	const context = owner => ({ session, task: owner,
		journal: {
			async load(id) { return identities.get(id) && structuredClone(identities.get(id)); },
			async save(identity) { identities.set(identity.operationId, structuredClone(identity)); },
		},
		async validateCurrent(operation, prepared) { validations.push({ operation: structuredClone(operation), prepared: structuredClone(prepared) }); },
		async recover() { return { status: "absent", activeTurn: 1 }; },
		trace(event) { traces.push(structuredClone(event)); },
	});
	return { gateway, context, identities, publicArgs, preparedRequests, hooks, validations, traces };
}

test("apply fulfillment metadata enters the exact journaled request but never public tool arguments", async () => {
	const app = fixture(), owner = lease();
	const bindings = { fulfillments: [{ kind: "clue", candidate: "effect:0", requirement: "Player received the clue." }] };
	const operation = proposal(owner, { bindings });

	const observed = await app.gateway.dispatch(operation, app.context(owner));

	assert.equal(observed.status, "refused");
	assert.equal(observed.result.coc_error.details.reason, "unsupported_terms");
	assert.deepEqual(app.publicArgs, [{ effects: [{ kind: "clue", clue: "knott-commission" }] }]);
	assert.equal(JSON.stringify(app.publicArgs).includes("fulfillment"), false);
	assert.deepEqual(app.hooks.map(row => row.input), [operation.args, operation.args]);
	assert.deepEqual(app.preparedRequests, [{ effects: operation.args.effects, campaign, call_id: "t1-c1",
		_fulfillments: bindings.fulfillments }]);
	assert.deepEqual(app.identities.get(operation.id).request, app.preparedRequests[0]);
	assert.equal(app.validations.at(-1).prepared.request._fulfillments[0].candidate, "effect:0");
	owner.close();
});

test("an exact binding retry is stable while changing the binding conflicts before execution", async () => {
	const app = fixture(), owner = lease();
	const bindings = { fulfillments: [{ kind: "clue", candidate: "effect:0" }] };
	const original = proposal(owner, { bindings });

	const first = await app.gateway.dispatch(original, app.context(owner));
	const retry = await app.gateway.dispatch(original, app.context(owner));
	const changed = await app.gateway.dispatch(proposal(owner, { bindings: {
		fulfillments: [{ kind: "clue", candidate: "effect:1" }],
	} }), app.context(owner));

	assert.equal(first.status, "refused"); assert.equal(retry.status, "refused");
	assert.equal(changed.status, "failed"); assert.equal(changed.result.code, "operation_identity_conflict");
	assert.equal(app.preparedRequests.length, 2);
	assert.deepEqual(app.preparedRequests[0], app.preparedRequests[1]);
	assert.deepEqual(app.identities.get(original.id).request._fulfillments, bindings.fulfillments);
	owner.close();
});

test("unknown fulfillment metadata is forwarded to fail closed rather than silently stripped", async () => {
	const app = fixture(), owner = lease();
	const bindings = { fulfillments: [{ kind: "not-a-registered-fulfillment", candidate: "effect:0" }] };

	const observed = await app.gateway.dispatch(proposal(owner, { id: "unknown-binding", bindings }), app.context(owner));

	assert.equal(observed.status, "refused");
	assert.deepEqual(app.preparedRequests[0]._fulfillments, bindings.fulfillments);
	assert.equal(observed.result.coc_error.details.reason, "unsupported_terms");
	owner.close();
});

test("bindings on another verb and malformed envelopes fail before public hooks or execution", async () => {
	const app = fixture(), lookOwner = lease(["look"]), applyOwner = lease();
	const invalid = [
		proposal(lookOwner, { id: "look-binding", operation: "look", args: {}, bindings: { fulfillments: [{ kind: "clue" }] } }),
		proposal(applyOwner, { id: "empty-binding", bindings: { fulfillments: [] } }),
		{ ...proposal(applyOwner, { id: "extra-binding" }), bindings: { fulfillments: [{ kind: "clue" }], extra: true } },
	];

	for (const operation of invalid) {
		await assert.rejects(app.gateway.dispatch(operation, app.context(operation.operation === "look" ? lookOwner : applyOwner)),
			error => error?.code === "invalid_operation_binding");
	}
	assert.deepEqual(app.hooks, []);
	assert.deepEqual(app.publicArgs, []);
	lookOwner.close(); applyOwner.close();
});
