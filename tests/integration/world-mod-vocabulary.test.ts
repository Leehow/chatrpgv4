// Migrated from tests/kernel/test_mod_vocabulary.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,RpcClient,WORKTREE,create_campaign,read_json,claim,finish,indexed,observed,request,write,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_mod_vocabulary.py',import.meta.url).pathname;









export let DIALECT:any=({["key"]:"dialect",["label"]:"dialect",["ask"]:"the dialect this person speaks in, when the book names one"});
export async function package_value(tmp_path:any,name:any="dialects",vocabulary:any=DIALECT,requires:any=true,manifest_overrides:any={}){
let path:any,manifest:any,check:any;

path=pyDivide(tmp_path,`package-${name}`);
(await pyMethod(shutil,"copytree",[pyDivide(pyDivide(WORKTREE,"mods"),"natural-npc"),path],{}));
manifest=(await pyInvoke(read_json,[pyDivide(path,"mod.json")],{}));
manifest["id"]=name;
manifest["version"]="1.0.0";
manifest["requires"]=(await (async()=>{const __rows:any[]=[];for(const cap of pyIterable(pyAt(manifest,"requires"))){if(pyBool(!pyEqual(cap,"graph.vocabulary.v1"))){__rows.push(cap);}}return __rows;})());
if(pyBool(requires)){manifest["requires"]=[...pyAt(manifest,"requires"),"graph.vocabulary.v1"];}
(await pyMethod(pyAt(manifest,"contributes"),"pop",["vocabulary",null],{}));
if(pyBool((vocabulary!==null))){pyAt(manifest,"contributes")["vocabulary"]=({["actor_profile_keys"]:[vocabulary]});}
for(check of pyIterable(pyAt(pyAt(manifest,"contributes"),"checks"))){
check["name"]=`${name}:first-impression`;
}
pyAt(manifest,"contributes")["audit_on_decisions"]=[`${name}:first-impression`];
(await pyMethod(manifest,"update",[manifest_overrides],{}));
(await pyMethod((pyDivide(path,"mod.json")),"write_text",[(await pyMethod(json,"dumps",[manifest],{}))],{}));
return path;
}
Object.defineProperty(package_value,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false},{"name":"name","rest":false,"varargs":false},{"name":"vocabulary","rest":false,"varargs":false},{"name":"requires","rest":false,"varargs":false},{"name":"manifest_overrides","rest":true,"varargs":false}]});
export async function emitted_client(workspace:any,content:any=null){return new RpcClient(String(workspace),{content:content&&String(content)});}

export async function test_a_vocabulary_contribution_is_checked_for_shape(kernel:any,tmp_path:any){
let future:any;

(await pyMethod(kernel,"ok",["mods.install",({["path"]:(await pyInvoke(pyStr,[(await pyInvoke(package_value,[tmp_path],{"name":"dialects"}))],{}))})],{}));
async function rejected(name:any,kwargs:any={}){
let error:any;
error=(await pyMethod(kernel,"err",["mods.install",({["path"]:(await pyInvoke(pyStr,[(await pyInvoke(package_value,[tmp_path],{"name":name,...kwargs}))],{}))})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),pyStr([name,error]));
return pyAt(error,"message");
}
Object.defineProperty(rejected,"__pySignature",{value:[{"name":"name","rest":false,"varargs":false},{"name":"kwargs","rest":true,"varargs":false}]});
assert.ok(pyBool(pyContains((await pyInvoke(rejected,["no-capability"],{"requires":false})),"graph.vocabulary.v1")),"tests/kernel/test_mod_vocabulary.py:66 assert \"graph.vocabulary.v1\" in rejected(\"no-capability\", requires=False)");
assert.ok(pyBool(pyContains((await pyInvoke(rejected,["bad-slug"],{"vocabulary":({...DIALECT,["key"]:"Language"})})),"slug")),"tests/kernel/test_mod_vocabulary.py:67 assert \"slug\" in rejected(\"bad-slug\", vocabulary={**DIALECT, \"key\": \"Language\"})");
assert.ok(pyBool(pyContains((await pyInvoke(rejected,["no-label"],{"vocabulary":({...DIALECT,["label"]:"   "})})),"label")),"tests/kernel/test_mod_vocabulary.py:68 assert \"label\" in rejected(\"no-label\", vocabulary={**DIALECT, \"label\": \"   \"})");
assert.ok(pyBool(pyContains((await pyInvoke(rejected,["long-ask"],{"vocabulary":({...DIALECT,["ask"]:pyMultiply("x",401)})})),"ask")),"tests/kernel/test_mod_vocabulary.py:69 assert \"ask\" in rejected(\"long-ask\", vocabulary={**DIALECT, \"ask\": \"x\" * 401})");
(await pyMethod(kernel,"ok",["mods.install",({["path"]:(await pyInvoke(pyStr,[(await pyInvoke(package_value,[tmp_path],{"name":"extra-field","vocabulary":({...DIALECT,["extra"]:1})}))],{}))})],{}));
future=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await pyMethod(kernel,"ok",["mods.list"],{})),"mods"))){if(pyBool(pyEqual(pyAt(row,"id"),"extra-field"))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool((pyAt(future,"compatible")===false)),"tests/kernel/test_mod_vocabulary.py:72 assert future[\"compatible\"] is False");
assert.ok(pyBool(pyContains((await pyInvoke(rejected,["empty-list"],{"vocabulary":null,"contributes":({["vocabulary"]:({["actor_profile_keys"]:[]})})})),"one to eight")),"tests/kernel/test_mod_vocabulary.py:73 assert \"one to eight\" in rejected(\"empty-list\", vocabulary=None,\n                                      contributes={\"vocabulary\": {\"actor_profile_keys\": []}})");
}
Object.defineProperty(test_a_vocabulary_contribution_is_checked_for_shape,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_vocabulary_contribution_is_checked_for_shape"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_vocabulary_contribution_is_checked_for_shape(await kernel(t,{}),temporary);});

export async function built_module(client:any,tmp_path:any,npc_properties:any){
let mid:any,_:any,job:any,packet:any,refs:any,nodes:any,claims:any;


const __unpack4307=(await pyInvoke(indexed,[client,tmp_path],{}));mid=__unpack4307[0];_=__unpack4307[1];
(await pyInvoke(request,[client,mid,"opening"],{}));
job=(await pyInvoke(claim,[client,mid],{}));
packet=(await pyInvoke(read_json,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"packet.json")],{}));
(await pyInvoke(observed,[job],{}));
refs=[({["page"]:1})];
nodes=[({["node_id"]:"scene-dock",["node_kind"]:"scene",["name"]:"Dock",["source_refs"]:refs,["properties"]:({["is_entrance"]:true})}),({["node_id"]:"scene-tower",["node_kind"]:"scene",["name"]:"Tower",["source_refs"]:[({["page"]:2})],["summary"]:"An old tower beyond the harbor.",["properties"]:({["is_final"]:true})}),({["node_id"]:"npc-tenant",["node_kind"]:"npc",["name"]:"Tenant",["source_refs"]:refs,["summary"]:"A tenant.",["properties"]:npc_properties})];
claims=(await (async()=>{const __rows:any[]=[];for(const [a,r,b] of pyIterable([["scene-dock","route-to","scene-tower"],["npc-tenant","present-in","scene-dock"]])){__rows.push(({["subject_id"]:a,["predicate"]:r,["object"]:({["node_id"]:b}),["truth_status"]:"authored-fact",["source_refs"]:refs}));}return __rows;})());
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"draft.json"),({["nodes"]:nodes,["claims"]:claims,["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:[],["ready_nodes"]:["scene-dock","npc-tenant"]})],{}));
(await pyInvoke(write,[pyDivide((await pyInvoke(Path,[pyAt(job,"work_dir")],{})),"review.json"),({["checked"]:(await (async()=>{const __rows:any[]=[];for(const p of pyIterable(["/nodes/0","/nodes/2","/nodes/2/summary","/claims/0","/claims/1","/coverage"])){__rows.push(({["path"]:p,["verdict"]:"supported",["source_refs"]:refs,["reason"]:"fixture support"}));}return __rows;})()),["missing"]:[]})],{}));
(await pyInvoke(finish,[client,job],{}));
return [mid,packet];
}
Object.defineProperty(built_module,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false},{"name":"npc_properties","rest":false,"varargs":false}]});
export async function test_a_contributed_key_reaches_the_reader_and_the_module_records_it(tmp_path:any){
let client:any,mid:any,packet:any,contributed:any,by_contributed:any,core:any,recorded:any,by_key:any;

client=(await pyInvoke(emitted_client,[pyDivide(tmp_path,"ws")],{}));
try{(await pyMethod(client,"ok",["mods.install",({["path"]:(await pyInvoke(pyStr,[(await pyInvoke(package_value,[tmp_path],{"name":"dialects"}))],{}))})],{}));
const __unpack6267=(await pyInvoke(built_module,[client,tmp_path,({["agenda"]:"Keep the room.",["dialect"]:"Sicilian"})],{}));mid=__unpack6267[0];packet=__unpack6267[1];
contributed=pyAt(pyAt(pyAt(packet,"vocabulary"),"actor_dossier"),"contributed");
assert.ok(pyBool(pyContains(contributed,DIALECT)),"tests/kernel/test_mod_vocabulary.py:121 assert DIALECT in contributed");
by_contributed=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(contributed)){__rows.push([pyAt(entry,"key"),entry]);}return __rows;})()));
assert.ok(pyBool(pyEqual((await pyInvoke(pySet,[by_contributed],{})),new Set(["language","voice_mask","exchanges","dialect"]))),"tests/kernel/test_mod_vocabulary.py:123 assert set(by_contributed) == {\"language\", \"voice_mask\", \"exchanges\", \"dialect\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(by_contributed,"language"),"key"),"language")),"tests/kernel/test_mod_vocabulary.py:124 assert by_contributed[\"language\"][\"key\"] == \"language\"");
core=pyAt(pyAt(pyAt(packet,"vocabulary"),"actor_dossier"),"profile_keys");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(core,"dialect");return pyBool(__left)?!pyContains(core,"language"):__left})())),"tests/kernel/test_mod_vocabulary.py:129 assert \"dialect\" not in core and \"language\" not in core");
recorded=pyAt((await pyInvoke(read_json,[pyDivide(pyDivide(pyDivide(pyDivide(client.workspace,".coc"),"modules"),mid),"module.json")],{})),"vocabulary");
by_key=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(pyAt(recorded,"actor_profile_keys"))){__rows.push([pyAt(entry,"key"),entry]);}return __rows;})()));
assert.ok(pyBool(pyEqual((await pyInvoke(pySet,[by_key],{})),new Set(["language","voice_mask","exchanges","dialect"]))),"tests/kernel/test_mod_vocabulary.py:133 assert set(by_key) == {\"language\", \"voice_mask\", \"exchanges\", \"dialect\"}");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(by_key,"dialect"),"mod"),"dialects");return pyBool(__left)?pyEqual(pyAt(pyAt(by_key,"language"),"mod"),"natural-npc"):__left})())),"tests/kernel/test_mod_vocabulary.py:134 assert by_key[\"dialect\"][\"mod\"] == \"dialects\" and by_key[\"language\"][\"mod\"] == \"natural-npc\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(by_key,"voice_mask"),"mod"),"narration-craft");return pyBool(__left)?pyEqual(pyAt(pyAt(by_key,"exchanges"),"mod"),"narration-craft"):__left})())),"tests/kernel/test_mod_vocabulary.py:135 assert by_key[\"voice_mask\"][\"mod\"] == \"narration-craft\" and by_key[\"exchanges\"][\"mod\"] == \"narration-craft\"");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_contributed_key_reaches_the_reader_and_the_module_records_it,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_contributed_key_reaches_the_reader_and_the_module_records_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_contributed_key_reaches_the_reader_and_the_module_records_it(temporary);});
export let BOOK:any="c2";
export async function table_npcs(client:any,campaign:any){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt((await pyMethod(client,"ok",["table.look",({["campaign"]:campaign,["focus"]:"npc"})],{})),"present"))){__rows.push([pyAt(p,"name"),p]);}return __rows;})()));
}
Object.defineProperty(table_npcs,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"campaign","rest":false,"varargs":false}]});
export async function played(client:any,tmp_path:any,mid:any){
let library_id:any;

(await pyInvoke(create_campaign,[client],{}));
library_id=pyAt((await pyMethod(client,"ok",["investigator.save",({["campaign"]:CAMPAIGN})],{})),"library_id");
(await pyMethod(client,"ok",["campaign.create",({["id"]:BOOK,["module"]:mid,["play_language"]:"en"})],{}));
(await pyMethod(client,"ok",["investigator.load",({["campaign"]:BOOK,["library_id"]:library_id})],{}));
(await pyMethod(client,"ok",["setup.complete",({["campaign"]:BOOK})],{}));
(await pyMethod(client,"ok",["table.open",({["campaign"]:BOOK})],{}));
return BOOK;
}
Object.defineProperty(played,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"tmp_path","rest":false,"varargs":false},{"name":"mid","rest":false,"varargs":false}]});
export async function test_a_recorded_key_reaches_the_table_and_does_not_need_its_package_on(tmp_path:any){
let client:any,mid:any,_:any,campaign:any,tenant:any;

client=(await pyInvoke(emitted_client,[pyDivide(tmp_path,"ws")],{}));
try{(await pyMethod(client,"ok",["mods.install",({["path"]:(await pyInvoke(pyStr,[(await pyInvoke(package_value,[tmp_path],{"name":"dialects"}))],{}))})],{}));
const __unpack9036=(await pyInvoke(built_module,[client,tmp_path,({["agenda"]:"Keep the room.",["dialect"]:"Sicilian"})],{}));mid=__unpack9036[0];_=__unpack9036[1];
campaign=(await pyInvoke(played,[client,tmp_path,mid],{}));
tenant=pyAt((await pyInvoke(table_npcs,[client,campaign],{})),"Tenant");
assert.ok(pyBool(pyEqual(pyAt(tenant,"dialect"),"Sicilian")),"tests/kernel/test_mod_vocabulary.py:170 assert tenant[\"dialect\"] == \"Sicilian\"");
assert.ok(pyBool(pyEqual(pyAt(tenant,"wants"),"Keep the room.")),"tests/kernel/test_mod_vocabulary.py:171 assert tenant[\"wants\"] == \"Keep the room.\"");
(await pyMethod(client,"ok",["mods.configure",({["campaign"]:campaign,["id"]:"dialects",["enabled"]:false})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(table_npcs,[client,campaign],{})),"Tenant"),"dialect"),"Sicilian")),"tests/kernel/test_mod_vocabulary.py:174 assert table_npcs(client, campaign)[\"Tenant\"][\"dialect\"] == \"Sicilian\"");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_recorded_key_reaches_the_table_and_does_not_need_its_package_on,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_recorded_key_reaches_the_table_and_does_not_need_its_package_on"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_recorded_key_reaches_the_table_and_does_not_need_its_package_on(temporary);});
export async function test_a_word_no_package_asked_for_does_not_reach_the_table(tmp_path:any){
let client:any,mid:any,packet:any,asked:any,tenant:any;

client=(await pyInvoke(emitted_client,[pyDivide(tmp_path,"ws")],{}));
try{const __unpack10104=(await pyInvoke(built_module,[client,tmp_path,({["agenda"]:"Keep the room.",["dialect"]:"Sicilian"})],{}));mid=__unpack10104[0];packet=__unpack10104[1];
asked=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(pyAt(pyAt(pyAt(packet,"vocabulary"),"actor_dossier"),"contributed"))){__rows.push([pyAt(entry,"key"),entry]);}return __rows;})()));
assert.ok(pyBool(pyEqual((await pyInvoke(pySet,[asked],{})),new Set(["language","voice_mask","exchanges"]))),"tests/kernel/test_mod_vocabulary.py:188 assert set(asked) == {\"language\", \"voice_mask\", \"exchanges\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(asked,"language"),"key"),"language")),"tests/kernel/test_mod_vocabulary.py:189 assert asked[\"language\"][\"key\"] == \"language\"");
tenant=pyAt((await pyInvoke(table_npcs,[client,(await pyInvoke(played,[client,tmp_path,mid],{}))],{})),"Tenant");
assert.ok(pyBool(pyEqual(pyAt(tenant,"wants"),"Keep the room.")),"tests/kernel/test_mod_vocabulary.py:191 assert tenant[\"wants\"] == \"Keep the room.\"");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(tenant,"dialect");return pyBool(__left)?!pyContains((await pyMethod(json,"dumps",[tenant],{})),"Sicilian"):__left})())),"tests/kernel/test_mod_vocabulary.py:192 assert \"dialect\" not in tenant and \"Sicilian\" not in json.dumps(tenant)");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_word_no_package_asked_for_does_not_reach_the_table,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_word_no_package_asked_for_does_not_reach_the_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_word_no_package_asked_for_does_not_reach_the_table(temporary);});
export async function words(client:any,campaign:any){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable((await pyMethod((await pyMethod((await pyMethod(client,"ok",["mods.context",({["campaign"]:campaign})],{})),"get",["vocabulary",({})],{})),"get",["words",[]],{})))){__rows.push([pyAt(entry,"key"),entry]);}return __rows;})()));
}
Object.defineProperty(words,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"campaign","rest":false,"varargs":false}]});
export async function test_a_package_can_see_whether_its_own_word_reached_the_table(tmp_path:any){
let client:any,mid:any,_:any,campaign:any,found:any;

client=(await pyInvoke(emitted_client,[pyDivide(tmp_path,"ws")],{}));
try{const __unpack11392=(await pyInvoke(built_module,[client,tmp_path,({["agenda"]:"Keep the room.",["dialect"]:"Sicilian"})],{}));mid=__unpack11392[0];_=__unpack11392[1];
(await pyMethod(client,"ok",["mods.install",({["path"]:(await pyInvoke(pyStr,[(await pyInvoke(package_value,[tmp_path],{"name":"dialects"}))],{}))})],{}));
campaign=(await pyInvoke(played,[client,tmp_path,mid],{}));
found=(await pyInvoke(words,[client,campaign],{}));
assert.ok(pyBool(pyEqual(pyAt(found,"language"),({["key"]:"language",["label"]:"speaks",["mod"]:"natural-npc",["bound"]:true}))),"tests/kernel/test_mod_vocabulary.py:214 assert found[\"language\"] == {\"key\": \"language\", \"label\": \"speaks\",\n                                     \"mod\": \"natural-npc\", \"bound\": True}");
assert.ok(pyBool(pyEqual(pyAt(found,"dialect"),({["key"]:"dialect",["label"]:"dialect",["mod"]:"dialects",["bound"]:false}))),"tests/kernel/test_mod_vocabulary.py:217 assert found[\"dialect\"] == {\"key\": \"dialect\", \"label\": \"dialect\",\n                                    \"mod\": \"dialects\", \"bound\": False}");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_package_can_see_whether_its_own_word_reached_the_table,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_package_can_see_whether_its_own_word_reached_the_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_package_can_see_whether_its_own_word_reached_the_table(temporary);});
export async function test_a_bound_word_outlives_the_package_that_asked_for_it(tmp_path:any){
let client:any,mid:any,_:any,campaign:any;

client=(await pyInvoke(emitted_client,[pyDivide(tmp_path,"ws")],{}));
try{(await pyMethod(client,"ok",["mods.install",({["path"]:(await pyInvoke(pyStr,[(await pyInvoke(package_value,[tmp_path],{"name":"dialects"}))],{}))})],{}));
const __unpack12581=(await pyInvoke(built_module,[client,tmp_path,({["agenda"]:"Keep the room.",["dialect"]:"Sicilian"})],{}));mid=__unpack12581[0];_=__unpack12581[1];
campaign=(await pyInvoke(played,[client,tmp_path,mid],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(words,[client,campaign],{})),"dialect"),({["key"]:"dialect",["label"]:"dialect",["mod"]:"dialects",["bound"]:true}))),"tests/kernel/test_mod_vocabulary.py:232 assert words(client, campaign)[\"dialect\"] == {\"key\": \"dialect\", \"label\": \"dialect\",\n                                                      \"mod\": \"dialects\", \"bound\": True}");
(await pyMethod(client,"ok",["mods.configure",({["campaign"]:campaign,["id"]:"dialects",["enabled"]:false})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(table_npcs,[client,campaign],{})),"Tenant"),"dialect"),"Sicilian")),"tests/kernel/test_mod_vocabulary.py:237 assert table_npcs(client, campaign)[\"Tenant\"][\"dialect\"] == \"Sicilian\"");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(words,[client,campaign],{})),"dialect"),({["key"]:"dialect",["label"]:"dialect",["mod"]:null,["bound"]:true}))),"tests/kernel/test_mod_vocabulary.py:238 assert words(client, campaign)[\"dialect\"] == {\"key\": \"dialect\", \"label\": \"dialect\",\n                                                     \"mod\": None, \"bound\": True}");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_bound_word_outlives_the_package_that_asked_for_it,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_bound_word_outlives_the_package_that_asked_for_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_bound_word_outlives_the_package_that_asked_for_it(temporary);});

export async function open_turn(client:any,campaign:any){
(await pyMethod(client,"ok",["table.player_input",({["campaign"]:campaign,["text"]:"I try talking to them."})],{}));
}
Object.defineProperty(open_turn,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"campaign","rest":false,"varargs":false}]});
export async function apply_dossier(client:any,campaign:any,name:any,values:any,call:any="t1-c1",why:any="The party heard them switch."){
return (await pyMethod(client,"ok",["table.apply",({["campaign"]:campaign,["call_id"]:call,["effects"]:[({["kind"]:"dossier",["name"]:name,["values"]:values,["why"]:why})]})],{}));
}
Object.defineProperty(apply_dossier,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"campaign","rest":false,"varargs":false},{"name":"name","rest":false,"varargs":false},{"name":"values","rest":false,"varargs":false},{"name":"call","rest":false,"varargs":false},{"name":"why","rest":false,"varargs":false}]});
export async function test_the_table_may_establish_a_word_the_book_left_silent(tmp_path:any){
let client:any,mid:any,_:any,campaign:any;

client=(await pyInvoke(emitted_client,[pyDivide(tmp_path,"ws")],{}));
try{(await pyMethod(client,"ok",["mods.install",({["path"]:(await pyInvoke(pyStr,[(await pyInvoke(package_value,[tmp_path],{"name":"dialects"}))],{}))})],{}));
const __unpack14476=(await pyInvoke(built_module,[client,tmp_path,({["agenda"]:"Keep the room."})],{}));mid=__unpack14476[0];_=__unpack14476[1];
campaign=(await pyInvoke(played,[client,tmp_path,mid],{}));
(await pyInvoke(open_turn,[client,campaign],{}));
assert.ok(pyBool(!pyContains(pyAt((await pyInvoke(table_npcs,[client,campaign],{})),"Tenant"),"dialect")),"tests/kernel/test_mod_vocabulary.py:266 assert \"dialect\" not in table_npcs(client, campaign)[\"Tenant\"]");
(await pyInvoke(apply_dossier,[client,campaign,"Tenant",({["dialect"]:"Sicilian, little English"})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(table_npcs,[client,campaign],{})),"Tenant"),"dialect"),"Sicilian, little English")),"tests/kernel/test_mod_vocabulary.py:269 assert table_npcs(client, campaign)[\"Tenant\"][\"dialect\"] == \"Sicilian, little English\"");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_the_table_may_establish_a_word_the_book_left_silent,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_table_may_establish_a_word_the_book_left_silent"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_table_may_establish_a_word_the_book_left_silent(temporary);});
export async function test_what_the_table_established_goes_when_the_package_does(tmp_path:any){
let client:any,mid:any,_:any,campaign:any;

client=(await pyInvoke(emitted_client,[pyDivide(tmp_path,"ws")],{}));
try{(await pyMethod(client,"ok",["mods.install",({["path"]:(await pyInvoke(pyStr,[(await pyInvoke(package_value,[tmp_path],{"name":"dialects"}))],{}))})],{}));
const __unpack15413=(await pyInvoke(built_module,[client,tmp_path,({["agenda"]:"Keep the room."})],{}));mid=__unpack15413[0];_=__unpack15413[1];
campaign=(await pyInvoke(played,[client,tmp_path,mid],{}));
(await pyInvoke(open_turn,[client,campaign],{}));
(await pyInvoke(apply_dossier,[client,campaign,"Tenant",({["dialect"]:"Sicilian, little English"})],{}));
(await pyMethod(client,"ok",["table.narrate",({["campaign"]:campaign,["call_id"]:"t1-c2",["text"]:"The tenant shrugs."})],{}));
(await pyMethod(client,"ok",["mods.configure",({["campaign"]:campaign,["id"]:"dialects",["enabled"]:false})],{}));
assert.ok(pyBool(!pyContains(pyAt((await pyInvoke(table_npcs,[client,campaign],{})),"Tenant"),"dialect")),"tests/kernel/test_mod_vocabulary.py:290 assert \"dialect\" not in table_npcs(client, campaign)[\"Tenant\"]");
(await pyMethod(client,"ok",["mods.configure",({["campaign"]:campaign,["id"]:"dialects",["enabled"]:true})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(table_npcs,[client,campaign],{})),"Tenant"),"dialect"),"Sicilian, little English")),"tests/kernel/test_mod_vocabulary.py:292 assert table_npcs(client, campaign)[\"Tenant\"][\"dialect\"] == \"Sicilian, little English\"");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_what_the_table_established_goes_when_the_package_does,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_what_the_table_established_goes_when_the_package_does"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_what_the_table_established_goes_when_the_package_does(temporary);});
export async function test_the_book_is_not_the_tables_to_overwrite(tmp_path:any){
let client:any,mid:any,_:any,campaign:any,refused:any;

client=(await pyInvoke(emitted_client,[pyDivide(tmp_path,"ws")],{}));
try{(await pyMethod(client,"ok",["mods.install",({["path"]:(await pyInvoke(pyStr,[(await pyInvoke(package_value,[tmp_path],{"name":"dialects"}))],{}))})],{}));
const __unpack16674=(await pyInvoke(built_module,[client,tmp_path,({["agenda"]:"Keep the room.",["dialect"]:"Sicilian"})],{}));mid=__unpack16674[0];_=__unpack16674[1];
campaign=(await pyInvoke(played,[client,tmp_path,mid],{}));
(await pyInvoke(open_turn,[client,campaign],{}));
refused=(await pyMethod(client,"err",["table.apply",({["campaign"]:campaign,["call_id"]:"t1-c1",["effects"]:[({["kind"]:"dossier",["name"]:"Tenant",["values"]:({["dialect"]:"Neapolitan"})})]})],{}));
assert.ok(pyBool(pyEqual(pyAt(refused,"code"),"invalid_params")),"tests/kernel/test_mod_vocabulary.py:309 assert refused[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyContains(pyAt(refused,"message"),"Sicilian")),"tests/kernel/test_mod_vocabulary.py:310 assert \"Sicilian\" in refused[\"message\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(table_npcs,[client,campaign],{})),"Tenant"),"dialect"),"Sicilian")),"tests/kernel/test_mod_vocabulary.py:311 assert table_npcs(client, campaign)[\"Tenant\"][\"dialect\"] == \"Sicilian\"");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_the_book_is_not_the_tables_to_overwrite,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_book_is_not_the_tables_to_overwrite"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_book_is_not_the_tables_to_overwrite(temporary);});
export async function test_only_a_word_an_active_package_establishes_is_accepted(tmp_path:any){
let client:any,mid:any,_:any,campaign:any,refused:any;

client=(await pyInvoke(emitted_client,[pyDivide(tmp_path,"ws")],{}));
try{(await pyMethod(client,"ok",["mods.install",({["path"]:(await pyInvoke(pyStr,[(await pyInvoke(package_value,[tmp_path],{"name":"dialects"}))],{}))})],{}));
const __unpack17669=(await pyInvoke(built_module,[client,tmp_path,({["agenda"]:"Keep the room."})],{}));mid=__unpack17669[0];_=__unpack17669[1];
campaign=(await pyInvoke(played,[client,tmp_path,mid],{}));
(await pyInvoke(open_turn,[client,campaign],{}));
refused=(await pyMethod(client,"err",["table.apply",({["campaign"]:campaign,["call_id"]:"t1-c1",["effects"]:[({["kind"]:"dossier",["name"]:"Tenant",["values"]:({["favourite_colour"]:"green"})})]})],{}));
assert.ok(pyBool(pyEqual(pyAt(refused,"code"),"invalid_params")),"tests/kernel/test_mod_vocabulary.py:328 assert refused[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyContains(pyAt(refused,"message"),"favourite_colour")),"tests/kernel/test_mod_vocabulary.py:329 assert \"favourite_colour\" in refused[\"message\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_only_a_word_an_active_package_establishes_is_accepted,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_only_a_word_an_active_package_establishes_is_accepted"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_only_a_word_an_active_package_establishes_is_accepted(temporary);});
export async function test_a_table_whose_module_never_carried_the_word_can_still_establish_it(tmp_path:any){
let client:any,mid:any,packet:any,asked:any,campaign:any;

client=(await pyInvoke(emitted_client,[pyDivide(tmp_path,"ws")],{}));
try{const __unpack18700=(await pyInvoke(built_module,[client,tmp_path,({["agenda"]:"Keep the room."})],{}));mid=__unpack18700[0];packet=__unpack18700[1];
asked=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(pyAt(pyAt(pyAt(packet,"vocabulary"),"actor_dossier"),"contributed"))){__rows.push([pyAt(entry,"key"),entry]);}return __rows;})()));
assert.ok(pyBool(pyEqual((await pyInvoke(pySet,[asked],{})),new Set(["language","voice_mask","exchanges"]))),"tests/kernel/test_mod_vocabulary.py:343 assert set(asked) == {\"language\", \"voice_mask\", \"exchanges\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(asked,"language"),"key"),"language")),"tests/kernel/test_mod_vocabulary.py:344 assert asked[\"language\"][\"key\"] == \"language\"");
(await pyMethod(client,"ok",["mods.install",({["path"]:(await pyInvoke(pyStr,[(await pyInvoke(package_value,[tmp_path],{"name":"dialects"}))],{}))})],{}));
campaign=(await pyInvoke(played,[client,tmp_path,mid],{}));
assert.ok(pyBool((pyAt(pyAt((await pyInvoke(words,[client,campaign],{})),"dialect"),"bound")===false)),"tests/kernel/test_mod_vocabulary.py:347 assert words(client, campaign)[\"dialect\"][\"bound\"] is False");
(await pyInvoke(open_turn,[client,campaign],{}));
(await pyInvoke(apply_dossier,[client,campaign,"Tenant",({["dialect"]:"Sicilian, little English"})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(table_npcs,[client,campaign],{})),"Tenant"),"dialect"),"Sicilian, little English")),"tests/kernel/test_mod_vocabulary.py:351 assert table_npcs(client, campaign)[\"Tenant\"][\"dialect\"] == \"Sicilian, little English\"");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_table_whose_module_never_carried_the_word_can_still_establish_it,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_table_whose_module_never_carried_the_word_can_still_establish_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_table_whose_module_never_carried_the_word_can_still_establish_it(temporary);});
