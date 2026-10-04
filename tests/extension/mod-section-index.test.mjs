/** Contract §183: package instructions whole within a budget, an index beyond it. The kernel's declaration checks, form
 *  and gates; the selection rule; and the Keeper's actual provider requests with the budget forced low. */
import assert from "node:assert/strict";
import {test} from "node:test";
import {cp,mkdtemp,readFile,rm,symlink,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {spawnSync} from "node:child_process";
import {build} from "esbuild";
import {fauxAssistantMessage,fauxToolCall} from "@earendil-works/pi-ai";
import {openTable} from "./harness.mjs";

const ROOT=resolve(import.meta.dirname,"../..");
const SECTIONED=["narration-craft","natural-npc","enhanced-items","keeper-pacing","story-thread","historical-reference","hostile-creatures"];
const temporary=await mkdtemp(join(tmpdir(),"mod-section-index-"));
await symlink(join(ROOT,"node_modules"),join(temporary,"node_modules"),"dir");
await build({stdin:{contents:[
	"export * from './kernel-ts/testing/api.ts';",
	"export {parseSections,kernelGates,cutInstruction,INDEXED_LEAD,KERNEL_GATES,RESOLVE_FAMILIES} from './kernel-ts/read/sections.ts';",
	"export {APPLY_KINDS} from './kernel-ts/apply/kinds.ts';",
	"export {selectSections,resolveFamily,noteCall,emptyCalls,createModSections,MOD_SECTIONS_BYTES} from './extensions/table/mod-sections.ts';",
].join("\n"),resolveDir:ROOT,sourcefile:"mod-section-index-test.ts"},outfile:join(temporary,"api.mjs"),bundle:true,packages:"external",format:"esm",platform:"node",target:"node22",logLevel:"silent"});
const api=await import(pathToFileURL(join(temporary,"api.mjs")).href);
process.on("exit",()=>spawnSync("rm",["-rf",temporary]));

async function kernel(t){
	const home=await mkdtemp(join(temporary,"home-"));
	const context=await api.createKernelContext({workspace:home,content:join(ROOT,"content"),seed:"mod-section-index",
		locks:api.createAdvisoryLocks(async()=>{}),env:{...process.env,GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_NOSYSTEM:"1"}});
	const runtime=api.createKernelRuntime(context);t.after(()=>runtime.close());
	return{home,call:(method,params={})=>runtime.handlers[method](params)};
}
/** COC_INSTRUCTION_BUDGET for the in-process kernel, for the length of one test. */
function budget(t,value){
	const previous=process.env.COC_INSTRUCTION_BUDGET;process.env.COC_INSTRUCTION_BUDGET=String(value);
	t.after(()=>{if(previous===undefined)delete process.env.COC_INSTRUCTION_BUDGET;else process.env.COC_INSTRUCTION_BUDGET=previous;});
}
const byId=capsule=>new Map(capsule.mods.instructions.map(row=>[row.mod,row]));
const shipped=async(id,file)=>readFile(join(ROOT,"mods",id,file),"utf8");

// ---- declaration -------------------------------------------------------------------------------------------------------

/** A copy of keeper-pacing under a new id, its manifest, sections and agent.md changed by `change`. */
async function variant(game,name,change){
	const path=join(game.home,`variant-${name}`);
	await cp(join(ROOT,"mods/keeper-pacing"),path,{recursive:true});
	const manifest=JSON.parse(await readFile(join(path,"mod.json"),"utf8")),sections=JSON.parse(await readFile(join(path,"sections.json"),"utf8"));
	const agent=await readFile(join(path,"agent.md"),"utf8");
	const next=change({manifest:{...manifest,id:`pacing-${name}`},sections,agent});
	await writeFile(join(path,"mod.json"),JSON.stringify(next.manifest??{...manifest,id:`pacing-${name}`}));
	await writeFile(join(path,"sections.json"),JSON.stringify(next.sections??sections));
	await writeFile(join(path,"agent.md"),next.agent??agent);
	return path;
}
const entry=(sections,heading,patch)=>({...sections,sections:sections.sections.map(row=>row.heading===heading?{...patch(row)}:row)});
const REFUSALS={
	"unknown-topic":({sections})=>({sections:entry(sections,"Close calls",row=>({...row,topics:["weather"]}))}),
	"unknown-gate":({sections})=>({sections:entry(sections,"Close calls",row=>({...row,gates:["moonlight"]}))}),
	"unknown-trigger-kind":({sections})=>({sections:entry(sections,"Close calls",row=>({...row,triggers:["host_event:refusal"]}))}),
	"unknown-apply-kind":({sections})=>({sections:entry(sections,"Close calls",row=>({...row,triggers:["before_apply:document"]}))}),
	"unknown-family":({sections})=>({sections:entry(sections,"Close calls",row=>({...row,triggers:["before_resolve:weather"]}))}),
	"heading-not-in-file":({sections})=>({sections:entry(sections,"Close calls",row=>({...row,heading:"Near misses"}))}),
	"heading-without-entry":({sections})=>({sections:{...sections,sections:sections.sections.filter(row=>row.heading!=="Close calls")}}),
	"heading-twice":({sections})=>({sections:{...sections,sections:[...sections.sections,{heading:"Close calls",kind:"resident"}]}}),
	"resident-with-topics":({sections})=>({sections:entry(sections,"No escalation ladder",row=>({...row,topics:["money"]}))}),
	"situational-without-either":({sections})=>({sections:entry(sections,"Close calls",row=>({heading:row.heading,kind:"situational"}))}),
	"gates-without-topics":({sections})=>({sections:entry(sections,"Close calls",row=>({heading:row.heading,kind:"situational",triggers:["state:opening"],gates:["stall"]}))}),
	"threshold-out-of-range":({sections})=>({sections:entry(sections,"Close calls",row=>({...row,topic_threshold:1}))}),
	"star-not-alone":({sections})=>({sections:entry(sections,"Close calls",row=>({...row,topics:["*","money"]}))}),
	"preamble-without-entry":({agent})=>({agent:agent.replace("# Keeper Pacing\n\n","# Keeper Pacing\n\nA line before the first heading.\n\n")}),
	"duplicate-heading-in-file":({agent})=>({agent:agent.replace("## No escalation ladder","## Close calls")}),
	"capability-missing":({manifest})=>({manifest:{...manifest,requires:manifest.requires.filter(cap=>cap!=="instructions.sections.v1")}}),
	"sections-without-instructions":({manifest})=>({manifest:{...manifest,contributes:{sections:"sections.json"},package_files:["sections.json"]}}),
	"not-in-package-files":({manifest})=>({manifest:{...manifest,package_files:["agent.md"]}}),
	"invalid-json":({sections})=>({sections:undefined,raw:true}),
};

test("a sections declaration that does not match its instruction or the product's lists is refused by field (§183.1)",async t=>{
	const game=await kernel(t);
	for(const[name,change]of Object.entries(REFUSALS)){
		const path=await variant(game,name,change);
		if(name==="invalid-json")await writeFile(join(path,"sections.json"),"{not json");
		await assert.rejects(game.call("mods.install",{path}),error=>{
			assert.equal(error.code,"invalid_params",name);
			assert.equal(error.details?.field,"contributes.sections",`${name}: ${error.message}`);
			return true;
		},name);
	}
	// The unchanged copy installs: the refusals above are the changes, not the package.
	assert.equal((await game.call("mods.install",{path:await variant(game,"intact",()=>({}))})).id,"pacing-intact");
	// Requiring the capability without contributing is allowed (a fixture that clones a shipped manifest does it): it goes whole.
	assert.equal((await game.call("mods.install",{path:await variant(game,"required-only",({manifest})=>({manifest:{...manifest,contributes:{instructions:"agent.md"},package_files:["agent.md"]}}))})).id,"pacing-required-only");
	// A frozen version may still declare a brief; it installs and nothing measures it (§183.3).
	const briefed=await variant(game,"briefed",({manifest})=>({manifest:{...manifest,package_files:[...manifest.package_files,"brief.md"],
		contributes:{...manifest.contributes,brief:"brief.md"}}}));
	await writeFile(join(briefed,"brief.md"),"x".repeat(9000));
	assert.equal((await game.call("mods.install",{path:briefed})).id,"pacing-briefed");
});

test("every shipped sectioned package parses against its own agent.md, and the sections cover the text",async()=>{
	for(const id of SECTIONED){
		const manifest=JSON.parse(await shipped(id,"mod.json")),agent=await shipped(id,"agent.md");
		assert.ok(manifest.requires.includes("instructions.sections.v1"),id);
		assert.equal(manifest.contributes.brief,undefined,`${id} retires its brief`);
		const sections=api.parseSections(manifest,JSON.parse(await shipped(id,"sections.json")),agent);
		const{preamble,parts}=api.cutInstruction(agent);
		assert.equal(sections.length,parts.length+(preamble?1:0),id);
		for(const part of parts)assert.ok(sections.some(section=>section.text===`## ${part.heading}\n\n${part.body}`),`${id}: ${part.heading}`);
	}
});

test("the closed trigger lists are the kernel's own: apply kinds and the ruleset's decision families",async()=>{
	const graph=JSON.parse(await readFile(join(ROOT,"content/rulesets/coc7/rule-graph.json"),"utf8"));
	const families=new Set([...JSON.stringify(graph).matchAll(/"decision:coc7:([a-z-]+):/g)].map(match=>match[1]));
	assert.deepEqual([...api.RESOLVE_FAMILIES].filter(name=>name!=="objects").sort(),[...families].sort(),"every ruleset family and nothing else");
	assert.ok(api.APPLY_KINDS.includes("cash")&&api.APPLY_KINDS.includes("handout"));
});

// ---- form and gates ------------------------------------------------------------------------------------------------------

async function played(t,game,id="indexed"){
	const call=(method,params={})=>game.call(method,{campaign:id,...params});
	await call("campaign.create",{id,module:"the-haunting",pregen:"thomas-hayes",play_language:"en"});
	return call;
}

test("within the budget every package is whole; over it, sectioned packages go indexed in the effective order (§183.3)",async t=>{
	const game=await kernel(t),call=await played(t,game);
	await call("table.open");
	const whole=byId((await call("table.player_input",{text:"I ask the clerk where the records are kept."})).capsule);
	assert.ok([...whole.values()].every(row=>row.form==="full"));
	const sizes=new Map([...whole.values()].map(row=>[row.mod,Buffer.byteLength(row.instruction,"utf8")]));
	const order=[...whole.keys()];
	await call("table.narrate",{call_id:"t1-c1",text:"The clerk points down the hall."});

	// A budget that fits the packages before keeper-pacing whole and not keeper-pacing itself.
	const at=order.indexOf("keeper-pacing"),before=order.slice(0,at).reduce((sum,id)=>sum+sizes.get(id),0);
	budget(t,before+sizes.get("keeper-pacing")-1);
	const next=await call("table.player_input",{text:"I ask the clerk again."});
	const rows=byId(next.capsule);
	for(const id of order.slice(0,at))assert.equal(rows.get(id).form,"full",`${id} fits before keeper-pacing`);
	const pacing=rows.get("keeper-pacing");
	assert.equal(pacing.form,"indexed");
	assert.ok(pacing.instruction.startsWith(api.INDEXED_LEAD));
	for(const heading of ["Carrying the selected goal","No escalation ladder"])assert.ok(pacing.instruction.includes(`## ${heading}\n`),heading);
	assert.ok(!pacing.instruction.includes("## Stalled turns"),"a situational section is not in the resident text");
	assert.deepEqual(pacing.sections.map(section=>section.heading),["Close calls","Threat clocks","Stalled turns","A stuck or confused player","Empty and repeated turns"]);
	assert.deepEqual(pacing.sections.map(section=>section.key),[1,2,3,4,5].map(ordinal=>`keeper-pacing@${pacing.version}#${ordinal}`));
	for(const section of pacing.sections)assert.equal(typeof section.gates_open,"boolean",section.heading);
	// Greedy: a later package that still fits goes whole; an unsectioned package is always whole.
	for(const id of order.slice(at+1)){
		const total=order.slice(0,at+1).reduce((sum,other)=>sum+(other==="keeper-pacing"?Buffer.byteLength(pacing.instruction,"utf8"):sizes.get(other)),0);
		const sectioned=SECTIONED.includes(id);
		if(!sectioned)assert.equal(rows.get(id).form,"full",`${id} is unsectioned`);
		else if(total+sizes.get(id)>before+sizes.get("keeper-pacing")-1)assert.equal(rows.get(id).form,"indexed",id);
	}
	const named=new Set([...rows.values()].filter(row=>row.form==="indexed").flatMap(row=>row.sections.flatMap(section=>section.topics)));
	// The definitions of the topics the indexed rows name; "*" names every one.
	const list=JSON.parse(await readFile(join(ROOT,"content/mods/topics.json"),"utf8")).topics.map(topic=>topic.id);
	assert.deepEqual(next.capsule.mods.topics.map(topic=>topic.id),named.has("*")?list:list.filter(id=>named.has(id)));
});

test("an indexed row's gates read the turn's state: the opening, people present, equipment (§183.3)",async t=>{
	const game=await kernel(t),call=await played(t,game,"gates");
	budget(t,1);
	await call("table.open");
	const opening=await call("table.capsule");
	const due=capsule=>byId(capsule).get("narration-craft").sections.find(section=>section.heading==="Opening the table").due;
	assert.equal(opening.turn.number,0);
	assert.equal(due(opening),true,"the opening trigger holds on turn 0");
	const first=(await call("table.player_input",{text:"I look around the office."})).capsule;
	assert.equal(due(first),false,"and not after");
	const rows=byId(first);
	const equipment=rows.get("enhanced-items").sections.find(section=>section.heading==="Registering carried equipment");
	assert.equal(equipment.gates_open,first.mods.unregistered_equipment.length>0);
	const impression=rows.get("natural-npc").sections.find(section=>section.heading==="First impression");
	assert.equal(impression.gates_open,first.present.some(person=>person.history?.last_spoke_turn==null));
	assert.ok(first.mods.topics.length>0&&first.mods.topics.every(topic=>topic.what&&topic.not_for&&topic.examples.length));
});

test("mods.sections returns the text of active sections by key, and refuses an unknown key (§183.4)",async t=>{
	const game=await kernel(t),call=await played(t,game,"read");
	budget(t,1);
	await call("table.open");
	const rows=byId((await call("table.player_input",{text:"I ask about the price of a room."})).capsule);
	const prices=rows.get("historical-reference").sections.find(section=>section.heading==="Prices");
	const read=await call("mods.sections",{keys:[prices.key]});
	const agent=await shipped("historical-reference","agent.md");
	assert.equal(read.sections[0].key,prices.key);
	assert.equal(read.sections[0].text,`## Prices\n\n${agent.split("## Prices\n\n")[1].split("\n\n## ")[0].trim()}`);
	assert.equal(Buffer.byteLength(read.sections[0].text,"utf8"),prices.bytes);
	await assert.rejects(call("mods.sections",{keys:[prices.key,"historical-reference@0.0.1#4"]}),
		error=>error.code==="invalid_params"&&error.details.keys.includes("historical-reference@0.0.1#4"));
	await assert.rejects(call("mods.sections",{keys:[]}),error=>error.code==="invalid_params");
});

// ---- the gates and the selection rule -----------------------------------------------------------------------------------

test("kernel gates: a package's own stall_turns overrides the Director's threshold; recover reads the beat or a repeat",()=>{
	const facts={opening:false,present:[{name:"A",history:{last_spoke_turn:3}}],handed:0,undiscovered:2,stalled_turns:3,stall_threshold:4,beat:"PRESSURE",repeat_input:false,threat_clocks:0};
	assert.equal(api.kernelGates(facts,{},{}).stall,false,"3 stalled turns under the Director's 4");
	assert.equal(api.kernelGates(facts,{},{stall_turns:2}).stall,true,"the package's own setting");
	assert.equal(api.kernelGates(facts,{},{stall_turns:0}).stall,false,"a non-positive setting is not a threshold");
	assert.equal(api.kernelGates(facts,{},{}).present_without_history,false);
	assert.equal(api.kernelGates({...facts,present:[...facts.present,{name:"B",history:null}]},{},{}).present_without_history,true);
	assert.equal(api.kernelGates(facts,{},{}).recover,false);
	assert.equal(api.kernelGates({...facts,repeat_input:true},{},{}).recover,true);
	assert.equal(api.kernelGates({...facts,beat:"RECOVER"},{},{}).recover,true);
	assert.equal(api.kernelGates(facts,{},{}).clue_here,true);
	assert.equal(api.kernelGates(facts,{thread:{reentry:{mode:"clarify_known"}}},{}).reentry,true);
	assert.equal(api.kernelGates(facts,{unregistered_equipment:[{name:"knife"}],objects:{instances:[]}},{}).unregistered_equipment,true);
	assert.deepEqual(Object.keys(api.kernelGates(facts,{},{})).sort(),[...api.KERNEL_GATES].sort());
});

const capsuleOf=sections=>({mods:{instructions:[{mod:"m",version:"1.0.0",form:"indexed",sections:sections.map((section,i)=>({key:`m@1.0.0#${i}`,heading:section.id,topics:[],gates:[],triggers:[],topic_threshold:.5,...section}))}]}});
const SECTIONS=[
	{id:"asker",topics:["asks_question"],gates_open:true},
	{id:"stuck",topics:["*"],gates:["stall","no_topic"],gates_open:true},
	{id:"closed",topics:["money"],gates_open:false},
	{id:"opening",triggers:["state:opening"],due:true},
	{id:"prices",topics:["money"],gates_open:false,triggers:["before_apply:cash"]},
	{id:"register",topics:["carried_item"],topic_threshold:.7,gates_open:true},
	{id:"objects",triggers:["before_resolve:objects"]},
];
const picked=(judgement,calls=api.emptyCalls())=>Object.fromEntries(api.selectSections(capsuleOf(SECTIONS),judgement,calls).map(row=>[row.heading,row.why]));

test("selection: a topic over its bar with its gates, a due state, a call this turn; no_topic only when nothing fired (§183.5)",()=>{
	const scored={status:"scored",scores:{asks_question:.9,carried_item:.6,money:.9}};
	assert.deepEqual(picked(scored),{asker:["topic:asks_question"],opening:["due"]});
	const calls=api.emptyCalls();
	api.noteCall(calls,"apply",{effects:[{kind:"cash"}]});
	api.noteCall(calls,"resolve",{action:{decision:"objects:use"}});
	assert.deepEqual(picked(scored,calls),{asker:["topic:asks_question"],opening:["due"],prices:["call:before_apply:cash"],objects:["call:before_resolve:objects"]});
	assert.deepEqual(picked({status:"scored",scores:{asks_question:.2,carried_item:.75,money:.1}}),{opening:["due"],register:["topic:carried_item"]},
		"a section's own bar; and a fired topic is not no_topic");
	assert.deepEqual(picked({status:"scored",scores:{asks_question:.2,carried_item:.3,money:.1}}),{stuck:["topic:*"],opening:["due"]},"nothing fired: no_topic");
	// Jev unavailable or late: every section with a topic and open kernel gates, host gates aside.
	for(const judgement of [undefined,{status:"unavailable",reason:"timeout"}])
		assert.deepEqual(picked(judgement),{asker:["fallback"],stuck:["fallback"],opening:["due"],register:["fallback"]});
});

test("a resolve's family comes from its settled result, else from the decision it named",()=>{
	assert.equal(api.resolveFamily({action:{decision:"combat:defend"}},{family:"combat"}),"combat");
	assert.equal(api.resolveFamily({action:{}},{decision:"decision:coc7:sanity:roll"}),"sanity");
	assert.equal(api.resolveFamily({action:{decision:"objects:use"}}),"objects");
	assert.equal(api.resolveFamily({action:{}}),undefined);
});

test("the section message keeps to its ceiling and names what it left out (§183.5)",async()=>{
	const rows=[],texts=Object.fromEntries(SECTIONS.map((section,i)=>[`m@1.0.0#${i}`,`## ${section.id}\n\n${"x".repeat(7000)}`]));
	const lane=api.createModSections({read:async(method,params)=>({sections:params.keys.map(key=>({key,text:texts[key]}))}),decision:()=>undefined,record:row=>rows.push(row)});
	const capsule={...capsuleOf(SECTIONS),turn:{number:4,player_text:"Where can I eat?"},mods:{...capsuleOf(SECTIONS).mods,topics:[{id:"asks_question",what:"w",not_for:"n",examples:["e"]}]}};
	const binding={campaign:"c",worldline:"main",loop:0,turn:4};
	lane.observe(capsule,binding,new AbortController().signal);
	assert.deepEqual(rows.shift(),{lane:"mod-sections",event:"fallback",turn:4,reason:"unconfigured"});
	const message=await lane.message(capsule,binding,api.emptyCalls());
	const content=JSON.parse(message.content);
	assert.ok(Buffer.byteLength(message.content,"utf8")<=api.MOD_SECTIONS_BYTES);
	assert.deepEqual(content.sections.map(row=>row.section),["asker","stuck"]);
	assert.deepEqual(content.omitted.map(row=>row.section),["opening","register"]);
	assert.equal(rows.find(row=>row.event==="selected").omitted.length,2);
});

// ---- the Keeper's actual requests --------------------------------------------------------------------------------------

const messageText=message=>typeof message.content==="string"?message.content:(message.content??[]).filter(part=>part.type==="text").map(part=>part.text).join("\n");
const sectionsOf=context=>{
	const index=context.messages.findIndex(message=>messageText(message).includes('"authority":"Sections of active package instructions'));
	return index<0?undefined:{index,last:index===context.messages.length-1,...JSON.parse(messageText(context.messages[index]))};
};
const briefOf=context=>JSON.parse(context.messages.map(messageText).find(text=>text.includes('"kind":"context_brief"')));
/** Jev for the topic batch only: the scores below; every other family is refused, and its lane falls back. */
function fakeJev(t,scores){
	const original=globalThis.fetch,batches=[];
	globalThis.fetch=async(url,options)=>{
		if(!String(url).includes("typesafe"))return original(url,options);
		const body=JSON.parse(options.body),keys=Object.keys(body.questions);
		if(!keys.every(key=>key.startsWith("involves_topic_")))return new Response(JSON.stringify({error:"not this test's family"}),{status:422});
		batches.push(body);
		const cards=new Map(JSON.parse(typeof body.state==="string"?body.state:JSON.stringify(body.state)).cards.map(card=>[card.alias,card.topic]));
		return new Response(JSON.stringify({model:body.model,answers:Object.fromEntries(keys.map(key=>[key,{type:"noul",noul:scores[cards.get(key.slice("involves_".length))]??.05}])),
			usage:{input_tokens:900,output_tokens:0}}),{status:200});
	};
	t.after(()=>{globalThis.fetch=original;});
	return batches;
}
async function forcedTable(t,{env={},responses}){
	const requests=[];
	const table=await openTable({realKernel:true,keeperProviderCallbacks:true,
		env:{COC_INSTRUCTION_BUDGET:"1",PI_COC_LOOP_ENGINE:"legacy",PI_COC_JEV_PRESELECT:"0",EXT_JEV_PRESELECTENABLED:"false",...env},
		prepareWorkspace:async workspace=>{
			const steps=[["table.open",{}],["table.player_input",{text:"Fixture opening."}],["table.narrate",{call_id:"t1-c1",text:"The office is quiet."}]];
			const input=steps.map(([method,params],id)=>JSON.stringify({id:String(id),method,params:{campaign:"test-camp",...params}})).join("\n")+"\n";
			const run=spawnSync(process.execPath,[join(ROOT,"build/kernel/rpc.mjs"),"--workspace",workspace,"--content",join(ROOT,"content")],{cwd:ROOT,env:process.env,encoding:"utf8",input});
			assert.equal(run.status,0,run.stderr);
		},
		responses:responses.map(respond=>context=>{requests.push(context);return respond(context);}),
	});
	t.after(()=>table.dispose());
	return{table,requests};
}

test("over the budget the Keeper's actual requests carry resident text in the brief and the turn's sections at the end (§183.5)",async t=>{
	const batches=fakeJev(t,{asks_question:.92,speaks_to_person:.88});
	const{table,requests}=await forcedTable(t,{env:{EXT_JEV_APIKEY:"fixture-key"},responses:[
		()=>fauxAssistantMessage([fauxToolCall("apply",{effects:[{kind:"cash",mode:"quote",quote:"a room for the night",items:[{name:"room",quantity:1,unit_price:2}],source:"price"}]})],{stopReason:"toolUse"}),
		()=>fauxAssistantMessage([fauxToolCall("narrate",{text:"老板说楼上还有一间。"})],{stopReason:"toolUse"}),
	]});
	await table.session.prompt("我问老板最近有没有陌生人住店。");
	assert.equal(requests.length,2,JSON.stringify(table.extensionErrors));
	assert.equal(batches.length,1,"one topic batch for the input");
	assert.equal(batches[0].questions&&Object.keys(batches[0].questions).length,JSON.parse(typeof batches[0].state==="string"?batches[0].state:JSON.stringify(batches[0].state)).cards.length);

	const first=sectionsOf(requests[0]);
	assert.ok(first,"the first request carries the section message");
	assert.equal(first.last,true,"at the end of the request");
	const named=first.sections.map(row=>`${row.package}: ${row.section}`);
	assert.ok(named.includes("natural-npc: What the asker is after"),named.join(" | "));
	assert.ok(!named.includes("historical-reference: Prices"),"money scored low and no cash call yet");
	const asker=await shipped("natural-npc","agent.md");
	assert.ok(asker.includes(first.sections.find(row=>row.section==="What the asker is after").text.split("\n\n").slice(1).join("\n\n")),"the package's own words");

	const brief=briefOf(requests[0]).instructions,npc=brief.find(row=>row.mod==="natural-npc");
	assert.equal(npc.form,"indexed");
	assert.equal(npc.sections,undefined,"the brief carries text only");
	assert.ok(npc.instruction.includes("## The impression in play")&&!npc.instruction.includes("## What the asker is after"));
	assert.equal(brief.find(row=>row.mod==="zh-optimize").form,"full","an unsectioned package goes whole");

	const second=sectionsOf(requests[1]);
	assert.ok(second.sections.some(row=>row.package==="historical-reference"&&row.section==="Prices"),"the cash call this turn loads the price section for the next request");
	const rows=table.telemetry().filter(row=>row.lane==="mod-sections");
	assert.equal(rows.find(row=>row.event==="topics").scores.asks_question,.92);
	assert.ok(rows.some(row=>row.event==="selected"&&row.keys.some(key=>key.why.includes("call:before_apply:cash"))));
	assert.ok(rows.filter(row=>row.event==="delivered").length>=2&&rows.filter(row=>row.event==="delivered").every(row=>row.delivered===true));
	assert.deepEqual(table.extensionErrors,[]);
});

test("with Jev unavailable every section whose gates hold and that names a topic loads, recorded as fallback (§183.5)",async t=>{
	const{table,requests}=await forcedTable(t,{env:{EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined},responses:[
		()=>fauxAssistantMessage([fauxToolCall("narrate",{text:"办公室里很安静。"})],{stopReason:"toolUse"}),
	]});
	await table.session.prompt("我环顾四周。");
	const sent=sectionsOf(requests[0]);
	assert.ok(sent);
	const named=sent.sections.map(row=>`${row.package}: ${row.section}`).concat((sent.omitted??[]).map(row=>`${row.package}: ${row.section}`));
	for(const section of ["historical-reference: Prices","natural-npc: What the asker is after","keeper-pacing: Close calls"])
		assert.ok(named.includes(section),`${section} in ${named.join(" | ")}`);
	const rows=table.telemetry().filter(row=>row.lane==="mod-sections");
	assert.ok(rows.some(row=>row.event==="fallback"&&row.reason==="unconfigured"));
	assert.ok(rows.some(row=>row.event==="selected"&&row.keys.every(key=>key.why.every(why=>why==="fallback"||why==="due"||why.startsWith("call:")))));
});
