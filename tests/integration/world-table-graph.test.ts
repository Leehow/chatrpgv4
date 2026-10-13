// Migrated from tests/kernel/test_table_graph.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {datetime,timedelta,CAMPAIGN,CONTENT_DIR,RpcClient,campaign_dir,narrate,narrate_opening,read_json,repo_dir,snapshot,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,retainedFixture,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,pyType,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_table_graph.py',import.meta.url).pathname;










export let ROOT:any=pyAt((await pyMethod((await pyInvoke(Path,[__file__],{})),"resolve",[],{})).parents,2);
export let TS_COMMAND:any=["node",(await pyInvoke(pyStr,[pyDivide(ROOT,"build/kernel/rpc.mjs")],{}))];


export let CLOCK_BASE:any=(await pyInvoke(datetime,[1920,10,12,10,0],{}));
export async function expected_when(minutes:any){
let at:any;
at=pyAdd(CLOCK_BASE,(await pyInvoke(timedelta,[],{"minutes":minutes})));
return ({["y"]:at.year,["mo"]:at.month,["d"]:at.day,["hh"]:at.hour,["mm"]:at.minute});
}
Object.defineProperty(expected_when,"__pySignature",{value:[{"name":"minutes","rest":false,"varargs":false}]});
export async function ts_client(workspace:any,env:any=null){
// Always compile and launch the current native TS kernel, independent of stale build output.
return (new RpcClient(workspace,({"env":env})));
}
Object.defineProperty(ts_client,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false},{"name":"env","rest":false,"varargs":false}]});
export async function git(workspace:any,args:any){
let result:any;
result=(await pyMethod(subprocess,"run",[["git","-c","user.name=coc-test","-c","user.email=test@coc.invalid",`--git-dir=${(await pyInvoke(repo_dir,[workspace],{}))}`,`--work-tree=${(await pyInvoke(campaign_dir,[workspace],{}))}`,...args]],{"capture_output":true,"text":true,"check":true}));
return (await pyMethod(result.stdout,"strip",[],{}));
}
Object.defineProperty(git,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false},{"name":"args","rest":false,"varargs":true}]});
export async function create(client:any){
(await pyMethod(client,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["pregen"]:"thomas-hayes",["play_language"]:"en"})],{}));
}
Object.defineProperty(create,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function play(client:any,turns:any){
let number:any;

(await pyInvoke(create,[client],{}));
(await pyMethod(client,"table",["open"],{}));
(await pyInvoke(narrate_opening,[client,"The case begins.\n\nA letter waits on the desk."],{}));
for(number of pyIterable((await pyInvoke(pyRange,[1,pyAdd(turns,1)],{})))){
(await pyMethod(client,"table",["player_input"],{"text":`Turn ${number}: I look around.`}));
(await pyInvoke(narrate,[client,`t${number}-c1`,`You look around the room, turn ${number}.`],{}));
}
}
Object.defineProperty(play,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"turns","rest":false,"varargs":false}]});
export async function fork(client:any,turn:any,name:any,from_turn:any){

(await pyMethod(client,"table",["player_input"],{"text":"I take the other road."}));
(await pyMethod(client,"table",["apply"],{"call_id":`t${turn}-c1`,"effects":[({["kind"]:"fork",["name"]:name,["mode"]:"if",["from_turn"]:from_turn})]}));
(await pyInvoke(narrate,[client,`t${turn}-c2`,"The world shifts underfoot."],{}));
}
Object.defineProperty(fork,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"turn","rest":false,"varargs":false},{"name":"name","rest":false,"varargs":false},{"name":"from_turn","rest":false,"varargs":false}]});
export async function graph(client:any,params:any={}){
return (await pyMethod(client,"table",["graph"],{...params}));
}
Object.defineProperty(graph,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"params","rest":true,"varargs":false}]});
export async function by_sha(result:any){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(result,"nodes"))){__rows.push([pyAt(node,"sha"),node]);}return __rows;})()));
}
Object.defineProperty(by_sha,"__pySignature",{value:[{"name":"result","rest":false,"varargs":false}]});
export async function line_refs(workspace:any){
let refs:any;

refs=(await pyInvoke(git,[workspace,"for-each-ref","--format=%(objectname:short) %(refname:strip=3)","refs/heads/wl/"],{}));
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [sha,name] of pyIterable((await (async()=>{const __rows:any[]=[];for(const line of pyIterable((await pyMethod(refs,"splitlines",[],{})))){__rows.push((await pyMethod(line,"split",[],{})));}return __rows;})()))){__rows.push([name,sha]);}return __rows;})()));
}
Object.defineProperty(line_refs,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false}]});
export async function turn_clock(workspace:any,turn:any){
return pyAt(pyAt(pyAt((await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[workspace],{})),"turns"),`${pyFormat(turn,"04d")}.json`)],{})),"world"),"clock"),"minutes");
}
Object.defineProperty(turn_clock,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false},{"name":"turn","rest":false,"varargs":false}]});
export async function* client(tmp_path:any){
let session:any;
session=(await pyInvoke(ts_client,[pyDivide(tmp_path,"ws")],{}));
yield session;
(await pyMethod(session,"close",[],{}));
}
Object.defineProperty(client,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});

export async function test_shape_and_setup_before_opening(client:any){
let result:any,main:any,node:any;
(await pyInvoke(create,[client],{}));
(await pyMethod(client,"table",["open"],{}));
result=(await pyInvoke(graph,[client],{}));
assert.ok(pyBool(pyEqual(pyAt(result,"campaign"),CAMPAIGN)),"tests/kernel/test_table_graph.py:100 assert result[\"campaign\"] == CAMPAIGN");
assert.ok(pyBool(pyEqual(pyAt(result,"active"),"main")),"tests/kernel/test_table_graph.py:101 assert result[\"active\"] == \"main\"");
assert.ok(pyBool((pyAt(result,"truncated")===false)),"tests/kernel/test_table_graph.py:102 assert result[\"truncated\"] is False");
main=(await (async()=>{const __rows:any[]=[];for(const line of pyIterable(pyAt(result,"lines"))){if(pyBool(pyEqual(pyAt(line,"name"),"main"))){__rows.push(line);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual((await pyInvoke(pyLen,[main],{})),1);return pyBool(__left)?pyEqual(pyAt(pyAt(main,0),"kind"),"main"):__left;})());return pyBool(__left)?pyEqual(pyAt(pyAt(main,0),"status"),"active"):__left;})())),"tests/kernel/test_table_graph.py:104 assert len(main) == 1 and main[0][\"kind\"] == \"main\" and main[0][\"status\"] == \"active\"");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(main,0),"forked_from")===null);return pyBool(__left)?pyEqual(pyAt(pyAt(main,0),"parents"),[]):__left;})())),"tests/kernel/test_table_graph.py:105 assert main[0][\"forked_from\"] is None and main[0][\"parents\"] == []");
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[pyAt(result,"nodes")],{})),1)),"tests/kernel/test_table_graph.py:106 assert len(result[\"nodes\"]) == 1");
node=pyAt(pyAt(result,"nodes"),0);
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(node,"kind"),"setup");return pyBool(__left)?(pyAt(node,"turn")===null):__left;})());return pyBool(__left)?pyEqual(pyAt(node,"parents"),[]):__left;})())),"tests/kernel/test_table_graph.py:108 assert node[\"kind\"] == \"setup\" and node[\"turn\"] is None and node[\"parents\"] == []");
assert.ok(pyBool(pyEqual(pyAt(node,"clock"),0)),"tests/kernel/test_table_graph.py:109 assert node[\"clock\"] == 0");
assert.ok(pyBool(pyEqual(pyAt(node,"when"),(await pyInvoke(expected_when,[0],{})))),"tests/kernel/test_table_graph.py:110 assert node[\"when\"] == expected_when(0)");
assert.ok(pyBool(pyEqual(pyAt(node,"tip_of"),["main"])),"tests/kernel/test_table_graph.py:111 assert node[\"tip_of\"] == [\"main\"]");
assert.ok(pyBool((await (async()=>{const __left=(await pyInvoke(pyIsInstance,[pyAt(node,"at"),pyStr],{}));return pyBool(__left)?pyAt(node,"at"):__left;})())),"tests/kernel/test_table_graph.py:112 assert isinstance(node[\"at\"], str) and node[\"at\"]");
assert.ok(pyBool(pyAt(node,"title")),"tests/kernel/test_table_graph.py:113 assert node[\"title\"]");
}
Object.defineProperty(test_shape_and_setup_before_opening,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_shape_and_setup_before_opening"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_shape_and_setup_before_opening(await acquireFixture(t,()=>client(temporary)));});
export async function test_game_clock_mod_uses_the_current_world_and_normal_activation(client:any){
let initial:any,result:any,disabled:any;
(await pyInvoke(play,[client,0],{}));
initial=pyAt((await pyInvoke(graph,[client],{})),"clock_mod");
assert.ok(pyBool(pyEqual(initial,({["enabled"]:true,["when"]:(await pyInvoke(expected_when,[0],{})),["turn"]:pyAt((await pyMethod(client,"table",["view"],{})),"turn")}))),"tests/kernel/test_table_graph.py:119 assert initial == {\"enabled\": True, \"when\": expected_when(0), \"turn\": client.table(\"view\")[\"turn\"]}");
(await pyMethod(client,"table",["player_input"],{"text":"I wait for half an hour."}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:30})]}));
(await pyInvoke(narrate,[client,"t1-c2","Half an hour passes."],{}));
result=(await pyInvoke(graph,[client],{}));
assert.ok(pyBool(pyEqual(pyAt(result,"clock_mod"),({["enabled"]:true,["when"]:(await pyInvoke(expected_when,[30],{})),["turn"]:pyAt((await pyMethod(client,"table",["view"],{})),"turn")}))),"tests/kernel/test_table_graph.py:124 assert result[\"clock_mod\"] == {\"enabled\": True, \"when\": expected_when(30), \"turn\": client.table(\"view\")[\"turn\"]}");
assert.ok(pyBool(pyEqual(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(result,"nodes"))){if(pyBool(pyEqual(pyAt(node,"turn"),0))){__rows.push(node);}}return __rows;})()))),"when"),(await pyInvoke(expected_when,[0],{})))),"tests/kernel/test_table_graph.py:125 assert next(node for node in result[\"nodes\"] if node[\"turn\"] == 0)[\"when\"] == expected_when(0)");
(await pyMethod(client,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:"game-clock",["enabled"]:false})],{}));
disabled=pyAt((await pyInvoke(graph,[client],{})),"clock_mod");
assert.ok(pyBool(pyEqual(disabled,({...pyAt(result,"clock_mod"),["enabled"]:false}))),"tests/kernel/test_table_graph.py:128 assert disabled == {**result[\"clock_mod\"], \"enabled\": False}");
(await pyMethod(client,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:"game-clock",["enabled"]:true})],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(graph,[client],{})),"clock_mod"),pyAt(result,"clock_mod"))),"tests/kernel/test_table_graph.py:130 assert graph(client)[\"clock_mod\"] == result[\"clock_mod\"]");
}
Object.defineProperty(test_game_clock_mod_uses_the_current_world_and_normal_activation,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_game_clock_mod_uses_the_current_world_and_normal_activation"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_game_clock_mod_uses_the_current_world_and_normal_activation(await acquireFixture(t,()=>client(temporary)));});

export async function test_turn_nodes_clock_and_projection(client:any){
let result:any,nodes:any,turns:any,turn:any,node:any,clock:any,order:any,parent:any;
(await pyInvoke(play,[client,2],{}));
result=(await pyInvoke(graph,[client],{}));
nodes=(await pyInvoke(by_sha,[result],{}));
turns=new Map((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(result,"nodes"))){if(pyBool(pyEqual(pyAt(node,"kind"),"turn"))){__rows.push([pyAt(node,"turn"),node]);}}return __rows;})()));
assert.ok(pyBool(pyEqual((await pyInvoke(pySet,[turns],{})),new Set([0,1,2]))),"tests/kernel/test_table_graph.py:141 assert set(turns) == {0, 1, 2}");
for([turn,node] of pyIterable((await pyMethod(turns,"items",[],{})))){
clock=(await pyInvoke(turn_clock,[client.workspace,turn],{}));
assert.ok(pyBool(pyEqual(pyAt(node,"clock"),clock)),"tests/kernel/test_table_graph.py:144 assert node[\"clock\"] == clock");
assert.ok(pyBool(pyEqual(pyAt(node,"when"),(await pyInvoke(expected_when,[clock],{})))),"tests/kernel/test_table_graph.py:145 assert node[\"when\"] == expected_when(clock)");
assert.ok(pyBool(!pyBool((await pyMethod(pyAt(node,"title"),"startswith",[`turn ${turn}`],{})))),"tests/kernel/test_table_graph.py:146 assert not node[\"title\"].startswith(f\"turn {turn}\")");
assert.ok(pyBool(pyAt(node,"title")),"tests/kernel/test_table_graph.py:147 assert node[\"title\"]");
}
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(result,"nodes"))){if(pyBool((pyAt(node,"turn")===null))){__rows.push(pyEqual(pyAt(node,"kind"),"setup"));}}return __rows;})())))),"tests/kernel/test_table_graph.py:148 assert all(node[\"kind\"] == \"setup\" for node in result[\"nodes\"] if node[\"turn\"] is None)");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(result,"nodes"))){for(const parent of pyIterable(pyAt(node,"parents"))){__rows.push(pyContains(nodes,parent));}}return __rows;})())))),"tests/kernel/test_table_graph.py:150 assert all(parent in nodes for node in result[\"nodes\"] for parent in node[\"parents\"])");
order=(await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(result,"nodes"))){__rows.push(pyAt(node,"sha"));}return __rows;})());
for(node of pyIterable(pyAt(result,"nodes"))){
for(parent of pyIterable(pyAt(node,"parents"))){
assert.ok(pyBool(pyLess((await pyMethod(order,"index",[pyAt(node,"sha")],{})),(await pyMethod(order,"index",[parent],{})))),"tests/kernel/test_table_graph.py:155 assert order.index(node[\"sha\"]) < order.index(parent)");
}
}
}
Object.defineProperty(test_turn_nodes_clock_and_projection,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_turn_nodes_clock_and_projection"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_turn_nodes_clock_and_projection(await acquireFixture(t,()=>client(temporary)));});
export async function* undated_client(tmp_path:any,request:any){
let content:any,path:any,data:any,session:any;
content=pyDivide(tmp_path,"content");
(await pyMethod(shutil,"copytree",[CONTENT_DIR,content],{}));
async function remove_date(value:any){
let child:any;
if(pyBool((await pyInvoke(pyIsInstance,[value,pyDict],{})))){if(pyBool(pyContains(value,"start_clock"))){(await pyMethod(value,"pop",["start_clock"],{}));
(await pyMethod(value,"pop",["start_time",null],{}));
if(pyBool((request.param!==null))){value["start_time"]=request.param;}}
for(child of pyIterable((await pyMethod(value,"values",[],{})))){
(await pyInvoke(remove_date,[child],{}));
}}else if(pyBool((await pyInvoke(pyIsInstance,[value,pyList],{})))){for(child of pyIterable(value)){
(await pyInvoke(remove_date,[child],{}));
}}
}
Object.defineProperty(remove_date,"__pySignature",{value:[{"name":"value","rest":false,"varargs":false}]});
path=pyDivide(content,"starters/the-haunting/module-graph.json");
data=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{}))],{}));
(await pyInvoke(remove_date,[data],{}));
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[data],{}))],{}));
session=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":content})));
yield [session,request.param];
(await pyMethod(session,"close",[],{}));
}
Object.defineProperty(undated_client,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false},{"name":"request","rest":false,"varargs":false}]});
export async function test_undated_nodes_share_the_view_day_clock(undated_client:any){
let client:any,start_time:any,clock:any,node:any,expected:any,historical:any,base_minutes:any,minutes:any;
const __unpack7781=undated_client;client=__unpack7781[0];start_time=__unpack7781[1];
(await pyInvoke(play,[client,0],{}));
(await pyMethod(client,"table",["player_input"],{"text":"I wait for a while."}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:90})]}));
(await pyInvoke(narrate,[client,"t1-c2","The wait ends."],{}));
clock=pyAt((await pyMethod(client,"table",["view"],{})),"clock");
node=(await pyNext((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt((await pyInvoke(graph,[client],{})),"nodes"))){if(pyBool(pyEqual(pyAt(node,"turn"),1))){__rows.push(node);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __term0=pyAt(node,"clock");const __term1=pyAt(clock,"minutes");const __term2=90;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_table_graph.py:193 assert node[\"clock\"] == clock[\"minutes\"] == 90");
expected=(pyBool((start_time===null))?({["day"]:1,["hh"]:10,["mm"]:30}):({["day"]:2,["hh"]:1,["mm"]:0}));
assert.ok(pyBool(pyEqual(pyAt(node,"when"),expected)),"tests/kernel/test_table_graph.py:195 assert node[\"when\"] == expected");
assert.ok(pyBool(pyEqual(pyAt(node,"when"),Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const key of pyIterable(["day","hh","mm"])){__rows.push([key,(await pyInvoke(pyInt,[pyAt(clock,key)],{}))]);}return __rows;})())))),"tests/kernel/test_table_graph.py:196 assert node[\"when\"] == {key: int(clock[key]) for key in (\"day\", \"hh\", \"mm\")}");
for(historical of pyIterable(pyAt((await pyInvoke(graph,[client],{})),"nodes"))){
assert.ok(pyBool(pyEqual((await pyInvoke(pySet,[pyAt(historical,"when")],{})),new Set(["day","hh","mm"]))),"tests/kernel/test_table_graph.py:198 assert set(historical[\"when\"]) == {\"day\", \"hh\", \"mm\"}");
base_minutes=(pyBool((start_time===null))?pyMultiply(9,60):pyAdd(pyMultiply(23,60),30));
minutes=pyAdd(base_minutes,pyAt(historical,"clock"));
assert.ok(pyBool(pyEqual(pyAt(historical,"when"),({["day"]:pyAdd(Math.floor(minutes/1440),1),["hh"]:Math.floor((minutes%1440)/60),["mm"]:(minutes%60)}))),"tests/kernel/test_table_graph.py:201 assert historical[\"when\"] == {\"day\": minutes // 1440 + 1, \"hh\": minutes % 1440 // 60, \"mm\": minutes % 60}");
}
}
Object.defineProperty(test_undated_nodes_share_the_view_day_clock,"__pySignature",{value:[{"name":"undated_client","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("undated_client",[null,"23:30"]))).entries())test("test_undated_nodes_share_the_view_day_clock"+((pyCartesian([{}],pyParametrize("undated_client",[null,"23:30"]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_undated_nodes_share_the_view_day_clock(await acquireFixture(t,()=>undated_client(temporary,({param:row["undated_client"]}))));});
export async function test_pinned_nodes_backfill_setup_and_turn_zero_anchor(undated_client:any){
let client:any,start_time:any,before:any,nodes:any,node:any,at:any,expected:any,opening:any,setup:any,turn_zero:any,sha:any,old:any;
const __unpack8847=undated_client;client=__unpack8847[0];start_time=__unpack8847[1];
(await pyInvoke(play,[client,0],{}));
before=(await pyInvoke(by_sha,[(await pyInvoke(graph,[client],{}))],{}));
(await pyMethod(client,"table",["player_input"],{"text":"I wait for a while."}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clock",["local_datetime"]:`1975-07-12T${(await (async()=>{const __left=start_time;return pyBool(__left)?__left:"09:00";})())}`,["why"]:"The opening date is now established."}),({["kind"]:"time",["minutes"]:90})]}));
(await pyInvoke(narrate,[client,"t1-c2","The wait ends on the established date."],{}));
nodes=(await pyInvoke(by_sha,[(await pyInvoke(graph,[client],{}))],{}));
node=(await pyNext((await (async()=>{const __rows:any[]=[];for(const node of pyIterable((await pyMethod(nodes,"values",[],{})))){if(pyBool(pyEqual(pyAt(node,"turn"),1))){__rows.push(node);}}return __rows;})())));
at=(await pyMethod(datetime,"fromisoformat",[pyAt(pyAt((await pyMethod(client,"table",["view"],{})),"clock"),"at")],{}));
assert.ok(pyBool(pyEqual(pyAt(node,"clock"),90)),"tests/kernel/test_table_graph.py:218 assert node[\"clock\"] == 90");
expected=(pyBool((start_time===null))?({["y"]:1975,["mo"]:7,["d"]:12,["hh"]:10,["mm"]:30}):({["y"]:1975,["mo"]:7,["d"]:13,["hh"]:1,["mm"]:0}));
assert.ok(pyBool(pyEqual(pyAt(node,"when"),expected)),"tests/kernel/test_table_graph.py:220 assert node[\"when\"] == expected");
assert.ok(pyBool(pyEqual(pyAt(node,"when"),({["y"]:at.year,["mo"]:at.month,["d"]:at.day,["hh"]:at.hour,["mm"]:at.minute}))),"tests/kernel/test_table_graph.py:221 assert node[\"when\"] == {\"y\": at.year, \"mo\": at.month, \"d\": at.day, \"hh\": at.hour, \"mm\": at.minute}");
opening=(pyBool((start_time===null))?({["y"]:1975,["mo"]:7,["d"]:12,["hh"]:9,["mm"]:0}):({["y"]:1975,["mo"]:7,["d"]:12,["hh"]:23,["mm"]:30}));
setup=(await (async()=>{const __rows:any[]=[];for(const node of pyIterable((await pyMethod(before,"values",[],{})))){if(pyBool(pyEqual(pyAt(node,"kind"),"setup"))){__rows.push(node);}}return __rows;})());
turn_zero=(await pyNext((await (async()=>{const __rows:any[]=[];for(const node of pyIterable((await pyMethod(nodes,"values",[],{})))){if(pyBool(pyEqual(pyAt(node,"turn"),0))){__rows.push(node);}}return __rows;})())));
assert.ok(pyBool(setup),"tests/kernel/test_table_graph.py:225 assert setup");
assert.ok(pyBool(pyEqual(pyAt(turn_zero,"when"),opening)),"tests/kernel/test_table_graph.py:226 assert turn_zero[\"when\"] == opening");
for([sha,old] of pyIterable((await pyMethod(before,"items",[],{})))){
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(nodes,sha),"clock");const __term1=pyAt(old,"clock");const __term2=0;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_table_graph.py:228 assert nodes[sha][\"clock\"] == old[\"clock\"] == 0");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(nodes,sha),"when");const __term1=pyAt(turn_zero,"when");const __term2=opening;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_table_graph.py:229 assert nodes[sha][\"when\"] == turn_zero[\"when\"] == opening");
}
}
Object.defineProperty(test_pinned_nodes_backfill_setup_and_turn_zero_anchor,"__pySignature",{value:[{"name":"undated_client","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("undated_client",[null,"23:30"]))).entries())test("test_pinned_nodes_backfill_setup_and_turn_zero_anchor"+((pyCartesian([{}],pyParametrize("undated_client",[null,"23:30"]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_pinned_nodes_backfill_setup_and_turn_zero_anchor(await acquireFixture(t,()=>undated_client(temporary,({param:row["undated_client"]}))));});
export async function test_pinned_nodes_use_their_own_committed_anchor(undated_client:any){
let client:any,start_time:any,main:any,result:any,nodes:any,expected:any,alternate:any;
const __unpack10373=undated_client;client=__unpack10373[0];start_time=__unpack10373[1];
(await pyInvoke(play,[client,0],{}));
(await pyMethod(client,"table",["player_input"],{"text":"I establish the opening date."}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clock",["local_datetime"]:`1975-07-12T${(await (async()=>{const __left=start_time;return pyBool(__left)?__left:"09:00";})())}`,["why"]:"The main line begins on this date."}),({["kind"]:"time",["minutes"]:90})]}));
(await pyInvoke(narrate,[client,"t1-c2","Time passes on the main line."],{}));
main=(await pyNext((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt((await pyInvoke(graph,[client],{})),"nodes"))){if(pyBool(pyEqual(pyAt(node,"turn"),1))){__rows.push(node);}}return __rows;})())));
(await pyInvoke(fork,[client,2,"if-date"],{"from_turn":0}));
(await pyMethod(client,"table",["player_input"],{"text":"I establish the alternate opening date."}));
(await pyMethod(client,"table",["apply"],{"call_id":"t3-c1","effects":[({["kind"]:"clock",["local_datetime"]:`1975-07-20T${(await (async()=>{const __left=start_time;return pyBool(__left)?__left:"09:00";})())}`,["why"]:"The alternate line begins on another date."})]}));
(await pyInvoke(narrate,[client,"t3-c2","The alternate date is established."],{}));
result=(await pyInvoke(graph,[client],{}));
nodes=(await pyInvoke(by_sha,[result],{}));
assert.ok(pyBool(pyEqual(pyAt(result,"active"),"if-date")),"tests/kernel/test_table_graph.py:253 assert result[\"active\"] == \"if-date\"");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(nodes,pyAt(main,"sha")),"clock");const __term1=pyAt(main,"clock");const __term2=90;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_table_graph.py:254 assert nodes[main[\"sha\"]][\"clock\"] == main[\"clock\"] == 90");
expected=(pyBool((start_time===null))?({["y"]:1975,["mo"]:7,["d"]:12,["hh"]:10,["mm"]:30}):({["y"]:1975,["mo"]:7,["d"]:13,["hh"]:1,["mm"]:0}));
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(nodes,pyAt(main,"sha")),"when");const __term1=pyAt(main,"when");const __term2=expected;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_table_graph.py:256 assert nodes[main[\"sha\"]][\"when\"] == main[\"when\"] == expected");
alternate=(await pyNext((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(result,"nodes"))){if(pyBool(pyContains(pyAt(node,"tip_of"),"if-date"))){__rows.push(node);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(alternate,"kind"),"turn")),"tests/kernel/test_table_graph.py:258 assert alternate[\"kind\"] == \"turn\"");
assert.ok(pyBool(pyEqual(pyAt(alternate,"clock"),0)),"tests/kernel/test_table_graph.py:259 assert alternate[\"clock\"] == 0");
assert.ok(pyBool(pyEqual(pyAt(alternate,"when"),({["y"]:1975,["mo"]:7,["d"]:20,["hh"]:(pyBool((start_time===null))?9:23),["mm"]:(pyBool((start_time===null))?0:30)}))),"tests/kernel/test_table_graph.py:260 assert alternate[\"when\"] == {\"y\": 1975, \"mo\": 7, \"d\": 20, \"hh\": 9 if start_time is None else 23, \"mm\": 0 if start_time is None else 30}");
}
Object.defineProperty(test_pinned_nodes_use_their_own_committed_anchor,"__pySignature",{value:[{"name":"undated_client","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("undated_client",[null,"23:30"]))).entries())test("test_pinned_nodes_use_their_own_committed_anchor"+((pyCartesian([{}],pyParametrize("undated_client",[null,"23:30"]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_pinned_nodes_use_their_own_committed_anchor(await acquireFixture(t,()=>undated_client(temporary,({param:row["undated_client"]}))));});

export async function test_fork_lines_edges_and_tips(client:any){
let result:any,nodes:any,names:any,forked:any,fork_commit:any,children:any,refs:any,name:any,sha:any;
(await pyInvoke(play,[client,2],{}));
(await pyInvoke(fork,[client,3,"if-road"],{"from_turn":2}));
(await pyMethod(client,"table",["player_input"],{"text":"I keep walking."}));
(await pyInvoke(narrate,[client,"t4-c1","The new road holds."],{}));
result=(await pyInvoke(graph,[client],{}));
nodes=(await pyInvoke(by_sha,[result],{}));
names=new Set((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(pyAt(result,"lines"))){__rows.push(pyAt(line,"name"));}return __rows;})()));
assert.ok(pyBool(pyEqual(names,new Set(["main","if-road"]))),"tests/kernel/test_table_graph.py:274 assert names == {\"main\", \"if-road\"}");
assert.ok(pyBool(pyEqual(pyAt(result,"active"),"if-road")),"tests/kernel/test_table_graph.py:275 assert result[\"active\"] == \"if-road\"");
forked=(await pyNext((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(pyAt(result,"lines"))){if(pyBool(pyEqual(pyAt(line,"name"),"if-road"))){__rows.push(line);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(forked,"kind"),"if");return pyBool(__left)?pyEqual(pyAt(pyAt(forked,"forked_from"),"line"),"main"):__left;})());return pyBool(__left)?pyEqual(pyAt(pyAt(forked,"forked_from"),"turn"),2):__left;})())),"tests/kernel/test_table_graph.py:277 assert forked[\"kind\"] == \"if\" and forked[\"forked_from\"][\"line\"] == \"main\" and forked[\"forked_from\"][\"turn\"] == 2");
fork_commit=pyAt(pyAt(forked,"forked_from"),"commit");
assert.ok(pyBool(pyContains(nodes,fork_commit)),"tests/kernel/test_table_graph.py:279 assert fork_commit in nodes");
children=(await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(result,"nodes"))){if(pyBool(pyContains(pyAt(node,"parents"),fork_commit))){__rows.push(node);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=children;return pyBool(__left)?(await pyAny((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(children)){__rows.push(pyEqual(pyAt(node,"kind"),"worldline"));}return __rows;})()))):__left;})())),"tests/kernel/test_table_graph.py:282 assert children and any(node[\"kind\"] == \"worldline\" for node in children)");
refs=(await pyInvoke(line_refs,[client.workspace],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(pySet,[refs],{})),new Set(["main","if-road"]))),"tests/kernel/test_table_graph.py:285 assert set(refs) == {\"main\", \"if-road\"}");
for([name,sha] of pyIterable((await pyMethod(refs,"items",[],{})))){
assert.ok(pyBool((await (async()=>{const __left=pyContains(nodes,sha);return pyBool(__left)?pyContains(pyAt(pyAt(nodes,sha),"tip_of"),name):__left;})())),"tests/kernel/test_table_graph.py:287 assert sha in nodes and name in nodes[sha][\"tip_of\"]");
}
}
Object.defineProperty(test_fork_lines_edges_and_tips,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_fork_lines_edges_and_tips"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_fork_lines_edges_and_tips(await acquireFixture(t,()=>client(temporary)));});

export async function test_truncation_retains_tips(client:any){
let full:any,cut:any,tips:any;
(await pyInvoke(play,[client,3],{}));
full=(await pyInvoke(graph,[client],{}));
assert.ok(pyBool((pyAt(full,"truncated")===false)),"tests/kernel/test_table_graph.py:296 assert full[\"truncated\"] is False");
cut=(await pyInvoke(graph,[client],{"max_nodes":2}));
assert.ok(pyBool((pyAt(cut,"truncated")===true)),"tests/kernel/test_table_graph.py:298 assert cut[\"truncated\"] is True");
assert.ok(pyBool(pyLessEqual(2,(await pyInvoke(pyLen,[pyAt(cut,"nodes")],{})))),"tests/kernel/test_table_graph.py:299 assert len(cut[\"nodes\"]) >= 2");
tips=(await pyInvoke(pySet,[(await pyMethod((await pyInvoke(line_refs,[client.workspace],{})),"values",[],{}))],{}));
assert.ok(pyBool(pyLessEqual(tips,new Set((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(cut,"nodes"))){__rows.push(pyAt(node,"sha"));}return __rows;})())))),"tests/kernel/test_table_graph.py:301 assert tips <= {node[\"sha\"] for node in cut[\"nodes\"]}");
assert.ok(pyBool(pyLessEqual(new Set((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(cut,"nodes"))){__rows.push(pyAt(node,"sha"));}return __rows;})())),new Set((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(full,"nodes"))){__rows.push(pyAt(node,"sha"));}return __rows;})())))),"tests/kernel/test_table_graph.py:302 assert {node[\"sha\"] for node in cut[\"nodes\"]} <= {node[\"sha\"] for node in full[\"nodes\"]}");
}
Object.defineProperty(test_truncation_retains_tips,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_truncation_retains_tips"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_truncation_retains_tips(await acquireFixture(t,()=>client(temporary)));});
export async function test_max_nodes_validation_and_cap(client:any){
let capped:any;
(await pyInvoke(play,[client,1],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(client,"table_err",["graph"],{"max_nodes":0})),"code"),"invalid_params")),"tests/kernel/test_table_graph.py:307 assert client.table_err(\"graph\", max_nodes=0)[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(client,"table_err",["graph"],{"max_nodes":"many"})),"code"),"invalid_params")),"tests/kernel/test_table_graph.py:308 assert client.table_err(\"graph\", max_nodes=\"many\")[\"code\"] == \"invalid_params\"");
capped=(await pyInvoke(graph,[client],{"max_nodes":999999}));
assert.ok(pyBool((pyAt(capped,"truncated")===false)),"tests/kernel/test_table_graph.py:310 assert capped[\"truncated\"] is False");
}
Object.defineProperty(test_max_nodes_validation_and_cap,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_max_nodes_validation_and_cap"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_max_nodes_validation_and_cap(await acquireFixture(t,()=>client(temporary)));});

export async function test_merge_and_worldline_kinds_cold(client:any){
let workspace:any,side_commit_message:any,cold:any,result:any,nodes:any,merges:any,side:any;
(await pyInvoke(play,[client,1],{}));
workspace=client.workspace;
side_commit_message="worldline side: sealed at turn 1";
(await pyInvoke(git,[workspace,"branch","wl/side","wl/main"],{}));
(await pyInvoke(git,[workspace,"checkout","--quiet","--force","wl/side"],{}));
(await pyMethod((pyDivide((await pyInvoke(campaign_dir,[workspace],{})),"side-note.txt")),"write_text",["kept only on the side line\n"],{"encoding":"utf-8"}));
(await pyInvoke(git,[workspace,"add","-A"],{}));
(await pyInvoke(git,[workspace,"commit","--quiet","-m",side_commit_message],{}));
(await pyInvoke(git,[workspace,"checkout","--quiet","--force","wl/main"],{}));
(await pyInvoke(git,[workspace,"merge","-s","ours","--no-commit","--no-ff","wl/side"],{}));
(await pyInvoke(git,[workspace,"commit","--quiet","-m","worldline main: merged side"],{}));
cold=(new RpcClient(workspace,({})));
try{result=(await pyMethod(cold,"table",["graph"],{}));}finally{(await pyMethod(cold,"close",[],{}));}
nodes=(await pyInvoke(by_sha,[result],{}));
merges=(await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(result,"nodes"))){if(pyBool(pyEqual(pyAt(node,"kind"),"merge"))){__rows.push(node);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyInvoke(pyLen,[merges],{})),1);return pyBool(__left)?pyEqual((await pyInvoke(pyLen,[pyAt(pyAt(merges,0),"parents")],{})),2):__left;})())),"tests/kernel/test_table_graph.py:336 assert len(merges) == 1 and len(merges[0][\"parents\"]) == 2");
assert.ok(pyBool(pyContains(pyAt(pyAt(merges,0),"tip_of"),"main")),"tests/kernel/test_table_graph.py:337 assert \"main\" in merges[0][\"tip_of\"]");
side=(await pyNext((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(result,"nodes"))){if(pyBool(pyEqual(pyAt(node,"title"),side_commit_message))){__rows.push(node);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(side,"kind"),"worldline");return pyBool(__left)?(pyAt(side,"turn")===null):__left;})())),"tests/kernel/test_table_graph.py:339 assert side[\"kind\"] == \"worldline\" and side[\"turn\"] is None");
assert.ok(pyBool(pyContains(pyAt(side,"tip_of"),"side")),"tests/kernel/test_table_graph.py:340 assert \"side\" in side[\"tip_of\"]");
assert.ok(pyBool(pyEqual(pyAt(side,"clock"),(await pyInvoke(turn_clock,[workspace,1],{})))),"tests/kernel/test_table_graph.py:341 assert side[\"clock\"] == turn_clock(workspace, 1)");
}
Object.defineProperty(test_merge_and_worldline_kinds_cold,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_merge_and_worldline_kinds_cold"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_merge_and_worldline_kinds_cold(await acquireFixture(t,()=>client(temporary)));});

export async function test_read_only(client:any){
let before:any;
(await pyInvoke(play,[client,2],{}));
before=(await pyInvoke(snapshot,[client.workspace],{}));
(await pyInvoke(graph,[client],{}));
(await pyInvoke(graph,[client],{"max_nodes":3}));
assert.ok(pyBool(pyEqual((await pyInvoke(snapshot,[client.workspace],{})),before)),"tests/kernel/test_table_graph.py:352 assert snapshot(client.workspace) == before");
}
Object.defineProperty(test_read_only,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_read_only"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_read_only(await acquireFixture(t,()=>client(temporary)));});
export async function test_unknown_campaign(client:any){
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(client,"table_err",["graph"],{})),"code"),"campaign_not_found")),"tests/kernel/test_table_graph.py:356 assert client.table_err(\"graph\")[\"code\"] == \"campaign_not_found\"");
}
Object.defineProperty(test_unknown_campaign,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_unknown_campaign"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_unknown_campaign(await acquireFixture(t,()=>client(temporary)));});
