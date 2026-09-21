import assert from "node:assert/strict";
import { test } from "node:test";
import { bindDecisionAnswers } from "../../runtime/jev/contracts.ts";
import { createOrdinaryApplyDomain } from "../../runtime/jev/ordinary-apply-domain.ts";
import { TaskRuntime } from "../../runtime/jev/task-runtime.ts";

class Store { records = new Map(); async load(id) { return structuredClone(this.records.get(id)); } async save(record) { this.records.set(record.checkpoint.context.id, structuredClone(record)); } }
const scope={owner:"fulfillment-domain",campaign:"campaign",worldline:"main",loop:0,audience:"keeper"};
const readSet=[{kind:"world",resource:"campaign",revision:"world-r1"}];
const rawRef={version:1,scope,resource:"turn:2:player",revision:"input-r1",sourceType:"turn",selector:{kind:"utf16",start:0,end:20}};
const plan={goal:"Receive the exact reward now.",subgoals:[],constraints:[],evidenceRequired:["The due reward terms and current allocation."],completion:["Canonical apply settles the selected reward."],capabilities:["apply"],replanWhen:[],returnWhen:[]};
const applyOptions={version:1,candidates:[],promises:[{alias:"promise:0",statement:"I will pay 30 USD and give you the case when the work is complete."}],private_promises:{"promise:0":"private-promise-id"},revision:"apply-r1",world_revision:"world-r1",context:{scene:"office",pending_choice:null,session:null,present:["Steven Knott"],current_receipts:[]}};
function catalog(overrides={}) {return {version:1,snapshot:"private-snapshot",revision:"catalog-r1",world_revision:"world-r1",catalog:{
	promises:[{alias:"promise:0",statement:"I will pay 30 USD and give you the case when the work is complete.",subject:"Steven Knott",scalars:[{alias:"total:0",text:"30",value:"30",kind:"token"},{alias:"total:1",text:"one accepted case",value:"1",kind:"object",object:"object:0"}],original_context:[{role:"keeper",text:"I will pay 30 USD and give you the accepted case when the work is completed.",omitted:false}],fulfillment:{status:"open",terms:[]},...(overrides.promise??{})}],
	beneficiaries:[{alias:"beneficiary:0",name:"Thomas Hayes",currencies:[{alias:"currency:0",name:"USD"}]}],payers:[{alias:"payer:0",name:"Steven Knott"}],objects:[{alias:"object:0",name:"Knott travel case",definition_name:"Accepted travel case",payer:"payer:0"}],conditions:[{alias:"condition:0",description:{kind:"time",minutes:1,why:"work completed"}}],allocations:[{alias:"allocation:0",text:"10",value:"10"}],unavailable:[],...(overrides.catalog??{})}};}
const packet=(proposal,result,receipts=[])=>({operationId:proposal.id,status:"succeeded",result,refs:[],receipts,readSet:proposal.readSet,coverage:{used:[],omitted:[],unknown:[]}});
function bind(batch,choose){const raw=Object.fromEntries(batch.questions.map(question=>{const choice=choose(question,batch);return[question.key,{status:"answered",type:"choice",choice,probabilities:Object.fromEntries(Object.keys(question.criteria).map(key=>[key,key===choice?1:0]))}];}));return bindDecisionAnswers(batch,raw,{inputTokens:1,outputTokens:1,costUsd:0});}
function chooser(config={}) {return(question,batch)=>{
	if(question.key==="promise:0")return config.request??"inspect";
	if(question.key==="due")return config.due??"due";
	if(question.key==="terms")return config.terms??"finite";
	if(question.key==="amount_shape")return config.amountShape??"fixed";
	if(question.key==="condition:0")return config.condition??"supports";
	if(question.key==="kind")return (config.kinds??["cash","done"])[batch.state.selected_terms.length]??"done";
	if(question.key==="beneficiary")return"beneficiary:0";if(question.key==="payer")return"payer:0";if(question.key==="object")return"object:0";
	if(question.key==="total")return batch.state.kind==="object"?"total:1":"total:0";if(question.key==="currency")return"currency:0";
	if(question.key==="allocation")return config.allocations?.[batch.state.selected_terms?.length??0]??config.allocation??"remaining";
	if(question.key==="handover")return config.handover??"given";
	if(question.key==="complete")return config.complete??"supported";
	return Object.keys(question.criteria)[0];};}
async function fixture({choose=chooser(),catalogValue=catalog(),prepared,options=applyOptions}={}) {
	const calls=[],batches=[],store=new Store();
	const operations={async validate(){return readSet;},async dispatch(proposal){calls.push(structuredClone(proposal));
		if(proposal.operation==="apply.options")return packet(proposal,structuredClone(options));
		if(proposal.operation==="apply.fulfillment.options")return packet(proposal,structuredClone(catalogValue));
		if(proposal.operation==="apply.fulfillment.prepare")return packet(proposal,structuredClone(prepared??{effects:[{kind:"cash",subject:"Thomas Hayes",with:"Steven Knott",source:"quote",currency:"USD",delta:30}],bindings:{fulfillments:[{binding:{private:"binding",source_ref:"private-ref"},effects:[{effect:0,term:0}]}]}}));
		if(proposal.operation==="apply")return packet(proposal,{receipts:["cash:t2-c1"]},["cash:t2-c1"]);throw new Error(`unexpected ${proposal.operation}`);}};
	const runtime=new TaskRuntime({store,operations,domains:[createOrdinaryApplyDomain({rawInput:()=>"Please fulfill the promised reward now."})],decision:{async decide(batch){batches.push(structuredClone(batch));return bind(batch,choose);}}});
	const id=await runtime.begin({domain:"ordinary-apply",intent:{id:"intent",rawInput:rawRef,limits:[],scope,turn:2,inputRevision:rawRef.revision},lease:{owner:"keeper",goal:plan.goal,scope,capabilities:["apply"],readSet,budget:{deadlineAt:Date.now()+30000,remainingInputTokens:200000,remainingOutputTokens:200000,remainingCostUsd:10,remainingActions:100}}});
	const outcome=await runtime.submit(id,plan);return{runtime,id,outcome,calls,batches,record:runtime.snapshot(id)};
}

test("binds finite cash from issued aliases and sends only canonical prepared effects and private metadata to apply",async()=>{
	const app=await fixture();assert.equal(app.outcome.status,"complete");
	assert.deepEqual(app.calls.map(call=>call.operation),["apply.options","apply.fulfillment.options","apply.fulfillment.prepare","apply"]);
	assert.deepEqual(app.calls[1].args,{promises:["private-promise-id"]});
	assert.deepEqual(app.calls[2].args.selections,[{promise:"promise:0",conditions:["condition:0"],coverage:"complete",terms:[{kind:"cash",total:"total:0",beneficiary:"beneficiary:0",payer:"payer:0",currency:"currency:0",allocation:"remaining"}]}]);
	assert.equal("handover" in app.calls[2].args.selections[0].terms[0],false);
	assert.deepEqual(app.calls[3].args,{effects:[{kind:"cash",subject:"Thomas Hayes",with:"Steven Knott",source:"quote",currency:"USD",delta:30}]});
	assert.deepEqual(app.calls[3].bindings.fulfillments[0].effects,[{effect:0,term:0}]);
	const model=JSON.stringify(app.batches);for(const hidden of ["private-promise-id","private-snapshot","private-ref",'"delta":30'])assert.equal(model.includes(hidden),false,hidden);
});

test("catalog capability limits do not block an unrelated exact finite cash promise",async()=>{
	const value=catalog({catalog:{unavailable:["Rates or formulas","Word-only amounts without typed scalar evidence","Ambiguous units or incomplete term coverage","New definitions or new physical instances"]}});
	const app=await fixture({catalogValue:value});
	assert.equal(app.outcome.status,"complete");
	assert.equal(app.calls.some(call=>call.operation==="apply"),true);
});

test("binds an existing physical gift without letting the model generate identity or quantity",async()=>{
	const prepared={effects:[{kind:"object",name:"Knott travel case",from:"Steven Knott",to:"Thomas Hayes",quantity:1}],bindings:{fulfillments:[{binding:{private:"object-binding"},effects:[{effect:0,term:0}]}]}};
	const app=await fixture({choose:chooser({kinds:["object","done"]}),prepared});assert.equal(app.outcome.status,"complete");
	assert.deepEqual(app.calls.at(-1).args.effects,prepared.effects);assert.equal(JSON.stringify(app.batches).includes("object-binding"),false);
	assert.ok(app.batches.some(batch=>batch.questions.some(question=>question.key==="object")));
	assert.equal(app.calls.find(call=>call.operation==="apply.fulfillment.prepare").args.selections[0].terms[0].handover,"given");
});

for(const handover of ["not_given","unknown"])test(`physical gift handover ${handover} produces zero effect`,async()=>{
	const app=await fixture({choose:chooser({kinds:["object","done"],handover})});
	assert.equal(app.outcome.status,"partial");
	assert.equal(app.calls.some(call=>["apply.fulfillment.prepare","apply"].includes(call.operation)),false);
});

test("multi-term and partial allocations use issued aliases while a known term may be deferred",async()=>{
	const prepared={effects:[{kind:"cash",subject:"Thomas Hayes",with:"Steven Knott",source:"quote",currency:"USD",delta:10},{kind:"object",name:"Knott travel case",from:"Steven Knott",to:"Thomas Hayes",quantity:1}],bindings:{fulfillments:[{binding:{private:"multi"},effects:[{effect:0,term:0,amountSource:{private:"coordinate"}},{effect:1,term:1}]}]}};
	const app=await fixture({choose:chooser({kinds:["cash","object","done"],allocations:["allocation:0","remaining"]}),prepared});
	assert.equal(app.outcome.status,"complete");const selection=app.calls.find(call=>call.operation==="apply.fulfillment.prepare").args.selections[0];
	assert.deepEqual(selection.terms.map(term=>[term.kind,term.allocation,term.handover??null]),[["cash","allocation:0",null],["object","remaining","given"]]);
	assert.deepEqual(app.calls.at(-1).args.effects,prepared.effects);assert.equal(JSON.stringify(app.batches).includes("coordinate"),false);
});

test("prior immutable terms select remaining or defer without redefining their identities",async()=>{
	const prior=catalog({promise:{prior_terms:[{alias:"term:0",kind:"cash",total:"30",fulfilled:"10",remaining:"20",beneficiary:"beneficiary:0",payer:"payer:0",currency:"currency:0"},{alias:"term:1",kind:"object",total:"1",fulfilled:"0",remaining:"1",beneficiary:"beneficiary:0",payer:"payer:0",object:"object:0"}]}});
	const app=await fixture({catalogValue:prior,choose(question){if(question.key==="promise:0")return"inspect";if(question.key==="due")return"due";if(question.key==="terms")return"finite";if(question.key==="amount_shape")return"fixed";if(question.key==="condition:0")return"supports";if(question.key==="allocation")return"remaining";if(question.key==="handover")return"given";if(question.key==="complete")return"supported";return Object.keys(question.criteria)[0];}});
	const selections=app.calls.find(call=>call.operation==="apply.fulfillment.prepare").args.selections[0];
	assert.deepEqual(selections.terms,[{prior:"term:0",allocation:"remaining"},{prior:"term:1",allocation:"remaining",handover:"given"}]);
	assert.equal(selections.terms.some(term=>"kind"in term||"total"in term||"beneficiary"in term),false);
});

test("all known terms deferred completes with no prepare or apply",async()=>{
	const prior=catalog({promise:{prior_terms:[{alias:"term:0",kind:"cash",total:"30",fulfilled:"10",remaining:"20"}]}});
	const app=await fixture({catalogValue:prior,choose(question){if(question.key==="promise:0")return"inspect";if(question.key==="due")return"due";if(question.key==="terms")return"finite";if(question.key==="amount_shape")return"fixed";if(question.key==="condition:0")return"supports";if(question.key==="allocation")return"defer";return Object.keys(question.criteria)[0];}});
	assert.equal(app.outcome.status,"complete");assert.deepEqual(app.calls.map(call=>call.operation),["apply.options","apply.fulfillment.options"]);
});

for(const [name,modify,choose]of[
	["omitted original context",value=>{value.catalog.promises[0].original_context[0].omitted=true;},chooser()],
	["omitted original speech spans",value=>{value.catalog.promises[0].original_context[0].speech_omitted=true;},chooser()],
	["unknown due",value=>value,chooser({due:"unknown"})],
	["not due",value=>value,chooser({due:"not_due"})],
	["unsupported terms",value=>value,chooser({terms:"unsupported"})],
	["unsupported rate catalog",value=>{value.catalog.promises[0].statement="I will pay 20 USD per day.";value.catalog.promises[0].scalars=[];value.catalog.unavailable=["Rates or formulas"];},chooser({terms:"finite",amountShape:"rate_or_formula"})],
])test(`${name} never prepares or applies a reward`,async()=>{const value=catalog();modify(value);const app=await fixture({catalogValue:value,choose});assert.equal(app.calls.some(call=>["apply.fulfillment.prepare","apply"].includes(call.operation)),false);assert.ok(["complete","partial"].includes(app.outcome.status));});
