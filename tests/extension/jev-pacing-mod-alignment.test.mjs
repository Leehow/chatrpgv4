/** #99 D1-D7 package alignment. Assembly proves wiring; real pacing quality still needs paired play. */
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import test from "node:test";
import {build} from "esbuild";

const ROOT=resolve(import.meta.dirname,"../..");
const PACKAGES={
	"keeper-pacing":{version:"1.3.0",state_version:1,requires:["context.pacing.v1","mods.package-files.v1"],settings:{stall_turns:2},
		settings_schema:{stall_turns:{minimum:1,maximum:6}}},
	"narration-craft":{version:"2.0.3",state_version:2,requires:["mods.package-files.v1","context.style.v1","npc.voice.generation.v2","npc.voice.consolidation.v1","graph.vocabulary.v1","graph.vocabulary.table.v1","context.npc.v1"],settings:{density_guide:"off",coarse_language:true},
		settings_schema:{coarse_language:{title:{["zh-Hans"]:"允许粗话",en:"Coarse language"}},density_guide:{enum:["off","on"]}}},
};

async function kernel(t){
	const temporary=await mkdtemp(join(tmpdir(),"jev-pacing-mod-alignment-"));
	await symlink(join(ROOT,"node_modules"),join(temporary,"node_modules"),"dir");
	await build({stdin:{contents:"export * from './kernel-ts/testing/api.ts';",resolveDir:ROOT,sourcefile:"pacing-alignment-test.ts"},
		outfile:join(temporary,"api.mjs"),bundle:true,packages:"external",format:"esm",platform:"node",target:"node22",logLevel:"silent"});
	const api=await import(pathToFileURL(join(temporary,"api.mjs")).href),home=await mkdtemp(join(temporary,"home-"));
	const context=await api.createKernelContext({workspace:home,content:join(ROOT,"content"),seed:"pacing-alignment",
		locks:api.createAdvisoryLocks(async()=>{}),env:{...process.env,GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_NOSYSTEM:"1"}});
	const runtime=api.createKernelRuntime(context);t.after(async()=>{await runtime.close();await rm(temporary,{recursive:true,force:true});});
	return{call:(method,params={})=>runtime.handlers[method](params)};
}

const byId=capsule=>new Map(capsule.mods.instructions.map(row=>[row.mod,row]));
const utf8=value=>Buffer.byteLength(value,"utf8");
function aligned(id,text){
	if(id==="narration-craft"){
		// docs/specs/prose-mod.md §6: the prose package states the same boundary in a writer's words.
		assert.match(text,/carry the (?:chosen )?action/i,`${id} carries the chosen action`);
		assert.match(text,/(?:stop at|to its) (?:the )?first outcome, obstacle, (?:gated )?risk or (?:real )?fork|stop at a completed goal/i,`${id} stops at the first real fork`);
		assert.match(text,/enough (?:on the page|seen) to judge/i,`${id} supplies a judgment basis`);
	}else{
		assert.match(text,/still-valid selected goal/i,`${id} keeps the selected-goal boundary`);
		assert.match(text,/goal (?:is )?complete|goal completion|Return at completion/i,`${id} permits return at completion`);
		assert.match(text,/unselected consequential|consequential .*unselected|consequential choice the player has not made|next consequential .* has not been selected/i,`${id} stops before a new choice`);
		assert.match(text,/public (?:evidence|basis)|public, perceived and earned information/i,`${id} supplies a judgment basis`);
	}
	assert.doesNotMatch(text,/more than one real thing to do|One word in, a full turn out|do not leave the scene standing still/i,`${id} retires the old quantity and forced-event floor`);
}

test("changed packages bump versions without changing state, settings, requirements, or contribution shapes",async()=>{
	for(const[id,expected]of Object.entries(PACKAGES)){
		const manifest=JSON.parse(await readFile(join(ROOT,"mods",id,"mod.json"),"utf8"));
		assert.equal(manifest.version,expected.version);assert.equal(manifest.state_version,expected.state_version);
		assert.deepEqual(manifest.requires,expected.requires);assert.deepEqual(manifest.settings,expected.settings);assert.deepEqual(manifest.settings_schema,expected.settings_schema);
		if(id==="narration-craft")assert.deepEqual(manifest.contributes.vocabulary.actor_profile_keys.map(row=>row.key),["voice_mask","exchanges"]);
		assert.deepEqual(Object.keys(manifest.contributes).sort(),id==="narration-craft"?["brief","instructions","style","vocabulary","voice_lane"]:["brief","instructions"]);
		assert.equal(manifest.contributes.instructions,"agent.md");assert.equal(manifest.contributes.brief,"brief.md");
		assert.deepEqual(manifest.package_files,id==="narration-craft"?["agent.md","brief.md","style.json","voice-lane.md"]:["agent.md","brief.md"]);assert.deepEqual(manifest.dependencies,{});assert.deepEqual(manifest.conflicts,id==="narration-craft"?["npc-voice"]:[]);
	}
	const npc=JSON.parse(await readFile(join(ROOT,"mods/npc-voice/mod.json"),"utf8"));
	const voice=await readFile(join(ROOT,"mods/npc-voice/agent.md"),"utf8");
	assert.equal(npc.version,"1.3.0");
	assert.equal(npc.default_enabled,false);
	assert.match(voice,/A direct answer may close a subject/);assert.match(voice,/without demanding\s+that every line ends in a question/);
});

test("the actual kernel assembles aligned full instructions, then exact briefs within the shared ceiling",async t=>{
	const game=await kernel(t),call=(method,params={})=>game.call(method,{campaign:"aligned",...params});
	await call("campaign.create",{id:"aligned",module:"the-haunting",pregen:"thomas-hayes",play_language:"en"});
	await call("table.open");
	const first=await call("table.player_input",{text:"I take the keys and stay with this conversation."}),full=byId(first.capsule);
	for(const[id,expected]of Object.entries(PACKAGES)){
		const row=full.get(id),source=await readFile(join(ROOT,"mods",id,"agent.md"),"utf8");
		assert.ok(row,`${id} is active by default`);assert.equal(row.version,expected.version);assert.equal(row.form,"full");assert.equal(row.instruction,source);
		aligned(id,row.instruction);
	}
	assert.match(full.get("keeper-pacing").instruction,/advisory possibilities, not a required ladder or a debt/i);
	assert.match(full.get("narration-craft").instruction,/add no event to justify it/i);

	await call("table.narrate",{call_id:"t1-c1",text:"The conversation reaches a quiet resting point."});
	const next=await call("table.player_input",{text:"I stay with the conversation."}),brief=byId(next.capsule);
	for(const[id,expected]of Object.entries(PACKAGES)){
		const row=brief.get(id),source=await readFile(join(ROOT,"mods",id,"brief.md"),"utf8");
		assert.ok(row);assert.equal(row.version,expected.version);assert.equal(row.form,"brief");assert.equal(row.instruction,source);aligned(id,row.instruction);
	}
	assert.match(brief.get("keeper-pacing").instruction,/signals prompt inspection only/i);
	assert.match(brief.get("narration-craft").instruction,/no menu or reflexive question/i);
	const allBriefs=next.capsule.mods.instructions.filter(row=>row.form==="brief");
	const combined=allBriefs.reduce((sum,row)=>sum+utf8(row.instruction),0);
	assert.ok(combined<=5000,`active brief bytes ${combined} exceed the 5000-byte shared ceiling`);
	assert.equal(combined,allBriefs.map(row=>utf8(row.instruction)).reduce((a,b)=>a+b,0),"measure the exact assembled UTF-8 bytes");
});

test("disabling the two packages removes their full and brief instructions from actual assembly",async t=>{
	const game=await kernel(t),call=(method,params={})=>game.call(method,{campaign:"disabled",...params});
	await call("campaign.create",{id:"disabled",module:"the-haunting",pregen:"thomas-hayes",play_language:"en"});
	for(const id of Object.keys(PACKAGES))await call("mods.configure",{id,enabled:false});
	await call("table.open");
	const first=await call("table.player_input",{text:"I remain here."});
	assert.equal(byId(first.capsule).has("keeper-pacing"),false);assert.equal(byId(first.capsule).has("narration-craft"),false);
	assert.ok(first.capsule.mods.instructions.length>0,"other active package instructions remain assembled");
	await call("table.narrate",{call_id:"t1-c1",text:"The table continues without the pacing packages."});
	const next=await call("table.player_input",{text:"I continue."});
	assert.equal(byId(next.capsule).has("keeper-pacing"),false);assert.equal(byId(next.capsule).has("narration-craft"),false);
});
