/** T15 structured incumbent-owner handoff conformance. Controlled decisions are not gameplay. */
import {strict as assert} from "node:assert";
import {existsSync} from "node:fs";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setTimeout as settle} from "node:timers/promises";
import {test} from "node:test";
import {fauxAssistantMessage,fauxProvider,fauxToolCall} from "@earendil-works/pi-ai";
import {createAgentSession,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager} from "./pi.mjs";
import kernelExtension from "../../extensions/kernel/index.ts";
import {bindDecisionAnswers, ContractError} from "../../runtime/jev/contracts.ts";
import {createOrdinaryApplyDomain} from "../../runtime/jev/ordinary-apply-domain.ts";
import {createOrdinaryResolveDomain} from "../../runtime/jev/ordinary-resolve-domain.ts";
import {createTableEvidenceDomain} from "../../runtime/jev/table-evidence-domain.ts";
import {createTaskHostAdapter} from "../../runtime/jev/task-host-session.ts";
import {TaskRuntime} from "../../runtime/jev/task-runtime.ts";
import {FAKE_KERNEL} from "./harness.mjs";

class Store {records=new Map();async load(id){return structuredClone(this.records.get(id));}async save(record){this.records.set(record.checkpoint.context.id,structuredClone(record));}}
const scope={owner:"handoff:campaign",campaign:"campaign",worldline:"main",loop:0,audience:"keeper"};
const readSet=[{kind:"world",resource:"campaign",revision:"world-r1"}];
const rawInput="I attack the cultist with the chair.";
const rawRef={version:1,scope,resource:"turn:1:player",revision:"input-r1",sourceType:"turn",selector:{kind:"utf16",start:0,end:rawInput.length}};
const plan=capabilities=>({goal:"Settle the declared action.",subgoals:[],constraints:[],evidenceRequired:[],
	completion:["The action reaches its exact owner."],capabilities,replanWhen:[],returnWhen:[]});
const packet=(proposal,status,result={},receipts=[],diagnostics)=>({operationId:proposal.id,status,result,refs:[],receipts,readSet:proposal.readSet,
	coverage:{used:[],omitted:[],unknown:[]},...(diagnostics?{diagnostics}:{})});
const resolveOptions=context=>({version:1,profiles:[{alias:"profile:0",actor:"Alice",skill:"Spot Hidden",availability:"bound",value:55}],
	decisions:[{name:"core-check:ordinary-check",family:"core-check",description:"One ordinary check.",capability:"check"}],
	revision:"resolve-r1",world_revision:"world-r1",context:{scene:"Office",pending_choice:null,session:null,conditions:[],current_receipts:[],declared_action:rawInput,...context}});
const applyCandidate={alias:"effect:0",effect:{kind:"clue",clue:"lead"},description:{kind:"clue",name:"Lead"}};
const applyOptions=context=>({version:1,candidates:[applyCandidate],revision:"apply-r1",world_revision:"world-r1",
	context:{scene:"Office",pending_choice:null,session:null,present:[],current_receipts:[],coverage:{effect_families:["clue"],other_families:"incumbent"},...context}});

function answer(batch,selection){
	const raw=Object.fromEntries(batch.questions.map(question=>{
		const choice=selection(question,batch);
		if(choice===undefined)return[question.key,{status:"unknown"}];
		return[question.key,{status:"answered",type:"choice",choice,
			probabilities:Object.fromEntries(Object.keys(question.criteria).map(key=>[key,key===choice?1:0]))}];
	}));
	return bindDecisionAnswers(batch,raw,{inputTokens:1,outputTokens:1,costUsd:0});
}
const ordinaryResolve=question=>({route:"ordinary",consent:"authorized",actor:"actor_0",intent:"investigate",difficulty:"regular",bonus:"none",penalty:"none",profile:"profile_0"})[question.key];
function setup({domain,capabilities,decide,dispatch}){
	const store=new Store(),calls=[];
	const runtime=new TaskRuntime({store,domains:[domain],decision:{decide},operations:{async validate(){return readSet;},async dispatch(proposal,lease,journal){calls.push(structuredClone(proposal));return dispatch(proposal,lease,journal);}}});
	return{runtime,store,calls,async begin(){return runtime.begin({domain:domain.id,intent:{id:"intent",rawInput:rawRef,limits:[],scope,turn:1,inputRevision:rawRef.revision},
		lease:{owner:"keeper",goal:"Settle the declared action.",scope,capabilities,readSet,budget:{deadlineAt:Date.now()+60_000,remainingInputTokens:100_000,remainingOutputTokens:100_000,remainingCostUsd:10,remainingActions:64}}});}};
}
async function rejects(code,action){await assert.rejects(action,error=>error instanceof ContractError&&error.code===code);}

function setEnv(values){const prior=new Map();for(const[key,value]of Object.entries(values)){prior.set(key,process.env[key]);if(value===undefined)delete process.env[key];else process.env[key]=value;}return()=>{for(const[key,value]of prior)value===undefined?delete process.env[key]:process.env[key]=value;};}

async function publicHandoffHost(t){
	const cwd=await mkdtemp(join(tmpdir(),"jev-owner-handoff-")),requestLog=join(cwd,"requests.jsonl"),proxyLog=join(cwd,"proxy.jsonl"),proxy=join(cwd,"proxy.mjs"),store=new Store();
	await writeFile(proxy,`import {spawn} from "node:child_process";import {appendFile} from "node:fs/promises";import {createInterface} from "node:readline";
const child=spawn(process.execPath,[${JSON.stringify(FAKE_KERNEL)},...process.argv.slice(2)],{env:process.env,stdio:["pipe","pipe","inherit"]});
const replies=[];createInterface({input:child.stdout}).on("line",line=>replies.shift()?.(JSON.parse(line)));const forward=request=>new Promise(resolve=>{replies.push(resolve);child.stdin.write(JSON.stringify(request)+"\\n");});
let world="world-r1";const patch=value=>{if(!value||typeof value!=="object")return;if(value._context&&typeof value._context==="object")Object.assign(value._context,{world_revision:world,task_world_revision:world,source_revision:"source-r1",task_source_revision:"source-r1"});for(const child of Object.values(value))patch(child);};
for await(const line of createInterface({input:process.stdin})){const request=JSON.parse(line);await appendFile(${JSON.stringify(proxyLog)},JSON.stringify({method:request.method,params:request.params})+"\\n");const response=await forward(request);if(request.method==="table.resolve"&&response.ok){const result=response.result;result.receipts??=[result.receipt];result._task_advance={campaign:"handoff-host",turn:1,worldline:"main",loop:0,operationId:request.params.call_id,receiptIds:result.receipts,before:"broad-r1",after:"broad-r2",task_before:"world-r1",task_after:"world-r2"};world="world-r2";}patch(response.result);process.stdout.write(JSON.stringify(response)+"\\n");}child.kill();`,"utf8");
	const hidden=Object.fromEntries(Object.keys(process.env).filter(key=>/(_API_KEY|_TOKEN|_SECRET)$/.test(key)).map(key=>[key,undefined]));
	const restore=setEnv({...hidden,PI_COC_KERNEL_CMD:JSON.stringify([process.execPath,proxy]),PI_COC_CAMPAIGN:"handoff-host",PI_COC_MODE:"play",PI_COC_MEMORY_BACKFILL:"0",PI_COC_MODS_WAIT_MS:"0",PI_COC_ADMISSION_MODEL:"admission/a1",PI_OFFLINE:"1",FAKE_KERNEL_LOG:requestLog,FAKE_KERNEL_WORKSPACE:"1"});
	const keeper=fauxProvider({provider:"handoff-keeper",models:[{id:"keeper",reasoning:false}]});
	const incumbentAction={actor:"托马斯·海耶斯",intent:"investigate",goal:"Search the desk",method:"carefully",skill:"Spot Hidden",decision:"core-check:ordinary-check",modifiers:{difficulty:"regular",bonus_dice:0,penalty_dice:0,reason:"careful search"}};
	keeper.setResponses([
		fauxAssistantMessage([fauxToolCall("submit_plan_packet",plan(["resolve"]))],{stopReason:"toolUse"}),
		fauxAssistantMessage([fauxToolCall("resolve",{action:incumbentAction})],{stopReason:"toolUse"}),
		fauxAssistantMessage([fauxToolCall("narrate",{text:"The existing owner settles the search once."})],{stopReason:"toolUse"}),
	]);
	const admission=fauxProvider({provider:"admission",models:[{id:"a1",reasoning:false}]});admission.setResponses([fauxAssistantMessage(JSON.stringify({verdict:"authorized",grounds:"The player chose the search."}))]);
	const modelRuntime=await ModelRuntime.create({authPath:join(cwd,"auth.json"),modelsPath:null,modelsStorePath:join(cwd,"models.json"),refreshOnCreate:false});modelRuntime.registerNativeProvider(keeper.provider);modelRuntime.registerNativeProvider(admission.provider);
	const settingsManager=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}}),sessionManager=SessionManager.inMemory(cwd),control={hooks:[],activeAtResolve:[],mods:[]};let session;
	const adapter=createTaskHostAdapter(()=>session,{decide:batch=>answer(batch,question=>question.key==="route"?"incumbent":ordinaryResolve(question))},{resolveEnabled:true,applyEnabled:true,store,deadlineMs:30_000});
	const probe={name:"handoff-probe",factory(pi){
		pi.events.on("coc:kernel-bridge",value=>{if(!value?.call||control.bridge===value)return;control.bridge=value;const original=value.call.bind(value);value.call=async(method,params)=>method==="table.resolve.options"?resolveOptions():original(method,params);});
		pi.events.on("coc:capsule",value=>{const context=value?.context??value?.capsule?._context;if(context&&typeof context==="object")value.context={...structuredClone(context),world_revision:"world-r1",task_world_revision:"world-r1",source_revision:"source-r1",task_source_revision:"source-r1"};});
		pi.on("tool_call",event=>{control.hooks.push(["call",event.toolName,event.toolCallId]);if(event.toolName==="resolve")control.activeAtResolve=pi.getActiveTools();});
		pi.on("tool_result",event=>control.hooks.push(["result",event.toolName,event.toolCallId,event.isError]));
		pi.on("session_start",()=>pi.events.emit("coc:mods-bridge",{async prepare(method){if(method==="resolve")control.mods.push("prepare");},async after(method){if(method==="resolve")control.mods.push("after");}}));
	}};
	const loader=new DefaultResourceLoader({cwd,agentDir:join(cwd,"agent"),settingsManager,extensionFactories:[probe,{name:"coc-kernel",factory:kernelExtension},{name:"task-host",factory:adapter.extension}]});await loader.reload();
	const created=await createAgentSession({cwd,agentDir:join(cwd,"agent"),model:keeper.getModel("keeper"),modelRuntime,thinkingLevel:"off",noTools:"builtin",resourceLoader:loader,sessionManager,settingsManager});session=created.session;const errors=[...created.extensionsResult.errors];await session.bindExtensions({mode:"rpc",onError:error=>errors.push(error)});
	t.after(async()=>{try{if(session._extensionRunner?.hasHandlers?.("session_shutdown"))await session._extensionRunner.emit({type:"session_shutdown",reason:"quit"});session.dispose();}finally{restore();await settle(30);await rm(cwd,{recursive:true,force:true,maxRetries:5,retryDelay:20});}});
	return{session,adapter,control,errors,async requests(){return existsSync(proxyLog)?(await readFile(proxyLog,"utf8")).split("\n").filter(Boolean).map(JSON.parse):[];}};
}

test("structured handoff keeps the same live lease and binds only the named incumbent verb",async()=>{
	const domain={id:"handoff",version:"1",capabilities:["resolve","apply"],next:()=>({kind:"handoff",verbs:["resolve"],remainingNeeds:["Use the specialized resolution owner."]})};
	const app=setup({domain,capabilities:["resolve","apply"],decide(){throw new Error("handoff needs no decision");},dispatch(){throw new Error("typed dispatch must not run");}});
	const id=await app.begin(),before=app.runtime.lease(id).context;
	const result=await app.runtime.submit(id,plan(["resolve","apply"]));
	const record=app.runtime.snapshot(id);
	assert.equal(result.status,"unresolved");assert.deepEqual(result.handoff,{verbs:["resolve"]});
	assert.equal(record.status,"ready");assert.equal(record.phase,"composing");assert.equal(app.runtime.lease(id).signal.aborted,false);
	assert.equal(app.runtime.lease(id).context.rootId,before.rootId);assert.equal(app.runtime.lease(id).context.budget.deadlineAt,before.budget.deadlineAt);
	await rejects("task_not_planning",()=>app.runtime.submit(id,plan(["resolve"])));
	await rejects("incumbent_handoff_unavailable",()=>app.runtime.beginIncumbent(id,"apply",{effects:[]}));

	const bound=await app.runtime.beginIncumbent(id,"resolve",{action:{actor:"Alice",intent:"combat"}});
	assert.equal(bound.proposal.operation,"resolve");assert.equal(bound.proposal.taskId,id);assert.deepEqual(bound.proposal.args,{action:{actor:"Alice",intent:"combat"}});
	assert.equal(app.runtime.snapshot(id).pending.proposal.id,bound.proposal.id);
	await app.runtime.completeIncumbent(id,packet(bound.proposal,"succeeded",{outcome:{kind:"success"}},["receipt:combat"]));
	assert.deepEqual(app.runtime.snapshot(id).result.receipts,["receipt:combat"]);
	assert.deepEqual(app.runtime.snapshot(id).result.handoff,{verbs:["resolve"]},"the incumbent may take its own dependent next step under the same handoff");
});

test("the public SDK releases only the handed-off verb through the existing hooks and canonical journal",async t=>{
	const host=await publicHandoffHost(t);
	await host.session.prompt(rawInput,{source:"rpc"});
	const record=host.adapter.status().task,requests=await host.requests();
	assert.deepEqual(host.errors,[]);
	assert.equal(record.status,"closed");assert.equal(record.reason,"delivered");
	assert.ok(host.control.activeAtResolve.includes("resolve"),JSON.stringify({active:host.control.activeAtResolve,hooks:host.control.hooks,messages:host.session.messages,record}));assert.equal(host.control.activeAtResolve.includes("apply"),false);
	const visible=host.session.messages.filter(message=>message.role==="assistant").flatMap(message=>message.content.filter(block=>block.type==="toolCall").map(block=>block.name));
	assert.deepEqual(visible,["submit_plan_packet","resolve","narrate"]);
	assert.equal(requests.filter(row=>row.method==="table.resolve").length,1,JSON.stringify({requests,hooks:host.control.hooks,messages:host.session.messages,record}));assert.equal(requests.filter(row=>row.method==="table.apply").length,0);
	assert.deepEqual(host.control.mods,["prepare","after"]);
	const incumbent=record.observations.find(row=>row.proposal.operation==="resolve");assert.ok(incumbent,JSON.stringify(record));
	assert.deepEqual(incumbent.packet.receipts,["roll:spot-hidden-t1-c1"]);
	assert.deepEqual(host.control.hooks.filter(row=>row[2]===incumbent.proposal.id),[],"the public tool id stays separate from the host proposal id");
	const publicResolve=host.control.hooks.find(row=>row[0]==="call"&&row[1]==="resolve");assert.ok(publicResolve);
	assert.deepEqual(host.control.hooks.filter(row=>row[2]===publicResolve[2]).map(row=>row[0]),["call","result"]);
	const identity=record.identities[incumbent.proposal.id];assert.equal(identity.callId,"t1-c1");assert.equal(identity.request._task_read_set,true);
	assert.equal(record.checkpoint.context.readSet.find(binding=>binding.kind==="world").revision,"world-r2");
});

test("pending, stale, and cancelled incumbent outcomes remove handoff authority",async t=>{
	for(const [name,status,diagnostics,expected] of [
		["unknown settlement","pending",[{code:"settlement_unknown"}],{phase:"waiting",status:"waiting",result:"pending"}],
		["stale","stale",undefined,{phase:"terminal",status:"closed",result:"stale"}],
		["cancelled","cancelled",undefined,{phase:"terminal",status:"closed",result:"cancelled"}],
	])await t.test(name,async()=>{
		const domain={id:`handoff-${status}`,version:"1",capabilities:["apply"],next:()=>({kind:"handoff",verbs:["apply"],remainingNeeds:["Use the incumbent apply owner."]})};
		const app=setup({domain,capabilities:["apply"],decide(){throw new Error("no decision");},dispatch(){throw new Error("no typed dispatch");}});
		const id=await app.begin();await app.runtime.submit(id,plan(["apply"]));
		const bound=await app.runtime.beginIncumbent(id,"apply",{effects:[{kind:"move",to:"hall"}]});
		await app.runtime.completeIncumbent(id,packet(bound.proposal,status,{},[],diagnostics));
		const record=app.runtime.snapshot(id);
		assert.equal(record.phase,expected.phase);assert.equal(record.status,expected.status);assert.equal(record.result.status,expected.result);
		assert.equal(record.result.handoff,undefined);await rejects("incumbent_handoff_unavailable",()=>app.runtime.beginIncumbent(id,"apply",{}));
	});
});

test("a prior typed mutation prevents a later initial owner handoff",async()=>{
	const domain={id:"settled-before-handoff",version:"1",capabilities:["resolve","apply"],next(view){
		if(!view.observations.length)return{kind:"operation",key:"typed-resolve",operation:"resolve",capability:"resolve",args:{action:{}},basis:[]};
		return{kind:"handoff",verbs:["apply"],remainingNeeds:["The apply family is incumbent."]};
	}};
	const app=setup({domain,capabilities:["resolve","apply"],decide(){throw new Error("no decision");},dispatch:proposal=>packet(proposal,"succeeded",{},["receipt:resolve"])});
	const id=await app.begin(),result=await app.runtime.submit(id,plan(["resolve","apply"]));
	assert.equal(result.status,"partial");assert.equal(result.handoff,undefined);assert.deepEqual(result.receipts,["receipt:resolve"]);
	assert.equal(app.calls.length,1);await rejects("incumbent_handoff_unavailable",()=>app.runtime.beginIncumbent(id,"apply",{}));
});

test("a combined resolve-then-apply plan hands both planned verbs to the same incumbent owner",async()=>{
	const domain=createTableEvidenceDomain({rawInput:()=>rawInput,capsule:()=>({}),resolveEnabled:true,applyEnabled:true});
	const app=setup({domain,capabilities:["resolve","apply"],
		decide:batch=>answer(batch,question=>question.key==="route"?"incumbent":ordinaryResolve(question)),
		dispatch:proposal=>proposal.operation==="resolve.options"?packet(proposal,"succeeded",resolveOptions()):packet(proposal,"failed",{})});
	const id=await app.begin(),result=await app.runtime.submit(id,plan(["resolve","apply"]));
	assert.deepEqual(result.handoff,{verbs:["resolve","apply"]});
	assert.deepEqual(app.calls.map(call=>call.operation),["resolve.options"]);
	const resolve=await app.runtime.beginIncumbent(id,"resolve",{action:{actor:"Alice"}});await app.runtime.completeIncumbent(id,packet(resolve.proposal,"refused",{coc_error:{code:"needs"}}));
	const apply=await app.runtime.beginIncumbent(id,"apply",{effects:[{kind:"move",to:"hall"}]});
	assert.equal(apply.proposal.operation,"apply");
});

test("ordinary resolve hands off only a closed incumbent family",async t=>{
	await t.test("incumbent route",async()=>{
		const app=setup({domain:createOrdinaryResolveDomain({rawInput:()=>rawInput}),capabilities:["resolve"],
			decide:batch=>answer(batch,question=>question.key==="route"?"incumbent":ordinaryResolve(question)),
			dispatch:proposal=>proposal.operation==="resolve.options"?packet(proposal,"succeeded",resolveOptions()):packet(proposal,"succeeded",{},["unexpected"])});
		const id=await app.begin(),result=await app.runtime.submit(id,plan(["resolve"]));
		assert.deepEqual(result.handoff,{verbs:["resolve"]});assert.equal(app.calls.filter(call=>call.operation==="resolve").length,0);
	});
	for(const [name,context,route,expected] of [
		["active subsystem",{session:{kind:"combat"}},undefined,"handoff"],
		["pending choice",{pending_choice:{kind:"luck"}},undefined,"needs_player"],
		["unknown route",{},"unknown","replan"],
	])await t.test(name,async()=>{
		const app=setup({domain:createOrdinaryResolveDomain({rawInput:()=>rawInput}),capabilities:["resolve"],
			decide:batch=>answer(batch,question=>question.key==="route"?route:ordinaryResolve(question)),
			dispatch:proposal=>packet(proposal,"succeeded",resolveOptions(context))});
		const id=await app.begin(),result=await app.runtime.submit(id,plan(["resolve"]));
		if(expected==="handoff")assert.deepEqual(result.handoff,{verbs:["resolve"]});
		else {assert.equal(result.handoff,undefined);assert.equal(expected==="needs_player"?result.status:app.runtime.snapshot(id).phase,expected==="needs_player"?"needs_player":"planning");}
		assert.equal(app.calls.filter(call=>call.operation==="resolve").length,0,"unknown or pending routing never dispatches settlement");
	});
});

test("ordinary apply hands off unsupported coverage but not unknown or player-choice coverage",async t=>{
	for(const [scopeChoice,expected] of [["unsupported","handoff"],["unknown","replan"],["needs_player","needs_player"]])await t.test(scopeChoice,async()=>{
		const app=setup({domain:createOrdinaryApplyDomain({rawInput:()=>rawInput}),capabilities:["apply"],
			decide:batch=>answer(batch,question=>question.key==="scope"?scopeChoice:question.key==="batch"?"supported":"include"),
			dispatch:proposal=>packet(proposal,"succeeded",applyOptions())});
		const id=await app.begin(),result=await app.runtime.submit(id,plan(["apply"]));
		if(expected==="handoff")assert.deepEqual(result.handoff,{verbs:["apply"]});
		else {assert.equal(result.handoff,undefined);assert.equal(expected==="replan"?app.runtime.snapshot(id).phase:result.status,expected==="replan"?"planning":"needs_player");}
		assert.equal(app.calls.filter(call=>call.operation==="apply").length,0);
	});
});
