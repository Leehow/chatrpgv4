/** T15 bounded in-goal replan conformance. Controlled decisions are not gameplay. */
import {strict as assert} from "node:assert";
import {test} from "node:test";
import {bindDecisionAnswers, ContractError} from "../../runtime/jev/contracts.ts";
import {createOrdinaryApplyDomain} from "../../runtime/jev/ordinary-apply-domain.ts";
import {createTableEvidenceDomain} from "../../runtime/jev/table-evidence-domain.ts";
import {TaskRuntime} from "../../runtime/jev/task-runtime.ts";

class Store {
	records = new Map();
	async load(id) { return structuredClone(this.records.get(id)); }
	async save(record) { this.records.set(record.checkpoint.context.id, structuredClone(record)); }
}

const scope = {owner:"replan:campaign",campaign:"campaign",worldline:"main",loop:0,audience:"keeper"};
const initialReadSet = [{kind:"world",resource:"campaign",revision:"world-r1"}];
const rawInput = "I search the desk, take the lead, and go to the newspaper office.";
const rawRef = {version:1,scope,resource:"turn:1:player",revision:"input-r1",sourceType:"turn",selector:{kind:"utf16",start:0,end:rawInput.length}};
const plan = (revision=0, capabilities=["apply"]) => ({
	goal:"Search the desk and follow the discovered lead.",
	subgoals:["Settle only the still-unsettled part of this same action."],
	constraints:revision ? [`Replan attempt ${revision} uses the new actual owner outcome.`] : ["Use the initial actual owner outcome."],
	evidenceRequired:["The current canonical options and actual receipts."],
	completion:["Every selected effect settles once."], capabilities,
	replanWhen:["A classified non-settled outcome can be corrected without new player intent."], returnWhen:[],
});
const profileOptions = () => ({version:1,
	profiles:[{alias:"profile:0",actor:"Alice",skill:"Spot Hidden",availability:"bound",value:55}],
	decisions:[{name:"core-check:ordinary-check",family:"core-check",description:"One ordinary check.",capability:"check"}],
	revision:"profiles-r1",world_revision:"world-r1",
	context:{scene:"Office",pending_choice:null,session:null,conditions:[],current_receipts:[],declared_action:rawInput}});
const clue = {alias:"effect:0",effect:{kind:"clue",clue:"research-lead"},description:{kind:"clue",name:"Research lead"}};
const move = {alias:"effect:1",effect:{kind:"move",to:"newspaper-office"},description:{kind:"move",display_name:"Newspaper office"}};
const applyOptions = (candidates=[clue,move]) => ({version:1,candidates,revision:"apply-r1",world_revision:"world-r1",
	context:{scene:"Office",pending_choice:null,session:null,present:[],current_receipts:[],coverage:{effect_families:["clue","move"],other_families:"incumbent"}}});
const packet = (proposal,status,result,receipts=[],diagnostics) => ({operationId:proposal.id,status,result,refs:[],receipts,
	readSet:proposal.readSet,coverage:{used:[],omitted:[],unknown:[]},...(diagnostics?{diagnostics}:{})});

function choiceResult(batch, select) {
	const raw = Object.fromEntries(batch.questions.map(question => {
		const chosen = select(question,batch);
		if (chosen === undefined) return [question.key,{status:"unknown"}];
		return [question.key,{status:"answered",type:"choice",choice:chosen,
			probabilities:Object.fromEntries(Object.keys(question.criteria).map(key=>[key,key===chosen?1:0]))}];
	}));
	return bindDecisionAnswers(batch,raw,{inputTokens:1,outputTokens:1,costUsd:0});
}

const resolveChoice = question => ({route:"ordinary",consent:"authorized",actor:"actor_0",intent:"investigate",
	difficulty:"regular",bonus:"none",penalty:"none",profile:"profile_0"})[question.key];
function applyChoice(question, scopeChoice="covered") {
	if(question.key==="scope")return scopeChoice;
	if(question.key==="batch")return "supported";
	return [clue.alias,move.alias].includes(question.key)?"include":"exclude";
}

function createRuntime({domain, decide, dispatch, capabilities=["apply"], maxSteps=128}) {
	const store=new Store(), calls=[], batches=[];
	let current=structuredClone(initialReadSet);
	const operations={
		async validate(){return structuredClone(current);},
		async dispatch(proposal,lease,journal){calls.push(structuredClone(proposal));return dispatch(proposal,lease,journal,{get current(){return current;},set current(value){current=value;}});},
	};
	const decision={async decide(batch,lease){batches.push(structuredClone(batch));return decide(batch,lease);}};
	const runtime=new TaskRuntime({store,operations,decision,domains:[domain],maxSteps});
	return {runtime,store,calls,batches,operations,decision,capabilities,async begin(){
		return runtime.begin({domain:domain.id,intent:{id:"intent",rawInput:rawRef,limits:[],scope,turn:1,inputRevision:rawRef.revision},
			lease:{owner:"keeper",goal:plan().goal,scope,capabilities,readSet:initialReadSet,
				budget:{deadlineAt:Date.now()+60_000,remainingInputTokens:1_000_000,remainingOutputTokens:100_000,remainingCostUsd:10,remainingActions:128}}});
	}};
}

async function rejects(code, action) {
	await assert.rejects(action,error=>error instanceof ContractError&&error.code===code);
}

test("a resolved receipt survives an apply-only replan and neither effect executes twice",async()=>{
	let applyAttempt=0;
	const app=createRuntime({
		domain:createTableEvidenceDomain({rawInput:()=>rawInput,capsule:()=>({}),resolveEnabled:true,applyEnabled:true}),
		capabilities:["resolve","apply"],
		decide(batch){
			if(batch.family==="ordinary-resolve")return choiceResult(batch,resolveChoice);
			if(batch.family==="ordinary-apply") {
				const attempt=batch.questions.some(question=>question.key==="scope")?applyAttempt++:Math.max(0,applyAttempt-1);
				return choiceResult(batch,question=>applyChoice(question,attempt===0?"unknown":"covered"));
			}
			throw new Error(`unexpected family ${batch.family}`);
		},
		dispatch(proposal,lease,_journal,state){
			if(proposal.operation==="resolve.options")return packet(proposal,"succeeded",profileOptions());
			if(proposal.operation==="resolve"){
				lease.advance({operationId:proposal.id,receiptId:"receipt:resolve",changes:[{kind:"world",resource:"campaign",from:"world-r1",to:"world-r2"}]});
				state.current=lease.context.readSet;return packet(proposal,"succeeded",{outcome:{kind:"success"}},["receipt:resolve"]);
			}
			if(proposal.operation==="apply.options")return packet(proposal,"succeeded",applyOptions());
			if(proposal.operation==="apply"){
				lease.advance({operationId:proposal.id,receiptId:"receipt:apply",changes:[{kind:"world",resource:"campaign",from:"world-r2",to:"world-r3"}]});
				state.current=lease.context.readSet;return packet(proposal,"succeeded",{receipts:["receipt:apply"]},["receipt:apply"]);
			}
			throw new Error(`unexpected operation ${proposal.operation}`);
		},
	});
	const id=await app.begin(), firstDeadline=app.runtime.lease(id).context.budget.deadlineAt;
	const first=await app.runtime.submit(id,plan(0,["resolve","apply"]));
	assert.equal(first.status,"partial",JSON.stringify(first));
	assert.equal(app.runtime.snapshot(id).phase,"planning");
	assert.equal(app.runtime.snapshot(id).replans,1);
	assert.deepEqual(first.receipts,["receipt:resolve"]);

	const second=await app.runtime.submit(id,plan(1,["resolve","apply"]));
	assert.equal(second.status,"complete",JSON.stringify(second));
	assert.deepEqual(second.receipts,["receipt:resolve","receipt:apply"]);
	assert.equal(app.runtime.lease(id).context.budget.deadlineAt,firstDeadline,"replan keeps the original absolute deadline");
	assert.equal(app.calls.filter(call=>call.operation==="resolve").length,1,"the successful roll is immutable across attempts");
	assert.equal(app.calls.filter(call=>call.operation==="apply").length,1,"only the corrected effect batch settles");
	assert.equal(app.calls.filter(call=>call.operation==="apply.options").length,2,"the new attempt refreshes current options");
	assert.deepEqual(app.runtime.snapshot(id).observations.filter(row=>row.proposal.operation==="apply.options").map(row=>row.key),
		["apply-options","apply-options:attempt:1"]);
	assert.ok(app.runtime.snapshot(id).decisions.some(row=>row.key==="apply-inclusion:attempt:1"));
});

test("a refused invalid_params change_input may replan once, while the refused call has no effect",async()=>{
	let settlements=0, optionReads=0;
	const app=createRuntime({
		domain:createOrdinaryApplyDomain({rawInput:()=>rawInput}),
		decide:batch=>choiceResult(batch,question=>applyChoice(question)),
		dispatch(proposal,lease,_journal,state){
			if(proposal.operation==="apply.options")return packet(proposal,"succeeded",applyOptions(optionReads++===0?[clue]:[move]));
			if(proposal.operation!=="apply")throw new Error(`unexpected ${proposal.operation}`);
			settlements++;
			if(settlements===1)return packet(proposal,"refused",{coc_error:{code:"invalid_params",next:"change_input",details:{reason:"invalid_effect_arguments"}}});
			lease.advance({operationId:proposal.id,receiptId:"receipt:apply",changes:[{kind:"world",resource:"campaign",from:"world-r1",to:"world-r2"}]});
			state.current=lease.context.readSet;return packet(proposal,"succeeded",{receipts:["receipt:apply"]},["receipt:apply"]);
		},
	});
	const id=await app.begin();
	const first=await app.runtime.submit(id,plan(0));
	assert.equal(first.status,"partial");assert.equal(app.runtime.snapshot(id).phase,"planning");
	const second=await app.runtime.submit(id,plan(1));
	assert.equal(second.status,"complete");assert.deepEqual(second.receipts,["receipt:apply"]);
	const applies=app.calls.filter(call=>call.operation==="apply");
	assert.equal(applies.length,2);assert.notEqual(applies[0].id,applies[1].id);
	assert.deepEqual(applies.map(call=>call.args.effects),[[clue.effect],[move.effect]],"the replan must correct the refused arguments, not mint a new id for the same batch");
	assert.deepEqual(app.runtime.snapshot(id).observations.filter(row=>row.proposal.operation==="apply").map(row=>row.packet.status),["refused","succeeded"]);
});

test("a revised same-goal plan may read actual evidence before retrying only the unsettled mutator",async()=>{
	let tableRounds=0;
	const domain=createTableEvidenceDomain({rawInput:()=>rawInput,capsule:()=>({}),applyEnabled:true});
	const app=createRuntime({domain,capabilities:["lookup.module","apply"],
		decide(batch){
			if(batch.family==="ordinary-apply") {
				const revised=batch.state.plan.constraints.some(value=>String(value).includes("Replan attempt 1"));
				return choiceResult(batch,question=>applyChoice(question,revised?"covered":"unknown"));
			}
			if(batch.family==="table-evidence") {
				tableRounds++;
				const read=Array.isArray(batch.state.observations)&&batch.state.observations.some(row=>row.result?.marker==="actual-module-evidence");
				return choiceResult(batch,question=>question.key==="next"?(read?"complete":"candidate_0"):(read?"sufficient":"needs_more"));
			}
			throw new Error(`unexpected ${batch.family}`);
		},
		dispatch(proposal,lease,_journal,state){
			if(proposal.operation==="apply.options")return packet(proposal,"succeeded",applyOptions([clue]));
			if(proposal.operation==="lookup")return packet(proposal,"succeeded",{marker:"actual-module-evidence",entities:[{name:"Research lead"}]});
			if(proposal.operation==="apply"){
				lease.advance({operationId:proposal.id,receiptId:"receipt:clue",changes:[{kind:"world",resource:"campaign",from:"world-r1",to:"world-r2"}]});
				state.current=lease.context.readSet;return packet(proposal,"succeeded",{receipts:["receipt:clue"]},["receipt:clue"]);
			}
			throw new Error(`unexpected ${proposal.operation}`);
		}});
	const id=await app.begin();
	assert.equal((await app.runtime.submit(id,plan(0,["apply"]))).status,"partial");
	const result=await app.runtime.submit(id,plan(1,["lookup.module","apply"]));
	assert.equal(result.status,"complete",JSON.stringify(result));assert.deepEqual(result.receipts,["receipt:clue"]);
	assert.equal(tableRounds,2,"one decision selects the read and a dependent decision verifies its evidence");
	assert.deepEqual(app.calls.map(call=>call.operation),["apply.options","lookup","apply.options","apply"]);
	assert.deepEqual(app.calls.filter(call=>call.operation==="apply").map(call=>call.args.effects),[[clue.effect]]);
});

test("player-choice and unknown-settlement outcomes never become a fresh mutation attempt",async t=>{
	await t.test("action_not_authorized remains a player boundary",async()=>{
		const app=createRuntime({domain:createOrdinaryApplyDomain({rawInput:()=>rawInput}),decide:batch=>choiceResult(batch,question=>applyChoice(question)),
			dispatch(proposal){
				if(proposal.operation==="apply.options")return packet(proposal,"succeeded",applyOptions());
				return packet(proposal,"refused",{coc_error:{code:"needs",next:"change_input",details:{reason:"action_not_authorized"}}});
			}});
		const id=await app.begin(), result=await app.runtime.submit(id,plan(0));
		assert.equal(result.status,"needs_player",JSON.stringify(result));assert.equal(app.runtime.snapshot(id).replans,0);
		await rejects("task_not_planning",()=>app.runtime.submit(id,plan(1)));
		assert.equal(app.calls.filter(call=>call.operation==="apply").length,1);
	});
	await t.test("settlement_unknown stays pending under its original identity",async()=>{
		const app=createRuntime({domain:createOrdinaryApplyDomain({rawInput:()=>rawInput}),decide:batch=>choiceResult(batch,question=>applyChoice(question)),
			dispatch(proposal){
				if(proposal.operation==="apply.options")return packet(proposal,"succeeded",applyOptions());
				return packet(proposal,"pending",{},[],[{code:"settlement_unknown"}]);
			}});
		const id=await app.begin(), result=await app.runtime.submit(id,plan(0));
		assert.equal(result.status,"pending");assert.equal(app.runtime.snapshot(id).phase,"waiting");assert.equal(app.runtime.snapshot(id).replans,0);
		await rejects("task_not_planning",()=>app.runtime.submit(id,plan(1)));
		assert.equal(app.calls.filter(call=>call.operation==="apply").length,1);
	});
});

test("two no-progress replans are the hard ceiling and never dispatch an effect",async()=>{
	const app=createRuntime({domain:createOrdinaryApplyDomain({rawInput:()=>rawInput}),
		decide:batch=>choiceResult(batch,question=>applyChoice(question,"unknown")),
		dispatch(proposal){
			if(proposal.operation!=="apply.options")throw new Error(`unexpected ${proposal.operation}`);
			return packet(proposal,"succeeded",applyOptions());
		}});
	const id=await app.begin(), root=app.runtime.lease(id).context.rootId, deadline=app.runtime.lease(id).context.budget.deadlineAt;
	assert.equal((await app.runtime.submit(id,plan(0))).status,"partial");
	assert.equal((await app.runtime.submit(id,plan(1))).status,"partial");
	const final=await app.runtime.submit(id,plan(2));
	assert.equal(final.status,"unresolved",JSON.stringify(final));
	assert.equal(app.runtime.snapshot(id).replans,2);assert.equal(app.runtime.snapshot(id).phase,"composing");
	assert.equal(app.calls.filter(call=>call.operation==="apply").length,0);
	assert.deepEqual(app.calls.filter(call=>call.operation==="apply.options").map((_call,index)=>index),[0,1,2]);
	assert.equal(app.runtime.lease(id).context.rootId,root);assert.equal(app.runtime.lease(id).context.budget.deadlineAt,deadline);
	await rejects("task_not_planning",()=>app.runtime.submit(id,plan(3)));
});
