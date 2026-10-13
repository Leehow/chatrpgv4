// Migrated from tests/kernel/test_memory_laws.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {narrate,CAMPAIGN,PREGEN,campaign_dir,open_turn,read_json,read_jsonl,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";





export let CALL_ID_SHAPE:any=(await pyMethod(re,"compile",["^t\\d+-c\\d+$"],{}));


export let HEX_RUN:any=(await pyMethod(re,"compile",["(?<![0-9a-fA-F])[0-9a-fA-F]{7,}(?![0-9a-fA-F])"],{}));
export let RECEIPT_PREFIXES:any=["roll:","delta:","move:"];
export async function job(client:any,params:any={}){
return (await pyMethod(client,"ok",["memory.job",({["campaign"]:CAMPAIGN,...params})],{}));
}
export async function job_err(client:any,params:any={}){
return (await pyMethod(client,"err",["memory.job",({["campaign"]:CAMPAIGN,...params})],{}));
}
export async function submit(client:any,params:any={}){
return (await pyMethod(client,"ok",["memory.submit",({["campaign"]:CAMPAIGN,...params})],{}));
}
export async function submit_err(client:any,params:any={}){
return (await pyMethod(client,"err",["memory.submit",({["campaign"]:CAMPAIGN,...params})],{}));
}
export async function fail(client:any,params:any={}){
return (await pyMethod(client,"ok",["memory.fail",({["campaign"]:CAMPAIGN,...params})],{}));
}
export async function known_entity(job_result:any,kind:any){
return (await pyNext((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(job_result,"known_entities"))){if(pyBool(pyEqual(pyAt(e,"kind"),kind)))__rows.push(pyAt(e,"name"));}return __rows;})())));
}
export async function memory_hits(client:any,params:any={}){
return pyAt((await pyMethod(client,"table",["recall"],{"what":"memory",...params})),"hits");
}
export async function _walk(node:any,path:any="$"){
const __yielded:any[]=[];
let k:any,v:any,i:any;

if(pyBool((await pyIsInstance(node,pyDict)))){for([k,v] of pyIterable((await pyMethod(node,"items",[],{})))){
__yielded.push([`${path}.${k}`,k,null]);
__yielded.push(...(await _walk(v,`${path}.${k}`)));
}}else if(pyBool((await pyIsInstance(node,pyList)))){for([i,v] of pyIterable((await pyEnumerate(node)))){
__yielded.push(...(await _walk(v,`${path}[${i}]`)));
}}else if(pyBool((await pyIsInstance(node,pyStr)))){__yielded.push([path,null,node]);}
return __yielded;
}
export async function test_candidates_never_leave_candidate_or_superseded(kernel:any){
let j1:any,subject:any,j2:any;
(await open_turn(kernel,"我问诺特关于报社过去的事。"));
(await narrate(kernel,"t1-c1","诺特提到报社十年前也报道过一起失踪案。"));
j1=(await job(kernel,({"turn":1})));
subject=(await known_entity(j1,"investigator"));
(await submit(kernel,({"job_id":pyAt(j1,"job_id"),"candidates":[({["kind"]:"knowledge",["subject"]:subject,["statement"]:"诺特提到报社十年前的一起失踪案。"})]})));
async function statuses(){
return new Set((await (async()=>{const __rows:any[]=[];for(const h of pyIterable((await memory_hits(kernel,({"include_superseded":true}))))){if(pyBool(true))__rows.push(pyAt(h,"status"));}return __rows;})()));
}
assert.ok(pyBool((await (async()=>{const __left=(await statuses());return pyBool(__left)?pyLessEqual((await statuses()),new Set(["candidate","superseded"])):__left})())),"tests/kernel/test_memory_laws.py:76 assert statuses() and statuses() <= {\"candidate\", \"superseded\"}");
(await pyMethod(kernel,"table",["player_input"],{"text":"我继续追问细节。"}));
(await narrate(kernel,"t2-c1","诺特叹了口气，说案子最后不了了之。"));
j2=(await job(kernel,({"turn":2})));
(await submit(kernel,({"job_id":pyAt(j2,"job_id"),"candidates":[({["kind"]:"belief",["subject"]:subject,["statement"]:"诺特似乎不太想谈这件旧案。"})]})));
assert.ok(pyBool(pyLessEqual((await statuses()),new Set(["candidate","superseded"]))),"tests/kernel/test_memory_laws.py:85 assert statuses() <= {\"candidate\", \"superseded\"}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_candidates_never_leave_candidate_or_superseded"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_candidates_never_leave_candidate_or_superseded(await kernel(t,{}));});
export async function test_superseding_relationship_keeps_both_records_addressable(kernel:any){
let j1:any,investigator:any,npc:any,first_hits:any,first:any,j2:any,all_hits:any,by_id:any,newer:any,default_ids:any;
(await open_turn(kernel,"我打量诺特和这间办公室。"));
(await narrate(kernel,"t1-c1","诺特与你隔着桌子对视。"));
j1=(await job(kernel,({"turn":1})));
investigator=(await known_entity(j1,"investigator"));
npc=(await known_entity(j1,"npc"));
(await submit(kernel,({"job_id":pyAt(j1,"job_id"),"candidates":[({["kind"]:"relationship",["subject"]:investigator,["entities"]:[npc],["statement"]:`${investigator}对${npc}保持警惕。`})]})));
first_hits=(await memory_hits(kernel,({"about":[investigator,npc],"include_superseded":true})));
first=(await pyNext((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(first_hits)){if(pyBool(pyEqual(pyAt(h,"kind"),"relationship")))__rows.push(h);}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(first,"status"),"candidate")),"tests/kernel/test_memory_laws.py:100 assert first[\"status\"] == \"candidate\"");
(await pyMethod(kernel,"table",["player_input"],{"text":"我们继续交谈了一阵。"}));
(await narrate(kernel,"t2-c1","诺特的态度渐渐放松了下来。"));
j2=(await job(kernel,({"turn":2})));
(await submit(kernel,({"job_id":pyAt(j2,"job_id"),"candidates":[({["kind"]:"relationship",["subject"]:investigator,["entities"]:[npc],["statement"]:`${investigator}对${npc}的警惕消退了。`})]})));
all_hits=(await memory_hits(kernel,({"about":[investigator,npc],"include_superseded":true})));
by_id=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(all_hits)){if(pyBool(true))__rows.push([pyAt(h,"id"),h]);}return __rows;})()));
assert.ok(pyBool(pyContains(by_id,pyAt(first,"id"))),pyStr("the superseded record must stay addressable by id"));
assert.ok(pyBool(pyEqual(pyAt(pyAt(by_id,pyAt(first,"id")),"status"),"superseded")),"tests/kernel/test_memory_laws.py:113 assert by_id[first[\"id\"]][\"status\"] == \"superseded\"");
newer=(await pyNext((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(all_hits)){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(h,"kind"),"relationship");return pyBool(__left)?!pyEqual(pyAt(h,"id"),pyAt(first,"id")):__left})())))__rows.push(h);}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(newer,"status"),"candidate")),"tests/kernel/test_memory_laws.py:115 assert newer[\"status\"] == \"candidate\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(by_id,pyAt(first,"id")),"superseded_by"),pyAt(newer,"id"))),"tests/kernel/test_memory_laws.py:116 assert by_id[first[\"id\"]][\"superseded_by\"] == newer[\"id\"]");
default_ids=new Set((await (async()=>{const __rows:any[]=[];for(const h of pyIterable((await memory_hits(kernel,({"about":[investigator,npc]}))))){if(pyBool(true))__rows.push(pyAt(h,"id"));}return __rows;})()));
assert.ok(pyBool(pyContains(default_ids,pyAt(newer,"id"))),"tests/kernel/test_memory_laws.py:120 assert newer[\"id\"] in default_ids");
assert.ok(pyBool(!pyContains(default_ids,pyAt(first,"id"))),"tests/kernel/test_memory_laws.py:121 assert first[\"id\"] not in default_ids");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_superseding_relationship_keeps_both_records_addressable"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_superseding_relationship_keeps_both_records_addressable(await kernel(t,{}));});
export async function test_failed_job_is_not_redispatched_by_a_bare_memory_job(kernel:any){
let j1:any,backlog:any,bare:any,result:any,redispatched:any;
(await open_turn(kernel,"我环视四周。"));
(await narrate(kernel,"t1-c1","灰尘在光线里飘着。"));
j1=(await job(kernel,({"turn":1})));
(await fail(kernel,({"job_id":pyAt(j1,"job_id"),"reason":"model_error","detail":"抽取子会话超时"})));
backlog=(await read_jsonl(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"memory"),"backlog.jsonl")));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(backlog)){if(pyBool(true))__rows.push((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(row,"job_id"),pyAt(j1,"job_id"));return pyBool(__left)?pyEqual(pyAt(row,"reason"),"model_error"):__left})());return pyBool(__left)?pyEqual(pyAt(row,"status"),"pending"):__left})()));}return __rows;})())))),"tests/kernel/test_memory_laws.py:131 assert any(row[\"job_id\"] == j1[\"job_id\"] and row[\"reason\"] == \"model_error\" and row[\"status\"] == \"pending\"\n               for row in backlog)");
bare=(await job(kernel));
assert.ok(pyBool(!pyEqual(pyAt(bare,"job_id"),pyAt(j1,"job_id"))),"tests/kernel/test_memory_laws.py:136 assert bare[\"job_id\"] != j1[\"job_id\"]");
(await pyMethod(kernel,"table",["player_input"],{"text":"我继续搜查。"}));
result=(await narrate(kernel,"t2-c1","没有发现异常。"));
assert.ok(pyBool(pyAt(result,"commit")),"tests/kernel/test_memory_laws.py:141 assert result[\"commit\"]");
redispatched=(await job(kernel,({"turn":1})));
assert.ok(pyBool(pyEqual(pyAt(redispatched,"job_id"),pyAt(j1,"job_id"))),"tests/kernel/test_memory_laws.py:145 assert redispatched[\"job_id\"] == j1[\"job_id\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_failed_job_is_not_redispatched_by_a_bare_memory_job"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_failed_job_is_not_redispatched_by_a_bare_memory_job(await kernel(t,{}));});
export async function test_player_assertion_never_becomes_a_committed_fact_or_world_state(kernel:any){
let j1:any,investigator:any,narrated:any,committed_blob:any,world_blob:any;
(await open_turn(kernel,"我告诉诺特我曾经在《纪事报》工作过。"));
(await narrate(kernel,"t1-c1","诺特挑了挑眉，不置可否。"));
j1=(await job(kernel,({"turn":1})));
investigator=(await known_entity(j1,"investigator"));
(await submit(kernel,({"job_id":pyAt(j1,"job_id"),"candidates":[({["kind"]:"player_assertion",["subject"]:investigator,["statement"]:`${investigator}自称曾在《纪事报》工作过。`})]})));
(await pyMethod(kernel,"table",["player_input"],{"text":"我再次强调这一点。"}));
narrated=(await narrate(kernel,"t2-c1","诺特点了点头，仍不置可否。"));
committed_blob=(await pyMethod(json,"dumps",[(await pyMethod((await pyMethod(narrated,"get",["facts",({})],{})),"get",["committed",[]],{}))],{"ensure_ascii":false}));
assert.ok(pyBool(!pyContains(committed_blob,"纪事报")),"tests/kernel/test_memory_laws.py:161 assert \"纪事报\" not in committed_blob");
world_blob=(await pyMethod(json,"dumps",[(await read_json(pyDivide((await campaign_dir(kernel.workspace)),"world.json")))],{"ensure_ascii":false}));
assert.ok(pyBool(!pyContains(world_blob,"纪事报")),"tests/kernel/test_memory_laws.py:164 assert \"纪事报\" not in world_blob");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_player_assertion_never_becomes_a_committed_fact_or_world_state"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_player_assertion_never_becomes_a_committed_fact_or_world_state(await kernel(t,{}));});
export async function test_ambiguous_name_between_two_present_entities_is_rejected(kernel:any){
let j1:any,npc_name:any,sheet_path:any,sheet:any,j2:any,error:any;
(await open_turn(kernel,"我和诺特交谈。"));
(await narrate(kernel,"t1-c1","诺特靠在椅背上。"));
j1=(await job(kernel,({"turn":1})));
npc_name=(await known_entity(j1,"npc"));
sheet_path=pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"party"),`${PREGEN}.json`);
sheet=(await read_json(sheet_path));
sheet["name"]=npc_name;
(await pyMethod(sheet_path,"write_text",[(await pyMethod(json,"dumps",[sheet],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我继续说下去。"}));
(await narrate(kernel,"t2-c1","诺特没有回应。"));
j2=(await job(kernel,({"turn":2})));
error=(await submit_err(kernel,({"job_id":pyAt(j2,"job_id"),"candidates":[({["kind"]:"knowledge",["subject"]:npc_name,["statement"]:"有些事发生了变化。"})]})));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_memory_laws.py:187 assert error[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"index"),0)),"tests/kernel/test_memory_laws.py:188 assert error[\"details\"][\"index\"] == 0");
assert.ok(pyBool(pyAt(error,"fix")),"tests/kernel/test_memory_laws.py:189 assert error[\"fix\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_ambiguous_name_between_two_present_entities_is_rejected"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_ambiguous_name_between_two_present_entities_is_rejected(await kernel(t,{}));});
export async function test_submit_with_a_machine_key_is_rejected_with_details_index(kernel:any){
let j1:any,investigator:any,single:any,batch:any;
(await open_turn(kernel,"我环视四周。"));
(await narrate(kernel,"t1-c1","房间里很安静。"));
j1=(await job(kernel,({"turn":1})));
investigator=(await known_entity(j1,"investigator"));
single=(await submit_err(kernel,({"job_id":pyAt(j1,"job_id"),"candidates":[({["kind"]:"knowledge",["subject"]:investigator,["statement"]:"一切如常。",["commit"]:"deadbeefc0"})]})));
assert.ok(pyBool(pyEqual(pyAt(single,"code"),"invalid_params")),"tests/kernel/test_memory_laws.py:201 assert single[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(single,"details"),"index"),0)),"tests/kernel/test_memory_laws.py:202 assert single[\"details\"][\"index\"] == 0");
batch=(await submit_err(kernel,({"job_id":pyAt(j1,"job_id"),"candidates":[({["kind"]:"knowledge",["subject"]:investigator,["statement"]:"第一条本身没问题。"}),({["kind"]:"belief",["subject"]:investigator,["statement"]:"第二条",["call_id"]:"t1-c1"})]})));
assert.ok(pyBool(pyEqual(pyAt(batch,"code"),"invalid_params")),"tests/kernel/test_memory_laws.py:209 assert batch[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(batch,"details"),"index"),1)),"tests/kernel/test_memory_laws.py:210 assert batch[\"details\"][\"index\"] == 1");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const h of pyIterable((await memory_hits(kernel,({"about":[investigator]}))))){if(pyBool(true))__rows.push(pyContains(pyAt(h,"statement"),"第一条本身没问题"));}return __rows;})()))))),"tests/kernel/test_memory_laws.py:211 assert not any(\"第一条本身没问题\" in h[\"statement\"] for h in memory_hits(kernel, about=[investigator]))");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_submit_with_a_machine_key_is_rejected_with_details_index"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_submit_with_a_machine_key_is_rejected_with_details_index(await kernel(t,{}));});
export async function test_memory_job_packet_carries_no_machine_keys_except_top_level_turn_and_commit(kernel:any){
let narrated:any,j1:any,payload:any,offenders:any,path:any,key:any,value:any;
(await open_turn(kernel,"我仔细检查桌上的文件。"));
(await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c1","action":({["intent"]:"investigate",["goal"]:"看文件",["method"]:"用侦查扫一眼",["skill"]:"Spot Hidden"})}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"clue",["clue"]:"knott-research-leads"}),({["kind"]:"time",["minutes"]:5})]}));
narrated=(await narrate(kernel,"t1-c3","你翻阅着桌上的文件。"));
j1=(await job(kernel,({"turn":1})));
assert.ok(pyBool(pyEqual(pyAt(j1,"turn"),1)),"tests/kernel/test_memory_laws.py:225 assert j1[\"turn\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(j1,"commit"),pyAt(narrated,"commit"))),"tests/kernel/test_memory_laws.py:226 assert j1[\"commit\"] == narrated[\"commit\"]");
payload=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [k,v] of pyIterable((await pyMethod(j1,"items",[],{})))){if(pyBool(!pyContains(["turn","commit"],k)))__rows.push([k,v]);}return __rows;})()));
offenders=[];
for([path,key,value] of pyIterable((await _walk(payload)))){
if(pyBool(pyEqual(key,"call_id"))){(await pyMethod(offenders,"append",[[path,"call_id key"]],{}));}
if(pyBool((value!==null))){if(pyBool((await pyMethod(HEX_RUN,"search",[value],{})))){(await pyMethod(offenders,"append",[[path,`hex-like run: ${value}`]],{}));}
if(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const prefix of pyIterable(RECEIPT_PREFIXES)){if(pyBool(true))__rows.push((await pyMethod(value,"startswith",[prefix],{})));}return __rows;})()))))){(await pyMethod(offenders,"append",[[path,`receipt-shaped value: ${value}`]],{}));}
if(pyBool((await pyMethod(CALL_ID_SHAPE,"match",[value],{})))){(await pyMethod(offenders,"append",[[path,`call_id-shaped value: ${value}`]],{}));}}
}
assert.ok(pyBool(pyEqual(offenders,[])),"tests/kernel/test_memory_laws.py:240 assert offenders == []");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_memory_job_packet_carries_no_machine_keys_except_top_level_turn_and_commit"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_memory_job_packet_carries_no_machine_keys_except_top_level_turn_and_commit(await kernel(t,{}));});
