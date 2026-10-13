// Migrated from tests/kernel/test_worldline.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,CONTENT_DIR,MODULE,PREGEN,RpcClient,campaign_dir,create_campaign,narrate,narrate_opening,read_json,read_jsonl,repo_dir,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_worldline.py',import.meta.url).pathname;







export let BRIEFING:any="commission-briefing";
export let HOUSE:any="corbitt-house-ground";
export let KEEPER_NPC:any="npc-steven-knott";
export let PERSISTENT_CLUE:any="clue-knott-keys";
export let FORGOTTEN_CLUE:any="clue-knott-commission";

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
export async function world_of(client:any){
return (await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"world.json")],{}));
}
Object.defineProperty(world_of,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});

export async function _mirror(source:any,target:any,skip:any){
let child:any;
(await pyMethod(target,"mkdir",[],{"parents":true,"exist_ok":true}));
for(child of pyIterable((await pyMethod(source,"iterdir",[],{})))){
if(pyBool(!pyContains(skip,child.name))){(await pyMethod(os,"symlink",[child,pyDivide(target,child.name)],{}));}
}
}
Object.defineProperty(_mirror,"__pySignature",{value:[{"name":"source","rest":false,"varargs":false},{"name":"target","rest":false,"varargs":false},{"name":"skip","rest":false,"varargs":false}]});
export async function loop_content(tmp_path:any,reset:any=null,persists:any=true,remembers:any=true){
let root:any,starters:any,book:any,graph:any,relations:any,node:any,document:any;

root=pyDivide(tmp_path,"content");
(await pyInvoke(_mirror,[CONTENT_DIR,root,new Set(["starters"])],{}));
starters=pyDivide(root,"starters");
(await pyInvoke(_mirror,[pyDivide(CONTENT_DIR,"starters"),starters,new Set([MODULE])],{}));
book=pyDivide(starters,MODULE);
(await pyInvoke(_mirror,[pyDivide(pyDivide(CONTENT_DIR,"starters"),MODULE),book,new Set(["module-graph.json"])],{}));
graph=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(pyDivide(CONTENT_DIR,"starters"),MODULE),"module-graph.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
relations=pyAt(graph,"relations");
(await pyMethod(relations,"append",[({["relation_id"]:"relation-resets-to-1",["relation_kind"]:"resets-to",["from_node_id"]:`scene-${HOUSE}`,["to_node_id"]:`scene-${BRIEFING}`,["properties"]:({["reset"]:(await (async()=>{const __left=reset;return pyBool(__left)?__left:({["clock"]:"anchor",["investigators"]:"anchor"})})())})})],{}));
if(pyBool(persists)){(await pyMethod(relations,"append",[({["relation_id"]:"relation-persists-1",["relation_kind"]:"persists-across-loop",["from_node_id"]:PERSISTENT_CLUE,["to_node_id"]:"module-the-haunting",["properties"]:({})})],{}));}
for(node of pyIterable(pyAt(graph,"nodes"))){
if(pyBool(pyEqual(pyAt(node,"node_id"),"module-the-haunting"))){for(document of pyIterable(pyAt(pyAt(pyAt(node,"properties"),"runtime_projection"),"documents"))){
if(pyBool(pyEqual(pyAt(document,"filename"),"module-meta.json"))){pyAt(document,"root")["structure_type"]="time_loop";}
}}
if(pyBool((await (async()=>{const __left=remembers;return pyBool(__left)?pyEqual(pyAt(node,"node_id"),KEEPER_NPC):__left})()))){pyAt(pyAt(pyAt(node,"properties"),"runtime_projection"),"record")["remembers_across_loops"]=true;}
}
(await pyMethod((pyDivide(book,"module-graph.json")),"write_text",[(await pyMethod(json,"dumps",[graph],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
return root;
}
Object.defineProperty(loop_content,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false},{"name":"reset","rest":false,"varargs":false},{"name":"persists","rest":false,"varargs":false},{"name":"remembers","rest":false,"varargs":false}]});
export async function client_for(tmp_path:any,name:any="ws",content:any=null,env:any=null){
return (new RpcClient(pyDivide(tmp_path,name),({"content":content,"env":env})));
}
Object.defineProperty(client_for,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false},{"name":"name","rest":false,"varargs":false},{"name":"content","rest":false,"varargs":false},{"name":"env","rest":false,"varargs":false}]});

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
export async function fork(client:any,turn:any,name:any,mode:any="if",extra:any={}){
let result:any;
(await pyMethod(client,"table",["player_input"],{"text":"我要换一条路走。"}));
result=(await pyMethod(client,"table",["apply"],{"call_id":`t${turn}-c1`,"effects":[({["kind"]:"fork",["name"]:name,["mode"]:mode,...extra})]}));
(await pyInvoke(narrate,[client,`t${turn}-c2`,"眼前一黑，世界换了一条线。"],{}));
return result;
}
Object.defineProperty(fork,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"turn","rest":false,"varargs":false},{"name":"name","rest":false,"varargs":false},{"name":"mode","rest":false,"varargs":false},{"name":"extra","rest":true,"varargs":false}]});
export async function switchValue(client:any,turn:any,line:any){
let result:any;
(await pyMethod(client,"table",["player_input"],{"text":"我回到原来那条路。"}));
result=(await pyMethod(client,"table",["apply"],{"call_id":`t${turn}-c1`,"effects":[({["kind"]:"switch",["line"]:line})]}));
(await pyInvoke(narrate,[client,`t${turn}-c2`,"你回到了原来的那一条线。"],{}));
return result;
}
Object.defineProperty(switchValue,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"turn","rest":false,"varargs":false},{"name":"line","rest":false,"varargs":false}]});

export async function test_a_new_campaign_is_born_on_wl_main(kernel:any){
let meta:any,main:any;
(await pyInvoke(create_campaign,[kernel],{}));
meta=(await pyInvoke(meta_of,[kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(meta,"active_worldline"),"main")),"tests/kernel/test_worldline.py:140 assert meta[\"active_worldline\"] == \"main\"");
main=pyAt(pyAt(meta,"worldlines"),"main");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(main,"kind"),"main");return pyBool(__left)?pyEqual(pyAt(main,"loop"),0):__left})());return pyBool(__left)?(pyAt(main,"forked_from")===null):__left})())),"tests/kernel/test_worldline.py:142 assert main[\"kind\"] == \"main\" and main[\"loop\"] == 0 and main[\"forked_from\"] is None");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(main,"status"),"active");return pyBool(__left)?pyEqual((await pyInvoke(pyLen,[pyAt(main,"seed")],{})),16):__left})())),"tests/kernel/test_worldline.py:143 assert main[\"status\"] == \"active\" and len(main[\"seed\"]) == 16");
assert.ok(pyBool(pyEqual((await pyInvoke(head_ref,[kernel.workspace],{})),"refs/heads/wl/main")),"tests/kernel/test_worldline.py:144 assert head_ref(kernel.workspace) == \"refs/heads/wl/main\"");
assert.ok(pyBool(pyEqual((await pyInvoke(branches,[kernel.workspace],{})),["refs/heads/wl/main"])),"tests/kernel/test_worldline.py:145 assert branches(kernel.workspace) == [\"refs/heads/wl/main\"]");
}
Object.defineProperty(test_a_new_campaign_is_born_on_wl_main,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_new_campaign_is_born_on_wl_main"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_new_campaign_is_born_on_wl_main(await kernel(t,{}));});
export async function test_the_seed_is_the_campaign_the_line_and_the_fork_point(kernel:any,tmp_path:any){
let rolls:any,campaign:any,line:any,result:any;

rolls=({});
for([campaign,line] of pyIterable([["s1","main"],["s2","main"]])){
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:campaign,["module"]:MODULE,["pregen"]:PREGEN,["play_language"]:"en"})],{}));
(await pyMethod(kernel,"ok",["table.open",({["campaign"]:campaign})],{}));
(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:campaign,["call_id"]:"t0-c1",["text"]:"Opening."})],{}));
(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:campaign,["text"]:"I listen at the door."})],{}));
result=(await pyMethod(kernel,"ok",["table.resolve",({["campaign"]:campaign,["call_id"]:"t1-c1",["action"]:({["intent"]:"investigate",["goal"]:"hear the room",["method"]:"listen at the door",["skill"]:"Listen"})})],{}));
rolls[campaign]=pyAt(pyAt(result,"outcome"),"roll");
}
assert.ok(pyBool(!pyEqual(pyAt(rolls,"s1"),pyAt(rolls,"s2"))),pyStr("two campaigns must not share a line's dice"));
}
Object.defineProperty(test_the_seed_is_the_campaign_the_line_and_the_fork_point,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_seed_is_the_campaign_the_line_and_the_fork_point"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_seed_is_the_campaign_the_line_and_the_fork_point(await kernel(t,{}),temporary);});
export async function test_a_campaign_without_worldlines_is_adopted_as_main_without_rewriting_a_commit(kernel:any){
let workspace:any,before:any,path:any,meta:any;

(await pyInvoke(create_campaign,[kernel],{}));
workspace=kernel.workspace;
before=(await pyInvoke(git,[workspace,"rev-parse","HEAD"],{}));
path=pyDivide((await pyInvoke(campaign_dir,[workspace],{})),"campaign.json");
meta=(await pyInvoke(read_json,[path],{}));
(await pyMethod(meta,"pop",["active_worldline"],{}));
(await pyMethod(meta,"pop",["worldlines"],{}));
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[meta],{"ensure_ascii":false,"indent":2}))],{"encoding":"utf-8"}));
(await pyInvoke(git,[workspace,"symbolic-ref","HEAD","refs/heads/legacy"],{}));
(await pyInvoke(git,[workspace,"update-ref","refs/heads/legacy",before],{}));
(await pyInvoke(git,[workspace,"update-ref","-d","refs/heads/wl/main"],{}));
(await pyMethod(kernel,"table",["open"],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(head_ref,[workspace],{})),"refs/heads/wl/main")),"tests/kernel/test_worldline.py:180 assert head_ref(workspace) == \"refs/heads/wl/main\"");
assert.ok(pyBool(pyEqual((await pyInvoke(git,[workspace,"rev-parse","HEAD"],{})),before)),"tests/kernel/test_worldline.py:181 assert git(workspace, \"rev-parse\", \"HEAD\") == before");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(meta_of,[kernel],{})),"active_worldline"),"main")),"tests/kernel/test_worldline.py:182 assert meta_of(kernel)[\"active_worldline\"] == \"main\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyInvoke(meta_of,[kernel],{})),"worldlines"),"main"),"kind"),"main")),"tests/kernel/test_worldline.py:183 assert meta_of(kernel)[\"worldlines\"][\"main\"][\"kind\"] == \"main\"");
}
Object.defineProperty(test_a_campaign_without_worldlines_is_adopted_as_main_without_rewriting_a_commit,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_campaign_without_worldlines_is_adopted_as_main_without_rewriting_a_commit"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_campaign_without_worldlines_is_adopted_as_main_without_rewriting_a_commit(await kernel(t,{}));});

export async function test_forking_moves_the_table_and_leaves_the_line_it_came_from_whole(kernel:any){
let staged:any,workspace:any,meta:any,side:any;
(await pyInvoke(play_to_turn,[kernel,2],{}));
staged=(await pyInvoke(fork,[kernel,3,"side"],{}));
assert.ok(pyBool(pyEqual(pyAt(staged,"worldline"),({["operation"]:"fork",["line"]:"side",["mode"]:"if",["loop"]:0,["when"]:"after this turn's publication commits"}))),"tests/kernel/test_worldline.py:191 assert staged[\"worldline\"] == {\"operation\": \"fork\", \"line\": \"side\", \"mode\": \"if\", \"loop\": 0,\n                                   \"when\": \"after this turn's publication commits\"}");
workspace=kernel.workspace;
assert.ok(pyBool(pyEqual((await pyInvoke(head_ref,[workspace],{})),"refs/heads/wl/side")),"tests/kernel/test_worldline.py:194 assert head_ref(workspace) == \"refs/heads/wl/side\"");
assert.ok(pyBool(pyEqual((await pyInvoke(branches,[workspace],{})),["refs/heads/wl/main","refs/heads/wl/side"])),"tests/kernel/test_worldline.py:195 assert branches(workspace) == [\"refs/heads/wl/main\", \"refs/heads/wl/side\"]");
meta=(await pyInvoke(meta_of,[kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(meta,"active_worldline"),"side")),"tests/kernel/test_worldline.py:198 assert meta[\"active_worldline\"] == \"side\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(meta,"worldlines"),"main"),"status"),"dormant")),"tests/kernel/test_worldline.py:199 assert meta[\"worldlines\"][\"main\"][\"status\"] == \"dormant\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(meta,"worldlines"),"main"),"last_turn"),3)),"tests/kernel/test_worldline.py:200 assert meta[\"worldlines\"][\"main\"][\"last_turn\"] == 3");
side=pyAt(pyAt(meta,"worldlines"),"side");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(side,"kind"),"if");return pyBool(__left)?pyEqual(pyAt(side,"loop"),0):__left})());return pyBool(__left)?pyEqual(pyAt(side,"status"),"active"):__left})())),"tests/kernel/test_worldline.py:202 assert side[\"kind\"] == \"if\" and side[\"loop\"] == 0 and side[\"status\"] == \"active\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(side,"forked_from"),"line"),"main");return pyBool(__left)?pyEqual(pyAt(pyAt(side,"forked_from"),"turn"),3):__left})())),"tests/kernel/test_worldline.py:203 assert side[\"forked_from\"][\"line\"] == \"main\" and side[\"forked_from\"][\"turn\"] == 3");
assert.ok(pyBool(!pyEqual(pyAt(side,"seed"),pyAt(pyAt(pyAt(meta,"worldlines"),"main"),"seed"))),"tests/kernel/test_worldline.py:204 assert side[\"seed\"] != meta[\"worldlines\"][\"main\"][\"seed\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt((await pyInvoke(turn_json,[kernel],{})),"turn"),4);return pyBool(__left)?pyEqual(pyAt((await pyInvoke(turn_json,[kernel],{})),"state"),"awaiting_player"):__left})())),"tests/kernel/test_worldline.py:206 assert turn_json(kernel)[\"turn\"] == 4 and turn_json(kernel)[\"state\"] == \"awaiting_player\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(json,"loads",[(await pyInvoke(blob,[workspace,"wl/main","turns/0003.json"],{}))],{})),"closed_by"),"narrate")),"tests/kernel/test_worldline.py:208 assert json.loads(blob(workspace, \"wl/main\", \"turns/0003.json\"))[\"closed_by\"] == \"narrate\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(json,"loads",[(await pyInvoke(blob,[workspace,"wl/main","campaign.json"],{}))],{})),"id"),CAMPAIGN)),"tests/kernel/test_worldline.py:209 assert json.loads(blob(workspace, \"wl/main\", \"campaign.json\"))[\"id\"] == CAMPAIGN");
}
Object.defineProperty(test_forking_moves_the_table_and_leaves_the_line_it_came_from_whole,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_forking_moves_the_table_and_leaves_the_line_it_came_from_whole"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_forking_moves_the_table_and_leaves_the_line_it_came_from_whole(await kernel(t,{}));});
export async function test_the_fork_happens_after_the_commit_not_during_the_batch(kernel:any){
(await pyInvoke(play_to_turn,[kernel,1],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我要换一条路走。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"fork",["name"]:"side",["mode"]:"if"})]}));
assert.ok(pyBool(pyEqual((await pyInvoke(head_ref,[kernel.workspace],{})),"refs/heads/wl/main")),"tests/kernel/test_worldline.py:217 assert head_ref(kernel.workspace) == \"refs/heads/wl/main\"");
assert.ok(pyBool(pyEqual((await pyInvoke(branches,[kernel.workspace],{})),["refs/heads/wl/main"])),"tests/kernel/test_worldline.py:218 assert branches(kernel.workspace) == [\"refs/heads/wl/main\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"))){__rows.push(pyAt(r,"id"));}return __rows;})()),["fork:side-t2"])),"tests/kernel/test_worldline.py:219 assert [r[\"id\"] for r in kernel.table(\"status\")[\"receipts\"]] == [\"fork:side-t2\"]");
(await pyInvoke(narrate,[kernel,"t2-c2","你眨了眨眼。"],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(head_ref,[kernel.workspace],{})),"refs/heads/wl/side")),"tests/kernel/test_worldline.py:221 assert head_ref(kernel.workspace) == \"refs/heads/wl/side\"");
}
Object.defineProperty(test_the_fork_happens_after_the_commit_not_during_the_batch,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_fork_happens_after_the_commit_not_during_the_batch"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_fork_happens_after_the_commit_not_during_the_batch(await kernel(t,{}));});
export async function test_the_fork_receipt_projects_as_a_worldline_mechanics_row(kernel:any){
let delivered:any,row:any;
(await pyInvoke(play_to_turn,[kernel,1],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我要换一条路走。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"fork",["name"]:"side",["mode"]:"if",["label"]:"另一种可能"})]}));
delivered=(await pyInvoke(narrate,[kernel,"t2-c2","你眨了眨眼。"],{}));
row=(await (async()=>{const __rows:any[]=[];for(const m of pyIterable(pyAt(delivered,"mechanics"))){if(pyBool(pyEqual(pyAt(m,"kind"),"worldline"))){__rows.push(m);}}return __rows;})());
assert.ok(pyBool(pyEqual(row,[({["kind"]:"worldline",["marker"]:"worldline:fork",["receipt"]:"fork:side-t2",["operation"]:"fork",["line"]:"side",["mode"]:"if",["loop"]:0,["from_line"]:"main",["from_turn"]:2,["label"]:"另一种可能",["call"]:"t2-c1"})])),"tests/kernel/test_worldline.py:231 assert row == [{\"kind\": \"worldline\", \"marker\": \"worldline:fork\", \"receipt\": \"fork:side-t2\", \"operation\": \"fork\", \"line\": \"side\",\n                    \"mode\": \"if\", \"loop\": 0, \"from_line\": \"main\", \"from_turn\": 2, \"label\": \"另一种可能\", \"call\": \"t2-c1\"}]");
assert.ok(pyBool(pyEqual(pyAt(delivered,"rendered_text"),"你眨了眨眼。")),"tests/kernel/test_worldline.py:234 assert delivered[\"rendered_text\"] == \"你眨了眨眼。\"");
}
Object.defineProperty(test_the_fork_receipt_projects_as_a_worldline_mechanics_row,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_fork_receipt_projects_as_a_worldline_mechanics_row"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_fork_receipt_projects_as_a_worldline_mechanics_row(await kernel(t,{}));});
export async function test_a_fork_from_an_earlier_turn_rewinds_the_tree_to_that_turn(kernel:any){
let scene_at_three:any;
(await pyInvoke(play_to_turn,[kernel,3],{}));
scene_at_three=pyAt((await pyInvoke(world_of,[kernel],{})),"active_scene");
(await pyMethod(kernel,"table",["player_input"],{"text":"我走去柯比特老宅。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t4-c1","effects":[({["kind"]:"move",["to"]:HOUSE})]}));
(await pyInvoke(narrate,[kernel,"t4-c2","你走到了老宅门前。"],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world_of,[kernel],{})),"active_scene"),HOUSE)),"tests/kernel/test_worldline.py:243 assert world_of(kernel)[\"active_scene\"] == HOUSE");
(await pyInvoke(fork,[kernel,5,"rewound"],{"from_turn":2}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt((await pyInvoke(meta_of,[kernel],{})),"worldlines"),"rewound"),"forked_from"),"turn"),2)),"tests/kernel/test_worldline.py:246 assert meta_of(kernel)[\"worldlines\"][\"rewound\"][\"forked_from\"][\"turn\"] == 2");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world_of,[kernel],{})),"active_scene"),scene_at_three)),"tests/kernel/test_worldline.py:248 assert world_of(kernel)[\"active_scene\"] == scene_at_three");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(turn_json,[kernel],{})),"turn"),3)),"tests/kernel/test_worldline.py:249 assert turn_json(kernel)[\"turn\"] == 3");
assert.ok(pyBool(!pyBool((await pyMethod((pyDivide(pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"turns"),"0004.json")),"exists",[],{})))),"tests/kernel/test_worldline.py:250 assert not (campaign_dir(kernel.workspace) / \"turns\" / \"0004.json\").exists()");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(json,"loads",[(await pyInvoke(blob,[kernel.workspace,"wl/main","turns/0004.json"],{}))],{})),"turn"),4)),"tests/kernel/test_worldline.py:252 assert json.loads(blob(kernel.workspace, \"wl/main\", \"turns/0004.json\"))[\"turn\"] == 4");
}
Object.defineProperty(test_a_fork_from_an_earlier_turn_rewinds_the_tree_to_that_turn,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_fork_from_an_earlier_turn_rewinds_the_tree_to_that_turn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_fork_from_an_earlier_turn_rewinds_the_tree_to_that_turn(await kernel(t,{}));});
export async function test_a_repeated_call_id_forks_once(kernel:any){
let effects:any,first:any,again:any;
(await pyInvoke(play_to_turn,[kernel,1],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我要换一条路走。"}));
effects=[({["kind"]:"fork",["name"]:"side",["mode"]:"if"})];
first=(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":effects}));
again=(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":effects}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(again,"replayed")===true);return pyBool(__left)?pyEqual(pyAt(again,"receipts"),pyAt(first,"receipts")):__left})())),"tests/kernel/test_worldline.py:261 assert again[\"replayed\"] is True and again[\"receipts\"] == first[\"receipts\"]");
(await pyInvoke(narrate,[kernel,"t2-c2","你眨了眨眼。"],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(branches,[kernel.workspace],{})),["refs/heads/wl/main","refs/heads/wl/side"])),"tests/kernel/test_worldline.py:263 assert branches(kernel.workspace) == [\"refs/heads/wl/main\", \"refs/heads/wl/side\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"turns"),"0002.json")],{})),"receipts"))){__rows.push(pyAt(r,"id"));}return __rows;})()),["fork:side-t2"])),"tests/kernel/test_worldline.py:264 assert [r[\"id\"] for r in read_json(campaign_dir(kernel.workspace) / \"turns\" / \"0002.json\")[\"receipts\"]] \\\n        == [\"fork:side-t2\"]");
}
Object.defineProperty(test_a_repeated_call_id_forks_once,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_repeated_call_id_forks_once"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_repeated_call_id_forks_once(await kernel(t,{}));});

export async function test_switching_moves_only_the_active_line(kernel:any){
let workspace:any,meta:any,types:any;
(await pyInvoke(play_to_turn,[kernel,2],{}));
(await pyInvoke(fork,[kernel,3,"side"],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我在这条线上多走一步。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t4-c1","effects":[({["kind"]:"clue",["clue"]:"knott-keys"})]}));
(await pyInvoke(narrate,[kernel,"t4-c2","你在这条线上拿到了钥匙。"],{}));
assert.ok(pyBool(pyContains(pyAt((await pyInvoke(world_of,[kernel],{})),"discovered_clues"),"knott-keys")),"tests/kernel/test_worldline.py:276 assert \"knott-keys\" in world_of(kernel)[\"discovered_clues\"]");
(await pyInvoke(switchValue,[kernel,5,"main"],{}));
workspace=kernel.workspace;
assert.ok(pyBool(pyEqual((await pyInvoke(head_ref,[workspace],{})),"refs/heads/wl/main")),"tests/kernel/test_worldline.py:280 assert head_ref(workspace) == \"refs/heads/wl/main\"");
meta=(await pyInvoke(meta_of,[kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(meta,"active_worldline"),"main")),"tests/kernel/test_worldline.py:282 assert meta[\"active_worldline\"] == \"main\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(meta,"worldlines"),"main"),"status"),"active")),"tests/kernel/test_worldline.py:283 assert meta[\"worldlines\"][\"main\"][\"status\"] == \"active\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(meta,"worldlines"),"side"),"status"),"dormant");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(meta,"worldlines"),"side"),"last_turn"),5):__left})())),"tests/kernel/test_worldline.py:284 assert meta[\"worldlines\"][\"side\"][\"status\"] == \"dormant\" and meta[\"worldlines\"][\"side\"][\"last_turn\"] == 5");
assert.ok(pyBool(!pyContains(pyAt((await pyInvoke(world_of,[kernel],{})),"discovered_clues"),"knott-keys")),"tests/kernel/test_worldline.py:286 assert \"knott-keys\" not in world_of(kernel)[\"discovered_clues\"]");
assert.ok(pyBool(!pyBool((await pyMethod((pyDivide(pyDivide((await pyInvoke(campaign_dir,[workspace],{})),"turns"),"0004.json")),"exists",[],{})))),"tests/kernel/test_worldline.py:287 assert not (campaign_dir(workspace) / \"turns\" / \"0004.json\").exists()");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(turn_json,[kernel],{})),"turn"),4)),"tests/kernel/test_worldline.py:288 assert turn_json(kernel)[\"turn\"] == 4");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(json,"loads",[(await pyInvoke(blob,[workspace,"wl/side","turns/0004.json"],{}))],{})),"turn"),4)),"tests/kernel/test_worldline.py:290 assert json.loads(blob(workspace, \"wl/side\", \"turns/0004.json\"))[\"turn\"] == 4");
assert.ok(pyBool(pyContains(pyAt((await pyMethod(json,"loads",[(await pyInvoke(blob,[workspace,"wl/side","world.json"],{}))],{})),"discovered_clues"),"knott-keys")),"tests/kernel/test_worldline.py:291 assert \"knott-keys\" in json.loads(blob(workspace, \"wl/side\", \"world.json\"))[\"discovered_clues\"]");
types=(await (async()=>{const __rows:any[]=[];for(const e of pyIterable((await pyInvoke(read_jsonl,[pyDivide((await pyInvoke(campaign_dir,[workspace],{})),"events.jsonl")],{})))){__rows.push(pyAt(e,"type"));}return __rows;})());
assert.ok(pyBool(pyContains(types,"worldline-switched")),"tests/kernel/test_worldline.py:293 assert \"worldline-switched\" in types");
}
Object.defineProperty(test_switching_moves_only_the_active_line,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_switching_moves_only_the_active_line"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_switching_moves_only_the_active_line(await kernel(t,{}));});
export async function test_switching_to_an_unknown_or_current_line_is_refused(kernel:any){
let missing:any,same:any;
(await pyInvoke(play_to_turn,[kernel,1],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我想换线。"}));
missing=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"switch",["line"]:"nowhere"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(missing,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(missing,"message"),"nowhere"):__left})())),"tests/kernel/test_worldline.py:300 assert missing[\"code\"] == \"invalid_params\" and \"nowhere\" in missing[\"message\"]");
same=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t2-c2","effects":[({["kind"]:"switch",["line"]:"main"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(same,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(same,"message"),"already"):__left})())),"tests/kernel/test_worldline.py:302 assert same[\"code\"] == \"invalid_params\" and \"already\" in same[\"message\"]");
assert.ok(pyBool(pyEqual((await pyInvoke(branches,[kernel.workspace],{})),["refs/heads/wl/main"])),"tests/kernel/test_worldline.py:303 assert branches(kernel.workspace) == [\"refs/heads/wl/main\"]");
}
Object.defineProperty(test_switching_to_an_unknown_or_current_line_is_refused,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_switching_to_an_unknown_or_current_line_is_refused"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_switching_to_an_unknown_or_current_line_is_refused(await kernel(t,{}));});
export async function test_a_name_another_line_already_has_is_refused_before_anything_is_written(kernel:any){
let error:any;
(await pyInvoke(play_to_turn,[kernel,2],{}));
(await pyInvoke(fork,[kernel,3,"side"],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"再来一条同名的。"}));
error=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t4-c1","effects":[({["kind"]:"fork",["name"]:"side",["mode"]:"if"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(error,"message"),"already exists"):__left})())),"tests/kernel/test_worldline.py:311 assert error[\"code\"] == \"invalid_params\" and \"already exists\" in error[\"message\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"lines"),["main","side"])),"tests/kernel/test_worldline.py:312 assert error[\"details\"][\"lines\"] == [\"main\", \"side\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"),[])),"tests/kernel/test_worldline.py:313 assert kernel.table(\"status\")[\"receipts\"] == []");
}
Object.defineProperty(test_a_name_another_line_already_has_is_refused_before_anything_is_written,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_name_another_line_already_has_is_refused_before_anything_is_written"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_name_another_line_already_has_is_refused_before_anything_is_written(await kernel(t,{}));});

export async function test_a_worldline_effect_must_be_the_last_of_its_batch(kernel:any){
let error:any;
(await pyInvoke(play_to_turn,[kernel,1],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我要换一条路走。"}));
error=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"fork",["name"]:"side",["mode"]:"if"}),({["kind"]:"time",["minutes"]:5})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(error,"message"),"last effect"):__left})())),"tests/kernel/test_worldline.py:324 assert error[\"code\"] == \"invalid_params\" and \"last effect\" in error[\"message\"]");
assert.ok(pyBool(pyEqual((await pyInvoke(branches,[kernel.workspace],{})),["refs/heads/wl/main"])),"tests/kernel/test_worldline.py:325 assert branches(kernel.workspace) == [\"refs/heads/wl/main\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"),[])),"tests/kernel/test_worldline.py:326 assert kernel.table(\"status\")[\"receipts\"] == []");
}
Object.defineProperty(test_a_worldline_effect_must_be_the_last_of_its_batch,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_worldline_effect_must_be_the_last_of_its_batch"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_worldline_effect_must_be_the_last_of_its_batch(await kernel(t,{}));});
export async function test_a_turn_carries_at_most_one_worldline_effect(kernel:any){
let error:any,same_batch:any;
(await pyInvoke(play_to_turn,[kernel,1],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我要换一条路走。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"fork",["name"]:"side",["mode"]:"if"})]}));
error=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t2-c2","effects":[({["kind"]:"fork",["name"]:"other",["mode"]:"if"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(error,"message"),"at most one"):__left})())),"tests/kernel/test_worldline.py:334 assert error[\"code\"] == \"invalid_params\" and \"at most one\" in error[\"message\"]");
same_batch=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t2-c3","effects":[({["kind"]:"switch",["line"]:"main"})]}));
assert.ok(pyBool(pyEqual(pyAt(same_batch,"code"),"invalid_params")),"tests/kernel/test_worldline.py:337 assert same_batch[\"code\"] == \"invalid_params\"");
}
Object.defineProperty(test_a_turn_carries_at_most_one_worldline_effect,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_turn_carries_at_most_one_worldline_effect"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_turn_carries_at_most_one_worldline_effect(await kernel(t,{}));});
export async function test_a_turn_that_changes_the_line_cannot_be_closed_by_ask(kernel:any){
let error:any;
(await pyInvoke(play_to_turn,[kernel,1],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我要换一条路走。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"fork",["name"]:"side",["mode"]:"if"})]}));
error=(await pyMethod(kernel,"table_err",["ask"],{"call_id":"t2-c2","prompt":"要走哪条路？","options":["左","右"],"text":"你眨了眨眼。"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(error,"message"),"ask"):__left})())),"tests/kernel/test_worldline.py:345 assert error[\"code\"] == \"invalid_params\" and \"ask\" in error[\"message\"]");
assert.ok(pyBool(pyEqual((await pyInvoke(branches,[kernel.workspace],{})),["refs/heads/wl/main"])),"tests/kernel/test_worldline.py:346 assert branches(kernel.workspace) == [\"refs/heads/wl/main\"]");
}
Object.defineProperty(test_a_turn_that_changes_the_line_cannot_be_closed_by_ask,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_turn_that_changes_the_line_cannot_be_closed_by_ask"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_turn_that_changes_the_line_cannot_be_closed_by_ask(await kernel(t,{}));});
export async function test_a_book_that_declares_a_time_loop_gets_the_time_loop_weights(tmp_path:any){
let client:any,director:any,plain:any,because:any;

client=(await pyInvoke(client_for,[tmp_path],{"content":(await pyInvoke(loop_content,[tmp_path],{}))}));
try{(await pyInvoke(play_to_turn,[client,1],{}));
director=pyAt(pyAt((await pyMethod(client,"table",["player_input"],{"text":"我看看四周。"})),"capsule"),"director");
assert.ok(pyBool(pyContains(pyAt(director,"because"),"structure_type = time_loop")),"tests/kernel/test_worldline.py:357 assert \"structure_type = time_loop\" in director[\"because\"]");
assert.ok(pyBool(pyContains(pyAt(director,"because"),"loop_count = 0")),"tests/kernel/test_worldline.py:359 assert \"loop_count = 0\" in director[\"because\"]");
assert.ok(pyBool(pyContains(pyAt(director,"because"),"loop_available = False")),"tests/kernel/test_worldline.py:360 assert \"loop_available = False\" in director[\"because\"]");}finally{(await pyMethod(client,"close",[],{}));}
plain=(await pyInvoke(client_for,[tmp_path,"ws-plain"],{}));
try{(await pyInvoke(play_to_turn,[plain,1],{}));
because=pyAt(pyAt(pyAt((await pyMethod(plain,"table",["player_input"],{"text":"我看看四周。"})),"capsule"),"director"),"because");
assert.ok(pyBool(pyContains(because,"structure_type = branching_investigation")),"tests/kernel/test_worldline.py:368 assert \"structure_type = branching_investigation\" in because");}finally{(await pyMethod(plain,"close",[],{}));}
}
Object.defineProperty(test_a_book_that_declares_a_time_loop_gets_the_time_loop_weights,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_book_that_declares_a_time_loop_gets_the_time_loop_weights"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_book_that_declares_a_time_loop_gets_the_time_loop_weights(temporary);});

export async function two_lines_that_disagree(client:any){
let turn:any;

(await pyInvoke(play_to_turn,[client,2],{}));
(await pyInvoke(fork,[client,3,"side"],{}));
turn=pyAt((await pyInvoke(turn_json,[client],{})),"turn");
(await pyMethod(client,"table",["player_input"],{"text":"我摔了一跤。"}));
(await pyMethod(client,"table",["apply"],{"call_id":`t${turn}-c1`,"effects":[({["kind"]:"damage",["dice"]:"1D6"}),({["kind"]:"flag",["name"]:"side-was-here",["value"]:true})]}));
(await pyInvoke(narrate,[client,`t${turn}-c2`,"你摔在地上。"],{}));
turn=pyAt((await pyInvoke(turn_json,[client],{})),"turn");
(await pyInvoke(switchValue,[client,turn,"main"],{}));
turn=pyAt((await pyInvoke(turn_json,[client],{})),"turn");
(await pyMethod(client,"table",["player_input"],{"text":"我在这边留个记号。"}));
(await pyMethod(client,"table",["apply"],{"call_id":`t${turn}-c1`,"effects":[({["kind"]:"flag",["name"]:"main-was-here",["value"]:true})]}));
(await pyInvoke(narrate,[client,`t${turn}-c2`,"你做了个记号。"],{}));
}
Object.defineProperty(two_lines_that_disagree,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function merge_err(client:any,call:any,extra:any={}){

return (await pyMethod(client,"table_err",["apply"],{"call_id":call,"effects":[({["kind"]:"merge",["name"]:"joined",["lines"]:["main","side"],...extra})]}));
}
Object.defineProperty(merge_err,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"call","rest":false,"varargs":false},{"name":"extra","rest":true,"varargs":false}]});
export async function test_a_confluence_names_at_least_two_lines_and_must_include_the_one_at_the_table(kernel:any){
let turn:any,one:any,absent:any,away:any;
(await pyInvoke(play_to_turn,[kernel,1],{}));
(await pyInvoke(fork,[kernel,2,"side"],{}));
turn=pyAt((await pyInvoke(turn_json,[kernel],{})),"turn");
(await pyMethod(kernel,"table",["player_input"],{"text":"我想把线并起来。"}));
one=(await pyMethod(kernel,"table_err",["apply"],{"call_id":`t${turn}-c1`,"effects":[({["kind"]:"merge",["name"]:"joined",["lines"]:["main"]})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(one,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(one,"message"),"two lines"):__left})())),"tests/kernel/test_worldline.py:409 assert one[\"code\"] == \"invalid_params\" and \"two lines\" in one[\"message\"]");
absent=(await pyMethod(kernel,"table_err",["apply"],{"call_id":`t${turn}-c2`,"effects":[({["kind"]:"merge",["name"]:"joined",["lines"]:["main","ghost"]})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(absent,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(absent,"message"),"ghost"):__left})())),"tests/kernel/test_worldline.py:412 assert absent[\"code\"] == \"invalid_params\" and \"ghost\" in absent[\"message\"]");
away=(await pyMethod(kernel,"table_err",["apply"],{"call_id":`t${turn}-c3`,"effects":[({["kind"]:"merge",["name"]:"joined",["lines"]:["main","main"]})]}));
assert.ok(pyBool(pyEqual(pyAt(away,"code"),"invalid_params")),"tests/kernel/test_worldline.py:416 assert away[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual((await pyInvoke(branches,[kernel.workspace],{})),["refs/heads/wl/main","refs/heads/wl/side"])),"tests/kernel/test_worldline.py:417 assert branches(kernel.workspace) == [\"refs/heads/wl/main\", \"refs/heads/wl/side\"]");
}
Object.defineProperty(test_a_confluence_names_at_least_two_lines_and_must_include_the_one_at_the_table,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_confluence_names_at_least_two_lines_and_must_include_the_one_at_the_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_confluence_names_at_least_two_lines_and_must_include_the_one_at_the_table(await kernel(t,{}));});
export async function hp_by_line(conflict:any){

return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [line,view] of pyIterable((await pyMethod(pyAt(conflict,"values"),"items",[],{})))){__rows.push([line,pyAt(pyAt(pyAt(view,"sheet"),"thomas-hayes"),"current_hp")]);}return __rows;})()));
}
Object.defineProperty(hp_by_line,"__pySignature",{value:[{"name":"conflict","rest":false,"varargs":false}]});
export async function test_two_lines_that_disagree_about_a_wound_stop_the_merge_until_the_keeper_settles_it(kernel:any){
let turn:any,error:any,conflicts:any,only:any,hp:any,again:any;

(await pyInvoke(two_lines_that_disagree,[kernel],{}));
turn=pyAt((await pyInvoke(turn_json,[kernel],{})),"turn");
(await pyMethod(kernel,"table",["player_input"],{"text":"把两条线并起来。"}));
error=(await pyInvoke(merge_err,[kernel,`t${turn}-c1`],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"needs")),"tests/kernel/test_worldline.py:435 assert error[\"code\"] == \"needs\"");
conflicts=pyAt(pyAt(error,"details"),"conflicts");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(conflicts)){__rows.push(pyAt(c,"id"));}return __rows;})()),["conflict:engine_state:engines:snapshot"])),"tests/kernel/test_worldline.py:437 assert [c[\"id\"] for c in conflicts] == [\"conflict:engine_state:engines:snapshot\"]");
only=pyAt(conflicts,0);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(only,"class"),"engine_state");return pyBool(__left)?pyEqual(pyAt(only,"field"),"snapshot"):__left})())),"tests/kernel/test_worldline.py:439 assert only[\"class\"] == \"engine_state\" and only[\"field\"] == \"snapshot\"");
assert.ok(pyBool(pyEqual((await pyInvoke(pySorted,[pyAt(only,"values")],{})),["main","side"])),"tests/kernel/test_worldline.py:440 assert sorted(only[\"values\"]) == [\"main\", \"side\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(only,"values"),"main"),"save"),({}))),"tests/kernel/test_worldline.py:443 assert only[\"values\"][\"main\"][\"save\"] == {}");
assert.ok(pyBool(pyEqual((await pyInvoke(pyList,[pyAt(pyAt(pyAt(only,"values"),"side"),"save")],{})),["save/healing-state/thomas-hayes.json"])),"tests/kernel/test_worldline.py:444 assert list(only[\"values\"][\"side\"][\"save\"]) == [\"save/healing-state/thomas-hayes.json\"]");
hp=(await pyInvoke(hp_by_line,[only],{}));
assert.ok(pyBool(!pyEqual(pyAt(hp,"main"),pyAt(hp,"side"))),"tests/kernel/test_worldline.py:446 assert hp[\"main\"] != hp[\"side\"]");
assert.ok(pyBool(pyEqual(pyAt(only,"modes"),["from"])),"tests/kernel/test_worldline.py:448 assert only[\"modes\"] == [\"from\"]");
assert.ok(pyBool(!pyContains(pyAt((await pyInvoke(meta_of,[kernel],{})),"worldlines"),"joined")),"tests/kernel/test_worldline.py:450 assert \"joined\" not in meta_of(kernel)[\"worldlines\"]");
assert.ok(pyBool(!pyContains((await pyInvoke(branches,[kernel.workspace],{})),"refs/heads/wl/joined")),"tests/kernel/test_worldline.py:451 assert \"refs/heads/wl/joined\" not in branches(kernel.workspace)");
again=(await pyInvoke(merge_err,[kernel,`t${turn}-c2`],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(again,"details"),"conflicts"),conflicts)),"tests/kernel/test_worldline.py:454 assert again[\"details\"][\"conflicts\"] == conflicts");
}
Object.defineProperty(test_two_lines_that_disagree_about_a_wound_stop_the_merge_until_the_keeper_settles_it,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_two_lines_that_disagree_about_a_wound_stop_the_merge_until_the_keeper_settles_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_two_lines_that_disagree_about_a_wound_stop_the_merge_until_the_keeper_settles_it(await kernel(t,{}));});
export async function test_a_disposition_the_class_does_not_allow_is_refused_and_a_drop_must_say_why(kernel:any){
let turn:any,conflict:any,offset:any,mode:any,refused:any,elsewhere:any,unknown:any;
(await pyInvoke(two_lines_that_disagree,[kernel],{}));
turn=pyAt((await pyInvoke(turn_json,[kernel],{})),"turn");
(await pyMethod(kernel,"table",["player_input"],{"text":"把两条线并起来。"}));
conflict=pyAt(pyAt(pyAt(pyAt((await pyInvoke(merge_err,[kernel,`t${turn}-c1`],{})),"details"),"conflicts"),0),"id");
for([offset,mode] of pyIterable((await pyInvoke(pyEnumerate,[["sum","max"]],{"start":2})))){
refused=(await pyInvoke(merge_err,[kernel,`t${turn}-c${offset}`],{"dispositions":({[conflict]:({["mode"]:mode})})}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(refused,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(refused,"details"),"modes"),["from"]):__left})())),"tests/kernel/test_worldline.py:464 assert refused[\"code\"] == \"invalid_params\" and refused[\"details\"][\"modes\"] == [\"from\"]");
}
elsewhere=(await pyInvoke(merge_err,[kernel,`t${turn}-c4`],{"dispositions":({[conflict]:({["mode"]:"from",["line"]:"ghost"})})}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(elsewhere,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(elsewhere,"details"),"lines"),["main","side"]):__left})())),"tests/kernel/test_worldline.py:466 assert elsewhere[\"code\"] == \"invalid_params\" and elsewhere[\"details\"][\"lines\"] == [\"main\", \"side\"]");
unknown=(await pyInvoke(merge_err,[kernel,`t${turn}-c5`],{"dispositions":({["conflict:numeric:nobody:hp"]:({["mode"]:"max"})})}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(unknown,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(unknown,"details"),"unknown"),["conflict:numeric:nobody:hp"]):__left})())),"tests/kernel/test_worldline.py:468 assert unknown[\"code\"] == \"invalid_params\" and unknown[\"details\"][\"unknown\"] == [\"conflict:numeric:nobody:hp\"]");
}
Object.defineProperty(test_a_disposition_the_class_does_not_allow_is_refused_and_a_drop_must_say_why,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_disposition_the_class_does_not_allow_is_refused_and_a_drop_must_say_why"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_disposition_the_class_does_not_allow_is_refused_and_a_drop_must_say_why(await kernel(t,{}));});
export async function test_a_settled_confluence_lands_a_line_whose_commit_keeps_both_histories(kernel:any){
let turn:any,conflicts:any,hp:any,meta:any,joined:any,world:any,healing:any;
(await pyInvoke(two_lines_that_disagree,[kernel],{}));
turn=pyAt((await pyInvoke(turn_json,[kernel],{})),"turn");
(await pyMethod(kernel,"table",["player_input"],{"text":"把两条线并起来。"}));
conflicts=pyAt(pyAt((await pyInvoke(merge_err,[kernel,`t${turn}-c1`],{})),"details"),"conflicts");
hp=(await pyInvoke(hp_by_line,[pyAt(conflicts,0)],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":`t${turn}-c2`,"effects":[({["kind"]:"merge",["name"]:"joined",["lines"]:["main","side"],["dispositions"]:({[pyAt(pyAt(conflicts,0),"id")]:({["mode"]:"from",["line"]:"side"})})})]}));
(await pyInvoke(narrate,[kernel,`t${turn}-c3`,"两条线合到了一起。"],{}));
meta=(await pyInvoke(meta_of,[kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(meta,"active_worldline"),"joined")),"tests/kernel/test_worldline.py:483 assert meta[\"active_worldline\"] == \"joined\"");
joined=pyAt(pyAt(meta,"worldlines"),"joined");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(joined,"kind"),"merge");return pyBool(__left)?pyEqual(pyAt(joined,"status"),"active"):__left})())),"tests/kernel/test_worldline.py:485 assert joined[\"kind\"] == \"merge\" and joined[\"status\"] == \"active\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(joined,"parents"))){__rows.push(pyAt(p,"line"));}return __rows;})()),["main","side"])),"tests/kernel/test_worldline.py:486 assert [p[\"line\"] for p in joined[\"parents\"]] == [\"main\", \"side\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(meta,"worldlines"),"main"),"status"),"merged")),"tests/kernel/test_worldline.py:487 assert meta[\"worldlines\"][\"main\"][\"status\"] == \"merged\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(meta,"worldlines"),"side"),"status"),"merged")),"tests/kernel/test_worldline.py:488 assert meta[\"worldlines\"][\"side\"][\"status\"] == \"merged\"");
assert.ok(pyBool(pyEqual((await pyInvoke(head_ref,[kernel.workspace],{})),"refs/heads/wl/joined")),"tests/kernel/test_worldline.py:489 assert head_ref(kernel.workspace) == \"refs/heads/wl/joined\"");
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[(await pyMethod((await pyInvoke(git,[kernel.workspace,"log","--format=%p","-1"],{})),"split",[],{}))],{})),2)),"tests/kernel/test_worldline.py:491 assert len(git(kernel.workspace, \"log\", \"--format=%p\", \"-1\").split()) == 2");
world=(await pyInvoke(world_of,[kernel],{}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(world,"flags"),"main-was-here")===true);return pyBool(__left)?(pyAt(pyAt(world,"flags"),"side-was-here")===true):__left})())),"tests/kernel/test_worldline.py:494 assert world[\"flags\"][\"main-was-here\"] is True and world[\"flags\"][\"side-was-here\"] is True");
assert.ok(pyBool(!pyEqual(pyAt(hp,"main"),pyAt(hp,"side"))),"tests/kernel/test_worldline.py:495 assert hp[\"main\"] != hp[\"side\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"investigator"})),"hp"),pyAt(hp,"side"))),"tests/kernel/test_worldline.py:496 assert kernel.table(\"look\", focus=\"investigator\")[\"hp\"] == hp[\"side\"]");
healing=(await pyInvoke(read_json,[pyDivide(pyDivide(pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"save"),"healing-state"),"thomas-hayes.json")],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(healing,"current_hp"),pyAt(hp,"side"));return pyBool(__left)?pyEqual((await pyInvoke(pyLen,[pyAt(healing,"wound_ledger")],{})),1):__left})())),"tests/kernel/test_worldline.py:499 assert healing[\"current_hp\"] == hp[\"side\"] and len(healing[\"wound_ledger\"]) == 1");
}
Object.defineProperty(test_a_settled_confluence_lands_a_line_whose_commit_keeps_both_histories,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_settled_confluence_lands_a_line_whose_commit_keeps_both_histories"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_settled_confluence_lands_a_line_whose_commit_keeps_both_histories(await kernel(t,{}));});
export async function test_a_merged_line_cannot_be_played_again(kernel:any){
let turn:any,conflict:any,error:any;
(await pyInvoke(two_lines_that_disagree,[kernel],{}));
turn=pyAt((await pyInvoke(turn_json,[kernel],{})),"turn");
(await pyMethod(kernel,"table",["player_input"],{"text":"把两条线并起来。"}));
conflict=pyAt(pyAt(pyAt(pyAt((await pyInvoke(merge_err,[kernel,`t${turn}-c1`],{})),"details"),"conflicts"),0),"id");
(await pyMethod(kernel,"table",["apply"],{"call_id":`t${turn}-c2`,"effects":[({["kind"]:"merge",["name"]:"joined",["lines"]:["main","side"],["dispositions"]:({[conflict]:({["mode"]:"from",["line"]:"main"})})})]}));
(await pyInvoke(narrate,[kernel,`t${turn}-c3`,"两条线合到了一起。"],{}));
turn=pyAt((await pyInvoke(turn_json,[kernel],{})),"turn");
(await pyMethod(kernel,"table",["player_input"],{"text":"我想回到原来那条线。"}));
error=(await pyMethod(kernel,"table_err",["apply"],{"call_id":`t${turn}-c1`,"effects":[({["kind"]:"switch",["line"]:"side"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"status"),"merged"):__left})())),"tests/kernel/test_worldline.py:514 assert error[\"code\"] == \"invalid_params\" and error[\"details\"][\"status\"] == \"merged\"");
}
Object.defineProperty(test_a_merged_line_cannot_be_played_again,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_merged_line_cannot_be_played_again"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_merged_line_cannot_be_played_again(await kernel(t,{}));});
export async function test_a_thing_one_line_spent_is_a_conflict_but_a_thing_it_never_had_is_not(kernel:any){
let turn:any,conflicts:any,only:any,dropped:any,equipment:any;

(await pyInvoke(play_to_turn,[kernel,1],{}));
turn=pyAt((await pyInvoke(turn_json,[kernel],{})),"turn");
(await pyMethod(kernel,"table",["player_input"],{"text":"我把两样东西都收好。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":`t${turn}-c1`,"effects":[({["kind"]:"item",["name"]:"brass key"})]}));
(await pyInvoke(narrate,[kernel,`t${turn}-c2`,"你把黄铜钥匙收进口袋。"],{}));
(await pyInvoke(fork,[kernel,pyAt((await pyInvoke(turn_json,[kernel],{})),"turn"),"side"],{}));
turn=pyAt((await pyInvoke(turn_json,[kernel],{})),"turn");
(await pyMethod(kernel,"table",["player_input"],{"text":"我用掉了钥匙，又捡到一盏灯。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":`t${turn}-c1`,"effects":[({["kind"]:"item",["name"]:"brass key",["quantity"]:(-1)}),({["kind"]:"item",["name"]:"storm lantern"})]}));
(await pyInvoke(narrate,[kernel,`t${turn}-c2`,"钥匙留在了锁里，你顺手拿走了那盏灯。"],{}));
(await pyInvoke(switchValue,[kernel,pyAt((await pyInvoke(turn_json,[kernel],{})),"turn"),"main"],{}));
turn=pyAt((await pyInvoke(turn_json,[kernel],{})),"turn");
(await pyMethod(kernel,"table",["player_input"],{"text":"把两条线并起来。"}));
conflicts=pyAt(pyAt((await pyInvoke(merge_err,[kernel,`t${turn}-c1`],{})),"details"),"conflicts");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(conflicts)){__rows.push(pyAt(c,"id"));}return __rows;})()),["conflict:consumed:thomas-hayes:brass key"])),"tests/kernel/test_worldline.py:540 assert [c[\"id\"] for c in conflicts] == [\"conflict:consumed:thomas-hayes:brass key\"]");
only=pyAt(conflicts,0);
assert.ok(pyBool(pyEqual(pyAt(only,"values"),({["main"]:"held",["side"]:"spent"}))),"tests/kernel/test_worldline.py:542 assert only[\"values\"] == {\"main\": \"held\", \"side\": \"spent\"}");
assert.ok(pyBool(pyEqual(pyAt(only,"modes"),["from","drop"])),"tests/kernel/test_worldline.py:543 assert only[\"modes\"] == [\"from\", \"drop\"]");
dropped=(await pyInvoke(merge_err,[kernel,`t${turn}-c2`],{"dispositions":({[pyAt(only,"id")]:({["mode"]:"drop"})})}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(dropped,"code"),"invalid_params");return pyBool(__left)?pyContains(pyAt(dropped,"message"),"why"):__left})())),"tests/kernel/test_worldline.py:546 assert dropped[\"code\"] == \"invalid_params\" and \"why\" in dropped[\"message\"]");
(await pyMethod(kernel,"table",["apply"],{"call_id":`t${turn}-c3`,"effects":[({["kind"]:"merge",["name"]:"joined",["lines"]:["main","side"],["dispositions"]:({[pyAt(only,"id")]:({["mode"]:"drop",["note"]:"它留在了锁里。"})})})]}));
(await pyInvoke(narrate,[kernel,`t${turn}-c4`,"两条线合到了一起。"],{}));
equipment=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"party"),"thomas-hayes.json")],{})),"equipment"))){__rows.push((pyBool((await pyInvoke(pyIsInstance,[row,pyDict],{})))?(await pyInvoke(pyStr,[(await pyMethod(row,"get",["name"],{}))],{})):(await pyInvoke(pyStr,[row],{}))));}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=!pyContains(equipment,"brass key");return pyBool(__left)?pyContains(equipment,"storm lantern"):__left})())),"tests/kernel/test_worldline.py:553 assert \"brass key\" not in equipment and \"storm lantern\" in equipment");
}
Object.defineProperty(test_a_thing_one_line_spent_is_a_conflict_but_a_thing_it_never_had_is_not,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_thing_one_line_spent_is_a_conflict_but_a_thing_it_never_had_is_not"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_thing_one_line_spent_is_a_conflict_but_a_thing_it_never_had_is_not(await kernel(t,{}));});
export async function test_clues_never_conflict_they_are_a_union(kernel:any){
let turn:any;

(await pyInvoke(play_to_turn,[kernel,1],{}));
turn=pyAt((await pyInvoke(turn_json,[kernel],{})),"turn");
(await pyMethod(kernel,"table",["player_input"],{"text":"我先问问委托人。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":`t${turn}-c1`,"effects":[({["kind"]:"clue",["clue"]:(await pyMethod(FORGOTTEN_CLUE,"removeprefix",["clue-"],{}))})]}));
(await pyInvoke(narrate,[kernel,`t${turn}-c2`,"他把委托说清楚了。"],{}));
turn=pyAt((await pyInvoke(turn_json,[kernel],{})),"turn");
(await pyInvoke(fork,[kernel,turn,"side"],{}));
turn=pyAt((await pyInvoke(turn_json,[kernel],{})),"turn");
(await pyInvoke(switchValue,[kernel,turn,"main"],{}));
turn=pyAt((await pyInvoke(turn_json,[kernel],{})),"turn");
(await pyMethod(kernel,"table",["player_input"],{"text":"并线。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":`t${turn}-c1`,"effects":[({["kind"]:"merge",["name"]:"joined",["lines"]:["main","side"]})]}));
(await pyInvoke(narrate,[kernel,`t${turn}-c2`,"两条线合到了一起。"],{}));
assert.ok(pyBool(pyContains(pyAt((await pyInvoke(world_of,[kernel],{})),"discovered_clues"),(await pyMethod(FORGOTTEN_CLUE,"removeprefix",["clue-"],{})))),"tests/kernel/test_worldline.py:572 assert FORGOTTEN_CLUE.removeprefix(\"clue-\") in world_of(kernel)[\"discovered_clues\"]");
}
Object.defineProperty(test_clues_never_conflict_they_are_a_union,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_clues_never_conflict_they_are_a_union"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_clues_never_conflict_they_are_a_union(await kernel(t,{}));});

export async function echoes_of(client:any){
return pyAt((await pyInvoke(read_json,[pyDivide(pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"save"),"worldlines"),"echoes.json")],{})),"echoes");
}
Object.defineProperty(echoes_of,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function played_one_loop(client:any){

(await pyInvoke(play_to_turn,[client,1],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我们去柯比特老宅。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"move",["to"]:HOUSE})]}));
(await pyInvoke(narrate,[client,"t2-c2","你们走到了老宅门前。"],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我翻翻这些日记。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t3-c1","effects":[({["kind"]:"clue",["clue"]:"corbitt-diaries"})]}));
(await pyInvoke(narrate,[client,"t3-c2","你读到了柯比特的日记。"],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我要回到今天早上。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t4-c1","effects":[({["kind"]:"fork",["name"]:"loop-2",["mode"]:"loop"})]}));
(await pyInvoke(narrate,[client,"t4-c2","你眼前一黑，又回到了诺特的办公室。"],{}));
}
Object.defineProperty(played_one_loop,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function test_a_rewind_leaves_echoes_of_the_loop_it_came_from(tmp_path:any){
let client:any,rows:any;

client=(await pyInvoke(client_for,[tmp_path],{"content":(await pyInvoke(loop_content,[tmp_path],{}))}));
try{(await pyInvoke(played_one_loop,[client],{}));
rows=(await pyInvoke(echoes_of,[client],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push(pyAt(row,"kind"));}return __rows;})()),["move","clue_taken"])),"tests/kernel/test_worldline.py:603 assert [row[\"kind\"] for row in rows] == [\"move\", \"clue_taken\"]");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push(pyAt(row,"line"));}return __rows;})())),new Set(["main"]))),"tests/kernel/test_worldline.py:604 assert {row[\"line\"] for row in rows} == {\"main\"}");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push(pyAt(row,"loop"));}return __rows;})())),new Set([0]))),"tests/kernel/test_worldline.py:605 assert {row[\"loop\"] for row in rows} == {0}");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push(pyAt(row,"scene"));}return __rows;})()),[HOUSE,HOUSE])),"tests/kernel/test_worldline.py:606 assert [row[\"scene\"] for row in rows] == [HOUSE, HOUSE]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(rows,0),"id"),"echo:main-t2-1");return pyBool(__left)?pyEqual(pyAt(pyAt(rows,1),"id"),"echo:main-t3-1"):__left})())),"tests/kernel/test_worldline.py:607 assert rows[0][\"id\"] == \"echo:main-t2-1\" and rows[1][\"id\"] == \"echo:main-t3-1\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,1),"receipts"),["clue:corbitt-diaries-t3"])),"tests/kernel/test_worldline.py:609 assert rows[1][\"receipts\"] == [\"clue:corbitt-diaries-t3\"]");
assert.ok(pyBool(pyContains(pyAt(pyAt(rows,1),"summary"),"corbitt-diaries")),"tests/kernel/test_worldline.py:610 assert \"corbitt-diaries\" in rows[1][\"summary\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(client,"table",["player_input"],{"text":"我看看四周。"})),"capsule"),"worldlines"),"echoes_here"),0)),"tests/kernel/test_worldline.py:612 assert client.table(\"player_input\", text=\"我看看四周。\")[\"capsule\"][\"worldlines\"][\"echoes_here\"] == 0");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_rewind_leaves_echoes_of_the_loop_it_came_from,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_rewind_leaves_echoes_of_the_loop_it_came_from"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_rewind_leaves_echoes_of_the_loop_it_came_from(temporary);});
export async function test_an_echo_is_revealed_by_apply_clue_and_only_then_is_it_known(tmp_path:any){
let client:any,section:any,refused:any,applied:any,delivered:any,row:any,capsule:any;

client=(await pyInvoke(client_for,[tmp_path],{"content":(await pyInvoke(loop_content,[tmp_path],{}))}));
try{(await pyInvoke(played_one_loop,[client],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我又走去老宅。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t5-c1","effects":[({["kind"]:"move",["to"]:HOUSE})]}));
(await pyInvoke(narrate,[client,"t5-c2","你又站在了老宅门前。"],{}));
section=pyAt(pyAt((await pyMethod(client,"table",["player_input"],{"text":"这地方我好像来过。"})),"capsule"),"worldlines");
assert.ok(pyBool(pyEqual(pyAt(section,"echoes_here"),2)),"tests/kernel/test_worldline.py:627 assert section[\"echoes_here\"] == 2");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const echo of pyIterable(pyAt(section,"echoes"))){__rows.push(pyAt(echo,"id"));}return __rows;})()),["echo:main-t2-1","echo:main-t3-1"])),"tests/kernel/test_worldline.py:628 assert [echo[\"id\"] for echo in section[\"echoes\"]] == [\"echo:main-t2-1\", \"echo:main-t3-1\"]");
assert.ok(pyBool(pyContains([null,[]],(await pyMethod((await pyInvoke(world_of,[client],{})),"get",["discovered_echoes"],{})))),"tests/kernel/test_worldline.py:629 assert world_of(client).get(\"discovered_echoes\") in (None, [])");
refused=(await pyMethod(client,"table_err",["apply"],{"call_id":"t6-c0","effects":[({["kind"]:"clue",["clue"]:"echo:main-t3-1"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(refused,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(refused,"details"),"fields"),["label"]):__left})())),"tests/kernel/test_worldline.py:635 assert refused[\"code\"] == \"invalid_params\" and refused[\"details\"][\"fields\"] == [\"label\"]");
assert.ok(pyBool(pyContains([null,[]],(await pyMethod((await pyInvoke(world_of,[client],{})),"get",["discovered_echoes"],{})))),"tests/kernel/test_worldline.py:636 assert world_of(client).get(\"discovered_echoes\") in (None, [])");
applied=(await pyMethod(client,"table",["apply"],{"call_id":"t6-c1","effects":[({["kind"]:"clue",["clue"]:"echo:main-t3-1",["label"]:"有人读过的日记"})]}));
assert.ok(pyBool(pyEqual(pyAt(applied,"receipts"),["clue:echo-main-t3-1-t6"])),"tests/kernel/test_worldline.py:639 assert applied[\"receipts\"] == [\"clue:echo-main-t3-1-t6\"]");
delivered=(await pyInvoke(narrate,[client,"t6-c2","你想起有人在这里读过什么。"],{}));
row=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(delivered,"mechanics"))){if(pyBool(pyEqual(pyAt(r,"kind"),"clue"))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"clue"),"echo:main-t3-1");return pyBool(__left)?pyEqual(pyAt(row,"label"),"有人读过的日记"):__left})())),"tests/kernel/test_worldline.py:643 assert row[\"clue\"] == \"echo:main-t3-1\" and row[\"label\"] == \"有人读过的日记\"");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world_of,[client],{})),"discovered_echoes"),["echo:main-t3-1"])),"tests/kernel/test_worldline.py:645 assert world_of(client)[\"discovered_echoes\"] == [\"echo:main-t3-1\"]");
capsule=pyAt((await pyMethod(client,"table",["player_input"],{"text":"然后呢。"})),"capsule");
assert.ok(pyBool(pyEqual(pyAt(pyAt(capsule,"known"),"discovered_echoes"),["echo:main-t3-1"])),"tests/kernel/test_worldline.py:647 assert capsule[\"known\"][\"discovered_echoes\"] == [\"echo:main-t3-1\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const echo of pyIterable(pyAt(pyAt(capsule,"worldlines"),"echoes"))){__rows.push(pyAt(echo,"id"));}return __rows;})()),["echo:main-t2-1"])),"tests/kernel/test_worldline.py:649 assert [echo[\"id\"] for echo in capsule[\"worldlines\"][\"echoes\"]] == [\"echo:main-t2-1\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_an_echo_is_revealed_by_apply_clue_and_only_then_is_it_known,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_echo_is_revealed_by_apply_clue_and_only_then_is_it_known"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_echo_is_revealed_by_apply_clue_and_only_then_is_it_known(temporary);});
export async function test_an_echo_no_line_left_behind_is_refused(tmp_path:any){
let client:any,error:any;
client=(await pyInvoke(client_for,[tmp_path],{"content":(await pyInvoke(loop_content,[tmp_path],{}))}));
try{(await pyInvoke(played_one_loop,[client],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我编一个回声。"}));
error=(await pyMethod(client,"table_err",["apply"],{"call_id":"t5-c1","effects":[({["kind"]:"clue",["clue"]:"echo:main-t99-9"})]}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"unknown_entity")),"tests/kernel/test_worldline.py:661 assert error[\"code\"] == \"unknown_entity\"");
assert.ok(pyBool(pyContains(pyAt(pyAt(error,"details"),"echoes"),"echo:main-t3-1")),"tests/kernel/test_worldline.py:662 assert \"echo:main-t3-1\" in error[\"details\"][\"echoes\"]");
assert.ok(pyBool(pyContains([null,[]],(await pyMethod((await pyInvoke(world_of,[client],{})),"get",["discovered_echoes"],{})))),"tests/kernel/test_worldline.py:663 assert world_of(client).get(\"discovered_echoes\") in (None, [])");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_an_echo_no_line_left_behind_is_refused,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_echo_no_line_left_behind_is_refused"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_echo_no_line_left_behind_is_refused(temporary);});

export async function remember(client:any,turn:any,said:any){
let job:any;

job=(await pyMethod(client,"ok",["memory.job",({["campaign"]:CAMPAIGN,["turn"]:turn})],{}));
(await pyMethod(client,"ok",["memory.submit",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(job,"job_id"),["candidates"]:(await (async()=>{const __rows:any[]=[];for(const [subject,statement] of pyIterable(said)){__rows.push(({["kind"]:"knowledge",["subject"]:subject,["knowers"]:[subject],["entities"]:[subject],["statement"]:statement,["privacy"]:"player_safe",["state"]:"accurate",["confidence"]:0.9}));}return __rows;})())})],{}));
}
Object.defineProperty(remember,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"turn","rest":false,"varargs":false},{"name":"said","rest":false,"varargs":true}]});
export async function test_a_candidate_carries_the_line_and_the_circuit_it_was_remembered_on(tmp_path:any){
let client:any,rows:any,first:any,second:any;

client=(await pyInvoke(client_for,[tmp_path],{"content":(await pyInvoke(loop_content,[tmp_path],{}))}));
try{(await pyInvoke(play_to_turn,[client,1],{}));
(await pyInvoke(remember,[client,1,["Steven Knott","诺特第一圈就在这张桌子后面。"]],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我要回到今天早上。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"fork",["name"]:"loop-2",["mode"]:"loop"})]}));
(await pyInvoke(narrate,[client,"t2-c2","你眼前一黑，又回到了诺特的办公室。"],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我又见到了诺特。"}));
(await pyInvoke(narrate,[client,"t3-c1","诺特还是坐在那里。"],{}));
(await pyInvoke(remember,[client,3,["Steven Knott","诺特在第二圈还是坐在同一张桌子后面。"]],{}));
rows=(await pyInvoke(read_jsonl,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"memory"),"candidates.jsonl")],{}));
const __unpack36938=[pyAt(rows,0),pyAt(rows,(-1))];first=__unpack36938[0];second=__unpack36938[1];
assert.ok(pyBool(pyEqual([pyAt(first,"worldline"),pyAt(first,"loop")],["main",0])),"tests/kernel/test_worldline.py:696 assert (first[\"worldline\"], first[\"loop\"]) == (\"main\", 0)");
assert.ok(pyBool(pyEqual([pyAt(second,"worldline"),pyAt(second,"loop")],["loop-2",1])),"tests/kernel/test_worldline.py:697 assert (second[\"worldline\"], second[\"loop\"]) == (\"loop-2\", 1)");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_candidate_carries_the_line_and_the_circuit_it_was_remembered_on,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_candidate_carries_the_line_and_the_circuit_it_was_remembered_on"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_candidate_carries_the_line_and_the_circuit_it_was_remembered_on(temporary);});
export async function test_recall_memory_reads_this_line_by_default_and_every_line_on_request(kernel:any){
let here:any,statements:any,on_main:any,every:any,named:any,unknown:any;
(await pyInvoke(play_to_turn,[kernel,1],{}));
(await pyInvoke(remember,[kernel,1,["Steven Knott","Knott said the house has been empty for years."]],{}));
(await pyInvoke(fork,[kernel,2,"side"],{}));
(await pyInvoke(remember,[kernel,2,["Steven Knott","On this line Knott admitted he had been inside."]],{}));
here=(await pyMethod(kernel,"table",["recall"],{"what":"memory","about":["Steven Knott"]}));
assert.ok(pyBool(pyEqual(pyAt(here,"line"),"current")),"tests/kernel/test_worldline.py:709 assert here[\"line\"] == \"current\"");
statements=(await (async()=>{const __rows:any[]=[];for(const hit of pyIterable(pyAt(here,"hits"))){__rows.push(pyAt(hit,"statement"));}return __rows;})());
assert.ok(pyBool(pyContains(statements,"On this line Knott admitted he had been inside.")),"tests/kernel/test_worldline.py:713 assert \"On this line Knott admitted he had been inside.\" in statements");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const hit of pyIterable(pyAt(here,"hits"))){__rows.push(pyAt(hit,"worldline"));}return __rows;})())),new Set(["main","side"]))),"tests/kernel/test_worldline.py:714 assert {hit[\"worldline\"] for hit in here[\"hits\"]} == {\"main\", \"side\"}");
(await pyMethod(kernel,"table",["player_input"],{"text":"我回到原来那条路。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t3-c9","effects":[({["kind"]:"switch",["line"]:"main"})]}));
(await pyInvoke(narrate,[kernel,"t3-c10","你回到了原来的那一条线。"],{}));
on_main=(await (async()=>{const __rows:any[]=[];for(const hit of pyIterable(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory","about":["Steven Knott"]})),"hits"))){__rows.push(pyAt(hit,"statement"));}return __rows;})());
assert.ok(pyBool(!pyContains(on_main,"On this line Knott admitted he had been inside.")),"tests/kernel/test_worldline.py:721 assert \"On this line Knott admitted he had been inside.\" not in on_main");
every=pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory","about":["Steven Knott"],"line":"any"})),"hits");
assert.ok(pyBool(pyContains((await (async()=>{const __rows:any[]=[];for(const hit of pyIterable(every)){__rows.push(pyAt(hit,"statement"));}return __rows;})()),"On this line Knott admitted he had been inside.")),"tests/kernel/test_worldline.py:723 assert \"On this line Knott admitted he had been inside.\" in [hit[\"statement\"] for hit in every]");
named=pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory","about":["Steven Knott"],"line":"side"})),"hits");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const hit of pyIterable(named)){__rows.push(pyAt(hit,"worldline"));}return __rows;})())),new Set(["main","side"]))),"tests/kernel/test_worldline.py:725 assert {hit[\"worldline\"] for hit in named} == {\"main\", \"side\"}");
unknown=(await pyMethod(kernel,"table_err",["recall"],{"what":"memory","about":["Steven Knott"],"line":"ghost"}));
assert.ok(pyBool(pyEqual(pyAt(unknown,"code"),"invalid_params")),"tests/kernel/test_worldline.py:727 assert unknown[\"code\"] == \"invalid_params\"");
}
Object.defineProperty(test_recall_memory_reads_this_line_by_default_and_every_line_on_request,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_recall_memory_reads_this_line_by_default_and_every_line_on_request"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_recall_memory_reads_this_line_by_default_and_every_line_on_request(await kernel(t,{}));});
export async function rewound_with_a_memory(tmp_path:any,name:any,remembers:any){
let client:any;

client=(await pyInvoke(client_for,[tmp_path,name],{"content":(await pyInvoke(loop_content,[pyDivide(tmp_path,name)],{"remembers":remembers}))}));
(await pyInvoke(play_to_turn,[client,1],{}));
(await pyInvoke(remember,[client,1,["Steven Knott","Knott watched them leave on the first circuit."]],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我要回到今天早上。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"fork",["name"]:"loop-2",["mode"]:"loop"})]}));
(await pyInvoke(narrate,[client,"t2-c2","你眼前一黑，又回到了诺特的办公室。"],{}));
return client;
}
Object.defineProperty(rewound_with_a_memory,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false},{"name":"name","rest":false,"varargs":false},{"name":"remembers","rest":false,"varargs":false}]});
export async function test_only_a_declared_person_carries_what_another_circuit_knew(tmp_path:any){
let declared:any,capsule:any,knott:any,secrets:any,silent:any;

declared=(await pyInvoke(rewound_with_a_memory,[tmp_path,"ws-remembers"],{"remembers":true}));
try{capsule=pyAt((await pyMethod(declared,"table",["player_input"],{"text":"诺特还在吗。"})),"capsule");
knott=(await pyNext((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(pyAt(capsule,"present"))){if(pyBool(pyEqual(pyAt(entry,"name"),"Steven Knott"))){__rows.push(entry);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(knott,"from_other_lines"),[({["statement"]:"Knott watched them leave on the first circuit.",["line"]:"main",["loop"]:0,["turn"]:1,["authority"]:"conversation_report"})])),"tests/kernel/test_worldline.py:749 assert knott[\"from_other_lines\"] == [{\"statement\": \"Knott watched them leave on the first circuit.\",\n                                              \"line\": \"main\", \"loop\": 0, \"turn\": 1, \"authority\": \"conversation_report\"}]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(capsule,"worldlines"),"remembers"),["Steven Knott"])),"tests/kernel/test_worldline.py:751 assert capsule[\"worldlines\"][\"remembers\"] == [\"Steven Knott\"]");
secrets=pyAt((await pyMethod(declared,"table",["lookup"],{"kind":"secret","scope":"scene"})),"npc_secrets");
assert.ok(pyBool(pyEqual(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(secrets)){if(pyBool(pyEqual(pyAt(row,"name"),"Steven Knott"))){__rows.push(row);}}return __rows;})()))),"from_other_lines"),pyAt(knott,"from_other_lines"))),"tests/kernel/test_worldline.py:754 assert next(row for row in secrets if row[\"name\"] == \"Steven Knott\")[\"from_other_lines\"] \\\n            == knott[\"from_other_lines\"]");}finally{(await pyMethod(declared,"close",[],{}));}
silent=(await pyInvoke(rewound_with_a_memory,[tmp_path,"ws-forgets"],{"remembers":false}));
try{capsule=pyAt((await pyMethod(silent,"table",["player_input"],{"text":"诺特还在吗。"})),"capsule");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(pyAt(capsule,"present"))){__rows.push(!pyContains(entry,"from_other_lines"));}return __rows;})())))),"tests/kernel/test_worldline.py:762 assert all(\"from_other_lines\" not in entry for entry in capsule[\"present\"])");
assert.ok(pyBool(pyEqual(pyAt(pyAt(capsule,"worldlines"),"remembers"),[])),"tests/kernel/test_worldline.py:763 assert capsule[\"worldlines\"][\"remembers\"] == []");
secrets=pyAt((await pyMethod(silent,"table",["lookup"],{"kind":"secret","scope":"scene"})),"npc_secrets");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(secrets)){__rows.push(!pyContains(row,"from_other_lines"));}return __rows;})())))),"tests/kernel/test_worldline.py:765 assert all(\"from_other_lines\" not in row for row in secrets)");}finally{(await pyMethod(silent,"close",[],{}));}
}
Object.defineProperty(test_only_a_declared_person_carries_what_another_circuit_knew,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_only_a_declared_person_carries_what_another_circuit_knew"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_only_a_declared_person_carries_what_another_circuit_knew(temporary);});
export async function test_the_capsule_carries_the_previous_circuit(tmp_path:any){
let client:any,section:any;
client=(await pyInvoke(client_for,[tmp_path],{"content":(await pyInvoke(loop_content,[tmp_path],{}))}));
try{(await pyInvoke(play_to_turn,[client,1],{}));
(await pyInvoke(remember,[client,1,["Steven Knott","他们在第一圈问过钥匙的事。"]],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我要回到今天早上。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"fork",["name"]:"loop-2",["mode"]:"loop"})]}));
(await pyInvoke(narrate,[client,"t2-c2","你眼前一黑，又回到了诺特的办公室。"],{}));
section=pyAt(pyAt((await pyMethod(client,"table",["player_input"],{"text":"我看看四周。"})),"capsule"),"worldlines");
assert.ok(pyBool(pyEqual(pyAt(section,"loop"),1)),"tests/kernel/test_worldline.py:779 assert section[\"loop\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(section,"previous_loop"),[({["statement"]:"他们在第一圈问过钥匙的事。",["turn"]:1,["authority"]:"conversation_report"})])),"tests/kernel/test_worldline.py:780 assert section[\"previous_loop\"] == [{\"statement\": \"他们在第一圈问过钥匙的事。\", \"turn\": 1,\n                                             \"authority\": \"conversation_report\"}]");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_the_capsule_carries_the_previous_circuit,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_capsule_carries_the_previous_circuit"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_capsule_carries_the_previous_circuit(temporary);});

export async function test_a_failed_transition_rolls_the_reference_back_and_keeps_the_turn(kernel:any){
let workspace:any,delivered:any,meta:any,telemetry:any;

(await pyInvoke(play_to_turn,[kernel,2],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我要换一条路走。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t3-c1","effects":[({["kind"]:"fork",["name"]:"side",["mode"]:"if"})]}));
workspace=kernel.workspace;
(await pyInvoke(git,[workspace,"update-ref","refs/heads/wl/side",(await pyInvoke(git,[workspace,"rev-parse","HEAD"],{}))],{}));
delivered=(await pyInvoke(narrate,[kernel,"t3-c2","你眨了眨眼。"],{}));
assert.ok(pyBool((await (async()=>{const __left=pyAt(delivered,"commit");return pyBool(__left)?!pyContains(delivered,"worldline"):__left})())),"tests/kernel/test_worldline.py:798 assert delivered[\"commit\"] and \"worldline\" not in delivered");
assert.ok(pyBool(pyEqual((await pyInvoke(head_ref,[workspace],{})),"refs/heads/wl/main")),"tests/kernel/test_worldline.py:799 assert head_ref(workspace) == \"refs/heads/wl/main\"");
meta=(await pyInvoke(meta_of,[kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(meta,"active_worldline"),"main")),"tests/kernel/test_worldline.py:801 assert meta[\"active_worldline\"] == \"main\"");
assert.ok(pyBool(!pyContains(pyAt(meta,"worldlines"),"side")),"tests/kernel/test_worldline.py:802 assert \"side\" not in meta[\"worldlines\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(meta,"worldlines"),"main"),"status"),"active")),"tests/kernel/test_worldline.py:803 assert meta[\"worldlines\"][\"main\"][\"status\"] == \"active\"");
telemetry=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyInvoke(read_jsonl,[pyDivide((await pyInvoke(campaign_dir,[workspace],{})),"telemetry.jsonl")],{})))){if(pyBool(pyEqual((await pyMethod(r,"get",["lane"],{})),"worldline"))){__rows.push(r);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=telemetry;return pyBool(__left)?(pyAt(pyAt(telemetry,(-1)),"ok")===false):__left})())),"tests/kernel/test_worldline.py:805 assert telemetry and telemetry[-1][\"ok\"] is False");
assert.ok(pyBool(pyAt((await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[workspace],{})),"turns"),"0003.json")],{})),"commit")),"tests/kernel/test_worldline.py:807 assert read_json(campaign_dir(workspace) / \"turns\" / \"0003.json\")[\"commit\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我继续走。"})),"turn"),4)),"tests/kernel/test_worldline.py:808 assert kernel.table(\"player_input\", text=\"我继续走。\")[\"turn\"] == 4");
}
Object.defineProperty(test_a_failed_transition_rolls_the_reference_back_and_keeps_the_turn,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_failed_transition_rolls_the_reference_back_and_keeps_the_turn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_failed_transition_rolls_the_reference_back_and_keeps_the_turn(await kernel(t,{}));});

export async function test_the_same_action_on_two_lines_does_not_roll_the_same_numbers(kernel:any){
let action:any,on_side:any,on_main:any;
action=({["intent"]:"investigate",["goal"]:"找出房间里藏着的东西",["method"]:"用侦查扫视桌面和墙角"});
async function three_rolls(turn:any){
(await pyMethod(kernel,"table",["player_input"],{"text":"我仔细看看。"}));
return (await (async()=>{const __rows:any[]=[];for(const n of pyIterable([1,2,3])){__rows.push(pyAt(pyAt((await pyMethod(kernel,"table",["resolve"],{"call_id":`t${turn}-c${n}`,"action":action})),"outcome"),"roll"));}return __rows;})());
}
Object.defineProperty(three_rolls,"__pySignature",{value:[{"name":"turn","rest":false,"varargs":false}]});
(await pyInvoke(play_to_turn,[kernel,2],{}));
(await pyInvoke(fork,[kernel,3,"side"],{}));
on_side=(await pyInvoke(three_rolls,[4],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t4-c4","effects":[({["kind"]:"switch",["line"]:"main"})]}));
(await pyInvoke(narrate,[kernel,"t4-c5","你回到了原来的那一条线。"],{}));
on_main=(await pyInvoke(three_rolls,[4],{}));
assert.ok(pyBool(!pyEqual(on_side,on_main)),"tests/kernel/test_worldline.py:828 assert on_side != on_main");
}
Object.defineProperty(test_the_same_action_on_two_lines_does_not_roll_the_same_numbers,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_same_action_on_two_lines_does_not_roll_the_same_numbers"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_same_action_on_two_lines_does_not_roll_the_same_numbers(await kernel(t,{}));});
export async function test_an_explicit_seed_still_pins_the_dice(tmp_path:any){
let action:any,rolls:any,name:any,client:any;

action=({["intent"]:"investigate",["goal"]:"找出房间里藏着的东西",["method"]:"用侦查扫视桌面和墙角"});
rolls=[];
for(name of pyIterable(["ws-a","ws-b"])){
client=(await pyInvoke(client_for,[tmp_path,name],{"env":({["COC_KERNEL_SEED"]:"7"})}));
try{(await pyInvoke(play_to_turn,[client,1],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我仔细看看。"}));
(await pyMethod(rolls,"append",[pyAt(pyAt((await pyMethod(client,"table",["resolve"],{"call_id":"t2-c1","action":action})),"outcome"),"roll")],{}));}finally{(await pyMethod(client,"close",[],{}));}
}
assert.ok(pyBool(pyEqual(pyAt(rolls,0),pyAt(rolls,1))),"tests/kernel/test_worldline.py:844 assert rolls[0] == rolls[1]");
}
Object.defineProperty(test_an_explicit_seed_still_pins_the_dice,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_explicit_seed_still_pins_the_dice"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_explicit_seed_still_pins_the_dice(temporary);});

export async function test_a_module_without_a_reset_refuses_a_loop_fork_but_never_an_if(kernel:any){
let error:any;
(await pyInvoke(play_to_turn,[kernel,1],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我想回到早上。"}));
error=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"fork",["name"]:"loop-1",["mode"]:"loop"})]}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_worldline.py:853 assert error[\"code\"] == \"invalid_params\"");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(error,"message"),"no loop anchor");return pyBool(__left)?pyContains(pyAt(error,"fix"),"mode: if"):__left})())),"tests/kernel/test_worldline.py:854 assert \"no loop anchor\" in error[\"message\"] and \"mode: if\" in error[\"fix\"]");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c2","effects":[({["kind"]:"fork",["name"]:"loop-1",["mode"]:"if"})]}));
(await pyInvoke(narrate,[kernel,"t2-c3","你眨了眨眼。"],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(meta_of,[kernel],{})),"active_worldline"),"loop-1")),"tests/kernel/test_worldline.py:857 assert meta_of(kernel)[\"active_worldline\"] == \"loop-1\"");
}
Object.defineProperty(test_a_module_without_a_reset_refuses_a_loop_fork_but_never_an_if,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_module_without_a_reset_refuses_a_loop_fork_but_never_an_if"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_module_without_a_reset_refuses_a_loop_fork_but_never_an_if(await kernel(t,{}));});
export async function test_a_loop_fork_rewinds_to_the_anchor_and_keeps_what_persists(tmp_path:any){
let client:any,meta:any,line:any,world:any,subjects:any,anchor:any,left:any;
client=(await pyInvoke(client_for,[tmp_path],{"content":(await pyInvoke(loop_content,[tmp_path],{}))}));
try{(await pyInvoke(play_to_turn,[client,1],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我拿走钥匙，也听完了委托。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"clue",["clue"]:"knott-keys"}),({["kind"]:"clue",["clue"]:"knott-commission"})]}));
(await pyInvoke(narrate,[client,"t2-c2","你收好钥匙，也记下了委托。"],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我们去柯比特老宅。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t3-c1","effects":[({["kind"]:"move",["to"]:HOUSE})]}));
(await pyInvoke(narrate,[client,"t3-c2","你们走到了老宅门前。"],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world_of,[client],{})),"active_scene"),HOUSE)),"tests/kernel/test_worldline.py:871 assert world_of(client)[\"active_scene\"] == HOUSE");
(await pyMethod(client,"table",["player_input"],{"text":"我要回到今天早上。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t4-c1","effects":[({["kind"]:"fork",["name"]:"loop-2",["mode"]:"loop"})]}));
(await pyInvoke(narrate,[client,"t4-c2","你眼前一黑，又回到了诺特的办公室。"],{}));
meta=(await pyInvoke(meta_of,[client],{}));
line=pyAt(pyAt(meta,"worldlines"),"loop-2");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(line,"kind"),"loop");return pyBool(__left)?pyEqual(pyAt(line,"loop"),1):__left})())),"tests/kernel/test_worldline.py:879 assert line[\"kind\"] == \"loop\" and line[\"loop\"] == 1");
world=(await pyInvoke(world_of,[client],{}));
assert.ok(pyBool(pyEqual(pyAt(world,"active_scene"),BRIEFING)),"tests/kernel/test_worldline.py:881 assert world[\"active_scene\"] == BRIEFING");
assert.ok(pyBool(pyEqual(pyAt(world,"discovered_clues"),["knott-keys"])),"tests/kernel/test_worldline.py:883 assert world[\"discovered_clues\"] == [\"knott-keys\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(turn_json,[client],{})),"turn"),5)),"tests/kernel/test_worldline.py:884 assert turn_json(client)[\"turn\"] == 5");
subjects=(await pyMethod((await pyInvoke(git,[client.workspace,"log","--format=%s","-3"],{})),"splitlines",[],{}));
assert.ok(pyBool(pyEqual(pyAt(subjects,0),"loop 1 reset")),"tests/kernel/test_worldline.py:886 assert subjects[0] == \"loop 1 reset\"");
anchor=(await pyInvoke(read_json,[pyDivide(pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"save"),"worldlines"),"anchor.json")],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(anchor,"scene"),BRIEFING);return pyBool(__left)?pyEqual(pyAt(anchor,"turn"),0):__left})())),"tests/kernel/test_worldline.py:889 assert anchor[\"scene\"] == BRIEFING and anchor[\"turn\"] == 0");
assert.ok(pyBool(pyEqual(pyAt(pyAt(anchor,"world"),"discovered_clues"),[])),"tests/kernel/test_worldline.py:890 assert anchor[\"world\"][\"discovered_clues\"] == []");
left=(await pyMethod(json,"loads",[(await pyInvoke(blob,[client.workspace,"wl/main","world.json"],{}))],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(left,"active_scene"),HOUSE);return pyBool(__left)?pyEqual((await pyInvoke(pySorted,[pyAt(left,"discovered_clues")],{})),["knott-commission","knott-keys"]):__left})())),"tests/kernel/test_worldline.py:893 assert left[\"active_scene\"] == HOUSE and sorted(left[\"discovered_clues\"]) == \\\n            [\"knott-commission\", \"knott-keys\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_loop_fork_rewinds_to_the_anchor_and_keeps_what_persists,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_loop_fork_rewinds_to_the_anchor_and_keeps_what_persists"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_loop_fork_rewinds_to_the_anchor_and_keeps_what_persists(temporary);});
export async function test_the_capsule_carries_the_line_the_anchor_and_who_remembers(tmp_path:any){
let client:any,capsule:any,section:any,because:any;
client=(await pyInvoke(client_for,[tmp_path],{"content":(await pyInvoke(loop_content,[tmp_path],{}))}));
try{(await pyInvoke(play_to_turn,[client,1],{}));
capsule=pyAt((await pyMethod(client,"table",["player_input"],{"text":"我看看诺特。"})),"capsule");
section=pyAt(capsule,"worldlines");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(section,"line"),"main");return pyBool(__left)?pyEqual(pyAt(section,"kind"),"main"):__left})());return pyBool(__left)?pyEqual(pyAt(section,"loop"),0):__left})())),"tests/kernel/test_worldline.py:905 assert section[\"line\"] == \"main\" and section[\"kind\"] == \"main\" and section[\"loop\"] == 0");
assert.ok(pyBool(pyEqual(pyAt(section,"anchor"),({["scene"]:BRIEFING,["since_turn"]:0}))),"tests/kernel/test_worldline.py:906 assert section[\"anchor\"] == {\"scene\": BRIEFING, \"since_turn\": 0}");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(section,"persisted"),["Corbitt house keys"]);return pyBool(__left)?__left:pyAt(section,"persisted")})())),"tests/kernel/test_worldline.py:907 assert section[\"persisted\"] == [\"Corbitt house keys\"] or section[\"persisted\"]");
assert.ok(pyBool(pyContains((await pyMethod(" ","join",[pyAt(section,"remembers")],{})),"Steven Knott")),"tests/kernel/test_worldline.py:908 assert \"Steven Knott\" in \" \".join(section[\"remembers\"])");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(section,"echoes_here"),0);return pyBool(__left)?pyEqual(pyAt(section,"echoes"),[]):__left})());return pyBool(__left)?pyEqual(pyAt(section,"previous_loop"),[]):__left})())),"tests/kernel/test_worldline.py:909 assert section[\"echoes_here\"] == 0 and section[\"echoes\"] == [] and section[\"previous_loop\"] == []");
assert.ok(pyBool(pyEqual(pyAt(section,"lines"),[({["name"]:"main",["kind"]:"main",["loop"]:0,["last_turn"]:null,["status"]:"active"})])),"tests/kernel/test_worldline.py:910 assert section[\"lines\"] == [{\"name\": \"main\", \"kind\": \"main\", \"loop\": 0, \"last_turn\": None,\n                                     \"status\": \"active\"}]");
assert.ok(pyBool((pyAt(section,"loop_available")===false)),"tests/kernel/test_worldline.py:913 assert section[\"loop_available\"] is False");
assert.ok(pyBool(!pyBool((await (async()=>{const __rows:any[]=[];for(const o of pyIterable(pyAt(capsule,"obligations"))){if(pyBool(pyEqual(pyAt(o,"kind"),"loop"))){__rows.push(o);}}return __rows;})()))),"tests/kernel/test_worldline.py:914 assert not [o for o in capsule[\"obligations\"] if o[\"kind\"] == \"loop\"]");
because=(await pyMethod(" ","join",[pyAt(pyAt(capsule,"director"),"because")],{}));
assert.ok(pyBool((await (async()=>{const __left=pyContains(because,"loop_count = 0");return pyBool(__left)?pyContains(because,"loop_available = False"):__left})())),"tests/kernel/test_worldline.py:916 assert \"loop_count = 0\" in because and \"loop_available = False\" in because");
assert.ok(pyBool(pyContains(because,"echoes_here = 0")),"tests/kernel/test_worldline.py:917 assert \"echoes_here = 0\" in because");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_the_capsule_carries_the_line_the_anchor_and_who_remembers,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_capsule_carries_the_line_the_anchor_and_who_remembers"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_capsule_carries_the_line_the_anchor_and_who_remembers(temporary);});
export async function test_the_house_is_where_the_loop_can_be_rewound(tmp_path:any){
let client:any,capsule:any,loop_rows:any;
client=(await pyInvoke(client_for,[tmp_path],{"content":(await pyInvoke(loop_content,[tmp_path],{}))}));
try{(await pyInvoke(play_to_turn,[client,1],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我们去柯比特老宅。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"move",["to"]:HOUSE})]}));
(await pyInvoke(narrate,[client,"t2-c2","你们走到了老宅门前。"],{}));
capsule=pyAt((await pyMethod(client,"table",["player_input"],{"text":"我站在门口想事情。"})),"capsule");
assert.ok(pyBool((pyAt(pyAt(capsule,"worldlines"),"loop_available")===true)),"tests/kernel/test_worldline.py:930 assert capsule[\"worldlines\"][\"loop_available\"] is True");
loop_rows=(await (async()=>{const __rows:any[]=[];for(const o of pyIterable(pyAt(capsule,"obligations"))){if(pyBool(pyEqual(pyAt(o,"kind"),"loop"))){__rows.push(o);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=loop_rows;return pyBool(__left)?pyEqual(pyAt(pyAt(loop_rows,0),"who"),"keeper"):__left})())),"tests/kernel/test_worldline.py:932 assert loop_rows and loop_rows[0][\"who\"] == \"keeper\"");
assert.ok(pyBool(pyContains((await pyMethod(" ","join",[pyAt(pyAt(capsule,"director"),"because")],{})),"loop_available = True")),"tests/kernel/test_worldline.py:933 assert \"loop_available = True\" in \" \".join(capsule[\"director\"][\"because\"])");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_the_house_is_where_the_loop_can_be_rewound,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_house_is_where_the_loop_can_be_rewound"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_house_is_where_the_loop_can_be_rewound(temporary);});
export async function test_a_reset_that_keeps_the_clock_keeps_it(tmp_path:any){
let content:any,client:any,minutes:any,world:any;
content=(await pyInvoke(loop_content,[tmp_path],{"reset":({["clock"]:"keep",["investigators"]:"anchor"})}));
client=(await pyInvoke(client_for,[tmp_path],{"content":content}));
try{(await pyInvoke(play_to_turn,[client,1],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我们花点时间打听消息，再去老宅。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"time",["minutes"]:90,["beyond_travel"]:true}),({["kind"]:"move",["to"]:HOUSE})]}));
(await pyInvoke(narrate,[client,"t2-c2","你们花了 90 分钟打听，然后走到老宅门前。"],{}));
minutes=pyAt(pyAt((await pyInvoke(world_of,[client],{})),"clock"),"minutes");
assert.ok(pyBool(pyLessEqual(90,minutes)),"tests/kernel/test_worldline.py:948 assert minutes >= 90");
(await pyMethod(client,"table",["player_input"],{"text":"我要回到今天早上。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t3-c1","effects":[({["kind"]:"fork",["name"]:"loop-2",["mode"]:"loop"})]}));
(await pyInvoke(narrate,[client,"t3-c2","你眼前一黑，又回到了诺特的办公室。"],{}));
world=(await pyInvoke(world_of,[client],{}));
assert.ok(pyBool(pyEqual(pyAt(world,"active_scene"),BRIEFING)),"tests/kernel/test_worldline.py:953 assert world[\"active_scene\"] == BRIEFING");
assert.ok(pyBool(pyEqual(pyAt(pyAt(world,"clock"),"minutes"),minutes)),"tests/kernel/test_worldline.py:954 assert world[\"clock\"][\"minutes\"] == minutes");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_reset_that_keeps_the_clock_keeps_it,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_reset_that_keeps_the_clock_keeps_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_reset_that_keeps_the_clock_keeps_it(temporary);});

export async function test_open_returns_to_the_active_line_and_the_checkpoint_names_it(kernel:any){
let opened:any,checkpoint:any;
(await pyInvoke(play_to_turn,[kernel,2],{}));
(await pyInvoke(fork,[kernel,3,"side"],{}));
opened=(await pyMethod(kernel,"table",["open"],{}));
assert.ok(pyBool(pyEqual(pyAt(opened,"worldline"),({["name"]:"side",["kind"]:"if",["loop"]:0}))),"tests/kernel/test_worldline.py:965 assert opened[\"worldline\"] == {\"name\": \"side\", \"kind\": \"if\", \"loop\": 0}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(opened,"resume"),"worldline"),"side")),"tests/kernel/test_worldline.py:966 assert opened[\"resume\"][\"worldline\"] == \"side\"");
checkpoint=(await pyInvoke(read_json,[pyDivide(pyDivide(pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"save"),"continuation"),"latest.json")],{}));
assert.ok(pyBool(pyContains(["main","side"],pyAt(checkpoint,"worldline"))),"tests/kernel/test_worldline.py:968 assert checkpoint[\"worldline\"] in (\"main\", \"side\")");
}
Object.defineProperty(test_open_returns_to_the_active_line_and_the_checkpoint_names_it,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_open_returns_to_the_active_line_and_the_checkpoint_names_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_open_returns_to_the_active_line_and_the_checkpoint_names_it(await kernel(t,{}));});
export async function test_a_new_process_opens_the_line_the_last_one_left_on(kernel:any,tmp_path:any){
let again:any,opened:any;
(await pyInvoke(play_to_turn,[kernel,2],{}));
(await pyInvoke(fork,[kernel,3,"side"],{}));
(await pyMethod(kernel,"close",[],{}));
again=(new RpcClient(kernel.workspace));
try{opened=(await pyMethod(again,"table",["open"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(opened,"worldline"),"name"),"side")),"tests/kernel/test_worldline.py:978 assert opened[\"worldline\"][\"name\"] == \"side\"");
assert.ok(pyBool(pyEqual((await pyInvoke(head_ref,[kernel.workspace],{})),"refs/heads/wl/side")),"tests/kernel/test_worldline.py:979 assert head_ref(kernel.workspace) == \"refs/heads/wl/side\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(opened,"turn"),"number"),4)),"tests/kernel/test_worldline.py:980 assert opened[\"turn\"][\"number\"] == 4");}finally{(await pyMethod(again,"close",[],{}));}
}
Object.defineProperty(test_a_new_process_opens_the_line_the_last_one_left_on,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_new_process_opens_the_line_the_last_one_left_on"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_new_process_opens_the_line_the_last_one_left_on(await kernel(t,{}),temporary);});
export async function test_recall_history_lines_returns_the_tree_of_worldlines(kernel:any){
let tree:any,rows:any;
(await pyInvoke(play_to_turn,[kernel,2],{}));
(await pyInvoke(fork,[kernel,3,"side"],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我看看四周。"}));
tree=pyAt((await pyMethod(kernel,"table",["recall"],{"what":"history","lines":true})),"lines");
assert.ok(pyBool(pyEqual(pyAt(tree,"active"),"side")),"tests/kernel/test_worldline.py:990 assert tree[\"active\"] == \"side\"");
rows=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(tree,"lines"))){__rows.push([pyAt(row,"name"),row]);}return __rows;})()));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(rows,"main"),"status"),"dormant");return pyBool(__left)?(pyAt(pyAt(rows,"main"),"active")===false):__left})())),"tests/kernel/test_worldline.py:992 assert rows[\"main\"][\"status\"] == \"dormant\" and rows[\"main\"][\"active\"] is False");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(rows,"side"),"active")===true);return pyBool(__left)?pyEqual(pyAt(pyAt(rows,"side"),"kind"),"if"):__left})())),"tests/kernel/test_worldline.py:993 assert rows[\"side\"][\"active\"] is True and rows[\"side\"][\"kind\"] == \"if\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(rows,"side"),"forked_from"),"line"),"main");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(rows,"side"),"forked_from"),"turn"),3):__left})())),"tests/kernel/test_worldline.py:994 assert rows[\"side\"][\"forked_from\"][\"line\"] == \"main\" and rows[\"side\"][\"forked_from\"][\"turn\"] == 3");
assert.ok(pyBool(pyAt(pyAt(pyAt(rows,"side"),"forked_from"),"commit")),"tests/kernel/test_worldline.py:995 assert rows[\"side\"][\"forked_from\"][\"commit\"]");
assert.ok(pyBool(!pyContains((await pyMethod(kernel,"table",["recall"],{"what":"history"})),"lines")),"tests/kernel/test_worldline.py:997 assert \"lines\" not in kernel.table(\"recall\", what=\"history\")");
}
Object.defineProperty(test_recall_history_lines_returns_the_tree_of_worldlines,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_recall_history_lines_returns_the_tree_of_worldlines"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_recall_history_lines_returns_the_tree_of_worldlines(await kernel(t,{}));});

export async function owed_ledger(client:any){
let path:any;
path=pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"owed.json");
return (pyBool((await pyMethod(path,"exists",[],{})))?(await pyInvoke(read_json,[path],{})):({["open"]:[],["closed"]:[]}));
}
Object.defineProperty(owed_ledger,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function seed_owed(client:any,turn:any){
let row:any,directory:any,path:any,record:any;

row=({["name"]:`t${turn}-owed-1`,["turn"]:turn,["kind"]:"time",["effect"]:({["kind"]:"time",["band"]:"quick_observation"}),["quote"]:"时间过去了一会儿。",["what"]:"time that passed beyond any journey: quick_observation",["job"]:pyMultiply("0",64),["at"]:"2026-09-29T00:00:00Z"});
directory=(await pyInvoke(campaign_dir,[client.workspace],{}));
(await pyMethod((pyDivide(directory,"owed.json")),"write_text",[(await pyMethod(json,"dumps",[({["open"]:[row],["closed"]:[]})],{}))],{"encoding":"utf-8"}));
path=pyDivide(pyDivide(directory,"turns"),`${pyFormat(turn,"04d")}.json`);
record=(await pyInvoke(read_json,[path],{}));
record["owed"]=[row];
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[record],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
return row;
}
Object.defineProperty(seed_owed,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"turn","rest":false,"varargs":false}]});
export async function test_a_fork_from_an_earlier_turn_carries_that_turns_owed_rows(kernel:any){
let row:any;
(await pyInvoke(play_to_turn,[kernel,3],{}));
row=(await pyInvoke(seed_owed,[kernel,2],{}));
(await pyInvoke(fork,[kernel,4,"rewound"],{"from_turn":2}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(meta_of,[kernel],{})),"active_worldline"),"rewound")),"tests/kernel/test_worldline.py:1029 assert meta_of(kernel)[\"active_worldline\"] == \"rewound\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(pyAt((await pyInvoke(owed_ledger,[kernel],{})),"open"))){__rows.push(pyAt(entry,"name"));}return __rows;})()),[pyAt(row,"name")])),"tests/kernel/test_worldline.py:1031 assert [entry[\"name\"] for entry in owed_ledger(kernel)[\"open\"]] == [row[\"name\"]]");
}
Object.defineProperty(test_a_fork_from_an_earlier_turn_carries_that_turns_owed_rows,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_fork_from_an_earlier_turn_carries_that_turns_owed_rows"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_fork_from_an_earlier_turn_carries_that_turns_owed_rows(await kernel(t,{}));});
export async function test_a_rewind_closes_what_the_rewound_circuit_owed(tmp_path:any){
let client:any,row:any,ledger:any;
client=(await pyInvoke(client_for,[tmp_path],{"content":(await pyInvoke(loop_content,[tmp_path],{}))}));
try{(await pyInvoke(play_to_turn,[client,1],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我们去柯比特老宅。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"move",["to"]:HOUSE})]}));
(await pyInvoke(narrate,[client,"t2-c2","你们走到了老宅门前。"],{}));
row=(await pyInvoke(seed_owed,[client,2],{}));
(await pyMethod(client,"table",["player_input"],{"text":"我要回到今天早上。"}));
(await pyMethod(client,"table",["apply"],{"call_id":"t3-c1","effects":[({["kind"]:"fork",["name"]:"loop-2",["mode"]:"loop"})]}));
(await pyInvoke(narrate,[client,"t3-c2","你眼前一黑，又回到了诺特的办公室。"],{}));
ledger=(await pyInvoke(owed_ledger,[client],{}));
assert.ok(pyBool(pyEqual(pyAt(ledger,"open"),[])),"tests/kernel/test_worldline.py:1046 assert ledger[\"open\"] == []");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(pyAt(ledger,"closed"))){__rows.push([pyAt(entry,"name"),pyAt(entry,"how")]);}return __rows;})()),[[pyAt(row,"name"),"rewound"]])),"tests/kernel/test_worldline.py:1047 assert [(entry[\"name\"], entry[\"how\"]) for entry in ledger[\"closed\"]] == [(row[\"name\"], \"rewound\")]");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_rewind_closes_what_the_rewound_circuit_owed,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_rewind_closes_what_the_rewound_circuit_owed"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_rewind_closes_what_the_rewound_circuit_owed(temporary);});
export async function test_a_confluence_closes_what_the_merged_lines_owed(kernel:any){
let row:any,turn:any,conflicts:any,ledger:any;
(await pyInvoke(two_lines_that_disagree,[kernel],{}));
row=(await pyInvoke(seed_owed,[kernel,pySubtract(pyAt((await pyInvoke(turn_json,[kernel],{})),"turn"),1)],{}));
turn=pyAt((await pyInvoke(turn_json,[kernel],{})),"turn");
(await pyMethod(kernel,"table",["player_input"],{"text":"把两条线并起来。"}));
conflicts=pyAt(pyAt((await pyInvoke(merge_err,[kernel,`t${turn}-c1`],{})),"details"),"conflicts");
(await pyMethod(kernel,"table",["apply"],{"call_id":`t${turn}-c2`,"effects":[({["kind"]:"merge",["name"]:"joined",["lines"]:["main","side"],["dispositions"]:({[pyAt(pyAt(conflicts,0),"id")]:({["mode"]:"from",["line"]:"side"})})})]}));
(await pyInvoke(narrate,[kernel,`t${turn}-c3`,"两条线合到了一起。"],{}));
ledger=(await pyInvoke(owed_ledger,[kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(ledger,"open"),[])),"tests/kernel/test_worldline.py:1063 assert ledger[\"open\"] == []");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(pyAt(ledger,"closed"))){__rows.push([pyAt(entry,"name"),pyAt(entry,"how")]);}return __rows;})()),[[pyAt(row,"name"),"merged"]])),"tests/kernel/test_worldline.py:1064 assert [(entry[\"name\"], entry[\"how\"]) for entry in ledger[\"closed\"]] == [(row[\"name\"], \"merged\")]");
}
Object.defineProperty(test_a_confluence_closes_what_the_merged_lines_owed,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_confluence_closes_what_the_merged_lines_owed"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_confluence_closes_what_the_merged_lines_owed(await kernel(t,{}));});
