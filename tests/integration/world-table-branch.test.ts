// Migrated from tests/kernel/test_table_branch.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,MODULE,RpcClient,campaign_dir,create_campaign,narrate,narrate_opening,read_json,read_jsonl,repo_dir,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,retainedFixture,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,pyType,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_table_branch.py',import.meta.url).pathname;








export let ROOT:any=pyAt((await pyMethod((await pyInvoke(Path,[__file__],{})),"resolve",[],{})).parents,2);
export let TS_COMMAND:any=["node",(await pyInvoke(pyStr,[pyDivide(pyDivide(pyDivide(ROOT,"build"),"kernel"),"rpc.mjs")],{}))];

export async function git(workspace:any,args:any,campaign_id:any=CAMPAIGN){
let result:any;
result=(await pyMethod(subprocess,"run",[["git",`--git-dir=${(await pyInvoke(repo_dir,[workspace,campaign_id],{}))}`,`--work-tree=${(await pyInvoke(campaign_dir,[workspace,campaign_id],{}))}`,...args]],{"capture_output":true,"text":true,"check":true}));
return (await pyMethod(result.stdout,"strip",[],{}));
}
Object.defineProperty(git,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false},{"name":"args","rest":false,"varargs":true},{"name":"campaign_id","rest":false,"varargs":false}]});
export async function branches(workspace:any){
let refs:any;
refs=(await pyInvoke(git,[workspace,"for-each-ref","--format=%(refname)","refs/heads/"],{}));
return (await pySorted((await (async()=>{const __rows:any[]=[];for(const ref of pyIterable((await pyMethod(refs,"split",[],{})))){if(pyBool(ref)){__rows.push(ref);}}return __rows;})())));
}
Object.defineProperty(branches,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false}]});
export async function head_ref(workspace:any){
return (await pyInvoke(git,[workspace,"symbolic-ref","HEAD"],{}));
}
Object.defineProperty(head_ref,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false}]});
export async function blob(workspace:any,rev:any,path:any){
return (await pyInvoke(git,[workspace,"show",`${rev}:${path}`],{}));
}
Object.defineProperty(blob,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false},{"name":"rev","rest":false,"varargs":false},{"name":"path","rest":false,"varargs":false}]});
export async function meta_of(client:any){
return (await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"campaign.json")],{}));
}
Object.defineProperty(meta_of,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function turn_json(client:any){
return (await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"turn.json")],{}));
}
Object.defineProperty(turn_json,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function turn_commit(client:any,turn:any){
return pyAt((await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"turns"),`${pyFormat(turn,"04d")}.json`)],{})),"commit");
}
Object.defineProperty(turn_commit,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"turn","rest":false,"varargs":false}]});
export async function capsule(client:any){
return (await pyMethod(client,"table",["capsule"],{}));
}
Object.defineProperty(capsule,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function play_to_turn(client:any,turns:any){
let number:any;
(await pyInvoke(create_campaign,[client],{}));
(await pyMethod(client,"table",["open"],{}));
(await pyInvoke(narrate_opening,[client],{}));
for(number of pyIterable((await pyInvoke(pyRange,[1,pyAdd(turns,1)],{})))){
(await pyMethod(client,"table",["player_input"],{"text":`第 ${number} 步，我环顾四周。`}));
(await pyInvoke(narrate,[client,`t${number}-c1`,`你看了看四周（第 ${number} 回合）。`],{}));
}
}
Object.defineProperty(play_to_turn,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"turns","rest":false,"varargs":false}]});

export async function test_branch_from_a_mid_history_commit_on_main(kernel:any){
let workspace:any,commit:any,main_tip:any,result:any,line:any,sealed_tip:any,meta:any,main:any,side:any,state:any,checkpoint:any;
(await pyInvoke(play_to_turn,[kernel,3],{}));
workspace=kernel.workspace;
commit=(await pyInvoke(turn_commit,[kernel,2],{}));
main_tip=(await pyInvoke(git,[workspace,"rev-parse","--short","wl/main"],{}));
result=(await pyMethod(kernel,"table",["branch"],{"commit":commit,"name":"side"}));
assert.ok(pyBool((pyAt(result,"ok")===true)),"tests/kernel/test_table_branch.py:93 assert result[\"ok\"] is True");
assert.ok(pyBool(pyEqual(pyAt(result,"active"),"side")),"tests/kernel/test_table_branch.py:94 assert result[\"active\"] == \"side\"");
assert.ok(pyBool(pyEqual(pyAt(result,"branched_from"),({["line"]:"main",["turn"]:2,["commit"]:commit}))),"tests/kernel/test_table_branch.py:95 assert result[\"branched_from\"] == {\"line\": \"main\", \"turn\": 2, \"commit\": commit}");
line=pyAt(result,"line");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(line,"name"),"side");return pyBool(__left)?pyEqual(pyAt(line,"kind"),"if"):__left;})());return pyBool(__left)?pyEqual(pyAt(line,"loop"),0):__left;})())),"tests/kernel/test_table_branch.py:97 assert line[\"name\"] == \"side\" and line[\"kind\"] == \"if\" and line[\"loop\"] == 0");
assert.ok(pyBool(pyEqual(pyAt(line,"forked_from"),({["line"]:"main",["turn"]:2,["commit"]:commit}))),"tests/kernel/test_table_branch.py:98 assert line[\"forked_from\"] == {\"line\": \"main\", \"turn\": 2, \"commit\": commit}");
assert.ok(pyBool(pyEqual((await pyInvoke(head_ref,[workspace],{})),"refs/heads/wl/side")),"tests/kernel/test_table_branch.py:103 assert head_ref(workspace) == \"refs/heads/wl/side\"");
assert.ok(pyBool(pyEqual((await pyInvoke(branches,[workspace],{})),["refs/heads/wl/main","refs/heads/wl/side"])),"tests/kernel/test_table_branch.py:104 assert branches(workspace) == [\"refs/heads/wl/main\", \"refs/heads/wl/side\"]");
sealed_tip=(await pyInvoke(git,[workspace,"rev-parse","--short","wl/main"],{}));
(await pyInvoke(git,[workspace,"merge-base","--is-ancestor",main_tip,"wl/main"],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(json,"loads",[(await pyInvoke(blob,[workspace,"wl/main","turns/0003.json"],{}))],{})),"closed_by"),"narrate")),"tests/kernel/test_table_branch.py:107 assert json.loads(blob(workspace, \"wl/main\", \"turns/0003.json\"))[\"closed_by\"] == \"narrate\"");
meta=(await pyInvoke(meta_of,[kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(meta,"active_worldline"),"side")),"tests/kernel/test_table_branch.py:110 assert meta[\"active_worldline\"] == \"side\"");
main=pyAt(pyAt(meta,"worldlines"),"main");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(main,"status"),"dormant");return pyBool(__left)?pyEqual(pyAt(main,"last_turn"),3):__left;})());return pyBool(__left)?pyEqual(pyAt(main,"last_commit"),sealed_tip):__left;})())),"tests/kernel/test_table_branch.py:112 assert main[\"status\"] == \"dormant\" and main[\"last_turn\"] == 3 and main[\"last_commit\"] == sealed_tip");
side=pyAt(pyAt(meta,"worldlines"),"side");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(side,"kind"),"if");return pyBool(__left)?pyEqual(pyAt(side,"loop"),0):__left;})());return pyBool(__left)?pyEqual(pyAt(side,"status"),"active"):__left;})())),"tests/kernel/test_table_branch.py:114 assert side[\"kind\"] == \"if\" and side[\"loop\"] == 0 and side[\"status\"] == \"active\"");
assert.ok(pyBool(pyEqual(pyAt(side,"forked_from"),({["line"]:"main",["turn"]:2,["commit"]:commit}))),"tests/kernel/test_table_branch.py:115 assert side[\"forked_from\"] == {\"line\": \"main\", \"turn\": 2, \"commit\": commit}");
assert.ok(pyBool(pyEqual(pyAt(side,"seed"),pySlice((await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod(`${CAMPAIGN}:side:${commit}`,"encode",[],{}))],{})),"hexdigest",[],{})),undefined,16))),"tests/kernel/test_table_branch.py:116 assert side[\"seed\"] == hashlib.sha256(f\"{CAMPAIGN}:side:{commit}\".encode()).hexdigest()[:16]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(json,"loads",[(await pyInvoke(blob,[workspace,"wl/side","turns/0002.json"],{}))],{})),"closed_by"),"narrate")),"tests/kernel/test_table_branch.py:120 assert json.loads(blob(workspace, \"wl/side\", \"turns/0002.json\"))[\"closed_by\"] == \"narrate\"");
state=(await pyInvoke(turn_json,[kernel],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(state,"turn"),3);return pyBool(__left)?pyEqual(pyAt(state,"state"),"awaiting_player"):__left;})())),"tests/kernel/test_table_branch.py:122 assert state[\"turn\"] == 3 and state[\"state\"] == \"awaiting_player\"");
checkpoint=(await pyInvoke(read_json,[pyDivide(pyDivide(pyDivide((await pyInvoke(campaign_dir,[workspace],{})),"save"),"continuation"),"latest.json")],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(checkpoint,"worldline"),"side");return pyBool(__left)?pyEqual(pyAt(checkpoint,"turn"),2):__left;})())),"tests/kernel/test_table_branch.py:126 assert checkpoint[\"worldline\"] == \"side\" and checkpoint[\"turn\"] == 2");
}
Object.defineProperty(test_branch_from_a_mid_history_commit_on_main,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_branch_from_a_mid_history_commit_on_main"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_branch_from_a_mid_history_commit_on_main(await kernel(t,{}));});
export async function test_branch_from_a_commit_that_lives_on_a_dormant_line(kernel:any){
let commit:any,workspace:any,result:any,meta:any;

(await pyInvoke(play_to_turn,[kernel,2],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我要换一条路走。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t3-c1","effects":[({["kind"]:"fork",["name"]:"other",["mode"]:"if"})]}));
(await pyInvoke(narrate,[kernel,"t3-c2","眼前一黑，世界换了一条线。"],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"继续走。"}));
(await pyInvoke(narrate,[kernel,"t4-c1","你继续走。"],{}));
commit=(await pyInvoke(turn_commit,[kernel,4],{}));
workspace=kernel.workspace;
assert.ok(pyBool(pyEqual((await pyInvoke(git,[workspace,"symbolic-ref","HEAD"],{})),"refs/heads/wl/other")),"tests/kernel/test_table_branch.py:139 assert git(workspace, \"symbolic-ref\", \"HEAD\") == \"refs/heads/wl/other\"");
result=(await pyMethod(kernel,"table",["branch"],{"commit":commit,"name":"side"}));
assert.ok(pyBool(pyEqual(pyAt(result,"branched_from"),({["line"]:"other",["turn"]:4,["commit"]:commit}))),"tests/kernel/test_table_branch.py:142 assert result[\"branched_from\"] == {\"line\": \"other\", \"turn\": 4, \"commit\": commit}");
meta=(await pyInvoke(meta_of,[kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(meta,"active_worldline"),"side")),"tests/kernel/test_table_branch.py:144 assert meta[\"active_worldline\"] == \"side\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(meta,"worldlines"),"other"),"status"),"dormant")),"tests/kernel/test_table_branch.py:145 assert meta[\"worldlines\"][\"other\"][\"status\"] == \"dormant\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(meta,"worldlines"),"main"),"status"),"dormant")),"tests/kernel/test_table_branch.py:146 assert meta[\"worldlines\"][\"main\"][\"status\"] == \"dormant\"");
assert.ok(pyBool(pyEqual((await pyInvoke(branches,[workspace],{})),["refs/heads/wl/main","refs/heads/wl/other","refs/heads/wl/side"])),"tests/kernel/test_table_branch.py:147 assert branches(workspace) == [\"refs/heads/wl/main\", \"refs/heads/wl/other\", \"refs/heads/wl/side\"]");
}
Object.defineProperty(test_branch_from_a_commit_that_lives_on_a_dormant_line,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_branch_from_a_commit_that_lives_on_a_dormant_line"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_branch_from_a_commit_that_lives_on_a_dormant_line(await kernel(t,{}));});
export async function test_replaying_the_same_branch_call_is_a_noop(kernel:any){
let commit:any,first:any,tip:any,second:any;
(await pyInvoke(play_to_turn,[kernel,2],{}));
commit=(await pyInvoke(turn_commit,[kernel,1],{}));
first=(await pyMethod(kernel,"table",["branch"],{"commit":commit,"name":"side"}));
tip=(await pyInvoke(git,[kernel.workspace,"rev-parse","wl/side"],{}));
second=(await pyMethod(kernel,"table",["branch"],{"commit":commit,"name":"side"}));
assert.ok(pyBool(pyEqual(second,first)),"tests/kernel/test_table_branch.py:156 assert second == first");
assert.ok(pyBool(pyEqual((await pyInvoke(branches,[kernel.workspace],{})),["refs/heads/wl/main","refs/heads/wl/side"])),"tests/kernel/test_table_branch.py:157 assert branches(kernel.workspace) == [\"refs/heads/wl/main\", \"refs/heads/wl/side\"]");
assert.ok(pyBool(pyEqual((await pyInvoke(git,[kernel.workspace,"rev-parse","wl/side"],{})),tip)),"tests/kernel/test_table_branch.py:158 assert git(kernel.workspace, \"rev-parse\", \"wl/side\") == tip");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(meta_of,[kernel],{})),"active_worldline"),"side")),"tests/kernel/test_table_branch.py:159 assert meta_of(kernel)[\"active_worldline\"] == \"side\"");
}
Object.defineProperty(test_replaying_the_same_branch_call_is_a_noop,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_replaying_the_same_branch_call_is_a_noop"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_replaying_the_same_branch_call_is_a_noop(await kernel(t,{}));});
export async function test_branch_refuses_while_a_turn_is_open(kernel:any){
let commit:any,error:any;
(await pyInvoke(play_to_turn,[kernel,2],{}));
commit=(await pyInvoke(turn_commit,[kernel,1],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我还没说完。"}));
error=(await pyMethod(kernel,"table_err",["branch"],{"commit":commit,"name":"side"}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"operation_in_progress")),"tests/kernel/test_table_branch.py:167 assert error[\"code\"] == \"operation_in_progress\"");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(meta_of,[kernel],{})),"active_worldline"),"main")),"tests/kernel/test_table_branch.py:168 assert meta_of(kernel)[\"active_worldline\"] == \"main\"");
assert.ok(pyBool(pyEqual((await pyInvoke(branches,[kernel.workspace],{})),["refs/heads/wl/main"])),"tests/kernel/test_table_branch.py:169 assert branches(kernel.workspace) == [\"refs/heads/wl/main\"]");
}
Object.defineProperty(test_branch_refuses_while_a_turn_is_open,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_branch_refuses_while_a_turn_is_open"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_branch_refuses_while_a_turn_is_open(await kernel(t,{}));});
export async function test_branch_refuses_a_commit_no_line_reaches(kernel:any){
let error:any;
(await pyInvoke(play_to_turn,[kernel,2],{}));
error=(await pyMethod(kernel,"table_err",["branch"],{"commit":pyMultiply("0",40),"name":"side"}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_table_branch.py:175 assert error[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"commit"),pyMultiply("0",40))),"tests/kernel/test_table_branch.py:176 assert error[\"details\"][\"commit\"] == \"0\" * 40");
error=(await pyMethod(kernel,"table_err",["branch"],{"commit":"deadbeefdeadbeef","name":"side"}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_table_branch.py:178 assert error[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"commit"),"deadbeefdeadbeef")),"tests/kernel/test_table_branch.py:179 assert error[\"details\"][\"commit\"] == \"deadbeefdeadbeef\"");
}
Object.defineProperty(test_branch_refuses_a_commit_no_line_reaches,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_branch_refuses_a_commit_no_line_reaches"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_branch_refuses_a_commit_no_line_reaches(await kernel(t,{}));});
export async function test_branch_mints_a_name_from_the_fork_turn(kernel:any){
let commit:any,result:any,name:any,other:any;
(await pyInvoke(play_to_turn,[kernel,3],{}));
commit=(await pyInvoke(turn_commit,[kernel,2],{}));
result=(await pyMethod(kernel,"table",["branch"],{"commit":commit}));
name=pyAt(pyAt(result,"line"),"name");
assert.ok(pyBool(pyEqual(name,"if-2-1")),"tests/kernel/test_table_branch.py:187 assert name == \"if-2-1\"");
assert.ok(pyBool(pyEqual(pyAt(result,"active"),name)),"tests/kernel/test_table_branch.py:188 assert result[\"active\"] == name");
other=(await pyMethod(kernel,"table",["branch"],{"commit":commit}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(other,"line"),"name"),"if-2-2")),"tests/kernel/test_table_branch.py:191 assert other[\"line\"][\"name\"] == \"if-2-2\"");
}
Object.defineProperty(test_branch_mints_a_name_from_the_fork_turn,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_branch_mints_a_name_from_the_fork_turn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_branch_mints_a_name_from_the_fork_turn(await kernel(t,{}));});
export async function test_branch_refuses_a_name_that_collides(kernel:any){
let commit:any,error:any;
(await pyInvoke(play_to_turn,[kernel,2],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我要换一条路走。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t3-c1","effects":[({["kind"]:"fork",["name"]:"side",["mode"]:"if"})]}));
(await pyInvoke(narrate,[kernel,"t3-c2","眼前一黑，世界换了一条线。"],{}));
commit=(await pyInvoke(turn_commit,[kernel,1],{}));
error=(await pyMethod(kernel,"table_err",["branch"],{"commit":commit,"name":"side"}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_table_branch.py:201 assert error[\"code\"] == \"invalid_params\"");
}
Object.defineProperty(test_branch_refuses_a_name_that_collides,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_branch_refuses_a_name_that_collides"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_branch_refuses_a_name_that_collides(await kernel(t,{}));});
export async function test_branch_lands_the_label_on_the_worldline_forked_event(kernel:any){
let commit:any,forked:any;
(await pyInvoke(play_to_turn,[kernel,2],{}));
commit=(await pyInvoke(turn_commit,[kernel,1],{}));
(await pyMethod(kernel,"table",["branch"],{"commit":commit,"name":"side","label":"回到那个下午。"}));
forked=(await (async()=>{const __rows:any[]=[];for(const event of pyIterable((await pyInvoke(read_jsonl,[pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"events.jsonl")],{})))){if(pyBool(pyEqual(pyAt(event,"type"),"worldline-forked"))){__rows.push(event);}}return __rows;})());
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[forked],{})),1)),"tests/kernel/test_table_branch.py:210 assert len(forked) == 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(forked,0),"data"),"label"),"回到那个下午。")),"tests/kernel/test_table_branch.py:211 assert forked[0][\"data\"][\"label\"] == \"回到那个下午。\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(forked,0),"data"),"from"),({["line"]:"main",["turn"]:1,["commit"]:commit}))),"tests/kernel/test_table_branch.py:212 assert forked[0][\"data\"][\"from\"] == {\"line\": \"main\", \"turn\": 1, \"commit\": commit}");
}
Object.defineProperty(test_branch_lands_the_label_on_the_worldline_forked_event,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_branch_lands_the_label_on_the_worldline_forked_event"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_branch_lands_the_label_on_the_worldline_forked_event(await kernel(t,{}));});
export async function test_a_replay_that_switches_back_still_announces_the_branch_once(kernel:any){
let first:any,result:any,replay:any;
(await pyInvoke(play_to_turn,[kernel,2],{}));
first=(await pyInvoke(turn_commit,[kernel,1],{}));
(await pyMethod(kernel,"table",["branch"],{"commit":first,"name":"side"}));
result=(await pyMethod(kernel,"table",["player_input"],{"text":"从这里再看看。"}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"capsule"),"branched"),({["name"]:"side",["from_line"]:"main",["from_turn"]:1}))),"tests/kernel/test_table_branch.py:221 assert result[\"capsule\"][\"branched\"] == {\"name\": \"side\", \"from_line\": \"main\", \"from_turn\": 1}");
(await pyInvoke(narrate,[kernel,"t2-c1","你回到了那个下午。"],{}));
(await pyMethod(kernel,"table",["branch"],{"commit":first,"name":"other"}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(meta_of,[kernel],{})),"active_worldline"),"other")),"tests/kernel/test_table_branch.py:224 assert meta_of(kernel)[\"active_worldline\"] == \"other\"");
replay=(await pyMethod(kernel,"table",["branch"],{"commit":first,"name":"side"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(replay,"active"),"side");return pyBool(__left)?pyEqual(pyAt((await pyInvoke(meta_of,[kernel],{})),"active_worldline"),"side"):__left;})())),"tests/kernel/test_table_branch.py:227 assert replay[\"active\"] == \"side\" and meta_of(kernel)[\"active_worldline\"] == \"side\"");
result=(await pyMethod(kernel,"table",["player_input"],{"text":"我又回来了。"}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"capsule"),"branched"),({["name"]:"side",["from_line"]:"main",["from_turn"]:1}))),"tests/kernel/test_table_branch.py:229 assert result[\"capsule\"][\"branched\"] == {\"name\": \"side\", \"from_line\": \"main\", \"from_turn\": 1}");
(await pyInvoke(narrate,[kernel,"t3-c1","还是那条岔路。"],{}));
result=(await pyMethod(kernel,"table",["player_input"],{"text":"继续。"}));
assert.ok(pyBool(!pyContains(pyAt(result,"capsule"),"branched")),"tests/kernel/test_table_branch.py:232 assert \"branched\" not in result[\"capsule\"]");
}
Object.defineProperty(test_a_replay_that_switches_back_still_announces_the_branch_once,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_replay_that_switches_back_still_announces_the_branch_once"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_replay_that_switches_back_still_announces_the_branch_once(await kernel(t,{}));});
export async function test_the_next_player_input_capsule_carries_the_branched_section_exactly_once(kernel:any){
let commit:any,result:any,branched:any;
(await pyInvoke(play_to_turn,[kernel,2],{}));
commit=(await pyInvoke(turn_commit,[kernel,1],{}));
(await pyMethod(kernel,"table",["branch"],{"commit":commit,"name":"side"}));
result=(await pyMethod(kernel,"table",["player_input"],{"text":"我从这里重新走。"}));
branched=pyAt(pyAt(result,"capsule"),"branched");
assert.ok(pyBool(pyEqual(branched,({["name"]:"side",["from_line"]:"main",["from_turn"]:1}))),"tests/kernel/test_table_branch.py:241 assert branched == {\"name\": \"side\", \"from_line\": \"main\", \"from_turn\": 1}");
(await pyInvoke(narrate,[kernel,"t2-c1","你回到了那个下午。"],{}));
result=(await pyMethod(kernel,"table",["player_input"],{"text":"再看看。"}));
assert.ok(pyBool(!pyContains(pyAt(result,"capsule"),"branched")),"tests/kernel/test_table_branch.py:244 assert \"branched\" not in result[\"capsule\"]");
}
Object.defineProperty(test_the_next_player_input_capsule_carries_the_branched_section_exactly_once,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_next_player_input_capsule_carries_the_branched_section_exactly_once"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_next_player_input_capsule_carries_the_branched_section_exactly_once(await kernel(t,{}));});
export async function test_host_switch_restores_both_lines_and_preserves_their_turns(kernel:any){
let original:any;
(await pyInvoke(play_to_turn,[kernel,3],{}));
original=(await pyInvoke(turn_commit,[kernel,2],{}));
(await pyMethod(kernel,"table",["branch"],{"commit":original,"name":"alternate"}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["switch"],{"line":"main"})),"active"),"main")),"tests/kernel/test_table_branch.py:251 assert kernel.table('switch', line='main')['active'] == 'main'");
assert.ok(pyBool(pyEqual((await pyInvoke(head_ref,[kernel.workspace],{})),"refs/heads/wl/main")),"tests/kernel/test_table_branch.py:252 assert head_ref(kernel.workspace) == 'refs/heads/wl/main'");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["switch"],{"line":"alternate"})),"active"),"alternate")),"tests/kernel/test_table_branch.py:253 assert kernel.table('switch', line='alternate')['active'] == 'alternate'");
assert.ok(pyBool(pyEqual((await pyInvoke(head_ref,[kernel.workspace],{})),"refs/heads/wl/alternate")),"tests/kernel/test_table_branch.py:254 assert head_ref(kernel.workspace) == 'refs/heads/wl/alternate'");
assert.ok(pyBool((pyAt((await pyMethod(kernel,"table",["switch"],{"line":"alternate"})),"ok")===true)),"tests/kernel/test_table_branch.py:255 assert kernel.table('switch', line='alternate')['ok'] is True");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyInvoke(meta_of,[kernel],{})),"worldlines"),"main"),"status"),"dormant")),"tests/kernel/test_table_branch.py:256 assert meta_of(kernel)['worldlines']['main']['status'] == 'dormant'");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(json,"loads",[(await pyInvoke(blob,[kernel.workspace,"wl/main","turns/0003.json"],{}))],{})),"closed_by"),"narrate")),"tests/kernel/test_table_branch.py:257 assert json.loads(blob(kernel.workspace, 'wl/main', 'turns/0003.json'))['closed_by'] == 'narrate'");
}
Object.defineProperty(test_host_switch_restores_both_lines_and_preserves_their_turns,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_host_switch_restores_both_lines_and_preserves_their_turns"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_host_switch_restores_both_lines_and_preserves_their_turns(await kernel(t,{}));});
export async function test_host_switch_refuses_during_a_turn_without_changing_the_active_line(kernel:any){
(await pyInvoke(play_to_turn,[kernel,2],{}));
(await pyMethod(kernel,"table",["branch"],{"commit":(await pyInvoke(turn_commit,[kernel,1],{})),"name":"alternate"}));
(await pyMethod(kernel,"table",["player_input"],{"text":"I inspect the door."}));
let __success11760=false;try{(await pyMethod(kernel,"table",["switch"],{"line":"main"}));__success11760=true;}catch(error){assert.ok(pyBool(pyContains((await pyInvoke(pyStr,[error],{})),"operation_in_progress")),"tests/kernel/test_table_branch.py:267 assert 'operation_in_progress' in str(error)");}if(__success11760){throw new Error("raise AssertionError('An open turn must prevent switching')");}
assert.ok(pyBool(pyEqual((await pyInvoke(head_ref,[kernel.workspace],{})),"refs/heads/wl/alternate")),"tests/kernel/test_table_branch.py:270 assert head_ref(kernel.workspace) == 'refs/heads/wl/alternate'");
}
Object.defineProperty(test_host_switch_refuses_during_a_turn_without_changing_the_active_line,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_host_switch_refuses_during_a_turn_without_changing_the_active_line"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_host_switch_refuses_during_a_turn_without_changing_the_active_line(await kernel(t,{}));});
