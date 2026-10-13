// Migrated from tests/kernel/test_npc_produce.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CONTENT_DIR,RpcClient,campaign_dir,narrate,open_turn,read_json,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";




export let KNOTT:any="steven-knott";
export let PHOTO:any="一张泛黄的全家福";
export let ACT:any="诺特从上衣内袋摸出一张泛黄的全家福，攥在手里给你看。";
export let EQUIPMENT:any=pyAt((await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(pyDivide(pyDivide(CONTENT_DIR,"rulesets"),"coc7"),"rules-json"),"equipment.json")),"read_text",[],{"encoding":"utf-8"}))],{})),"records");
export let UMBRELLA:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(EQUIPMENT)){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"era"),"1920s");return pyBool(__left)?pyEqual(pyAt(row,"name"),"Umbrella"):__left})()))){__rows.push(row);}}return __rows;})())));
export let DERRINGER:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(EQUIPMENT)){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"era"),"1920s");return pyBool(__left)?pyEqual((await pyMethod(((await (async()=>{const __left=(await pyMethod(row,"get",["entity_ref"],{}));return pyBool(__left)?__left:({})})())),"get",["entity_id"],{})),"automatic_25_derringer"):__left})()))){__rows.push(row);}}return __rows;})())));
export async function landed(client:any,result:any){
let ids:any;

ids=(await pySet(pyAt(result,"receipts")));
return (await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool(pyContains(ids,pyAt(r,"id")))){__rows.push(r);}}return __rows;})());
}
export async function produce(client:any,call_id:any,carried:any={}){
return (await landed(client,(await pyMethod(client,"table",["apply"],{"call_id":call_id,"effects":[({["kind"]:"npc",["name"]:"Steven Knott",["_produces"]:carried})]}))));
}
export async function holdings(client:any){
return pyAt(pyAt((await pyMethod(client,"ok",["npc.situation",({["campaign"]:"c1",["name"]:"Steven Knott"})],{})),"at_hand"),"holdings");
}
export async function world(client:any){
return (await read_json(pyDivide((await campaign_dir(client.workspace)),"world.json")));
}
export async function instances_of(client:any,handle:any=KNOTT){
return (await (async()=>{const __rows:any[]=[];for(const item of pyIterable((await pyMethod((await pyMethod((await pyMethod((await world(client)),"get",["objects",({})],{})),"get",["instances",({})],{})),"values",[],{})))){if(pyBool(pyEqual(pyAt(item,"owner"),({["kind"]:"npc",["id"]:handle,["name"]:"Steven Knott"})))){__rows.push(item);}}return __rows;})());
}
export async function test_a_thing_of_the_tables_own_and_one_the_book_prices_are_his_from_the_next_turn(tmp_path:any){
let client:any,table:any,own:any,book:any,priced:any,drawn:any,pistol:any,held:any,items:any,definitions:any,name:any,description:any,definition:any,taken:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"1"})})));
try{(await open_turn(client,"I tell Knott I will not take the job."));
assert.ok(pyBool(pyEqual((await holdings(client)),[])),pyStr("the starter gives him nothing to hold"));
table=(await produce(client,"t1-c1",({"name":PHOTO,"description":ACT})));
const __unpack2686=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(table)){if(pyBool((await pyMethod(r,"get",["produced"],{})))){__rows.push(r);}}return __rows;})());own=__unpack2686[0];
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(own,"produced"),({["name"]:PHOTO,["source"]:"table"}));return pyBool(__left)?pyEqual(pyAt(own,"kind"),"npc"):__left})());return pyBool(__left)?pyEqual(pyAt(own,"visibility"),"keeper"):__left})())),"tests/kernel/test_npc_produce.py:55 assert own[\"produced\"] == {\"name\": PHOTO, \"source\": \"table\"} and own[\"kind\"] == \"npc\" and own[\"visibility\"] == \"keeper\"");
book=(await produce(client,"t1-c2",({"price_id":pyAt(UMBRELLA,"price_id"),"description":"诺特抄起门边的雨伞。"})));
const __unpack2967=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(book)){if(pyBool((await pyMethod(r,"get",["produced"],{})))){__rows.push(r);}}return __rows;})());priced=__unpack2967[0];
assert.ok(pyBool(pyEqual(pyAt(priced,"produced"),({["name"]:"Umbrella",["source"]:"catalog",["record"]:pyAt(UMBRELLA,"price_id")}))),pyStr("named as the book names it"));
drawn=(await landed(client,(await pyMethod(client,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["_draws"]:({["weapon"]:"automatic_25_derringer",["price_id"]:pyAt(DERRINGER,"price_id")})})]}))));
const __unpack3439=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(drawn)){if(pyBool((await pyMethod(r,"get",["draws"],{})))){__rows.push(r);}}return __rows;})());pistol=__unpack3439[0];
assert.ok(pyBool(pyEqual(pyAt(pistol,"produced"),({["name"]:pyAt(DERRINGER,"name"),["source"]:"catalog",["record"]:pyAt(DERRINGER,"price_id")}))),"tests/kernel/test_npc_produce.py:62 assert pistol[\"produced\"] == {\"name\": DERRINGER[\"name\"], \"source\": \"catalog\", \"record\": DERRINGER[\"price_id\"]}");
(await narrate(client,"t1-c4","诺特攥着一张旧照片，另一只手摸到了雨伞。"));
(await pyMethod(client,"table",["player_input"],{"text":"I look at what he is holding."}));
held=(await holdings(client));
assert.ok(pyBool((await (async()=>{const __left=pyContains(held,PHOTO);return pyBool(__left)?pyContains(held,"Umbrella"):__left})())),pyStr(held));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const name of pyIterable(held)){__rows.push(pyContains(name,"Derringer"));}return __rows;})())))),pyStr(`a drawn weapon is his with no stat block too: ${held}`));
items=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const item of pyIterable((await instances_of(client)))){__rows.push([pyAt(item,"name"),item]);}return __rows;})()));
assert.ok(pyBool(pyEqual((await pySet(items)),new Set([PHOTO,"Umbrella"]))),"tests/kernel/test_npc_produce.py:72 assert set(items) == {PHOTO, \"Umbrella\"}");
definitions=pyAt(pyAt((await world(client)),"objects"),"definitions");
for([name,description] of pyIterable([[PHOTO,ACT],["Umbrella","诺特抄起门边的雨伞。"]])){
definition=pyAt(definitions,pyAt(pyAt(items,name),"definition"));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(definition,"category"),"item");return pyBool(__left)?pyEqual(pyAt(definition,"parameters"),({["effects"]:[]})):__left})());return pyBool(__left)?pyEqual(pyAt(definition,"traits"),[]):__left})())),"tests/kernel/test_npc_produce.py:76 assert definition[\"category\"] == \"item\" and definition[\"parameters\"] == {\"effects\": []} and definition[\"traits\"] == []");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(definition,"description"),description);return pyBool(__left)?pyEqual(pyAt(definition,"player_view"),({["description"]:description,["fields"]:[]})):__left})())),"tests/kernel/test_npc_produce.py:77 assert definition[\"description\"] == description and definition[\"player_view\"] == {\"description\": description, \"fields\": []}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(items,name),"state"),({["ammo"]:null,["charges"]:null,["condition"]:"intact"}))),pyStr("no number anywhere"));
}
assert.ok(pyBool(pyContains(pyAt(pyAt(definitions,pyAt(pyAt(items,"Umbrella"),"definition")),"basis"),pyAt(UMBRELLA,"price_id"))),pyStr("the book's record is the basis"));
taken=(await landed(client,(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"object",["name"]:PHOTO,["from"]:"Steven Knott",["to"]:"Thomas Hayes",["handover"]:"taken",["why"]:"I snatch the photograph"})]}))));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(taken)){__rows.push((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"item");return pyBool(__left)?pyEqual(pyAt(r,"name"),PHOTO):__left})()));}return __rows;})())))),pyStr(taken));
assert.ok(pyBool(!pyContains((await holdings(client)),PHOTO)),"tests/kernel/test_npc_produce.py:85 assert PHOTO not in holdings(client)");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_thing_of_the_tables_own_and_one_the_book_prices_are_his_from_the_next_turn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_thing_of_the_tables_own_and_one_the_book_prices_are_his_from_the_next_turn(temporary);});
export async function test_the_same_thing_again_is_not_a_second_one_and_a_name_someone_else_holds_stays_theirs(tmp_path:any){
let client:any,again:any,receipt:any,third:any,other:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"1"})})));
try{(await open_turn(client,"I tell Knott I will not take the job."));
(await produce(client,"t1-c1",({"name":PHOTO,"description":ACT})));
again=(await produce(client,"t1-c2",({"name":PHOTO,"description":ACT})));
const __unpack5797=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(again)){if(pyBool((await pyMethod(r,"get",["produced"],{})))){__rows.push(r);}}return __rows;})());receipt=__unpack5797[0];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(receipt,"produced"),"name"),PHOTO);return pyBool(__left)?pyEqual((await pyLen((await instances_of(client)))),1):__left})())),pyStr("shown again, not duplicated"));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"object",["name"]:PHOTO,["from"]:"Steven Knott",["to"]:"Thomas Hayes",["handover"]:"taken",["why"]:"I snatch it"})]}));
third=(await produce(client,"t1-c4",({"name":PHOTO,"description":ACT})));
const __unpack6284=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(third)){if(pyBool((await pyMethod(r,"get",["produced"],{})))){__rows.push(r);}}return __rows;})());other=__unpack6284[0];
assert.ok(pyBool(pyEqual(pyAt(pyAt(other,"produced"),"name"),`${PHOTO} (${pyAt(other,"label")})`)),pyStr(pyAt(other,"produced")));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const item of pyIterable((await instances_of(client)))){__rows.push(pyAt(item,"name"));}return __rows;})()),[pyAt(pyAt(other,"produced"),"name")])),pyStr("his is told apart; the investigator's keeps its name"));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_same_thing_again_is_not_a_second_one_and_a_name_someone_else_holds_stays_theirs"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_same_thing_again_is_not_a_second_one_and_a_name_someone_else_holds_stays_theirs(temporary);});
export async function test_what_the_kernel_refuses(tmp_path:any){
let client:any,refused:any,n:any,label:any,carried:any,error:any,wrong:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"1"})})));
try{(await open_turn(client,"I tell Knott I will not take the job."));
refused=({["no such record"]:({["price_id"]:"eq.1920s.nothing.here",["description"]:ACT}),["a weapon record is drawn, not produced"]:({["price_id"]:pyAt(DERRINGER,"price_id"),["description"]:ACT}),["a name and a record at once"]:({["price_id"]:pyAt(UMBRELLA,"price_id"),["name"]:PHOTO,["description"]:ACT}),["neither"]:({["description"]:ACT}),["no description"]:({["name"]:PHOTO}),["a name on two lines"]:({["name"]:`${PHOTO}\n另一张`,["description"]:ACT}),["an unknown key"]:({["name"]:PHOTO,["description"]:ACT,["damage"]:"1D6"})});
for([n,[label,carried]] of pyIterable((await pyEnumerate((await pyMethod(refused,"items",[],{})),({"start":1}))))){
error=(await pyMethod(client,"err",["table.apply",({["campaign"]:"c1",["call_id"]:`t1-c${n}`,["effects"]:[({["kind"]:"npc",["name"]:"Steven Knott",["_produces"]:carried})]})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),pyStr([label,error]));
}
error=(await pyMethod(client,"err",["table.apply",({["campaign"]:"c1",["call_id"]:"t1-c20",["effects"]:[({["kind"]:"npc",["name"]:"Steven Knott",["stance"]:"hostile",["_produces"]:({["name"]:PHOTO,["description"]:ACT})})]})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),pyStr("what is brought out is its own effect"));
wrong=(await pyMethod(client,"err",["table.apply",({["campaign"]:"c1",["call_id"]:"t1-c21",["effects"]:[({["kind"]:"npc",["name"]:"Steven Knott",["_draws"]:({["weapon"]:"automatic_25_derringer",["price_id"]:pyAt(UMBRELLA,"price_id")})})]})],{}));
assert.ok(pyBool(pyEqual(pyAt(wrong,"code"),"invalid_params")),pyStr("a drawn weapon's record is that weapon's"));
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await instances_of(client)),[]);return pyBool(__left)?!pyContains((await world(client)),"npc_weapons"):__left})())),pyStr("nothing landed"));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_what_the_kernel_refuses"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_what_the_kernel_refuses(temporary);});
export async function situation(client:any,name:any="Steven Knott"){
return (await pyMethod(client,"ok",["npc.situation",({["campaign"]:"c1",["name"]:name})],{}));
}
export async function close_turn(client:any,turn:any,text:any){
let first:any;

first=(await pyMethod(client,"call",["table.narrate",({["campaign"]:"c1",["call_id"]:`t${turn}-c90`,["text"]:text})],{}));
if(pyBool(!pyBool(pyAt(first,"ok")))){(await narrate(client,`t${turn}-c91`,text));}
}
export async function test_what_his_own_act_brought_out_says_when_and_by_which_act(tmp_path:any){
let client:any,opened:any,ref:any,item:any,weapon:any,view:any,held:any,pistol:any;

client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"1"})})));
try{(await open_turn(client,"I grab Knott by the collar."));
assert.ok(pyBool(!pyContains(pyAt((await situation(client)),"at_hand"),"brought_out")),pyStr("nothing brought out yet: no section"));
opened=(await landed(client,(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["intends"]:ACT,["outcome"]:"attempted",["_generated"]:true})]}))));
ref=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(opened)){if(pyBool((await pyMethod(r,"get",["intent"],{})))){__rows.push(pyAt(pyAt(r,"intent"),"ref"));}}return __rows;})())));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["intent_ref"]:ref,["intent_outcome"]:"attempted",["_produces"]:({["name"]:PHOTO,["description"]:ACT})})]}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["_draws"]:({["weapon"]:"automatic_25_derringer",["price_id"]:pyAt(DERRINGER,"price_id")})})]}));
const __unpack10833=(await (async()=>{const __rows:any[]=[];for(const item of pyIterable((await instances_of(client)))){if(pyBool(pyEqual(pyAt(item,"name"),PHOTO))){__rows.push(item);}}return __rows;})());item=__unpack10833[0];
assert.ok(pyBool(pyEqual(pyAt(item,"brought_out"),({["by"]:KNOTT,["turn"]:1,["ref"]:ref}))),pyStr(item));
const __unpack10996=pyAt(pyAt((await world(client)),"npc_weapons"),KNOTT);weapon=__unpack10996[0];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(weapon,"turn"),1);return pyBool(__left)?!pyContains(weapon,"ref"):__left})())),pyStr(weapon));
(await close_turn(client,1,"诺特攥着一张旧照片，另一只手摸到了抽屉里的东西。"));
(await pyMethod(client,"table",["player_input"],{"text":"I tell him to put it away."}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["intent_ref"]:ref,["intent_outcome"]:"abandoned",["why"]:"海斯没看那张照片"})]}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c2","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["_produces"]:({["name"]:PHOTO,["description"]:ACT})})]}));
view=(await situation(client));
held=pyAt(pyAt(view,"at_hand"),"holdings");
pistol=(await pyNext((await (async()=>{const __rows:any[]=[];for(const name of pyIterable(held)){if(pyBool(pyContains(name,"Derringer"))){__rows.push(name);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(pyAt(view,"at_hand"),"brought_out"),[({["name"]:PHOTO,["turn"]:1,["ref"]:ref,["status"]:"abandoned"}),({["name"]:pistol,["turn"]:1})])),pyStr(pyAt(view,"at_hand")));
assert.ok(pyBool(pyLessEqual(new Set((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(pyAt(pyAt(view,"at_hand"),"brought_out"))){__rows.push(pyAt(entry,"name"));}return __rows;})())),(await pySet(held)))),pyStr("every entry is a thing he holds, by the name holdings gives it"));
assert.ok(pyBool(pyEqual(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(view,"done"))){if(pyBool(pyEqual(pyAt(row,"ref"),ref))){__rows.push(row);}}return __rows;})()))),"status"),"abandoned")),pyStr("the status is the row's own"));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c3","effects":[({["kind"]:"object",["name"]:PHOTO,["from"]:"Steven Knott",["to"]:"Thomas Hayes",["handover"]:"taken",["why"]:"I snatch the photograph"})]}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(pyAt(pyAt((await situation(client)),"at_hand"),"brought_out"))){__rows.push(pyAt(entry,"name"));}return __rows;})()),[pistol])),"tests/kernel/test_npc_produce.py:185 assert [entry[\"name\"] for entry in situation(client)[\"at_hand\"][\"brought_out\"]] == [pistol]");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_what_his_own_act_brought_out_says_when_and_by_which_act"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_what_his_own_act_brought_out_says_when_and_by_which_act(temporary);});

export let SAW:any="一把油乎乎的电锯";
export let SAW_ACT:any="埃德娜从洗手间里拖出一把油乎乎的电锯，拉响了它。";
export async function edna_walks_on(client:any,call_id:any){

(await pyMethod(client,"table",["apply"],{"call_id":call_id,"effects":[({["kind"]:"npc",["name"]:"Edna Hale",["to"]:"here",["walk_on"]:true,["why"]:"test fixture: the landlord's clerk"})]}));
}
export async function test_what_anyone_at_the_table_brought_out_is_in_every_packet_newest_first_and_capped(tmp_path:any){
let client:any,view:any,pistol:any,listed:any;

client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"1"})})));
try{(await open_turn(client,"I tell Knott I will not take the job."));
assert.ok(pyBool(!pyContains((await situation(client)),"table_brought_out")),pyStr("nothing brought out yet: no section"));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["_draws"]:({["weapon"]:"automatic_25_derringer",["price_id"]:pyAt(DERRINGER,"price_id")})})]}));
(await edna_walks_on(client,"t1-c2"));
(await close_turn(client,1,"诺特的手搭在抽屉上，埃德娜推门进来。"));
(await pyMethod(client,"table",["player_input"],{"text":"I wrench the thing out of her hands."}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"npc",["name"]:"Edna Hale",["_produces"]:({["name"]:SAW,["description"]:SAW_ACT})})]}));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c2","effects":[({["kind"]:"object",["name"]:SAW,["from"]:"Edna Hale",["to"]:"Thomas Hayes",["handover"]:"taken",["why"]:"I wrench it away"})]}));
view=(await situation(client));
pistol=(await pyNext((await (async()=>{const __rows:any[]=[];for(const name of pyIterable(pyAt(pyAt(view,"at_hand"),"holdings"))){if(pyBool(pyContains(name,"Derringer"))){__rows.push(name);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(view,"table_brought_out"),[({["name"]:SAW,["by"]:"Edna Hale",["turn"]:2}),({["name"]:pistol,["by"]:"Steven Knott",["turn"]:1})])),pyStr((await pyMethod(view,"get",["table_brought_out"],{}))));
assert.ok(pyBool(!pyContains((await pyMethod(json,"dumps",[pyAt(view,"at_hand")],{"ensure_ascii":false})),SAW)),pyStr("not his and not at hand: hers, now the investigator's"));
assert.ok(pyBool(pyEqual(pyAt((await situation(client,"Edna Hale")),"table_brought_out"),pyAt(view,"table_brought_out"))),pyStr("one list for everyone at the table"));
(await pyMethod(client,"table",["apply"],{"call_id":"t2-c3","effects":(await (async()=>{const __rows:any[]=[];for(const n of pyIterable((await pyRange(1,13)))){__rows.push(({["kind"]:"npc",["name"]:"Edna Hale",["_produces"]:({["name"]:`thing ${pyFormat(n,"02d")}`,["description"]:SAW_ACT})}));}return __rows;})())}));
listed=pyAt((await situation(client)),"table_brought_out");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(listed)){__rows.push(pyAt(entry,"name"));}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const n of pyIterable((await pyRange(12,0,(-1))))){__rows.push(`thing ${pyFormat(n,"02d")}`);}return __rows;})()))),pyStr(listed));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_what_anyone_at_the_table_brought_out_is_in_every_packet_newest_first_and_capped"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_what_anyone_at_the_table_brought_out_is_in_every_packet_newest_first_and_capped(temporary);});
export let THING:any="a long and particular thing of hers, number {:02d}";
export async function _table_of_things(tmp_path:any,name:any,max_bytes:any){
let content:any,path:any,budgets:any,client:any;

content=pyDivide(pyDivide(tmp_path,name),"content");
(await pyMethod(shutil,"copytree",[CONTENT_DIR,content],{}));
path=pyDivide(pyDivide(pyDivide(content,"rulesets"),"coc7"),"host-budgets.json");
budgets=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))],{}));
pyAt(budgets,"npc_situation")["max_bytes"]=max_bytes;
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[budgets],{}))],{"encoding":"utf-8"}));
client=(new RpcClient(pyDivide(pyDivide(tmp_path,name),"ws"),({"env":({["COC_KERNEL_SEED"]:"1"}),"content":content})));
try{(await open_turn(client,"I look Knott over."));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["_produces"]:({["name"]:PHOTO,["description"]:ACT})})]}));
(await edna_walks_on(client,"t1-c2"));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c3","effects":(await (async()=>{const __rows:any[]=[];for(const n of pyIterable((await pyRange(1,13)))){__rows.push(({["kind"]:"npc",["name"]:"Edna Hale",["_produces"]:({["name"]:(await pyMethod(THING,"format",[n],{})),["description"]:SAW_ACT})}));}return __rows;})())}));
return (await situation(client));}finally{(await pyMethod(client,"close",[],{}));}
}
export async function _packet_bytes(packet:any){
return (await pyLen((await pyMethod((await pyMethod(json,"dumps",[packet],{"ensure_ascii":false})),"encode",["utf-8"],{}))));
}
export async function test_the_budget_cuts_what_the_table_brought_out_before_what_he_holds(tmp_path:any){
let whole:any,fits:any,at_hand_cut:any,packet:any,kept:any;

whole=(await _table_of_things(tmp_path,"whole",1_000_000));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(whole,"truncated"),[]);return pyBool(__left)?pyEqual((await pyLen(pyAt(whole,"table_brought_out"))),12):__left})())),pyStr(pyAt(whole,"truncated")));
assert.ok(pyBool(pyEqual(pyAt(pyAt(whole,"at_hand"),"holdings"),[PHOTO])),"tests/kernel/test_npc_produce.py:274 assert whole[\"at_hand\"][\"holdings\"] == [PHOTO]");
fits=(await pyMethod(json,"loads",[(await pyMethod(json,"dumps",[whole],{}))],{}));
at_hand_cut=(await pyBool((await (async()=>{const __left=pyAt(pyAt(fits,"at_hand"),"objects");return pyBool(__left)?__left:pyAt(pyAt(fits,"at_hand"),"exits")})())));
const __unpack18408=[[],[]];pyAt(fits,"at_hand")["objects"]=__unpack18408[0];pyAt(fits,"at_hand")["exits"]=__unpack18408[1];
fits["table_brought_out"]=pySlice(pyAt(fits,"table_brought_out"),undefined,6);
fits["truncated"]=pyAdd(((pyBool(at_hand_cut)?["at_hand"]:[])),["table_brought_out"]);
packet=(await _table_of_things(tmp_path,"budgeted",(await _packet_bytes(fits))));
assert.ok(pyBool(pyContains(pyAt(packet,"truncated"),"table_brought_out")),pyStr(pyAt(packet,"truncated")));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(packet,"at_hand"),"holdings"),[PHOTO]);return pyBool(__left)?pyEqual((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(pyAt(pyAt(packet,"at_hand"),"brought_out"))){__rows.push(pyAt(entry,"name"));}return __rows;})()),[PHOTO]):__left})())),pyStr("what he holds, and what his own act brought out, outlast the table's list"));
kept=(await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(pyAt(packet,"table_brought_out"))){__rows.push(pyAt(entry,"name"));}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __term0=0;const __term1=(await pyLen(kept));const __term2=12;return pyCompare(__term0,__term1,"<")&&pyCompare(__term1,__term2,"<");})());return pyBool(__left)?pyEqual(kept,(await (async()=>{const __rows:any[]=[];for(const n of pyIterable((await pyRange(12,pySubtract(12,(await pyLen(kept))),(-1))))){__rows.push((await pyMethod(THING,"format",[n],{})));}return __rows;})())):__left})())),pyStr("the oldest go first"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_budget_cuts_what_the_table_brought_out_before_what_he_holds"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_budget_cuts_what_the_table_brought_out_before_what_he_holds(temporary);});
