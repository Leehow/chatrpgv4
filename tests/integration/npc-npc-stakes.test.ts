// Migrated from tests/kernel/test_npc_stakes.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CONTENT_DIR,RpcClient,campaign_dir,create_campaign,narrate,narrate_opening,open_turn,pin_contact_impression,read_json,resolve,walk_to_confrontation,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";
import {content_with,edit_fight} from "./npc-npc-standing-action.test.ts";







export let CORBITT:any="walter-corbitt";
export let INVESTIGATOR:any="thomas-hayes";
export let TABLE:any=pyDivide(pyDivide(pyDivide(pyDivide(CONTENT_DIR,"rulesets"),"coc7"),"rules-json"),"npc-stakes.json");



export let LANDED:any=({[3]:"severe",[2]:"escalates",[1]:"nothing"});


export let SURPRISE_SEEDS:any=({[3]:true,[2]:true,[7]:false,[1]:false});

export let IN_A_FIGHT:any=["attacked_this_turn","in_fight_with_investigators"];
export async function rules(){
return (await pyMethod(json,"loads",[(await pyMethod(TABLE,"read_text",[],{"encoding":"utf-8"}))],{}));
}
export async function rung_names(){
return (await (async()=>{const __rows:any[]=[];for(const rung of pyIterable(pyAt((await rules()),"rungs"))){__rows.push(pyAt(rung,"name"));}return __rows;})());
}
export async function rung_row(name:any){
return (await pyNext((await (async()=>{const __rows:any[]=[];for(const rung of pyIterable(pyAt((await rules()),"rungs"))){if(pyBool(pyEqual(pyAt(rung,"name"),name))){__rows.push(rung);}}return __rows;})())));
}
export async function moved(base:any,shifts:any){
let names:any,table:any,alone:any,grouped:any,name:any,shift:any,index:any;

const __unpack4042=[(await rung_names()),(await rules())];names=__unpack4042[0];table=__unpack4042[1];
const __unpack4083=[0,({})];alone=__unpack4083[0];grouped=__unpack4083[1];
for(name of pyIterable(shifts)){
shift=pyAt(pyAt(table,"shifts"),name);
if(pyBool(!pyContains(shift,"group"))){alone+=pyAt(shift,"step");}else if(pyBool(pyLess((await Math.abs((await pyMethod(grouped,"get",[pyAt(shift,"group"),0],{})))),(await Math.abs(pyAt(shift,"step")))))){grouped[pyAt(shift,"group")]=pyAt(shift,"step");}
}
index=pyAdd(pyAdd((await pyMethod(names,"index",[base],{})),alone),(await pySum((await pyMethod(grouped,"values",[],{})))));
return pyAt(names,(await pyMax(0,(await pyMin(pySubtract((await pyLen(names)),1),index)))));
}
export async function outcome_of(rung:any,roll:any){
return (pyBool(pyLessEqual(roll,pyAt(rung,"severe_at_most")))?"severe":(pyBool(pyLessEqual(roll,pyAt(rung,"escalates_at_most")))?"escalates":"nothing"));
}
export async function view_of(rung:any,roll:any){
let outcome:any,surprise:any,permission:any;

outcome=(await outcome_of(rung,roll));
surprise=pyLessEqual(roll,pyAt(rung,"surprise_at_most"));
permission=(pyBool(surprise)?pyAt(pyAt(rung,"lines"),(pyBool(pyEqual(outcome,"severe"))?"severe_surprise":"surprise")):null);
return ({["rung"]:pyAt(rung,"name"),["outcome"]:outcome,["line"]:(await pyMethod(pyAt(rung,"lines"),"get",[outcome],{})),["surprise"]:surprise,["surprise_line"]:permission});
}
export async function stakes(client:any,name:any="Walter Corbitt"){
return (await pyMethod(client,"ok",["npc.stakes",({["campaign"]:"c1",["name"]:name})],{}));
}
export async function situation(client:any,name:any="Walter Corbitt"){
return (await pyMethod(client,"ok",["npc.situation",({["campaign"]:"c1",["name"]:name})],{}));
}
export async function stakes_receipts(client:any){
return (await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["family"],{})),"stakes"):__left})()))){__rows.push(r);}}return __rows;})());
}
export async function player_facing(mechanics:any){

return (await (async()=>{const __rows:any[]=[];for(const row of pyIterable(mechanics)){if(pyBool(!pyEqual((await pyMethod(row,"get",["visibility"],{})),"keeper"))){__rows.push(row);}}return __rows;})());
}
export async function client_for(tmp_path:any,seed:any,combat:any=null){
let content:any;
content=(pyBool((combat!==null))?(await content_with(tmp_path,combat)):null);
return (new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:(await pyStr(seed))}),"content":content})));
}
export async function at_corbitt(client:any){

(await open_turn(client,"I hit him."));
return (await walk_to_confrontation(client));
}
export async function hit_corbitt(client:any){
let n:any;

n=(await at_corbitt(client));
(await resolve(client,`t1-c${n}`,({"intent":"combat","goal":"hit him","method":"fists","target":"Walter Corbitt","weapon":"unarmed"})));
(await resolve(client,`t1-c${pyAdd(n,1)}`,({"intent":"combat","goal":"combat:defend","method":"combat:defend","actor":"Walter Corbitt","defense":"dodge"})));
return pyAdd(n,2);
}

export async function test_after_a_landed_blow_the_rung_is_one_above_his_base_and_only_the_keeper_sees_the_die(tmp_path:any,seed:any,outcome:any){
let client:any,contact:any,receipts:any,attack:any,before:any,result:any,receipt:any,table:any,names:any,base:any,rung:any,line:any,mechanics:any,row:any,after:any;
client=(await client_for(tmp_path,seed));
try{(await hit_corbitt(client));
contact=(await (async()=>{const __rows:any[]=[];for(const line of pyIterable(pyAt((await situation(client)),"constraints"))){if(pyBool((await pyMethod(line,"startswith",["Mod check natural-npc:first-impression"],{})))){__rows.push(line);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=contact;return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(contact)){__rows.push(pyContains(line,"is still to come"));}return __rows;})()))):__left})())),pyStr(contact));
receipts=pyAt((await pyMethod(client,"table",["status"],{})),"receipts");
attack=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(receipts)){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["combat_action"],{})),"attack"):__left})()))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(attack,"actor"),INVESTIGATOR);return pyBool(__left)?pyEqual(pyAt(attack,"npc"),CORBITT):__left})())),"tests/kernel/test_npc_stakes.py:139 assert attack[\"actor\"] == INVESTIGATOR and attack[\"npc\"] == CORBITT");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(receipts)){__rows.push((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["form"],{})),"dice"):__left})());return pyBool(__left)?pyEqual((await pyMethod(r,"get",["actor"],{})),INVESTIGATOR):__left})()));}return __rows;})())))),pyStr(`seed ${seed}: the punch lands (its damage die is rolled)`));
before=(await situation(client));
assert.ok(pyBool((pyAt(before,"stakes")===null)),pyStr("reading the situation never rolls the die"));
result=(await stakes(client));
const __unpack8051=(await stakes_receipts(client));receipt=__unpack8051[0];
const __unpack8095=[(await rules()),(await rung_names())];table=__unpack8095[0];names=__unpack8095[1];
base=pyAt(table,"default_rung");
assert.ok(pyBool(pyEqual(pyAt(receipt,"base"),({["rung"]:base,["from"]:"default"}))),pyStr("no disposition, no archetype: the table's default"));
assert.ok(pyBool(pyEqual(pyAt(receipt,"shifts"),IN_A_FIGHT)),pyStr("the blow, and the fight it opened (§143.26)"));
assert.ok(pyBool(pyEqual((await pyMethod(names,"index",[pyAt(receipt,"rung")],{})),pyAdd((await pyMethod(names,"index",[base],{})),1))),pyStr("one rung above the base: the blow and the fight are one group"));
assert.ok(pyBool(pyEqual(pyAt(receipt,"rung"),(await moved(base,IN_A_FIGHT)))),"tests/kernel/test_npc_stakes.py:152 assert receipt[\"rung\"] == moved(base, IN_A_FIGHT)");
rung=(await rung_row(pyAt(receipt,"rung")));
assert.ok(pyBool((await (async()=>{const __left=(await pyIsInstance(pyAt(receipt,"roll"),pyInt));return pyBool(__left)?(await (async()=>{const __term0=1;const __term1=pyAt(receipt,"roll");const __term2=100;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})()):__left})())),"tests/kernel/test_npc_stakes.py:154 assert isinstance(receipt[\"roll\"], int) and 1 <= receipt[\"roll\"] <= 100");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(receipt,"outcome");const __term1=(await outcome_of(rung,pyAt(receipt,"roll")));const __term2=outcome;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),pyStr(`seed ${seed} rolls ${pyAt(receipt,"roll")}`));
line=(await pyMethod(pyAt(rung,"lines"),"get",[outcome],{}));
assert.ok(pyBool(pyEqual(result,({["stakes"]:(await view_of(rung,pyAt(receipt,"roll")))}))),"tests/kernel/test_npc_stakes.py:158 assert result == {\"stakes\": view_of(rung, receipt[\"roll\"])}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"stakes"),"line"),line)),"tests/kernel/test_npc_stakes.py:159 assert result[\"stakes\"][\"line\"] == line");
assert.ok(pyBool(pyEqual(((line===null)),(pyEqual(outcome,"nothing")))),"tests/kernel/test_npc_stakes.py:160 assert (line is None) == (outcome == \"nothing\")");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(receipt,"kind"),"roll");return pyBool(__left)?pyEqual(pyAt(receipt,"family"),"stakes"):__left})());return pyBool(__left)?pyEqual(pyAt(receipt,"actor"),CORBITT):__left})())),"tests/kernel/test_npc_stakes.py:161 assert receipt[\"kind\"] == \"roll\" and receipt[\"family\"] == \"stakes\" and receipt[\"actor\"] == CORBITT");
assert.ok(pyBool((pyAt(receipt,"actor_is_investigator")===false)),"tests/kernel/test_npc_stakes.py:162 assert receipt[\"actor_is_investigator\"] is False");
mechanics=pyAt((await pyMethod(client,"table",["status"],{})),"mechanics");
assert.ok(pyBool(!pyContains((await (async()=>{const __rows:any[]=[];for(const m of pyIterable((await player_facing(mechanics)))){__rows.push(pyAt(m,"receipt"));}return __rows;})()),pyAt(receipt,"id"))),pyStr("the player is never told the die was rolled"));
row=(await pyNext((await (async()=>{const __rows:any[]=[];for(const m of pyIterable(mechanics)){if(pyBool(pyEqual(pyAt(m,"receipt"),pyAt(receipt,"id")))){__rows.push(m);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(row,"visibility"),"keeper");return pyBool(__left)?pyEqual(pyAt(row,"family"),"stakes"):__left})());return pyBool(__left)?pyEqual(pyAt(receipt,"visibility"),"keeper"):__left})())),"tests/kernel/test_npc_stakes.py:168 assert row[\"visibility\"] == \"keeper\" and row[\"family\"] == \"stakes\" and receipt[\"visibility\"] == \"keeper\"");
after=(await situation(client));
assert.ok(pyBool(pyEqual(pyAt(after,"stakes"),pyAt(result,"stakes"))),pyStr("the packet reads the same {rung, outcome, line, surprise, surprise_line} from the receipt"));
assert.ok(pyBool(pyEqual(pyAt(after,"happened"),pyAt(before,"happened"))),pyStr("the die is not something that happened to him"));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("seed,outcome",(await pyMethod(LANDED,"items",[],{}))))).entries())test("test_after_a_landed_blow_the_rung_is_one_above_his_base_and_only_the_keeper_sees_the_die"+((pyCartesian([{}],pyParametrize("seed,outcome",(await pyMethod(LANDED,"items",[],{}))))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_after_a_landed_blow_the_rung_is_one_above_his_base_and_only_the_keeper_sees_the_die(temporary,row["seed"],row["outcome"]);});

export async function test_on_the_dangerous_rung_a_roll_at_most_its_surprise_column_allows_a_surprise(tmp_path:any,seed:any,expected:any){
let client:any,result:any,receipt:any,rung:any,expected_line:any,packet:any;
client=(await client_for(tmp_path,seed));
try{(await hit_corbitt(client));
result=(await stakes(client));
const __unpack10609=(await stakes_receipts(client));receipt=__unpack10609[0];
assert.ok(pyBool((await (async()=>{const __term0=pyAt(receipt,"rung");const __term1="dangerous";const __term2=(await moved(pyAt((await rules()),"default_rung"),IN_A_FIGHT));return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),pyStr("the punch moves him to dangerous"));
rung=(await rung_row(pyAt(receipt,"rung")));
assert.ok(pyBool((await (async()=>{const __term0=pyAt(receipt,"surprise_at_most");const __term1=pyAt(rung,"surprise_at_most");const __term2=30;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),pyStr("the ticket's dangerous surprise column"));
assert.ok(pyBool((await (async()=>{const __term0=pyAt(receipt,"surprise");const __term1=(pyLessEqual(pyAt(receipt,"roll"),pyAt(rung,"surprise_at_most")));const __term2=expected;return pyCompare(__term0,__term1,"is")&&pyCompare(__term1,__term2,"is");})())),pyStr(`seed ${seed} rolls ${pyAt(receipt,"roll")}`));
expected_line=(pyBool(expected)?pyAt(pyAt(rung,"lines"),(pyBool(pyEqual(pyAt(receipt,"outcome"),"severe"))?"severe_surprise":"surprise")):null);
assert.ok(pyBool(pyEqual(pyAt(receipt,"surprise_line"),expected_line)),pyStr("the table's permission, the severe one on a severe roll"));
assert.ok(pyBool(pyEqual(result,({["stakes"]:(await view_of(rung,pyAt(receipt,"roll")))}))),"tests/kernel/test_npc_stakes.py:192 assert result == {\"stakes\": view_of(rung, receipt[\"roll\"])}");
packet=pyAt((await situation(client)),"stakes");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(packet,"surprise")===pyAt(receipt,"surprise"));return pyBool(__left)?pyEqual(pyAt(packet,"surprise_line"),pyAt(receipt,"surprise_line")):__left})())),pyStr("the situation's stakes.surprise is the receipt's"));
assert.ok(pyBool(pyEqual(packet,pyAt(result,"stakes"))),"tests/kernel/test_npc_stakes.py:196 assert packet == result[\"stakes\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("seed,expected",(await pyMethod(SURPRISE_SEEDS,"items",[],{}))))).entries())test("test_on_the_dangerous_rung_a_roll_at_most_its_surprise_column_allows_a_surprise"+((pyCartesian([{}],pyParametrize("seed,expected",(await pyMethod(SURPRISE_SEEDS,"items",[],{}))))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_on_the_dangerous_rung_a_roll_at_most_its_surprise_column_allows_a_surprise(temporary,row["seed"],row["expected"]);});
export async function test_a_severe_roll_that_surprises_carries_the_severe_permission(tmp_path:any){
let client:any,view:any,rung:any;
client=(await client_for(tmp_path,3));
try{(await hit_corbitt(client));
view=pyAt((await stakes(client)),"stakes");
rung=(await rung_row(pyAt(view,"rung")));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(view,"outcome"),"severe");return pyBool(__left)?(pyAt(view,"surprise")===true):__left})())),"tests/kernel/test_npc_stakes.py:207 assert view[\"outcome\"] == \"severe\" and view[\"surprise\"] is True");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(view,"surprise_line");const __term1=pyAt(pyAt(rung,"lines"),"severe_surprise");const __term2=pyAt(pyAt(rung,"lines"),"surprise");return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"!=");})())),"tests/kernel/test_npc_stakes.py:208 assert view[\"surprise_line\"] == rung[\"lines\"][\"severe_surprise\"] != rung[\"lines\"][\"surprise\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_severe_roll_that_surprises_carries_the_severe_permission"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_severe_roll_that_surprises_carries_the_severe_permission(temporary);});


export let TOP_RUNG_INVITES:any=["need not be plausible","the table's fun","the less anyone could have guessed it, the better","Absurd, out of its time or wildly out of proportion","as long as the table can picture them bringing it out right now"];
export let LOWER_SURPRISE:any="This person may have something on them or within reach that no one at the table knew they had, and may bring it out now.";
export async function test_a_severe_surprise_packet_carries_the_permission_to_be_unexpected(tmp_path:any){
let client:any,packet:any,missing:any,rung:any;

client=(await client_for(tmp_path,3));
try{(await hit_corbitt(client));
(await stakes(client));
packet=pyAt((await situation(client)),"stakes");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(packet,"outcome"),"severe");return pyBool(__left)?(pyAt(packet,"surprise")===true):__left})())),"tests/kernel/test_npc_stakes.py:229 assert packet[\"outcome\"] == \"severe\" and packet[\"surprise\"] is True");
missing=(await (async()=>{const __rows:any[]=[];for(const phrase of pyIterable(TOP_RUNG_INVITES)){if(pyBool(!pyContains(pyAt(packet,"surprise_line"),phrase))){__rows.push(phrase);}}return __rows;})());
assert.ok(pyBool(!pyBool(missing)),pyStr(`the packet's permission lacks ${missing}: ${pyAt(packet,"surprise_line")}`));
for(rung of pyIterable(pyAt((await rules()),"rungs"))){
assert.ok(pyBool(pyEqual(pyAt(pyAt(rung,"lines"),"severe_surprise"),pyAt(packet,"surprise_line"))),pyStr(`${pyAt(rung,"name")}: every rung's top surprise invites it`));
assert.ok(pyBool(pyEqual(pyAt(pyAt(rung,"lines"),"surprise"),LOWER_SURPRISE)),pyStr(`${pyAt(rung,"name")}: the lower surprise is unchanged`));
}}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_severe_surprise_packet_carries_the_permission_to_be_unexpected"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_severe_surprise_packet_carries_the_permission_to_be_unexpected(temporary);});

export async function test_a_first_contact_row_and_an_open_obligation_do_not_prepare_him(tmp_path:any){
let client:any,constraints:any,obligation:any,contact:any,result:any,receipt:any;

client=(await client_for(tmp_path,7));
try{(await create_campaign(client));
(await pin_contact_impression(client));
(await narrate_opening(client));
(await pyMethod(client,"table",["player_input"],{"text":"I tell Knott I will not take the job."}));
constraints=pyAt((await situation(client,"Steven Knott")),"constraints");
obligation=(await (async()=>{const __rows:any[]=[];for(const line of pyIterable(constraints)){if(pyBool((await pyMethod(line,"startswith",["scene obligation knott-accept-commission (open)"],{})))){__rows.push(line);}}return __rows;})());
contact=(await (async()=>{const __rows:any[]=[];for(const line of pyIterable(constraints)){if(pyBool((await pyMethod(line,"startswith",["Mod check natural-npc:first-impression"],{})))){__rows.push(line);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=obligation;return pyBool(__left)?contact:__left})());return pyBool(__left)?pyEqual((await pyLen(constraints)),2):__left})())),pyStr(constraints));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(constraints)){__rows.push(pyContains(line,"reaction roll"));}return __rows;})()))))),pyStr("the commission is plot, not a preordained reaction"));
result=(await stakes(client,"Steven Knott"));
assert.ok(pyBool((await (async()=>{const __left=!pyEqual((await pyMethod(result,"get",["reason"],{})),"prepared");return pyBool(__left)?(pyAt(result,"stakes")!==null):__left})())),pyStr(`a first-contact row and an open obligation prepare nothing: ${result}`));
const __unpack15438=(await stakes_receipts(client));receipt=__unpack15438[0];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"actor"),"steven-knott");return pyBool(__left)?pyEqual(pyAt(pyAt(result,"stakes"),"rung"),pyAt(receipt,"rung")):__left})())),"tests/kernel/test_npc_stakes.py:261 assert receipt[\"actor\"] == \"steven-knott\" and result[\"stakes\"][\"rung\"] == receipt[\"rung\"]");
assert.ok(pyBool(pyEqual(pyAt((await situation(client,"Steven Knott")),"constraints"),constraints)),pyStr("the rows stay in the packet"));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_first_contact_row_and_an_open_obligation_do_not_prepare_him"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_first_contact_row_and_an_open_obligation_do_not_prepare_him(temporary);});
export async function test_a_reaction_the_book_preordains_is_prepared_until_its_obligation_is_done(tmp_path:any){
let client:any,preordained:any,result:any,receipt:any;

client=(await client_for(tmp_path,7));
try{(await open_turn(client,"I ask at the Globe for the old clippings."));
preordained=(await (async()=>{const __rows:any[]=[];for(const line of pyIterable(pyAt((await situation(client,"Arty Wilmot")),"constraints"))){if(pyBool((await pyMethod(line,"startswith",["scene obligation globe-clippings-access (open)"],{})))){__rows.push(line);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=preordained;return pyBool(__left)?pyContains(pyAt(preordained,0),"the book skips Arty Wilmot's reaction roll"):__left})())),"tests/kernel/test_npc_stakes.py:276 assert preordained and \"the book skips Arty Wilmot's reaction roll\" in preordained[0]");
assert.ok(pyBool(pyEqual((await stakes(client,"Arty Wilmot")),({["stakes"]:null,["reason"]:"prepared"}))),"tests/kernel/test_npc_stakes.py:277 assert stakes(client, \"Arty Wilmot\") == {\"stakes\": None, \"reason\": \"prepared\"}");
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await stakes_receipts(client)),[]);return pyBool(__left)?(pyAt((await situation(client,"Arty Wilmot")),"stakes")===null):__left})())),"tests/kernel/test_npc_stakes.py:278 assert stakes_receipts(client) == [] and situation(client, \"Arty Wilmot\")[\"stakes\"] is None");
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"flag",["name"]:"newspaper-morgue-clippings-access",["value"]:true,["why"]:"he let us into the morgue"})]}));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(pyAt((await situation(client,"Arty Wilmot")),"constraints"))){__rows.push((await pyMethod(line,"startswith",["scene obligation globe-clippings-access (waived)"],{})));}return __rows;})())))),"tests/kernel/test_npc_stakes.py:282 assert any(line.startswith(\"scene obligation globe-clippings-access (waived)\")\n                   for line in situation(client, \"Arty Wilmot\")[\"constraints\"])");
result=(await stakes(client,"Arty Wilmot"));
const __unpack17131=(await stakes_receipts(client));receipt=__unpack17131[0];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"actor"),"arty-wilmot");return pyBool(__left)?pyEqual(pyAt(pyAt(result,"stakes"),"rung"),pyAt(receipt,"rung")):__left})())),"tests/kernel/test_npc_stakes.py:286 assert receipt[\"actor\"] == \"arty-wilmot\" and result[\"stakes\"][\"rung\"] == receipt[\"rung\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_reaction_the_book_preordains_is_prepared_until_its_obligation_is_done"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_reaction_the_book_preordains_is_prepared_until_its_obligation_is_done(temporary);});

export async function test_the_die_is_rolled_once_per_person_per_turn_and_only_in_an_open_turn(tmp_path:any){
let client:any,n:any,first:any,receipt:any,error:any,second:any,again:any;
client=(await client_for(tmp_path,2));
try{n=(await hit_corbitt(client));
first=(await stakes(client));
const __unpack17629=(await stakes_receipts(client));receipt=__unpack17629[0];
assert.ok(pyBool(pyEqual((await stakes(client)),first)),pyStr("a second call answers the receipt already written"));
assert.ok(pyBool(pyEqual((await stakes_receipts(client)),[receipt])),pyStr("and writes nothing"));
assert.ok(pyBool(pyEqual(pyAt((await situation(client)),"stakes"),pyAt(first,"stakes"))),"tests/kernel/test_npc_stakes.py:301 assert situation(client)[\"stakes\"] == first[\"stakes\"]");
(await narrate(client,`t1-c${n}`,"他挨了一拳，退到墙边。"));
error=(await pyMethod(client,"err",["npc.stakes",({["campaign"]:"c1",["name"]:"Walter Corbitt"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"turn_state");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"state"),"awaiting_player"):__left})())),"tests/kernel/test_npc_stakes.py:305 assert error[\"code\"] == \"turn_state\" and error[\"details\"][\"state\"] == \"awaiting_player\"");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide((await campaign_dir(client.workspace)),"turn.json"))),"receipts"),[])),"tests/kernel/test_npc_stakes.py:306 assert read_json(campaign_dir(client.workspace) / \"turn.json\")[\"receipts\"] == []");
(await pyMethod(client,"table",["player_input"],{"text":"I back away from him."}));
assert.ok(pyBool((pyAt((await situation(client)),"stakes")===null)),"tests/kernel/test_npc_stakes.py:311 assert situation(client)[\"stakes\"] is None");
second=(await stakes(client));
const __unpack18602=(await stakes_receipts(client));again=__unpack18602[0];
assert.ok(pyBool((await (async()=>{const __left=!pyEqual(pyAt(again,"id"),pyAt(receipt,"id"));return pyBool(__left)?pyEqual(pyAt(again,"shifts"),["attacked_last_turn","in_fight_with_investigators"]):__left})())),"tests/kernel/test_npc_stakes.py:314 assert again[\"id\"] != receipt[\"id\"] and again[\"shifts\"] == [\"attacked_last_turn\", \"in_fight_with_investigators\"]");
assert.ok(pyBool(pyEqual(pyAt(again,"rung"),(await moved(pyAt((await rules()),"default_rung"),pyAt(again,"shifts"))))),"tests/kernel/test_npc_stakes.py:315 assert again[\"rung\"] == moved(rules()[\"default_rung\"], again[\"shifts\"])");
assert.ok(pyBool(pyEqual(pyAt(pyAt(second,"stakes"),"rung"),pyAt(again,"rung"))),"tests/kernel/test_npc_stakes.py:316 assert second[\"stakes\"][\"rung\"] == again[\"rung\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_die_is_rolled_once_per_person_per_turn_and_only_in_an_open_turn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_die_is_rolled_once_per_person_per_turn_and_only_in_an_open_turn(temporary);});

export async function test_the_die_is_no_interaction_no_fact_and_not_the_last_roll(tmp_path:any){
let client:any,n:any,receipt:any,turn:any,ledger:any,record:any,committed:any,checks:any,last:any,expected:any,director:any;
client=(await client_for(tmp_path,2));
try{n=(await hit_corbitt(client));
(await stakes(client));
const __unpack19239=(await stakes_receipts(client));receipt=__unpack19239[0];
turn=pyAt((await pyMethod(client,"table",["status"],{})),"receipts");
(await narrate(client,`t1-c${n}`,"他挨了一拳，眼神变了。"));
ledger=pyAt((await read_json(pyDivide((await campaign_dir(client.workspace)),"npc-ledger.json"))),"npc-walter-corbitt");
assert.ok(pyBool(!pyContains((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(ledger,"interactions"))){__rows.push(pyAt(row,"receipt"));}return __rows;})()),pyAt(receipt,"id"))),pyStr("the ledger's fold reads no interaction from it"));
record=(await read_json(pyDivide(pyDivide((await campaign_dir(client.workspace)),"turns"),"0001.json")));
committed=pyAt(pyAt(record,"facts"),"committed");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(committed)){__rows.push(pyContains(line,"None"));}return __rows;})()))))),pyStr(`no committed fact is read off the die: ${committed}`));
checks=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(turn)){if(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?!pyEqual((await pyMethod(r,"get",["form"],{})),"dice"):__left})());return pyBool(__left)?!pyEqual((await pyMethod(r,"get",["family"],{})),"stakes"):__left})()))){__rows.push(r);}}return __rows;})());
last=pyAt(checks,(-1));
expected=(pyBool(pyContains(["critical","fumble"],(await pyMethod(last,"get",["level"],{}))))?pyAt(last,"level"):(pyBool((await pyMethod(last,"get",["passed"],{})))?"passed":"failed"));
assert.ok(pyBool(!pyEqual(expected,"failed")),pyStr("the seed is chosen so that the die (which passes nothing) would read differently"));
director=pyAt(pyAt((await pyMethod(client,"table",["player_input"],{"text":"I step back."})),"capsule"),"director");
assert.ok(pyBool(pyContains(pyAt(director,"because"),`last_roll = ${expected}`)),"tests/kernel/test_npc_stakes.py:344 assert f\"last_roll = {expected}\" in director[\"because\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_die_is_no_interaction_no_fact_and_not_the_last_roll"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_die_is_no_interaction_no_fact_and_not_the_last_roll(temporary);});
export async function test_a_die_rolled_for_someone_elsewhere_names_no_one_into_the_journal(tmp_path:any){
let client:any,world:any,packet:any;
client=(await client_for(tmp_path,7));
try{(await open_turn(client,"I ask Knott about the house."));
world=(await read_json(pyDivide((await campaign_dir(client.workspace)),"world.json")));
assert.ok(pyBool(!pyEqual(pyAt(pyAt(world,"npc_presence"),"dooley"),pyAt(world,"active_scene"))),pyStr("Dooley is not in the office"));
(await stakes(client,"Mr. Dooley"));
assert.ok(pyBool(pyEqual((await pyLen((await stakes_receipts(client)))),1)),"tests/kernel/test_npc_stakes.py:356 assert len(stakes_receipts(client)) == 1");
(await narrate(client,"t1-c1","诺特点了点头。"));
packet=(await pyMethod(client,"ok",["journal.job",({["campaign"]:"c1",["turn"]:1})],{}));
assert.ok(pyBool(!pyContains(pyAt(packet,"recordable"),"Mr. Dooley")),pyStr("the Keeper's die is no meeting the player had"));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_die_rolled_for_someone_elsewhere_names_no_one_into_the_journal"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_die_rolled_for_someone_elsewhere_names_no_one_into_the_journal(temporary);});

export async function test_the_base_is_the_disposition_word_first(tmp_path:any){
let client:any,receipt:any,base:any;
client=(await client_for(tmp_path,7,({["disposition"]:"fights_to_the_end"})));
try{(await at_corbitt(client));
(await stakes(client));
const __unpack21583=(await stakes_receipts(client));receipt=__unpack21583[0];
base=pyAt(pyAt((await rules()),"base_by_disposition"),"fights_to_the_end");
assert.ok(pyBool(pyEqual(pyAt(receipt,"base"),({["rung"]:base,["from"]:"disposition",["word"]:"fights_to_the_end"}))),"tests/kernel/test_npc_stakes.py:373 assert receipt[\"base\"] == {\"rung\": base, \"from\": \"disposition\", \"word\": \"fights_to_the_end\"}");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"shifts"),[]);return pyBool(__left)?pyEqual(pyAt(receipt,"rung"),base):__left})())),"tests/kernel/test_npc_stakes.py:374 assert receipt[\"shifts\"] == [] and receipt[\"rung\"] == base");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_base_is_the_disposition_word_first"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_base_is_the_disposition_word_first(temporary);});
export async function test_without_a_disposition_the_pinned_archetype_gives_the_base(tmp_path:any){
let client:any,receipt:any,base:any;
client=(await client_for(tmp_path,7));
try{(await open_turn(client,"I ask around the neighbourhood."));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Mr. Dooley",["archetype"]:"dangerous_actor",["why"]:"a hard man"})]}));
assert.ok(pyBool(pyEqual(pyAt((await situation(client,"Mr. Dooley")),"constraints"),[])),"tests/kernel/test_npc_stakes.py:384 assert situation(client, \"Mr. Dooley\")[\"constraints\"] == []");
(await stakes(client,"Mr. Dooley"));
const __unpack22339=(await stakes_receipts(client));receipt=__unpack22339[0];
base=pyAt(pyAt((await rules()),"base_by_archetype"),"dangerous_actor");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"actor"),"dooley");return pyBool(__left)?pyEqual(pyAt(receipt,"base"),({["rung"]:base,["from"]:"archetype",["word"]:"dangerous_actor"})):__left})())),"tests/kernel/test_npc_stakes.py:388 assert receipt[\"actor\"] == \"dooley\" and receipt[\"base\"] == {\"rung\": base, \"from\": \"archetype\", \"word\": \"dangerous_actor\"}");
assert.ok(pyBool(pyEqual(pyAt(receipt,"rung"),base)),"tests/kernel/test_npc_stakes.py:389 assert receipt[\"rung\"] == base");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_without_a_disposition_the_pinned_archetype_gives_the_base"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_without_a_disposition_the_pinned_archetype_gives_the_base(temporary);});

export async function advance_awareness(segments:any){
return async (client:any, n:any)=>(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"threat",["name"]:"threat-corbitt-haunting",["clock"]:"corbitt-awareness",["segments"]:segments,["why"]:"test"})]}));
}
export async function set_stance(word:any){
return async (client:any, n:any)=>(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["stance"]:word,["why"]:"test"})]}));
}


export let SHIFT_CASES:any=[["clock-past-half",(await advance_awareness(3)),["table_clock_past_half"]],["clock-at-half",(await advance_awareness(2)),[]],["stance-warm",(await set_stance("warm")),["stance_friendly"]],["stance-wary",(await set_stance("wary")),[]]];
export async function test_each_shift_is_the_tables(tmp_path:any,setup:any,expected:any){
let client:any,n:any,receipt:any;
client=(await client_for(tmp_path,7));
try{n=(await at_corbitt(client));
(await setup(client,n));
(await stakes(client));
const __unpack23914=(await stakes_receipts(client));receipt=__unpack23914[0];
assert.ok(pyBool(pyEqual(pyAt(receipt,"shifts"),expected)),"tests/kernel/test_npc_stakes.py:424 assert receipt[\"shifts\"] == expected");
assert.ok(pyBool(pyEqual(pyAt(receipt,"rung"),(await moved(pyAt((await rules()),"default_rung"),expected)))),"tests/kernel/test_npc_stakes.py:425 assert receipt[\"rung\"] == moved(rules()[\"default_rung\"], expected)");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("setup,expected",(await (async()=>{const __rows:any[]=[];for(const case_value of pyIterable(SHIFT_CASES)){__rows.push(pySlice(case_value,1,undefined));}return __rows;})())))).entries())test("test_each_shift_is_the_tables"+((pyCartesian([{}],pyParametrize("setup,expected",(await (async()=>{const __rows:any[]=[];for(const case_value of pyIterable(SHIFT_CASES)){__rows.push(pySlice(case_value,1,undefined));}return __rows;})())))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_each_shift_is_the_tables(temporary,row["setup"],row["expected"]);});
export async function test_hit_points_at_half_move_him_up_and_the_last_rung_holds(tmp_path:any){
let client:any,receipt:any,names:any,base:any;
client=(await client_for(tmp_path,6,({["disposition"]:"fights_to_the_end"})));
try{(await hit_corbitt(client));
(await edit_fight(client,pyAt(pyAt(pyAt((await rules()),"shifts"),"hp_at_most_half"),"hp_fraction_at_most"),undefined,undefined,undefined,undefined,undefined));
(await stakes(client));
const __unpack24433=(await stakes_receipts(client));receipt=__unpack24433[0];
assert.ok(pyBool(pyEqual(pyAt(receipt,"shifts"),[...IN_A_FIGHT,"hp_at_most_half"])),"tests/kernel/test_npc_stakes.py:437 assert receipt[\"shifts\"] == [*IN_A_FIGHT, \"hp_at_most_half\"]");
const __unpack24546=[(await rung_names()),pyAt(pyAt((await rules()),"base_by_disposition"),"fights_to_the_end")];names=__unpack24546[0];base=__unpack24546[1];
assert.ok(pyBool(pyLess(pySubtract((await pyLen(names)),1),pyAdd((await pyMethod(names,"index",[base],{})),2))),pyStr("the case is one the clamp decides"));
assert.ok(pyBool(pyEqual(pyAt(receipt,"rung"),pyAt(names,(-1)))),pyStr("clamped to the last rung"));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_hit_points_at_half_move_him_up_and_the_last_rung_holds"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_hit_points_at_half_move_him_up_and_the_last_rung_holds(temporary);});





export let CALM:any=({["disposition"]:"avoids_fighting"});
export async function at_least(name:any,floor:any){
let names:any;
names=(await rung_names());
return pyLessEqual((await pyMethod(names,"index",[floor],{})),(await pyMethod(names,"index",[name],{})));
}
export async function test_in_a_fight_with_the_investigators_a_calm_man_is_at_least_tense_though_no_one_struck_him(tmp_path:any){
let client:any,n:any,swing:any,session:any,receipts:any,receipt:any,base:any;

client=(await client_for(tmp_path,7,CALM));
try{n=(await at_corbitt(client));
swing=(await resolve(client,`t1-c${n}`,({"intent":"combat","goal":"he lunges","method":"","actor":"Walter Corbitt","target":"Thomas Hayes"})));
session=pyAt(swing,"session");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(session,"kind"),"combat");return pyBool(__left)?pyEqual(pyAt(session,"status"),"active"):__left})())),"tests/kernel/test_npc_stakes.py:467 assert session[\"kind\"] == \"combat\" and session[\"status\"] == \"active\"");
assert.ok(pyBool(pyLessEqual(new Set([CORBITT,INVESTIGATOR]),new Set((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(session,"participants"))){__rows.push(pyAt(p,"name"));}return __rows;})())))),pyStr("he and the investigator are in the fight"));
receipts=pyAt((await pyMethod(client,"table",["status"],{})),"receipts");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(receipts)){__rows.push((await (async()=>{const __left=(await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["combat_action"],{})),"attack"):__left})());return pyBool(__left)?pyEqual((await pyMethod(r,"get",["npc"],{})),CORBITT):__left})());return pyBool(__left)?!pyEqual((await pyMethod(r,"get",["actor"],{})),CORBITT):__left})()));}return __rows;})()))))),pyStr("no attack was made against him"));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(receipts)){__rows.push((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"delta");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["resource"],{})),"hp"):__left})());return pyBool(__left)?pyEqual((await pyMethod(r,"get",["subject"],{})),CORBITT):__left})()));}return __rows;})()))))),"tests/kernel/test_npc_stakes.py:472 assert not any(r[\"kind\"] == \"delta\" and r.get(\"resource\") == \"hp\" and r.get(\"subject\") == CORBITT for r in receipts)");
assert.ok(pyBool((pyAt(pyAt((await situation(client)),"state"),"in_session")===true)),"tests/kernel/test_npc_stakes.py:473 assert situation(client)[\"state\"][\"in_session\"] is True");
(await stakes(client));
const __unpack26695=(await stakes_receipts(client));receipt=__unpack26695[0];
base=pyAt(pyAt((await rules()),"base_by_disposition"),"avoids_fighting");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"base"),({["rung"]:base,["from"]:"disposition",["word"]:"avoids_fighting"}));return pyBool(__left)?pyEqual(base,"calm"):__left})())),"tests/kernel/test_npc_stakes.py:477 assert receipt[\"base\"] == {\"rung\": base, \"from\": \"disposition\", \"word\": \"avoids_fighting\"} and base == \"calm\"");
assert.ok(pyBool(pyEqual(pyAt(receipt,"shifts"),["in_fight_with_investigators"])),"tests/kernel/test_npc_stakes.py:478 assert receipt[\"shifts\"] == [\"in_fight_with_investigators\"]");
assert.ok(pyBool(pyEqual(pyAt(receipt,"rung"),(await moved(base,["in_fight_with_investigators"])))),"tests/kernel/test_npc_stakes.py:479 assert receipt[\"rung\"] == moved(base, [\"in_fight_with_investigators\"])");
assert.ok(pyBool((await at_least(pyAt(receipt,"rung"),"tense"))),pyStr("a man in a fight is not calm"));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_in_a_fight_with_the_investigators_a_calm_man_is_at_least_tense_though_no_one_struck_him"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_in_a_fight_with_the_investigators_a_calm_man_is_at_least_tense_though_no_one_struck_him(temporary);});
export async function test_a_punch_that_opens_a_fight_is_one_rung_not_two(tmp_path:any){
let client:any,receipt:any,names:any;

client=(await client_for(tmp_path,2,CALM));
try{(await hit_corbitt(client));
(await stakes(client));
const __unpack27594=(await stakes_receipts(client));receipt=__unpack27594[0];
names=(await rung_names());
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(receipt,"base"),"rung"),"calm");return pyBool(__left)?pyEqual(pyAt(receipt,"shifts"),IN_A_FIGHT):__left})())),"tests/kernel/test_npc_stakes.py:494 assert receipt[\"base\"][\"rung\"] == \"calm\" and receipt[\"shifts\"] == IN_A_FIGHT");
assert.ok(pyBool(pyEqual(pySubtract((await pyMethod(names,"index",[pyAt(receipt,"rung")],{})),(await pyMethod(names,"index",["calm"],{}))),1)),pyStr("+1, not +2"));
assert.ok(pyBool(pyEqual(pyAt(receipt,"rung"),"tense")),"tests/kernel/test_npc_stakes.py:496 assert receipt[\"rung\"] == \"tense\"");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_punch_that_opens_a_fight_is_one_rung_not_two"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_punch_that_opens_a_fight_is_one_rung_not_two(temporary);});
export async function test_all_three_violence_facts_at_once_are_still_one_rung(tmp_path:any){
let client:any,n:any,receipt:any;

client=(await client_for(tmp_path,2,CALM));
try{n=(await hit_corbitt(client));
(await narrate(client,`t1-c${n}`,"他挨了一拳，退到墙边。"));
(await pyMethod(client,"table",["player_input"],{"text":"I hit him again."}));
(await resolve(client,"t2-c1",({"intent":"combat","goal":"he swings back","method":"","actor":"Walter Corbitt","target":"Thomas Hayes"})));
(await resolve(client,"t2-c2",({"intent":"combat","goal":"combat:defend","method":"combat:defend","actor":"thomas-hayes","defense":"dodge"})));
(await resolve(client,"t2-c3",({"intent":"combat","goal":"hit him","method":"fists","target":"Walter Corbitt","weapon":"unarmed"})));
(await resolve(client,"t2-c4",({"intent":"combat","goal":"combat:defend","method":"combat:defend","actor":"Walter Corbitt","defense":"dodge"})));
(await stakes(client));
const __unpack28960=(await stakes_receipts(client));receipt=__unpack28960[0];
assert.ok(pyBool(pyEqual(pyAt(receipt,"shifts"),["attacked_this_turn","attacked_last_turn","in_fight_with_investigators"])),"tests/kernel/test_npc_stakes.py:515 assert receipt[\"shifts\"] == [\"attacked_this_turn\", \"attacked_last_turn\", \"in_fight_with_investigators\"]");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(receipt,"rung");const __term1="tense";const __term2=(await moved("calm",pyAt(receipt,"shifts")));return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),pyStr("three facts of one group: one rung"));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_all_three_violence_facts_at_once_are_still_one_rung"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_all_three_violence_facts_at_once_are_still_one_rung(temporary);});
export async function test_his_own_turn_of_the_fight_a_turn_after_the_punch_is_tense(tmp_path:any){
let client:any,n:any,receipt:any;

client=(await client_for(tmp_path,2,CALM));
try{n=(await hit_corbitt(client));
(await narrate(client,`t1-c${n}`,"他挨了一拳，退到墙边。"));
(await pyMethod(client,"table",["player_input"],{"text":"I grab the envelope."}));
assert.ok(pyBool((pyAt(pyAt((await situation(client)),"state"),"in_session")===true)),"tests/kernel/test_npc_stakes.py:529 assert situation(client)[\"state\"][\"in_session\"] is True");
(await stakes(client));
const __unpack29865=(await stakes_receipts(client));receipt=__unpack29865[0];
assert.ok(pyBool(pyEqual(pyAt(receipt,"shifts"),["attacked_last_turn","in_fight_with_investigators"])),"tests/kernel/test_npc_stakes.py:532 assert receipt[\"shifts\"] == [\"attacked_last_turn\", \"in_fight_with_investigators\"]");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(receipt,"rung");const __term1=(await moved("calm",pyAt(receipt,"shifts")));const __term2="tense";return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_npc_stakes.py:533 assert receipt[\"rung\"] == moved(\"calm\", receipt[\"shifts\"]) == \"tense\"");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_his_own_turn_of_the_fight_a_turn_after_the_punch_is_tense"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_his_own_turn_of_the_fight_a_turn_after_the_punch_is_tense(temporary);});
export async function test_last_turns_blow_moves_him_with_no_fight_running_and_only_the_newest_committed_turn_counts(tmp_path:any){
let client:any,n:any,record:any,second:any,third:any;

client=(await client_for(tmp_path,2,CALM));
try{n=(await hit_corbitt(client));
(await resolve(client,`t1-c${n}`,({"intent":"combat","goal":"both back off","method":"","decision":"combat:end","outcome":"stalemate"})));
assert.ok(pyBool((pyAt(pyAt((await pyMethod(client,"table",["look"],{})),"where"),"session")===null)),"tests/kernel/test_npc_stakes.py:545 assert client.table(\"look\")[\"where\"][\"session\"] is None");
(await narrate(client,`t1-c${pyAdd(n,1)}`,"两人都退开了。"));
record=(await read_json(pyDivide(pyDivide((await campaign_dir(client.workspace)),"turns"),"0001.json")));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(record,"receipts"))){__rows.push((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"roll");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["combat_action"],{})),"attack"):__left})());return pyBool(__left)?pyEqual((await pyMethod(r,"get",["npc"],{})),CORBITT):__left})()));}return __rows;})())))),pyStr("the committed turn holds the attack made against him"));
(await pyMethod(client,"table",["player_input"],{"text":"I watch him from the doorway."}));
assert.ok(pyBool((pyAt(pyAt((await situation(client)),"state"),"in_session")===false)),pyStr("no fight runs"));
(await stakes(client));
const __unpack31246=(await stakes_receipts(client));second=__unpack31246[0];
assert.ok(pyBool(pyEqual(pyAt(second,"shifts"),["attacked_last_turn"])),"tests/kernel/test_npc_stakes.py:555 assert second[\"shifts\"] == [\"attacked_last_turn\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(second,"rung"),(await moved("calm",["attacked_last_turn"])));return pyBool(__left)?(await at_least(pyAt(second,"rung"),"tense")):__left})())),"tests/kernel/test_npc_stakes.py:556 assert second[\"rung\"] == moved(\"calm\", [\"attacked_last_turn\"]) and at_least(second[\"rung\"], \"tense\")");
(await narrate(client,"t2-c1","他没有动。"));
(await pyMethod(client,"table",["player_input"],{"text":"I keep watching him."}));
(await stakes(client));
const __unpack31588=(await stakes_receipts(client));third=__unpack31588[0];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(third,"shifts"),[]);return pyBool(__left)?pyEqual(pyAt(third,"rung"),"calm"):__left})())),pyStr("a blow two committed turns back is not last turn's"));}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_last_turns_blow_moves_him_with_no_fight_running_and_only_the_newest_committed_turn_counts"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_last_turns_blow_moves_him_with_no_fight_running_and_only_the_newest_committed_turn_counts(temporary);});
export async function test_nothing_done_and_no_fight_is_calm_as_before(tmp_path:any){
let client:any,receipt:any;
client=(await client_for(tmp_path,7,CALM));
try{(await at_corbitt(client));
(await stakes(client));
const __unpack31960=(await stakes_receipts(client));receipt=__unpack31960[0];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"shifts"),[]);return pyBool(__left)?pyEqual(pyAt(receipt,"rung"),"calm"):__left})())),"tests/kernel/test_npc_stakes.py:573 assert receipt[\"shifts\"] == [] and receipt[\"rung\"] == \"calm\"");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_nothing_done_and_no_fight_is_calm_as_before"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_nothing_done_and_no_fight_is_calm_as_before(temporary);});

export async function certain_severe(table:any){
pyAt(pyAt(table,"rungs"),(-1))["severe_at_most"]=100;
pyAt(pyAt(table,"rungs"),(-1))["escalates_at_most"]=100;
}
export async function unknown_shift(table:any){
pyAt(table,"shifts")["outnumbered"]=({["step"]:1});
}
export async function default_is_no_rung(table:any){
table["default_rung"]="furious";
}
export async function falling_rungs(table:any){
pyAt(pyAt(table,"rungs"),0)["severe_at_most"]=pyAdd(pyAt(pyAt(pyAt(table,"rungs"),(-1)),"severe_at_most"),1);
}
export async function fight_shift_with_a_parameter(table:any){

pyAt(pyAt(table,"shifts"),"in_fight_with_investigators")["hp_fraction_at_most"]=0.5;
}
export async function last_turn_shift_without_an_integer_step(table:any){
pyAt(pyAt(table,"shifts"),"attacked_last_turn")["step"]=0.5;
}
export async function shift_names_an_undeclared_group(table:any){
pyAt(pyAt(table,"shifts"),"hp_at_most_half")["group"]="rage";
}
export async function group_of_one_shift(table:any){
let name:any;
for(name of pyIterable(["attacked_last_turn","in_fight_with_investigators"])){
delete pyAt(pyAt(table,"shifts"),name)["group"];
}
}
export async function group_whose_steps_move_both_ways(table:any){
pyAt(pyAt(table,"shifts"),"stance_friendly")["group"]="violence";
}
export async function group_without_a_note(table:any){
pyAt(table,"shift_groups")["violence"]=" ";
}
export let BROKEN:any=[certain_severe,unknown_shift,default_is_no_rung,falling_rungs,fight_shift_with_a_parameter,last_turn_shift_without_an_integer_step,shift_names_an_undeclared_group,group_of_one_shift,group_whose_steps_move_both_ways,group_without_a_note];
export async function test_a_table_the_kernel_cannot_read_is_refused_and_nothing_is_rolled(tmp_path:any,breaking:any){
let content:any,path:any,table:any,client:any,error:any;
content=pyDivide(tmp_path,"content");
(await pyMethod(shutil,"copytree",[CONTENT_DIR,content],{}));
path=pyDivide(pyDivide(pyDivide(pyDivide(content,"rulesets"),"coc7"),"rules-json"),"npc-stakes.json");
table=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))],{}));
(await breaking(table));
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[table],{}))],{"encoding":"utf-8"}));
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"}),"content":content})));
try{(await open_turn(client,"I ask around the neighbourhood."));
error=(await pyMethod(client,"err",["npc.stakes",({["campaign"]:"c1",["name"]:"Mr. Dooley"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"campaign_not_ready");return pyBool(__left)?pyContains(pyAt(error,"fix"),"npc-stakes.json"):__left})())),"tests/kernel/test_npc_stakes.py:639 assert error[\"code\"] == \"campaign_not_ready\" and \"npc-stakes.json\" in error[\"fix\"]");
assert.ok(pyBool(pyEqual((await stakes_receipts(client)),[])),"tests/kernel/test_npc_stakes.py:640 assert stakes_receipts(client) == []");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("breaking",BROKEN))).entries())test("test_a_table_the_kernel_cannot_read_is_refused_and_nothing_is_rolled"+((pyCartesian([{}],pyParametrize("breaking",BROKEN))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_table_the_kernel_cannot_read_is_refused_and_nothing_is_rolled(temporary,row["breaking"]);});

export async function falling_surprise(table:any){
pyAt(pyAt(table,"rungs"),1)["surprise_at_most"]=pySubtract(pyAt(pyAt(pyAt(table,"rungs"),0),"surprise_at_most"),1);
}
export async function falling_escalates(table:any){
pyAt(pyAt(table,"rungs"),(-1))["escalates_at_most"]=pySubtract(pyAt(pyAt(pyAt(table,"rungs"),(-2)),"escalates_at_most"),1);
}
export async function surprise_off_the_die(table:any){
pyAt(pyAt(table,"rungs"),(-1))["surprise_at_most"]=101;
}
export async function no_surprise_column(table:any){
delete pyAt(pyAt(table,"rungs"),0)["surprise_at_most"];
}
export async function no_permission_line(table:any){
delete pyAt(pyAt(pyAt(table,"rungs"),0),"lines")["surprise"];
}
export async function no_severe_permission_line(table:any){
delete pyAt(pyAt(pyAt(table,"rungs"),2),"lines")["severe_surprise"];
}
export let SURPRISE_BROKEN:any=[falling_surprise,falling_escalates,surprise_off_the_die,no_surprise_column,no_permission_line,no_severe_permission_line];
export async function with_table(tmp_path:any,change:any){
let content:any,path:any,table:any;
content=pyDivide(tmp_path,"content");
(await pyMethod(shutil,"copytree",[CONTENT_DIR,content],{}));
path=pyDivide(pyDivide(pyDivide(pyDivide(content,"rulesets"),"coc7"),"rules-json"),"npc-stakes.json");
table=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))],{}));
(await change(table));
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[table],{}))],{"encoding":"utf-8"}));
return content;
}
export async function test_a_column_that_falls_or_a_missing_surprise_is_refused_before_a_roll(tmp_path:any,breaking:any){
let client:any,error:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"}),"content":(await with_table(tmp_path,breaking))})));
try{(await open_turn(client,"I ask around the neighbourhood."));
error=(await pyMethod(client,"err",["npc.stakes",({["campaign"]:"c1",["name"]:"Mr. Dooley"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"campaign_not_ready");return pyBool(__left)?pyContains(pyAt(error,"fix"),"npc-stakes.json"):__left})())),pyStr(error));
assert.ok(pyBool(pyEqual((await stakes_receipts(client)),[])),"tests/kernel/test_npc_stakes.py:690 assert stakes_receipts(client) == []");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("breaking",SURPRISE_BROKEN))).entries())test("test_a_column_that_falls_or_a_missing_surprise_is_refused_before_a_roll"+((pyCartesian([{}],pyParametrize("breaking",SURPRISE_BROKEN))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_column_that_falls_or_a_missing_surprise_is_refused_before_a_roll(temporary,row["breaking"]);});
export async function test_a_table_whose_columns_rise_or_stay_is_read(tmp_path:any){
let client:any,view:any,receipt:any;

async function level(table:any){
let rung:any;
for(rung of pyIterable(pyAt(table,"rungs"))){
rung["surprise_at_most"]=25;
}
}
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"}),"content":(await with_table(tmp_path,level))})));
try{(await open_turn(client,"I ask around the neighbourhood."));
view=pyAt((await stakes(client,"Mr. Dooley")),"stakes");
const __unpack36823=(await stakes_receipts(client));receipt=__unpack36823[0];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"surprise_at_most"),25);return pyBool(__left)?(pyAt(view,"surprise")===(pyLessEqual(pyAt(receipt,"roll"),25))):__left})())),"tests/kernel/test_npc_stakes.py:705 assert receipt[\"surprise_at_most\"] == 25 and view[\"surprise\"] is (receipt[\"roll\"] <= 25)");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_table_whose_columns_rise_or_stay_is_read"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_table_whose_columns_rise_or_stay_is_read(temporary);});
export async function test_the_shipped_columns_are_the_tickets_and_rise_with_the_rung(){
let columns:any,values:any,column:any,rung:any;
columns=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const rung of pyIterable(pyAt((await rules()),"rungs"))){__rows.push([pyAt(rung,"name"),[pyAt(rung,"severe_at_most"),pyAt(rung,"escalates_at_most"),pyAt(rung,"surprise_at_most")]]);}return __rows;})()));
assert.ok(pyBool(pyEqual(columns,({["calm"]:[3,15,10],["tense"]:[8,30,20],["dangerous"]:[15,45,30],["lethal"]:[30,65,45]}))),pyStr("ticket 20's table"));
values=(await pyList((await pyMethod(columns,"values",[],{}))));
for(column of pyIterable((await pyRange(3)))){
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const [a,b] of pyIterable((await pyZip(values,pySlice(values,1,undefined))))){__rows.push(pyLessEqual(pyAt(a,column),pyAt(b,column)));}return __rows;})())))),pyStr(`column ${column} rises with the rung`));
}
for(rung of pyIterable(pyAt((await rules()),"rungs"))){
assert.ok(pyBool(pyEqual((await pySet(pyAt(rung,"lines"))),new Set(["severe","escalates","surprise","severe_surprise"]))),"tests/kernel/test_npc_stakes.py:717 assert set(rung[\"lines\"]) == {\"severe\", \"escalates\", \"surprise\", \"severe_surprise\"}");
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_shipped_columns_are_the_tickets_and_rise_with_the_rung"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_shipped_columns_are_the_tickets_and_rise_with_the_rung();});
export async function test_the_shipped_table_names_every_disposition_and_archetype_and_no_certain_rung(){
let table:any,names:any,archetypes:any,disposition:any;
table=(await rules());
assert.ok(pyBool(pyEqual(pyAt(table,"contract_id"),"coc.npc-stakes.v1")),"tests/kernel/test_npc_stakes.py:722 assert table[\"contract_id\"] == \"coc.npc-stakes.v1\"");
names=(await rung_names());
archetypes=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(pyDivide(pyDivide(CONTENT_DIR,"rulesets"),"coc7"),"rules-json"),"npc-stat-archetypes.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
assert.ok(pyBool(pyEqual((await pySet(pyAt(table,"base_by_archetype"))),new Set((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(pyAt(archetypes,"archetypes"))){__rows.push(pyAt(a,"archetype_id"));}return __rows;})())))),"tests/kernel/test_npc_stakes.py:725 assert set(table[\"base_by_archetype\"]) == {a[\"archetype_id\"] for a in archetypes[\"archetypes\"]}");
disposition=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(pyDivide(pyDivide(CONTENT_DIR,"rulesets"),"coc7"),"rules-json"),"npc-combat-disposition.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
assert.ok(pyBool(pyEqual((await pySet(pyAt(table,"base_by_disposition"))),(await pySet(pyAt(disposition,"dispositions"))))),"tests/kernel/test_npc_stakes.py:727 assert set(table[\"base_by_disposition\"]) == set(disposition[\"dispositions\"])");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const rung of pyIterable(pyAt(table,"rungs"))){__rows.push(pyLess(pyAt(rung,"severe_at_most"),100));}return __rows;})())))),pyStr("no rung makes severe certain (spec D9)"));
assert.ok(pyBool(pyContains(names,pyAt(table,"default_rung"))),"tests/kernel/test_npc_stakes.py:729 assert table[\"default_rung\"] in names");
assert.ok(pyBool(pyEqual((await pySet(pyAt(table,"shifts"))),new Set(["attacked_this_turn","attacked_last_turn","in_fight_with_investigators","hp_at_most_half","table_clock_past_half","stance_friendly"]))),"tests/kernel/test_npc_stakes.py:730 assert set(table[\"shifts\"]) == {\"attacked_this_turn\", \"attacked_last_turn\", \"in_fight_with_investigators\", \"hp_at_most_half\",\n                                    \"table_clock_past_half\", \"stance_friendly\"}");
assert.ok(pyBool(pyEqual((await pySet(pyAt(table,"shift_groups"))),new Set(["violence"]))),"tests/kernel/test_npc_stakes.py:733 assert set(table[\"shift_groups\"]) == {\"violence\"}");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const [name,shift] of pyIterable((await pyMethod(pyAt(table,"shifts"),"items",[],{})))){if(pyBool(pyEqual((await pyMethod(shift,"get",["group"],{})),"violence"))){__rows.push(name);}}return __rows;})())),new Set(["attacked_this_turn","attacked_last_turn","in_fight_with_investigators"]))),"tests/kernel/test_npc_stakes.py:734 assert {name for name, shift in table[\"shifts\"].items() if shift.get(\"group\") == \"violence\"} == \\\n        {\"attacked_this_turn\", \"attacked_last_turn\", \"in_fight_with_investigators\"}");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const name of pyIterable(["hp_at_most_half","table_clock_past_half","stance_friendly"])){__rows.push(pyContains(pyAt(pyAt(table,"shifts"),name),"group"));}return __rows;})()))))),"tests/kernel/test_npc_stakes.py:736 assert not any(\"group\" in table[\"shifts\"][name] for name in (\"hp_at_most_half\", \"table_clock_past_half\", \"stance_friendly\"))");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_shipped_table_names_every_disposition_and_archetype_and_no_certain_rung"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_shipped_table_names_every_disposition_and_archetype_and_no_certain_rung();});
