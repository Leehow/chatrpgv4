// Migrated from tests/kernel/test_ontology_runtime.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {narrate,CAMPAIGN,CONTENT_DIR,RpcClient,campaign_dir,create_campaign,open_turn,read_jsonl,resolve,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_ontology_runtime.py',import.meta.url).pathname;






export let INVESTIGATOR:any="托马斯·海斯";
export async function content_variant(tmp_path:any,drop:any=null,rewrite:any=null){
let root:any,child:any,target:any,grandchild:any,rel:any;

root=pyDivide(tmp_path,"content");
(await pyMethod(root,"mkdir",[],{}));
for(child of pyIterable((await pyMethod(CONTENT_DIR,"iterdir",[],{})))){
target=pyDivide(root,child.name);
if(pyBool((await pyMethod(child,"is_dir",[],{})))){(await pyMethod(target,"mkdir",[],{}));
for(grandchild of pyIterable((await pyMethod(child,"iterdir",[],{})))){
rel=`${child.name}/${grandchild.name}`;
if(pyBool(pyEqual(rel,drop))){continue;}
if(pyBool((await (async()=>{const __left=rewrite;return pyBool(__left)?pyContains(rewrite,rel):__left})()))){(await pyMethod((pyDivide(target,grandchild.name)),"write_text",[pyAt(rewrite,rel)],{"encoding":"utf-8"}));}else{(await pyMethod(os,"symlink",[grandchild,pyDivide(target,grandchild.name)],{}));}
}}else{(await pyMethod(os,"symlink",[child,target],{}));}
}
return root;
}
Object.defineProperty(content_variant,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false},{"name":"drop","rest":false,"varargs":false},{"name":"rewrite","rest":false,"varargs":false}]});

export async function test_a_bad_ontology_reference_stops_the_table_from_opening_but_not_hello(tmp_path:any){
let ontology:any,content:any,client:any,error:any,bad:any,reasons:any;
ontology=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(CONTENT_DIR,"ontology"),"system-ontology.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
(await pyMethod(pyAt(ontology,"references"),"append",[({["ref_id"]:"ref:rule:coc7:decision-coc7-magic-summon-shoggoth",["graph_id"]:"graph:rule:coc7",["semantic_id"]:"decision:coc7:magic:summon-shoggoth",["reference_kind"]:"artifact-node",["node_kind"]:"decision"})],{}));
(await pyMethod(pyAt(ontology,"relations"),"append",[({["relation_id"]:"relation:system:dangling",["relation_kind"]:"grounded-by",["from_ref"]:"ref:director:investigate-intent",["to_ref"]:"ref:nowhere"})],{}));
content=(await pyInvoke(content_variant,[tmp_path],{"rewrite":({["ontology/system-ontology.json"]:(await pyMethod(json,"dumps",[ontology],{"ensure_ascii":false}))})}));
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":content})));
try{assert.ok(pyBool(pyContains(pyAt(pyAt((await pyMethod(client,"ok",["kernel.hello"],{})),"content"),"modules"),"the-haunting")),"tests/kernel/test_ontology_runtime.py:48 assert \"the-haunting\" in client.ok(\"kernel.hello\")[\"content\"][\"modules\"]");
(await pyInvoke(create_campaign,[client],{}));
error=(await pyMethod(client,"table_err",["open"],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"campaign_not_ready")),"tests/kernel/test_ontology_runtime.py:51 assert error[\"code\"] == \"campaign_not_ready\"");
bad=pyAt(pyAt(error,"details"),"ontology");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(bad)){__rows.push((await pyMethod(row,"get",["ref_id"],{})));}return __rows;})())),new Set(["ref:rule:coc7:decision-coc7-magic-summon-shoggoth","ref:nowhere"]))),"tests/kernel/test_ontology_runtime.py:53 assert {row.get(\"ref_id\") for row in bad} == {\"ref:rule:coc7:decision-coc7-magic-summon-shoggoth\", \"ref:nowhere\"}");
reasons=(await pyMethod(" ","join",[(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(bad)){__rows.push(pyAt(row,"reason"));}return __rows;})())],{}));
assert.ok(pyBool((await (async()=>{const __left=pyContains(reasons,"rule graph");return pyBool(__left)?pyContains(reasons,"relation end"):__left})())),"tests/kernel/test_ontology_runtime.py:55 assert \"rule graph\" in reasons and \"relation end\" in reasons");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_bad_ontology_reference_stops_the_table_from_opening_but_not_hello,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_bad_ontology_reference_stops_the_table_from_opening_but_not_hello"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_bad_ontology_reference_stops_the_table_from_opening_but_not_hello(temporary);});
export async function test_the_shipped_ontology_validates_and_the_table_opens(kernel:any){
let opened:any;
(await pyInvoke(create_campaign,[kernel],{}));
opened=(await pyMethod(kernel,"table",["open"],{}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(opened,"opening_needed")===true);return pyBool(__left)?pyEqual(pyAt(pyAt(opened,"campaign"),"register"),"purist"):__left})())),"tests/kernel/test_ontology_runtime.py:63 assert opened[\"opening_needed\"] is True and opened[\"campaign\"][\"register\"] == \"purist\"");
}
Object.defineProperty(test_the_shipped_ontology_validates_and_the_table_opens,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_shipped_ontology_validates_and_the_table_opens"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_shipped_ontology_validates_and_the_table_opens(await kernel(t,{}));});
export async function test_a_missing_director_graph_fails_closed(tmp_path:any){
let content:any,client:any,error:any;
content=(await pyInvoke(content_variant,[tmp_path],{"drop":"director/director-graph.json"}));
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":content})));
try{assert.ok(pyBool(pyAt((await pyMethod(client,"ok",["kernel.hello"],{})),"kernel_version")),"tests/kernel/test_ontology_runtime.py:70 assert client.ok(\"kernel.hello\")[\"kernel_version\"]");
error=(await pyMethod(client,"err",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["pregen"]:"thomas-hayes"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"campaign_not_ready");return pyBool(__left)?pyContains(pyAt(pyAt(pyAt(error,"details"),"director"),"reason"),"unreadable"):__left})())),"tests/kernel/test_ontology_runtime.py:72 assert error[\"code\"] == \"campaign_not_ready\" and \"unreadable\" in error[\"details\"][\"director\"][\"reason\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_missing_director_graph_fails_closed,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_missing_director_graph_fails_closed"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_missing_director_graph_fails_closed(temporary);});
export async function test_a_director_graph_whose_digest_disagrees_with_the_manifest_fails_closed(tmp_path:any){
let graph:any,node:any,content:any,client:any,error:any;
graph=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(CONTENT_DIR,"director"),"director-graph.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
for(node of pyIterable(pyAt(graph,"nodes"))){
if(pyBool(pyEqual(pyAt(node,"node_id"),"scoring-rule:reveal:investigate-intent"))){pyAt(node,"properties")["value"]=0.1;}
}
content=(await pyInvoke(content_variant,[tmp_path],{"rewrite":({["director/director-graph.json"]:(await pyMethod(json,"dumps",[graph],{"ensure_ascii":false}))})}));
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":content})));
try{error=(await pyMethod(client,"err",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["pregen"]:"thomas-hayes"})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"campaign_not_ready")),"tests/kernel/test_ontology_runtime.py:86 assert error[\"code\"] == \"campaign_not_ready\"");
assert.ok(pyBool(pyContains(pyAt(pyAt(pyAt(error,"details"),"director"),"reason"),"digest")),"tests/kernel/test_ontology_runtime.py:87 assert \"digest\" in error[\"details\"][\"director\"][\"reason\"]");
assert.ok(pyBool(!pyEqual(pyAt(pyAt(pyAt(error,"details"),"director"),"declared"),pyAt(pyAt(pyAt(error,"details"),"director"),"actual"))),"tests/kernel/test_ontology_runtime.py:88 assert error[\"details\"][\"director\"][\"declared\"] != error[\"details\"][\"director\"][\"actual\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_director_graph_whose_digest_disagrees_with_the_manifest_fails_closed,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_director_graph_whose_digest_disagrees_with_the_manifest_fails_closed"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_director_graph_whose_digest_disagrees_with_the_manifest_fails_closed(temporary);});
export async function test_grounded_by_comes_only_from_the_registry(seeded_kernel:any){
let kernel:any,ontology:any,refs:any,allowed:any,rel:any,semantic:any,director:any;
kernel=seeded_kernel;
ontology=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(CONTENT_DIR,"ontology"),"system-ontology.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
refs=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(ontology,"references"))){__rows.push([pyAt(r,"ref_id"),r]);}return __rows;})()));
allowed=(await pyInvoke(pySet,[],{}));
for(rel of pyIterable(pyAt(ontology,"relations"))){
if(pyBool(pyContains(["grounded-by","may-emit-effect"],pyAt(rel,"relation_kind")))){semantic=pyAt(pyAt(refs,pyAt(rel,"to_ref")),"semantic_id");
(await pyMethod(allowed,"add",[semantic],{}));
(await pyMethod(allowed,"add",[(await pyMethod(":","join",[pySlice((await pyMethod(semantic,"split",[":"],{})),2,undefined)],{}))],{}));}
}
(await pyInvoke(open_turn,[kernel,"我仔细观察诺特。"],{}));
(await pyInvoke(resolve,[kernel,"t1-c1"],{"intent":"investigate","goal":"看他","method":"用侦查","skill":"Spot Hidden"}));
(await pyInvoke(narrate,[kernel,"t1-c2","……"],{}));
director=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"继续。"})),"capsule"),"director");
assert.ok(pyBool((await (async()=>{const __left=pyAt(director,"grounded_by");return pyBool(__left)?pyLessEqual((await pyInvoke(pySet,[pyAt(director,"grounded_by")],{})),allowed):__left})())),"tests/kernel/test_ontology_runtime.py:107 assert director[\"grounded_by\"] and set(director[\"grounded_by\"]) <= allowed");
}
Object.defineProperty(test_grounded_by_comes_only_from_the_registry,"__pySignature",{value:[{"name":"seeded_kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_grounded_by_comes_only_from_the_registry"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_grounded_by_comes_only_from_the_registry(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});

export async function social_read(client:any,call_id:any,extra:any={}){

return (await pyMethod(client,"table_err",["resolve"],{"call_id":call_id,"action":({["intent"]:"social",["goal"]:"他在隐瞒什么",["method"]:"用心理学读他",["target"]:"Steven Knott",...extra})}));
}
Object.defineProperty(social_read,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"call_id","rest":false,"varargs":false},{"name":"extra","rest":true,"varargs":false}]});
export async function test_one_grounded_candidate_settles_with_decision_source_director(seeded_kernel:any){
let kernel:any,director:any,result:any;
kernel=seeded_kernel;
(await pyInvoke(open_turn,[kernel,"我仔细观察诺特。"],{}));
(await pyInvoke(resolve,[kernel,"t1-c1"],{"intent":"investigate","goal":"看他","method":"用侦查","skill":"Spot Hidden"}));
(await pyInvoke(narrate,[kernel,"t1-c2","……"],{}));
director=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我读他的表情。"})),"capsule"),"director");
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"REVEAL")),"tests/kernel/test_ontology_runtime.py:125 assert director[\"beat\"] == \"REVEAL\"");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(director,"grounded_by"),"psychology:observe-concealed");return pyBool(__left)?!pyContains(pyAt(director,"grounded_by"),"social:adjudicate-difficulty"):__left})())),"tests/kernel/test_ontology_runtime.py:126 assert \"psychology:observe-concealed\" in director[\"grounded_by\"] and \"social:adjudicate-difficulty\" not in director[\"grounded_by\"]");
result=(await pyMethod(kernel,"table",["resolve"],{"call_id":"t2-c1","action":({["intent"]:"social",["goal"]:"他在隐瞒什么",["method"]:"用心理学读他",["target"]:"Steven Knott"})}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"decision"),"psychology:observe-concealed");return pyBool(__left)?pyEqual(pyAt(result,"decision_source"),"director"):__left})())),"tests/kernel/test_ontology_runtime.py:129 assert result[\"decision\"] == \"psychology:observe-concealed\" and result[\"decision_source\"] == \"director\"");
}
Object.defineProperty(test_one_grounded_candidate_settles_with_decision_source_director,"__pySignature",{value:[{"name":"seeded_kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_one_grounded_candidate_settles_with_decision_source_director"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_one_grounded_candidate_settles_with_decision_source_director(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_several_grounded_candidates_narrow_the_choice_to_the_intersection(seeded_kernel:any){
let kernel:any,director:any,error:any;
kernel=seeded_kernel;
(await pyInvoke(open_turn,[kernel,"我恭维诺特。"],{}));
(await pyInvoke(resolve,[kernel,"t1-c1"],{"intent":"social","goal":"套话","method":"用魅惑套话","target":"Steven Knott"}));
(await pyInvoke(narrate,[kernel,"t1-c2","……"],{}));
director=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我读他的表情。"})),"capsule"),"director");
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"REVEAL")),"tests/kernel/test_ontology_runtime.py:138 assert director[\"beat\"] == \"REVEAL\"");
assert.ok(pyBool(pyLessEqual(new Set(["psychology:observe-concealed","social:adjudicate-difficulty"]),(await pyInvoke(pySet,[pyAt(director,"grounded_by")],{})))),"tests/kernel/test_ontology_runtime.py:139 assert {\"psychology:observe-concealed\", \"social:adjudicate-difficulty\"} <= set(director[\"grounded_by\"])");
error=(await pyInvoke(social_read,[kernel,"t2-c1"],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs_choice");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"narrowed_by"),"REVEAL"):__left})())),"tests/kernel/test_ontology_runtime.py:141 assert error[\"code\"] == \"needs_choice\" and error[\"details\"][\"narrowed_by\"] == \"REVEAL\"");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(pyAt(error,"details"),"candidates"))){__rows.push(pyAt(c,"name"));}return __rows;})())),new Set(["psychology:observe-concealed","social:adjudicate-difficulty"]))),"tests/kernel/test_ontology_runtime.py:142 assert {c[\"name\"] for c in error[\"details\"][\"candidates\"]} == {\"psychology:observe-concealed\", \"social:adjudicate-difficulty\"}");
assert.ok(pyBool(pyContains(pyAt(error,"fix"),"REVEAL")),"tests/kernel/test_ontology_runtime.py:143 assert \"REVEAL\" in error[\"fix\"]");
}
Object.defineProperty(test_several_grounded_candidates_narrow_the_choice_to_the_intersection,"__pySignature",{value:[{"name":"seeded_kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_several_grounded_candidates_narrow_the_choice_to_the_intersection"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_several_grounded_candidates_narrow_the_choice_to_the_intersection(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_no_intersection_leaves_the_full_list_and_an_explicit_decision_is_never_overturned(kernel:any){
let error:any,chosen:any;
(await pyInvoke(open_turn,[kernel,"我读诺特的表情。"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"director"),"grounded_by"),[])),"tests/kernel/test_ontology_runtime.py:148 assert kernel.table(\"capsule\")[\"director\"][\"grounded_by\"] == []");
error=(await pyInvoke(social_read,[kernel,"t1-c1"],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs_choice");return pyBool(__left)?!pyContains(pyAt(error,"details"),"narrowed_by"):__left})())),"tests/kernel/test_ontology_runtime.py:150 assert error[\"code\"] == \"needs_choice\" and \"narrowed_by\" not in error[\"details\"]");
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[pyAt(pyAt(error,"details"),"candidates")],{})),2)),"tests/kernel/test_ontology_runtime.py:151 assert len(error[\"details\"][\"candidates\"]) == 2");
chosen=(await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c2","action":({["intent"]:"social",["goal"]:"他在隐瞒什么",["method"]:"用心理学读他",["target"]:"Steven Knott",["decision"]:"social:adjudicate-difficulty",["skill"]:"Persuade"})}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(chosen,"decision"),"social:adjudicate-difficulty");return pyBool(__left)?!pyContains(chosen,"decision_source"):__left})())),"tests/kernel/test_ontology_runtime.py:155 assert chosen[\"decision\"] == \"social:adjudicate-difficulty\" and \"decision_source\" not in chosen");
}
Object.defineProperty(test_no_intersection_leaves_the_full_list_and_an_explicit_decision_is_never_overturned,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_no_intersection_leaves_the_full_list_and_an_explicit_decision_is_never_overturned"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_no_intersection_leaves_the_full_list_and_an_explicit_decision_is_never_overturned(await kernel(t,{}));});
export async function test_an_explicit_decision_is_untouched_even_when_the_director_grounds_the_other(seeded_kernel:any){
let kernel:any,chosen:any;
kernel=seeded_kernel;
(await pyInvoke(open_turn,[kernel,"我仔细观察诺特。"],{}));
(await pyInvoke(resolve,[kernel,"t1-c1"],{"intent":"investigate","goal":"看他","method":"用侦查","skill":"Spot Hidden"}));
(await pyInvoke(narrate,[kernel,"t1-c2","……"],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我读他的表情。"}));
chosen=(await pyMethod(kernel,"table",["resolve"],{"call_id":"t2-c1","action":({["intent"]:"social",["goal"]:"他在隐瞒什么",["method"]:"用心理学读他",["target"]:"Steven Knott",["decision"]:"social:adjudicate-difficulty",["skill"]:"Persuade"})}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(chosen,"decision"),"social:adjudicate-difficulty");return pyBool(__left)?!pyContains(chosen,"decision_source"):__left})())),"tests/kernel/test_ontology_runtime.py:167 assert chosen[\"decision\"] == \"social:adjudicate-difficulty\" and \"decision_source\" not in chosen");
}
Object.defineProperty(test_an_explicit_decision_is_untouched_even_when_the_director_grounds_the_other,"__pySignature",{value:[{"name":"seeded_kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_explicit_decision_is_untouched_even_when_the_director_grounds_the_other"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_explicit_decision_is_untouched_even_when_the_director_grounds_the_other(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});

export async function submit(client:any,job_id:any,candidates:any){
return (await pyMethod(client,"call",["memory.submit",({["campaign"]:CAMPAIGN,["job_id"]:job_id,["candidates"]:candidates})],{}));
}
Object.defineProperty(submit,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"job_id","rest":false,"varargs":false},{"name":"candidates","rest":false,"varargs":false}]});
export async function test_promise_is_accepted_shown_as_an_obligation_and_closed_by_its_successor(kernel:any){
let job_id:any,landed:any,first_id:any,obligations:any,promise:any,rows:any;
(await pyInvoke(open_turn,[kernel,"我和诺特谈报酬。"],{}));
job_id=pyAt(pyAt((await pyInvoke(narrate,[kernel,"t1-c1","诺特答应了。"],{})),"extraction"),"job_id");
landed=(await pyInvoke(submit,[kernel,job_id,[({["kind"]:"promise",["subject"]:"Steven Knott",["entities"]:[INVESTIGATOR],["knowers"]:["Steven Knott",INVESTIGATOR],["statement"]:"三天内付清报酬，条件是交出书面报告。"})]],{}));
assert.ok(pyBool(pyAt(landed,"ok")),pyStr(landed));
first_id=pyAt(pyAt(pyAt(landed,"result"),"written"),0);
obligations=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我记下了。"})),"capsule"),"obligations");
promise=(await pyNext((await (async()=>{const __rows:any[]=[];for(const o of pyIterable(obligations)){if(pyBool(pyEqual(pyAt(o,"kind"),"promise"))){__rows.push(o);}}return __rows;})())));
assert.ok(pyBool(pyEqual(promise,({["kind"]:"promise",["owner"]:"memory",["who"]:"Steven Knott",["state"]:"三天内付清报酬，条件是交出书面报告。",["cue"]:INVESTIGATOR,["authority"]:"conversation_report",["fulfillment"]:({["status"]:"open",["terms"]:[]})}))),"tests/kernel/test_ontology_runtime.py:185 assert promise == {\"kind\": \"promise\", \"owner\": \"memory\", \"who\": \"Steven Knott\", \"state\": \"三天内付清报酬，条件是交出书面报告。\",\n                       \"cue\": INVESTIGATOR, \"authority\": \"conversation_report\",\n                       \"fulfillment\": {\"status\": \"open\", \"terms\": []}}");
job_id=pyAt(pyAt((await pyInvoke(narrate,[kernel,"t2-c1","他改口了。"],{})),"extraction"),"job_id");
landed=(await pyInvoke(submit,[kernel,job_id,[({["kind"]:"promise",["subject"]:"Steven Knott",["entities"]:[INVESTIGATOR],["knowers"]:["Steven Knott",INVESTIGATOR],["statement"]:"一周内付清报酬。"})]],{}));
assert.ok(pyBool((await (async()=>{const __left=pyAt(landed,"ok");return pyBool(__left)?pyEqual(pyAt(pyAt(landed,"result"),"superseded"),[first_id]):__left})())),"tests/kernel/test_ontology_runtime.py:191 assert landed[\"ok\"] and landed[\"result\"][\"superseded\"] == [first_id]");
rows=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyInvoke(read_jsonl,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"memory"),"candidates.jsonl")],{})))){__rows.push([pyAt(r,"id"),r]);}return __rows;})()));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(rows,first_id),"status"),"superseded");return pyBool(__left)?pyEqual(pyAt(pyAt(rows,first_id),"valid_until_turn"),2):__left})())),"tests/kernel/test_ontology_runtime.py:193 assert rows[first_id][\"status\"] == \"superseded\" and rows[first_id][\"valid_until_turn\"] == 2");
obligations=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"好吧。"})),"capsule"),"obligations");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const o of pyIterable(obligations)){if(pyBool(pyEqual(pyAt(o,"kind"),"promise"))){__rows.push(pyAt(o,"state"));}}return __rows;})()),["一周内付清报酬。"])),"tests/kernel/test_ontology_runtime.py:195 assert [o[\"state\"] for o in obligations if o[\"kind\"] == \"promise\"] == [\"一周内付清报酬。\"]");
}
Object.defineProperty(test_promise_is_accepted_shown_as_an_obligation_and_closed_by_its_successor,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_promise_is_accepted_shown_as_an_obligation_and_closed_by_its_successor"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_promise_is_accepted_shown_as_an_obligation_and_closed_by_its_successor(await kernel(t,{}));});
export async function test_promise_validation_is_the_same_closed_validation(kernel:any){
let job_id:any,rejected:any,packet:any;
(await pyInvoke(open_turn,[kernel,"我和诺特谈。"],{}));
job_id=pyAt(pyAt((await pyInvoke(narrate,[kernel,"t1-c1","……"],{})),"extraction"),"job_id");
rejected=(await pyInvoke(submit,[kernel,job_id,[({["kind"]:"promise",["subject"]:"Steven Knott",["entities"]:["a stranger"],["statement"]:"x"})]],{}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=!pyBool(pyAt(rejected,"ok"));return pyBool(__left)?pyEqual(pyAt(pyAt(rejected,"error"),"code"),"invalid_params"):__left;})());return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(rejected,"error"),"details"),"index"),0):__left;})())),"tests/kernel/test_ontology_runtime.py:203 assert not rejected[\"ok\"] and rejected[\"error\"][\"code\"] == \"invalid_params\" and rejected[\"error\"][\"details\"][\"index\"] == 0");
packet=(await pyMethod(kernel,"ok",["memory.job",({["campaign"]:CAMPAIGN,["turn"]:1})],{}));
assert.ok(pyBool(pyContains(pyAt(packet,"instruction"),"promise")),"tests/kernel/test_ontology_runtime.py:205 assert \"promise\" in packet[\"instruction\"]");
}
Object.defineProperty(test_promise_validation_is_the_same_closed_validation,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_promise_validation_is_the_same_closed_validation"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_promise_validation_is_the_same_closed_validation(await kernel(t,{}));});
