/** Owned-operation conformance through the real Pi extension runner; fixtures are not gameplay. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { ContractError } from "../../runtime/jev/contracts.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { operationCapability } from "../../extensions/kernel/canonical-operation-dispatcher.ts";
import { openTable, waitForIdle } from "./harness.mjs";

const SEVEN = ["look", "lookup", "recall", "resolve", "apply", "ask", "narrate"];
const PRIVATE_TOOL = "owned_dispatch_test";
const NO_BACKFILL = { PI_COC_MEMORY_BACKFILL: "0" };

function privateCall() {
	return fauxAssistantMessage([fauxToolCall(PRIVATE_TOOL, {})], { stopReason: "toolUse" });
}

function closeTurn() {
	return [
		fauxAssistantMessage([fauxToolCall("narrate", { text: "The owned-dispatch fixture closes." })], { stopReason: "toolUse" }),
		fauxAssistantMessage("discarded post-delivery tail"),
	];
}

function scope(campaign) {
	return { owner: "owned-dispatch-test", campaign, worldline: "main", loop: 0, audience: "keeper" };
}

function task(campaign, capabilities, remainingActions = 20) {
	return new TaskLease({
		owner: "owned-dispatch-test",
		goal: "exercise one private owned operation",
		scope: scope(campaign),
		capabilities,
		budget: {
			deadlineAt: Date.now() + 60_000,
			remainingInputTokens: 0,
			remainingOutputTokens: 0,
			remainingCostUsd: 0,
			remainingActions,
		},
		readSet: [{ kind: "world", resource: campaign, revision: "world-1" }],
	});
}

function proposal(owner, { id, operation, args, capability = operationCapability(operation, args) }) {
	return { id, taskId: owner.context.id, operation, args, capability, scope: owner.context.scope, readSet: owner.context.readSet, basis: [] };
}

function packet(operation, context, result = {}) {
	return { operationId: operation.id, status: "succeeded", result, refs: [], receipts: [], readSet: context.task.context.readSet,
		coverage: { used: [], omitted: [], unknown: [] } };
}

function context(control, owner) {
	return {
		session: control.table.session,
		task: owner,
		journal: control.journal,
		async validateCurrent(operation) { control.events.push([operation.id, "current"]); },
		async recover() { throw new Error("owned reads do not recover mutations"); },
		trace(event) { control.events.push([event.operationId, `trace:${event.stage}`]); },
	};
}

function probe(control) {
	return {
		name: "owned-operation-probe",
		factory(pi) {
			pi.events.on("coc:operation-dispatcher", value => { control.gateway = value; });
			pi.registerTool({
				name: PRIVATE_TOOL,
				label: "Owned dispatch test",
				description: "Runs one bounded owned-operation conformance scenario.",
				parameters: Type.Object({}),
				executionMode: "sequential",
				async execute() {
					const scenario = control.scenarios.shift();
					if (!scenario || !control.gateway) throw new Error("owned scenario unavailable");
					const result = await scenario(control.gateway);
					control.results.push(structuredClone(result));
					return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
				},
			});
			pi.on("session_start", () => pi.setActiveTools([...SEVEN, PRIVATE_TOOL]));
			pi.on("tool_call", event => {
				if (event.toolCallId.startsWith("nested-")) control.hooks.push(["tool_call", event.toolName]);
			});
			pi.on("tool_result", event => {
				if (event.toolCallId.startsWith("nested-")) control.hooks.push(["tool_result", event.toolName]);
			});
		},
	};
}

async function fixture(t, responses, campaign = "owned-dispatch") {
	const records = new Map();
	const control = {
		table: undefined,
		gateway: undefined,
		scenarios: [],
		results: [],
		events: [],
		hooks: [],
		journal: {
			async load(id) { return records.get(id) && structuredClone(records.get(id)); },
			async save(identity) {
				control.events.push([identity.operationId, "journal"]);
				records.set(identity.operationId, structuredClone(identity));
			},
		},
	};
	control.table = await openTable({ campaign, responses, env: NO_BACKFILL, extraExtensions: [probe(control)] });
	t.after(() => control.table.dispose());
	return control;
}

async function play(control) {
	await control.table.session.prompt("Run owned-operation conformance fixtures.");
	await waitForIdle(control.table.session, { timeoutMs: 60_000 });
}

test("owned validation and journal gates precede private read/publication execution without adding Keeper verbs", async t => {
	const control = await fixture(t, [privateCall(), privateCall(), privateCall(), privateCall(), privateCall(), ...closeTurn()]);
	assert.deepEqual(control.table.session.getActiveToolNames().filter(name => SEVEN.includes(name)), SEVEN);
	const ownedNames = ["source.test-read", "source.test-publish", "source.test-read-fail", "source.test-publish-fail", "source.test-invalid"];
	assert.ok(ownedNames.every(name => !control.table.session.getActiveToolNames().includes(name)));
	let readExecutions = 0, publicationExecutions = 0;
	const releases = [
		control.gateway.registerOwned(ownedNames[0], {
			capability: "lookup.source.answer", kind: "read",
			validate(args) {
				control.events.push(["owned-read", "validate"]);
				if (Object.keys(args).join() !== "value" || args.value !== "exact") throw new ContractError("invalid_owned_arguments");
				return structuredClone(args);
			},
			async execute(operation, ctx) { readExecutions++; control.events.push([operation.id, "execute"]); return packet(operation, ctx, { kind: "read" }); },
		}),
		control.gateway.registerOwned(ownedNames[1], {
			capability: "source.publish", kind: "publication", validate: args => structuredClone(args),
			async execute(operation, ctx) { publicationExecutions++; control.events.push([operation.id, "execute"]); return packet(operation, ctx, { kind: "publication" }); },
		}),
		control.gateway.registerOwned(ownedNames[2], {
			capability: "lookup.source.answer", kind: "read", validate: args => structuredClone(args),
			async execute() { readExecutions++; throw new Error("read unavailable"); },
		}),
		control.gateway.registerOwned(ownedNames[3], {
			capability: "source.publish", kind: "publication", validate: args => structuredClone(args),
			async execute() { publicationExecutions++; throw new Error("publication reply uncertain"); },
		}),
		control.gateway.registerOwned(ownedNames[4], {
			capability: "lookup.source.answer", kind: "read",
			validate() { throw new ContractError("invalid_owned_arguments"); },
			async execute() { throw new Error("invalid arguments must not execute"); },
		}),
	];
	t.after(() => releases.reverse().forEach(release => release()));
	const readOwner = task("owned-dispatch", ["lookup.source.answer"]), publishOwner = task("owned-dispatch", ["source.publish"]);
	for (const [id, operation, owner, args] of [
		["owned-read", ownedNames[0], readOwner, { value: "exact" }],
		["owned-publish", ownedNames[1], publishOwner, {}],
		["owned-read-fail", ownedNames[2], readOwner, {}],
		["owned-publish-fail", ownedNames[3], publishOwner, {}],
		["owned-invalid", ownedNames[4], readOwner, { extra: true }],
	]) control.scenarios.push(gateway => gateway.dispatch(proposal(owner, { id, operation, args, capability: owner.context.capabilities[0] }), context(control, owner)));

	await play(control);
	assert.deepEqual(control.results.map(row => [row.operationId, row.status, row.result.code ?? null, row.diagnostics ?? []]), [
		["owned-read", "succeeded", null, []],
		["owned-publish", "succeeded", null, []],
		["owned-read-fail", "failed", "owned_operation_failed", []],
		["owned-publish-fail", "pending", "owned_operation_failed", [{ code: "settlement_unknown" }]],
		["owned-invalid", "failed", "owned_operation_failed", []],
	]);
	assert.equal(readExecutions, 2);
	assert.equal(publicationExecutions, 2);
	assert.equal(control.events.filter(([, event]) => event === "journal").length, 4, "invalid arguments never acquire a durable identity");
	for (const id of ["owned-read", "owned-publish"]) {
		const events = control.events.filter(([operationId]) => operationId === id).map(([, event]) => event);
		assert.ok(events.indexOf("journal") < events.indexOf("execute"));
		assert.equal(events.filter(event => event === "current").length, 2);
	}
	assert.deepEqual(control.hooks, [], "owned operations remain private and do not forge Pi tool hooks");
	assert.equal(control.table.kernelRequests().some(row => row.method.startsWith("module.source")), false,
		"private fixture owners do not bypass into source RPC methods");
});

test("revoked read owners fail closed while an already accepted publication retains its outcome", async t => {
	const control = await fixture(t, [privateCall(), privateCall(), ...closeTurn()], "owned-revocation");
	let releaseRead, releasePublication;
	releaseRead = control.gateway.registerOwned("source.revoked-read", {
		capability: "lookup.source.answer", kind: "read", validate: args => structuredClone(args),
		async execute(operation, ctx) { releaseRead(); return packet(operation, ctx, { accepted: false }); },
	});
	releasePublication = control.gateway.registerOwned("source.revoked-publication", {
		capability: "source.publish", kind: "publication", validate: args => structuredClone(args),
		async execute(operation, ctx) { releasePublication(); return packet(operation, ctx, { accepted: true }); },
	});
	const readOwner = task("owned-revocation", ["lookup.source.answer"]), publishOwner = task("owned-revocation", ["source.publish"]);
	control.scenarios.push(
		gateway => gateway.dispatch(proposal(readOwner, { id: "revoked-read", operation: "source.revoked-read", args: {}, capability: "lookup.source.answer" }), context(control, readOwner)),
		gateway => gateway.dispatch(proposal(publishOwner, { id: "revoked-publication", operation: "source.revoked-publication", args: {}, capability: "source.publish" }), context(control, publishOwner)),
	);
	await play(control);
	assert.deepEqual(control.results.map(row => [row.status, row.result.code ?? null, row.result.accepted ?? null]), [
		["failed", "operation_owner_stale", null],
		["succeeded", null, true],
	]);
});

test("an owned read can nest one ordinary guarded read without parent deadlock", async t => {
	const control = await fixture(t, [privateCall(), ...closeTurn()], "owned-nested-read");
	const owner = task("owned-nested-read", ["source.parent", "look"]);
	const release = control.gateway.registerOwned("source.nested-read", {
		capability: "source.parent", kind: "read", validate: args => structuredClone(args),
		async execute(operation, ctx) {
			const nested = proposal(owner, { id: "nested-look", operation: "look", args: {}, capability: "look" });
			let timer;
			const result = await Promise.race([
				control.gateway.dispatch(nested, ctx),
				new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("nested read deadlocked")), 2_000); }),
			]).finally(() => clearTimeout(timer));
			return packet(operation, ctx, { nestedStatus: result.status });
		},
	});
	t.after(release);
	control.scenarios.push(gateway => gateway.dispatch(proposal(owner, {
		id: "owned-parent", operation: "source.nested-read", args: {}, capability: "source.parent",
	}), context(control, owner)));
	await play(control);
	assert.equal(control.results[0].status, "succeeded");
	assert.equal(control.results[0].result.nestedStatus, "succeeded");
	assert.deepEqual(control.hooks, [["tool_call", "look"], ["tool_result", "look"]]);
	assert.equal(control.table.kernelRequests().filter(row => row.method === "table.look").length, 1);
});

test("bindReadScope charges exact ordinary lookup and refuses source preparation", async t => {
	const control = await fixture(t, [privateCall(), ...closeTurn()], "owned-read-scope");
	const ordinary = task("owned-read-scope", ["lookup.module"], 3);
	const prepare = task("owned-read-scope", ["source.prepare"], 3);
	control.scenarios.push(async gateway => {
		const ordinaryProposal = proposal(ordinary, { id: "direct-module", operation: "lookup", args: { kind: "module", query: "book" }, capability: "lookup.module" });
		const release = await gateway.bindReadScope("direct-module-tool", ordinaryProposal, context(control, ordinary));
		const charged = { actions: ordinary.context.budget.remainingActions, step: ordinary.context.step, rootStep: ordinary.context.rootStep };
		release();
		const sourcePrepare = proposal(prepare, { id: "direct-source-prepare", operation: "lookup", args: { kind: "source", query: "book" }, capability: "source.prepare" });
		let blocked;
		try { await gateway.bindReadScope("direct-source-tool", sourcePrepare, context(control, prepare)); }
		catch (error) { blocked = typeof error?.code === "string" ? error.code : String(error); }
		return { charged, blocked, prepareActions: prepare.context.budget.remainingActions, prepareStep: prepare.context.step };
	});
	await play(control);
	assert.deepEqual(control.results[0], {
		charged: { actions: 2, step: 1, rootStep: 1 },
		blocked: "operation_capability_out_of_scope",
		prepareActions: 3,
		prepareStep: 0,
	});
	assert.equal(control.table.kernelRequests().some(row => row.method === "module.read.request"), false,
		"a direct read binding cannot promote source preparation");
});
