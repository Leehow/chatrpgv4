/**
 * Canonical dispatcher conformance through openTable's real Pi runner and wrapped seven tools.
 * Faux-kernel cases are guard/parity evidence. One real TypeScript-kernel case proves mutation
 * journaling and canonical read-only recovery; none of these scripted tables are a playtest.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { ContractError } from "../../runtime/jev/contracts.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { operationCapability } from "../../extensions/kernel/canonical-operation-dispatcher.ts";
import { openTable, waitForIdle } from "./harness.mjs";

const SEVEN = ["look", "lookup", "recall", "resolve", "apply", "ask", "narrate"];
const NO_BACKFILL = { PI_COC_MEMORY_BACKFILL: "0" };

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function dispatchCall() {
	return fauxAssistantMessage([fauxToolCall("host_dispatch_test", {})], { stopReason: "toolUse" });
}

function closeTurn(text = "The bounded dispatcher turn closes.") {
	return [
		fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" }),
		fauxAssistantMessage("discarded post-delivery tail"),
	];
}

function scope(campaign) {
	return { owner: "dispatcher-test", campaign, worldline: "main", loop: 0, audience: "keeper" };
}

function task(campaign, capabilities) {
	return new TaskLease({
		owner: "dispatcher-test",
		goal: "exercise one bounded canonical operation",
		scope: scope(campaign),
		capabilities,
		budget: {
			deadlineAt: Date.now() + 60_000,
			// Admission is now charged to this same owner, even in a controlled provider fixture.
			remainingInputTokens: 100_000,
			remainingOutputTokens: 16_384,
			remainingCostUsd: 1,
			remainingActions: 20,
		},
		readSet: [{ kind: "world", resource: campaign, revision: "world-1" }],
	});
}

function proposal(owner, { id, operation, args, capability = operationCapability(operation, args) }) {
	return {
		id,
		taskId: owner.context.id,
		operation,
		args,
		capability,
		scope: owner.context.scope,
		readSet: owner.context.readSet,
		basis: [],
	};
}

function hostContext(control, owner, overrides = {}) {
	return {
		session: control.table.session,
		task: owner,
		journal: overrides.journal ?? control.journal,
		async validateCurrent(operation, prepared) {
			control.validations.push({ id: operation.id, prepared: prepared ? structuredClone(prepared) : undefined });
			await overrides.validateCurrent?.(operation, prepared);
		},
		async recover(identity) {
			if (overrides.recover) return overrides.recover(identity);
			return { status: "absent", activeTurn: 1 };
		},
		trace(event) {
			control.traces.push(structuredClone(event));
			overrides.trace?.(event);
		},
	};
}

function dispatcherProbe(control) {
	return {
		name: "canonical-operation-dispatcher-test",
		factory(pi) {
			pi.events.on("coc:operation-dispatcher", (value) => {
				if (value && !control.capturedGateway) control.capturedGateway = value;
				control.gateway = value;
			});
			pi.events.on("coc:kernel-bridge", (value) => { control.bridge = value; });
			pi.registerTool({
				name: "host_dispatch_test",
				label: "Host dispatch test",
				description: "Test-only bounded caller of the host operation gateway.",
				parameters: Type.Object({}),
				executionMode: "sequential",
				async execute() {
					const scenario = control.scenarios.shift();
					if (!scenario || !control.gateway) throw new Error("dispatcher test scenario is unavailable");
					const observation = await control.gateway.dispatch(scenario.proposal, scenario.context);
					control.observations.push(observation);
					return { content: [{ type: "text", text: JSON.stringify(observation) }], details: observation };
				},
			});
			pi.on("session_start", () => {
				pi.setActiveTools([...SEVEN, "host_dispatch_test"]);
				if (control.mods) pi.events.emit("coc:mods-bridge", control.mods);
			});
			pi.on("tool_call", (event) => {
				if (event.toolCallId.startsWith("host-op-")) control.hooks.push({ type: "tool_call", event: structuredClone(event) });
			});
			pi.on("tool_result", (event) => {
				if (!event.toolCallId.startsWith("host-op-")) return;
				control.hooks.push({ type: "tool_result", event: structuredClone(event) });
				control.finalizeActions.get(event.toolCallId)?.();
			});
		},
	};
}

async function openDispatchTable(t, { campaign = "dispatcher-test", realKernel = false, responses, env = {}, mods, registerCleanup = true }) {
	const records = new Map();
	const control = {
		table: undefined,
		gateway: undefined,
		capturedGateway: undefined,
		bridge: undefined,
		scenarios: [],
		observations: [],
		hooks: [],
		validations: [],
		traces: [],
		journalEvents: [],
		finalizeActions: new Map(),
		mods,
		journal: {
			async load(id) { return records.get(id) && structuredClone(records.get(id)); },
			async save(identity) {
				control.journalEvents.push({ type: "save", identity: structuredClone(identity) });
				records.set(identity.operationId, structuredClone(identity));
			},
		},
	};
	const table = await openTable({
		campaign,
		realKernel,
		responses,
		env: { ...NO_BACKFILL, ...env },
		extraExtensions: [dispatcherProbe(control)],
	});
	control.table = table;
	if (registerCleanup) t.after(() => table.dispose());
	return { table, control, records };
}

async function play(table) {
	await table.session.prompt("Open the bounded dispatcher conformance turn.");
	await waitForIdle(table.session, { timeoutMs: 60_000 });
}

function resultFor(table, name) {
	return table.session.messages.find((message) => message.role === "toolResult" && message.toolName === name);
}

test("conformance: host and ordinary look share the public hook/executor/result path and seven verbs remain intact", async (t) => {
	const { table, control } = await openDispatchTable(t, {
		responses: [
			dispatchCall(),
			fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
			...closeTurn(),
		],
	});
	const owner = task("dispatcher-test", ["look"]);
	control.scenarios.push({
		proposal: proposal(owner, { id: "host-op-look", operation: "look", args: {} }),
		context: hostContext(control, owner),
	});
	assert.deepEqual(table.session.getActiveToolNames().filter((name) => SEVEN.includes(name)), SEVEN);
	await play(table);

	const observation = control.observations[0];
	assert.equal(observation.status, "succeeded");
	assert.deepEqual(observation.result, resultFor(table, "look").details);
	assert.deepEqual(control.hooks.map((row) => [row.type, row.event.toolName]), [
		["tool_call", "look"], ["tool_result", "look"],
	]);
	assert.deepEqual(control.traces.map((row) => row.stage), ["prepare", "execute", "finalize"]);
	assert.equal(table.session.messages.some((message) => message.role === "toolResult" && message.toolCallId === "host-op-look"), false,
		"host operations do not forge Pi child messages");
});

test('standing-defense recovery cannot mark an unexecuted framed apply as succeeded', async t => {
  const campaign = 'dispatcher-defense';
  const {table, control, records} = await openDispatchTable(t, {
    campaign, realKernel: true, env: {COC_KERNEL_SEED: '9'}, responses: closeTurn('The investigation begins.'),
  });
  await waitForIdle(table.session);
  const rpc = (method, params = {}) => control.bridge.call(`table.${method}`, {campaign, ...params});
  // A historical asked turn, installed through the real kernel solely as a regression fixture.
  await rpc('player_input', {text: 'Confront Corbitt.'});
  let ordinal = 0;
  const write = (method, params) => rpc(method, {call_id: `t1-c${++ordinal}`, ...params});
  for (const to of ['corbitt-house-ground', 'basement-rites', 'corbitt-confrontation'])
    await write('apply', {effects: [{kind: 'move', to}]});
  await write('resolve', {action: {intent: 'combat', goal: 'Shoot', method: 'Fire', target: 'Walter Corbitt', weapon: '.38 Revolver'}});
  await write('resolve', {action: {intent: 'combat', goal: 'Stand', method: '', actor: 'Walter Corbitt', defense: 'none'}});
  const attack = await write('resolve', {action: {intent: 'combat', goal: 'Attack', method: '', actor: 'Walter Corbitt', target: 'thomas-hayes'}});
  await write('ask', {kind: 'mechanics', text: 'The knife approaches.', options: ['dodge', 'fight_back', 'flee'], binds: attack.pending_choice.name});
  const before = await rpc('view');
  const owner = task(campaign, ['apply']);
  control.scenarios.push({proposal: proposal(owner, {id: 'host-op-recovery-apply', operation: 'apply',
    args: {effects: [{kind: 'time', minutes: 5, why: 'Wait after the attack'}]}}), context: hostContext(control, owner)});
  table.faux.setResponses([dispatchCall(), ...closeTurn('The defense resolves.')]);
  await play(table);
  const observation = control.observations[0];
  assert.equal(observation.status, 'refused', JSON.stringify({observation, telemetry:table.telemetry().filter(row=>row.lane==='standing-defense'), hooks:control.hooks}));
  assert.deepEqual(observation.receipts, [], 'defense receipts never become the original operation receipts');
  assert.equal(observation.result.coc_error.code, 'operation_not_executed');
  assert.equal(observation.result.coc_error.details.operation_executed, false);
  const defense = observation.result.coc_error.details.automatic_defense;
  assert.equal(defense.outcome.status, 'resolved');
  assert.ok(defense.receipts.length > 0, 'the separately owned defense result remains available to the Keeper');
  assert.equal(records.get('host-op-recovery-apply').request, undefined, 'the original apply was never submitted');
  const after = await rpc('view');
  assert.equal(after.clock.minutes, before.clock.minutes, 'the requested time effect never happened');
  assert.equal((await rpc('look', {focus:'session', _context_read:true})).session.pending_defense, null);
  assert.equal(table.telemetry().filter(row => row.lane === 'standing-defense' && row.ok).length, 1);
});

test("conformance: capability derivation cannot promote source answer to prepare, escalate tools, or deliver as the host", async (t) => {
	assert.equal(operationCapability("lookup", { kind: "source", source_mode: "answer" }), "lookup.source.answer");
	assert.equal(operationCapability("lookup", { kind: "source" }), "source.prepare");
	assert.equal(operationCapability("lookup", {kind:"support"}),"lookup.support");
	const { table, control } = await openDispatchTable(t, {
		responses: [dispatchCall(), dispatchCall(), dispatchCall(), dispatchCall(), dispatchCall(), ...closeTurn()],
	});
	const answerOwner = task("dispatcher-test", ["lookup.source.answer"]);
	const lookOwner = task("dispatcher-test", ["look"]);
	const narrateOwner = task("dispatcher-test", ["narrate"]);
	const askOwner = task("dispatcher-test", ["ask"]);
	for (const scenario of [
		{ owner: answerOwner, value: { id: "host-op-source-promotion", operation: "lookup", args: { kind: "source", query: "clinic", question: "hours" }, capability: "source.prepare" } },
		{ owner: lookOwner, value: { id: "host-op-escalation", operation: "apply", args: { effects: [{ kind: "time", minutes: 5, why: "not authorized" }] }, capability: "apply" } },
		{ owner: narrateOwner, value: { id: "host-op-narrate", operation: "narrate", args: { text: "forbidden" }, capability: "narrate" } },
		{ owner: askOwner, value: { id: "host-op-ask", operation: "ask", args: { kind: "mechanics", options: ["accept", "flee"] }, capability: "ask" } },
		{ owner: lookOwner, value: {id:"host-op-support-escalation",operation:"lookup",args:{kind:"support",query:"Missing evidence"},capability:"lookup.support"}},
	]) control.scenarios.push({ proposal: proposal(scenario.owner, scenario.value), context: hostContext(control, scenario.owner) });
	await play(table);

	assert.deepEqual(control.observations.map((row) => [row.operationId, row.status, row.result.code]), [
		["host-op-source-promotion", "failed", "operation_capability_out_of_scope"],
		["host-op-escalation", "failed", "operation_capability_out_of_scope"],
		["host-op-narrate", "failed", "delivery_requires_writer_message"],
		["host-op-ask", "failed", "delivery_requires_writer_message"],
		["host-op-support-escalation","failed","operation_capability_out_of_scope"],
	]);
	assert.deepEqual(control.hooks, []);
	assert.equal(table.kernelRequests().some((row) => ["table.lookup", "table.apply", "table.ask"].includes(row.method)), false);
});

test("conformance: host failures use existing admission, Mod preparation, result bookkeeping, and refusal budgets", async (t) => {
	const forced = { "table.apply": { code: "invalid_params", message: "forced dispatcher failure" } };
	const prepares = [], afters = [];
	const { table, control } = await openDispatchTable(t, {
		responses: [dispatchCall(), dispatchCall(), dispatchCall(), ...closeTurn()],
		env: { FAKE_KERNEL_ERRORS: JSON.stringify(forced) },
		mods: { async prepare(method) { prepares.push(method); }, async after(method) { afters.push(method); } },
	});
	const owner = task("dispatcher-test", ["apply"]);
	for (let index = 1; index <= 3; index++) {
		const value = proposal(owner, { id: `host-op-failure-${index}`, operation: "apply",
			args: { effects: [{ kind: "time", minutes: 5, why: "same refused parameters" }] } });
		control.scenarios.push({ proposal: value, context: hostContext(control, owner) });
	}
	await play(table);

	assert.deepEqual(control.observations.map((row) => row.status), ["refused", "refused", "refused"]);
	assert.equal(table.kernelRequests().filter((row) => row.method === "table.apply").length, 2, JSON.stringify(control.observations));
	assert.equal(table.lanes.admission.requests().length, 1, "the existing admission cache reuses the same accepted proposal");
	assert.equal(prepares.filter((method) => method === "apply").length, 2);
	assert.equal(afters.filter((method) => method === "apply").length, 0);
	assert.deepEqual(control.hooks.map((row) => row.type), ["tool_call", "tool_result", "tool_call", "tool_result"],
		"the existing earlier guard blocks the third call before later observer hooks");
	assert.match(String(control.observations[2].result.reason), /refused these parameters 2 times/);
});

test("real TS kernel: mutation journal precedes apply, retry recovers the same receipt, changed parameters conflict", async (t) => {
	const campaign = "dispatcher-real-kernel";
	const prepares = [], afters = [];
	const { table, control } = await openDispatchTable(t, {
		campaign,
		realKernel: true,
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "The opening closes before the mutation test." })], { stopReason: "toolUse" }),
			fauxAssistantMessage("discarded opening tail"),
			dispatchCall(), dispatchCall(), dispatchCall(), ...closeTurn("The clock advances once."),
		],
		mods: { async prepare(method) { prepares.push(method); }, async after(method) { afters.push(method); } },
	});
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	prepares.length = 0;
	afters.length = 0;
	const owner = task(campaign, ["apply"]);
	const original = proposal(owner, { id: "host-op-real-apply", operation: "apply",
		args: { effects: [{ kind: "time", minutes: 5, why: "bounded exact-once test" }] } });
	const changed = proposal(owner, { id: "host-op-real-apply", operation: "apply",
		args: { effects: [{ kind: "time", minutes: 10, why: "changed retry" }] } });
	const statusChecks = [];
	control.journal = {
		async load(id) { return control._record?.operationId === id ? structuredClone(control._record) : undefined; },
		async save(identity) {
			if (identity.request) {
				const status = await control.bridge.call("table.call_status", {
					campaign, call_id: identity.callId, request: identity.request,
					scope: { worldline: "main", loop: 0 },
				});
				statusChecks.push(status.status);
			}
			control.journalEvents.push({ type: "save", identity: structuredClone(identity) });
			control._record = structuredClone(identity);
		},
	};
	const context = hostContext(control, owner, {
		journal: control.journal,
		async recover(identity) {
			const status = await control.bridge.call("table.call_status", {
				campaign, call_id: identity.callId, request: identity.request,
				scope: { worldline: "main", loop: 0 },
			});
			statusChecks.push(status.status);
			return status.status === "settled"
				? { status: "settled", result: status.result }
				: { status: "absent", activeTurn: status.active_turn };
		},
	});
	control.scenarios.push(
		{ proposal: original, context },
		{ proposal: original, context },
		{ proposal: changed, context },
	);
	const runner = table.session.extensionRunner;
	const emitToolResult = runner.emitToolResult.bind(runner);
	runner.emitToolResult = async (event) => {
		if (event.toolCallId === original.id) throw new Error("controlled public result callback failure");
		return emitToolResult(event);
	};
	try {
		await play(table);
	} finally {
		runner.emitToolResult = emitToolResult;
	}

	assert.deepEqual(control.observations.map((row) => row.status), ["succeeded", "succeeded", "failed"]);
	assert.deepEqual(statusChecks, ["absent", "settled"], "journal binding is absent before mutation and settled on retry");
	assert.deepEqual(control.observations[1].receipts, control.observations[0].receipts);
	assert.ok(control.observations[0].receipts.length > 0);
	assert.deepEqual(control.observations[0].diagnostics, [{ code: "bookkeeping_unavailable" }],
		"a real settled effect stays successful when a later result hook fails");
	assert.equal(control.observations[2].result.code, "operation_identity_conflict");
	assert.equal(prepares.filter((method) => method === "apply").length, 1);
	assert.equal(afters.filter((method) => method === "apply").length, 1, "recovery and identity conflict do not replay Mod after");
	const bound = control.journalEvents.find((row) => row.identity.request)?.identity;
	assert.ok(bound?.callId);
	assert.equal(bound.request.call_id, bound.callId);
	assert.equal(control.traces.filter((row) => row.stage === "recovered" && row.recovered).length, 1);
});

test("conformance: a foreign read-set change during awaited journal save blocks before kernel invocation", async (t) => {
	const { table, control } = await openDispatchTable(t, { responses: [dispatchCall(), ...closeTurn()] });
	const owner = task("dispatcher-test", ["apply"]);
	const value = proposal(owner, { id: "host-op-journal-race", operation: "apply",
		args: { effects: [{ kind: "time", minutes: 5, why: "must remain current" }] } });
	let current = true;
	const journal = {
		async load() { return undefined; },
		async save(identity) {
			control.journalEvents.push({ type: "save", identity: structuredClone(identity) });
			if (identity.request) current = false;
		},
	};
	const context = hostContext(control, owner, {
		journal,
		async validateCurrent(_operation, prepared) {
			if (prepared && !current) throw new ContractError("foreign_read_set_changed");
		},
	});
	control.scenarios.push({ proposal: value, context });
	await play(table);

	assert.equal(control.journalEvents.some((row) => row.identity.request), true);
	assert.equal(control.validations.filter((row) => row.prepared).length, 2,
		"the current binding is checked before and after the awaited request journal save");
	assert.equal(table.kernelRequests().some((row) => row.method === "table.apply"), false);
	assert.equal(control.observations[0].status, "refused");
	assert.match(JSON.stringify(control.observations[0].result), /foreign_read_set_changed/);
});

test("conformance: malformed retained journal identities fail closed before hooks or execution", async (t) => {
	const { table, control } = await openDispatchTable(t, {
		responses: [dispatchCall(), dispatchCall(), dispatchCall(), ...closeTurn()],
	});
	const owner = task("dispatcher-test", ["look"]);
	const malformed = [
		{},
		{ operationId: "host-op-bad-2", taskId: owner.context.id, signature: "sig", callId: null },
		{ operationId: "host-op-bad-3", taskId: owner.context.id, signature: "sig", callId: "bad-call" },
	];
	for (let index = 0; index < malformed.length; index++) {
		const id = `host-op-bad-${index + 1}`;
		const context = hostContext(control, owner, { journal: { async load() { return malformed[index]; }, async save() {} } });
		control.scenarios.push({ proposal: proposal(owner, { id, operation: "look", args: {} }), context });
	}
	await play(table);

	assert.deepEqual(control.observations.map((row) => [row.status, row.result.code]), [
		["failed", "invalid_operation_identity"],
		["failed", "invalid_operation_identity"],
		["failed", "invalid_operation_identity"],
	]);
	assert.deepEqual(control.hooks, []);
	assert.equal(table.kernelRequests().some((row) => row.method === "table.look" && row.params?._context_read !== true), false,
		'no malformed look executes; the later narrate may read the host-only defense snapshot');
});

test("conformance: settled mutations remain succeeded when trace or cancellation arrives after settlement", async (t) => {
	const { table, control } = await openDispatchTable(t, {
		responses: [dispatchCall(), dispatchCall(), ...closeTurn()],
	});
	const traceOwner = task("dispatcher-test", ["apply"]);
	const cancelOwner = task("dispatcher-test", ["apply"]);
	const traceProposal = proposal(traceOwner, { id: "host-op-trace-failure", operation: "apply",
		args: { effects: [{ kind: "time", minutes: 5, why: "settled before trace" }] } });
	const cancelProposal = proposal(cancelOwner, { id: "host-op-cancel-after", operation: "apply",
		args: { effects: [{ kind: "time", minutes: 6, why: "settled before cancellation" }] } });
	control.scenarios.push(
		{ proposal: traceProposal, context: hostContext(control, traceOwner, { trace(event) {
			if (event.stage === "finalize") throw new Error("controlled trace failure");
		} }) },
		{ proposal: cancelProposal, context: hostContext(control, cancelOwner) },
	);
	control.finalizeActions.set(cancelProposal.id, () => cancelOwner.cancel("controlled_after_settlement"));
	await play(table);

	assert.deepEqual(control.observations.map((row) => row.status), ["succeeded", "succeeded"]);
	assert.deepEqual(control.observations[0].diagnostics, [{ code: "bookkeeping_unavailable" }]);
	assert.deepEqual(control.observations[1].diagnostics, [{ code: "owner_cancelled_after_settlement" }]);
	assert.equal(table.kernelRequests().filter((row) => row.method === "table.apply").length, 2);
});

test("conformance: uncertain recovery after an executed write failure returns pending or cancelled, never false failure", async (t) => {
	const forced = { "table.apply": { code: "internal", message: "write reply unavailable" } };
	const { table, control } = await openDispatchTable(t, {
		responses: [dispatchCall(), dispatchCall(), ...closeTurn()],
		env: { FAKE_KERNEL_ERRORS: JSON.stringify(forced) },
	});
	const pendingOwner = task("dispatcher-test", ["apply"]);
	const cancelledOwner = task("dispatcher-test", ["apply"]);
	const pendingProposal = proposal(pendingOwner, { id: "host-op-settlement-pending", operation: "apply",
		args: { effects: [{ kind: "time", minutes: 5, why: "uncertain reply one" }] } });
	const cancelledProposal = proposal(cancelledOwner, { id: "host-op-settlement-cancelled", operation: "apply",
		args: { effects: [{ kind: "time", minutes: 6, why: "uncertain reply two" }] } });
	control.scenarios.push(
		{ proposal: pendingProposal, context: hostContext(control, pendingOwner, { async recover() { throw new Error("status unavailable"); } }) },
		{ proposal: cancelledProposal, context: hostContext(control, cancelledOwner, { async recover() {
			cancelledOwner.cancel("owner_cancelled");
			throw new Error("status unavailable");
		} }) },
	);
	await play(table);

	assert.deepEqual(control.observations.map((row) => [row.status, row.diagnostics]), [
		["pending", [{ code: "settlement_unknown" }]],
		["cancelled", [{ code: "settlement_unknown" }]],
	]);
	assert.equal(table.kernelRequests().filter((row) => row.method === "table.apply").length, 2);
});

test("conformance: a dangling call id from an old turn cannot execute as a new write", async (t) => {
	const { table, control } = await openDispatchTable(t, {
		responses: [dispatchCall(), dispatchCall(), ...closeTurn()],
	});
	const owner = task("dispatcher-test", ["apply"]);
	const value = proposal(owner, { id: "host-op-dangling", operation: "apply",
		args: { effects: [{ kind: "time", minutes: 5, why: "dangling call" }] } });
	let retained;
	const journal = {
		async load() { return retained && structuredClone(retained); },
		async save(identity) { retained = structuredClone(identity); },
	};
	let firstPrepared = true;
	const firstContext = hostContext(control, owner, { journal, async validateCurrent(_operation, prepared) {
		if (prepared && firstPrepared) { firstPrepared = false; throw new ContractError("stop_before_request_binding"); }
	} });
	const retryContext = hostContext(control, owner, { journal, async recover() {
		return { status: "absent", activeTurn: 2 };
	} });
	control.scenarios.push({ proposal: value, context: firstContext }, { proposal: value, context: retryContext });
	await play(table);

	assert.ok(retained?.callId);
	assert.equal(retained.request, undefined, "the first attempt saved only the minted call id");
	assert.deepEqual(control.observations.map((row) => [row.status, row.result.code]), [
		["refused", undefined],
		["stale", "operation_turn_stale"],
	]);
	assert.equal(table.kernelRequests().some((row) => row.method === "table.apply"), false);
});

test("conformance: a cancelled queued operation returns promptly without allowing a later operation to overtake", async (t) => {
	const { table, control } = await openDispatchTable(t, { responses: [] });
	let releaseFirst;
	const held = new Promise((resolve) => { releaseFirst = resolve; });
	let firstEntered;
	const entered = new Promise((resolve) => { firstEntered = resolve; });
	const firstOwner = task("dispatcher-test", ["look"]);
	const cancelledOwner = task("dispatcher-test", ["look"]);
	const laterOwner = task("dispatcher-test", ["look"]);
	const first = control.gateway.dispatch(proposal(firstOwner, { id: "host-op-queue-first", operation: "look", args: {} }),
		hostContext(control, firstOwner, { async validateCurrent() { firstEntered(); await held; } }));
	await entered;
	const cancelled = control.gateway.dispatch(proposal(cancelledOwner, { id: "host-op-queue-cancelled", operation: "look", args: {} }),
		hostContext(control, cancelledOwner));
	cancelledOwner.cancel("queued_cancelled");
	const cancelledResult = await Promise.race([cancelled, delay(100).then(() => "timeout")]);
	assert.notEqual(cancelledResult, "timeout", "the cancelled waiter returns without waiting for the held operation");
	assert.equal(cancelledResult.status, "cancelled");
	let laterSettled = false;
	const later = control.gateway.dispatch(proposal(laterOwner, { id: "host-op-queue-later", operation: "look", args: {} }),
		hostContext(control, laterOwner)).then((value) => { laterSettled = true; return value; });
	await delay(20);
	assert.equal(laterSettled, false, "the cancelled queue slot remains chained behind the earlier operation");
	releaseFirst();
	await first;
	await later;
});

test("conformance: a captured gateway cannot dispatch after table shutdown", async (t) => {
	const { table, control } = await openDispatchTable(t, { responses: [], registerCleanup: false });
	const owner = task("dispatcher-test", ["look"]);
	const value = proposal(owner, { id: "host-op-after-close", operation: "look", args: {} });
	const context = hostContext(control, owner);
	const captured = control.capturedGateway;
	assert.ok(captured);
	await table.dispose();
	assert.equal(control.gateway, undefined);
	assert.throws(() => captured.dispatch(value, context), /operation dispatcher is closed/);
});
