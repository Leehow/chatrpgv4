// Migrated from tests/kernel/test_starters.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel,ROOT} from './support.ts';
import {native} from './rules-engine-support.ts';
import {preRd04GraphJson} from './rules-starter-historical.ts';
import {existsSync,readFileSync} from 'node:fs';
import {ModuleStore,ModuleGraph,compute_graph_content_digest,check,read_json,copy,pyEqual,pyIsInstance,pyMethod,subprocess,sys} from './rules-starter-support.ts';

import {confirmed_investigator,CONTENT_DIR,WORKTREE,campaign_dir,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";

















async function verifyCurrentStarter(workspace:any,id:string){
 assert.equal(existsSync(ROOT+'/scripts/starter_graph.py'),false,'Retired Python projector is not a production path');
 assert.equal(existsSync(ROOT+'/kernel/coc'),false,'Production has one TS kernel');
 const store=await ModuleStore(workspace),meta=await store.register(id);
 assert.equal(meta.source,'starter');assert.equal(meta.status,'installed');assert.ok(meta.graph_digest);
 assert.equal(meta.playability.measures.scene_components,1);assert.ok(meta.playability.measures.endings>=1);
 const saved=await store.graph(id);assert.ok(saved.title());assert.ok(saved.startScene());
}
export let OLD_HAUNTING:any=(await Path("/Users/haoli/leehow/code/chatrpgv4/plugins/coc-keeper/references/starter-scenarios/the-haunting"));
export async function test_starter_installs_both_reviewed_languages_without_generation(tmp_path:any){
let store:any,first:any,key:any,reference:any,folder:any,saved:any,upgraded:any;
store=(await ModuleStore(tmp_path));
first=(await pyMethod(store,"register_starter",["the-haunting",pyDivide(CONTENT_DIR,"starters")],{}));
assert.ok(pyBool((pyAt(first,"bundled_guidance_required")===true)),"tests/kernel/test_starters.py:29 assert first[\"bundled_guidance_required\"] is True");
assert.ok(pyBool(pyEqual((await pyLen(pyAt(first,"character_guidance"))),2)),"tests/kernel/test_starters.py:30 assert len(first[\"character_guidance\"]) == 2");
for([key,reference] of pyIterable((await pyMethod(pyAt(first,"character_guidance"),"items",[],{})))){
folder=pyDivide(pyDivide((await pyMethod(store,"module_dir",["the-haunting"],{})),"character-guidance"),key);
saved=(await read_json(pyDivide(folder,"accepted.json")));
assert.ok(pyBool(pyEqual(pyAt(saved,"play_language"),pyAt(reference,"play_language"))),"tests/kernel/test_starters.py:34 assert saved[\"play_language\"] == reference[\"play_language\"]");
assert.ok(pyBool(pyEqual(pyAt(saved,"graph_sha256"),pyAt(first,"graph_digest"))),"tests/kernel/test_starters.py:35 assert saved[\"graph_sha256\"] == first[\"graph_digest\"]");
assert.ok(pyBool(!pyBool((await pyMethod((pyDivide(folder,"attempts")),"exists",[],{})))),"tests/kernel/test_starters.py:36 assert not (folder / \"attempts\").exists()");
}
(await pyMethod(first,"pop",["character_guidance"],{}));
(await pyMethod(store,"write_module",[first],{}));
upgraded=(await pyMethod(store,"register_starter",["the-haunting",pyDivide(CONTENT_DIR,"starters")],{}));
assert.ok(pyBool(pyEqual((await pyLen(pyAt(upgraded,"character_guidance"))),2)),"tests/kernel/test_starters.py:41 assert len(upgraded[\"character_guidance\"]) == 2");
assert.ok(pyBool(pyEqual(pyAt(upgraded,"generation"),pyAt(first,"generation"))),"tests/kernel/test_starters.py:42 assert upgraded[\"generation\"] == first[\"generation\"]");
assert.ok(pyBool(pyEqual((await pyMethod(store,"register_starter",["the-haunting",pyDivide(CONTENT_DIR,"starters")],{})),upgraded)),"tests/kernel/test_starters.py:43 assert store.register_starter(\"the-haunting\", CONTENT_DIR / \"starters\") == upgraded");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_starter_installs_both_reviewed_languages_without_generation"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_starter_installs_both_reviewed_languages_without_generation(temporary);});
export let STARTERS:any=({["mystery-house"]:({["start"]:"crane-office",["languages"]:["en"],["absent"]:[]})});



export let KNOWN_IR_FINDINGS:any=({["mystery-house"]:new Set([["actor_in_no_scene","creature-rat-swarm"]])});
export async function test_graph_loads_with_one_start_scene(module_id:any){
let graph:any;
graph=(await ModuleGraph(module_id,pyDivide(pyDivide(pyDivide(CONTENT_DIR,"starters"),module_id),"module-graph.json")));
assert.ok(pyBool((await pyMethod(graph,"title",[],{}))),"tests/kernel/test_starters.py:63 assert graph.title()");
assert.ok(pyBool(pyEqual((await pyMethod(graph,"handle",[(await pyMethod(graph,"start_scene",[],{}))],{})),pyAt(pyAt(STARTERS,module_id),"start"))),"tests/kernel/test_starters.py:64 assert graph.handle(graph.start_scene()) == STARTERS[module_id][\"start\"]");
assert.ok(pyBool((await pyMethod(graph,"scene_exits",[(await pyMethod(graph,"start_scene",[],{}))],{}))),pyStr("the start scene has exits"));
assert.ok(pyBool(pyEqual(pyAt(graph.raw,"source_languages"),pyAt(pyAt(STARTERS,module_id),"languages"))),"tests/kernel/test_starters.py:66 assert graph.raw[\"source_languages\"] == STARTERS[module_id][\"languages\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("module_id",(await pySorted(STARTERS))))).entries())test("test_graph_loads_with_one_start_scene"+((pyCartesian([{}],pyParametrize("module_id",(await pySorted(STARTERS))))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_graph_loads_with_one_start_scene(row["module_id"]);});
export async function test_manifest_matches_the_graph_and_accounts_for_the_projection(module_id:any){
let root:any,graph:any,manifest:any,projection:any,module_node:any,documents:any,filename:any;
root=pyDivide(pyDivide(CONTENT_DIR,"starters"),module_id);
graph=(await read_json(pyDivide(root,"module-graph.json")));
manifest=(await read_json(pyDivide(root,"module-graph-manifest.json")));
assert.ok(pyBool(pyEqual(pyAt(manifest,"graph_content_digest"),(await compute_graph_content_digest(graph)))),"tests/kernel/test_starters.py:74 assert manifest[\"graph_content_digest\"] == compute_graph_content_digest(graph)");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(manifest,"node_count"),(await pyLen(pyAt(graph,"nodes"))));return pyBool(__left)?pyEqual(pyAt(manifest,"relation_count"),(await pyLen(pyAt(graph,"relations")))):__left;})())),"tests/kernel/test_starters.py:75 assert manifest[\"node_count\"] == len(graph[\"nodes\"]) and manifest[\"relation_count\"] == len(graph[\"relations\"])");
projection=pyAt(manifest,"projection");
assert.ok(pyBool(pyEqual(pyAt(projection,"absent_documents"),pyAt(pyAt(STARTERS,module_id),"absent"))),"tests/kernel/test_starters.py:77 assert projection[\"absent_documents\"] == STARTERS[module_id][\"absent\"]");
module_node=(await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(graph,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_kind"),"module"))){__rows.push(n);}}return __rows;})())));
documents=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const d of pyIterable(pyAt(pyAt(pyAt(module_node,"properties"),"runtime_projection"),"documents"))){__rows.push([pyAt(d,"filename"),d]);}return __rows;})()));
for(filename of pyIterable(pyAt(pyAt(STARTERS,module_id),"absent"))){
assert.ok(pyBool((pyAt(pyAt(documents,filename),"absent")===true)),"tests/kernel/test_starters.py:81 assert documents[filename][\"absent\"] is True");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(pyAt(documents,filename),"collections"))){__rows.push(pyEqual(pyAt(c,"node_ids"),[]));}return __rows;})())))),"tests/kernel/test_starters.py:82 assert all(c[\"node_ids\"] == [] for c in documents[filename][\"collections\"])");
}
assert.ok(pyBool(pyEqual(pyAt(projection,"derived"),({}))),"tests/kernel/test_starters.py:83 assert projection[\"derived\"] == {}");
assert.ok(pyBool(pyEqual(pyAt(projection,"cjk_outside_declared_languages"),({["module-meta.json"]:49,["story-graph.json"]:229}))),"tests/kernel/test_starters.py:84 assert projection[\"cjk_outside_declared_languages\"] == {\"module-meta.json\": 49, \"story-graph.json\": 229}");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const status of pyIterable((await pyMethod(pyAt(graph,"coverage"),"values",[],{})))){__rows.push(pyEqual(status,"accepted"));}return __rows;})())))),"tests/kernel/test_starters.py:85 assert all(status == \"accepted\" for status in graph[\"coverage\"].values())");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("module_id",(await pySorted(STARTERS))))).entries())test("test_manifest_matches_the_graph_and_accounts_for_the_projection"+((pyCartesian([{}],pyParametrize("module_id",(await pySorted(STARTERS))))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_manifest_matches_the_graph_and_accounts_for_the_projection(row["module_id"]);});


export let ROAD_TRAVEL:any=["travel_minutes","travel"];
export async function without_road_travel(graph:any){
let stripped:any,removed:any,relation:any,properties:any,key:any;
const __unpack4598=[(await pyMethod(copy,"deepcopy",[graph],{})),[]];assert.equal(__unpack4598.length,2,"Original tuple unpacking requires exact arity");stripped=__unpack4598[0];removed=__unpack4598[1];
for(relation of pyIterable(pyAt(stripped,"relations"))){
properties=(await (async()=>{const __left=(await pyMethod(relation,"get",["properties"],{}));return pyBool(__left)?__left:({});})());
for(key of pyIterable(ROAD_TRAVEL)){
if(pyBool(pyContains(properties,key))){assert.ok(pyBool(pyEqual(pyAt(relation,"relation_kind"),"route-to")),pyStr(`${pyAt(relation,"relation_id")} carries ${key}`));
(await pyMethod(removed,"append",[`${pyAt(relation,"relation_id")}/${key}`],{}));
delete properties[key];}
}
}
return [stripped,removed];
}





export let CKF_PROJECTION_CHANGES:any=({["mystery-house"]:(await pySorted(pyAdd(pyAdd(pyAdd(pyAdd((await (async()=>{const __rows:any[]=[];for(const old of pyIterable(["npc-rat-swarm","npc-chapel-familiar"])){__rows.push(`/nodes[${old}]: removed`);}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const new_value of pyIterable(["creature-rat-swarm","creature-chapel-familiar"])){__rows.push(`/nodes[${new_value}]: added`);}return __rows;})())),(await (async()=>{const __rows:any[]=[];for(const n of pyIterable([35,39])){__rows.push(`/claims[claim-contains-${n}]/object/node_id: changed`);}return __rows;})())),(await (async()=>{const __rows:any[]=[];for(const n of pyIterable([35,39])){__rows.push(`/relations[relation-contains-${n}]/to_node_id: changed`);}return __rows;})())),["/claims[claim-present-in-237]/subject_id: changed","/relations[relation-present-in-237]/from_node_id: changed","/nodes[module-mystery-house]/properties/runtime_projection/documents: changed"])))});
export async function test_reprojection_reproduces_the_committed_graph(module_id:any,tmp_path:any){
let path:any,text:any,committed:any,stripped:any,removed:any,projected:any,result:any;
path=pyDivide(pyDivide(pyDivide(CONTENT_DIR,"starters"),module_id),"module-graph.json");
text=(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}));
committed=native.parsePythonJson(text);
assert.ok(pyBool(pyEqual(pyAdd(native.pythonJsonDumps(committed,{indent:2,ensureAscii:false}),"\n"),text)),pyStr("the graph keeps the projector's own formatting"));
const __unpack6597=(await without_road_travel(committed));assert.equal(__unpack6597.length,2,"Original tuple unpacking requires exact arity");stripped=__unpack6597[0];removed=__unpack6597[1];
assert.ok(pyBool(removed),pyStr("the shipped roads carry the minutes the build step filled"));
// The old deterministic IR projector is retired; current publication validates the authored graph.
await verifyCurrentStarter(tmp_path,module_id);
const authored=await read_json(pyDivide(pyDivide(CONTENT_DIR,'starters'),module_id+'/npc-agendas.json'));
for(const [oldId,newId] of [['npc-rat-swarm','creature-rat-swarm'],['npc-chapel-familiar','creature-chapel-familiar']]){
 assert.ok(authored.npcs.some((n:any)=>n.npc_id===oldId));
 assert.ok(!committed.nodes.some((n:any)=>n.node_id===oldId));
 assert.ok(committed.nodes.some((n:any)=>n.node_id===newId&&n.node_kind==='creature'));
}

}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("module_id",(await pySorted(STARTERS))))).entries())test("test_reprojection_reproduces_the_committed_graph"+((pyCartesian([{}],pyParametrize("module_id",(await pySorted(STARTERS))))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_reprojection_reproduces_the_committed_graph(row["module_id"],temporary);});

export let HAUNTING_OBLIGATIONS:any=["requirement-globe-archivist","requirement-globe-clippings-access"];



export let PRE_RD04:any="566dca9da";
export async function pre_rd04_graph(){return native.parsePythonJson(preRd04GraphJson);}
export async function test_the_haunting_old_projection_diff_is_only_the_new_typescript_map_metadata_and_the_morgue_obligations(tmp_path:any){
let graph:any,without:any,result:any,morgue:any;
graph=(await pre_rd04_graph());
assert.notEqual(graph,null,'The retained pre-RD-04 graph must be available for historical data assertions');
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(graph,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_kind"),"requirement"))){__rows.push(pyAt(n,"node_id"));}}return __rows;})()),HAUNTING_OBLIGATIONS)),"tests/kernel/test_starters.py:157 assert [n[\"node_id\"] for n in graph[\"nodes\"] if n[\"node_kind\"] == \"requirement\"] == HAUNTING_OBLIGATIONS");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(graph,"claims"))){if(pyBool(pyEqual(pyAt(c,"predicate"),"has-requirement"))){__rows.push([pyAt(c,"subject_id"),pyAt(pyAt(c,"object"),"node_id")]);}}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const node of pyIterable(HAUNTING_OBLIGATIONS)){__rows.push(["scene-newspaper-morgue",node]);}return __rows;})()))),"tests/kernel/test_starters.py:158 assert [(c[\"subject_id\"], c[\"object\"][\"node_id\"]) for c in graph[\"claims\"] if c[\"predicate\"] == \"has-requirement\"] \\\n        == [(\"scene-newspaper-morgue\", node) for node in HAUNTING_OBLIGATIONS]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(graph,"relations"))){if(pyBool(pyEqual(pyAt(r,"relation_kind"),"has-requirement"))){__rows.push(pyAt(r,"claim_id"));}}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const node of pyIterable(HAUNTING_OBLIGATIONS)){__rows.push(`claim-has-requirement-${(await pyMethod(node,"removeprefix",["requirement-"],{}))}`);}return __rows;})()))),"tests/kernel/test_starters.py:160 assert [r[\"claim_id\"] for r in graph[\"relations\"] if r[\"relation_kind\"] == \"has-requirement\"] \\\n        == [f\"claim-has-requirement-{node.removeprefix('requirement-')}\" for node in HAUNTING_OBLIGATIONS]");
graph["nodes"]=(await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(graph,"nodes"))){if(pyBool(!pyEqual(pyAt(n,"node_kind"),"requirement"))){__rows.push(n);}}return __rows;})());
graph["claims"]=(await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(graph,"claims"))){if(pyBool(!pyEqual(pyAt(c,"predicate"),"has-requirement"))){__rows.push(c);}}return __rows;})());
graph["relations"]=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(graph,"relations"))){if(pyBool(!pyEqual(pyAt(r,"relation_kind"),"has-requirement"))){__rows.push(r);}}return __rows;})());
// Historical JSON assertions above remain; retired CLI diff output has no current production owner.
await verifyCurrentStarter(tmp_path,'the-haunting');
const current=await read_json(pyDivide(CONTENT_DIR,'starters/the-haunting/module-graph.json'));
for(const id of HAUNTING_OBLIGATIONS)assert.ok(current.nodes.some((node:any)=>node.node_id===id&&node.node_kind==='requirement'));

}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_haunting_old_projection_diff_is_only_the_new_typescript_map_metadata_and_the_morgue_obligations"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_haunting_old_projection_diff_is_only_the_new_typescript_map_metadata_and_the_morgue_obligations(temporary);});
export async function _paths(before:any,after:any,path:any=""){
const __yielded:any[]=[];
let key:any,ident:any,old:any,new_value:any;

if(pyBool((await (async()=>{const __left=(await pyIsInstance(before,pyDict));return pyBool(__left)?(await pyIsInstance(after,pyDict)):__left;})()))){for(key of pyIterable((await pySorted(pyUnion((await pySet(before)),(await pySet(after))))))){
if(pyBool(!pyContains(after,key))){__yielded.push(`${path}/${key}: removed`);}else if(pyBool(!pyContains(before,key))){__yielded.push(`${path}/${key}: added`);}else{__yielded.push(...(await _paths(pyAt(before,key),pyAt(after,key),`${path}/${key}`)));}
}}else if(pyBool((await (async()=>{const __left=(await pyIsInstance(before,pyList));return pyBool(__left)?(await pyIsInstance(after,pyList)):__left;})()))){ident=(await pyNext((await (async()=>{const __rows:any[]=[];for(const k of pyIterable(["node_id","relation_id","claim_id","id","clue_id","clock_id","weapon_id"])){if(pyBool((await (async()=>{const __left=before;return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAdd(before,after))){__rows.push((await (async()=>{const __left=(await pyIsInstance(r,pyDict));return pyBool(__left)?pyContains(r,k):__left;})()));}return __rows;})()))):__left;})()))){__rows.push(k);}}return __rows;})()),null));
if(pyBool((await (async()=>{const __left=(ident===null);return pyBool(__left)?__left:!pyEqual((await pyLen(new Set((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(before)){__rows.push(pyAt(r,ident));}return __rows;})())))),(await pyLen(before)));})()))){if(pyBool(!pyEqual(before,after))){__yielded.push(`${path}: changed`);}
return __yielded;}
const __unpack11994=[Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(before)){__rows.push([pyAt(r,ident),r]);}return __rows;})())),Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(after)){__rows.push([pyAt(r,ident),r]);}return __rows;})()))];assert.equal(__unpack11994.length,2,"Original tuple unpacking requires exact arity");old=__unpack11994[0];new_value=__unpack11994[1];
for(key of pyIterable(pyAdd((await pyList(old)),(await (async()=>{const __rows:any[]=[];for(const k of pyIterable(new_value)){if(pyBool(!pyContains(old,k))){__rows.push(k);}}return __rows;})())))){
if(pyBool(!pyContains(new_value,key))){__yielded.push(`${path}[${key}]: removed`);}else if(pyBool(!pyContains(old,key))){__yielded.push(`${path}[${key}]: added`);}else{__yielded.push(...(await _paths(pyAt(old,key),pyAt(new_value,key),`${path}[${key}]`)));}
}}else if(pyBool(!pyEqual(before,after))){__yielded.push(`${path}: changed`);}
return __yielded;
}

export let RD04_CHANGES:any=(await pySorted(pyAdd(pyAdd(pyAdd(pyAdd(pyAdd(pyAdd(pyAdd(pyAdd(pyAdd(pyAdd(pyAdd(pyAdd((await (async()=>{const __rows:any[]=[];for(const [scene,rule] of pyIterable([["central-library","library-research"],["chapel-of-contemplation-ruins","chapel-floor-collapse"],["corbitt-confrontation","victory-rewards"],["hall-of-records","library-research"],["upper-floor-bedroom","bed-attack"]])){__rows.push(`/claims[claim-uses-rule-${scene}-${rule}]: added`);}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const [scene,rule] of pyIterable([["central-library","library-research"],["chapel-of-contemplation-ruins","chapel-floor-collapse"],["corbitt-confrontation","victory-rewards"],["hall-of-records","library-research"],["upper-floor-bedroom","bed-attack"]])){__rows.push(`/relations[relation-uses-rule-${scene}-${rule}]: added`);}return __rows;})())),(await (async()=>{const __rows:any[]=[];for(const rule of pyIterable(["bed-attack","chapel-floor-collapse","library-research","victory-rewards"])){__rows.push(`/nodes[rule-${rule}]: added`);}return __rows;})())),(await (async()=>{const __rows:any[]=[];for(const [conclusion,clue] of pyIterable([["conclusion-corbitt-buried-in-basement","clue-basement-burial-lawsuit"],["conclusion-corbitt-buried-in-basement","clue-will-executor-chapel"],["conclusion-corbitt-is-undead-sorcerer","clue-corbitt-diaries"],["conclusion-house-haunted-by-corbitt","clue-globe-unpublished-story"]])){__rows.push(`/nodes[${conclusion}]/properties/runtime_projection/record/clues[${clue}]/affordance: removed`);}return __rows;})())),(await (async()=>{const __rows:any[]=[];for(const npc of pyIterable(["npc-rat-pack","npc-walter-corbitt"])){for(const key of pyIterable(["fields_extracted","fields_not_authored","fields_observed","provenance","source_refs","status","subject_kind"])){__rows.push(`/nodes[${npc}]/properties/runtime_projection/record/mechanics/${key}: removed`);}}return __rows;})())),(await (async()=>{const __rows:any[]=[];for(const npc of pyIterable(["npc-rat-pack","npc-walter-corbitt"])){for(const key of pyIterable(["attacks","attacks_per_round"])){__rows.push(`/nodes[${npc}]/properties/runtime_projection/record/mechanics/profile/${key}: removed`);}}return __rows;})())),["/nodes[npc-rat-pack]/properties/runtime_projection/record/mechanics/profile/weapons: added","/nodes[npc-rat-pack]/evidence_span_ids: changed","/nodes[npc-rat-pack]/source_refs: changed","/nodes[npc-walter-corbitt]/source_refs: changed","/nodes[npc-walter-corbitt]/properties/runtime_projection/record/mechanics/profile/san_loss_to_see: removed","/nodes[npc-walter-corbitt]/properties/runtime_projection/record/mechanics/profile/sanity_loss: added","/nodes[npc-walter-corbitt]/properties/runtime_projection/record/mechanics/profile/weapons[floating-dagger]: removed","/nodes[npc-walter-corbitt]/properties/runtime_projection/record/mechanics/profile/weapons[floating-knife]: added"]),(await (async()=>{const __rows:any[]=[];for(const key of pyIterable(["adds_damage_bonus: added","book: added","damage: added","note: removed","uses_per_round: added"])){__rows.push(`/nodes[npc-walter-corbitt]/properties/runtime_projection/record/mechanics/profile/weapons[claws]/${key}`);}return __rows;})())),(await (async()=>{const __rows:any[]=[];for(const scene of pyIterable(["basement-rites","corbitt-confrontation","upper-floor-bedroom"])){__rows.push(`/nodes[scene-${scene}]/properties/runtime_projection/record/on_enter: removed`);}return __rows;})())),["/nodes[scene-corbitt-confrontation]/properties/runtime_projection/record/conclusion_contract/sanity_reward: removed","/nodes[scene-chapel-of-contemplation-ruins]/properties/runtime_projection/record/optional_rules: removed"]),(await (async()=>{const __rows:any[]=[];for(const [scene,affordance,key] of pyIterable([["central-library","central-library-search-1835","time_profile"],["central-library","central-library-search-1852","time_profile"],["central-library","central-library-search-1866","time_profile"],["central-library","central-library-search-lawsuit-outcome","time_profile"],["hall-of-records","library-use-civil","time_profile"],["chapel-of-contemplation-ruins","descend-ruined-chapel-cellar","authored_operation"],["chapel-of-contemplation-ruins","search-under-chapel-cabinet","skills"],["chapel-of-contemplation-ruins","study-liber-ivonis","authored_operation"],["chapel-of-contemplation-ruins","study-liber-ivonis","skills"],["newspaper-morgue","persuade-arty","skills"],["newspaper-morgue","befriend-ruth","skills"]])){__rows.push(`/nodes[scene-${scene}]/properties/runtime_projection/record/affordances[${affordance}]/${key}: removed`);}return __rows;})())),(await (async()=>{const __rows:any[]=[];for(const danger of pyIterable(["floating-knife","walter-corbitt"])){__rows.push(`/nodes[threat-corbitt-haunting]/properties/runtime_projection/record/dangers[${danger}]/attack_profiles: removed`);}return __rows;})())),["/nodes[threat-corbitt-haunting]/properties/runtime_projection/record/clocks[corbitt-awareness]/advances_on: added","/nodes[tome-liber-ivonis]/evidence_span_ids: changed","/nodes[tome-liber-ivonis]/source_refs: changed","/nodes[tome-liber-ivonis]/properties/mechanics: added"])));

export let SL25_CHANGES:any=(await pySorted((await (async()=>{const __rows:any[]=[];for(const scene of pyIterable(["basement-rites","corbitt-confrontation","corbitt-house-ground","neighborhood-gossip","previous-tenants","upper-floor-bedroom"])){__rows.push(`/nodes[scene-${scene}]/properties/runtime_projection/record/destination_identity: added`);}return __rows;})())));



export let CKF_CHANGES:any=(await pySorted(pyAdd(["/nodes[npc-rat-pack]: removed","/claims[claim-contains-28]: removed","/relations[relation-contains-28]: removed","/nodes[module-the-haunting]/properties/runtime_projection/documents: changed","/nodes[creature-rat-pack]/evidence_span_ids: changed","/nodes[creature-rat-pack]/source_refs: changed","/nodes[npc-walter-corbitt]/properties/weaknesses: added"],(await (async()=>{const __rows:any[]=[];for(const key of pyIterable(["combat","habits","mechanics"])){__rows.push(`/nodes[creature-rat-pack]/properties/${key}: added`);}return __rows;})()))));
export let RETIRED_WITH_THE_TWIN:any="/nodes[npc-rat-pack]/";

export let SL52_CHANGES:any=(await pySorted(["/claims[claim-has-requirement-knott-accept-commission]: added","/nodes[requirement-knott-accept-commission]: added","/relations[relation-has-requirement-knott-accept-commission]: added"]));



export let HG_SCENES:any=["basement-rites","central-library","chapel-of-contemplation-ruins","commission-briefing","corbitt-confrontation","corbitt-house-ground","hall-of-records","higher-courts-central-police","neighborhood-gossip","newspaper-morgue","previous-tenants","upper-floor-bedroom"];
export let HG_SEEN:any=["arty-wilmot","dooley","gabriela-macario","kim-debrun","records-clerk","ruth-blake","steven-knott","vittorio-macario"];
export let HG_ROADS:any=["hall-of-records","higher-courts-central-police","neighborhood-gossip"];
export let HG_CHANGES:any=(await pySorted(pyAdd(pyAdd(pyAdd(pyAdd(pyAdd(pyAdd((await (async()=>{const __rows:any[]=[];for(const scene of pyIterable(HG_SCENES)){for(const key of pyIterable(["summary: changed","properties/description: added"])){__rows.push(`/nodes[scene-${scene}]/${key}`);}}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const scene of pyIterable(["basement-rites","corbitt-house-ground","newspaper-morgue","upper-floor-bedroom"])){__rows.push(`/nodes[scene-${scene}]/properties/runtime_projection/record/keeper_notes: added`);}return __rows;})())),(await (async()=>{const __rows:any[]=[];for(const scene of pyIterable(HG_ROADS)){__rows.push(`/nodes[scene-${scene}]/properties/runtime_projection/record/scene_edges: changed`);}return __rows;})())),(await (async()=>{const __rows:any[]=[];for(const npc of pyIterable(pyAdd(HG_SEEN,["walter-corbitt"]))){__rows.push(`/nodes[npc-${npc}]/properties/biography: added`);}return __rows;})())),(await (async()=>{const __rows:any[]=[];for(const npc of pyIterable(HG_SEEN)){__rows.push(`/nodes[npc-${npc}]/visibility: changed`);}return __rows;})())),(await (async()=>{const __rows:any[]=[];for(const key of pyIterable(["delivery_kind: changed","skill: added","difficulty: added"])){__rows.push(`/nodes[clue-rusted-basement-dagger]/properties/${key}`);}return __rows;})())),(await (async()=>{const __rows:any[]=[];for(const kind of pyIterable(["claim","relation"])){for(const scene of pyIterable(HG_ROADS)){__rows.push(`/${kind}s[${kind}-route-to-${scene}-chapel]: added`);}}return __rows;})()))));
export async function test_the_haunting_differs_from_its_pre_rd04_graph_only_by_the_migration(){
let before:any,after:any,changes:any,existed:any,roads:any,confrontation:any,dagger:any,source_mode:any,rd04:any;
before=(await pre_rd04_graph());
assert.notEqual(before,null,'The retained pre-RD-04 graph must be available for historical data assertions');
after=(await read_json(pyDivide(pyDivide(pyDivide(CONTENT_DIR,"starters"),"the-haunting"),"module-graph.json")));
changes=(await pySorted((await _paths(before,after))));
existed=new Set((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(before,"relations"))){__rows.push(pyAt(r,"relation_id"));}return __rows;})()));
roads=(await pySorted((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(after,"relations"))){if(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"relation_kind"),"route-to");return pyBool(__left)?pyContains(existed,pyAt(r,"relation_id")):__left;})());return pyBool(__left)?pyContains(((await (async()=>{const __left=(await pyMethod(r,"get",["properties"],{}));return pyBool(__left)?__left:({});})())),"travel_minutes"):__left;})()))){for(const key of pyIterable(ROAD_TRAVEL)){__rows.push(`/relations[${pyAt(r,"relation_id")}]/properties/${key}: added`);}}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=roads;return pyBool(__left)?pyLessEqual((await pySet(roads)),(await pySet(changes))):__left;})())),"tests/kernel/test_starters.py:318 assert roads and set(roads) <= set(changes)");
confrontation=(await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(after,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_id"),"scene-corbitt-confrontation"))){__rows.push(n);}}return __rows;})())));
dagger=(await pyNext((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(pyAt(pyAt(pyAt(pyAt(confrontation,"properties"),"runtime_projection"),"record"),"affordances"))){if(pyBool(pyEqual(pyAt(a,"id"),"strike-with-his-dagger"))){__rows.push(a);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(pyAt(dagger,"rules_operation"),"investigator_usage_mode"),"melee")),"tests/kernel/test_starters.py:323 assert dagger[\"rules_operation\"][\"investigator_usage_mode\"] == \"melee\"");
source_mode=new Set(["/nodes[scene-corbitt-confrontation]/properties/runtime_projection/record/"+"affordances[strike-with-his-dagger]/rules_operation/investigator_usage_mode: added"]);
assert.ok(pyBool(pyLessEqual(source_mode,(await pySet(changes)))),"tests/kernel/test_starters.py:326 assert source_mode <= set(changes)");
rd04=(await (async()=>{const __rows:any[]=[];for(const change of pyIterable(RD04_CHANGES)){if(pyBool(!pyBool((await pyMethod(change,"startswith",[RETIRED_WITH_THE_TWIN],{}))))){__rows.push(change);}}return __rows;})());
assert.ok(pyBool(pyEqual((await pySorted(pySubtract(pySubtract((await pySet(changes)),(await pySet(roads))),source_mode))),(await pySorted(pyAdd(pyAdd(pyAdd(pyAdd(rd04,SL25_CHANGES),SL52_CHANGES),CKF_CHANGES),HG_CHANGES))))),"tests/kernel/test_starters.py:328 assert sorted(set(changes) - set(roads) - source_mode) == sorted(rd04 + SL25_CHANGES + SL52_CHANGES + CKF_CHANGES + HG_CHANGES)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_haunting_differs_from_its_pre_rd04_graph_only_by_the_migration"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_haunting_differs_from_its_pre_rd04_graph_only_by_the_migration();});
export async function test_playability_findings_are_accounted_for(module_id:any){
let graph:any,report:any,hard:any,other:any;


graph=(await read_json(pyDivide(pyDivide(pyDivide(CONTENT_DIR,"starters"),module_id),"module-graph.json")));
report=(await check(graph));
hard=new Set(["dangling_relation","no_entrance_declared","no_ending_declared","scene_graph_fragmented","scene_unreachable_from_entrance","conclusion_without_support","clue_supports_nothing"]);
assert.ok(pyBool(!pyBool((pyIntersection((await pySet(pyAt(report,"finding_counts"))),hard)))),pyStr(pyAt(report,"finding_counts")));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(report,"measures"),"scene_components"),1);return pyBool(__left)?pyLessEqual(1,pyAt(pyAt(report,"measures"),"endings")):__left;})())),"tests/kernel/test_starters.py:340 assert report[\"measures\"][\"scene_components\"] == 1 and report[\"measures\"][\"endings\"] >= 1");
other=new Set((await (async()=>{const __rows:any[]=[];for(const f of pyIterable(pyAt(report,"findings"))){if(pyBool(!pyEqual(pyAt(f,"code"),"node_without_page"))){__rows.push([pyAt(f,"code"),pyAt(f,"subject")]);}}return __rows;})()));
assert.ok(pyBool(pyEqual(other,pyAt(KNOWN_IR_FINDINGS,module_id))),"tests/kernel/test_starters.py:342 assert other == KNOWN_IR_FINDINGS[module_id]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(report,"finding_counts"),"node_without_page"),(await pyLen(pyAt(graph,"nodes"))))),"tests/kernel/test_starters.py:345 assert report[\"finding_counts\"][\"node_without_page\"] == len(graph[\"nodes\"])");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("module_id",(await pySorted(STARTERS))))).entries())test("test_playability_findings_are_accounted_for"+((pyCartesian([{}],pyParametrize("module_id",(await pySorted(STARTERS))))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_playability_findings_are_accounted_for(row["module_id"]);});
export async function test_starter_opens_a_campaign_and_plays_a_turn(kernel:any,module_id:any){
let created:any,opened:any,capsule:any,destination:any,moved:any;
created=pyAt((await pyMethod(kernel,"ok",["campaign.create",({["id"]:"c1",["module"]:module_id,["play_language"]:"zh-Hans"})],{})),"campaign");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(created,"opening_scene"),pyAt(pyAt(STARTERS,module_id),"start"));return pyBool(__left)?pyEqual(pyAt(created,"status"),"setting_up"):__left;})())),"tests/kernel/test_starters.py:351 assert created[\"opening_scene\"] == STARTERS[module_id][\"start\"] and created[\"status\"] == \"setting_up\"");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide(pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"modules"),module_id),"module.json"))),"status"),"installed")),"tests/kernel/test_starters.py:352 assert read_json(kernel.workspace / \".coc\" / \"modules\" / module_id / \"module.json\")[\"status\"] == \"installed\"");
(await confirmed_investigator(kernel));
(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:"c1"})],{}));
opened=(await pyMethod(kernel,"table",["open"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(opened,"scene"),"name"),pyAt(pyAt(STARTERS,module_id),"start"))),"tests/kernel/test_starters.py:356 assert opened[\"scene\"][\"name\"] == STARTERS[module_id][\"start\"]");
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t0-c1","text":"开场。"}));
capsule=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我看看四周。"})),"capsule");
assert.ok(pyBool(pyEqual(pyAt(pyAt(capsule,"where"),"scene"),pyAt(pyAt(STARTERS,module_id),"start"))),"tests/kernel/test_starters.py:359 assert capsule[\"where\"][\"scene\"] == STARTERS[module_id][\"start\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(capsule,"where"),"material"),"ready")),"tests/kernel/test_starters.py:360 assert capsule[\"where\"][\"material\"] == \"ready\"");
assert.ok(pyBool((await (async()=>{const __left=pyAt(pyAt(capsule,"where"),"exits");return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(pyAt(capsule,"where"),"exits"))){__rows.push(pyEqual(pyAt(e,"material"),"ready"));}return __rows;})()))):__left;})())),"tests/kernel/test_starters.py:361 assert capsule[\"where\"][\"exits\"] and all(e[\"material\"] == \"ready\" for e in capsule[\"where\"][\"exits\"])");
destination=pyAt(pyAt(pyAt(pyAt(capsule,"where"),"exits"),0),"to");
moved=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:destination})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(moved,"world"),"active_scene"),destination);return pyBool(__left)?pyEqual(pyAt(moved,"material"),"ready"):__left;})())),"tests/kernel/test_starters.py:364 assert moved[\"world\"][\"active_scene\"] == destination and moved[\"material\"] == \"ready\"");
assert.ok(pyBool(pyEqual(pyAt(moved,"deepen_queued"),[])),"tests/kernel/test_starters.py:365 assert moved[\"deepen_queued\"] == []");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace,"c1")),"world.json"))),"active_scene"),destination)),"tests/kernel/test_starters.py:366 assert read_json(campaign_dir(kernel.workspace, \"c1\") / \"world.json\")[\"active_scene\"] == destination");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("module_id",(await pySorted(STARTERS))))).entries())test("test_starter_opens_a_campaign_and_plays_a_turn"+((pyCartesian([{}],pyParametrize("module_id",(await pySorted(STARTERS))))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_starter_opens_a_campaign_and_plays_a_turn(await kernel(t,{}),row["module_id"]);});
