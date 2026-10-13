// Migrated from tests/kernel/test_minted_place.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {RpcClient,campaign_dir,narrate,open_turn,read_json,confirmed_investigator,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,retainedFixture,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,pyType,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_minted_place.py',import.meta.url).pathname;









export let ORIGIN:any="commission-briefing";
export let LOBBY:any="The Globe's back stair";
export let MORGUE:any="newspaper-morgue";
export let OMITTED:any=(await pyInvoke(Object,[],{}));
export async function mint(client:any,call_id:any,within:any=OMITTED,to:any=LOBBY){
let establish:any;
establish=({["summary"]:"A narrow service stair behind the newspaper offices."});
if(pyBool((within!==OMITTED))){establish["within"]=within;}
return (await pyMethod(client,"table",["apply"],{"call_id":call_id,"effects":[({["kind"]:"move",["to"]:to,["via"]:"Round the back of the building",["establish"]:establish})]}));
}
Object.defineProperty(mint,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"call_id","rest":false,"varargs":false},{"name":"within","rest":false,"varargs":false},{"name":"to","rest":false,"varargs":false}]});
export async function test_an_explicit_outside_mint_keeps_its_way_back_across_a_new_process(tmp_path:any){
let workspace:any,client:any,where:any,record:any;
workspace=pyDivide(tmp_path,"ws");
client=(new RpcClient(workspace));try{(await pyInvoke(open_turn,[client,"I slip round to the back of the newspaper building."],{}));
(await pyInvoke(mint,[client,"t1-c1"],{"within":null}));
where=pyAt((await pyMethod(client,"table",["capsule"],{})),"where");
assert.ok(pyBool(pyEqual(pyAt(where,"scene"),LOBBY)),"tests/kernel/test_minted_place.py:36 assert where[\"scene\"] == LOBBY");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const exit of pyIterable(pyAt(where,"exits"))){__rows.push(pyAt(exit,"to"));}return __rows;})()),[ORIGIN])),pyStr("the route-to back edge is the minted room's exit"));
assert.ok(pyBool(!pyContains(where,"within")),"tests/kernel/test_minted_place.py:38 assert \"within\" not in where");
record=pyAt(pyAt((await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[workspace],{})),"world.json")],{})),"table_entities"),0);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(record,"from"),ORIGIN);return pyBool(__left)?!pyContains(record,"within"):__left;})())),"tests/kernel/test_minted_place.py:40 assert record[\"from\"] == ORIGIN and \"within\" not in record");
(await pyInvoke(narrate,[client,"t1-c2","You find the back stair."],{}));}finally{await client.close();}
client=(new RpcClient(workspace,({"fresh":true})));try{(await pyMethod(client,"table",["open"],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const exit of pyIterable(pyAt(pyAt((await pyMethod(client,"table",["capsule"],{})),"where"),"exits"))){__rows.push(pyAt(exit,"to"));}return __rows;})()),[ORIGIN])),"tests/kernel/test_minted_place.py:44 assert [exit[\"to\"] for exit in client.table(\"capsule\")[\"where\"][\"exits\"]] == [ORIGIN]");}finally{await client.close();}
}
Object.defineProperty(test_an_explicit_outside_mint_keeps_its_way_back_across_a_new_process,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_explicit_outside_mint_keeps_its_way_back_across_a_new_process"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_explicit_outside_mint_keeps_its_way_back_across_a_new_process(temporary);});
export async function test_within_writes_located_in_and_the_capsule_shows_the_book_place(tmp_path:any){
let workspace:any,client:any,within:any,seated:any;
workspace=pyDivide(tmp_path,"ws");
client=(new RpcClient(workspace));try{(await pyInvoke(open_turn,[client,"I slip round to the back of the newspaper building."],{}));
(await pyInvoke(mint,[client,"t1-c1"],{"within":MORGUE}));
within=pyAt(pyAt((await pyMethod(client,"table",["capsule"],{})),"where"),"within");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(within,"name"),MORGUE);return pyBool(__left)?pyEqual(pyAt(within,"display_name"),"Boston Globe offices"):__left;})())),"tests/kernel/test_minted_place.py:53 assert within[\"name\"] == MORGUE and within[\"display_name\"] == \"Boston Globe offices\"");
assert.ok(pyBool((await (async()=>{const __left=(await pyInvoke(pyIsInstance,[pyAt(within,"summary"),pyStr],{}));return pyBool(__left)?pyAt(within,"summary"):__left;})())),"tests/kernel/test_minted_place.py:54 assert isinstance(within[\"summary\"], str) and within[\"summary\"]");
assert.ok(pyBool(pyEqual(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const person of pyIterable(pyAt(within,"people"))){__rows.push([pyAt(person,"name"),pyAt(person,"seated")]);}return __rows;})())),({["arty-wilmot"]:false,["ruth-blake"]:false}))),"tests/kernel/test_minted_place.py:55 assert {person[\"name\"]: person[\"seated\"] for person in within[\"people\"]} == {\"arty-wilmot\": False, \"ruth-blake\": False}");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(await pyInvoke(pyIsInstance,[pyAt(within,"clues"),pyInt],{}));return pyBool(__left)?(await pyInvoke(pyIsInstance,[pyAt(within,"exits"),pyList],{})):__left;})());return pyBool(__left)?pyEqual(pyAt(within,"material"),"ready"):__left;})())),"tests/kernel/test_minted_place.py:56 assert isinstance(within[\"clues\"], int) and isinstance(within[\"exits\"], list) and within[\"material\"] == \"ready\"");
assert.ok(pyBool(pyLessEqual((await pyInvoke(pyLen,[(await pyMethod((await pyMethod(json,"dumps",[within],{"ensure_ascii":false})),"encode",[],{}))],{})),2048)),"tests/kernel/test_minted_place.py:57 assert len(json.dumps(within, ensure_ascii=False).encode()) <= 2048");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[workspace],{})),"world.json")],{})),"table_entities"),0),"within"),MORGUE)),"tests/kernel/test_minted_place.py:58 assert read_json(campaign_dir(workspace) / \"world.json\")[\"table_entities\"][0][\"within\"] == MORGUE");
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"npc",["name"]:"ruth-blake",["to"]:"here"})]}));
seated=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const person of pyIterable(pyAt(pyAt(pyAt((await pyMethod(client,"table",["capsule"],{})),"where"),"within"),"people"))){__rows.push([pyAt(person,"name"),pyAt(person,"seated")]);}return __rows;})()));
assert.ok(pyBool(pyEqual(seated,({["arty-wilmot"]:false,["ruth-blake"]:true}))),"tests/kernel/test_minted_place.py:62 assert seated == {\"arty-wilmot\": False, \"ruth-blake\": True}");
(await pyInvoke(narrate,[client,"t1-c3","Ruth follows you onto the stair."],{}));}finally{await client.close();}
client=(new RpcClient(workspace,({"fresh":true})));try{(await pyMethod(client,"table",["open"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(client,"table",["capsule"],{})),"where"),"within"),"name"),MORGUE)),"tests/kernel/test_minted_place.py:66 assert client.table(\"capsule\")[\"where\"][\"within\"][\"name\"] == MORGUE");}finally{await client.close();}
}
Object.defineProperty(test_within_writes_located_in_and_the_capsule_shows_the_book_place,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_within_writes_located_in_and_the_capsule_shows_the_book_place"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_within_writes_located_in_and_the_capsule_shows_the_book_place(temporary);});
export async function test_within_accepts_registered_table_places_but_never_people_or_unknowns(tmp_path:any){
let client:any,within:any,error:any;
client=(new RpcClient(pyDivide(tmp_path,"ws")));try{(await pyInvoke(open_turn,[client],{}));
for(within of pyIterable(["ruth-blake","nowhere-at-all",""])){
error=(await pyMethod(client,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:LOBBY,["via"]:"Round the back",["establish"]:({["summary"]:"A stair.",["within"]:within})})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"reason"),"within_not_a_place"):__left;})())),pyStr(within));
}
assert.ok(pyBool(!pyBool((await pyMethod((await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"world.json")],{})),"get",["table_entities"],{})))),"tests/kernel/test_minted_place.py:76 assert not read_json(campaign_dir(client.workspace) / \"world.json\").get(\"table_entities\")");
(await pyInvoke(mint,[client,"t1-c2"],{}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"move",["to"]:"A landing on the stair",["via"]:"Up",["establish"]:({["summary"]:"A landing.",["within"]:LOBBY})})]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(client,"table",["capsule"],{})),"where"),"within"),"name"),LOBBY)),"tests/kernel/test_minted_place.py:81 assert client.table(\"capsule\")[\"where\"][\"within\"][\"name\"] == LOBBY");}finally{await client.close();}
}
Object.defineProperty(test_within_accepts_registered_table_places_but_never_people_or_unknowns,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_within_accepts_registered_table_places_but_never_people_or_unknowns"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_within_accepts_registered_table_places_but_never_people_or_unknowns(temporary);});
export async function presence_offers(options:any){
return (await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(options,"candidates"))){if(pyBool(pyEqual(pyAt(pyAt(c,"description"),"kind"),"source_presence"))){__rows.push([pyAt(pyAt(c,"effect"),"name"),pyAt(pyAt(c,"effect"),"to")]);}}return __rows;})());
}
Object.defineProperty(presence_offers,"__pySignature",{value:[{"name":"options","rest":false,"varargs":false}]});
export async function unseat(workspace:any,handle:any){
let path:any,world:any;

path=pyDivide((await pyInvoke(campaign_dir,[workspace],{})),"world.json");
world=(await pyInvoke(read_json,[path],{}));
delete pyAt(world,"npc_presence")[handle];
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[world],{"ensure_ascii":false,"indent":2}))],{}));
}
Object.defineProperty(unseat,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false},{"name":"handle","rest":false,"varargs":false}]});
export async function test_the_within_place_offers_its_unseated_people_and_the_ledger_wins(tmp_path:any){
let workspace:any,client:any,offers:any,offer:any;
workspace=pyDivide(tmp_path,"ws");
client=(new RpcClient(workspace));try{(await pyInvoke(open_turn,[client,"I slip round to the back of the newspaper building."],{}));
(await pyInvoke(mint,[client,"t1-c1"],{"within":MORGUE}));
assert.ok(pyBool(pyEqual((await pyInvoke(presence_offers,[(await pyMethod(client,"table",["apply.options"],{}))],{})),[])),"tests/kernel/test_minted_place.py:102 assert presence_offers(client.table(\"apply.options\")) == []");
(await pyInvoke(narrate,[client,"t1-c2","You find the back stair."],{}));}finally{await client.close();}
(await pyInvoke(unseat,[workspace,"arty-wilmot"],{}));
client=(new RpcClient(workspace,({"fresh":true})));try{(await pyMethod(client,"table",["open"],{}));
(await pyMethod(client,"table",["player_input"],{"text":"I listen at the stair."}));
offers=(await pyMethod(client,"table",["apply.options"],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(presence_offers,[offers],{})),[["arty-wilmot",MORGUE]])),pyStr("the within place's book person is offered where the book puts him"));
offer=(await pyNext((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(offers,"candidates"))){if(pyBool(pyEqual(pyAt(pyAt(c,"description"),"kind"),"source_presence"))){__rows.push(c);}}return __rows;})())));
assert.ok(pyBool((pyAt(pyAt(offer,"description"),"within")===true)),"tests/kernel/test_minted_place.py:111 assert offer[\"description\"][\"within\"] is True");
assert.ok(pyBool(pyEqual(pyAt(pyAt(offer,"description"),"authority"),"authored_initial_presence_not_a_new_arrival")),"tests/kernel/test_minted_place.py:112 assert offer[\"description\"][\"authority\"] == \"authored_initial_presence_not_a_new_arrival\"");
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"npc",["name"]:"ruth-blake",["to"]:"away"})]}));
offers=(await pyMethod(client,"table",["apply.options"],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(presence_offers,[offers],{})),[["arty-wilmot",MORGUE]])),"tests/kernel/test_minted_place.py:116 assert presence_offers(offers) == [(\"arty-wilmot\", MORGUE)]");
assert.ok(pyBool(pyEqual(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(offers,"source_presence_excluded"))){__rows.push([pyAt(row,"name"),pyAt(row,"reason")]);}return __rows;})())),({["ruth-blake"]:"moved"}))),"tests/kernel/test_minted_place.py:117 assert {row[\"name\"]: row[\"reason\"] for row in offers[\"source_presence_excluded\"]} == {\"ruth-blake\": \"moved\"}");
assert.ok(pyBool((await pyMethod(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(offers,"source_presence_excluded"))){if(pyBool(pyEqual(pyAt(row,"name"),"ruth-blake"))){__rows.push(row);}}return __rows;})()))),"receipt"),"startswith",["npc:"],{}))),"tests/kernel/test_minted_place.py:118 assert next(row for row in offers[\"source_presence_excluded\"] if row[\"name\"] == \"ruth-blake\")[\"receipt\"].startswith(\"npc:\")");}finally{await client.close();}
}
Object.defineProperty(test_the_within_place_offers_its_unseated_people_and_the_ledger_wins,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_within_place_offers_its_unseated_people_and_the_ledger_wins"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_within_place_offers_its_unseated_people_and_the_ledger_wins(temporary);});
export async function test_a_dead_person_is_never_offered_by_the_book_again(tmp_path:any){
let workspace:any,client:any,ledger:any,offers:any;
workspace=pyDivide(tmp_path,"ws");
client=(new RpcClient(workspace));try{(await pyInvoke(open_turn,[client,"I slip round to the back of the newspaper building."],{}));
(await pyInvoke(mint,[client,"t1-c1"],{"within":MORGUE}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"npc",["name"]:"arty-wilmot",["dead"]:true})]}));
(await pyInvoke(narrate,[client,"t1-c3","Arty does not get up again."],{}));}finally{await client.close();}
ledger=(await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[workspace],{})),"npc-ledger.json")],{}));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable((await pyMethod(ledger,"values",[],{})))){__rows.push((await pyInvoke(pyIsInstance,[(await pyMethod(entry,"get",["dead"],{})),pyDict],{})));}return __rows;})())))),"tests/kernel/test_minted_place.py:130 assert any(isinstance(entry.get(\"dead\"), dict) for entry in ledger.values())");
(await pyInvoke(unseat,[workspace,"arty-wilmot"],{}));
client=(new RpcClient(workspace,({"fresh":true})));try{(await pyMethod(client,"table",["open"],{}));
(await pyMethod(client,"table",["player_input"],{"text":"I look around the stair."}));
offers=(await pyMethod(client,"table",["apply.options"],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(presence_offers,[offers],{})),[])),"tests/kernel/test_minted_place.py:136 assert presence_offers(offers) == []");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(offers,"source_presence_excluded"))){__rows.push([pyAt(row,"name"),pyAt(row,"reason")]);}return __rows;})()),[["arty-wilmot","dead"]])),"tests/kernel/test_minted_place.py:137 assert [(row[\"name\"], row[\"reason\"]) for row in offers[\"source_presence_excluded\"]] == [(\"arty-wilmot\", \"dead\")]");}finally{await client.close();}
}
Object.defineProperty(test_a_dead_person_is_never_offered_by_the_book_again,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_dead_person_is_never_offered_by_the_book_again"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_dead_person_is_never_offered_by_the_book_again(temporary);});

export let FIXTURE:any=pyDivide((await pyInvoke(Path,[__file__],{})).parent,"fixtures/legacy-module");
export let MID:any="grey-heron-dock";
export async function long_book(workspace:any){
let target:any,meta:any,graph:any,template:any,far:any,quay:any,graph_path:any,manifest:any;

target=pyDivide(pyDivide(workspace,".coc/modules"),MID);
(await pyMethod(target.parent,"mkdir",[],{"parents":true,"exist_ok":true}));
(await pyMethod(shutil,"copytree",[FIXTURE,target],{}));
meta=(await pyInvoke(read_json,[pyDivide(target,"module.json")],{}));
meta["page_count"]=200;
(await pyMethod(meta,"setdefault",["source_document",({})],{}))["outline"]=[({["name"]:"Front",["page"]:1}),({["name"]:"Dock",["page"]:2}),({["name"]:"Town",["page"]:50}),({["name"]:"Far",["page"]:150})];
(await pyMethod((pyDivide(target,"module.json")),"write_text",[(await pyMethod(json,"dumps",[meta],{"ensure_ascii":false,"indent":2}))],{}));
graph=(await pyInvoke(read_json,[pyDivide(target,"module-graph.json")],{}));
template=(await pyNext((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(graph,"nodes"))){if(pyBool(pyEqual(pyAt(node,"node_id"),"npc-lao-zhou"))){__rows.push(node);}}return __rows;})())));
async function person(node_id:any,name:any,page:any){
let node:any;
node=(await pyMethod(copy,"deepcopy",[template],{}));
(await pyMethod(node,"update",[],{"node_id":node_id,"name":name,"aliases":[],"summary":pyMultiply(`${name} keeps a long and particular account of the river trade `,2)}));
node["properties"]=({...(await pyMethod(node,"get",["properties",({})],{})),["name"]:name});
node["source_refs"]=[({["source_id"]:`pdf:${MID}`,["pdf_index"]:pySubtract(page,1),["grep_anchor"]:name})];
return node;
}
Object.defineProperty(person,"__pySignature",{value:[{"name":"node_id","rest":false,"varargs":false},{"name":"name","rest":false,"varargs":false},{"name":"page","rest":false,"varargs":false}]});
far=(await (async()=>{const __rows:any[]=[];for(const i of pyIterable((await pyInvoke(pyRange,[120],{})))){__rows.push((await pyInvoke(person,[`npc-far-${pyFormat(i,"02d")}`,`Far Person Of The Lower River Wharves ${pyFormat(i,"03d")}`,170],{})));}return __rows;})());
quay=({["node_id"]:"location-far-quay",["node_kind"]:"location",["name"]:"Far Quay",["aliases"]:[],["summary"]:"A quay far downriver.",["visibility"]:"keeper-only",["properties"]:({["name"]:"Far Quay"}),["source_refs"]:[({["source_id"]:`pdf:${MID}`,["pdf_index"]:159,["grep_anchor"]:"Far Quay"})]});
graph["nodes"]=pyAdd(pyAdd(far,pyAt(graph,"nodes")),[(await pyInvoke(person,["npc-town-clerk","Town Clerk",60],{})),quay]);
graph_path=pyDivide(target,"module-graph.json");
(await pyMethod(graph_path,"write_text",[(await pyMethod(json,"dumps",[graph],{}))],{"encoding":"utf-8"}));
manifest=(await pyInvoke(read_json,[pyDivide(target,"module-graph-manifest.json")],{}));
manifest["graph_content_digest"]=(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod((await pyMethod(json,"dumps",[graph],{"sort_keys":true,"separators":[",",":"],"ensure_ascii":false})),"encode",[],{}))],{})),"hexdigest",[],{}));
manifest["node_count"]=(await pyInvoke(pyLen,[pyAt(graph,"nodes")],{}));
pyAt(manifest,"node_kinds")["npc"]=(await pySum((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(graph,"nodes"))){if(pyBool(pyEqual(pyAt(node,"node_kind"),"npc"))){__rows.push(1);}}return __rows;})())));
(await pyMethod((pyDivide(target,"module-graph-manifest.json")),"write_text",[(await pyMethod(json,"dumps",[manifest],{}))],{"encoding":"utf-8"}));
meta["graph_digest"]=(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod(graph_path,"read_bytes",[],{}))],{})),"hexdigest",[],{}));
(await pyMethod((pyDivide(target,"module.json")),"write_text",[(await pyMethod(json,"dumps",[meta],{"ensure_ascii":false,"indent":2}))],{}));
return target;
}
Object.defineProperty(long_book,"__pySignature",{value:[{"name":"workspace","rest":false,"varargs":false}]});
export async function test_brief_lists_the_window_first_and_says_how_much_it_cut(tmp_path:any){
let client:any,capsule:any,brief:any,people:any;
client=(new RpcClient(pyDivide(tmp_path,"ws")));try{(await pyInvoke(long_book,[client.workspace],{}));
(await pyMethod(client,"ok",["campaign.create",({["id"]:"c1",["module"]:MID,["play_language"]:"en"})],{}));
(await pyInvoke(confirmed_investigator,[client],{}));
(await pyMethod(client,"ok",["setup.complete",({["campaign"]:"c1"})],{}));
(await pyMethod(client,"table",["open"],{}));
capsule=(await pyMethod(client,"table",["capsule"],{"rehydrate":true}));
brief=pyAt(capsule,"module");
people=(await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(pyAt(brief,"people"))){__rows.push(pyAt(entry,"name"));}return __rows;})());
assert.ok(pyBool(pyEqual(pySlice(people,undefined,2),["老周","Town Clerk"])),pyStr(people));
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(brief,"more"),"people");const __term1=pySubtract(122,(await pyInvoke(pyLen,[people],{})));const __term2=0;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,">");})())),"tests/kernel/test_minted_place.py:193 assert brief[\"more\"][\"people\"] == 122 - len(people) > 0");
assert.ok(pyBool(pyEqual(pyAt(pyAt(capsule,"_context"),"brief_window"),({["first"]:2,["last"]:149,["chapters"]:["Dock","Town"]}))),"tests/kernel/test_minted_place.py:194 assert capsule[\"_context\"][\"brief_window\"] == {\"first\": 2, \"last\": 149, \"chapters\": [\"Dock\", \"Town\"]}");
(await pyMethod(client,"table",["player_input"],{"text":"I take a boat downriver to a shed on the far quay."}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"A net shed",["via"]:"By boat downriver",["establish"]:({["summary"]:"A tarred net shed on the quay.",["within"]:"Far Quay"})})]}));
capsule=(await pyMethod(client,"table",["capsule"],{"rehydrate":true}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(capsule,"_context"),"brief_window"),({["first"]:150,["last"]:200,["chapters"]:["Far"]}))),"tests/kernel/test_minted_place.py:200 assert capsule[\"_context\"][\"brief_window\"] == {\"first\": 150, \"last\": 200, \"chapters\": [\"Far\"]}");
assert.ok(pyBool((await pyMethod(pyAt(pyAt(pyAt(pyAt(capsule,"module"),"people"),0),"name"),"startswith",["Far Person"],{}))),pyStr("the far chapter's people now come first"));}finally{await client.close();}
}
Object.defineProperty(test_brief_lists_the_window_first_and_says_how_much_it_cut,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_brief_lists_the_window_first_and_says_how_much_it_cut"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_brief_lists_the_window_first_and_says_how_much_it_cut(temporary);});
export async function test_a_book_without_a_window_keeps_graph_order_and_says_nothing_cut(tmp_path:any){
let client:any,capsule:any;
client=(new RpcClient(pyDivide(tmp_path,"ws")));try{(await pyInvoke(open_turn,[client],{}));
capsule=(await pyMethod(client,"table",["capsule"],{"rehydrate":true}));
assert.ok(pyBool((pyAt(pyAt(capsule,"_context"),"brief_window")===null)),"tests/kernel/test_minted_place.py:208 assert capsule[\"_context\"][\"brief_window\"] is None");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(pyAt(capsule,"module"),"more");return pyBool(__left)?__left:pyLessEqual(0,pyAt(pyAt(pyAt(capsule,"module"),"more"),"people"));})())),"tests/kernel/test_minted_place.py:209 assert \"more\" not in capsule[\"module\"] or capsule[\"module\"][\"more\"][\"people\"] >= 0");}finally{await client.close();}
}
Object.defineProperty(test_a_book_without_a_window_keeps_graph_order_and_says_nothing_cut,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_book_without_a_window_keeps_graph_order_and_says_nothing_cut"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_book_without_a_window_keeps_graph_order_and_says_nothing_cut(temporary);});
export async function test_placement_candidates_include_active_table_context_but_no_unrelated_mints(tmp_path:any){
let client:any,before:any,sources:any,after:any,own:any,detached:any;

client=(new RpcClient(pyDivide(tmp_path,"ws")));try{(await pyInvoke(open_turn,[client,"I slip round to the back of the newspaper building."],{}));
before=(await pyMethod(client,"table",["apply.placement"],{}));
sources=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(before,"candidates"))){__rows.push([pyAt(row,"name"),pyAt(row,"source")]);}return __rows;})()));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(sources,ORIGIN),"here");return pyBool(__left)?pyEqual(pyAt(sources,MORGUE),"exit"):__left;})());return pyBool(__left)?(pyAt(before,"window")===null):__left;})())),"tests/kernel/test_minted_place.py:218 assert sources[ORIGIN] == \"here\" and sources[MORGUE] == \"exit\" and before[\"window\"] is None");
assert.ok(pyBool(pyEqual(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(before,"candidates"))){if(pyBool(pyEqual(pyAt(row,"name"),MORGUE))){__rows.push(row);}}return __rows;})()))),"display_name"),"Boston Globe offices")),"tests/kernel/test_minted_place.py:219 assert next(row for row in before[\"candidates\"] if row[\"name\"] == MORGUE)[\"display_name\"] == \"Boston Globe offices\"");
(await pyInvoke(mint,[client,"t1-c1"],{}));
after=(await pyMethod(client,"table",["apply.placement"],{"limit":4}));
own=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(after,"candidates"))){if(pyBool(pyEqual(pyAt(row,"name"),LOBBY))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(own,"table_place")===true);return pyBool(__left)?pyEqual(pyAt(own,"source"),"here"):__left;})())),pyStr("table-origin context is eligible for inside only"));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(after,"scene"),"name"),LOBBY);return pyBool(__left)?pyEqual((await pyInvoke(pyLen,[pyAt(after,"candidates")],{})),4):__left;})())),"tests/kernel/test_minted_place.py:224 assert after[\"scene\"][\"name\"] == LOBBY and len(after[\"candidates\"]) == 4");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(client,"table_err",["apply.placement"],{"limit":0})),"code"),"invalid_params")),"tests/kernel/test_minted_place.py:225 assert client.table_err(\"apply.placement\", limit=0)[\"code\"] == \"invalid_params\"");
(await pyInvoke(mint,[client,"t1-c2"],{"within":null,"to":"A detached outbuilding"}));
detached=(await pyMethod(client,"table",["apply.placement"],{"limit":4}));
assert.ok(pyBool(!pyContains((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(detached,"candidates"))){__rows.push(pyAt(row,"name"));}return __rows;})()),LOBBY)),pyStr("an unrelated table place is excluded"));}finally{await client.close();}
}
Object.defineProperty(test_placement_candidates_include_active_table_context_but_no_unrelated_mints,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_placement_candidates_include_active_table_context_but_no_unrelated_mints"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_placement_candidates_include_active_table_context_but_no_unrelated_mints(temporary);});
