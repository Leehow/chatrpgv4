// Migrated from tests/kernel/test_map_arrival.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {exactlyOne} from './world-native-support.ts';
import {kernel} from './support.ts';
import {confirmed_investigator,campaign_dir,write,bind,request,claim,finish,observed,opening,handle_of,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_map_arrival.py',import.meta.url).pathname;







export let IMAGE:any=(await pyMethod((pyDivide((await pyInvoke(Path,[__file__],{})).parent,"fixtures/bundle-tiny/assets/map-dock.png")),"read_bytes",[],{}));
export let REFS:any=[({["page"]:2})];
export async function scoped_dir(kernel:any,mid:any){
return pyDivide(pyDivide(pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"module-campaigns"),"c1"),"modules"),mid);
}
Object.defineProperty(scoped_dir,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"mid","rest":false,"varargs":false}]});
export async function queue(kernel:any,mid:any){
return (await pyMethod(json,"loads",[(await pyMethod((pyDivide((await pyInvoke(scoped_dir,[kernel,mid],{})),"deepen-queue.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
}
Object.defineProperty(queue,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"mid","rest":false,"varargs":false}]});
export async function module_meta(kernel:any,mid:any){
return (await pyMethod(json,"loads",[(await pyMethod((pyDivide((await pyInvoke(scoped_dir,[kernel,mid],{})),"module.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
}
Object.defineProperty(module_meta,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"mid","rest":false,"varargs":false}]});
export async function world(kernel:any){
return (await pyMethod(json,"loads",[(await pyMethod((pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"world.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
}
Object.defineProperty(world,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
export async function turn_file(kernel:any){
return (await pyMethod(json,"loads",[(await pyMethod((pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"turn.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
}
Object.defineProperty(turn_file,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
export async function map_jobs(kernel:any,mid:any){
return (await (async()=>{const __rows:any[]=[];for(const job of pyIterable((await pyInvoke(queue,[kernel,mid],{})))){if(pyBool(pyEqual((await pyMethod(job,"get",["material"],{})),"map"))){__rows.push(job);}}return __rows;})());
}
Object.defineProperty(map_jobs,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"mid","rest":false,"varargs":false}]});
/** §257.15: the table's current-scene exhibits read is claimed ahead of other reads; read it to nothing printed first. */
async function claimPastExhibits(kernel:any,mid:any):Promise<any>{
 for(;;){
  const job=await pyMethod(kernel,"ok",["module.read.claim",{module_id:mid,campaign:"c1",owner:"test-host"}],{});
  if(job?.material!=="exhibits")return job;
  await pyInvoke(observed,[job],{});
  await pyInvoke(write,[pyDivide(await pyInvoke(Path,[job.work_dir],{}),"draft.json"),{nodes:[],claims:[],exhibits:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:[]}],{});
  await pyInvoke(write,[pyDivide(await pyInvoke(Path,[job.work_dir],{}),"review.json"),{checked:[],missing:[]}],{});
  await pyInvoke(finish,[kernel,job],{campaign:"c1"});
 }
}
export async function c1_claim(kernel:any,mid:any){
return claimPastExhibits(kernel,mid);
}
Object.defineProperty(c1_claim,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"mid","rest":false,"varargs":false}]});
export async function book_at_the_dock(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,saved:any;

const __unpack1685=(await pyInvoke(bind,[kernel,tmp_path],{}));mid=__unpack1685[0];_=__unpack1685[1];
(await pyInvoke(request,[kernel,mid,"index"],{}));
job=(await pyInvoke(claim,[kernel,mid],{}));
(await pyInvoke(observed,[job],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),({["title"]:"The Harbor",["language"]:"en",["sections"]:[({["name"]:"The harbor and the tower",["pages"]:[[1,2]],["topics"]:["opening"],["entities"]:["Dock","Tower","Lena"],["references"]:[]})],["map_candidates"]:[({["name"]:"Tower plan",["focus"]:"Tower",["pages"]:[2]})]})],{}));
(await pyInvoke(finish,[kernel,job],{}));
const __unpack2161=(await pyInvoke(opening,[kernel,mid],{}));job=__unpack2161[0];_=__unpack2161[1];_=__unpack2161[2];
(await pyInvoke(finish,[kernel,job],{}));
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:"c1",["module"]:mid,["play_language"]:"en"})],{}));
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:"card-source",["module"]:"the-haunting",["play_language"]:"en"})],{}));
(await pyInvoke(confirmed_investigator,[kernel],{"campaign":"card-source"}));
(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:"card-source"})],{}));
saved=(await pyMethod(kernel,"ok",["investigator.save",({["campaign"]:"card-source"})],{}));
(await pyMethod(kernel,"ok",["investigator.load",({["campaign"]:"c1",["library_id"]:pyAt(saved,"library_id")})],{}));
(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:"c1"})],{}));
(await pyMethod(kernel,"table",["open"],{}));
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t0-c1","text":"The harbor waits."}));
(await pyMethod(kernel,"table",["player_input"],{"text":"I walk to the tower."}));
(await pyInvoke(request,[kernel,mid,"detail"],{"focus":"Tower","campaign":"c1"}));
job=(await pyInvoke(c1_claim,[kernel,mid],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(job,"purpose"),"detail");return pyBool(__left)?((await pyMethod(job,"get",["material"],{}))===null):__left})())),"tests/kernel/test_map_arrival.py:72 assert job[\"purpose\"] == \"detail\" and job.get(\"material\") is None");
(await pyInvoke(observed,[job],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),({["nodes"]:[({["node_id"]:"scene-tower",["node_kind"]:"scene",["name"]:"Tower",["source_refs"]:REFS,["summary"]:"An old tower beyond the harbor.",["properties"]:({["is_final"]:true})})],["claims"]:[],["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:[],["ready_nodes"]:["scene-tower"]})],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:[({["paths"]:["/nodes/0","/coverage"],["verdict"]:"supported",["source_refs"]:REFS})],["missing"]:[]})],{}));
(await pyInvoke(finish,[kernel,job],{"campaign":"c1"}));
return mid;
}
Object.defineProperty(book_at_the_dock,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
export async function publish_tower_map(kernel:any,mid:any,job:any){
let work:any,plate:any,draft:any,boxes:any;
(await pyInvoke(observed,[job],{}));
work=(await pyInvoke(Path,[pyAt(job,"work_dir")],{}));
plate=pyDivide(work,"tower-plate.png");
(await pyMethod(plate,"write_bytes",[IMAGE],{}));
draft=({["nodes"]:[({["node_id"]:"asset-tower-plate",["node_kind"]:"asset",["name"]:"Tower plate",["visibility"]:"player-safe",["source_refs"]:REFS,["properties"]:({["image_sources"]:[({["page"]:2})]})}),({["node_id"]:"handout-tower-plan",["node_kind"]:"handout",["name"]:"Tower plan",["visibility"]:"player-safe",["source_refs"]:REFS,["properties"]:({["map_scope"]:"interior",["map_regions"]:[({["region_id"]:"top-room",["name"]:"Top room",["source_asset"]:"asset-tower-plate",["source_box"]:[0,0,1,1],["placement"]:[0,0,1,1]})]})})],["claims"]:[({["subject_id"]:"handout-tower-plan",["predicate"]:"depicts",["object"]:({["node_id"]:"scene-tower"}),["truth_status"]:"authored-fact",["source_refs"]:REFS})],["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:[],["ready_nodes"]:["asset-tower-plate","handout-tower-plan"]});
boxes=(await (async()=>{const __rows:any[]=[];for(const box of pyIterable(["source_box","placement"])){for(const n of pyIterable((await pyInvoke(pyRange,[4],{})))){__rows.push(`/nodes/1/properties/map_regions/0/${box}/${n}`);}}return __rows;})());
(await pyInvoke(write,[pyDivide(work,"draft.json"),draft],{}));
(await pyInvoke(write,[pyDivide(work,"review.json"),({["checked"]:[({["paths"]:["/nodes/0","/nodes/1","/nodes/1/properties/map_scope",...boxes,"/claims/0","/coverage"],["verdict"]:"supported",["source_refs"]:REFS})],["missing"]:[]})],{}));
return (await pyInvoke(finish,[kernel,job],{"campaign":"c1","assets":[({["node_id"]:"asset-tower-plate",["path"]:(await pyInvoke(pyStr,[plate],{})),["sha256"]:(await pyMethod((await pyMethod(hashlib,"sha256",[IMAGE],{})),"hexdigest",[],{}))})]}));
}
Object.defineProperty(publish_tower_map,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"mid","rest":false,"varargs":false},{"name":"job","rest":false,"varargs":false}]});
export async function late_receipts(turn:any){
return (await (async()=>{const __rows:any[]=[];for(const receipt of pyIterable((await pyMethod(turn,"get",["receipts",[]],{})))){if(pyBool(pyEqual((await pyMethod(receipt,"get",["kind"],{})),"map"))){__rows.push(receipt);}}return __rows;})());
}
Object.defineProperty(late_receipts,"__pySignature",{value:[{"name":"turn","rest":false,"varargs":false}]});
export async function test_the_move_lands_and_the_map_published_later_arrives_on_the_next_turn_once(kernel:any,tmp_path:any){
let mid:any,moved:any,tower:any,job:any,second:any,third:any,plan:any,receipt:any,view:any,state:any,delivered:any,fourth:any,events:any;
mid=(await pyInvoke(book_at_the_dock,[kernel,tmp_path],{}));
moved=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"Tower"})]}));
tower=(await pyInvoke(handle_of,[kernel,"c1","Tower"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(moved,"world"),"active_scene"),tower)),pyStr("a map is never a door: the move lands with the scene's text"));
const __unpack6008=exactlyOne((await pyInvoke(map_jobs,[kernel,mid],{})));job=__unpack6008[0];
assert.ok(pyBool(pyEqual([pyAt(job,"state"),pyAt(job,"foreground"),pyAt(job,"focus"),pyAt(job,"pages")],["queued",false,"tower",[2]])),"tests/kernel/test_map_arrival.py:117 assert (job[\"state\"], job[\"foreground\"], job[\"focus\"], job[\"pages\"]) == (\"queued\", False, \"tower\", [2])");
assert.ok(pyBool(pyContains(pyAt(moved,"deepen_queued"),pyAt(job,"job_id"))),pyStr("the background map job rides the host's existing wake"));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world,[kernel],{})),"map_arrivals_pending"),[tower])),"tests/kernel/test_map_arrival.py:119 assert world(kernel)[\"map_arrivals_pending\"] == [tower]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyInvoke(late_receipts,[(await pyInvoke(turn_file,[kernel],{}))],{})),[]);return pyBool(__left)?!pyContains(moved,"map_views"):__left})())),"tests/kernel/test_map_arrival.py:120 assert late_receipts(turn_file(kernel)) == [] and \"map_views\" not in moved");
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c2","text":"The tower door stands open."}));
second=(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:"c1",["text"]:"I climb the stairs."})],{}));
assert.ok(pyBool((await (async()=>{const __left=!pyContains(second,"map_views");return pyBool(__left)?pyEqual((await pyInvoke(late_receipts,[(await pyInvoke(turn_file,[kernel],{}))],{})),[]):__left})())),pyStr("nothing is presented before publication"));
assert.ok(pyBool(!pyContains(pyAt(pyAt(second,"capsule"),"turn"),"map_arrived")),"tests/kernel/test_map_arrival.py:125 assert \"map_arrived\" not in second[\"capsule\"][\"turn\"]");
job=(await pyInvoke(c1_claim,[kernel,mid],{}));
assert.ok(pyBool(pyEqual((await pyMethod(job,"get",["material"],{})),"map")),"tests/kernel/test_map_arrival.py:128 assert job.get(\"material\") == \"map\"");
(await pyInvoke(publish_tower_map,[kernel,mid,job],{}));
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t2-c1","text":"The stairs creak."}));
third=(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:"c1",["text"]:"I look around the top room."})],{}));
plan=(await pyInvoke(handle_of,[kernel,"c1","Tower plan"],{}));
const __unpack7093=exactlyOne((await pyInvoke(late_receipts,[(await pyInvoke(turn_file,[kernel],{}))],{})));receipt=__unpack7093[0];
assert.ok(pyBool(pyEqual([pyAt(receipt,"map"),pyAt(receipt,"why"),pyAt(receipt,"late"),pyAt(receipt,"scene"),pyAt(receipt,"call_id")],[plan,"arrival",true,tower,"t3-input"])),"tests/kernel/test_map_arrival.py:135 assert (receipt[\"map\"], receipt[\"why\"], receipt[\"late\"], receipt[\"scene\"], receipt[\"call_id\"]) == (plan, \"arrival\", True, tower, \"t3-input\")");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(receipt,"regions"))){__rows.push(pyAt(region,"id"));}return __rows;})()),["top-room"])),"tests/kernel/test_map_arrival.py:136 assert [region[\"id\"] for region in receipt[\"regions\"]] == [\"top-room\"]");
const __unpack7362=exactlyOne(pyAt(third,"map_views"));view=__unpack7362[0];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(view,"receipt"),pyAt(receipt,"id"));return pyBool(__left)?pyEqual(pyAt(view,"map"),plan):__left})())),"tests/kernel/test_map_arrival.py:138 assert view[\"receipt\"] == receipt[\"id\"] and view[\"map\"] == plan");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(third,"capsule"),"turn"),"map_arrived"),[({["map"]:plan,["scene"]:tower,["receipt"]:pyAt(receipt,"id")})])),"tests/kernel/test_map_arrival.py:139 assert third[\"capsule\"][\"turn\"][\"map_arrived\"] == [{\"map\": plan, \"scene\": tower, \"receipt\": receipt[\"id\"]}]");
state=(await pyInvoke(world,[kernel],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(state,"maps_presented"),[plan]);return pyBool(__left)?pyEqual(pyAt(state,"map_arrivals_pending"),[]):__left})())),"tests/kernel/test_map_arrival.py:141 assert state[\"maps_presented\"] == [plan] and state[\"map_arrivals_pending\"] == []");
delivered=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t3-c1","text":"Wind moves through the top room."}));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(delivered,"mechanics"))){__rows.push((await (async()=>{const __left=pyEqual((await pyMethod(row,"get",["kind"],{})),"map");return pyBool(__left)?pyEqual((await pyMethod(row,"get",["map"],{})),plan):__left})()));}return __rows;})())))),"tests/kernel/test_map_arrival.py:143 assert any(row.get(\"kind\") == \"map\" and row.get(\"map\") == plan for row in delivered[\"mechanics\"])");
fourth=(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:"c1",["text"]:"I wait."})],{}));
assert.ok(pyBool((await (async()=>{const __left=!pyContains(fourth,"map_views");return pyBool(__left)?pyEqual((await pyInvoke(late_receipts,[(await pyInvoke(turn_file,[kernel],{}))],{})),[]):__left})())),pyStr("the late card is minted once"));
events=(await (async()=>{const __rows:any[]=[];for(const line of pyIterable((await pyMethod((await pyMethod((pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"events.jsonl")),"read_text",[],{"encoding":"utf-8"})),"splitlines",[],{})))){if(pyBool((await pyMethod(line,"strip",[],{})))){__rows.push((await pyMethod(json,"loads",[line],{})));}}return __rows;})());
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const event of pyIterable(events)){if(pyBool(pyEqual(pyAt(event,"type"),"map-revealed"))){__rows.push(pyAt(event,"turn"));}}return __rows;})()),[3])),"tests/kernel/test_map_arrival.py:148 assert [event[\"turn\"] for event in events if event[\"type\"] == \"map-revealed\"] == [3]");
}
Object.defineProperty(test_the_move_lands_and_the_map_published_later_arrives_on_the_next_turn_once,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_move_lands_and_the_map_published_later_arrives_on_the_next_turn_once"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_move_lands_and_the_map_published_later_arrives_on_the_next_turn_once(await kernel(t,{}),temporary);});
export async function test_a_refused_map_review_settles_the_focus_and_the_next_arrival_reads_nothing(kernel:any,tmp_path:any){
let mid:any,job:any,refusal:any,settled:any,again:any,answered:any,retried:any;
mid=(await pyInvoke(book_at_the_dock,[kernel,tmp_path],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"Tower"})]}));
job=(await pyInvoke(c1_claim,[kernel,mid],{}));
assert.ok(pyBool(pyEqual((await pyMethod(job,"get",["material"],{})),"map")),"tests/kernel/test_map_arrival.py:155 assert job.get(\"material\") == \"map\"");
refusal=({["message"]:"visual review did not support ['/nodes/1/properties/map_regions/0/source_box/0']",["rule"]:"review"});
(await pyMethod(kernel,"ok",["module.read.finish",({["module_id"]:mid,["campaign"]:"c1",["job_id"]:pyAt(job,"job_id"),["lease"]:pyAt(job,"lease"),["outcome"]:"failed",["detail"]:"invalid_params: visual review refused",["refusal"]:refusal})],{}));
const __unpack8979=exactlyOne((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt((await pyInvoke(module_meta,[kernel,mid],{})),"reading"),"materials"))){if(pyBool(pyEqual((await pyMethod(row,"get",["material"],{})),"map"))){__rows.push(row);}}return __rows;})()));settled=__unpack8979[0];
assert.ok(pyBool(pyEqual([pyAt(settled,"status"),pyAt(settled,"focus"),pyAt(settled,"reason"),pyAt(settled,"node_ids")],["unusable","tower",pyAt(refusal,"message"),[]])),"tests/kernel/test_map_arrival.py:160 assert (settled[\"status\"], settled[\"focus\"], settled[\"reason\"], settled[\"node_ids\"]) == (\"unusable\", \"tower\", refusal[\"message\"], [])");
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c2","text":"The tower door stands open."}));
(await pyMethod(kernel,"ok",["table.player_input",({["campaign"]:"c1",["text"]:"I go back to the dock, then return."})],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world,[kernel],{})),"map_arrivals_pending"),[])),pyStr("a settled focus drops its pending arrival"));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"move",["to"]:"Dock"})]}));
again=(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c2","effects":[({["kind"]:"move",["to"]:"Tower"})]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(again,"world"),"active_scene"),(await pyInvoke(handle_of,[kernel,"c1","Tower"],{})))),"tests/kernel/test_map_arrival.py:167 assert again[\"world\"][\"active_scene\"] == handle_of(kernel, \"c1\", \"Tower\")");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const job of pyIterable((await pyInvoke(map_jobs,[kernel,mid],{})))){__rows.push(pyAt(job,"job_id"));}return __rows;})()),[pyAt(job,"job_id")])),pyStr("the settled focus is not read again"));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const queued of pyIterable(pyAt(again,"deepen_queued"))){__rows.push(pyContains((await (async()=>{const __rows:any[]=[];for(const j of pyIterable((await pyInvoke(map_jobs,[kernel,mid],{})))){__rows.push(pyAt(j,"job_id"));}return __rows;})()),queued));}return __rows;})()))))),"tests/kernel/test_map_arrival.py:169 assert not any(queued in [j[\"job_id\"] for j in map_jobs(kernel, mid)] for queued in again[\"deepen_queued\"])");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world,[kernel],{})),"map_arrivals_pending"),[])),"tests/kernel/test_map_arrival.py:170 assert world(kernel)[\"map_arrivals_pending\"] == []");
answered=(await pyInvoke(request,[kernel,mid,"detail"],{"material":"map","focus":"tower","question":pyAt(job,"question"),"campaign":"c1"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(answered,"state"),"unusable");return pyBool(__left)?pyEqual(pyAt(answered,"reason"),pyAt(refusal,"message")):__left})())),"tests/kernel/test_map_arrival.py:172 assert answered[\"state\"] == \"unusable\" and answered[\"reason\"] == refusal[\"message\"]");
retried=(await pyInvoke(request,[kernel,mid,"detail"],{"material":"map","focus":"tower","question":pyAt(job,"question"),"campaign":"c1","retry":true}));
assert.ok(pyBool(pyEqual(pyAt(retried,"state"),"queued")),"tests/kernel/test_map_arrival.py:175 assert retried[\"state\"] == \"queued\"");
assert.ok(pyBool(!pyBool((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt((await pyInvoke(module_meta,[kernel,mid],{})),"reading"),"materials"))){if(pyBool(pyEqual((await pyMethod(row,"get",["material"],{})),"map"))){__rows.push(row);}}return __rows;})()))),"tests/kernel/test_map_arrival.py:176 assert not [row for row in module_meta(kernel, mid)[\"reading\"][\"materials\"] if row.get(\"material\") == \"map\"]");
}
Object.defineProperty(test_a_refused_map_review_settles_the_focus_and_the_next_arrival_reads_nothing,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_refused_map_review_settles_the_focus_and_the_next_arrival_reads_nothing"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_refused_map_review_settles_the_focus_and_the_next_arrival_reads_nothing(await kernel(t,{}),temporary);});
