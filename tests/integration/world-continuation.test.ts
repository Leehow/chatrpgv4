// Migrated from tests/kernel/test_continuation.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {RpcClient,campaign_dir,create_campaign,narrate_opening,open_turn,read_json,repo_dir,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_continuation.py',import.meta.url).pathname;






export async function checkpoint_path(workspace:any){
return pyDivide(pyDivide(pyDivide((await pyInvoke(campaign_dir,[workspace],{})),"save"),"continuation"),"latest.json");
}
Object.defineProperty(checkpoint_path,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false}]});
export async function git_show(workspace:any,path:any){
return (await pyMethod(subprocess,"run",[["git",`--git-dir=${(await pyInvoke(repo_dir,[workspace],{}))}`,"show",`HEAD:${path}`]],{"capture_output":true,"text":true,"check":false}));
}
Object.defineProperty(git_show,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false},{"name":"path","rest":false,"varargs":false}]});
export async function head_short(workspace:any){
return (await pyMethod((await pyMethod(subprocess,"run",[["git",`--git-dir=${(await pyInvoke(repo_dir,[workspace],{}))}`,"rev-parse","--short","HEAD"]],{"capture_output":true,"text":true,"check":true})).stdout,"strip",[],{}));
}
Object.defineProperty(head_short,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false}]});
export async function canonical_sha(payload:any){
return (await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod((await pyMethod(json,"dumps",[payload],{"sort_keys":true,"separators":[",",":"],"ensure_ascii":false})),"encode",["utf-8"],{}))],{})),"hexdigest",[],{}));
}
Object.defineProperty(canonical_sha,"__pySignature",{value:[{"name":"payload","rest":false,"varargs":false}]});
export async function test_checkpoint_is_written_after_the_commit(kernel:any){
let result:any,record:any,checkpoint:any,shown:any;
(await pyInvoke(open_turn,[kernel],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"hall-of-records",["travel_minutes"]:20})]}));
result=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c2","text":"你到了档案馆。\n\n灰尘很厚。"}));
record=(await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"turns"),"0001.json")],{}));
checkpoint=(await pyInvoke(read_json,[(await pyInvoke(checkpoint_path,[kernel.workspace],{}))],{}));
assert.ok(pyBool(pyEqual(checkpoint,({...checkpoint,["schema"]:1,["campaign"]:"c1",["turn"]:1,["commit"]:pyAt(result,"commit"),["scene"]:({["name"]:"hall-of-records",["display_name"]:"Hall of Records"}),["clock"]:({["minutes"]:20}),["session"]:null,["pending_choice"]:null,["receipts_digest"]:(await pyInvoke(canonical_sha,[pyAt(record,"receipts")],{})),["one_line"]:"Turn 1: Hall of Records, clock 20 min, no session; last turn: 你到了档案馆。 灰尘很厚。"}))),"tests/kernel/test_continuation.py:40 assert checkpoint == {\n        **checkpoint, \"schema\": 1, \"campaign\": \"c1\", \"turn\": 1, \"commit\": result[\"commit\"],\n        \"scene\": {\"name\": \"hall-of-records\", \"display_name\": \"Hall of Records\"}, \"clock\": {\"minutes\": 20},\n        \"session\": None, \"pending_choice\": None,\n        \"receipts_digest\": canonical_sha(record[\"receipts\"]),\n        \"one_line\": \"Turn 1: Hall of Records, clock 20 min, no session; last turn: 你到了档案馆。 灰尘很厚。\",\n    }");
assert.ok(pyBool(pyAt(checkpoint,"at")),"tests/kernel/test_continuation.py:47 assert checkpoint[\"at\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const i of pyIterable(pyAt(checkpoint,"investigators"))){__rows.push((await pyInvoke(pySet,[i],{})));}return __rows;})()),[new Set(["id","name","hp","san","mp","luck"])])),"tests/kernel/test_continuation.py:48 assert [set(i) for i in checkpoint[\"investigators\"]] == [{\"id\", \"name\", \"hp\", \"san\", \"mp\", \"luck\"}]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(checkpoint,"investigators"),0),"id"),"thomas-hayes")),"tests/kernel/test_continuation.py:49 assert checkpoint[\"investigators\"][0][\"id\"] == \"thomas-hayes\"");
shown=(await pyInvoke(git_show,[kernel.workspace,"save/continuation/latest.json"],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(shown.returncode,0);return pyBool(__left)?pyEqual(pyAt((await pyMethod(json,"loads",[shown.stdout],{})),"turn"),0):__left})())),"tests/kernel/test_continuation.py:52 assert shown.returncode == 0 and json.loads(shown.stdout)[\"turn\"] == 0");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(record,"world"),"scene"),pyAt(checkpoint,"scene"));return pyBool(__left)?pyEqual(pyAt(pyAt(record,"world"),"clock"),pyAt(checkpoint,"clock")):__left})())),"tests/kernel/test_continuation.py:54 assert record[\"world\"][\"scene\"] == checkpoint[\"scene\"] and record[\"world\"][\"clock\"] == checkpoint[\"clock\"]");
}
Object.defineProperty(test_checkpoint_is_written_after_the_commit,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_checkpoint_is_written_after_the_commit"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_checkpoint_is_written_after_the_commit(await kernel(t,{}));});
export async function test_open_returns_resume_and_the_first_capsule_carries_it_once(kernel:any){
let fresh:any,opened:any,first:any,second:any;
(await pyInvoke(create_campaign,[kernel],{}));
fresh=(await pyMethod(kernel,"table",["open"],{}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(fresh,"opening_needed")===true);return pyBool(__left)?(pyAt(fresh,"resume")===null):__left})())),"tests/kernel/test_continuation.py:60 assert fresh[\"opening_needed\"] is True and fresh[\"resume\"] is None");
(await pyInvoke(narrate_opening,[kernel],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"第一回合。"}));
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c1","text":"第一回合的交付。"}));
opened=(await pyMethod(kernel,"table",["open"],{}));
assert.ok(pyBool((pyAt(opened,"opening_needed")===false)),"tests/kernel/test_continuation.py:66 assert opened[\"opening_needed\"] is False");
assert.ok(pyBool(pyEqual(pyAt(opened,"resume"),({["worldline"]:"main",["turn"]:1,["commit"]:pyAt((await pyInvoke(read_json,[(await pyInvoke(checkpoint_path,[kernel.workspace],{}))],{})),"commit"),["scene"]:({["name"]:"commission-briefing",["display_name"]:"Knott's Office"}),["clock"]:({["minutes"]:0}),["session"]:null,["one_line"]:"Turn 1: Knott's Office, clock 0 min, no session; last turn: 第一回合的交付。",["rebuilt"]:false}))),"tests/kernel/test_continuation.py:67 assert opened[\"resume\"] == {\n        # §15.6: the checkpoint names the line the next turn will be played on.\n        \"worldline\": \"main\",\n        \"turn\": 1, \"commit\": read_json(checkpoint_path(kernel.workspace))[\"commit\"],\n        \"scene\": {\"name\": \"commission-briefing\", \"display_name\": \"Knott's Office\"}, \"clock\": {\"minutes\": 0},\n        \"session\": None, \"one_line\": \"Turn 1: Knott's Office, clock 0 min, no session; last turn: 第一回合的交付。\",\n        \"rebuilt\": False,\n    }");
first=(await pyMethod(kernel,"table",["player_input"],{"text":"第二回合。"}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(first,"capsule"),"resume"),pyAt(opened,"resume"))),"tests/kernel/test_continuation.py:76 assert first[\"capsule\"][\"resume\"] == opened[\"resume\"]");
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t2-c1","text":"第二回合的交付。"}));
second=(await pyMethod(kernel,"table",["player_input"],{"text":"第三回合。"}));
assert.ok(pyBool(!pyContains(pyAt(second,"capsule"),"resume")),"tests/kernel/test_continuation.py:79 assert \"resume\" not in second[\"capsule\"]");
assert.ok(pyBool(!pyContains((await pyMethod(kernel,"table",["capsule"],{})),"resume")),"tests/kernel/test_continuation.py:80 assert \"resume\" not in kernel.table(\"capsule\")");
}
Object.defineProperty(test_open_returns_resume_and_the_first_capsule_carries_it_once,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_open_returns_resume_and_the_first_capsule_carries_it_once"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_open_returns_resume_and_the_first_capsule_carries_it_once(await kernel(t,{}));});
export async function test_head_ahead_of_checkpoint_rebuilds_it_from_head(tmp_path:any){
let ws:any,client:any,stale:any,record_path:any,record:any,opened:any,rebuilt:any;
ws=pyDivide(tmp_path,"ws");
client=(new RpcClient(ws));
try{(await pyInvoke(open_turn,[client],{}));
(await pyMethod(client,"table",["narrate"],{"call_id":"t1-c1","text":"第一回合。"}));
stale=(await pyInvoke(read_json,[(await pyInvoke(checkpoint_path,[ws],{}))],{}));
(await pyMethod(client,"table",["player_input"],{"text":"继续。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"clue",["clue"]:"knott-keys"})]}));
(await pyMethod(client,"table",["narrate"],{"call_id":"t2-c2","text":"第二回合。"}));}finally{(await pyMethod(client,"close",[],{}));}
(await pyMethod((await pyInvoke(checkpoint_path,[ws],{})),"write_text",[(await pyMethod(json,"dumps",[stale],{}))],{"encoding":"utf-8"}));
record_path=pyDivide(pyDivide((await pyInvoke(campaign_dir,[ws],{})),"turns"),"0002.json");
record=(await pyInvoke(read_json,[record_path],{}));
record["commit"]=null;
(await pyMethod(record_path,"write_text",[(await pyMethod(json,"dumps",[record],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
client=(new RpcClient(ws));
try{opened=(await pyMethod(client,"table",["open"],{}));
assert.ok(pyBool((pyAt(pyAt(opened,"resume"),"rebuilt")===true)),"tests/kernel/test_continuation.py:105 assert opened[\"resume\"][\"rebuilt\"] is True");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(opened,"resume"),"turn"),2);return pyBool(__left)?pyEqual(pyAt(pyAt(opened,"resume"),"commit"),(await pyInvoke(head_short,[ws],{}))):__left})())),"tests/kernel/test_continuation.py:106 assert opened[\"resume\"][\"turn\"] == 2 and opened[\"resume\"][\"commit\"] == head_short(ws)");
assert.ok(pyBool((await pyMethod(pyAt(pyAt(opened,"resume"),"one_line"),"startswith",["Turn 2: "],{}))),"tests/kernel/test_continuation.py:107 assert opened[\"resume\"][\"one_line\"].startswith(\"Turn 2: \")");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(opened,"turn"),({["number"]:3,["state"]:"awaiting_player"}));return pyBool(__left)?(pyAt(opened,"pending_turn")===null):__left})())),"tests/kernel/test_continuation.py:108 assert opened[\"turn\"] == {\"number\": 3, \"state\": \"awaiting_player\"} and opened[\"pending_turn\"] is None");
rebuilt=(await pyInvoke(read_json,[(await pyInvoke(checkpoint_path,[ws],{}))],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(rebuilt,"turn"),2);return pyBool(__left)?pyEqual(pyAt(rebuilt,"commit"),(await pyInvoke(head_short,[ws],{}))):__left})())),"tests/kernel/test_continuation.py:110 assert rebuilt[\"turn\"] == 2 and rebuilt[\"commit\"] == head_short(ws)");
assert.ok(pyBool(pyEqual(pyAt(rebuilt,"receipts_digest"),(await pyInvoke(canonical_sha,[pyAt((await pyInvoke(read_json,[record_path],{})),"receipts")],{})))),"tests/kernel/test_continuation.py:111 assert rebuilt[\"receipts_digest\"] == canonical_sha(read_json(record_path)[\"receipts\"])");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(read_json,[record_path],{})),"commit"),(await pyInvoke(head_short,[ws],{})))),"tests/kernel/test_continuation.py:112 assert read_json(record_path)[\"commit\"] == head_short(ws)");
assert.ok(pyBool((pyAt(pyAt((await pyMethod(client,"table",["open"],{})),"resume"),"rebuilt")===false)),"tests/kernel/test_continuation.py:114 assert client.table(\"open\")[\"resume\"][\"rebuilt\"] is False");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_head_ahead_of_checkpoint_rebuilds_it_from_head,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_head_ahead_of_checkpoint_rebuilds_it_from_head"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_head_ahead_of_checkpoint_rebuilds_it_from_head(temporary);});
export async function test_missing_checkpoint_is_rebuilt_from_head(tmp_path:any){
let ws:any,client:any,resume:any;
ws=pyDivide(tmp_path,"ws");
client=(new RpcClient(ws));
try{(await pyInvoke(open_turn,[client],{}));
(await pyMethod(client,"table",["narrate"],{"call_id":"t1-c1","text":"第一回合。"}));}finally{(await pyMethod(client,"close",[],{}));}
(await pyMethod((await pyInvoke(checkpoint_path,[ws],{})),"unlink",[],{}));
client=(new RpcClient(ws));
try{resume=pyAt((await pyMethod(client,"table",["open"],{})),"resume");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(pyAt(resume,"rebuilt")===true);return pyBool(__left)?pyEqual(pyAt(resume,"turn"),1):__left})());return pyBool(__left)?pyEqual(pyAt(resume,"commit"),(await pyInvoke(head_short,[ws],{}))):__left})())),"tests/kernel/test_continuation.py:131 assert resume[\"rebuilt\"] is True and resume[\"turn\"] == 1 and resume[\"commit\"] == head_short(ws)");
assert.ok(pyBool((await pyMethod((await pyInvoke(checkpoint_path,[ws],{})),"exists",[],{}))),"tests/kernel/test_continuation.py:132 assert checkpoint_path(ws).exists()");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_missing_checkpoint_is_rebuilt_from_head,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_missing_checkpoint_is_rebuilt_from_head"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_missing_checkpoint_is_rebuilt_from_head(temporary);});
export async function test_lost_turn_json_is_rebuilt_from_the_checkpoint(tmp_path:any,damage:any){
let ws:any,client:any,turn_json:any,opened:any,rebuilt:any;
ws=pyDivide(tmp_path,"ws");
client=(new RpcClient(ws));
try{(await pyInvoke(open_turn,[client],{}));
(await pyMethod(client,"table",["narrate"],{"call_id":"t1-c1","text":"第一回合。"}));}finally{(await pyMethod(client,"close",[],{}));}
turn_json=pyDivide((await pyInvoke(campaign_dir,[ws],{})),"turn.json");
if(pyBool(pyEqual(damage,"delete"))){(await pyMethod(turn_json,"unlink",[],{}));}else{(await pyMethod(turn_json,"write_text",["{not json"],{"encoding":"utf-8"}));}
client=(new RpcClient(ws));
try{opened=(await pyMethod(client,"table",["open"],{}));
assert.ok(pyBool(pyEqual(pyAt(opened,"turn"),({["number"]:2,["state"]:"awaiting_player"}))),"tests/kernel/test_continuation.py:154 assert opened[\"turn\"] == {\"number\": 2, \"state\": \"awaiting_player\"}");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(opened,"resume"),"rebuilt")===true);return pyBool(__left)?pyEqual(pyAt(pyAt(opened,"resume"),"turn"),1):__left})())),"tests/kernel/test_continuation.py:155 assert opened[\"resume\"][\"rebuilt\"] is True and opened[\"resume\"][\"turn\"] == 1");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(opened,"pending_turn")===null);return pyBool(__left)?(pyAt(opened,"opening_needed")===false):__left})())),"tests/kernel/test_continuation.py:156 assert opened[\"pending_turn\"] is None and opened[\"opening_needed\"] is False");
rebuilt=(await pyInvoke(read_json,[turn_json],{}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(rebuilt,"turn"),2);return pyBool(__left)?pyEqual(pyAt(rebuilt,"state"),"awaiting_player"):__left})());return pyBool(__left)?pyEqual(pyAt(rebuilt,"calls"),({})):__left})())),"tests/kernel/test_continuation.py:158 assert rebuilt[\"turn\"] == 2 and rebuilt[\"state\"] == \"awaiting_player\" and rebuilt[\"calls\"] == {}");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(client,"table",["player_input"],{"text":"继续。"})),"turn"),2)),"tests/kernel/test_continuation.py:159 assert client.table(\"player_input\", text=\"继续。\")[\"turn\"] == 2");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(client,"table",["narrate"],{"call_id":"t2-c1","text":"第二回合。"})),"turn"),2)),"tests/kernel/test_continuation.py:160 assert client.table(\"narrate\", call_id=\"t2-c1\", text=\"第二回合。\")[\"turn\"] == 2");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(read_json,[(await pyInvoke(checkpoint_path,[ws],{}))],{})),"turn"),2)),"tests/kernel/test_continuation.py:161 assert read_json(checkpoint_path(ws))[\"turn\"] == 2");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_lost_turn_json_is_rebuilt_from_the_checkpoint,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false},{"name":"damage","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("damage",["delete","corrupt"]))).entries())test("test_lost_turn_json_is_rebuilt_from_the_checkpoint"+((pyCartesian([{}],pyParametrize("damage",["delete","corrupt"]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_lost_turn_json_is_rebuilt_from_the_checkpoint(temporary,row["damage"]);});
export async function test_lost_turn_json_after_an_ask_restores_the_pending_choice(tmp_path:any){
let ws:any,client:any,asked:any,opened:any,answered:any;
ws=pyDivide(tmp_path,"ws");
client=(new RpcClient(ws));
try{(await pyInvoke(open_turn,[client],{}));
(await pyMethod(client,"table",["narrate"],{"call_id":"t1-c1","text":"第一回合。"}));
(await pyMethod(client,"table",["player_input"],{"text":"我推门。"}));
asked=(await pyMethod(client,"table",["ask"],{"call_id":"t2-c1","prompt":"进还是不进？","options":["进","不进"]}));}finally{(await pyMethod(client,"close",[],{}));}
(await pyMethod((pyDivide((await pyInvoke(campaign_dir,[ws],{})),"turn.json")),"unlink",[],{}));
client=(new RpcClient(ws));
try{opened=(await pyMethod(client,"table",["open"],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(opened,"turn"),({["number"]:2,["state"]:"asked"}));return pyBool(__left)?(pyAt(pyAt(opened,"resume"),"rebuilt")===true):__left})())),"tests/kernel/test_continuation.py:180 assert opened[\"turn\"] == {\"number\": 2, \"state\": \"asked\"} and opened[\"resume\"][\"rebuilt\"] is True");
answered=(await pyMethod(client,"table",["player_input"],{"text":"进。"}));
assert.ok(pyBool(pyEqual(pyAt(answered,"turn"),3)),"tests/kernel/test_continuation.py:182 assert answered[\"turn\"] == 3");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(answered,"capsule"),"turn"),"pending_choice"),pyAt(asked,"pending_choice"))),"tests/kernel/test_continuation.py:183 assert answered[\"capsule\"][\"turn\"][\"pending_choice\"] == asked[\"pending_choice\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_lost_turn_json_after_an_ask_restores_the_pending_choice,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_lost_turn_json_after_an_ask_restores_the_pending_choice"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_lost_turn_json_after_an_ask_restores_the_pending_choice(temporary);});
export async function test_lost_turn_json_before_any_narrate_is_turn_zero(tmp_path:any){
let ws:any,client:any,opened:any;
ws=pyDivide(tmp_path,"ws");
client=(new RpcClient(ws));
try{(await pyInvoke(create_campaign,[client],{}));}finally{(await pyMethod(client,"close",[],{}));}
(await pyMethod((pyDivide((await pyInvoke(campaign_dir,[ws],{})),"turn.json")),"unlink",[],{}));
client=(new RpcClient(ws));
try{opened=(await pyMethod(client,"table",["open"],{}));
assert.ok(pyBool(pyEqual(pyAt(opened,"turn"),({["number"]:0,["state"]:"awaiting_player"}))),"tests/kernel/test_continuation.py:199 assert opened[\"turn\"] == {\"number\": 0, \"state\": \"awaiting_player\"}");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(opened,"opening_needed")===true);return pyBool(__left)?(pyAt(opened,"resume")===null):__left})())),"tests/kernel/test_continuation.py:200 assert opened[\"opening_needed\"] is True and opened[\"resume\"] is None");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(narrate_opening,[client],{})),"turn"),0)),"tests/kernel/test_continuation.py:201 assert narrate_opening(client)[\"turn\"] == 0");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_lost_turn_json_before_any_narrate_is_turn_zero,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_lost_turn_json_before_any_narrate_is_turn_zero"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_lost_turn_json_before_any_narrate_is_turn_zero(temporary);});
export async function test_pending_turn_keeps_the_last_checkpoint_as_resume(tmp_path:any){
let ws:any,client:any,opened:any,replay:any;
ws=pyDivide(tmp_path,"ws");
client=(new RpcClient(ws));
try{(await pyInvoke(open_turn,[client],{}));
(await pyMethod(client,"table",["resolve"],{"call_id":"t1-c1","action":({["intent"]:"investigate",["goal"]:"x",["method"]:"y",["skill"]:"Spot Hidden"})}));}finally{(await pyMethod(client,"close",[],{}));}
client=(new RpcClient(ws));
try{opened=(await pyMethod(client,"table",["open"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(opened,"pending_turn"),"last_call_ordinal"),1)),"tests/kernel/test_continuation.py:218 assert opened[\"pending_turn\"][\"last_call_ordinal\"] == 1");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(pyAt(opened,"pending_turn"),"receipts"))){__rows.push(pyAt(r,"id"));}return __rows;})()),["roll:spot-hidden-t1-c1"])),"tests/kernel/test_continuation.py:219 assert [r[\"id\"] for r in opened[\"pending_turn\"][\"receipts\"]] == [\"roll:spot-hidden-t1-c1\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(opened,"resume"),"turn"),0);return pyBool(__left)?(pyAt(pyAt(opened,"resume"),"rebuilt")===false):__left})())),"tests/kernel/test_continuation.py:220 assert opened[\"resume\"][\"turn\"] == 0 and opened[\"resume\"][\"rebuilt\"] is False");
assert.ok(pyBool((await pyMethod(pyAt(pyAt(opened,"resume"),"one_line"),"startswith",["Turn 0: Knott's Office"],{}))),"tests/kernel/test_continuation.py:221 assert opened[\"resume\"][\"one_line\"].startswith(\"Turn 0: Knott's Office\")");
replay=(await pyMethod(client,"table",["resolve"],{"call_id":"t1-c1","action":({["intent"]:"investigate",["goal"]:"x",["method"]:"y",["skill"]:"Spot Hidden"})}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(replay,"replayed")===true);return pyBool(__left)?pyEqual(pyAt(replay,"receipt"),"roll:spot-hidden-t1-c1"):__left})())),"tests/kernel/test_continuation.py:225 assert replay[\"replayed\"] is True and replay[\"receipt\"] == \"roll:spot-hidden-t1-c1\"");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_pending_turn_keeps_the_last_checkpoint_as_resume,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_pending_turn_keeps_the_last_checkpoint_as_resume"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_pending_turn_keeps_the_last_checkpoint_as_resume(temporary);});
