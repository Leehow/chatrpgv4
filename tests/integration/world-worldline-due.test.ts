// Migrated from tests/kernel/test_worldline_due.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {MODULE,RpcClient,campaign_dir,create_campaign,narrate,narrate_opening,read_json,CONFRONTATION_PATH,resolve,resolve_err,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
import {loop_content,meta_of} from "./world-worldline.test.ts";
const __file__=new URL('../../tests/kernel/test_worldline_due.py',import.meta.url).pathname;







export let INVESTIGATOR:any="thomas-hayes";


export let ELAPSED:any=480;
export async function sanity_state(client:any){
let path:any;

path=pyDivide(pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"save"),"sanity-state"),`${INVESTIGATOR}.json`);
return (pyBool((await pyMethod(path,"exists",[],{})))?(await pyInvoke(read_json,[path],{})):({}));
}
Object.defineProperty(sanity_state,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function world_of(client:any){
return (await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"world.json")],{}));
}
Object.defineProperty(world_of,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function clock_of(client:any){
return (await pyInvoke(pyInt,[(await (async()=>{const __left=(await pyMethod(((await (async()=>{const __left=(await pyMethod((await pyInvoke(world_of,[client],{})),"get",["clock"],{}));return pyBool(__left)?__left:({})})())),"get",["minutes"],{}));return pyBool(__left)?__left:0})())],{}));
}
Object.defineProperty(clock_of,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function sheet_of(client:any){
return (await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"party"),`${INVESTIGATOR}.json`)],{}));
}
Object.defineProperty(sheet_of,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function healing_state(client:any){
let path:any;
path=pyDivide(pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"save"),"healing-state"),`${INVESTIGATOR}.json`);
return (pyBool((await pyMethod(path,"exists",[],{})))?(await pyInvoke(read_json,[path],{})):({}));
}
Object.defineProperty(healing_state,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function loop_content_anchored_at(tmp_path:any,scene:any,reset:any){
let root:any,path:any,graph:any,relation:any;

root=(await pyInvoke(loop_content,[tmp_path],{"reset":reset}));
path=pyDivide(pyDivide(pyDivide(root,"starters"),MODULE),"module-graph.json");
graph=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))],{}));
for(relation of pyIterable(pyAt(graph,"relations"))){
if(pyBool(pyEqual(pyAt(relation,"relation_kind"),"resets-to"))){relation["to_node_id"]=`scene-${scene}`;}
}
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[graph],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
return root;
}
Object.defineProperty(loop_content_anchored_at,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false},{"name":"scene","rest":false,"varargs":false},{"name":"reset","rest":false,"varargs":false}]});
export async function engine_saves(client:any){
let root:any;

root=pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"save");
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const path of pyIterable((await pyInvoke(pySorted,[(await pyMethod(root,"rglob",["*"],{}))],{})))){if(pyBool((await (async()=>{const __left=(await pyMethod(path,"is_file",[],{}));return pyBool(__left)?!pyContains(["worldlines","continuation"],pyAt(path.parts,(-2))):__left})()))){__rows.push([(await pyInvoke(pyStr,[(await pyMethod(path,"relative_to",[root],{}))],{})),(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))]);}}return __rows;})()));
}
Object.defineProperty(engine_saves,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function play_into_temporary_insanity(client:any){
let index:any,scene:any,ordinal:any,checked:any,_:any;

(await pyInvoke(create_campaign,[client],{}));
(await pyInvoke(narrate_opening,[client],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我们花了一整天打听，然后去老宅。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:ELAPSED})]}));
for([index,scene] of pyIterable((await pyInvoke(pyEnumerate,[CONFRONTATION_PATH],{"start":2})))){
(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${index}`,"effects":[({["kind"]:"move",["to"]:scene,["travel_minutes"]:0})]}));
}
ordinal=pyAdd(2,(await pyInvoke(pyLen,[CONFRONTATION_PATH],{})));
checked=(await pyInvoke(resolve,[client,`t1-c${ordinal}`],{"intent":"investigate","goal":"看见科比特的尸体动了","method":"","target":"Walter Corbitt","decision":"sanity:check","involuntary":({["kind"]:"freeze",["summary"]:"手电筒的光柱僵在原地"})}));
assert.ok(pyBool((pyAt(pyAt(checked,"outcome"),"temporary_insane")===true)),"tests/kernel/test_worldline_due.py:98 assert checked[\"outcome\"][\"temporary_insane\"] is True");
ordinal+=1;
for(_ of pyIterable((await pyInvoke(pyRange,[10],{})))){
if(pyBool(!pyBool((await pyMethod((await pyInvoke(sanity_state,[client],{})),"get",["bout_active"],{}))))){break;}
(await pyInvoke(resolve,[client,`t1-c${ordinal}`],{"intent":"montage","goal":"等这阵过去","method":"","decision":"sanity:bout-end"}));
ordinal+=1;
}
(await pyInvoke(narrate,[client,`t1-c${ordinal}`,"他坐了起来，你僵在原地。"],{}));
}
Object.defineProperty(play_into_temporary_insanity,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function rewind(client:any,turn:any=2){

(await pyMethod(client,"table",["player_input"],{"text":"我要回到今天早上。"}));
(await pyMethod(client,"table",["apply"],{"call_id":`t${turn}-c1`,"effects":[({["kind"]:"fork",["name"]:"loop-2",["mode"]:"loop"})]}));
(await pyInvoke(narrate,[client,`t${turn}-c2`,"你眼前一黑，又回到了诺特的办公室。"],{}));
}
Object.defineProperty(rewind,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"turn","rest":false,"varargs":false}]});
export async function test_a_rewind_never_leaves_a_deadline_further_away_than_its_own_rule(tmp_path:any){
let client:any,before:any,budget:any,trigger:any,owed:any;

client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":(await pyInvoke(loop_content,[tmp_path],{})),"env":({["COC_KERNEL_SEED"]:"1"})})));
try{(await pyInvoke(play_into_temporary_insanity,[client],{}));
before=(await pyInvoke(sanity_state,[client],{}));
budget=pyMultiply((await pyInvoke(pyInt,[pyAt(before,"temporary_insane_remaining_hours")],{})),60);
assert.ok(pyBool(pyEqual(pyAt(pyAt(before,"recovery_trigger"),"due_elapsed_minutes"),pyAdd((await pyInvoke(clock_of,[client],{})),budget))),"tests/kernel/test_worldline_due.py:128 assert before[\"recovery_trigger\"][\"due_elapsed_minutes\"] == clock_of(client) + budget");
(await pyInvoke(rewind,[client],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world_of,[client],{})),"active_scene"),"commission-briefing")),"tests/kernel/test_worldline_due.py:132 assert world_of(client)[\"active_scene\"] == \"commission-briefing\"");
assert.ok(pyBool(pyEqual((await pyInvoke(clock_of,[client],{})),0)),"tests/kernel/test_worldline_due.py:133 assert clock_of(client) == 0");
trigger=(await pyMethod((await pyInvoke(sanity_state,[client],{})),"get",["recovery_trigger"],{}));
owed=(pyBool((trigger===null))?null:pySubtract((await pyInvoke(pyInt,[pyAt(trigger,"due_elapsed_minutes")],{})),(await pyInvoke(clock_of,[client],{}))));
assert.ok(pyBool((await (async()=>{const __left=(owed===null);return pyBool(__left)?__left:pyLessEqual(owed,budget)})())),pyStr((`the rewind left ${owed} minutes owed for a ${budget}-minute madness`)));}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_rewind_never_leaves_a_deadline_further_away_than_its_own_rule,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_rewind_never_leaves_a_deadline_further_away_than_its_own_rule"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_rewind_never_leaves_a_deadline_further_away_than_its_own_rule(temporary);});
export async function test_a_rewind_leaves_the_sheet_and_the_sanity_engine_saying_the_same_thing(tmp_path:any){
let client:any,state:any;

client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":(await pyInvoke(loop_content,[tmp_path],{})),"env":({["COC_KERNEL_SEED"]:"1"})})));
try{(await pyInvoke(play_into_temporary_insanity,[client],{}));
(await pyInvoke(rewind,[client],{}));
state=(await pyInvoke(sanity_state,[client],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(sheet_of,[client],{})),"current_san"),55)),"tests/kernel/test_worldline_due.py:157 assert sheet_of(client)[\"current_san\"] == 55");
assert.ok(pyBool((await (async()=>{const absent=!pyBool(state);return absent?absent:pyEqual(pyAt(state,"san_current"),pyAt((await pyInvoke(sheet_of,[client],{})),"current_san"));})())),"tests/kernel/test_worldline_due.py:158 assert not state or state[\"san_current\"] == sheet_of(client)[\"current_san\"]");
assert.ok(pyBool(!pyBool((await pyMethod(state,"get",["temporary_insane"],{})))),"tests/kernel/test_worldline_due.py:159 assert not state.get(\"temporary_insane\")");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_rewind_leaves_the_sheet_and_the_sanity_engine_saying_the_same_thing,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_rewind_leaves_the_sheet_and_the_sanity_engine_saying_the_same_thing"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_rewind_leaves_the_sheet_and_the_sanity_engine_saying_the_same_thing(temporary);});
export async function test_a_rewind_that_keeps_the_clock_keeps_every_deadline_reachable(tmp_path:any){
let content:any,client:any,before:any,budget:any,due:any;

content=(await pyInvoke(loop_content,[tmp_path],{"reset":({["clock"]:"keep",["investigators"]:"keep"})}));
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":content,"env":({["COC_KERNEL_SEED"]:"1"})})));
try{(await pyInvoke(play_into_temporary_insanity,[client],{}));
before=(await pyInvoke(sanity_state,[client],{}));
budget=pyMultiply((await pyInvoke(pyInt,[pyAt(before,"temporary_insane_remaining_hours")],{})),60);
due=(await pyInvoke(pyInt,[pyAt(pyAt(before,"recovery_trigger"),"due_elapsed_minutes")],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyInvoke(clock_of,[client],{})),ELAPSED);return pyBool(__left)?pyEqual(due,pyAdd(ELAPSED,budget)):__left})())),"tests/kernel/test_worldline_due.py:176 assert clock_of(client) == ELAPSED and due == ELAPSED + budget");
(await pyInvoke(rewind,[client],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world_of,[client],{})),"active_scene"),"commission-briefing")),"tests/kernel/test_worldline_due.py:180 assert world_of(client)[\"active_scene\"] == \"commission-briefing\"");
assert.ok(pyBool(pyEqual((await pyInvoke(clock_of,[client],{})),ELAPSED)),"tests/kernel/test_worldline_due.py:181 assert clock_of(client) == ELAPSED");
assert.ok(pyBool(pyEqual(pySubtract((await pyInvoke(pyInt,[pyAt(pyAt((await pyInvoke(sanity_state,[client],{})),"recovery_trigger"),"due_elapsed_minutes")],{})),(await pyInvoke(clock_of,[client],{}))),budget)),"tests/kernel/test_worldline_due.py:182 assert int(sanity_state(client)[\"recovery_trigger\"][\"due_elapsed_minutes\"]) - clock_of(client) == budget");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_rewind_that_keeps_the_clock_keeps_every_deadline_reachable,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_rewind_that_keeps_the_clock_keeps_every_deadline_reachable"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_rewind_that_keeps_the_clock_keeps_every_deadline_reachable(temporary);});
export async function test_a_rewind_rewrites_the_world_the_sheets_and_the_engine_saves(tmp_path:any){
let client:any,before_saves:any,before_sheet:any;

client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":(await pyInvoke(loop_content,[tmp_path],{})),"env":({["COC_KERNEL_SEED"]:"1"})})));
try{(await pyInvoke(play_into_temporary_insanity,[client],{}));
before_saves=(await pyInvoke(engine_saves,[client],{}));
before_sheet=(await pyInvoke(sheet_of,[client],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(pySet,[before_saves],{})),new Set([`sanity-state/${INVESTIGATOR}.json`,`healing-state/${INVESTIGATOR}.json`,`mp-state/${INVESTIGATOR}.json`]))),"tests/kernel/test_worldline_due.py:201 assert set(before_saves) == {f\"sanity-state/{INVESTIGATOR}.json\",\n                                     f\"healing-state/{INVESTIGATOR}.json\",\n                                     f\"mp-state/{INVESTIGATOR}.json\"}");
(await pyInvoke(rewind,[client],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(engine_saves,[client],{})),({}))),"tests/kernel/test_worldline_due.py:207 assert engine_saves(client) == {}");
assert.ok(pyBool(!pyEqual((await pyInvoke(sheet_of,[client],{})),before_sheet)),"tests/kernel/test_worldline_due.py:208 assert sheet_of(client) != before_sheet");
assert.ok(pyBool((await pyMethod((pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"save"),"worldlines")),"is_dir",[],{}))),"tests/kernel/test_worldline_due.py:210 assert (campaign_dir(client.workspace) / \"save\" / \"worldlines\").is_dir()");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_rewind_rewrites_the_world_the_sheets_and_the_engine_saves,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_rewind_rewrites_the_world_the_sheets_and_the_engine_saves"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_rewind_rewrites_the_world_the_sheets_and_the_engine_saves(temporary);});
export async function test_a_kept_investigator_does_not_owe_the_rewound_time(tmp_path:any){
let content:any,client:any,before:any,budget:any,state:any,due:any,early:any,recovered:any;

content=(await pyInvoke(loop_content,[tmp_path],{"reset":({["clock"]:"anchor",["investigators"]:"keep"})}));
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":content,"env":({["COC_KERNEL_SEED"]:"1"})})));
try{(await pyInvoke(play_into_temporary_insanity,[client],{}));
before=(await pyInvoke(sanity_state,[client],{}));
budget=pyMultiply((await pyInvoke(pyInt,[pyAt(before,"temporary_insane_remaining_hours")],{})),60);
assert.ok(pyBool(pyEqual((await pyInvoke(clock_of,[client],{})),ELAPSED)),"tests/kernel/test_worldline_due.py:232 assert clock_of(client) == ELAPSED");
assert.ok(pyBool(pyEqual((await pyInvoke(pyInt,[pyAt(pyAt(before,"recovery_trigger"),"due_elapsed_minutes")],{})),pyAdd(ELAPSED,budget))),"tests/kernel/test_worldline_due.py:233 assert int(before[\"recovery_trigger\"][\"due_elapsed_minutes\"]) == ELAPSED + budget");
(await pyInvoke(rewind,[client],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt((await pyInvoke(world_of,[client],{})),"active_scene"),"commission-briefing");return pyBool(__left)?pyEqual((await pyInvoke(clock_of,[client],{})),0):__left})())),"tests/kernel/test_worldline_due.py:237 assert world_of(client)[\"active_scene\"] == \"commission-briefing\" and clock_of(client) == 0");
state=(await pyInvoke(sanity_state,[client],{}));
assert.ok(pyBool((pyAt(state,"temporary_insane")===true)),"tests/kernel/test_worldline_due.py:239 assert state[\"temporary_insane\"] is True");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(state,"san_current");const __term1=pyAt(before,"san_current");const __term2=pyAt((await pyInvoke(sheet_of,[client],{})),"current_san");return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_worldline_due.py:240 assert state[\"san_current\"] == before[\"san_current\"] == sheet_of(client)[\"current_san\"]");
due=(await pyInvoke(pyInt,[pyAt(pyAt(state,"recovery_trigger"),"due_elapsed_minutes")],{}));
assert.ok(pyBool(pyEqual(pySubtract(due,(await pyInvoke(clock_of,[client],{}))),budget)),pyStr(`owes ${pySubtract(due,(await pyInvoke(clock_of,[client],{})))} minutes for a ${budget}-minute madness`));
assert.ok(pyBool(pyEqual(pyAt(pyAt(state,"recovery_trigger"),"trigger_id"),`recover-temporary:${INVESTIGATOR}:${due}`)),"tests/kernel/test_worldline_due.py:243 assert state[\"recovery_trigger\"][\"trigger_id\"] == f\"recover-temporary:{INVESTIGATOR}:{due}\"");
(await pyMethod(client,"table",["player_input"],{"text":"我找个安全的地方等这阵过去。"}));
early=(await pyInvoke(resolve_err,[client,"t3-c1"],{"intent":"montage","goal":"缓过来","method":"","decision":"sanity:recover-temporary"}));
assert.ok(pyBool(pyContains(["needs","turn_state"],pyAt(early,"code"))),"tests/kernel/test_worldline_due.py:248 assert early[\"code\"] in (\"needs\", \"turn_state\")");
(await pyMethod(client,"table",["apply"],{"call_id":"t3-c2","effects":[({["kind"]:"time",["minutes"]:budget})]}));
assert.ok(pyBool(pyContains(new Set((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(pyAt((await pyMethod(client,"table",["look"],{})),"where"),"situations"))){__rows.push(pyAt(s,"decision"));}return __rows;})())),"sanity:recover-temporary")),"tests/kernel/test_worldline_due.py:250 assert \"sanity:recover-temporary\" in {s[\"decision\"] for s in client.table(\"look\")[\"where\"][\"situations\"]}");
recovered=(await pyInvoke(resolve,[client,"t3-c3"],{"intent":"montage","goal":"缓过来","method":"","decision":"sanity:recover-temporary"}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(recovered,"outcome"),"recovered")===true);return pyBool(__left)?(pyAt(pyAt(recovered,"outcome"),"temporary_insane")===false):__left})())),"tests/kernel/test_worldline_due.py:252 assert recovered[\"outcome\"][\"recovered\"] is True and recovered[\"outcome\"][\"temporary_insane\"] is False");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_kept_investigator_does_not_owe_the_rewound_time,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_kept_investigator_does_not_owe_the_rewound_time"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_kept_investigator_does_not_owe_the_rewound_time(temporary);});
export async function test_a_kept_rewind_is_refused_by_name_while_state_no_engine_can_move_is_on_the_table(tmp_path:any){
let content:any,client:any,stray:any,before:any,error:any;

content=(await pyInvoke(loop_content,[tmp_path],{"reset":({["clock"]:"anchor",["investigators"]:"keep"})}));
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":content,"env":({["COC_KERNEL_SEED"]:"1"})})));
try{(await pyInvoke(play_into_temporary_insanity,[client],{}));
stray=pyDivide(pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"save"),"tide-state"),`${INVESTIGATOR}.json`);
(await pyMethod(stray.parent,"mkdir",[],{}));
(await pyMethod(stray,"write_text",[(await pyMethod(json,"dumps",[({["investigator_id"]:INVESTIGATOR,["due_elapsed_minutes"]:700})],{}))],{"encoding":"utf-8"}));
before=(await pyInvoke(sanity_state,[client],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我要回到今天早上。"}));
error=(await pyMethod(client,"table_err",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"fork",["name"]:"loop-2",["mode"]:"loop"})]}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"not_implemented")),"tests/kernel/test_worldline_due.py:277 assert error[\"code\"] == \"not_implemented\"");
assert.ok(pyBool(pyContains(pyAt(error,"message"),`save/tide-state/${INVESTIGATOR}.json`)),"tests/kernel/test_worldline_due.py:278 assert f\"save/tide-state/{INVESTIGATOR}.json\" in error[\"message\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"unclaimed"),[`save/tide-state/${INVESTIGATOR}.json`])),"tests/kernel/test_worldline_due.py:279 assert error[\"details\"][\"unclaimed\"] == [f\"save/tide-state/{INVESTIGATOR}.json\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"refused"),({}))),"tests/kernel/test_worldline_due.py:280 assert error[\"details\"][\"refused\"] == {}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"clock_delta"),(-ELAPSED))),"tests/kernel/test_worldline_due.py:281 assert error[\"details\"][\"clock_delta\"] == -ELAPSED");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(meta_of,[client],{})),"active_worldline"),"main")),"tests/kernel/test_worldline_due.py:283 assert meta_of(client)[\"active_worldline\"] == \"main\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyInvoke(clock_of,[client],{})),ELAPSED);return pyBool(__left)?pyEqual((await pyInvoke(sanity_state,[client],{})),before):__left})())),"tests/kernel/test_worldline_due.py:284 assert clock_of(client) == ELAPSED and sanity_state(client) == before");
(await pyMethod(stray,"unlink",[],{}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c2","effects":[({["kind"]:"fork",["name"]:"loop-2",["mode"]:"loop"})]}));
(await pyInvoke(narrate,[client,"t2-c3","你眼前一黑，又回到了诺特的办公室。"],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt((await pyInvoke(meta_of,[client],{})),"active_worldline"),"loop-2");return pyBool(__left)?pyEqual((await pyInvoke(clock_of,[client],{})),0):__left})())),"tests/kernel/test_worldline_due.py:289 assert meta_of(client)[\"active_worldline\"] == \"loop-2\" and clock_of(client) == 0");
assert.ok(pyBool(pyEqual((await pyInvoke(pyInt,[pyAt(pyAt((await pyInvoke(sanity_state,[client],{})),"recovery_trigger"),"due_elapsed_minutes")],{})),pySubtract((await pyInvoke(pyInt,[pyAt(pyAt(before,"recovery_trigger"),"due_elapsed_minutes")],{})),ELAPSED))),"tests/kernel/test_worldline_due.py:290 assert int(sanity_state(client)[\"recovery_trigger\"][\"due_elapsed_minutes\"]) == \\\n            int(before[\"recovery_trigger\"][\"due_elapsed_minutes\"]) - ELAPSED");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_kept_rewind_is_refused_by_name_while_state_no_engine_can_move_is_on_the_table,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_kept_rewind_is_refused_by_name_while_state_no_engine_can_move_is_on_the_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_kept_rewind_is_refused_by_name_while_state_no_engine_can_move_is_on_the_table(temporary);});
export async function test_a_kept_wound_older_than_the_rewound_clock_keeps_its_age(tmp_path:any){
let content:any,client:any,wound:any,moved:any;

content=(await pyInvoke(loop_content,[tmp_path],{"reset":({["clock"]:"anchor",["investigators"]:"keep"})}));
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":content,"env":({["COC_KERNEL_SEED"]:"1"})})));
try{(await pyInvoke(play_into_temporary_insanity,[client],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我从楼梯上摔了下去。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"damage",["dice"]:"1D1",["why"]:"摔下楼梯"})]}));
(await pyInvoke(narrate,[client,"t2-c2","你摔得不轻。"],{}));
wound=pyAt(pyAt((await pyInvoke(healing_state,[client],{})),"wound_ledger"),0);
assert.ok(pyBool(pyEqual(pyAt(wound,"occurred_elapsed_minutes"),ELAPSED)),"tests/kernel/test_worldline_due.py:316 assert wound[\"occurred_elapsed_minutes\"] == ELAPSED");
(await pyMethod(client,"table",["player_input"],{"text":"我撑了一个小时，然后想回到今天早上。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t3-c1","effects":[({["kind"]:"time",["minutes"]:60}),({["kind"]:"fork",["name"]:"loop-2",["mode"]:"loop"})]}));
(await pyInvoke(narrate,[client,"t3-c2","你眼前一黑，又回到了诺特的办公室。"],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt((await pyInvoke(meta_of,[client],{})),"active_worldline"),"loop-2");return pyBool(__left)?pyEqual((await pyInvoke(clock_of,[client],{})),0):__left})())),"tests/kernel/test_worldline_due.py:323 assert meta_of(client)[\"active_worldline\"] == \"loop-2\" and clock_of(client) == 0");
moved=pyAt(pyAt((await pyInvoke(healing_state,[client],{})),"wound_ledger"),0);
assert.ok(pyBool(pyEqual(pyAt(moved,"wound_id"),pyAt(wound,"wound_id"))),pyStr("the wound came round with the investigator"));
assert.ok(pyBool(pyEqual(pyAt(moved,"occurred_elapsed_minutes"),(-60))),"tests/kernel/test_worldline_due.py:327 assert moved[\"occurred_elapsed_minutes\"] == -60");
assert.ok(pyBool(pyEqual(pySubtract((await pyInvoke(clock_of,[client],{})),pyAt(moved,"occurred_elapsed_minutes")),60)),"tests/kernel/test_worldline_due.py:328 assert clock_of(client) - moved[\"occurred_elapsed_minutes\"] == 60");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_kept_wound_older_than_the_rewound_clock_keeps_its_age,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_kept_wound_older_than_the_rewound_clock_keeps_its_age"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_kept_wound_older_than_the_rewound_clock_keeps_its_age(temporary);});
export async function test_a_kept_wound_younger_than_the_anchor_stays_exactly_as_old(tmp_path:any){
let content:any,client:any,left_before:any,wound:any,state:any;

content=(await pyInvoke(loop_content_anchored_at,[tmp_path,"corbitt-confrontation"],{"reset":({["clock"]:"anchor",["investigators"]:"keep"})}));
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":content,"env":({["COC_KERNEL_SEED"]:"1"})})));
try{(await pyInvoke(play_into_temporary_insanity,[client],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我从楼梯上摔了下去。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"damage",["dice"]:"1D1",["why"]:"摔下楼梯"})]}));
(await pyInvoke(narrate,[client,"t2-c2","你摔得不轻。"],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我撑了一个小时。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t3-c1","effects":[({["kind"]:"time",["minutes"]:60})]}));
(await pyInvoke(narrate,[client,"t3-c2","一个小时过去了。"],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(clock_of,[client],{})),pyAdd(ELAPSED,60))),"tests/kernel/test_worldline_due.py:351 assert clock_of(client) == ELAPSED + 60");
left_before=pySubtract((await pyInvoke(pyInt,[pyAt(pyAt((await pyInvoke(sanity_state,[client],{})),"recovery_trigger"),"due_elapsed_minutes")],{})),(await pyInvoke(clock_of,[client],{})));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyInvoke(healing_state,[client],{})),"wound_ledger"),0),"occurred_elapsed_minutes"),ELAPSED)),"tests/kernel/test_worldline_due.py:353 assert healing_state(client)[\"wound_ledger\"][0][\"occurred_elapsed_minutes\"] == ELAPSED");
(await pyInvoke(rewind,[client],{"turn":4}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt((await pyInvoke(world_of,[client],{})),"active_scene"),"corbitt-confrontation");return pyBool(__left)?pyEqual((await pyInvoke(clock_of,[client],{})),ELAPSED):__left})())),"tests/kernel/test_worldline_due.py:357 assert world_of(client)[\"active_scene\"] == \"corbitt-confrontation\" and clock_of(client) == ELAPSED");
wound=pyAt(pyAt((await pyInvoke(healing_state,[client],{})),"wound_ledger"),0);
assert.ok(pyBool(pyEqual(pyAt(wound,"occurred_elapsed_minutes"),pySubtract(ELAPSED,60))),"tests/kernel/test_worldline_due.py:359 assert wound[\"occurred_elapsed_minutes\"] == ELAPSED - 60");
state=(await pyInvoke(sanity_state,[client],{}));
assert.ok(pyBool((pyAt(state,"temporary_insane")===true)),"tests/kernel/test_worldline_due.py:361 assert state[\"temporary_insane\"] is True");
assert.ok(pyBool(pyEqual(pySubtract((await pyInvoke(pyInt,[pyAt(pyAt(state,"recovery_trigger"),"due_elapsed_minutes")],{})),(await pyInvoke(clock_of,[client],{}))),left_before)),"tests/kernel/test_worldline_due.py:362 assert int(state[\"recovery_trigger\"][\"due_elapsed_minutes\"]) - clock_of(client) == left_before");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_kept_wound_younger_than_the_anchor_stays_exactly_as_old,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_kept_wound_younger_than_the_anchor_stays_exactly_as_old"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_kept_wound_younger_than_the_anchor_stays_exactly_as_old(temporary);});
