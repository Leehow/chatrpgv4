/** T11 public ordinary-resolve conformance. Controlled decisions and kernel replies are not gameplay. */
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as settle } from "node:timers/promises";
import { test } from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "./pi.mjs";
import kernelExtension from "../../extensions/kernel/index.ts";
import { bindDecisionAnswers } from "../../runtime/jev/contracts.ts";
import { createTaskHostAdapter } from "../../runtime/jev/task-host-session.ts";
import { FAKE_KERNEL } from "./harness.mjs";

class MemoryStore {
	records = new Map();
	async load(id) { return structuredClone(this.records.get(id)); }
	async list() { return [...this.records.values()].map(structuredClone); }
	async save(record) { this.records.set(record.checkpoint.context.id, structuredClone(record)); }
}

function setEnv(values) {
	const prior = new Map();
	for (const [key, value] of Object.entries(values)) {
		prior.set(key, process.env[key]);
		if (value === undefined) delete process.env[key]; else process.env[key] = value;
	}
	return () => { for (const [key, value] of prior) value === undefined ? delete process.env[key] : process.env[key] = value; };
}

const plan = {
	goal: "Search the desk carefully for a hidden note.",
	subgoals: ["Settle the player-selected uncertain search."],
	constraints: ["Use one ordinary check only."],
	evidenceRequired: ["The actual bound skill and canonical roll."],
	completion: ["Return the settled ordinary check."],
	capabilities: ["resolve"], replanWhen: [], returnWhen: [],
};

function decisionResult(batch, mode = "ordinary") {
	const raw = Object.fromEntries(batch.questions.map(question => {
		let choice;
		if (question.key === "route") choice = mode;
		else if (question.key === "consent") choice = "authorized";
		else if (question.key === "actor") choice = "actor_0";
		else if (question.key === "intent") choice = "investigate";
		else if (question.key === "difficulty") choice = "regular";
		else if (["bonus", "penalty"].includes(question.key)) choice = "none";
		else if (question.key === "profile") {
			choice = Object.entries(question.criteria).find(([, value]) => value?.skill === "Spot Hidden")?.[0] ?? "unknown";
		} else choice = Object.keys(question.criteria)[0];
		const probabilities = Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === choice ? 1 : 0]));
		return [question.key, { status: "answered", type: "choice", choice, probabilities }];
	}));
	return bindDecisionAnswers(batch, raw, { inputTokens: 1, outputTokens: 1, costUsd: 0 });
}

function resolveOptions(control) {
	return {
		version: 1,
		profiles: [
			{ alias: "profile:0", actor: "托马斯·海耶斯", skill: "Spot Hidden", availability: "bound", value: 55 },
			{ alias: "profile:1", actor: "托马斯·海耶斯", skill: "Listen", availability: "bound", value: 45 },
		],
		decisions: [{ name: "core-check:ordinary-check", family: "core-check",
			description: "Settle one ordinary skill or characteristic percentile check as one bound roll", capability: "check" }],
		revision: "resolve-options-r1", world_revision: control.worldRevision,
		context: { scene: "Knott's Office", pending_choice: null, session: null,
			conditions: [{ actor: "托马斯·海斯", conditions: [] }], current_receipts: [], declared_action: control.playerText },
	};
}

async function openHost(t, { responses, decide = batch => decisionResult(batch), lostResponse = false,
	staleAfterOptions = false, cancelAfterSettlement = false } = {}) {
	const cwd = await mkdtemp(join(tmpdir(), "jev-resolve-host-"));
	const requestLog = join(cwd, "kernel-requests.jsonl"), proxyLog = join(cwd, "resolve-proxy.jsonl"), proxy = join(cwd, "resolve-proxy.mjs"), store = new MemoryStore();
	await writeFile(proxy, `import {spawn} from "node:child_process";
import {appendFile} from "node:fs/promises";
import {createInterface} from "node:readline";
const child=spawn(process.execPath,[${JSON.stringify(FAKE_KERNEL)},...process.argv.slice(2)],{env:process.env,stdio:["pipe","pipe","inherit"]});
const replies=[];createInterface({input:child.stdout}).on("line",line=>replies.shift()?.(JSON.parse(line)));
const forward=request=>new Promise(resolve=>{replies.push(resolve);child.stdin.write(JSON.stringify(request)+"\\n");});
const ledger=new Map();let world="world-r1",lost=false;
const patch=value=>{if(!value||typeof value!=="object")return;if(value._context&&typeof value._context==="object")Object.assign(value._context,{world_revision:world,task_world_revision:world,source_revision:"source-r1",task_source_revision:"source-r1"});for(const child of Object.values(value))patch(child);};
for await(const line of createInterface({input:process.stdin})){const request=JSON.parse(line);await appendFile(${JSON.stringify(proxyLog)},JSON.stringify({at:Date.now(),method:request.method,params:request.params})+"\\n");let response;
 if(request.method==="table.call_status"){const result=ledger.get(request.params.call_id);response={id:request.id,ok:true,result:result?{status:"settled",call_id:request.params.call_id,call_turn:1,active_turn:1,scope:{worldline:"main",loop:0},result:{...structuredClone(result),replayed:true}}:{status:"absent",call_id:request.params.call_id,call_turn:1,active_turn:1,scope:{worldline:"main",loop:0}}};}
 else {response=await forward(request);if(request.method==="table.resolve"&&response.ok){const result=response.result,receipt=result.receipt;result.receipts??=[receipt];result._task_advance={campaign:"resolve-host",turn:1,worldline:"main",loop:0,operationId:request.params.call_id,receiptIds:result.receipts,before:"broad-r1",after:"broad-r2",task_before:"world-r1",task_after:"world-r2"};ledger.set(request.params.call_id,structuredClone(result));world="world-r2";if(process.env.RESOLVE_PROXY_LOST==="1"&&!lost){lost=true;response={id:request.id,ok:false,error:{code:"internal",message:"controlled lost resolve response"}};}}patch(response.result);}
 process.stdout.write(JSON.stringify(response)+"\\n");}
child.kill();`, "utf8");
	const hidden = Object.fromEntries(Object.keys(process.env).filter(key => /(_API_KEY|_TOKEN|_SECRET)$/.test(key)).map(key => [key, undefined]));
	const restore = setEnv({ ...hidden, PI_COC_KERNEL_CMD: JSON.stringify([process.execPath, proxy]), RESOLVE_PROXY_LOST: lostResponse ? "1" : undefined,
		PI_COC_CAMPAIGN: "resolve-host", PI_COC_MODE: "play", PI_COC_MEMORY_BACKFILL: "0", PI_COC_MODS_WAIT_MS: "0",
		PI_COC_ADMISSION_MODEL: "admission/a1", PI_OFFLINE: "1", FAKE_KERNEL_LOG: requestLog, FAKE_KERNEL_WORKSPACE: "1" });
	const keeper = fauxProvider({ provider: "resolve-host-provider", models: [{ id: "keeper", reasoning: false }] });
	keeper.setResponses(responses ?? []);
	const admission = fauxProvider({ provider: "admission", models: [{ id: "a1", reasoning: false }] });
	admission.setResponses(Array.from({ length: 8 }, () => fauxAssistantMessage(JSON.stringify({ verdict: "authorized", grounds: "The player chose this exact search." }))));
	const control = { worldRevision: "world-r1", playerText: "I carefully search the desk for a hidden note.", calls: [], order: [],
		hooks: [], advances: [], api: undefined };
	const wrap = provider => ({ ...provider,
		stream(model, context, options) { control.order.push("admission"); return provider.stream(model, context, options); },
		streamSimple(model, context, options) { control.order.push("admission"); return provider.streamSimple(model, context, options); } });
	const modelRuntime = await ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: null,
		modelsStorePath: join(cwd, "models.json"), refreshOnCreate: false });
	modelRuntime.registerNativeProvider(keeper.provider);
	modelRuntime.registerNativeProvider(wrap(admission.provider));
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const sessionManager = SessionManager.inMemory(cwd), controller = new AbortController();
	let session;
	const adapter = createTaskHostAdapter(() => session, { decide }, { resolveEnabled: true, store, deadlineMs: 30_000 });
	const mods = {
		async prepare(method, payload) { if (method === "resolve") { control.order.push("mod.prepare"); control.resolvePrepareAt = Date.now(); control.prepared = structuredClone(payload); } },
		async after(method) {
			if (method !== "resolve") return;
			control.order.push("mod.after"); control.resolveAfterAt = Date.now();
			if (cancelAfterSettlement) { control.api.events.emit("coc:player-input-queued", { text: "Cancel after settlement." }); await settle(10); }
		},
	};
	const probe = { name: "resolve-host-probe", factory(pi) {
		control.api = pi;
		pi.events.on("coc:kernel-bridge", value => {
			if (!value?.call || control.bridge === value) return;
			control.bridge = value;
			const original = value.call.bind(value);
			value.call = async (method, params) => {
				control.calls.push({ method, params: structuredClone(params) });
				if (method === "table.resolve.options") {
					const result = resolveOptions(control);
					if (staleAfterOptions) control.forcedWorldRevision = "world-r2";
					return result;
				}
				const result = await original(method, params);
				const context = result?._context ?? result?.capsule?._context;
				if (context && typeof context === "object") {
					if (!control.forcedWorldRevision && typeof context.task_world_revision === "string") control.worldRevision = context.task_world_revision;
					const revision = control.forcedWorldRevision ?? control.worldRevision;
					result._context = { ...structuredClone(context),
					world_revision: revision, task_world_revision: revision, source_revision: "source-r1", task_source_revision: "source-r1" };
				}
				return result;
			};
		});
		pi.events.on("coc:capsule", value => {
			const context = value?.context ?? value?.capsule?._context;
			if (context && typeof context === "object") value.context = { ...structuredClone(context), world_revision: control.worldRevision,
				task_world_revision: control.worldRevision, source_revision: "source-r1", task_source_revision: "source-r1" };
		});
		pi.events.on("coc:task-receipt-advance", value => control.advances.push(structuredClone(value)));
		pi.on("tool_call", event => control.hooks.push({ type: "tool_call", id: event.toolCallId, name: event.toolName }));
		pi.on("tool_result", event => control.hooks.push({ type: "tool_result", id: event.toolCallId, name: event.toolName, error: event.isError }));
		pi.on("session_start", () => pi.events.emit("coc:mods-bridge", mods));
		pi.on("session_shutdown", () => controller.abort());
	} };
	const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager,
		extensionFactories: [probe, { name: "coc-kernel", factory: kernelExtension }, { name: "resolve-task-host", factory: adapter.extension }] });
	await loader.reload();
	const created = await createAgentSession({ cwd, agentDir: join(cwd, "agent"), model: keeper.getModel("keeper"), modelRuntime,
		thinkingLevel: "off", noTools: "builtin", resourceLoader: loader, sessionManager, settingsManager });
	session = created.session;
	const errors = [...created.extensionsResult.errors];
	await session.bindExtensions({ mode: "rpc", onError: error => errors.push(error) });
	t.after(async () => {
		try { if (session._extensionRunner?.hasHandlers?.("session_shutdown")) await session._extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); }
		finally { restore(); await settle(50); await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
	});
	return { session, adapter, store, control, errors,
		async requests() { return existsSync(requestLog) ? (await readFile(requestLog, "utf8")).split("\n").filter(Boolean).map(JSON.parse) : []; },
		async proxyRequests() { return existsSync(proxyLog) ? (await readFile(proxyLog, "utf8")).split("\n").filter(Boolean).map(JSON.parse) : []; } };
}

const responses = text => [
	fauxAssistantMessage([fauxToolCall("submit_plan_packet", plan)], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" }),
];

test("public plan settles one guarded ordinary resolve with the issued profile and canonical roll", async t => {
	const batches = [], host = await openHost(t, { responses: responses("The careful search succeeds."),
		decide(batch) { batches.push(structuredClone(batch)); return decisionResult(batch); } });
	await host.session.prompt(host.control.playerText, { source: "rpc" });
	const status = host.adapter.status(), calls = host.control.calls, proxyCalls = await host.proxyRequests();
	assert.deepEqual(host.errors, []);
	assert.equal(status.task.status, "closed"); assert.equal(status.task.reason, "delivered");
	assert.deepEqual(status.task.observations.map(row => row.proposal.operation), ["resolve.options", "resolve"]);
	assert.deepEqual(batches.map(batch => [batch.family, batch.familyVersion, batch.questions.map(q => q.key)]), [
		["ordinary-resolve", "2", ["route", "consent", "actor", "intent", "difficulty", "bonus", "penalty"]],
		["ordinary-resolve", "2", ["profile"]],
	]);
	const resolveCall = proxyCalls.find(row => row.method === "table.resolve");
	assert.ok(resolveCall, JSON.stringify({ task: status.task, batches, order: host.control.order, calls }));
	const request = resolveCall.params;
	assert.equal(request._task_read_set, true);
	assert.deepEqual(request.action, { actor: "托马斯·海耶斯", intent: "investigate", goal: plan.goal,
		method: host.control.playerText, skill: "Spot Hidden", decision: "core-check:ordinary-check",
		modifiers: { difficulty: "regular", bonus_dice: 0, penalty_dice: 0, reason: host.control.playerText } });
	const observed = status.task.observations[1];
	assert.equal(observed.packet.result.outcome.target, 55); assert.equal(observed.packet.result.outcome.roll, 42);
	assert.deepEqual(observed.packet.receipts, ["roll:spot-hidden-t1-c1"]);
	assert.equal(proxyCalls.filter(row => row.method === "table.resolve").length, 1); assert.equal(proxyCalls.some(row => row.method === "table.apply"), false);
	assert.deepEqual(host.control.order.filter(value => ["admission", "mod.prepare", "mod.after"].includes(value)), ["admission", "mod.prepare", "mod.after"]);
	const proxyResolve = proxyCalls.find(row => row.method === "table.resolve");
	assert.ok(proxyResolve.at >= host.control.resolvePrepareAt && proxyResolve.at <= host.control.resolveAfterAt);
	assert.deepEqual(host.control.hooks.filter(row => row.id === observed.proposal.id).map(row => row.type), ["tool_call", "tool_result"]);
	const identity = Object.values(status.task.identities).find(value => value.callId);
	assert.equal(identity.callId, "t1-c1"); assert.equal(identity.request._task_read_set, true);
	const planResult = host.session.messages.find(message => message.role === "toolResult" && message.toolName === "submit_plan_packet");
	const modelText = JSON.stringify(planResult?.content ?? []);
	assert.equal(modelText.includes("_task_advance"), false);
	assert.equal(modelText.includes("profile:0"), false, "the raw profile catalog remains internal to the decision domain");
	assert.equal(modelText.includes("resolve-options-r1"), false);
	assert.equal(modelText.includes("Current canonical options and source bindings were checked"), true);
});

test("a lost resolve response recovers the canonical receipt, advances freshness, and narrates without a second roll", async t => {
	const host = await openHost(t, { responses: responses("The recovered search succeeds once."), lostResponse: true });
	await host.session.prompt(host.control.playerText, { source: "rpc" });
	const status = host.adapter.status(), proxyCalls = await host.proxyRequests();
	assert.equal(status.task.status, "closed"); assert.equal(status.task.reason, "delivered");
	assert.equal(proxyCalls.filter(row => row.method === "table.resolve").length, 1);
	assert.equal(proxyCalls.filter(row => row.method === "table.call_status").length, 1);
	assert.equal(proxyCalls.filter(row => row.method === "table.narrate").length, 1);
	const resolved = status.task.observations.find(row => row.proposal.operation === "resolve").packet;
	assert.equal(resolved.status, "succeeded"); assert.equal(resolved.result.replayed, true);
	assert.deepEqual(resolved.receipts, ["roll:spot-hidden-t1-c1"]);
	assert.equal(status.task.checkpoint.context.readSet.find(row => row.kind === "world").revision, "world-r2");
});

for (const kind of ["stale", "cancelled"]) {
	test(`${kind} foreground resolve never executes the canonical mutation`, async t => {
		const started = Promise.withResolvers();
		const host = await openHost(t, { responses: [fauxAssistantMessage([fauxToolCall("submit_plan_packet", plan)], { stopReason: "toolUse" })],
			staleAfterOptions: kind === "stale",
			decide: kind === "cancelled" ? (_batch, lease) => {
				started.resolve(); return new Promise((_resolve, reject) => lease.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
			} : batch => decisionResult(batch) });
		const running = host.session.prompt(host.control.playerText, { source: "rpc" }).catch(() => undefined);
		if (kind === "cancelled") { await started.promise; await host.session._extensionRunner.emit({ type: "input", text: "Stop.", source: "rpc" }); }
		await Promise.race([running, settle(5_000).then(() => { throw new Error(`${kind} resolve did not settle`); })]);
		for (let index = 0; index < 50 && host.session.isStreaming; index++) await settle(10);
		for (let index = 0; index < 100 && !host.adapter.status().task?.result; index++) await settle(10);
		await settle(50);
		const proxyCalls = await host.proxyRequests();
		assert.equal(proxyCalls.filter(row => row.method === "table.resolve").length, 0); assert.equal(host.control.order.includes("admission"), false);
		assert.equal(host.control.order.includes("mod.prepare"), false);
		const task = kind === "cancelled"
			? [...host.store.records.values()].find(record => record.result?.status === "cancelled")
			: host.adapter.status().task;
		assert.ok(task?.result, JSON.stringify([...host.store.records.values()]));
		assert.equal(task.result.status, kind);
	});
}

test("cancellation after canonical settlement preserves the receipt and never delivers prose", async t => {
	const host = await openHost(t, { responses: responses("This must not be delivered."), cancelAfterSettlement: true });
	await host.session.prompt(host.control.playerText, { source: "rpc" }).catch(() => undefined);
	await settle(50);
	const status = host.adapter.status(), proxyCalls = await host.proxyRequests();
	assert.equal(status.task.result.status, "cancelled");
	assert.deepEqual(status.task.result.receipts, ["roll:spot-hidden-t1-c1"]);
	assert.equal(proxyCalls.filter(row => row.method === "table.resolve").length, 1);
	assert.equal(proxyCalls.some(row => row.method === "table.narrate"), false);
});

test("a nonordinary classification returns to its incumbent owner with zero mutation", async t => {
	const host = await openHost(t, { responses: responses("That action needs its specialized rule owner."),
		decide: batch => decisionResult(batch, "incumbent") });
	await host.session.prompt("I attack Knott with a chair.", { source: "rpc" });
	const status = host.adapter.status(), proxyCalls = await host.proxyRequests();
	assert.equal(status.task.result.status, "unresolved");
	assert.deepEqual(status.task.result.handoff, { verbs: ["resolve"] });
	assert.equal(proxyCalls.filter(row => row.method === "table.resolve").length, 0);
	assert.equal(host.control.order.includes("admission"), false);
	assert.equal(host.control.order.includes("mod.prepare"), false);
	assert.equal(status.task.observations.length, 1);
	assert.equal(status.task.observations[0].proposal.operation, "resolve.options");
});
