/**
 * SL-02 at the extension seam (spec pi-native-single-loop; contract §135): the hybrid engine on a real Pi session
 * from the vendored build, with a stub Jev `DecisionPort` and the faux provider behind Pi's provider path.
 *
 * - With the emitted kernel (the kernel is the subject): the run reads first, Jev routes over host-issued
 *   candidates, the clerk's move goes through the kernel extension's canonical gateway -- the Keeper's own `apply`,
 *   its `tool_call` gates, action admission and the kernel -- under a call id from the one shared ordinal, the
 *   scene change queues another read before the next route, and the Keeper is told what the clerk did.
 * - With the fake kernel (the kernel is not the subject): a Keeper batch whose step fails returns the rest to the
 *   Keeper without a route question; no plan tool on the hybrid engine; the clerk runs nothing without an
 *   IntentBinding or without clerk authority; the context hook injects the run's prescreen and runs none of its own.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitFor } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";
import { customMessage, PRESCREEN_TYPE } from "../../extensions/table/context-policy.ts";
import { isRunEvent } from "./pi-agent-core.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A Jev answer in the adapter's result shape: `pick(question)` returns a choice or undefined (then "later" / "continue"). */
function answered(batch, pick = () => undefined) {
	const answers = {};
	for (const question of batch.questions) {
		const choice = pick(question) ?? (question.key === "exit" ? "continue" : Object.keys(question.criteria)[0] === "now" ? "later" : "unknown");
		answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}

/** One kernel request on the workspace, through the emitted kernel's own RPC (to put the table in a state). */
function kernelSteps(workspace, campaign, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign, ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
	return frames;
}

/** A probe of every Keeper verb call and result, model-origin or the clerk's, in order. */
function callProbe(calls) {
	return {
		name: "sl02-call-probe",
		factory(pi) {
			pi.on("tool_call", (event) => { calls.push({ phase: "call", id: event.toolCallId, tool: event.toolName, input: structuredClone(event.input) }); });
			pi.on("tool_result", (event) => { calls.push({ phase: "result", id: event.toolCallId, tool: event.toolName, isError: event.isError === true, details: event.details }); });
		},
	};
}

async function hybridTable({ decide, responses, realKernel = false, env = {}, prepareWorkspace, extra = [] }) {
	const decisions = [], calls = [], events = [], requests = [];
	const engine = createHybridEngine({ env: process.env, decision: { decide: async (batch, lease) => { decisions.push(batch); return decide(batch, decisions.length, lease); } } });
	const table = await openTable({
		realKernel, prepareWorkspace, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", ...env },
		runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }, callProbe(calls), ...extra],
		responses: responses.map((response) => (context) => { requests.push(context); return typeof response === "function" ? response(context) : response; }),
	});
	table.session.subscribe((event) => { if (isRunEvent(event)) events.push(event); });
	return { table, engine, decisions, calls, events, requests, dispose: () => table.dispose() };
}

const requestText = (context) => JSON.stringify(context.messages);
const clerkNotes = (context) => context.messages.flatMap((message) => {
	const text = typeof message.content === "string" ? message.content : (message.content ?? []).map((block) => block.text ?? "").join("");
	const start = text.indexOf('{"kind":"single_loop_step"');
	return start < 0 ? [] : [JSON.parse(text.slice(start, text.lastIndexOf("}") + 1))];
});

test("the run reads first, Jev routes over host-issued candidates, the clerk's move is the Keeper's own apply through the gateway, and a scene change is read again", async (t) => {
	const campaign = "test-camp";
	// The table has been told where to dig (the lead clue landed on turn 1), so the kernel issues the Globe as a move.
	const prepareWorkspace = (workspace) => kernelSteps(workspace, campaign, [
		["table.open", {}], ["table.player_input", { text: "我听着" }],
		["table.apply", { call_id: "t1-c1", effects: [{ kind: "clue", clue: "knott-research-leads", how: "he said so" }] }],
		["table.narrate", { call_id: "t1-c2", text: "他递给你一张写着地方的纸。" }],
	]);
	// A Mod bridge that records its hooks: the clerk's write must pass through them like the Keeper's.
	const modHooks = [];
	const mods = { name: "mods-probe", factory(pi) { pi.on("session_start", () => pi.events.emit("coc:mods-bridge", {
		async prepare(method, payload) { modHooks.push(["prepare", method, payload.call_id ?? null]); },
		async after(method, payload) { modHooks.push(["after", method, payload.call_id ?? null]); } })); } };
	const table = await hybridTable({
		realKernel: true, prepareWorkspace, extra: [mods],
		// First route: the move the player declared; after the move, nothing more before the Keeper writes.
		decide: (batch, count) => batch.family !== ROUTE_FAMILY ? answered(batch)
			: count === 1 ? answered(batch, (question) => question.key === "exit" ? "continue" : /Boston Globe offices/.test(question.target) ? "now" : undefined)
				: answered(batch, (question) => question.key === "exit" ? "finish" : undefined),
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "你到了报馆。" })], { stopReason: "toolUse" })],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("我去《环球报》报馆。");
	const { events, decisions, calls, requests } = table;

	// Read first: the run's first step is a policy-origin read-only operation, before any decision.
	const steps = events.filter((event) => event.type === "step_start").map((event) => event.kind);
	assert.equal(steps[0], "operate");
	assert.equal(events.find((event) => event.type === "operation_prepared").readOnly, true);
	assert.equal(events.find((event) => event.type === "operation_prepared").origin, "policy");
	// The first route offered host-issued candidates, the Globe among them, and nothing internal.
	const first = decisions.find((batch) => batch.family === ROUTE_FAMILY);
	assert.ok(first.questions.some((question) => /Boston Globe offices/.test(question.target ?? "")));
	assert.ok(!JSON.stringify(first).includes("available_route_not_player_choice"));

	// The clerk's move: the Keeper's own apply, through the same tool_call/tool_result hooks, under the shared ordinal.
	const move = calls.find((call) => call.phase === "call" && call.tool === "apply" && call.id.startsWith("clerk:"));
	assert.deepEqual(move.input.effects, [{ kind: "move", to: "newspaper-morgue" }]);
	const moved = calls.find((call) => call.phase === "result" && call.id === move.id);
	assert.equal(moved.isError, false);
	const telemetry = table.table.telemetry(campaign);
	const row = telemetry.find((entry) => entry.tool === "apply" && entry.origin === "policy");
	assert.match(row.call_id, /^t2-c1$/, "the first write of turn 2, minted by the kernel extension's ordinal");
	assert.equal(row.clerk, "declared_bookkeeping");
	assert.equal(row.basis.read, "table.apply.options");
	const admission = telemetry.find((entry) => entry.lane === "admission" && entry.origin === "policy");
	assert.equal(admission?.verdict, "authorized", "the clerk's move passed action admission (§32) like the Keeper's");
	assert.deepEqual(modHooks.filter((hook) => hook[2] === "t2-c1"), [["prepare", "apply", "t2-c1"], ["after", "apply", "t2-c1"]],
		"the Mod hooks ran for the clerk's apply, on its minted call id");
	// The Keeper's later narrate took the next ordinal: one mint for host and model.
	assert.equal(telemetry.find((entry) => entry.tool === "narrate" && entry.ok)?.call_id, "t2-c2");

	// The scene changed, so a read ran again before the next route.
	const kinds = events.filter((event) => event.type === "step_start").map((event) => `${event.kind}${event.purpose ? `:${event.purpose}` : ""}`);
	const executed = kinds.indexOf("operate", kinds.indexOf("decide:route") + 1);
	assert.deepEqual(kinds.slice(executed, executed + 3), ["operate", "operate", "decide:route"], "move, then read, then the next route");
	const reads = telemetry.filter((entry) => entry.lane === "run" && entry.event === "read");
	assert.equal(reads.length, 2);
	assert.equal(reads[1].scene, "newspaper-morgue");

	// The Keeper was told what the clerk did, committed, with its receipt and the kernel row it came from.
	const notes = clerkNotes(requests.at(-1));
	const did = notes.flatMap((note) => note.clerk_did ?? []);
	assert.equal(did.length, 1);
	assert.equal(did[0].operation, "apply");
	assert.equal(did[0].call_id, "t2-c1");
	assert.ok(did[0].receipts.length > 0);
	assert.equal(did[0].basis.read, "table.apply.options");
	assert.match(notes[0].note, /committed, not pending/);
	// Every route answer's distribution is retained (lane "route").
	const routes = telemetry.filter((entry) => entry.lane === "route" && entry.purpose === "route");
	assert.equal(routes.length, 2);
	assert.deepEqual(routes[0].selected, ["apply:move:newspaper-morgue"]);
	assert.ok(Object.values(routes[0].answers).every((answer) => answer.probabilities));
});

test("a Keeper batch whose step fails returns to the Keeper at once: the rest is not run and no route question comes first", async (t) => {
	const table = await hybridTable({
		env: { FAKE_KERNEL_WORKSPACE: "1" },
		decide: (batch) => answered(batch, (question) => question.key === "exit" ? "ask_llm" : undefined),
		responses: [
			// The batch: a check the kernel refuses (it cannot tell which rule applies), then a clue that depends on it.
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "歧义的一眼", method: "看门框" } }),
				fauxToolCall("apply", { effects: [{ kind: "clue", clue: "地窖的抓痕" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你什么也没拿到。" })], { stopReason: "toolUse" }),
		],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("我拿起那个东西");
	const { events, decisions, calls, requests } = table;
	const refused = calls.find((call) => call.phase === "result" && call.tool === "resolve");
	assert.equal(refused.isError, true, "the first step fell: the kernel refused it");
	assert.equal(calls.some((call) => call.tool === "apply"), false, "the second step never reached the tool pipeline");
	const results = table.table.session.messages.filter((message) => message.role === "toolResult");
	assert.deepEqual(results.map((message) => [message.toolName, message.isError]), [["resolve", true], ["apply", true], ["narrate", false]],
		"every real call is answered once, the skipped one explicitly");
	assert.ok(!table.table.kernelRequests().some((request) => request.method === "table.apply" && JSON.stringify(request.params).includes("地窖的抓痕")),
		"the clue never reached the kernel");
	const infers = events.filter((event) => event.type === "step_end" && event.kind === "infer");
	assert.deepEqual(infers.map((event) => event.reason), ["ask_llm", "batch_fallen"]);
	assert.equal(decisions.filter((batch) => batch.family === ROUTE_FAMILY).length, 1, "no Jev route between the fallen batch and the Keeper");
	const note = clerkNotes(requests.at(-1)).at(-1);
	assert.deepEqual(note.batch.map((step) => step.status), ["fell", "skipped"]);
	assert.equal(events.at(-1).status, "delivered");
});

test("no plan tool on the hybrid engine: submit_plan_packet is taken off the active tools; the legacy engine is untouched", async (t) => {
	const plan = {
		name: "plan-tool",
		factory(pi) {
			pi.registerTool({ name: "submit_plan_packet", label: "plan", description: "S0 private plan", parameters: Type.Object({}), async execute() { return { content: [{ type: "text", text: "{}" }], details: {} }; } });
			pi.on("session_start", () => pi.setActiveTools([...pi.getActiveTools(), "submit_plan_packet"]));
		},
	};
	let active;
	const probe = { name: "active-probe", factory(pi) { pi.on("before_agent_start", () => { active = pi.getActiveTools(); }); } };
	const hybrid = await hybridTable({ decide: (batch) => answered(batch, (question) => question.key === "exit" ? "finish" : undefined), extra: [plan, probe],
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "好。" })], { stopReason: "toolUse" })] });
	t.after(() => hybrid.dispose());
	await hybrid.table.session.prompt("好");
	assert.ok(active.includes("narrate"));
	assert.equal(active.includes("submit_plan_packet"), false);
	assert.equal(hybrid.table.activeTools().includes("submit_plan_packet"), false);
	const legacy = await openTable({ extraExtensions: [plan], responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "好。" })], { stopReason: "toolUse" }), fauxAssistantMessage("好。")] });
	t.after(() => legacy.dispose());
	assert.equal(legacy.activeTools().includes("submit_plan_packet"), true, "the guard is the hybrid engine's alone");
});

test("the clerk writes nothing before a read binds the run's IntentBinding, nor a candidate without clerk authority", async () => {
	const handlers = new Map();
	const bus = { on: (name, handler) => handlers.set(name, handler), emit: (name, value) => handlers.get(name)?.(value) };
	const pi = { events: bus, on: () => {}, getActiveTools: () => [], setActiveTools: () => {} };
	const rows = [];
	const engine = createHybridEngine({ env: {}, decision: null, record: (row) => rows.push(row) });
	engine.extension(pi);
	const source = "a".repeat(64), kernelCalls = [];
	bus.emit("coc:kernel-bridge", { campaign: "c", call: async (method) => { kernelCalls.push(method);
		return method === "table.capsule" ? { where: { scene: "s" }, present: [], _context: { version: 1, campaign: "c", worldline: "main", loop: 0, turn: 3, source_revision: source } }
			: method === "table.status" ? { turn: 3, state: "open", receipts: [] } : {}; } });
	const plan = await engine.runDriver.prepare({ runId: "run-1", inputRevision: "rev", rawInput: "go", session: {} });
	const invocation = (step) => ({ runId: "run-1", stepId: step, operationId: `${step}/op1`, origin: "policy", inputRevision: "rev", scopeId: "root", signal: new AbortController().signal });
	const candidate = { key: "apply:move:b", verb: "apply", family: "move", label: "Move to B", source: "t", bound: { kind: "move", to: "b" }, unbound: [] };
	const refused = async (params, step) => (await plan.ports.operations.execute({ origin: "policy", operation: "execute", params }, invocation(step))).reason;
	assert.equal(await refused({ candidate: { ...candidate, clerk: "declared_bookkeeping" } }, "s1"), "intent_unbound");
	const read = await plan.ports.read.read({ origin: "policy", operation: "read", readOnly: true }, invocation("s2"));
	assert.equal(read.artifact.binding.intent.turn, 3);
	assert.equal(await refused({ candidate }, "s3"), "not_clerk_authority");
	assert.equal(await refused({ candidate: { ...candidate, clerk: "narration" } }, "s4"), "not_clerk_authority");
	assert.equal((await plan.ports.operations.execute({ origin: "policy", operation: "execute", params: { candidate: { ...candidate, clerk: "declared_bookkeeping" } } }, invocation("s5"))).reason,
		"operation_gateway_unavailable", "with authority and an intent it goes to the gateway, which this bus does not carry");
	assert.ok(!kernelCalls.some((method) => ["table.apply", "table.resolve"].includes(method)), "the kernel received no write");
	// An operation Jev chose and the LLM completes: the Keeper is asked for its parameters without the host's kernel row,
	// and the row stays on record beside the step.
	const [note] = plan.ports.projection.project({ view: { policyState: { view: {} } }, stepId: "s6",
		step: { kind: "infer", purpose: "bind", reason: "open_parameters", request: { candidate: "apply:person:A",
			operation: { verb: "apply", label: "Stage A", bound: { kind: "person", who: "A" }, needs: [{ name: "name" }] }, basis: { read: "table.capsule", path: "present[0]" } } } });
	assert.equal(JSON.parse(note.content).complete.label, "Stage A");
	assert.ok(!note.content.includes("present[0]"), "the kernel row is not shown to the model");
	assert.deepEqual(rows.find((row) => row.event === "llm_bound")?.basis, { read: "table.capsule", path: "present[0]" });
});

test("on the hybrid engine the context hook injects the run's own prescreen packet and runs no prescreen of its own", async (t) => {
	const packet = { schema_version: 1, kind: "keeper_support", request: "我推门", materials: [{ alias: "material_1", kind: "note", label: "run-read-marker", content: "from the run" }] };
	const table = await openTable({
		env: { FAKE_KERNEL_WORKSPACE: "1", PI_COC_JEV_PRESELECT: "1", EXT_JEV_APIKEY: "test-key" },
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "门开了。" })], { stopReason: "toolUse" }), fauxAssistantMessage("门开了。")],
	});
	t.after(() => table.dispose());
	const seen = [];
	table.faux.setResponses([(context) => { seen.push(requestText(context)); return fauxAssistantMessage([fauxToolCall("narrate", { text: "门开了。" })], { stopReason: "toolUse" }); },
		fauxAssistantMessage("门开了。")]);
	table.emit("coc:loop-engine", { engine: "hybrid-v1", prescreen: "run" });
	table.emit("coc:run-prescreen", { campaign: "test-camp", turn: 1, run: "run-x", message: customMessage(PRESCREEN_TYPE, packet) });
	await table.session.prompt("我推门");
	await waitFor(() => seen.length > 0);
	assert.ok(seen[0].includes("run-read-marker"), "the run's packet reached the Keeper's request");
	assert.ok(!table.telemetry().some((row) => row.lane === "prescreen" && row.event === "allowance_started"), "the hook ran no prescreen of its own");
});
