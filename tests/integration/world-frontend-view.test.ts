// Migrated from tests/kernel/test_frontend_view.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,CONTENT_DIR,MODULE,PREGEN,RpcClient,campaign_dir,create_campaign,open_turn,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_frontend_view.py',import.meta.url).pathname;






export async function test_sheet_is_read_only_and_hides_undiscovered_clues(kernel:any){
let client:any,root:any,before:any,first:any,second:any,after:any;
client=kernel;
(await pyInvoke(create_campaign,[client],{}));
root=(await pyInvoke(campaign_dir,[client.workspace],{}));
before=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const p of pyIterable((await pyMethod(root,"rglob",["*"],{})))){if(pyBool((await pyMethod(p,"is_file",[],{})))){__rows.push([(await pyInvoke(pyStr,[(await pyMethod(p,"relative_to",[root],{}))],{})),(await pyMethod(p,"read_bytes",[],{}))]);}}return __rows;})()));
first=(await pyMethod(client,"ok",["table.view",({["campaign"]:CAMPAIGN})],{}));
second=(await pyMethod(client,"ok",["table.view",({["campaign"]:CAMPAIGN})],{}));
after=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const p of pyIterable((await pyMethod(root,"rglob",["*"],{})))){if(pyBool((await pyMethod(p,"is_file",[],{})))){__rows.push([(await pyInvoke(pyStr,[(await pyMethod(p,"relative_to",[root],{}))],{})),(await pyMethod(p,"read_bytes",[],{}))]);}}return __rows;})()));
assert.ok(pyBool(pyEqual(first,second)),"tests/kernel/test_frontend_view.py:18 assert first == second");
assert.ok(pyBool(pyEqual(before,after)),"tests/kernel/test_frontend_view.py:19 assert before == after");
assert.ok(pyBool(pyAt(first,"investigators")),"tests/kernel/test_frontend_view.py:20 assert first['investigators']");
assert.ok(pyBool(!pyContains(pyAt(first,"clues"),"here")),"tests/kernel/test_frontend_view.py:21 assert 'here' not in first['clues']");
assert.ok(pyBool(pyEqual(pyAt(first,"state"),pyAt((await pyMethod(client,"table",["status"],{})),"state"))),"tests/kernel/test_frontend_view.py:22 assert first['state'] == client.table('status')['state']");
}
Object.defineProperty(test_sheet_is_read_only_and_hides_undiscovered_clues,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_sheet_is_read_only_and_hides_undiscovered_clues"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_sheet_is_read_only_and_hides_undiscovered_clues(await kernel(t,{}));});
export async function test_the_view_carries_the_clock_in_the_fiction_not_only_elapsed(kernel:any){

(await pyInvoke(open_turn,[kernel,"我在门厅里等了一会儿。"],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"clock"),({["minutes"]:0,["elapsed"]:"0 h 0 min",["at"]:"1920-10-12T10:00",["day_part"]:"morning"}))),"tests/kernel/test_frontend_view.py:30 assert kernel.ok('table.view', {'campaign': CAMPAIGN})['clock'] == {\n        'minutes': 0, 'elapsed': '0 h 0 min', 'at': '1920-10-12T10:00', 'day_part': 'morning'}");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:250})]}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"clock"),({["minutes"]:250,["elapsed"]:"4 h 10 min",["at"]:"1920-10-12T14:10",["day_part"]:"afternoon"}))),"tests/kernel/test_frontend_view.py:33 assert kernel.ok('table.view', {'campaign': CAMPAIGN})['clock'] == {\n        'minutes': 250, 'elapsed': '4 h 10 min', 'at': '1920-10-12T14:10', 'day_part': 'afternoon'}");
}
Object.defineProperty(test_the_view_carries_the_clock_in_the_fiction_not_only_elapsed,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_view_carries_the_clock_in_the_fiction_not_only_elapsed"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_view_carries_the_clock_in_the_fiction_not_only_elapsed(await kernel(t,{}));});
export async function test_the_view_carries_a_day_clock_without_a_declared_date(tmp_path:any,start_time:any){
let content:any,name:any,path:any,data:any,client:any,opened:any,start:any,initial:any,clock:any,remaining:any,ended:any;
content=pyDivide(tmp_path,"content");
(await pyMethod(shutil,"copytree",[CONTENT_DIR,content],{}));
async function remove_date(value:any){
let child:any;
if(pyBool((await pyInvoke(pyIsInstance,[value,pyDict],{})))){if(pyBool(pyContains(value,"start_clock"))){(await pyMethod(value,"pop",["start_clock"],{}));
(await pyMethod(value,"pop",["start_time",null],{}));
if(pyBool((start_time!==null))){value["start_time"]=start_time;}}
for(child of pyIterable((await pyMethod(value,"values",[],{})))){
(await pyInvoke(remove_date,[child],{}));
}}else if(pyBool((await pyInvoke(pyIsInstance,[value,pyList],{})))){for(child of pyIterable(value)){
(await pyInvoke(remove_date,[child],{}));
}}
}
Object.defineProperty(remove_date,"__pySignature",{value:[{"name":"value","rest":false,"varargs":false}]});
for(name of pyIterable(["module-meta.json","module-graph.json"])){
path=pyDivide(pyDivide(content,"starters/the-haunting"),name);
if(pyBool((await pyMethod(path,"exists",[],{})))){data=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{}))],{}));
(await pyInvoke(remove_date,[data],{}));
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[data],{}))],{}));}
}
client=(new RpcClient(pyDivide(tmp_path,"workspace"),({"content":content})));
try{opened=(await pyInvoke(open_turn,[client,"I wait for a while."],{}));
start=(pyBool((start_time===null))?pyMultiply(9,60):pyAdd(pyMultiply(23,60),30));
initial=({["minutes"]:0,["elapsed"]:"0 h 0 min",["day"]:1,["hh"]:(pyBool((start_time===null))?"09":"23"),["mm"]:(pyBool((start_time===null))?"00":"30"),["day_part"]:(pyBool((start_time===null))?"morning":"night")});
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(client,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"clock"),initial)),"tests/kernel/test_frontend_view.py:72 assert client.ok('table.view', {'campaign': CAMPAIGN})['clock'] == initial");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(opened,"capsule"),"where"),"clock"),({...initial,["pin"]:"Use apply clock once to pin the opening local_datetime when the book gives no full date, keeping any declared start_time."}))),"tests/kernel/test_frontend_view.py:73 assert opened['capsule']['where']['clock'] == {\n            **initial,\n            'pin': 'Use apply clock once to pin the opening local_datetime when the book gives no full date, keeping any declared start_time.'}");
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:90})]}));
clock=pyAt((await pyMethod(client,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"clock");
assert.ok(pyBool(pyEqual(clock,({["minutes"]:90,["elapsed"]:"1 h 30 min",["day"]:(pyBool((start_time===null))?1:2),["hh"]:(pyBool((start_time===null))?"10":"01"),["mm"]:(pyBool((start_time===null))?"30":"00"),["day_part"]:(pyBool((start_time===null))?"morning":"small_hours")}))),"tests/kernel/test_frontend_view.py:78 assert clock == {\n            'minutes': 90, 'elapsed': '1 h 30 min',\n            'day': 1 if start_time is None else 2,\n            'hh': '10' if start_time is None else '01',\n            'mm': '30' if start_time is None else '00',\n            'day_part': 'morning' if start_time is None else 'small_hours'}");
assert.ok(pyBool(pyEqual(pySubtract(pyAt(clock,"day"),1),Math.floor((pyAdd(start,pyAt(clock,"minutes")))/1440))),"tests/kernel/test_frontend_view.py:84 assert clock['day'] - 1 == (start + clock['minutes']) // 1440");
remaining=pySubtract(1440,((pyAdd(start,90))%1440));
ended=(await pyMethod(client,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"time",["minutes"]:remaining})]}));
clock=pyAt((await pyMethod(client,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"clock");
assert.ok(pyBool(pyEqual(clock,({["minutes"]:pyAdd(90,remaining),["elapsed"]:`${Math.floor((pyAdd(90,remaining))/60)} h ${((pyAdd(90,remaining))%60)} min`,["day"]:(pyBool((start_time===null))?2:3),["hh"]:"00",["mm"]:"00",["day_part"]:"small_hours"}))),"tests/kernel/test_frontend_view.py:89 assert clock == {\n            'minutes': 90 + remaining,\n            'elapsed': f'{(90 + remaining) // 60} h {(90 + remaining) % 60} min',\n            'day': 2 if start_time is None else 3,\n            'hh': '00', 'mm': '00', 'day_part': 'small_hours'}");
assert.ok(pyBool(pyEqual(pySubtract(pyAt(clock,"day"),1),Math.floor((pyAdd(start,pyAt(clock,"minutes")))/1440))),"tests/kernel/test_frontend_view.py:94 assert clock['day'] - 1 == (start + clock['minutes']) // 1440");
assert.ok(pyBool(pyEqual(pyAt(pyAt(ended,"day_ended"),"days"),1)),"tests/kernel/test_frontend_view.py:95 assert ended['day_ended']['days'] == 1");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_the_view_carries_a_day_clock_without_a_declared_date,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false},{"name":"start_time","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("start_time",[null,"23:30"]))).entries())test("test_the_view_carries_a_day_clock_without_a_declared_date"+((pyCartesian([{}],pyParametrize("start_time",[null,"23:30"]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_view_carries_a_day_clock_without_a_declared_date(temporary,row["start_time"]);});
export async function test_sheet_does_not_persist_legacy_trail_migration(kernel:any){
let path:any,world:any,before:any;

(await pyInvoke(create_campaign,[kernel],{}));
path=pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"world.json");
world=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{}))],{}));
(await pyMethod(world,"pop",["scene_trail",null],{}));
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[world],{}))],{}));
before=(await pyMethod(path,"read_bytes",[],{}));
(await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool(pyEqual((await pyMethod(path,"read_bytes",[],{})),before)),"tests/kernel/test_frontend_view.py:109 assert path.read_bytes() == before");
}
Object.defineProperty(test_sheet_does_not_persist_legacy_trail_migration,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_sheet_does_not_persist_legacy_trail_migration"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_sheet_does_not_persist_legacy_trail_migration(await kernel(t,{}));});
export async function test_the_glossary_is_the_rules_data_in_the_campaigns_play_language(kernel:any){
let labels:any;

(await pyInvoke(create_campaign,[kernel],{}));
labels=pyAt((await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"labels");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(labels,"STR"),"力量");return pyBool(__left)?pyEqual(pyAt(labels,"POW"),"意志"):__left})())),"tests/kernel/test_frontend_view.py:118 assert labels['STR'] == '力量' and labels['POW'] == '意志'");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(labels,"Library Use"),"图书馆使用");return pyBool(__left)?pyEqual(pyAt(labels,"Spot Hidden"),"侦查"):__left})())),"tests/kernel/test_frontend_view.py:119 assert labels['Library Use'] == '图书馆使用' and labels['Spot Hidden'] == '侦查'");
assert.ok(pyBool(pyEqual(pyAt(labels,"Appearance"),"外貌")),"tests/kernel/test_frontend_view.py:122 assert labels['Appearance'] == '外貌'");
assert.ok(pyBool(!pyContains(labels,"MOV")),"tests/kernel/test_frontend_view.py:124 assert 'MOV' not in labels");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const value of pyIterable((await pyMethod(labels,"values",[],{})))){__rows.push((await (async()=>{const __left=(await pyInvoke(pyIsInstance,[value,pyStr],{}));return pyBool(__left)?value:__left})()));}return __rows;})())))),"tests/kernel/test_frontend_view.py:125 assert all(isinstance(value, str) and value for value in labels.values())");
}
Object.defineProperty(test_the_glossary_is_the_rules_data_in_the_campaigns_play_language,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_glossary_is_the_rules_data_in_the_campaigns_play_language"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_glossary_is_the_rules_data_in_the_campaigns_play_language(await kernel(t,{}));});
export async function test_an_english_table_gets_only_the_rows_the_data_declares_for_english(kernel:any){
let labels:any;

(await pyMethod(kernel,"ok",["campaign.create",({["id"]:"en1",["module"]:MODULE,["pregen"]:PREGEN,["play_language"]:"en"})],{}));
labels=pyAt((await pyMethod(kernel,"ok",["table.view",({["campaign"]:"en1"})],{})),"labels");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=!pyContains(labels,"STR");return pyBool(__left)?!pyContains(labels,"Spot Hidden"):__left})());return pyBool(__left)?!pyContains(labels,"Antiquarian"):__left})())),"tests/kernel/test_frontend_view.py:133 assert 'STR' not in labels and 'Spot Hidden' not in labels and 'Antiquarian' not in labels");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(labels,"intact"),"Intact");return pyBool(__left)?pyEqual(pyAt(labels,"sanity_bout"),"Bout of madness"):__left})())),"tests/kernel/test_frontend_view.py:134 assert labels['intact'] == 'Intact' and labels['sanity_bout'] == 'Bout of madness'");
}
Object.defineProperty(test_an_english_table_gets_only_the_rows_the_data_declares_for_english,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_english_table_gets_only_the_rows_the_data_declares_for_english"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_english_table_gets_only_the_rows_the_data_declares_for_english(await kernel(t,{}));});
export async function test_a_discovered_clue_is_listed_by_the_name_the_table_gave_it(kernel:any){
let row:any;

(await pyInvoke(open_turn,[kernel],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-commission",["label"]:"诺特的委托合同",["how"]:"诺特当面委托调查房屋。"})]}));
row=pyAt(pyAt(pyAt((await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"clues"),"discovered"),0);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"clue"),"knott-commission");return pyBool(__left)?pyEqual(pyAt(row,"label"),"诺特的委托合同"):__left})())),"tests/kernel/test_frontend_view.py:146 assert row['clue'] == 'knott-commission' and row['label'] == '诺特的委托合同'");
assert.ok(pyBool(pyEqual(pyAt(row,"how"),"诺特当面委托调查房屋。")),"tests/kernel/test_frontend_view.py:147 assert row['how'] == '诺特当面委托调查房屋。'");
assert.ok(pyBool(!pyContains(row,"summary")),"tests/kernel/test_frontend_view.py:148 assert 'summary' not in row");
}
Object.defineProperty(test_a_discovered_clue_is_listed_by_the_name_the_table_gave_it,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_discovered_clue_is_listed_by_the_name_the_table_gave_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_discovered_clue_is_listed_by_the_name_the_table_gave_it(await kernel(t,{}));});
export async function test_an_unnamed_clue_falls_back_to_the_graph_rather_than_to_its_handle(kernel:any){
let row:any;
(await pyInvoke(open_turn,[kernel],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-commission"})]}));
row=pyAt(pyAt(pyAt((await pyMethod(kernel,"ok",["table.view",({["campaign"]:CAMPAIGN})],{})),"clues"),"discovered"),0);
assert.ok(pyBool(pyEqual(pyAt(row,"clue"),"knott-commission")),"tests/kernel/test_frontend_view.py:155 assert row['clue'] == 'knott-commission'");
assert.ok(pyBool((await (async()=>{const __left=pyAt(row,"label");return pyBool(__left)?!pyEqual(pyAt(row,"label"),"knott-commission"):__left})())),"tests/kernel/test_frontend_view.py:156 assert row['label'] and row['label'] != 'knott-commission'");
assert.ok(pyBool(!pyContains(row,"summary")),"tests/kernel/test_frontend_view.py:158 assert 'summary' not in row");
}
Object.defineProperty(test_an_unnamed_clue_falls_back_to_the_graph_rather_than_to_its_handle,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_unnamed_clue_falls_back_to_the_graph_rather_than_to_its_handle"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_unnamed_clue_falls_back_to_the_graph_rather_than_to_its_handle(await kernel(t,{}));});
