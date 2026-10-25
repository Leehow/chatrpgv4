// Migrated from tests/kernel/test_capsule_nine.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,RpcClient,WORKTREE,campaign_dir,create_campaign,narrate,narrate_opening,open_turn,read_json,first_failure,resolve,seed_wound,walk_to_confrontation,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_capsule_nine.py',import.meta.url).pathname;






export let SECTIONS:any=["where","present","known","pressures","obligations","director","situations","memory","style","recent","warnings","voices"];
export let BUDGETS:any=({["where"]:4096,["present"]:3072,["known"]:3072,["pressures"]:1024,["obligations"]:1024,["director"]:3072,["situations"]:1024,["memory"]:1536,["style"]:1536,["recent"]:2048,["warnings"]:1024,["voices"]:3072});


export let PROVIDER:any=(await pyInvoke(read_json,[pyDivide(pyDivide(pyDivide(WORKTREE,"mods"),"narration-craft"),"mod.json")],{}));
export let STYLE:any=(await pyInvoke(read_json,[pyDivide(pyDivide(pyDivide(WORKTREE,"mods"),"narration-craft"),pyAt(pyAt(PROVIDER,"contributes"),"style"))],{}));
export let ALL_DIRECTIVES:any=(await pyInvoke(pyList,[pyAt(STYLE,"directives")],{}));
export let FIXTURES:any=pyDivide(pyDivide(pyDivide(WORKTREE,"tests"),"fixtures"),"mods");
export async function size(payload:any){
return (await pyInvoke(pyLen,[(await pyMethod((await pyMethod(json,"dumps",[payload],{"ensure_ascii":false})),"encode",["utf-8"],{}))],{}));
}
Object.defineProperty(size,"__pySignature",{value:[{"name":"payload","rest":false,"varargs":false}]});

export async function test_the_capsule_has_nine_sections_a_head_and_the_clock(kernel:any){
let capsule:any,name:any,knott:any,budget:any;
capsule=pyAt((await pyInvoke(open_turn,[kernel,"我仔细观察诺特。"],{})),"capsule");
for(name of pyIterable(SECTIONS)){
assert.ok(pyBool(pyContains(capsule,name)),pyStr(name));
}
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(capsule,"head"),"look/lookup");return pyBool(__left)?pyContains(pyAt(capsule,"head"),"director"):__left})())),"tests/kernel/test_capsule_nine.py:33 assert \"look/lookup\" in capsule[\"head\"] and \"director\" in capsule[\"head\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(capsule,"where"),"clock"),({["minutes"]:0,["elapsed"]:"0 h 0 min",["at"]:"1920-10-12T10:00",["day_part"]:"morning"}))),"tests/kernel/test_capsule_nine.py:36 assert capsule[\"where\"][\"clock\"] == {\"minutes\": 0, \"elapsed\": \"0 h 0 min\",\n                                         \"at\": \"1920-10-12T10:00\", \"day_part\": \"morning\"}");
assert.ok(pyBool((pyAt(pyAt(capsule,"where"),"session")===null)),"tests/kernel/test_capsule_nine.py:38 assert capsule[\"where\"][\"session\"] is None");
knott=pyAt(pyAt(capsule,"present"),0);
assert.ok(pyBool((await (async()=>{const __left=pyAt(knott,"hides");return pyBool(__left)?pyAt(knott,"fears"):__left})())),"tests/kernel/test_capsule_nine.py:41 assert knott[\"hides\"] and knott[\"fears\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(capsule,"situations"),[]);return pyBool(__left)?pyEqual(pyAt(capsule,"situations"),pyAt(pyAt((await pyMethod(kernel,"table",["look"],{})),"where"),"situations")):__left})())),"tests/kernel/test_capsule_nine.py:42 assert capsule[\"situations\"] == [] and capsule[\"situations\"] == kernel.table(\"look\")[\"where\"][\"situations\"]");
assert.ok(pyBool(pyEqual((await pyMethod(capsule,"get",["truncated",[]],{})),["reading","module"])),"tests/kernel/test_capsule_nine.py:46 assert capsule.get(\"truncated\", []) == [\"reading\", \"module\"]");
for([name,budget] of pyIterable((await pyMethod(BUDGETS,"items",[],{})))){
if(pyBool(pyEqual(name,"style"))){continue;}
assert.ok(pyBool(pyLessEqual((await pyInvoke(size,[pyAt(capsule,name)],{})),budget)),pyStr(name));
}
assert.ok(pyBool((await (async()=>{const __left=pyLessEqual((await pyInvoke(size,[pyAt(capsule,"style")],{})),2048);return pyBool(__left)?pyLessEqual((await pyInvoke(size,[pyAt(capsule,"module")],{})),2048):__left})())),"tests/kernel/test_capsule_nine.py:51 assert size(capsule[\"style\"]) <= 2048 and size(capsule[\"module\"]) <= 2048");
}
Object.defineProperty(test_the_capsule_has_nine_sections_a_head_and_the_clock,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_capsule_has_nine_sections_a_head_and_the_clock"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_capsule_has_nine_sections_a_head_and_the_clock(await kernel(t,{}));});
export async function test_the_clock_and_elapsed_follow_the_world_minutes(kernel:any){
(await pyInvoke(open_turn,[kernel,"等一会儿。"],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:95})]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where"),"clock"),({["minutes"]:95,["elapsed"]:"1 h 35 min",["at"]:"1920-10-12T11:35",["day_part"]:"morning"}))),"tests/kernel/test_capsule_nine.py:59 assert kernel.table(\"capsule\")[\"where\"][\"clock\"] == {\"minutes\": 95, \"elapsed\": \"1 h 35 min\",\n                                                        \"at\": \"1920-10-12T11:35\", \"day_part\": \"morning\"}");
}
Object.defineProperty(test_the_clock_and_elapsed_follow_the_world_minutes,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_clock_and_elapsed_follow_the_world_minutes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_clock_and_elapsed_follow_the_world_minutes(await kernel(t,{}));});
export async function test_situations_ride_in_the_capsule_and_stay_in_look(kernel:any){
let capsule:any;
(await pyInvoke(open_turn,[kernel,"我受了伤。"],{}));
(await pyInvoke(seed_wound,[kernel.workspace,9],{"minutes_ago":10}));
capsule=(await pyMethod(kernel,"table",["capsule"],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(capsule,"situations"))){__rows.push(pyAt(s,"decision"));}return __rows;})()),["healing:first-aid-ordinary"])),"tests/kernel/test_capsule_nine.py:67 assert [s[\"decision\"] for s in capsule[\"situations\"]] == [\"healing:first-aid-ordinary\"]");
assert.ok(pyBool(pyEqual(pyAt(capsule,"situations"),pyAt(pyAt((await pyMethod(kernel,"table",["look"],{})),"where"),"situations"))),"tests/kernel/test_capsule_nine.py:68 assert capsule[\"situations\"] == kernel.table(\"look\")[\"where\"][\"situations\"]");
}
Object.defineProperty(test_situations_ride_in_the_capsule_and_stay_in_look,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_situations_ride_in_the_capsule_and_stay_in_look"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_situations_ride_in_the_capsule_and_stay_in_look(await kernel(t,{}));});

export async function test_clock_pressure_from_the_wound_hour(kernel:any){
let pressures:any,capsule:any;
(await pyInvoke(open_turn,[kernel,"我受了伤。"],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:30})]}));
(await pyInvoke(seed_wound,[kernel.workspace,9],{"minutes_ago":10}));
pressures=pyAt((await pyMethod(kernel,"table",["capsule"],{})),"pressures");
assert.ok(pyBool(pyEqual(pressures,[({["kind"]:"clock",["cue"]:"healing:first-aid-ordinary",["name"]:"the hour after the wound",["state"]:"10/60 minutes gone",["due"]:"first-aid window closes in 50 min"})])),"tests/kernel/test_capsule_nine.py:78 assert pressures == [{\"kind\": \"clock\", \"cue\": \"healing:first-aid-ordinary\", \"name\": \"the hour after the wound\",\n                          \"state\": \"10/60 minutes gone\", \"due\": \"first-aid window closes in 50 min\"}]");
assert.ok(pyBool(pyContains(pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"director"),"because"),"clock_near_full = False")),"tests/kernel/test_capsule_nine.py:80 assert \"clock_near_full = False\" in kernel.table(\"capsule\")[\"director\"][\"because\"]");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"time",["minutes"]:35})]}));
capsule=(await pyMethod(kernel,"table",["capsule"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(capsule,"pressures"),0),"state"),"45/60 minutes gone")),"tests/kernel/test_capsule_nine.py:83 assert capsule[\"pressures\"][0][\"state\"] == \"45/60 minutes gone\"");
assert.ok(pyBool(pyContains(pyAt(pyAt(capsule,"director"),"because"),"clock_near_full = True")),"tests/kernel/test_capsule_nine.py:84 assert \"clock_near_full = True\" in capsule[\"director\"][\"because\"]");
}
Object.defineProperty(test_clock_pressure_from_the_wound_hour,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_clock_pressure_from_the_wound_hour"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_clock_pressure_from_the_wound_hour(await kernel(t,{}));});
export async function test_clock_pressure_from_the_dying_clock_is_always_near_full(kernel:any){
let capsule:any,names:any,dying:any;
(await pyInvoke(open_turn,[kernel,"我倒下了。"],{}));
(await pyInvoke(seed_wound,[kernel.workspace,0],{"conditions":["major_wound","dying"],"minutes_ago":5}));
capsule=(await pyMethod(kernel,"table",["capsule"],{}));
names=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(capsule,"pressures"))){if(pyBool(pyEqual(pyAt(p,"kind"),"clock"))){__rows.push([pyAt(p,"name"),p]);}}return __rows;})()));
dying="dying (unstabilized, CON per round)";
assert.ok(pyBool((await (async()=>{const __left=pyContains(names,dying);return pyBool(__left)?pyEqual(pyAt(pyAt(names,dying),"state"),"HP 0"):__left})())),"tests/kernel/test_capsule_nine.py:93 assert dying in names and names[dying][\"state\"] == \"HP 0\"");
assert.ok(pyBool(pyContains(pyAt(pyAt(capsule,"director"),"because"),"clock_near_full = True")),"tests/kernel/test_capsule_nine.py:94 assert \"clock_near_full = True\" in capsule[\"director\"][\"because\"]");
}
Object.defineProperty(test_clock_pressure_from_the_dying_clock_is_always_near_full,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_clock_pressure_from_the_dying_clock_is_always_near_full"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_clock_pressure_from_the_dying_clock_is_always_near_full(await kernel(t,{}));});
export async function test_threat_pressure_when_a_danger_names_a_present_npc(kernel:any){
let capsule:any,threats:any;
(await pyInvoke(open_turn,[kernel,"我们冲进地下室。"],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"pressures"))){if(pyBool(pyEqual(pyAt(p,"kind"),"threat"))){__rows.push(p);}}return __rows;})()),[])),"tests/kernel/test_capsule_nine.py:99 assert [p for p in kernel.table(\"capsule\")[\"pressures\"] if p[\"kind\"] == \"threat\"] == []");
(await pyInvoke(walk_to_confrontation,[kernel],{}));
capsule=(await pyMethod(kernel,"table",["capsule"],{}));
threats=(await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(capsule,"pressures"))){if(pyBool(pyEqual(pyAt(p,"kind"),"threat"))){__rows.push(p);}}return __rows;})());
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const t of pyIterable(threats)){__rows.push(pyAt(t,"name"));}return __rows;})()),["corbitt-haunting"])),"tests/kernel/test_capsule_nine.py:103 assert [t[\"name\"] for t in threats] == [\"corbitt-haunting\"]");
assert.ok(pyBool((await pyMethod(re,"fullmatch",["\\d+/\\d+",pyAt(pyAt(threats,0),"state")],{}))),"tests/kernel/test_capsule_nine.py:104 assert re.fullmatch(r\"\\d+/\\d+\", threats[0][\"state\"])");
assert.ok(pyBool(pyEqual(pyAt(pyAt(threats,0),"cue"),(await pyMethod("; ","join",[pyAt(pyAt(capsule,"where"),"pressure_moves")],{})))),"tests/kernel/test_capsule_nine.py:105 assert threats[0][\"cue\"] == \"; \".join(capsule[\"where\"][\"pressure_moves\"])");
}
Object.defineProperty(test_threat_pressure_when_a_danger_names_a_present_npc,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_threat_pressure_when_a_danger_names_a_present_npc"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_threat_pressure_when_a_danger_names_a_present_npc(await kernel(t,{}));});
export async function test_continuation_has_one_base_projection_until_answered(tmp_path:any){
let client:any,call_id:any,failed:any,offered:any,n:any,capsule:any,owed:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"})})));
try{(await pyInvoke(open_turn,[client,"我翻抽屉。"],{}));
const __unpack6237=(await pyInvoke(first_failure,[client,"t1-c"],{"intent":"investigate","goal":"找线索","method":"用侦查","skill":"Spot Hidden"}));call_id=__unpack6237[0];failed=__unpack6237[1];
offered=(await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(failed,"continuations"))){__rows.push(pyAt(c,"decision"));}return __rows;})());
assert.ok(pyBool(pyContains(offered,"push-luck:pushed-roll")),"tests/kernel/test_capsule_nine.py:114 assert \"push-luck:pushed-roll\" in offered");
n=pyAdd((await pyInvoke(pyInt,[pyAt((await pyMethod(call_id,"rsplit",["-c",1],{})),1)],{})),1);
(await pyInvoke(narrate,[client,`t1-c${n}`,"没找到。"],{}));
capsule=pyAt((await pyMethod(client,"table",["player_input"],{"text":"我再试试。"})),"capsule");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(capsule,"pressures"))){if(pyBool(pyEqual(pyAt(p,"kind"),"rule"))){__rows.push(p);}}return __rows;})()),[])),"tests/kernel/test_capsule_nine.py:118 assert [p for p in capsule[\"pressures\"] if p[\"kind\"] == \"rule\"] == []");
owed=(await (async()=>{const __rows:any[]=[];for(const o of pyIterable(pyAt(capsule,"obligations"))){if(pyBool(pyEqual(pyAt(o,"kind"),"continuation"))){__rows.push(o);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await (async()=>{const __rows:any[]=[];for(const o of pyIterable(owed)){__rows.push(pyAt(o,"name"));}return __rows;})()),offered);return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const o of pyIterable(owed)){__rows.push(pyEqual(pyAt(o,"who"),"player"));}return __rows;})()))):__left})())),"tests/kernel/test_capsule_nine.py:120 assert [o[\"name\"] for o in owed] == offered and all(o[\"who\"] == \"player\" for o in owed)");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const o of pyIterable(owed)){__rows.push((await (async()=>{const __left=pyEqual(pyAt(o,"state"),"optional: the player may take it up this turn; it lapses when they move on");return pyBool(__left)?(await pyMethod(pyAt(o,"cue"),"startswith",["needs action."],{})):__left})()));}return __rows;})())))),"tests/kernel/test_capsule_nine.py:121 assert all(o[\"state\"] == \"optional: the player may take it up this turn; it lapses when they move on\" and o[\"cue\"].startswith(\"needs action.\") for o in owed)");
(await pyMethod(client,"table",["resolve"],{"call_id":"t2-c1","action":({["intent"]:"investigate",["goal"]:"找线索",["method"]:"用侦查",["skill"]:"Spot Hidden",["push"]:true,["stakes"]:"抽屉卡住"})}));
capsule=(await pyMethod(client,"table",["capsule"],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(capsule,"pressures"))){if(pyBool(pyEqual(pyAt(p,"kind"),"rule"))){__rows.push(p);}}return __rows;})()),[])),"tests/kernel/test_capsule_nine.py:126 assert [p for p in capsule[\"pressures\"] if p[\"kind\"] == \"rule\"] == []");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const o of pyIterable(pyAt(capsule,"obligations"))){if(pyBool(pyEqual(pyAt(o,"kind"),"continuation"))){__rows.push(o);}}return __rows;})()),[])),"tests/kernel/test_capsule_nine.py:127 assert [o for o in capsule[\"obligations\"] if o[\"kind\"] == \"continuation\"] == []");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_continuation_has_one_base_projection_until_answered,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_continuation_has_one_base_projection_until_answered"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_continuation_has_one_base_projection_until_answered(temporary);});

export async function test_choice_obligation_from_the_pending_ask(kernel:any){
let obligations:any,choice:any;
(await pyInvoke(open_turn,[kernel,"我问他。"],{}));
(await pyMethod(kernel,"table",["ask"],{"call_id":"t1-c1","prompt":"收下钥匙吗？","options":["收下","拒绝"]}));
obligations=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"收下。"})),"capsule"),"obligations");
choice=(await pyNext((await (async()=>{const __rows:any[]=[];for(const o of pyIterable(obligations)){if(pyBool(pyEqual(pyAt(o,"kind"),"choice"))){__rows.push(o);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(await pyMethod(pyAt(choice,"name"),"startswith",["ask-"],{}));return pyBool(__left)?(await pyMethod(pyAt(choice,"name"),"endswith",["-t1"],{})):__left})())),"tests/kernel/test_capsule_nine.py:139 assert choice[\"name\"].startswith(\"ask-\") and choice[\"name\"].endswith(\"-t1\")");
assert.ok(pyBool(pyEqual(choice,({["kind"]:"choice",["name"]:pyAt(choice,"name"),["who"]:"player",["state"]:"pending",["cue"]:"收下钥匙吗？"}))),"tests/kernel/test_capsule_nine.py:140 assert choice == {\"kind\": \"choice\", \"name\": choice[\"name\"], \"who\": \"player\", \"state\": \"pending\", \"cue\": \"收下钥匙吗？\"}");
}
Object.defineProperty(test_choice_obligation_from_the_pending_ask,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_choice_obligation_from_the_pending_ask"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_choice_obligation_from_the_pending_ask(await kernel(t,{}));});
export async function test_session_obligation_from_a_live_combat(tmp_path:any){
let client:any,n:any,obligations:any,session:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"9"})})));
try{(await pyInvoke(open_turn,[client,"我举枪。"],{}));
n=(await pyInvoke(walk_to_confrontation,[client],{}));
(await pyInvoke(resolve,[client,`t1-c${n}`],{"intent":"combat","goal":"开枪","method":"用左轮射击","target":"Walter Corbitt","weapon":".38 Revolver"}));
obligations=pyAt((await pyMethod(client,"table",["capsule"],{})),"obligations");
session=(await pyNext((await (async()=>{const __rows:any[]=[];for(const o of pyIterable(obligations)){if(pyBool(pyEqual(pyAt(o,"kind"),"session"))){__rows.push(o);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(session,"name"),"combat");return pyBool(__left)?(await pyMethod(pyAt(session,"state"),"startswith",["round 1"],{})):__left})());return pyBool(__left)?pyContains(pyAt(session,"cue"),"combat:defend"):__left})())),"tests/kernel/test_capsule_nine.py:151 assert session[\"name\"] == \"combat\" and session[\"state\"].startswith(\"round 1\") and \"combat:defend\" in session[\"cue\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_session_obligation_from_a_live_combat,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_session_obligation_from_a_live_combat"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_session_obligation_from_a_live_combat(temporary);});
export async function test_quest_obligations_read_the_module_graph_and_the_discovered_clues(kernel:any){
let quests:any,world_path:any,world:any;
(await pyInvoke(open_turn,[kernel,"我们到了。"],{}));
quests=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const o of pyIterable(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"obligations"))){if(pyBool(pyEqual(pyAt(o,"kind"),"quest"))){__rows.push([pyAt(o,"name"),o]);}}return __rows;})()));
assert.ok(pyBool(pyEqual((await pyInvoke(pySet,[quests],{})),new Set(["End the Corbitt Threat","The Corbitt House Commission","Recover the Chapel Records"]))),"tests/kernel/test_capsule_nine.py:159 assert set(quests) == {\"End the Corbitt Threat\", \"The Corbitt House Commission\", \"Recover the Chapel Records\"}");
assert.ok(pyBool(pyEqual(pyAt(quests,"The Corbitt House Commission"),({["kind"]:"quest",["name"]:"The Corbitt House Commission",["state"]:"not started",["who"]:"Steven Knott",["cue"]:"core"}))),"tests/kernel/test_capsule_nine.py:160 assert quests[\"The Corbitt House Commission\"] == {\"kind\": \"quest\", \"name\": \"The Corbitt House Commission\", \"state\": \"not started\",\n                                                       \"who\": \"Steven Knott\", \"cue\": \"core\"}");
world_path=pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"world.json");
world=(await pyInvoke(read_json,[world_path],{}));
world["discovered_clues"]=["corbitt-body-found"];
(await pyMethod(world_path,"write_text",[(await pyMethod(json,"dumps",[world],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
quests=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const o of pyIterable(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"obligations"))){if(pyBool(pyEqual(pyAt(o,"kind"),"quest"))){__rows.push([pyAt(o,"name"),o]);}}return __rows;})()));
assert.ok(pyBool(pyEqual(pyAt(pyAt(quests,"The Corbitt House Commission"),"state"),"can close (1/1 clues)")),"tests/kernel/test_capsule_nine.py:167 assert quests[\"The Corbitt House Commission\"][\"state\"] == \"can close (1/1 clues)\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(quests,"End the Corbitt Threat"),"state"),"not started")),"tests/kernel/test_capsule_nine.py:168 assert quests[\"End the Corbitt Threat\"][\"state\"] == \"not started\"");
}
Object.defineProperty(test_quest_obligations_read_the_module_graph_and_the_discovered_clues,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_quest_obligations_read_the_module_graph_and_the_discovered_clues"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_quest_obligations_read_the_module_graph_and_the_discovered_clues(await kernel(t,{}));});

export async function lines(style:any){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(style,"directives"))){__rows.push([pyAt(row,"id"),pyAt(row,"line")]);}return __rows;})()));
}
Object.defineProperty(lines,"__pySignature",{value:[{"name":"style","rest":false,"varargs":false}]});
export async function test_the_style_provider_sends_every_directive_on_the_first_turn_and_the_beats_after(kernel:any){
let first:any,style:any,later:any,beat:any;
first=pyAt((await pyInvoke(open_turn,[kernel,"我仔细观察诺特。"],{})),"capsule");
style=pyAt(first,"style");
assert.ok(pyBool((await (async()=>{const __left=pyAt(PROVIDER,"version");return pyBool(__left)?pyContains(pyAt(PROVIDER,"requires"),"context.style.v1"):__left})())),"tests/kernel/test_capsule_nine.py:180 assert PROVIDER[\"version\"] and \"context.style.v1\" in PROVIDER[\"requires\"]");
assert.ok(pyBool(pyEqual((await pyInvoke(pyList,[style],{})),["language","register","axes","directives","floor"])),"tests/kernel/test_capsule_nine.py:181 assert list(style) == [\"language\", \"register\", \"axes\", \"directives\", \"floor\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(style,"language"),"zh-Hans");return pyBool(__left)?pyEqual(pyAt(style,"register"),"purist"):__left})())),"tests/kernel/test_capsule_nine.py:182 assert style[\"language\"] == \"zh-Hans\" and style[\"register\"] == \"purist\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(style,"axes"),pyAt(STYLE,"axes"));return pyBool(__left)?pyEqual(pyAt(style,"floor"),pyAt(STYLE,"floor")):__left})())),"tests/kernel/test_capsule_nine.py:183 assert style[\"axes\"] == STYLE[\"axes\"] and style[\"floor\"] == STYLE[\"floor\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const d of pyIterable(pyAt(style,"directives"))){__rows.push(pyAt(d,"id"));}return __rows;})()),ALL_DIRECTIVES)),"tests/kernel/test_capsule_nine.py:185 assert [d[\"id\"] for d in style[\"directives\"]] == ALL_DIRECTIVES");
assert.ok(pyBool(pyEqual((await pyInvoke(lines,[style],{})),Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [id_,entry] of pyIterable((await pyMethod(pyAt(STYLE,"directives"),"items",[],{})))){__rows.push([id_,pyAt(entry,"full")]);}return __rows;})())))),"tests/kernel/test_capsule_nine.py:186 assert lines(style) == {id_: entry[\"full\"] for id_, entry in STYLE[\"directives\"].items()}");
assert.ok(pyBool((await (async()=>{const __left=!pyContains((await pyMethod(first,"get",["truncated",[]],{})),"style");return pyBool(__left)?pyLessEqual((await pyInvoke(size,[style],{})),2048):__left})())),"tests/kernel/test_capsule_nine.py:187 assert \"style\" not in first.get(\"truncated\", []) and size(style) <= 2048");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"style"),style)),"tests/kernel/test_capsule_nine.py:188 assert kernel.table(\"capsule\")[\"style\"] == style");
(await pyInvoke(narrate,[kernel,"t1-c1","……"],{}));
later=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"继续。"})),"capsule");
beat=pyAt(pyAt(later,"director"),"beat");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const d of pyIterable(pyAt(pyAt(later,"style"),"directives"))){__rows.push(pyAt(d,"id"));}return __rows;})()),pyAt(pyAt(STYLE,"beats"),beat))),"tests/kernel/test_capsule_nine.py:193 assert [d[\"id\"] for d in later[\"style\"][\"directives\"]] == STYLE[\"beats\"][beat]");
assert.ok(pyBool(pyEqual((await pyInvoke(lines,[pyAt(later,"style")],{})),Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const id_ of pyIterable(pyAt(pyAt(STYLE,"beats"),beat))){__rows.push([id_,pyAt(pyAt(pyAt(STYLE,"directives"),id_),"brief")]);}return __rows;})())))),"tests/kernel/test_capsule_nine.py:194 assert lines(later[\"style\"]) == {id_: STYLE[\"directives\"][id_][\"brief\"] for id_ in STYLE[\"beats\"][beat]}");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(later,"style"),"axes"),pyAt(STYLE,"axes"));return pyBool(__left)?pyEqual(pyAt(pyAt(later,"style"),"floor"),pyAt(STYLE,"floor")):__left})())),"tests/kernel/test_capsule_nine.py:195 assert later[\"style\"][\"axes\"] == STYLE[\"axes\"] and later[\"style\"][\"floor\"] == STYLE[\"floor\"]");
assert.ok(pyBool((await (async()=>{const __left=!pyContains((await pyMethod(later,"get",["truncated",[]],{})),"style");return pyBool(__left)?pyLessEqual((await pyInvoke(size,[pyAt(later,"style")],{})),1536):__left})())),"tests/kernel/test_capsule_nine.py:196 assert \"style\" not in later.get(\"truncated\", []) and size(later[\"style\"]) <= 1536");
}
Object.defineProperty(test_the_style_provider_sends_every_directive_on_the_first_turn_and_the_beats_after,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_style_provider_sends_every_directive_on_the_first_turn_and_the_beats_after"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_style_provider_sends_every_directive_on_the_first_turn_and_the_beats_after(await kernel(t,{}));});
export async function test_without_a_provider_style_is_the_language_and_the_register(kernel:any){
let listed:any,first:any,later:any;
(await pyInvoke(create_campaign,[kernel],{}));
listed=(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:"narration-craft",["enabled"]:false})],{}));
assert.ok(pyBool(!pyBool(pyAt(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(listed,"mods"))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"id"),"narration-craft");return pyBool(__left)?pyAt(row,"active"):__left})()))){__rows.push(row);}}return __rows;})()))),"active"),"enabled"))),"tests/kernel/test_capsule_nine.py:202 assert not next(row for row in listed[\"mods\"] if row[\"id\"] == \"narration-craft\" and row[\"active\"])[\"active\"][\"enabled\"]");
(await pyInvoke(narrate_opening,[kernel],{}));
first=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我看看。"})),"capsule");
assert.ok(pyBool(pyEqual(pyAt(first,"style"),({["language"]:"zh-Hans",["register"]:"purist"}))),"tests/kernel/test_capsule_nine.py:205 assert first[\"style\"] == {\"language\": \"zh-Hans\", \"register\": \"purist\"}");
assert.ok(pyBool(!pyContains((await pyMethod(first,"get",["truncated",[]],{})),"style")),"tests/kernel/test_capsule_nine.py:206 assert \"style\" not in first.get(\"truncated\", [])");
(await pyInvoke(narrate,[kernel,"t1-c1","……"],{}));
later=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"继续。"})),"capsule");
assert.ok(pyBool(pyEqual(pyAt(later,"style"),({["language"]:"zh-Hans",["register"]:"purist"}))),"tests/kernel/test_capsule_nine.py:209 assert later[\"style\"] == {\"language\": \"zh-Hans\", \"register\": \"purist\"}");
assert.ok(pyBool(!pyContains((await pyMethod(later,"get",["truncated",[]],{})),"style")),"tests/kernel/test_capsule_nine.py:210 assert \"style\" not in later.get(\"truncated\", [])");
}
Object.defineProperty(test_without_a_provider_style_is_the_language_and_the_register,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_without_a_provider_style_is_the_language_and_the_register"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_without_a_provider_style_is_the_language_and_the_register(await kernel(t,{}));});
export async function legacy_craft(kernel:any,tmp_path:any){
let path:any,manifest:any;

path=pyDivide(tmp_path,"narration-craft-legacy");
(await pyMethod(shutil,"copytree",[pyDivide(pyDivide(WORKTREE,"mods"),"narration-craft"),path],{}));
manifest=(await pyInvoke(read_json,[pyDivide(path,"mod.json")],{}));
manifest["version"]="1.99.0";
manifest["requires"]=(await (async()=>{const __rows:any[]=[];for(const req of pyIterable(pyAt(manifest,"requires"))){if(pyBool(!pyEqual(req,"context.style.v1"))){__rows.push(req);}}return __rows;})());
manifest["package_files"]=(await (async()=>{const __rows:any[]=[];for(const name of pyIterable(pyAt(manifest,"package_files"))){if(pyBool(!pyEqual(name,pyAt(pyAt(manifest,"contributes"),"style")))){__rows.push(name);}}return __rows;})());
(await pyMethod((pyDivide(path,(await pyMethod(pyAt(manifest,"contributes"),"pop",["style"],{})))),"unlink",[],{}));
(await pyMethod((pyDivide(path,"mod.json")),"write_text",[(await pyMethod(json,"dumps",[manifest],{}))],{"encoding":"utf-8"}));
(await pyMethod(kernel,"ok",["mods.install",({["path"]:(await pyInvoke(pyStr,[path],{}))})],{}));
return pyAt(manifest,"version");
}
Object.defineProperty(legacy_craft,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
export async function test_a_legacy_narration_craft_lock_keeps_the_base_lines_it_was_played_with(kernel:any,tmp_path:any){
let legacy:any,version:any,first:any,style:any,later:any,beat:any,bare:any;

legacy=(await pyInvoke(read_json,[pyDivide(pyDivide(pyDivide(WORKTREE,"content"),"craft"),"legacy-style.json")],{}));
version=(await pyInvoke(legacy_craft,[kernel,tmp_path],{}));
(await pyInvoke(create_campaign,[kernel],{}));
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:"narration-craft",["version"]:version,["enabled"]:true})],{}));
(await pyInvoke(narrate_opening,[kernel],{}));
first=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我仔细观察诺特。"})),"capsule");
style=pyAt(first,"style");
assert.ok(pyBool(pyEqual((await pyInvoke(pyList,[style],{})),["language","register","axes","directives","floor"])),"tests/kernel/test_capsule_nine.py:237 assert list(style) == [\"language\", \"register\", \"axes\", \"directives\", \"floor\"]");
assert.ok(pyBool(pyEqual(pyAt(style,"axes"),(await (async()=>{const __rows:any[]=[];for(const axis of pyIterable(pyAt(legacy,"axes"))){if(pyBool(pyContains(["all","zh-Hans"],pyAt(axis,"language")))){__rows.push(pyAt(axis,"line"));}}return __rows;})()))),"tests/kernel/test_capsule_nine.py:238 assert style[\"axes\"] == [axis[\"line\"] for axis in legacy[\"axes\"] if axis[\"language\"] in (\"all\", \"zh-Hans\")]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const d of pyIterable(pyAt(style,"directives"))){__rows.push(pyAt(d,"id"));}return __rows;})()),(await pyInvoke(pyList,[pyAt(legacy,"directives")],{})))),"tests/kernel/test_capsule_nine.py:239 assert [d[\"id\"] for d in style[\"directives\"]] == list(legacy[\"directives\"])");
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyInvoke(lines,[style],{})),pyAt(legacy,"directives"));return pyBool(__left)?pyEqual(pyAt(style,"floor"),pyAt(legacy,"floor")):__left})())),"tests/kernel/test_capsule_nine.py:240 assert lines(style) == legacy[\"directives\"] and style[\"floor\"] == legacy[\"floor\"]");
assert.ok(pyBool((await (async()=>{const __left=!pyContains((await pyMethod(first,"get",["truncated",[]],{})),"style");return pyBool(__left)?pyLessEqual((await pyInvoke(size,[style],{})),2048):__left})())),"tests/kernel/test_capsule_nine.py:241 assert \"style\" not in first.get(\"truncated\", []) and size(style) <= 2048");
(await pyInvoke(narrate,[kernel,"t1-c1","……"],{}));
later=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"继续。"})),"capsule");
beat=pyAt(pyAt(later,"director"),"beat");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const d of pyIterable(pyAt(pyAt(later,"style"),"directives"))){__rows.push(pyAt(d,"id"));}return __rows;})()),pyAt(pyAt(legacy,"beats"),beat))),"tests/kernel/test_capsule_nine.py:245 assert [d[\"id\"] for d in later[\"style\"][\"directives\"]] == legacy[\"beats\"][beat]");
assert.ok(pyBool((await (async()=>{const __left=!pyContains((await pyMethod(later,"get",["truncated",[]],{})),"style");return pyBool(__left)?pyLessEqual((await pyInvoke(size,[pyAt(later,"style")],{})),1536):__left})())),"tests/kernel/test_capsule_nine.py:246 assert \"style\" not in later.get(\"truncated\", []) and size(later[\"style\"]) <= 1536");
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:"narration-craft",["enabled"]:false})],{}));
(await pyInvoke(narrate,[kernel,"t2-c1","……"],{}));
bare=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"再看看。"})),"capsule");
assert.ok(pyBool(pyEqual(pyAt(bare,"style"),({["language"]:"zh-Hans",["register"]:"purist"}))),"tests/kernel/test_capsule_nine.py:250 assert bare[\"style\"] == {\"language\": \"zh-Hans\", \"register\": \"purist\"}");
}
Object.defineProperty(test_a_legacy_narration_craft_lock_keeps_the_base_lines_it_was_played_with,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_legacy_narration_craft_lock_keeps_the_base_lines_it_was_played_with"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_legacy_narration_craft_lock_keeps_the_base_lines_it_was_played_with(await kernel(t,{}),temporary);});
export async function test_the_legacy_table_keeps_its_language_only_axis_to_that_language(tmp_path:any){
let client:any,legacy:any,version:any,style:any;
client=(new RpcClient(pyDivide(tmp_path,"ws")));
try{legacy=(await pyInvoke(read_json,[pyDivide(pyDivide(pyDivide(WORKTREE,"content"),"craft"),"legacy-style.json")],{}));
version=(await pyInvoke(legacy_craft,[client,tmp_path],{}));
(await pyMethod(client,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["pregen"]:"thomas-hayes",["play_language"]:"en"})],{}));
(await pyMethod(client,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:"narration-craft",["version"]:version,["enabled"]:true})],{}));
(await pyInvoke(narrate_opening,[client],{}));
style=pyAt(pyAt((await pyMethod(client,"table",["player_input"],{"text":"I look around."})),"capsule"),"style");
assert.ok(pyBool(pyEqual(pyAt(style,"axes"),(await (async()=>{const __rows:any[]=[];for(const axis of pyIterable(pyAt(legacy,"axes"))){if(pyBool(pyEqual(pyAt(axis,"language"),"all"))){__rows.push(pyAt(axis,"line"));}}return __rows;})()))),"tests/kernel/test_capsule_nine.py:262 assert style[\"axes\"] == [axis[\"line\"] for axis in legacy[\"axes\"] if axis[\"language\"] == \"all\"]");
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[pyAt(style,"axes")],{})),pySubtract((await pyInvoke(pyLen,[pyAt(legacy,"axes")],{})),1))),"tests/kernel/test_capsule_nine.py:263 assert len(style[\"axes\"]) == len(legacy[\"axes\"]) - 1");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_the_legacy_table_keeps_its_language_only_axis_to_that_language,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_legacy_table_keeps_its_language_only_axis_to_that_language"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_legacy_table_keeps_its_language_only_axis_to_that_language(temporary);});
export async function test_a_style_package_that_would_not_fit_is_refused_when_the_catalog_loads(kernel:any,tmp_path:any){
let fixture:any,manifest:any,error:any,placed:any,listed:any,refused:any,broken:any,style:any,capsule:any;
fixture=pyDivide(FIXTURES,"style-overflow");
manifest=(await pyInvoke(read_json,[pyDivide(fixture,"mod.json")],{}));
error=(await pyMethod(kernel,"err",["mods.install",({["path"]:(await pyInvoke(pyStr,[fixture],{}))})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_capsule_nine.py:273 assert error[\"code\"] == \"invalid_params\"");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyContains(pyAt(error,"message"),"REVEAL");return pyBool(__left)?pyContains(pyAt(error,"message"),"1536"):__left})());return pyBool(__left)?pyContains(pyAt(error,"message"),"over"):__left})())),"tests/kernel/test_capsule_nine.py:274 assert \"REVEAL\" in error[\"message\"] and \"1536\" in error[\"message\"] and \"over\" in error[\"message\"]");
assert.ok(pyBool(!pyContains(pyAt(error,"message"),"PRESSURE")),"tests/kernel/test_capsule_nine.py:275 assert \"PRESSURE\" not in error[\"message\"]");
assert.ok(pyBool(pyLess(0,pyAt(pyAt(pyAt(error,"details"),"over"),"REVEAL"))),"tests/kernel/test_capsule_nine.py:276 assert error[\"details\"][\"over\"][\"REVEAL\"] > 0");
placed=pyDivide(pyDivide(pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"mods"),"packages"),pyAt(manifest,"id")),pyAt(manifest,"version"));
(await pyMethod(shutil,"copytree",[fixture,placed],{}));
listed=(await pyMethod(kernel,"ok",["mods.list",({})],{}));
assert.ok(pyBool(!pyContains(new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(listed,"mods"))){__rows.push(pyAt(row,"id"));}return __rows;})())),pyAt(manifest,"id"))),"tests/kernel/test_capsule_nine.py:281 assert manifest[\"id\"] not in {row[\"id\"] for row in listed[\"mods\"]}");
refused=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(listed,"unavailable"))){if(pyBool(pyEqual(pyAt(row,"id"),pyAt(manifest,"id")))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(refused,"version"),pyAt(manifest,"version"));return pyBool(__left)?pyContains(pyAt(refused,"reason"),"REVEAL"):__left})())),"tests/kernel/test_capsule_nine.py:283 assert refused[\"version\"] == manifest[\"version\"] and \"REVEAL\" in refused[\"reason\"]");
broken=pyDivide(tmp_path,"style-unknown");
(await pyMethod(shutil,"copytree",[fixture,broken],{}));
style=(await pyInvoke(read_json,[pyDivide(broken,"style.json")],{}));
pyAt(style,"beats")["REVEAL"]=["plain","write-purple-prose"];
(await pyMethod((pyDivide(broken,"style.json")),"write_text",[(await pyMethod(json,"dumps",[style],{}))],{"encoding":"utf-8"}));
manifest["id"]="style-unknown";
(await pyMethod((pyDivide(broken,"mod.json")),"write_text",[(await pyMethod(json,"dumps",[manifest],{}))],{"encoding":"utf-8"}));
error=(await pyMethod(kernel,"err",["mods.install",({["path"]:(await pyInvoke(pyStr,[broken],{}))})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(error,"message"),"write-purple-prose"):__left})())),"tests/kernel/test_capsule_nine.py:293 assert error[\"code\"] == \"invalid_params\" and \"write-purple-prose\" in error[\"message\"]");
capsule=pyAt((await pyInvoke(open_turn,[kernel,"我看看。"],{})),"capsule");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const d of pyIterable(pyAt(pyAt(capsule,"style"),"directives"))){__rows.push(pyAt(d,"id"));}return __rows;})()),ALL_DIRECTIVES)),"tests/kernel/test_capsule_nine.py:296 assert [d[\"id\"] for d in capsule[\"style\"][\"directives\"]] == ALL_DIRECTIVES");
}
Object.defineProperty(test_a_style_package_that_would_not_fit_is_refused_when_the_catalog_loads,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_style_package_that_would_not_fit_is_refused_when_the_catalog_loads"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_style_package_that_would_not_fit_is_refused_when_the_catalog_loads(await kernel(t,{}),temporary);});
export async function test_only_one_style_provider_is_enabled_at_a_time(kernel:any,tmp_path:any){
let second:any,second_style:any,error:any,third:any,style:any;
second=(await pyInvoke(read_json,[pyDivide(pyDivide(FIXTURES,"style-second"),"mod.json")],{}));
second_style=(await pyInvoke(read_json,[pyDivide(pyDivide(FIXTURES,"style-second"),"style.json")],{}));
(await pyMethod(kernel,"ok",["mods.install",({["path"]:(await pyInvoke(pyStr,[pyDivide(FIXTURES,"style-second")],{}))})],{}));
(await pyInvoke(create_campaign,[kernel],{}));
error=(await pyMethod(kernel,"err",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:pyAt(second,"id"),["enabled"]:true})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(error,"message"),"narration-craft"):__left})())),"tests/kernel/test_capsule_nine.py:305 assert error[\"code\"] == \"invalid_params\" and \"narration-craft\" in error[\"message\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(error,"details"),"provider"),"mod"),"narration-craft")),"tests/kernel/test_capsule_nine.py:306 assert error[\"details\"][\"provider\"][\"mod\"] == \"narration-craft\"");
error=(await pyMethod(kernel,"err",["mods.defaults",({["id"]:pyAt(second,"id"),["enabled"]:true})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(error,"message"),"narration-craft"):__left})())),"tests/kernel/test_capsule_nine.py:309 assert error[\"code\"] == \"invalid_params\" and \"narration-craft\" in error[\"message\"]");
third=pyDivide(tmp_path,"style-third");
(await pyMethod(shutil,"copytree",[pyDivide(FIXTURES,"style-second"),third],{}));
(await pyMethod((pyDivide(third,"mod.json")),"write_text",[(await pyMethod(json,"dumps",[({...second,["id"]:"style-third",["default_enabled"]:true})],{}))],{"encoding":"utf-8"}));
error=(await pyMethod(kernel,"err",["mods.install",({["path"]:(await pyInvoke(pyStr,[third],{}))})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(error,"details"),"provider"),"mod"),"narration-craft"):__left})())),"tests/kernel/test_capsule_nine.py:314 assert error[\"code\"] == \"invalid_params\" and error[\"details\"][\"provider\"][\"mod\"] == \"narration-craft\"");
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:"narration-craft",["enabled"]:false})],{}));
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:pyAt(second,"id"),["enabled"]:true})],{}));
(await pyInvoke(narrate_opening,[kernel],{}));
style=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我看看。"})),"capsule"),"style");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const d of pyIterable(pyAt(style,"directives"))){__rows.push(pyAt(d,"id"));}return __rows;})()),(await pyInvoke(pyList,[pyAt(second_style,"directives")],{})))),"tests/kernel/test_capsule_nine.py:320 assert [d[\"id\"] for d in style[\"directives\"]] == list(second_style[\"directives\"])");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(style,"axes"),pyAt(second_style,"axes"));return pyBool(__left)?pyEqual(pyAt(style,"floor"),pyAt(second_style,"floor")):__left})())),"tests/kernel/test_capsule_nine.py:321 assert style[\"axes\"] == second_style[\"axes\"] and style[\"floor\"] == second_style[\"floor\"]");
error=(await pyMethod(kernel,"err",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:"narration-craft",["enabled"]:true})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(error,"details"),"provider"),"mod"),pyAt(second,"id")):__left})())),"tests/kernel/test_capsule_nine.py:323 assert error[\"code\"] == \"invalid_params\" and error[\"details\"][\"provider\"][\"mod\"] == second[\"id\"]");
}
Object.defineProperty(test_only_one_style_provider_is_enabled_at_a_time,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_only_one_style_provider_is_enabled_at_a_time"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_only_one_style_provider_is_enabled_at_a_time(await kernel(t,{}),temporary);});
export async function test_a_new_process_starts_over_with_the_full_directives(tmp_path:any){
let first:any,later:any,second:any;
first=(new RpcClient(pyDivide(tmp_path,"ws")));
try{(await pyInvoke(open_turn,[first,"我看看。"],{}));
(await pyInvoke(narrate,[first,"t1-c1","……"],{}));
later=pyAt((await pyMethod(first,"table",["player_input"],{"text":"继续。"})),"capsule");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const d of pyIterable(pyAt(pyAt(later,"style"),"directives"))){__rows.push(pyAt(d,"id"));}return __rows;})()),pyAt(pyAt(STYLE,"beats"),pyAt(pyAt(later,"director"),"beat")))),"tests/kernel/test_capsule_nine.py:332 assert [d[\"id\"] for d in later[\"style\"][\"directives\"]] == STYLE[\"beats\"][later[\"director\"][\"beat\"]]");}finally{(await pyMethod(first,"close",[],{}));}
second=(new RpcClient(pyDivide(tmp_path,"ws")));
try{assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(second,"table",["open"],{})),"turn"),"number"),2)),"tests/kernel/test_capsule_nine.py:337 assert second.table(\"open\")[\"turn\"][\"number\"] == 2");
(await pyInvoke(narrate,[second,"t2-c1","……"],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const d of pyIterable(pyAt(pyAt(pyAt((await pyMethod(second,"table",["player_input"],{"text":"再来。"})),"capsule"),"style"),"directives"))){__rows.push(pyAt(d,"id"));}return __rows;})()),ALL_DIRECTIVES)),"tests/kernel/test_capsule_nine.py:339 assert [d[\"id\"] for d in second.table(\"player_input\", text=\"再来。\")[\"capsule\"][\"style\"][\"directives\"]] == ALL_DIRECTIVES");}finally{(await pyMethod(second,"close",[],{}));}
}
Object.defineProperty(test_a_new_process_starts_over_with_the_full_directives,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_new_process_starts_over_with_the_full_directives"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_new_process_starts_over_with_the_full_directives(temporary);});
export async function test_register_is_a_campaign_setting_from_the_text_graph(kernel:any){
let error:any;
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["pregen"]:"thomas-hayes",["register"]:"pulp"})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"table",["open"],{})),"campaign"),"register"),"pulp")),"tests/kernel/test_capsule_nine.py:346 assert kernel.table(\"open\")[\"campaign\"][\"register\"] == \"pulp\"");
(await pyInvoke(narrate_opening,[kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"上。"})),"capsule"),"style"),"register"),"pulp")),"tests/kernel/test_capsule_nine.py:348 assert kernel.table(\"player_input\", text=\"上。\")[\"capsule\"][\"style\"][\"register\"] == \"pulp\"");
error=(await pyMethod(kernel,"err",["campaign.create",({["id"]:"c2",["module"]:"the-haunting",["pregen"]:"thomas-hayes",["register"]:"gonzo"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(error,"fix"),"purist"):__left})())),"tests/kernel/test_capsule_nine.py:350 assert error[\"code\"] == \"invalid_params\" and \"purist\" in error[\"fix\"]");
}
Object.defineProperty(test_register_is_a_campaign_setting_from_the_text_graph,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_register_is_a_campaign_setting_from_the_text_graph"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_register_is_a_campaign_setting_from_the_text_graph(await kernel(t,{}));});
export async function test_the_provider_lines_are_the_same_for_every_play_language(tmp_path:any){
let client:any,capsule:any,style:any;
client=(new RpcClient(pyDivide(tmp_path,"ws")));
try{(await pyMethod(client,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["pregen"]:"thomas-hayes",["play_language"]:"en"})],{}));
(await pyInvoke(narrate_opening,[client],{}));
capsule=pyAt((await pyMethod(client,"table",["player_input"],{"text":"I look around."})),"capsule");
style=pyAt(capsule,"style");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(style,"language"),"en");return pyBool(__left)?pyEqual(pyAt(style,"axes"),pyAt(STYLE,"axes")):__left})());return pyBool(__left)?pyEqual(pyAt(style,"floor"),pyAt(STYLE,"floor")):__left})())),"tests/kernel/test_capsule_nine.py:361 assert style[\"language\"] == \"en\" and style[\"axes\"] == STYLE[\"axes\"] and style[\"floor\"] == STYLE[\"floor\"]");
assert.ok(pyBool((await (async()=>{const __left=pyLessEqual((await pyInvoke(size,[style],{})),2048);return pyBool(__left)?!pyContains((await pyMethod(capsule,"get",["truncated",[]],{})),"style"):__left})())),"tests/kernel/test_capsule_nine.py:362 assert size(style) <= 2048 and \"style\" not in capsule.get(\"truncated\", [])");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const d of pyIterable(pyAt(style,"directives"))){__rows.push(pyAt(d,"id"));}return __rows;})()),ALL_DIRECTIVES)),"tests/kernel/test_capsule_nine.py:363 assert [d[\"id\"] for d in style[\"directives\"]] == ALL_DIRECTIVES");
assert.ok(pyBool((await pyMethod(pyAt(capsule,"head"),"startswith",["Everything at the start of this turn"],{}))),"tests/kernel/test_capsule_nine.py:364 assert capsule[\"head\"].startswith(\"Everything at the start of this turn\")");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_the_provider_lines_are_the_same_for_every_play_language,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_provider_lines_are_the_same_for_every_play_language"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_provider_lines_are_the_same_for_every_play_language(temporary);});

export async function test_the_memory_section_is_trimmed_from_its_tail_and_named_in_truncated(kernel:any){
let job_id:any,capsule:any,name:any,budget:any;
(await pyInvoke(open_turn,[kernel,"我和诺特谈。"],{}));
job_id=pyAt(pyAt((await pyInvoke(narrate,[kernel,"t1-c1","谈了很久。"],{})),"extraction"),"job_id");
(await pyMethod(kernel,"ok",["memory.submit",({["campaign"]:CAMPAIGN,["job_id"]:job_id,["candidates"]:(await (async()=>{const __rows:any[]=[];for(const i of pyIterable((await pyInvoke(pyRange,[6],{})))){__rows.push(({["kind"]:"knowledge",["subject"]:"Steven Knott",["statement"]:pyAdd(`${i}`,pyMultiply("诺特说的话很长，",40))}));}return __rows;})())})],{}));
capsule=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"继续。"})),"capsule");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(capsule,"truncated"),"memory");return pyBool(__left)?pyLessEqual((await pyInvoke(size,[pyAt(capsule,"memory")],{})),pyAt(BUDGETS,"memory")):__left})())),"tests/kernel/test_capsule_nine.py:377 assert \"memory\" in capsule[\"truncated\"] and size(capsule[\"memory\"]) <= BUDGETS[\"memory\"]");
assert.ok(pyBool((await (async()=>{const __term0=0;const __term1=(await pyInvoke(pyLen,[pyAt(capsule,"memory")],{}));const __term2=6;return pyCompare(__term0,__term1,"<")&&pyCompare(__term1,__term2,"<");})())),"tests/kernel/test_capsule_nine.py:378 assert 0 < len(capsule[\"memory\"]) < 6");
for([name,budget] of pyIterable((await pyMethod(BUDGETS,"items",[],{})))){
if(pyBool(!pyEqual(name,"style"))){assert.ok(pyBool(pyLessEqual((await pyInvoke(size,[pyAt(capsule,name)],{})),budget)),pyStr(name));}
}
}
Object.defineProperty(test_the_memory_section_is_trimmed_from_its_tail_and_named_in_truncated,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_memory_section_is_trimmed_from_its_tail_and_named_in_truncated"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_memory_section_is_trimmed_from_its_tail_and_named_in_truncated(await kernel(t,{}));});
export async function test_the_capsule_stays_keeper_only(kernel:any){
let result:any,narrated:any,transcript:any;

result=(await pyInvoke(open_turn,[kernel,"我看看四周。"],{}));
narrated=(await pyInvoke(narrate,[kernel,"t1-c1","办公室很安静。"],{}));
transcript=(await pyMethod((pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"transcript.jsonl")),"read_text",[],{"encoding":"utf-8"}));
assert.ok(pyBool((await (async()=>{const __left=!pyContains(transcript,pyAt(pyAt(result,"capsule"),"head"));return pyBool(__left)?!pyContains(transcript,"grounded_by"):__left})())),"tests/kernel/test_capsule_nine.py:389 assert result[\"capsule\"][\"head\"] not in transcript and \"grounded_by\" not in transcript");
assert.ok(pyBool(!pyContains(pyAt(narrated,"rendered_text"),"director")),"tests/kernel/test_capsule_nine.py:390 assert \"director\" not in narrated[\"rendered_text\"]");
}
Object.defineProperty(test_the_capsule_stays_keeper_only,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_capsule_stays_keeper_only"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_capsule_stays_keeper_only(await kernel(t,{}));});
