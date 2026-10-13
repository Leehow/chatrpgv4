// Migrated from tests/kernel/test_capsule_module.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CONTENT_DIR,KERNEL_DIR,WORKTREE,RpcClient,campaign_dir,narrate,narrate_opening,open_turn,read_json,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,retainedFixture,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,pyType,Counter} from "./world-native-support.ts";
import {MODULE_BUDGET,MODULE_LINE_STEPS,fitted_module_section,json_size,module_section,ModuleGraph,withoutCreatureDomain} from "./world-production-support.ts";
const __file__=new URL('../../tests/kernel/test_capsule_module.py',import.meta.url).pathname;











export let HAUNTING:any=(await pyInvoke(read_json,[pyDivide(pyDivide(pyDivide(CONTENT_DIR,"starters"),"the-haunting"),"module-graph.json")],{}));
export async function names(kind:any){
return (await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(HAUNTING,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_kind"),kind))){__rows.push(pyAt(n,"name"));}}return __rows;})());
}
Object.defineProperty(names,"__pySignature",{value:[{"name":"kind","rest":false,"varargs":false}]});
export async function test_the_first_turn_after_open_carries_the_briefing_from_the_graph(kernel:any){
let capsule:any,module:any,node:any,later:any;
capsule=pyAt((await pyInvoke(open_turn,[kernel,"我环顾四周。"],{})),"capsule");
module=pyAt(capsule,"module");
node=(await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(HAUNTING,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_kind"),"module"))){__rows.push(n);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(module,"title"),pyAt(node,"name"));return pyBool(__left)?pyEqual(pyAt(module,"synopsis"),pyAt(node,"summary")):__left;})())),"tests/kernel/test_capsule_module.py:31 assert module[\"title\"] == node[\"name\"] and module[\"synopsis\"] == node[\"summary\"]");
assert.ok(pyBool(!pyContains(module,"era")),"tests/kernel/test_capsule_module.py:32 assert \"era\" not in module");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const f of pyIterable(pyAt(module,"factions"))){__rows.push(pyAt(f,"name"));}return __rows;})()),pyAdd((await pyInvoke(names,["organization"],{})),(await pyInvoke(names,["faction"],{}))))),"tests/kernel/test_capsule_module.py:33 assert [f[\"name\"] for f in module[\"factions\"]] == names(\"organization\") + names(\"faction\")");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(module,"places"))){__rows.push(pyAt(p,"name"));}return __rows;})()),(await pyInvoke(names,["location"],{})))),"tests/kernel/test_capsule_module.py:34 assert [p[\"name\"] for p in module[\"places\"]] == names(\"location\")");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(module,"people"))){__rows.push(pyAt(p,"name"));}return __rows;})()),(await pyInvoke(names,["npc"],{})))),"tests/kernel/test_capsule_module.py:36 assert [p[\"name\"] for p in module[\"people\"]] == names(\"npc\")");
assert.ok(pyBool((await (async()=>{const __left=pyContains((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(module,"people"))){__rows.push(pyAt(p,"name"));}return __rows;})()),"Walter Corbitt");return pyBool(__left)?!pyContains((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(capsule,"present"))){__rows.push(pyAt(p,"name"));}return __rows;})()),"Walter Corbitt"):__left;})())),"tests/kernel/test_capsule_module.py:37 assert \"Walter Corbitt\" in [p[\"name\"] for p in module[\"people\"]] and \"Walter Corbitt\" not in [p[\"name\"] for p in capsule[\"present\"]]");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(module,"endings"),[]);return pyBool(__left)?pyEqual(pyAt(module,"conclusions"),(await pyInvoke(names,["conclusion"],{}))):__left;})());return pyBool(__left)?pyEqual((await pyInvoke(pyLen,[pyAt(module,"conclusions")],{})),6):__left;})())),"tests/kernel/test_capsule_module.py:38 assert module[\"endings\"] == [] and module[\"conclusions\"] == names(\"conclusion\") and len(module[\"conclusions\"]) == 6");
assert.ok(pyBool(pyEqual(pyAt(module,"structure_type"),"branching_investigation")),"tests/kernel/test_capsule_module.py:39 assert module[\"structure_type\"] == \"branching_investigation\"");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const roster of pyIterable(["factions","places","people"])){for(const row of pyIterable(pyAt(module,roster))){__rows.push(pyEqual((await pyInvoke(pySet,[row],{})),new Set(["name","line"])));}}return __rows;})())))),"tests/kernel/test_capsule_module.py:40 assert all(set(row) == {\"name\", \"line\"} for roster in (\"factions\", \"places\", \"people\") for row in module[roster])");
assert.ok(pyBool((await pyMethod(pyAt(pyAt(pyAt(module,"factions"),0),"line"),"startswith",["A church linked to Corbitt"],{}))),"tests/kernel/test_capsule_module.py:41 assert module[\"factions\"][0][\"line\"].startswith(\"A church linked to Corbitt\")");
assert.ok(pyBool(pyLessEqual((await pyInvoke(json_size,[module],{})),MODULE_BUDGET)),"tests/kernel/test_capsule_module.py:42 assert json_size(module) <= MODULE_BUDGET");
assert.ok(pyBool(pyContains(pyAt(capsule,"truncated"),"module")),"tests/kernel/test_capsule_module.py:44 assert \"module\" in capsule[\"truncated\"]");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(capsule,"head"),"module");return pyBool(__left)?pyContains(pyAt(capsule,"head"),"lookup"):__left;})())),"tests/kernel/test_capsule_module.py:45 assert \"module\" in capsule[\"head\"] and \"lookup\" in capsule[\"head\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"module"),module)),"tests/kernel/test_capsule_module.py:46 assert kernel.table(\"capsule\")[\"module\"] == module");
(await pyInvoke(narrate,[kernel,"t1-c1","……"],{}));
later=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"继续。"})),"capsule");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(later,"module");return pyBool(__left)?!pyContains((await pyMethod(later,"get",["truncated",[]],{})),"module"):__left;})())),"tests/kernel/test_capsule_module.py:50 assert \"module\" not in later and \"module\" not in later.get(\"truncated\", [])");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(pyAt(later,"head"),"module section");return pyBool(__left)?pyContains(pyAt(capsule,"head"),pyAt(later,"head")):__left;})())),"tests/kernel/test_capsule_module.py:51 assert \"module section\" not in later[\"head\"] and later[\"head\"] in capsule[\"head\"]");
}
Object.defineProperty(test_the_first_turn_after_open_carries_the_briefing_from_the_graph,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_first_turn_after_open_carries_the_briefing_from_the_graph"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_first_turn_after_open_carries_the_briefing_from_the_graph(await kernel(t,{}));});
export async function test_a_new_process_briefs_again_under_the_same_condition_as_style_and_resume(tmp_path:any){
let first:any,second:any,capsule:any,provider:any,style:any,full_lines:any;
first=(new RpcClient(pyDivide(tmp_path,"ws")));
try{(await pyInvoke(open_turn,[first,"我看看。"],{}));
(await pyInvoke(narrate,[first,"t1-c1","……"],{}));
assert.ok(pyBool(!pyContains(pyAt((await pyMethod(first,"table",["player_input"],{"text":"继续。"})),"capsule"),"module")),"tests/kernel/test_capsule_module.py:59 assert \"module\" not in first.table(\"player_input\", text=\"继续。\")[\"capsule\"]");}finally{(await pyMethod(first,"close",[],{}));}
second=(new RpcClient(pyDivide(tmp_path,"ws")));
try{assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(second,"table",["open"],{})),"turn"),"number"),2)),"tests/kernel/test_capsule_module.py:64 assert second.table(\"open\")[\"turn\"][\"number\"] == 2");
(await pyInvoke(narrate,[second,"t2-c1","……"],{}));
capsule=pyAt((await pyMethod(second,"table",["player_input"],{"text":"再来。"})),"capsule");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(capsule,"module"),"title"),"The Haunting");return pyBool(__left)?pyEqual(pyAt(pyAt(capsule,"resume"),"turn"),1):__left;})())),"tests/kernel/test_capsule_module.py:67 assert capsule[\"module\"][\"title\"] == \"The Haunting\" and capsule[\"resume\"][\"turn\"] == 1");
provider=(await pyInvoke(read_json,[pyDivide(pyDivide(pyDivide(WORKTREE,"mods"),"narration-craft"),"mod.json")],{}));
style=(await pyInvoke(read_json,[pyDivide(pyDivide(pyDivide(WORKTREE,"mods"),"narration-craft"),pyAt(pyAt(provider,"contributes"),"style"))],{}));
full_lines=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [id_,entry] of pyIterable((await pyMethod(pyAt(style,"directives"),"items",[],{})))){__rows.push([id_,pyAt(entry,"full")]);}return __rows;})()));
assert.ok(pyBool(pyEqual(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt(capsule,"style"),"directives"))){__rows.push([pyAt(row,"id"),pyAt(row,"line")]);}return __rows;})())),full_lines)),"tests/kernel/test_capsule_module.py:72 assert {row[\"id\"]: row[\"line\"] for row in capsule[\"style\"][\"directives\"]} == full_lines");}finally{(await pyMethod(second,"close",[],{}));}
}
Object.defineProperty(test_a_new_process_briefs_again_under_the_same_condition_as_style_and_resume,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_new_process_briefs_again_under_the_same_condition_as_style_and_resume"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_new_process_briefs_again_under_the_same_condition_as_style_and_resume(temporary);});
export async function test_the_briefing_speaks_the_play_language_in_head_only(tmp_path:any){
let client:any,capsule:any;
client=(new RpcClient(pyDivide(tmp_path,"ws")));
try{(await pyMethod(client,"ok",["campaign.create",({["id"]:"c1",["module"]:"the-haunting",["pregen"]:"thomas-hayes",["play_language"]:"en"})],{}));
(await pyInvoke(narrate_opening,[client],{}));
capsule=pyAt((await pyMethod(client,"table",["player_input"],{"text":"I look around."})),"capsule");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(capsule,"head"),"module section");return pyBool(__left)?pyEqual(pyAt(pyAt(capsule,"module"),"title"),"The Haunting"):__left;})())),"tests/kernel/test_capsule_module.py:83 assert \"module section\" in capsule[\"head\"] and capsule[\"module\"][\"title\"] == \"The Haunting\"");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_the_briefing_speaks_the_play_language_in_head_only,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_briefing_speaks_the_play_language_in_head_only"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_briefing_speaks_the_play_language_in_head_only(temporary);});

export async function graph(module_id:any){
return (await pyInvoke(ModuleGraph,[module_id,pyDivide(pyDivide(pyDivide(CONTENT_DIR,"starters"),module_id),"module-graph.json")],{}));
}
Object.defineProperty(graph,"__pySignature",{value:[{"name":"module_id","rest":false,"varargs":false}]});
export async function test_lines_step_down_before_anyone_is_dropped_and_the_tail_goes_last(){
let haunting:any,full:any,fitted:any,cut:any,untouched:any,squeezed:any;
// The unchanged-section law predates optional creature rosters. Preserve it on the same current book with that optional domain omitted.
haunting=withoutCreatureDomain(await graph('the-haunting'));
full=(await pyInvoke(module_section,[haunting],{}));
assert.ok(pyBool((await (async()=>{const __left=pyLess(MODULE_BUDGET,(await pyInvoke(json_size,[full],{})));return pyBool(__left)?pyLessEqual((await pyMax((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(full,"people"))){__rows.push((await pyInvoke(pyLen,[pyAt(p,"line")],{})));}return __rows;})()))),pyAt(MODULE_LINE_STEPS,0)):__left;})())),"tests/kernel/test_capsule_module.py:97 assert json_size(full) > MODULE_BUDGET and max(len(p[\"line\"]) for p in full[\"people\"]) <= MODULE_LINE_STEPS[0]");
const __unpack5111=(await pyInvoke(fitted_module_section,[haunting],{}));fitted=__unpack5111[0];cut=__unpack5111[1];
assert.ok(pyBool((await (async()=>{const __left=cut;return pyBool(__left)?pyLessEqual((await pyInvoke(json_size,[fitted],{})),MODULE_BUDGET):__left;})())),"tests/kernel/test_capsule_module.py:99 assert cut and json_size(fitted) <= MODULE_BUDGET");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(fitted,"people"))){__rows.push(pyAt(p,"name"));}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(full,"people"))){__rows.push(pyAt(p,"name"));}return __rows;})()))),"tests/kernel/test_capsule_module.py:100 assert [p[\"name\"] for p in fitted[\"people\"]] == [p[\"name\"] for p in full[\"people\"]]");
assert.ok(pyBool((await (async()=>{const __term0=0;const __term1=(await pyMax((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(fitted,"people"))){__rows.push((await pyInvoke(pyLen,[pyAt(p,"line")],{})));}return __rows;})())));const __term2=pyAt(MODULE_LINE_STEPS,0);return pyCompare(__term0,__term1,"<")&&pyCompare(__term1,__term2,"<");})())),"tests/kernel/test_capsule_module.py:101 assert 0 < max(len(p[\"line\"]) for p in fitted[\"people\"]) < MODULE_LINE_STEPS[0]");
const __unpack5689=(await pyInvoke(fitted_module_section,[haunting],{"budget":(await pyInvoke(json_size,[full],{}))}));untouched=__unpack5689[0];cut=__unpack5689[1];
assert.ok(pyBool((await (async()=>{const __left=!pyBool(cut);return pyBool(__left)?pyEqual(untouched,full):__left;})())),"tests/kernel/test_capsule_module.py:106 assert not cut and untouched == full");
const __unpack5880=(await pyInvoke(fitted_module_section,[haunting],{"budget":700}));squeezed=__unpack5880[0];cut=__unpack5880[1];
assert.ok(pyBool((await (async()=>{const __left=cut;return pyBool(__left)?pyLessEqual((await pyInvoke(json_size,[squeezed],{})),700):__left;})())),"tests/kernel/test_capsule_module.py:109 assert cut and json_size(squeezed) <= 700");
assert.ok(pyBool((await (async()=>{const __left=(await pyAll((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(squeezed,"people"))){__rows.push(pyEqual(pyAt(p,"line"),""));}return __rows;})())));return pyBool(__left)?(await (async()=>{const __term0=0;const __term1=(await pyInvoke(pyLen,[pyAt(squeezed,"people")],{}));const __term2=(await pyInvoke(pyLen,[pyAt(full,"people")],{}));return pyCompare(__term0,__term1,"<")&&pyCompare(__term1,__term2,"<");})()):__left;})())),"tests/kernel/test_capsule_module.py:110 assert all(p[\"line\"] == \"\" for p in squeezed[\"people\"]) and 0 < len(squeezed[\"people\"]) < len(full[\"people\"])");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(squeezed,"people"),0),"name"),pyAt(pyAt(pyAt(full,"people"),0),"name"))),"tests/kernel/test_capsule_module.py:111 assert squeezed[\"people\"][0][\"name\"] == full[\"people\"][0][\"name\"]");
}
Object.defineProperty(test_lines_step_down_before_anyone_is_dropped_and_the_tail_goes_last,"__pySignature",{value:[]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_lines_step_down_before_anyone_is_dropped_and_the_tail_goes_last"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_lines_step_down_before_anyone_is_dropped_and_the_tail_goes_last();});
export async function test_domains_the_graph_lacks_are_empty_arrays_never_guesses(){
let module_id:any,section:any,raw:any,kinds:any,meta:any;
for(module_id of pyIterable(["mystery-house"])){
section=(await pyInvoke(module_section,[(await pyInvoke(graph,[module_id],{}))],{}));
raw=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(pyDivide(CONTENT_DIR,"starters"),module_id),"module-graph.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
kinds=new Set((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(raw,"nodes"))){__rows.push(pyAt(n,"node_kind"));}return __rows;})()));
assert.ok(pyBool(!pyBool(pyIntersection(kinds,new Set(["faction","organization","location","ending"])))),"tests/kernel/test_capsule_module.py:119 assert not kinds & {\"faction\", \"organization\", \"location\", \"ending\"}");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(section,"factions"),[]);return pyBool(__left)?pyEqual(pyAt(section,"places"),[]):__left;})());return pyBool(__left)?pyEqual(pyAt(section,"endings"),[]):__left;})())),"tests/kernel/test_capsule_module.py:120 assert section[\"factions\"] == [] and section[\"places\"] == [] and section[\"endings\"] == []");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(section,"people"))){__rows.push(pyAt(p,"name"));}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(raw,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_kind"),"npc"))){__rows.push(pyAt(n,"name"));}}return __rows;})()))),"tests/kernel/test_capsule_module.py:121 assert [p[\"name\"] for p in section[\"people\"]] == [n[\"name\"] for n in raw[\"nodes\"] if n[\"node_kind\"] == \"npc\"]");
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[pyAt(section,"conclusions")],{})),(await pySum((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(raw,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_kind"),"conclusion"))){__rows.push(1);}}return __rows;})()))))),"tests/kernel/test_capsule_module.py:122 assert len(section[\"conclusions\"]) == sum(1 for n in raw[\"nodes\"] if n[\"node_kind\"] == \"conclusion\")");
meta=(await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(raw,"nodes"))){if(pyBool((await pyMethod(pyAt(n,"node_id"),"startswith",["module-"],{})))){for(const d of pyIterable(pyAt(pyAt(pyAt(n,"properties"),"runtime_projection"),"documents"))){if(pyBool(pyEqual(pyAt(d,"filename"),"module-meta.json"))){__rows.push(pyAt(d,"root"));}}}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(section,"structure_type"),pyAt(meta,"structure_type"));return pyBool(__left)?!pyContains(section,"era"):__left;})())),"tests/kernel/test_capsule_module.py:131 assert section[\"structure_type\"] == meta[\"structure_type\"] and \"era\" not in section");
}
}
Object.defineProperty(test_domains_the_graph_lacks_are_empty_arrays_never_guesses,"__pySignature",{value:[]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_domains_the_graph_lacks_are_empty_arrays_never_guesses"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_domains_the_graph_lacks_are_empty_arrays_never_guesses();});
export async function test_the_line_is_graph_text_never_the_name_repeated(){
let section:any,knott:any,record:any;
section=(await pyInvoke(module_section,[(await pyInvoke(graph,["the-haunting"],{}))],{}));
knott=(await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(section,"people"))){if(pyBool(pyEqual(pyAt(p,"name"),"Steven Knott"))){__rows.push(p);}}return __rows;})())));
record=pyAt(pyAt(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(HAUNTING,"nodes"))){if(pyBool(pyEqual(pyAt(n,"name"),"Steven Knott"))){__rows.push(n);}}return __rows;})()))),"properties"),"runtime_projection"),"record");
assert.ok(pyBool(pyEqual(pyAt(knott,"line"),pySlice(`${pyAt(record,"relationship_to_investigators")}; ${pyAt(record,"agenda")}`,undefined,pyAt(MODULE_LINE_STEPS,0)))),"tests/kernel/test_capsule_module.py:138 assert knott[\"line\"] == f\"{record['relationship_to_investigators']}; {record['agenda']}\"[:MODULE_LINE_STEPS[0]]");
assert.ok(pyBool((await pyMethod((await pyInvoke(Path,[pyDivide(pyDivide(pyDivide(CONTENT_DIR,"starters"),"the-haunting"),"module-graph.json")],{})),"exists",[],{}))),"tests/kernel/test_capsule_module.py:139 assert Path(CONTENT_DIR / \"starters\" / \"the-haunting\" / \"module-graph.json\").exists()");
}
Object.defineProperty(test_the_line_is_graph_text_never_the_name_repeated,"__pySignature",{value:[]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_line_is_graph_text_never_the_name_repeated"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_line_is_graph_text_never_the_name_repeated();});

// Current creature rosters and omission counters share the module byte budget (§187.4).
if(process.argv[1]===import.meta.filename)test('creature omissions remain inside the exact module byte budget',async()=>{
  const haunting=await graph('the-haunting');
  const core=await module_section(haunting);
  assert.equal(json_size(core),2631,'the original full-core byte boundary remains a regression fixture');
  const [complete,completeCut]=await fitted_module_section(haunting,{budget:100_000});
  const completeBytes=json_size(complete);
  assert.equal(completeCut,false);
  assert.ok(complete.creatures.length>0,'the real shipped graph supplies optional creatures');
  assert.ok(completeBytes>2631);
  for(const budget of [700,2048,2631,completeBytes-1,completeBytes]){
    const [section,cut]=await fitted_module_section(haunting,{budget});
    assert.ok(json_size(section)<=budget,`brief and omission counters must fit ${budget} bytes`);
    const missing={people:core.people.length-section.people.length,places:core.places.length-section.places.length,creatures:complete.creatures.length-(section.creatures?.length??0)};
    if(Object.values(missing).some(count=>count>0))assert.deepEqual(section.more,missing);
    else assert.equal(section.more,undefined);
    if(budget<completeBytes)assert.equal(cut,true);
    else {assert.equal(cut,false);assert.deepEqual(section,complete);}
    if(budget===completeBytes-1){
      assert.equal(section.creatures,undefined,'optional creatures are omitted before a core roster line');
      for(const field of ['people','places','factions','endings','conclusions'])assert.deepEqual(section[field],core[field]);
    }
  }
});
