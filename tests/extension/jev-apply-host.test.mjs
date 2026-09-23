/** T12 public ordinary-apply host conformance. Controlled choices are not gameplay. */
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

class Store { records = new Map(); async load(id) { return structuredClone(this.records.get(id)); } async list() { return [...this.records.values()].map(structuredClone); } async save(record) { this.records.set(record.checkpoint.context.id, structuredClone(record)); } }
function setEnv(values) { const prior = new Map(); for (const [key, value] of Object.entries(values)) { prior.set(key, process.env[key]); if (value === undefined) delete process.env[key]; else process.env[key] = value; } return () => { for (const [key, value] of prior) value === undefined ? delete process.env[key] : process.env[key] = value; }; }

const applyPlan = { goal: "Take Knott's research lead and go to the newspaper office.", subgoals: [], constraints: ["Commit one atomic batch."],
	evidenceRequired: ["The clue and chosen route settle together."], completion: ["The exact batch is committed."], capabilities: ["apply"], replanWhen: [], returnWhen: [] };
const combinedPlan = { ...applyPlan, goal: "Search first, then take the research lead.", capabilities: ["resolve", "apply"] };

function decisions(batch, mode = "apply") {
	const raw = Object.fromEntries(batch.questions.map(question => {
		let choice;
		if (question.key === "route") choice = "ordinary";
		else if (question.key === "consent") choice = "authorized";
		else if (question.key === "actor") choice = "actor_0";
		else if (question.key === "intent") choice = "investigate";
		else if (question.key === "difficulty") choice = "regular";
		else if (["bonus", "penalty"].includes(question.key)) choice = "none";
		else if (question.key === "profile") choice = Object.entries(question.criteria).find(([, value]) => value?.skill === "Spot Hidden")?.[0] ?? "unknown";
		else if (question.key === "scope") choice = mode === "no_effect" ? "no_effect" : mode === "unsupported" ? "unsupported" : "covered";
		else if (question.key === "batch") choice = "supported";
		else if (question.key.startsWith("effect:")) {
			if (mode === "unknown") choice = "unknown";
			else if (mode === "exclude") choice = "exclude";
			else choice = ["effect:0", "effect:1"].includes(question.key) ? "include" : "exclude";
		} else choice = Object.keys(question.criteria)[0];
		return [question.key, { status: "answered", type: "choice", choice,
			probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === choice ? 1 : 0])) }];
	}));
	return bindDecisionAnswers(batch, raw, { inputTokens: 1, outputTokens: 1, costUsd: 0 });
}

async function openHost(t, { plan = applyPlan, mode = "apply", lostApply = false, combined = false } = {}) {
	const cwd = await mkdtemp(join(tmpdir(), "jev-apply-host-")), proxy = join(cwd, "proxy.mjs"), proxyLog = join(cwd, "proxy.jsonl"), requestLog = join(cwd, "kernel.jsonl");
	await writeFile(proxy, `import {spawn} from "node:child_process";import {appendFile} from "node:fs/promises";import {createInterface} from "node:readline";
const child=spawn(process.execPath,[${JSON.stringify(FAKE_KERNEL)},...process.argv.slice(2)],{env:process.env,stdio:["pipe","pipe","inherit"]}),wait=[];createInterface({input:child.stdout}).on("line",line=>wait.shift()?.(JSON.parse(line)));const forward=request=>new Promise(resolve=>{wait.push(resolve);child.stdin.write(JSON.stringify(request)+"\\n")});
let world="world-r1",sequence=1,lost=false;const ledger=new Map(),receipts=[];const candidates=[{alias:"effect:0",effect:{kind:"clue",clue:"knott-research-leads"},description:{kind:"clue",name:"knott-research-leads",authority:"authored_candidate_not_discovered"}},{alias:"effect:1",effect:{kind:"move",to:"newspaper-morgue"},description:{kind:"move",to:"newspaper-morgue",display_name:"Boston Globe offices",authority:"available_route_not_player_choice"}},{alias:"effect:2",effect:{kind:"clue",clue:"knott-commission"},description:{kind:"clue",name:"knott-commission",authority:"authored_candidate_not_discovered"}}];
const patch=value=>{if(!value||typeof value!=="object")return;if(value._context&&typeof value._context==="object")Object.assign(value._context,{world_revision:world,task_world_revision:world,source_revision:"source-r1",task_source_revision:"source-r1"});for(const child of Object.values(value))patch(child)};
for await(const line of createInterface({input:process.stdin})){const request=JSON.parse(line);await appendFile(${JSON.stringify(proxyLog)},JSON.stringify({at:Date.now(),method:request.method,params:request.params})+"\\n");let response;
if(request.method==="table.apply.options")response={id:request.id,ok:true,result:{version:1,candidates,revision:"apply-options-r1",world_revision:world,context:{scene:"Knott's Office",pending_choice:null,session:null,present:["Steven Knott"],current_receipts:structuredClone(receipts),coverage:{effect_families:["clue","move"],other_families:"incumbent"}}}};
else if(request.method==="table.resolve.options")response={id:request.id,ok:true,result:{version:1,profiles:[{alias:"profile:0",actor:"托马斯·海耶斯",skill:"Spot Hidden",availability:"bound",value:55}],decisions:[{name:"core-check:ordinary-check",family:"core-check",description:"ordinary",capability:"check"}],revision:"resolve-options-r1",world_revision:world,context:{scene:"Knott's Office",pending_choice:null,session:null,conditions:[],current_receipts:structuredClone(receipts),declared_action:"Search first."}}};
else if(request.method==="table.call_status"){const result=ledger.get(request.params.call_id);response={id:request.id,ok:true,result:result?{status:"settled",call_id:request.params.call_id,call_turn:1,active_turn:1,scope:{worldline:"main",loop:0},result:{...structuredClone(result),replayed:true}}:{status:"absent",call_id:request.params.call_id,call_turn:1,active_turn:1,scope:{worldline:"main",loop:0}}};}
else{response=await forward(request);if(["table.resolve","table.apply"].includes(request.method)&&response.ok){const result=response.result,ids=[result.receipt,...(result.receipts??[])].filter((v,i,a)=>typeof v==="string"&&a.indexOf(v)===i),before=world;world="world-r"+(++sequence);result._task_advance={campaign:"apply-host",turn:1,worldline:"main",loop:0,operationId:request.params.call_id,receiptIds:ids,before:"broad-r"+(sequence-1),after:"broad-r"+sequence,task_before:before,task_after:world};ledger.set(request.params.call_id,structuredClone(result));for(const id of ids)receipts.push({kind:id.startsWith("roll:")?"roll":"effect",outcome:result.outcome?.level??null});if(request.method==="table.apply"&&process.env.APPLY_PROXY_LOST==="1"&&!lost){lost=true;response={id:request.id,ok:false,error:{code:"internal",message:"controlled lost apply response"}};}}patch(response.result);}process.stdout.write(JSON.stringify(response)+"\\n")}child.kill();`, "utf8");
	const hidden = Object.fromEntries(Object.keys(process.env).filter(key => /(_API_KEY|_TOKEN|_SECRET)$/.test(key)).map(key => [key, undefined]));
	const restore = setEnv({ ...hidden, PI_COC_KERNEL_CMD: JSON.stringify([process.execPath, proxy]), APPLY_PROXY_LOST: lostApply ? "1" : undefined,
		PI_COC_CAMPAIGN: "apply-host", PI_COC_MODE: "play", PI_COC_MEMORY_BACKFILL: "0", PI_COC_MODS_WAIT_MS: "0", PI_COC_ADMISSION_MODEL: "admission/a1", PI_OFFLINE: "1", FAKE_KERNEL_LOG: requestLog, FAKE_KERNEL_WORKSPACE: "1" });
	const keeper = fauxProvider({ provider: "apply-host-provider", models: [{ id: "keeper", reasoning: false }] });
	keeper.setResponses([fauxAssistantMessage([fauxToolCall("submit_plan_packet", plan)], { stopReason: "toolUse" }), fauxAssistantMessage([fauxToolCall("narrate", { text: "The selected outcome is now visible." })], { stopReason: "toolUse" })]);
	const admission = fauxProvider({ provider: "admission", models: [{ id: "a1", reasoning: false }] });admission.setResponses(Array.from({ length: 8 }, () => fauxAssistantMessage(JSON.stringify({ verdict: "authorized", grounds: "The player explicitly chose this batch." }))));
	const order = [], wrap = provider => ({ ...provider, stream(...args) { order.push("admission"); return provider.stream(...args); }, streamSimple(...args) { order.push("admission"); return provider.streamSimple(...args); } });
	const modelRuntime = await ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: null, modelsStorePath: join(cwd, "models.json"), refreshOnCreate: false });modelRuntime.registerNativeProvider(keeper.provider);modelRuntime.registerNativeProvider(wrap(admission.provider));
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }), sessionManager = SessionManager.inMemory(cwd), store = new Store();let session;
	const batches = [], adapter = createTaskHostAdapter(() => session, { async decide(batch) { batches.push(structuredClone(batch)); return decisions(batch, mode); } }, { applyEnabled: true, resolveEnabled: combined, store, deadlineMs: 30_000 });
	const hooks = [], mods = { async prepare(method, payload) { if (["resolve", "apply"].includes(method)) { order.push(`${method}.prepare`); mods[method] = structuredClone(payload); } }, async after(method) { if (["resolve", "apply"].includes(method)) order.push(`${method}.after`); } };
	const probe = { name: "apply-host-probe", factory(pi) { pi.events.on("coc:capsule", value => {
		const context = value?.context ?? value?.capsule?._context ?? {};
		value.context = { campaign: "apply-host", worldline: "main", loop: 0, turn: value.turn ?? 1,
			source_revision: "source-r1", task_source_revision: "source-r1", world_revision: "world-r1", task_world_revision: "world-r1", ...structuredClone(context) };
	});pi.on("session_start", () => pi.events.emit("coc:mods-bridge", mods));pi.on("tool_call", e => hooks.push({ type: "tool_call", id: e.toolCallId, name: e.toolName }));pi.on("tool_result", e => hooks.push({ type: "tool_result", id: e.toolCallId, name: e.toolName })); } };
	const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager, extensionFactories: [probe, { name: "kernel", factory: kernelExtension }, { name: "task-host", factory: adapter.extension }] });await loader.reload();
	const created = await createAgentSession({ cwd, agentDir: join(cwd, "agent"), model: keeper.getModel("keeper"), modelRuntime, thinkingLevel: "off", noTools: "builtin", resourceLoader: loader, sessionManager, settingsManager });session = created.session;const errors = [...created.extensionsResult.errors];await session.bindExtensions({ mode: "rpc", onError: e => errors.push(e) });
	t.after(async () => { try { if (session._extensionRunner?.hasHandlers?.("session_shutdown")) await session._extensionRunner.emit({ type: "session_shutdown", reason: "quit" });session.dispose(); } finally { restore();await settle(50);await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } });
	return { session, adapter, store, batches, order, hooks, mods, errors, async proxyCalls() { return existsSync(proxyLog) ? (await readFile(proxyLog, "utf8")).split("\n").filter(Boolean).map(JSON.parse) : []; } };
}

test("public plan commits one clue-and-move batch through admission, Mods, hooks, and writer", async t => {
	const host = await openHost(t);
	await host.session.prompt("I take Knott's research lead and go to the newspaper office.", { source: "rpc" });
	const task = host.adapter.status().task, calls = await host.proxyCalls();
	assert.deepEqual(host.errors, []);assert.equal(task.status, "closed");assert.equal(task.reason, "delivered");
	assert.deepEqual(task.observations.map(row => row.proposal.operation), ["apply.options", "apply"]);
	const apply = calls.find(row => row.method === "table.apply");assert.ok(apply);
	assert.deepEqual(apply.params.effects, [{ kind: "clue", clue: "knott-research-leads" }, { kind: "move", to: "newspaper-morgue" }]);
	assert.equal(apply.params._task_read_set, true);assert.equal(calls.filter(row => row.method === "table.apply").length, 1);
	assert.deepEqual(host.order.filter(value => value.includes("admission") || value.startsWith("apply.")), ["admission", "apply.prepare", "apply.after"]);
	const observed = task.observations[1];assert.ok(observed.packet.receipts.length >= 2);
	assert.deepEqual(host.hooks.filter(row => row.id === observed.proposal.id).map(row => row.type), ["tool_call", "tool_result"]);
	const tool = host.session.messages.find(row => row.role === "toolResult" && row.toolName === "submit_plan_packet"), text = JSON.stringify(tool?.content ?? []);
	assert.equal(text.includes("effect:0"), false);assert.equal(text.includes("apply-options-r1"), false);assert.equal(text.includes("_task_advance"), false);
});

for (const mode of ["no_effect", "unsupported", "unknown", "exclude"]) test(`${mode} catalog decision causes zero apply mutation`, async t => {
	const host = await openHost(t, { mode });await host.session.prompt("Discuss the route without choosing it.", { source: "rpc" });
	const calls = await host.proxyCalls(), task = host.adapter.status().task;
	assert.equal(calls.some(row => row.method === "table.apply"), false);assert.equal(host.order.includes("admission"), false);assert.equal(host.order.includes("apply.prepare"), false);
	assert.deepEqual(task.observations.map(row => row.proposal.operation), ["apply.options"]);
});

test("lost apply response recovers one canonical batch and never applies it twice", async t => {
	const host = await openHost(t, { lostApply: true });await host.session.prompt("I take Knott's research lead and go to the newspaper office.", { source: "rpc" });
	const calls = await host.proxyCalls(), task = host.adapter.status().task;
	assert.equal(calls.filter(row => row.method === "table.apply").length, 1);assert.equal(calls.filter(row => row.method === "table.call_status").length, 1);
	assert.equal(task.status, "closed");assert.equal(task.reason, "delivered");
	const applied = task.observations.find(row => row.proposal.operation === "apply").packet;assert.equal(applied.status, "succeeded");assert.equal(applied.result.replayed, true);assert.ok(applied.receipts.length >= 2);
});

test("resolve then apply uses the actual roll receipt in the following current effect snapshot", async t => {
	const host = await openHost(t, { plan: combinedPlan, combined: true });await host.session.prompt("I search first, then take the research lead.", { source: "rpc" });
	const task = host.adapter.status().task, calls = await host.proxyCalls();
	assert.deepEqual(task.observations.map(row => row.proposal.operation), ["resolve.options", "resolve", "apply.options", "apply"]);
	const options = task.observations.find(row => row.proposal.operation === "apply.options").packet.result;
	assert.equal(options.context.current_receipts.length, 1);assert.equal(options.context.current_receipts[0].kind, "roll");
	assert.equal(calls.filter(row => row.method === "table.resolve").length, 1);assert.equal(calls.filter(row => row.method === "table.apply").length, 1);
	assert.ok(task.result.receipts.some(id => id.startsWith("roll:")));assert.ok(task.result.receipts.length >= 3);
});
