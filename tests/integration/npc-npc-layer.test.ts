import {importSource,ROOT} from './support.ts';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
// Migrated from tests/kernel/test_npc_layer.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,ModuleGraph,StanceTable,RuleTables,CONTENT_DIR,check_draft,ModuleStore,where_section,npc_entry,npc_view,OPENING_SCENE,campaign_dir,narrate,open_turn,read_json,resolve,resolve_err,RpcClient,create_campaign,WORKTREE,indexed,request,claim,observed,write,finish,walk_to_confrontation,opening,confirmed_investigator,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";














export let KNOTT:any="npc-steven-knott";
export let CONTENT:any=CONTENT_DIR;
export async function ledger(client:any){
return (await read_json(pyDivide((await campaign_dir(client.workspace)),"npc-ledger.json")));
}
export async function present(client:any){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt((await pyMethod(client,"table",["look"],{"focus":"npc"})),"present"))){__rows.push([pyAt(p,"name"),p]);}return __rows;})()));
}
export async function charm(client:any,call_id:any,extra:any={}){
return (await resolve(client,call_id,({"intent":"social","goal":"get the keys and the story","method":"charm him","target":"Steven Knott","stakes":"he clams up",...extra})));
}

export async function test_the_dossier_is_read_the_same_way_from_a_starter_and_a_built_book(){
let starter:any,knott:any,profile:any,bare:any;

starter=(await ModuleGraph("the-haunting",pyDivide(pyDivide(pyDivide(CONTENT,"starters"),"the-haunting"),"module-graph.json")));
knott=pyAt(starter.nodes,KNOTT);
profile=(await pyMethod(starter,"npc_profile",[knott],{}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyAt(profile,"agenda");return pyBool(__left)?pyAt(profile,"fear"):__left})());return pyBool(__left)?pyAt(profile,"secret"):__left})())),"tests/kernel/test_npc_layer.py:51 assert profile[\"agenda\"] and profile[\"fear\"] and profile[\"secret\"]");
assert.ok(pyBool(pyEqual(pyAt(profile,"relationship_to_investigators"),"employer")),"tests/kernel/test_npc_layer.py:52 assert profile[\"relationship_to_investigators\"] == \"employer\"");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable((await pyMethod(starter,"npc_knows",[knott],{})))){__rows.push(pyAt(entry,"handle"));}return __rows;})())),new Set(["knott-commission","knott-research-leads","knott-macario-summary"]))),"tests/kernel/test_npc_layer.py:54 assert {entry[\"handle\"] for entry in starter.npc_knows(knott)} == {\n        \"knott-commission\", \"knott-research-leads\", \"knott-macario-summary\"}");
assert.ok(pyBool(((await pyMethod(starter,"npc_has_material",[knott],{}))===true)),"tests/kernel/test_npc_layer.py:56 assert starter.npc_has_material(knott) is True");
bare=({["node_id"]:"npc-bare",["node_kind"]:"npc",["name"]:"Bare",["properties"]:({["STR"]:50,["role"]:"guard"})});
starter.nodes["npc-bare"]=bare;
assert.ok(pyBool(pyEqual((await pyMethod(starter,"npc_profile",[bare],{})),({}))),"tests/kernel/test_npc_layer.py:63 assert starter.npc_profile(bare) == {}");
assert.ok(pyBool(((await pyMethod(starter,"npc_has_material",[bare],{}))===false)),"tests/kernel/test_npc_layer.py:64 assert starter.npc_has_material(bare) is False");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_dossier_is_read_the_same_way_from_a_starter_and_a_built_book"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_dossier_is_read_the_same_way_from_a_starter_and_a_built_book();});
export async function test_what_someone_would_say_instead_reaches_the_projection(){
let starter:any,dooley:any,said:any,knott:any;

starter=(await ModuleGraph("the-haunting",pyDivide(pyDivide(pyDivide(CONTENT,"starters"),"the-haunting"),"module-graph.json")));
dooley=(await pyMethod(starter,"npc",["Mr. Dooley"],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable((await pyMethod(starter,"npc_claims",[dooley,"asserts"],{})))){__rows.push(pyAt(pyAt(c,"object"),"node_id"));}return __rows;})()),["clue-burning-eyes-form"])),"tests/kernel/test_npc_layer.py:74 assert [c[\"object\"][\"node_id\"] for c in starter.npc_claims(dooley, \"asserts\")] == [\"clue-burning-eyes-form\"]");
said=(await pyMethod(starter,"npc_would_say",[dooley],{}));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(said)){__rows.push(pyContains(line,"memory improves"));}return __rows;})())))),pyStr(said));
assert.ok(pyBool(pyEqual((await pyLen(said)),2)),"tests/kernel/test_npc_layer.py:77 assert len(said) == 2");
knott=(await pyMethod(starter,"npc",["Steven Knott"],{}));
assert.ok(pyBool(pyEqual((await pyMethod(starter,"npc_claims",[knott,"asserts"],{})),[])),"tests/kernel/test_npc_layer.py:80 assert starter.npc_claims(knott, \"asserts\") == []");
assert.ok(pyBool(pyEqual((await pyMethod(starter,"npc_would_say",[knott],{})),["Start with the papers; we can discuss the rest when you have something concrete."])),"tests/kernel/test_npc_layer.py:81 assert starter.npc_would_say(knott) == [\n        \"Start with the papers; we can discuss the rest when you have something concrete.\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_what_someone_would_say_instead_reaches_the_projection"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_what_someone_would_say_instead_reaches_the_projection();});
export async function test_an_assertion_someone_holds_true_is_a_belief_not_a_lie(){
let starter:any,node:any,line:any,status:any,would_say:any,beliefs:any,dooley:any;

starter=(await ModuleGraph("the-haunting",pyDivide(pyDivide(pyDivide(CONTENT,"starters"),"the-haunting"),"module-graph.json")));
node=({["node_id"]:"npc-under-test",["node_kind"]:"npc",["name"]:"Under Test",["properties"]:({})});
starter.nodes["npc-under-test"]=node;
line=pyAt(pyAt(starter.nodes,"clue-burning-eyes-form"),"summary");
async function assert_as(status:any){
starter.claims_by_subject["npc-under-test"]=[({["subject_id"]:"npc-under-test",["predicate"]:"asserts",["truth_status"]:status,["object"]:({["node_id"]:"clue-burning-eyes-form"})})];
return [(await pyMethod(starter,"npc_would_say",[node],{})),(await pyMethod(starter,"npc_beliefs",[node],{}))];
}
for(status of pyIterable(["authored-lie","authored-rumor"])){
const __unpack5058=(await assert_as(status));would_say=__unpack5058[0];beliefs=__unpack5058[1];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(would_say,[line]);return pyBool(__left)?pyEqual(beliefs,[]):__left})())),pyStr(status));
}
const __unpack5245=(await assert_as("authored-belief"));would_say=__unpack5245[0];beliefs=__unpack5245[1];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(beliefs,[line]);return pyBool(__left)?pyEqual(would_say,[]):__left})())),"tests/kernel/test_npc_layer.py:106 assert beliefs == [line] and would_say == []");
dooley=(await pyMethod(starter,"npc",["Mr. Dooley"],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable((await pyMethod(starter,"npc_claims",[dooley,"asserts"],{})))){__rows.push(pyAt(c,"truth_status"));}return __rows;})()),["authored-lie"])),"tests/kernel/test_npc_layer.py:110 assert [c[\"truth_status\"] for c in starter.npc_claims(dooley, \"asserts\")] == [\"authored-lie\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_assertion_someone_holds_true_is_a_belief_not_a_lie"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_assertion_someone_holds_true_is_a_belief_not_a_lie();});
export async function test_ties_come_from_the_relations_the_graph_already_has(){
let starter:any,corbitt:any,kinds:any;

starter=(await ModuleGraph("the-haunting",pyDivide(pyDivide(pyDivide(CONTENT,"starters"),"the-haunting"),"module-graph.json")));
corbitt=(await pyMethod(starter,"npc",["Walter Corbitt"],{}));
kinds=new Set((await (async()=>{const __rows:any[]=[];for(const tie of pyIterable((await pyMethod(starter,"npc_ties",[corbitt],{})))){__rows.push(pyAt(tie,"kind"));}return __rows;})()));
assert.ok(pyBool(pyLessEqual(kinds,(await pySet((await (async()=>{const __left=starter.npc_ties.__doc__;return pyBool(__left)?["allied-with","opposes","member-of","controls","owns","possesses","worships","threatens","impersonates","located-in"]:__left})()))))),"tests/kernel/test_npc_layer.py:119 assert kinds <= set(starter.npc_ties.__doc__ and\n                        (\"allied-with\", \"opposes\", \"member-of\", \"controls\", \"owns\", \"possesses\",\n                         \"worships\", \"threatens\", \"impersonates\", \"located-in\"))");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_ties_come_from_the_relations_the_graph_already_has"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_ties_come_from_the_relations_the_graph_already_has();});

export async function test_the_stance_numbers_all_live_in_the_table(){
let table:any;

table=(await StanceTable((await RuleTables(pyDivide(pyDivide(pyDivide(CONTENT,"rulesets"),"coc7"),"rules-json")))));
assert.ok(pyBool(pyEqual(table.words,["hostile","wary","neutral","warm"])),"tests/kernel/test_npc_layer.py:130 assert table.words == [\"hostile\", \"wary\", \"neutral\", \"warm\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const s of pyIterable([(-5),(-3),(-2),0,1,2,5])){__rows.push((await pyMethod(table,"word",[s],{})));}return __rows;})()),["hostile","hostile","wary","neutral","neutral","warm","warm"])),"tests/kernel/test_npc_layer.py:131 assert [table.word(s) for s in (-5, -3, -2, 0, 1, 2, 5)] == [\n        \"hostile\", \"hostile\", \"wary\", \"neutral\", \"neutral\", \"warm\", \"warm\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(table,"delta",["persuade","regular"],{})),1);return pyBool(__left)?pyEqual((await pyMethod(table,"delta",["persuade","extreme"],{})),2):__left})())),"tests/kernel/test_npc_layer.py:133 assert table.delta(\"persuade\", \"regular\") == 1 and table.delta(\"persuade\", \"extreme\") == 2");
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(table,"delta",["intimidate","regular"],{})),0);return pyBool(__left)?pyEqual((await pyMethod(table,"delta",["intimidate","failure"],{})),(-1)):__left})())),"tests/kernel/test_npc_layer.py:134 assert table.delta(\"intimidate\", \"regular\") == 0 and table.delta(\"intimidate\", \"failure\") == -1");
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(table,"delta",["nonesuch","regular"],{})),0);return pyBool(__left)?pyEqual((await pyMethod(table,"delta",["persuade","nonesuch"],{})),0):__left})())),"tests/kernel/test_npc_layer.py:135 assert table.delta(\"nonesuch\", \"regular\") == 0 and table.delta(\"persuade\", \"nonesuch\") == 0");
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(table,"clamp",[99],{})),5);return pyBool(__left)?pyEqual((await pyMethod(table,"clamp",[(-99)],{})),(-5)):__left})())),"tests/kernel/test_npc_layer.py:136 assert table.clamp(99) == 5 and table.clamp(-99) == -5");
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(table,"floor_of",["warm"],{})),2);return pyBool(__left)?pyEqual((await pyMethod(table,"floor_of",["hostile"],{})),(-5)):__left})())),"tests/kernel/test_npc_layer.py:137 assert table.floor_of(\"warm\") == 2 and table.floor_of(\"hostile\") == -5");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_stance_numbers_all_live_in_the_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_stance_numbers_all_live_in_the_table();});

export async function test_apply_npc_moves_someone_on_and_off_the_stage(kernel:any){
let result:any;
(await open_turn(kernel));
assert.ok(pyBool(pyContains((await present(kernel)),"Steven Knott")),"tests/kernel/test_npc_layer.py:144 assert \"Steven Knott\" in present(kernel)");
result=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["to"]:"away",["why"]:"he leaves for the bank"})]}));
assert.ok(pyBool(pyEqual(pyAt(result,"receipts"),["npc:steven-knott-t1-c1"])),"tests/kernel/test_npc_layer.py:147 assert result[\"receipts\"] == [\"npc:steven-knott-t1-c1\"]");
assert.ok(pyBool(!pyContains((await present(kernel)),"Steven Knott")),"tests/kernel/test_npc_layer.py:148 assert \"Steven Knott\" not in present(kernel)");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["to"]:"here"})]}));
assert.ok(pyBool(pyContains((await present(kernel)),"Steven Knott")),"tests/kernel/test_npc_layer.py:151 assert \"Steven Knott\" in present(kernel)");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"world.json"))),"npc_presence"),"steven-knott"),OPENING_SCENE)),"tests/kernel/test_npc_layer.py:152 assert read_json(campaign_dir(kernel.workspace) / \"world.json\")[\"npc_presence\"][\"steven-knott\"] == OPENING_SCENE");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_apply_npc_moves_someone_on_and_off_the_stage"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_apply_npc_moves_someone_on_and_off_the_stage(await kernel(t,{}));});
export async function test_apply_npc_needs_something_to_do_and_a_word_the_ledger_knows(kernel:any){
let empty:any,bad:any;
(await open_turn(kernel));
empty=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott"})]}));
assert.ok(pyBool(pyEqual(pyAt(empty,"code"),"invalid_params")),"tests/kernel/test_npc_layer.py:158 assert empty[\"code\"] == \"invalid_params\"");
bad=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["stance"]:"furious"})]}));
assert.ok(pyBool(pyEqual(pyAt(bad,"code"),"invalid_params")),"tests/kernel/test_npc_layer.py:161 assert bad[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyContains((await present(kernel)),"Steven Knott")),"tests/kernel/test_npc_layer.py:163 assert \"Steven Knott\" in present(kernel)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_apply_npc_needs_something_to_do_and_a_word_the_ledger_knows"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_apply_npc_needs_something_to_do_and_a_word_the_ledger_knows(await kernel(t,{}));});
export async function test_apply_npc_conditions_write_the_existing_body_store_and_standard_receipt(kernel:any){
let applied:any,state:any,delivered:any,card:any;
(await open_turn(kernel));
applied=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["conditions"]:({["gained"]:["unconscious"]}),["why"]:"the poison took hold"})]}));
assert.ok(pyBool(pyEqual(pyAt(applied,"receipts"),["condition:steven-knott-t1-c1"])),"tests/kernel/test_npc_layer.py:173 assert applied[\"receipts\"] == [\"condition:steven-knott-t1-c1\"]");
state=pyAt(pyAt((await present(kernel)),"Steven Knott"),"state");
assert.ok(pyBool(pyEqual(pyAt(state,"conditions"),["unconscious"])),"tests/kernel/test_npc_layer.py:175 assert state[\"conditions\"] == [\"unconscious\"]");
assert.ok(pyBool(pyEqual(pyAt(state,"incapacitated"),["unconscious"])),"tests/kernel/test_npc_layer.py:176 assert state[\"incapacitated\"] == [\"unconscious\"]");
assert.ok(pyBool(pyContains(pyAt(state,"cannot_act"),"takes no action")),"tests/kernel/test_npc_layer.py:177 assert \"takes no action\" in state[\"cannot_act\"]");
delivered=(await narrate(kernel,"t1-c2","诺特失去知觉，倒在椅中。"));
card=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(delivered,"mechanics"))){if(pyBool(pyEqual(pyAt(row,"kind"),"condition"))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(card,"gained"),["unconscious"]);return pyBool(__left)?pyEqual(pyAt(card,"lost"),[]):__left})())),"tests/kernel/test_npc_layer.py:181 assert card[\"gained\"] == [\"unconscious\"] and card[\"lost\"] == []");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(card,"standing"),["unconscious"]);return pyBool(__left)?pyEqual(pyAt(card,"incapacitated"),["unconscious"]):__left})())),"tests/kernel/test_npc_layer.py:182 assert card[\"standing\"] == [\"unconscious\"] and card[\"incapacitated\"] == [\"unconscious\"]");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(card,"subject_is_investigator")===false);return pyBool(__left)?pyEqual(pyAt(card,"subject_label"),"Steven Knott"):__left})())),"tests/kernel/test_npc_layer.py:183 assert card[\"subject_is_investigator\"] is False and card[\"subject_label\"] == \"Steven Knott\"");
(await pyMethod(kernel,"table",["player_input"],{"text":"我检查他的呼吸。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["conditions"]:({["lost"]:["unconscious"]}),["why"]:"the poison passed"})]}));
assert.ok(pyBool(!pyContains(pyAt((await present(kernel)),"Steven Knott"),"state")),"tests/kernel/test_npc_layer.py:191 assert \"state\" not in present(kernel)[\"Steven Knott\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_apply_npc_conditions_write_the_existing_body_store_and_standard_receipt"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_apply_npc_conditions_write_the_existing_body_store_and_standard_receipt(await kernel(t,{}));});
export async function test_apply_npc_conditions_reject_unknown_overlap_death_and_combined_mutation(kernel:any){
let conditions:any,error:any,combined:any;
(await open_turn(kernel));
for(conditions of pyIterable([({}),({["gained"]:["sleepy"]}),({["gained"]:["unconscious"],["lost"]:["unconscious"]}),({["lost"]:["dead"]})])){
error=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["conditions"]:conditions})]}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_npc_layer.py:200 assert error[\"code\"] == \"invalid_params\"");
}
combined=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["to"]:"away",["conditions"]:({["gained"]:["unconscious"]})})]}));
assert.ok(pyBool(pyEqual(pyAt(combined,"code"),"invalid_params")),"tests/kernel/test_npc_layer.py:205 assert combined[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(!pyContains((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"world.json"))),"npc_resources")),"tests/kernel/test_npc_layer.py:206 assert \"npc_resources\" not in read_json(campaign_dir(kernel.workspace) / \"world.json\")");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_apply_npc_conditions_reject_unknown_overlap_death_and_combined_mutation"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_apply_npc_conditions_reject_unknown_overlap_death_and_combined_mutation(await kernel(t,{}));});
export async function test_the_keeper_can_set_a_stance_and_the_reason_reaches_the_capsule(kernel:any){
let row:any,capsule:any,knott:any;
(await open_turn(kernel));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["stance"]:"warm",["why"]:"the party found his brother"})]}));
(await narrate(kernel,"t1-c2","诺特松了口气。"));
row=pyAt((await ledger(kernel)),KNOTT);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(row,"stance"),"value"),"warm");return pyBool(__left)?pyEqual(pyAt(pyAt(row,"stance"),"score"),2):__left})())),"tests/kernel/test_npc_layer.py:215 assert row[\"stance\"][\"value\"] == \"warm\" and row[\"stance\"][\"score\"] == 2");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(row,"stance"),"because"),(-1)),"how"),"keeper")),"tests/kernel/test_npc_layer.py:216 assert row[\"stance\"][\"because\"][-1][\"how\"] == \"keeper\"");
capsule=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我再问他一句。"})),"capsule");
knott=pyAt(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(capsule,"present"))){__rows.push([pyAt(p,"name"),p]);}return __rows;})())),"Steven Knott");
assert.ok(pyBool(pyEqual(pyAt(pyAt(knott,"toward_party"),"stance"),"warm")),"tests/kernel/test_npc_layer.py:221 assert knott[\"toward_party\"][\"stance\"] == \"warm\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(knott,"toward_party"),"because"),(-1)),"turn 1: keeper set warm: the party found his brother")),"tests/kernel/test_npc_layer.py:222 assert knott[\"toward_party\"][\"because\"][-1] == \"turn 1: keeper set warm: the party found his brother\"");
assert.ok(pyBool(pyEqual(knott,pyAt((await present(kernel)),"Steven Knott"))),"tests/kernel/test_npc_layer.py:223 assert knott == present(kernel)[\"Steven Knott\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_keeper_can_set_a_stance_and_the_reason_reaches_the_capsule"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_keeper_can_set_a_stance_and_the_reason_reaches_the_capsule(await kernel(t,{}));});

export async function test_a_settled_social_check_moves_the_stance_by_the_table(seeded_four:any){
let outcome:any,table:any,expected:any,row:any,interaction:any,capsule:any,knott:any;

(await open_turn(seeded_four));
outcome=pyAt((await resolve(seeded_four,"t1-c1",({"intent":"social","goal":"get the keys and the story","method":"persuade him","target":"Steven Knott","stakes":"he clams up"}))),"outcome");
assert.ok(pyBool(pyEqual([pyAt(outcome,"approach"),pyAt(outcome,"level"),pyAt(outcome,"passed")],["persuade","regular",true])),"tests/kernel/test_npc_layer.py:236 assert (outcome[\"approach\"], outcome[\"level\"], outcome[\"passed\"]) == (\"persuade\", \"regular\", True)");
(await narrate(seeded_four,"t1-c2","诺特看着他，慢慢开口。"));
table=(await StanceTable((await RuleTables(pyDivide(pyDivide(pyDivide(CONTENT,"rulesets"),"coc7"),"rules-json")))));
expected=(await pyMethod(table,"delta",["persuade","regular"],{}));
assert.ok(pyBool(pyEqual(expected,1)),"tests/kernel/test_npc_layer.py:241 assert expected == 1");
row=pyAt((await ledger(seeded_four)),KNOTT);
interaction=pyAt(pyAt(row,"interactions"),(-1));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(interaction,"kind"),"social");return pyBool(__left)?pyEqual(pyAt(interaction,"turn"),1):__left})())),"tests/kernel/test_npc_layer.py:244 assert interaction[\"kind\"] == \"social\" and interaction[\"turn\"] == 1");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(interaction,"approach"),"persuade");return pyBool(__left)?pyEqual(pyAt(interaction,"level"),"regular"):__left})())),"tests/kernel/test_npc_layer.py:245 assert interaction[\"approach\"] == \"persuade\" and interaction[\"level\"] == \"regular\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(row,"stance"),"score"),expected);return pyBool(__left)?pyEqual(pyAt(pyAt(row,"stance"),"value"),(await pyMethod(table,"word",[expected],{}))):__left})())),"tests/kernel/test_npc_layer.py:246 assert row[\"stance\"][\"score\"] == expected and row[\"stance\"][\"value\"] == table.word(expected)");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(row,"stance"),"because"),(-1)),"receipt"),pyAt(interaction,"receipt"))),"tests/kernel/test_npc_layer.py:248 assert row[\"stance\"][\"because\"][-1][\"receipt\"] == interaction[\"receipt\"]");
capsule=pyAt((await pyMethod(seeded_four,"table",["player_input"],{"text":"我等他回话。"})),"capsule");
knott=pyAt(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(capsule,"present"))){__rows.push([pyAt(p,"name"),p]);}return __rows;})())),"Steven Knott");
assert.ok(pyBool(pyEqual(pyAt(knott,"toward_party"),({["stance"]:"neutral",["because"]:["turn 1: persuade regular"]}))),"tests/kernel/test_npc_layer.py:253 assert knott[\"toward_party\"] == {\"stance\": \"neutral\", \"because\": [\"turn 1: persuade regular\"]}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(knott,"history"),"met_turns"),2)),"tests/kernel/test_npc_layer.py:254 assert knott[\"history\"][\"met_turns\"] == 2");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_settled_social_check_moves_the_stance_by_the_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_settled_social_check_moves_the_stance_by_the_table(await kernel(t,{env:{COC_KERNEL_SEED:'4'}}));});
export async function test_a_social_level_the_table_gives_nothing_for_leaves_the_stance_alone(kernel:any){
let outcome:any,row:any,table:any;

(await open_turn(kernel));
outcome=pyAt((await charm(kernel,"t1-c1")),"outcome");
(await narrate(kernel,"t1-c2","诺特没接话。"));
row=pyAt((await ledger(kernel)),KNOTT);
table=(await StanceTable((await RuleTables(pyDivide(pyDivide(pyDivide(CONTENT,"rulesets"),"coc7"),"rules-json")))));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(row,"interactions"),(-1)),"kind"),"social")),"tests/kernel/test_npc_layer.py:265 assert row[\"interactions\"][-1][\"kind\"] == \"social\"");
if(pyBool(pyEqual((await pyMethod(table,"delta",[(await pyMethod(outcome,"get",["approach"],{})),(await pyMethod(outcome,"get",["level"],{}))],{})),0))){assert.ok(pyBool((pyAt(row,"stance")===null)),"tests/kernel/test_npc_layer.py:267 assert row[\"stance\"] is None");}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_social_level_the_table_gives_nothing_for_leaves_the_stance_alone"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_social_level_the_table_gives_nothing_for_leaves_the_stance_alone(await kernel(t,{}));});
export async function test_a_pushed_social_failure_still_reaches_the_stance(seeded_one:any){
let action:any,first:any,pushed:any,receipts:any,push_receipt:any,table:any,row:any,expected:any,entry:any;

(await open_turn(seeded_one));
action=({["intent"]:"social",["goal"]:"get the keys and the story",["method"]:"charm him",["target"]:"Steven Knott",["stakes"]:"he clams up"});
first=pyAt((await resolve(seeded_one,"t1-c1",({...action}))),"outcome");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(first,"passed")===false);return pyBool(__left)?pyEqual(pyAt(first,"approach"),"charm"):__left})())),"tests/kernel/test_npc_layer.py:280 assert first[\"passed\"] is False and first[\"approach\"] == \"charm\"");
pushed=pyAt((await resolve(seeded_one,"t1-c2",({...({...action,["push"]:true,["stakes"]:"he throws me out"})}))),"outcome");
assert.ok(pyBool(pyEqual(pyAt(pushed,"kind"),"push")),"tests/kernel/test_npc_layer.py:283 assert pushed[\"kind\"] == \"push\"");
(await narrate(seeded_one,"t1-c3","诺特把钥匙收了回去。"));
receipts=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await read_json(pyDivide(pyDivide((await campaign_dir(seeded_one.workspace)),"turns"),"0001.json"))),"receipts"))){__rows.push([pyAt(r,"id"),r]);}return __rows;})()));
push_receipt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await pyMethod(receipts,"values",[],{})))){if(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(r,"get",["kind"],{})),"roll");return pyBool(__left)?(await pyMethod(r,"get",["pushed"],{})):__left})()))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(push_receipt,"approach"),"charm");return pyBool(__left)?pyEqual(pyAt(push_receipt,"npc"),"steven-knott"):__left})())),"tests/kernel/test_npc_layer.py:289 assert push_receipt[\"approach\"] == \"charm\" and push_receipt[\"npc\"] == \"steven-knott\"");
table=(await StanceTable((await RuleTables(pyDivide(pyDivide(pyDivide(CONTENT,"rulesets"),"coc7"),"rules-json")))));
row=pyAt((await ledger(seeded_one)),KNOTT);
expected=pyAdd((await pyMethod(table,"delta",["charm",pyAt(first,"level")],{})),(await pyMethod(table,"delta",["charm",pyAt(pushed,"level")],{})));
assert.ok(pyBool(pyEqual(pyAt(pyAt(row,"stance"),"score"),expected)),"tests/kernel/test_npc_layer.py:295 assert row[\"stance\"][\"score\"] == expected");
entry=(await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt((await pyMethod(seeded_one,"table",["capsule"],{})),"present"))){if(pyBool(pyEqual(pyAt(p,"name"),"Steven Knott"))){__rows.push(p);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(pyAt(entry,"history"),"tried"),[`turn 1: charm ${pyAt(first,"level")}`,`turn 1: charm ${pyAt(pushed,"level")}`])),"tests/kernel/test_npc_layer.py:300 assert entry[\"history\"][\"tried\"] == [f\"turn 1: charm {first['level']}\",\n                                         f\"turn 1: charm {pushed['level']}\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(entry,"history"),"met_turns"),2)),"tests/kernel/test_npc_layer.py:302 assert entry[\"history\"][\"met_turns\"] == 2");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_pushed_social_failure_still_reaches_the_stance"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_pushed_social_failure_still_reaches_the_stance(await kernel(t,{env:{COC_KERNEL_SEED:'1'}}));});
export async function test_the_stance_table_must_say_it_is_the_stance_table(){

const caught:any={};try{await StanceTable({load:()=>({initial_score:0,score_range:[-5,5],levels:[],social:{},pushed_failure_delta:-1,combat_target_score:-5})});assert.fail('undeclared table accepted');}catch(error){caught.value=error;}
assert.ok(pyBool(pyEqual(caught.value.code,"campaign_not_ready")),"tests/kernel/test_npc_layer.py:317 assert caught.value.code == \"campaign_not_ready\"");
assert.ok(pyBool(pyContains(caught.value.message,"npc-stance")),"tests/kernel/test_npc_layer.py:318 assert \"npc-stance\" in caught.value.message");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_stance_table_must_say_it_is_the_stance_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_stance_table_must_say_it_is_the_stance_table();});
export async function test_a_death_the_dice_did_not_settle(kernel:any){
let row:any,entry:any;

(await open_turn(kernel));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["dead"]:true,["why"]:"用他自己的匕首，没有掷骰"})]}));
(await narrate(kernel,"t1-c2","他散了。灰落在铺板上。"));
row=pyAt((await ledger(kernel)),KNOTT);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(row,"dead"),"turn"),1);return pyBool(__left)?pyEqual(pyAt(pyAt(row,"dead"),"why"),"用他自己的匕首，没有掷骰"):__left})())),"tests/kernel/test_npc_layer.py:333 assert row[\"dead\"][\"turn\"] == 1 and row[\"dead\"][\"why\"] == \"用他自己的匕首，没有掷骰\"");
assert.ok(pyBool((await pyMethod(pyAt(pyAt(row,"dead"),"receipt"),"startswith",["npc:"],{}))),"tests/kernel/test_npc_layer.py:334 assert row[\"dead\"][\"receipt\"].startswith(\"npc:\")");
entry=(await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"present"))){if(pyBool(pyEqual(pyAt(p,"name"),"Steven Knott"))){__rows.push(p);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(pyAt(entry,"history"),"dead_since_turn"),1)),"tests/kernel/test_npc_layer.py:336 assert entry[\"history\"][\"dead_since_turn\"] == 1");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_death_the_dice_did_not_settle"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_death_the_dice_did_not_settle(await kernel(t,{}));});
export async function test_a_thing_bought_from_someone_goes_on_their_account(kernel:any){
let row:any,paid:any,entry:any;

(await open_turn(kernel));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"item",["name"]:"Boston Globe",["from"]:"Steven Knott",["label"]:"今日《环球报》"}),({["kind"]:"item",["name"]:"lucky pen"}),({["kind"]:"cash",["delta"]:(-2),["source"]:"quote",["category"]:"purchase",["with"]:"Steven Knott",["why"]:"买下那份报纸"})]}));
(await narrate(kernel,"t1-c2","诺特把报纸推过桌面，收了两块钱。"));
row=pyAt((await ledger(kernel)),KNOTT);
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(row,"exchanged"))){__rows.push((await pyMethod(e,"get",["item"],{})));}return __rows;})()),["今日《环球报》",null])),pyStr("the keeper's label, not the id"));
paid=pyAt(pyAt(row,"exchanged"),1);
assert.ok(pyBool(pyEqual([pyAt(paid,"cash"),pyAt(paid,"direction"),pyAt(paid,"currency")],[2,"paid","USD"])),"tests/kernel/test_npc_layer.py:358 assert (paid[\"cash\"], paid[\"direction\"], paid[\"currency\"]) == (2, \"paid\", \"USD\")");
entry=(await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"present"))){if(pyBool(pyEqual(pyAt(p,"name"),"Steven Knott"))){__rows.push(p);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(pyAt(entry,"history"),"exchanged"),["turn 1: 今日《环球报》","turn 1: paid 2 USD"])),"tests/kernel/test_npc_layer.py:360 assert entry[\"history\"][\"exchanged\"] == [\"turn 1: 今日《环球报》\", \"turn 1: paid 2 USD\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_thing_bought_from_someone_goes_on_their_account"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_thing_bought_from_someone_goes_on_their_account(await kernel(t,{}));});
export async function test_the_ledger_records_who_handed_a_clue_over(kernel:any){
let knott:any;
(await open_turn(kernel));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-commission",["from"]:"Steven Knott"})]}));
(await narrate(kernel,"t1-c2","诺特把委托说清楚了。"));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await ledger(kernel)),KNOTT),"disclosed"),[({["clue"]:"knott-commission",["turn"]:1,["receipt"]:"clue:knott-commission-t1"})])),"tests/kernel/test_npc_layer.py:368 assert ledger(kernel)[KNOTT][\"disclosed\"] == [\n        {\"clue\": \"knott-commission\", \"turn\": 1, \"receipt\": \"clue:knott-commission-t1\"}]");
knott=pyAt((await present(kernel)),"Steven Knott");
assert.ok(pyBool(pyEqual(pyAt(pyAt(knott,"history"),"disclosed"),["knott-commission"])),"tests/kernel/test_npc_layer.py:371 assert knott[\"history\"][\"disclosed\"] == [\"knott-commission\"]");
assert.ok(pyBool((pyAt(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const f of pyIterable(pyAt(knott,"knows"))){__rows.push([pyAt(f,"clue"),pyAt(f,"discovered")]);}return __rows;})())),"knott-commission")===true)),"tests/kernel/test_npc_layer.py:373 assert {f[\"clue\"]: f[\"discovered\"] for f in knott[\"knows\"]}[\"knott-commission\"] is True");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_ledger_records_who_handed_a_clue_over"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_ledger_records_who_handed_a_clue_over(await kernel(t,{}));});
export async function test_turns_present_counts_the_turns_he_was_on_stage(kernel:any){
let seen:any;
(await open_turn(kernel));
(await narrate(kernel,"t1-c1","诺特点点头。"));
(await pyMethod(kernel,"table",["player_input"],{"text":"我再看看他。"}));
(await narrate(kernel,"t2-c1","他还在那儿。"));
seen=pyAt(pyAt((await ledger(kernel)),KNOTT),"turns_present");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(seen,"first"),0);return pyBool(__left)?pyEqual(pyAt(seen,"last"),2):__left})());return pyBool(__left)?pyEqual(pyAt(seen,"count"),3):__left})())),"tests/kernel/test_npc_layer.py:382 assert seen[\"first\"] == 0 and seen[\"last\"] == 2 and seen[\"count\"] == 3");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_turns_present_counts_the_turns_he_was_on_stage"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_turns_present_counts_the_turns_he_was_on_stage(await kernel(t,{}));});

export async function test_a_lost_ledger_is_rebuilt_from_the_closed_turns(kernel:any){
let before:any,path:any;
(await open_turn(kernel));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-commission",["from"]:"Steven Knott"}),({["kind"]:"npc",["name"]:"Steven Knott",["stance"]:"wary",["why"]:"he was pressed too hard"})]}));
(await narrate(kernel,"t1-c2","他把委托说了，眼神却冷下来。"));
before=(await ledger(kernel));
path=pyDivide((await campaign_dir(kernel.workspace)),"npc-ledger.json");
(await pyMethod(path,"unlink",[],{}));
(await pyMethod(kernel,"ok",["table.open",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool(pyEqual((await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))],{})),before)),"tests/kernel/test_npc_layer.py:398 assert json.loads(path.read_text(encoding=\"utf-8\")) == before");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_lost_ledger_is_rebuilt_from_the_closed_turns"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_lost_ledger_is_rebuilt_from_the_closed_turns(await kernel(t,{}));});
export async function test_the_dossier_vocabulary_has_one_home(){
 const contractApi=await importSource('kernel-ts/modules/contract.ts'),graphApi=await importSource('kernel-ts/read/module-graph.ts');
 const context={content:String(CONTENT),snapshots:{readJson:async(path:string)=>read_json(path),pathExists:async(path:string)=>existsSync(path)}};
 const loaded=await contractApi.loadModuleContract(context),dossier=loaded.graph.actor_dossier,vocabulary=contractApi.vocabulary(loaded);
 assert.deepEqual(graphApi.dossierKeys(dossier),dossier.profile_keys);
 assert.deepEqual(vocabulary.actor_dossier,dossier);
 for(const predicate of [...dossier.claim_predicates,...dossier.tie_relation_kinds])assert.ok(loaded.graph.relation_kinds.includes(predicate));
 const writer=read_json(pyDivide(CONTENT,'modules/module-graph-contract-v3.json')).actor_dossier;
 assert.deepEqual(writer.profile_keys,dossier.profile_keys);assert.deepEqual(writer.claim_predicates,dossier.claim_predicates);assert.deepEqual(writer.tie_relation_kinds,dossier.tie_relation_kinds);
 const source=readFileSync(join(ROOT,'kernel-ts/write/source.ts'),'utf8');assert.ok(source.includes('dossier.profile_keys'));
 const reader=readFileSync(join(String(CONTENT),'setup/visual-reader/read.md'),'utf8');assert.ok(reader.includes('task.vocabulary.actor_dossier'));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_dossier_vocabulary_has_one_home"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_dossier_vocabulary_has_one_home();});
export async function test_a_profile_key_the_spine_gains_arrives_at_the_table(tmp_path:any){
let entry:any,command:any,content:any,contract_path:any,spine:any,graph_path:any,graph:any,node:any,client:any,knott:any;




content=pyDivide(tmp_path,"content");
(await pyMethod(shutil,"copytree",[pyDivide(WORKTREE,"content"),content],{}));
contract_path=pyDivide(pyDivide(content,"modules"),"module-graph-contract-v3.json");
spine=(await pyMethod(json,"loads",[(await pyMethod(contract_path,"read_text",[],{"encoding":"utf-8"}))],{}));
(await pyMethod(pyAt(pyAt(spine,"actor_dossier"),"profile_keys"),"append",["language"],{}));
pyAt(pyAt(spine,"actor_dossier"),"profile_labels")["language"]="speaks";
(await pyMethod(contract_path,"write_text",[(await pyMethod(json,"dumps",[spine],{}))],{"encoding":"utf-8"}));
graph_path=pyDivide(pyDivide(pyDivide(content,"starters"),"the-haunting"),"module-graph.json");
graph=(await pyMethod(json,"loads",[(await pyMethod(graph_path,"read_text",[],{"encoding":"utf-8"}))],{}));
node=(await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(graph,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_id"),KNOTT))){__rows.push(n);}}return __rows;})())));
(await pyMethod(node,"setdefault",["properties",({})],{}))["language"]="English; his Italian is broken";
(await pyMethod(graph_path,"write_text",[(await pyMethod(json,"dumps",[graph],{}))],{"encoding":"utf-8"}));
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"content":content})));
try{(await create_campaign(client));
knott=pyAt((await present(client)),"Steven Knott");
assert.ok(pyBool(pyEqual(pyAt(knott,"speaks"),"English; his Italian is broken")),"tests/kernel/test_npc_layer.py:469 assert knott[\"speaks\"] == \"English; his Italian is broken\"");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyAt(knott,"wants");return pyBool(__left)?pyAt(knott,"role"):__left})());return pyBool(__left)?pyAt(knott,"fears"):__left})())),"tests/kernel/test_npc_layer.py:470 assert knott[\"wants\"] and knott[\"role\"] and knott[\"fears\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(client,"table",["look"],{"focus":"npc","name":"Steven Knott"})),"speaks"),pyAt(knott,"speaks"))),"tests/kernel/test_npc_layer.py:471 assert client.table(\"look\", focus=\"npc\", name=\"Steven Knott\")[\"speaks\"] == knott[\"speaks\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_profile_key_the_spine_gains_arrives_at_the_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_profile_key_the_spine_gains_arrives_at_the_table(temporary);});

export async function test_a_reader_s_dossier_claims_reach_the_graph_and_the_table(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,frozen:any,nodes:any,n:any,claims:any,c:any,draft:any,persons:any,required:any,graph:any,zhou:any,where:any,entry:any;




const __unpack26090=(await indexed(kernel,tmp_path));mid=__unpack26090[0];_=__unpack26090[1];
(await request(kernel,mid,"opening"));
job=(await claim(kernel,mid));
(await observed(job));
frozen=(await pyMethod(json,"loads",[(await pyMethod((pyDivide((await pyDivide(WORKTREE,"tests/kernel/test_npc_layer.py")).parent,"fixtures/legacy-module/module-graph.json")),"read_text",[],{}))],{}));
nodes=(await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(frozen,"nodes"))){__rows.push(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const k of pyIterable(["node_id","node_kind","name","aliases","summary","properties","visibility"])){if(pyBool(pyContains(n,k))){__rows.push([k,pyAt(n,k)]);}}return __rows;})())));}return __rows;})());
for(n of pyIterable(nodes)){
if(pyBool(pyEqual(pyAt(n,"node_kind"),"module"))){n["node_id"]=`module-${mid}`;}
n["source_refs"]=[({["page"]:1})];
if(pyBool(pyContains(["asset","handout"],pyAt(n,"node_kind")))){(await pyMethod((await pyMethod(n,"get",["properties",({})],{})),"pop",["asset_ref",null],{}));}
if(pyBool(pyEqual(pyAt(n,"node_kind"),"npc"))){(await pyMethod((await pyMethod(n,"get",["properties",({})],{})),"pop",["skills",null],{}));}
}
claims=(await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(frozen,"claims"))){__rows.push(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const k of pyIterable(["subject_id","predicate","object","truth_status","visibility","reason","known_by_ids","asserted_by_ids","validity"])){if(pyBool(pyContains(c,k))){__rows.push([k,pyAt(c,k)]);}}return __rows;})())));}return __rows;})());
for(c of pyIterable(claims)){
if(pyBool((await pyMethod(pyAt(c,"subject_id"),"startswith",["module-"],{})))){c["subject_id"]=`module-${mid}`;}
c["source_refs"]=[({["page"]:1})];
}
async function node(kind:any,slug:any,name:any,summary:any){
return ({["node_id"]:`${kind}-${slug}`,["node_kind"]:kind,["name"]:name,["summary"]:summary,["source_refs"]:[({["page"]:1})]});
}
async function relation(subject:any,predicate:any,target:any){
return ({["subject_id"]:subject,["predicate"]:predicate,["object"]:({["node_id"]:target}),["truth_status"]:"authored-fact",["source_refs"]:[({["page"]:1})]});
}
nodes=pyAdd(nodes,[(await node("secret","sailor-entered-at-night","船工深夜进货栈","老周见过船工深夜进货栈，但不敢说。")),(await node("location","dock-teahouse-building","码头茶棚","雾锁码头的茶棚。")),(await node("location","jetty","栈桥","从茶棚向北通往废弃货栈。")),(await node("rule","teahouse-questioning","茶棚问话","向老周打听要一次说服检定。")),(await node("ending","sailor-recovered","船工获救","船工被找回，货栈的门重新锁上。"))]);
claims=pyAdd(claims,(await (async()=>{const __rows:any[]=[];for(const [a,p,b] of pyIterable([["scene-dock-teahouse","occurs-at","location-dock-teahouse-building"],["location-jetty","located-in","location-dock-teahouse-building"],["scene-dock-teahouse","uses-rule","rule-teahouse-questioning"],["scene-dock-teahouse","may-lead-to","ending-sailor-recovered"],["npc-lao-zhou","hides","secret-sailor-entered-at-night"],["npc-lao-zhou","knows","clue-brass-whistle"],["npc-lao-zhou","believes","secret-sailor-entered-at-night"]])){__rows.push((await relation(a,p,b)));}return __rows;})()));
draft=({["nodes"]:nodes,["claims"]:claims,["node_refs"]:[],["coverage"]:({}),["dependencies"]:[],["critical"]:[],["ready_nodes"]:(await (async()=>{const __rows:any[]=[];for(const n of pyIterable(nodes)){__rows.push(pyAt(n,"node_id"));}return __rows;})())});
persons=(await (async()=>{const __rows:any[]=[];for(const [i,n] of pyIterable((await pyEnumerate(nodes)))){if(pyBool(pyEqual((await pyMethod(n,"get",["node_kind"],{})),"npc"))){for(const [field,value] of pyIterable([["summary",(await pyMethod(n,"get",["summary"],{}))],["properties/appearance",(await pyMethod(((await (async()=>{const __left=(await pyMethod(n,"get",["properties"],{}));return pyBool(__left)?__left:({})})())),"get",["appearance"],{}))]])){if(pyBool(value)){__rows.push(`/nodes/${i}/${field}`);}}}}return __rows;})());
required=[...pyAt((await check_draft(draft,job)),"required_review"),...persons,"/coverage"];
(await write(pyDivide((await Path(pyAt(job,"work_dir"))),"draft.json"),draft));
(await write(pyDivide((await Path(pyAt(job,"work_dir"))),"review.json"),({["checked"]:[({["paths"]:required,["verdict"]:"supported",["source_refs"]:[({["page"]:1})]})],["missing"]:[]})));
(await finish(kernel,job));
graph=(await ModuleGraph(mid,(await pyMethod((await ModuleStore(kernel.workspace)),"graph_path",[mid],{}))));
zhou=(await pyMethod(graph,"npc",["老周"],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable((await pyMethod(graph,"npc_claims",[zhou,"hides"],{})))){__rows.push(pyAt(pyAt(c,"object"),"node_id"));}return __rows;})()),["secret-sailor-entered-at-night"])),"tests/kernel/test_npc_layer.py:540 assert [c[\"object\"][\"node_id\"] for c in graph.npc_claims(zhou, \"hides\")] == [\"secret-sailor-entered-at-night\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable((await pyMethod(graph,"npc_knows",[zhou],{})))){__rows.push(pyAt(e,"handle"));}return __rows;})()),["brass-whistle"])),"tests/kernel/test_npc_layer.py:541 assert [e[\"handle\"] for e in graph.npc_knows(zhou)] == [\"brass-whistle\"]");
assert.ok(pyBool(pyEqual((await pyMethod(graph,"npc_claim_lines",[zhou,"believes"],{})),["老周见过船工深夜进货栈，但不敢说。"])),"tests/kernel/test_npc_layer.py:542 assert graph.npc_claim_lines(zhou, \"believes\") == [\"老周见过船工深夜进货栈，但不敢说。\"]");
assert.ok(pyBool(pyEqual((await pyMethod(graph,"npcs_knowing",[pyAt(graph.nodes,"clue-brass-whistle")],{})),["npc-lao-zhou"])),"tests/kernel/test_npc_layer.py:544 assert graph.npcs_knowing(graph.nodes[\"clue-brass-whistle\"]) == [\"npc-lao-zhou\"]");
assert.ok(pyBool(((await pyMethod(graph,"npc_has_material",[zhou],{}))===true)),"tests/kernel/test_npc_layer.py:546 assert graph.npc_has_material(zhou) is True");

where=(await where_section(graph,({["active_scene"]:"dock-teahouse",["discovered_clues"]:[],["scene_trail"]:[],["npc_presence"]:({})}),(await pyMethod(graph,"scene",["dock-teahouse"],{})),({"material_of":(_h:any)=>"ready"})));
assert.ok(pyBool(pyEqual(pyAt(where,"places"),[({["name"]:"栈桥",["line"]:"从茶棚向北通往废弃货栈。"})])),"tests/kernel/test_npc_layer.py:554 assert where[\"places\"] == [{\"name\": \"栈桥\", \"line\": \"从茶棚向北通往废弃货栈。\"}]");
assert.ok(pyBool(pyEqual(pyAt(where,"rules"),[({["name"]:"茶棚问话",["line"]:"向老周打听要一次说服检定。"})])),"tests/kernel/test_npc_layer.py:558 assert where[\"rules\"] == [{\"name\": \"茶棚问话\", \"line\": \"向老周打听要一次说服检定。\"}]");
assert.ok(pyBool(pyEqual(pyAt(where,"endings"),[({["name"]:"船工获救",["via"]:"may-lead-to",["line"]:"船工被找回，货栈的门重新锁上。"})])),"tests/kernel/test_npc_layer.py:562 assert where[\"endings\"] == [{\"name\": \"船工获救\", \"via\": \"may-lead-to\",\n                                 \"line\": \"船工被找回，货栈的门重新锁上。\"}]");

entry=(await npc_entry(graph,({["discovered_clues"]:[],["npc_presence"]:({["lao-zhou"]:"dock-teahouse"})}),zhou,({}),({})));
assert.ok(pyBool(pyEqual(pyAt(entry,"believes"),["老周见过船工深夜进货栈，但不敢说。"])),"tests/kernel/test_npc_layer.py:569 assert entry[\"believes\"] == [\"老周见过船工深夜进货栈，但不敢说。\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const k of pyIterable(pyAt(entry,"knows"))){__rows.push(pyAt(k,"clue"));}return __rows;})()),["brass-whistle"])),"tests/kernel/test_npc_layer.py:570 assert [k[\"clue\"] for k in entry[\"knows\"]] == [\"brass-whistle\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_reader_s_dossier_claims_reach_the_graph_and_the_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_reader_s_dossier_claims_reach_the_graph_and_the_table(await kernel(t,{}),temporary);});

export async function test_the_books_numbers_read_out_of_either_shape(){
let starter:any,corbitt:any,profile:any,flat:any,ask:any,key:any;

starter=(await ModuleGraph("the-haunting",pyDivide(pyDivide(pyDivide(CONTENT,"starters"),"the-haunting"),"module-graph.json")));
corbitt=(await pyMethod(starter,"npc",["Walter Corbitt"],{}));
profile=(await pyMethod(starter,"actor_profile",[corbitt],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(profile,"skills"),"Fighting"),50);return pyBool(__left)?pyEqual(pyAt(pyAt(profile,"characteristics"),"DEX"),35):__left})())),"tests/kernel/test_npc_layer.py:585 assert profile[\"skills\"][\"Fighting\"] == 50 and profile[\"characteristics\"][\"DEX\"] == 35");
assert.ok(pyBool(pyEqual((await pyMethod(starter,"actor_skill_value",[corbitt,"fighting"],{})),50)),pyStr("names match the way names match"));
assert.ok(pyBool(((await pyMethod(starter,"actor_skill_value",[corbitt,"Medicine"],{}))===null)),pyStr("the book gives him none"));
flat=({["node_id"]:"npc-doc",["node_kind"]:"npc",["name"]:"医生",["properties"]:({["STR"]:50,["HP"]:11,["Move"]:8,["Medicine"]:65,["Dodge"]:"17% (Hard 8%)"})});
profile=(await pyMethod(starter,"actor_profile",[flat],{}));
assert.ok(pyBool(pyEqual(pyAt(profile,"characteristics"),({["STR"]:50}))),"tests/kernel/test_npc_layer.py:592 assert profile[\"characteristics\"] == {\"STR\": 50}");
assert.ok(pyBool(pyEqual(pyAt(profile,"derived"),({["HP"]:11,["Move"]:8}))),"tests/kernel/test_npc_layer.py:593 assert profile[\"derived\"] == {\"HP\": 11, \"Move\": 8}");
assert.ok(pyBool(pyEqual(pyAt(profile,"skills"),({["Medicine"]:65}))),pyStr("prose carries no number and is not guessed at"));
assert.ok(pyBool(((await pyMethod(starter,"actor_skill_value",[flat,"Dodge"],{}))===null)),"tests/kernel/test_npc_layer.py:595 assert starter.actor_skill_value(flat, \"Dodge\") is None");
ask=(await pyMethod((pyDivide(pyDivide(CONTENT,"setup"),"visual-reader/read.md")),"read_text",[],{"encoding":"utf-8"}));
assert.ok(pyBool((await (async()=>{const __left=pyContains(ask,"properties.mechanics.profile");return pyBool(__left)?pyContains(ask,"{\"Spot Hidden\": 60"):__left})())),"tests/kernel/test_npc_layer.py:601 assert \"properties.mechanics.profile\" in ask and '{\"Spot Hidden\": 60' in ask");
for(key of pyIterable(["STR","CON","DEX","POW","EDU"])){
assert.ok(pyBool(pyContains(ask,key)),pyStr(key));
}
assert.ok(pyBool(pyContains(ask,"cannot be used for a roll")),"tests/kernel/test_npc_layer.py:604 assert \"cannot be used for a roll\" in ask");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_books_numbers_read_out_of_either_shape"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_books_numbers_read_out_of_either_shape();});
export async function test_an_npc_acts_for_the_party_and_the_roll_is_theirs(kernel:any){
let action:any,asked:any,settled:any,row:any;

(await open_turn(kernel));
action=({["intent"]:"investigate",["goal"]:"把伤口缝好",["method"]:"他给我清创缝合",["actor"]:"Steven Knott",["skill"]:"Medicine"});
asked=(await resolve_err(kernel,"t1-c1",({...action})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(asked,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(asked,"details"),"needs"),"field"),"npc.skill"):__left})())),"tests/kernel/test_npc_layer.py:618 assert asked[\"code\"] == \"needs\" and asked[\"details\"][\"needs\"][\"field\"] == \"npc.skill\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(asked,"details"),"actor"),"steven-knott");return pyBool(__left)?pyEqual(pyAt(pyAt(asked,"details"),"skill"),"Medicine"):__left})())),"tests/kernel/test_npc_layer.py:619 assert asked[\"details\"][\"actor\"] == \"steven-knott\" and asked[\"details\"][\"skill\"] == \"Medicine\"");
assert.ok(pyBool(pyContains(pyAt(asked,"fix"),"apply npc")),pyStr("the refusal names the way out of itself"));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["skill"]:({["name"]:"Medicine",["value"]:65}),["why"]:"书上没写，桌上定为称职的医生"})]}));
settled=pyAt((await resolve(kernel,"t1-c3",({...action}))),"outcome");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(settled,"skill"),"Medicine");return pyBool(__left)?pyEqual(pyAt(settled,"target"),65):__left})())),pyStr("his number, not the sheet's"));
(await narrate(kernel,"t1-c4",`他把线收紧。医学 ${pyAt(settled,"roll")}，目标 65。`));
row=pyAt((await ledger(kernel)),KNOTT);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(row,"skills"),"Medicine"),"value"),65);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(row,"skills"),"Medicine"),"turn"),1):__left})())),"tests/kernel/test_npc_layer.py:630 assert row[\"skills\"][\"Medicine\"][\"value\"] == 65 and row[\"skills\"][\"Medicine\"][\"turn\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(row,"skills"),"Medicine"),"why"),"书上没写，桌上定为称职的医生")),"tests/kernel/test_npc_layer.py:631 assert row[\"skills\"][\"Medicine\"][\"why\"] == \"书上没写，桌上定为称职的医生\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_npc_acts_for_the_party_and_the_roll_is_theirs"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_npc_acts_for_the_party_and_the_roll_is_theirs(await kernel(t,{}));});
export async function test_an_ordinary_npc_helper_uses_their_target_and_receipt_identity(kernel:any,skill:any,value:any){
let result:any,receipt:any;
(await open_turn(kernel,"Ask Knott to haul the investigator up with a rope."));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["skill"]:({["name"]:skill,["value"]:value}),["why"]:"A stable ability for the helper in this isolated test."})]}));
result=(await resolve(kernel,"t1-c2",({"actor":"Steven Knott","target":"Thomas Hayes","intent":"move","goal":"Haul the investigator to safety","method":"Knott works the rope","skill":skill,"stakes":"The helper cannot raise the investigator"})));
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"outcome"),"target"),value)),"tests/kernel/test_npc_layer.py:643 assert result[\"outcome\"][\"target\"] == value");
receipt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"))){if(pyBool(pyEqual(pyAt(r,"id"),pyAt(result,"receipt")))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"actor"),"steven-knott");return pyBool(__left)?pyEqual(pyAt(receipt,"target"),value):__left})())),"tests/kernel/test_npc_layer.py:645 assert receipt[\"actor\"] == \"steven-knott\" and receipt[\"target\"] == value");
assert.ok(pyBool(pyEqual(pyAt(pyAt(receipt,"check"),"investigator_id"),"steven-knott")),"tests/kernel/test_npc_layer.py:646 assert receipt[\"check\"][\"investigator_id\"] == \"steven-knott\"");
assert.ok(pyBool(!pyBool(pyAt(result,"continuations"))),pyStr("an NPC check does not offer the player's Push or Luck"));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const hint of pyIterable((await pyMethod(result,"get",["hints",[]],{})))){__rows.push(pyContains(hint,"investigator sheet"));}return __rows;})()))))),"tests/kernel/test_npc_layer.py:648 assert not any(\"investigator sheet\" in hint for hint in result.get(\"hints\", []))");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize(["skill","value"],[["Climb",60],["STR",70]]))).entries())test("test_an_ordinary_npc_helper_uses_their_target_and_receipt_identity"+((pyCartesian([{}],pyParametrize(["skill","value"],[["Climb",60],["STR",70]]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_ordinary_npc_helper_uses_their_target_and_receipt_identity(await kernel(t,{}),row["skill"],row["value"]);});
export async function test_an_ordinary_npc_helper_needs_their_missing_skill_without_using_player_base(kernel:any){
let error:any;
(await open_turn(kernel));
error=(await resolve_err(kernel,"t1-c1",({"actor":"Steven Knott","intent":"move","goal":"Lead the pack animal","method":"Knott takes its reins","skill":"Animal Handling"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(error,"details"),"needs"),"field"),"npc.skill"):__left})())),"tests/kernel/test_npc_layer.py:655 assert error[\"code\"] == \"needs\" and error[\"details\"][\"needs\"][\"field\"] == \"npc.skill\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"actor"),"steven-knott")),"tests/kernel/test_npc_layer.py:656 assert error[\"details\"][\"actor\"] == \"steven-knott\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"),[])),"tests/kernel/test_npc_layer.py:657 assert kernel.table(\"status\")[\"receipts\"] == []");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_ordinary_npc_helper_needs_their_missing_skill_without_using_player_base"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_ordinary_npc_helper_needs_their_missing_skill_without_using_player_base(await kernel(t,{}));});
export async function test_an_ordinary_npc_check_uses_the_authored_characteristic_without_a_pin(kernel:any){
let call:any,result:any,receipt:any;

(await open_turn(kernel));
call=(await walk_to_confrontation(kernel));
result=(await resolve(kernel,`t1-c${call}`,({"actor":"Walter Corbitt","intent":"move","skill":"STR","goal":"Lift the obstruction","method":"He lifts it with both arms"})));
receipt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"))){if(pyBool(pyEqual(pyAt(r,"id"),pyAt(result,"receipt")))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"outcome"),"target"),90)),"tests/kernel/test_npc_layer.py:668 assert result[\"outcome\"][\"target\"] == 90");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"actor"),"walter-corbitt");return pyBool(__left)?pyEqual(pyAt(receipt,"target"),90):__left})())),"tests/kernel/test_npc_layer.py:669 assert receipt[\"actor\"] == \"walter-corbitt\" and receipt[\"target\"] == 90");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_ordinary_npc_check_uses_the_authored_characteristic_without_a_pin"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_ordinary_npc_check_uses_the_authored_characteristic_without_a_pin(await kernel(t,{}));});
export async function test_an_npc_pin_cannot_replace_an_authored_value_but_can_fill_a_missing_skill(kernel:any,tmp_path:any){
let mid:any,_:any,job:any,draft:any,ledger_path:any,before:any,error:any,skills:any;

const __unpack38337=(await indexed(kernel,tmp_path));mid=__unpack38337[0];_=__unpack38337[1];
const __unpack38376=(await opening(kernel,mid));job=__unpack38376[0];draft=__unpack38376[1];_=__unpack38376[2];
pyAt(pyAt(pyAt(pyAt(pyAt(pyAt(draft,"nodes"),2),"properties"),"mechanics"),"profile"),"characteristics")["STR"]=70;
(await write(pyDivide((await Path(pyAt(job,"work_dir"))),"draft.json"),draft));
(await finish(kernel,job));
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:mid,["play_language"]:"en"})],{}));

(await confirmed_investigator(kernel,({"campaign":CAMPAIGN,"name":"Ada"})));
(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:CAMPAIGN})],{}));
(await pyMethod(kernel,"table",["open"],{}));
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t0-c1","text":"Lena waits at the dock."}));
(await pyMethod(kernel,"table",["player_input"],{"text":"Ask Lena to help."}));
ledger_path=pyDivide((await campaign_dir(kernel.workspace)),"npc-ledger.json");
before=(pyBool((await pyMethod(ledger_path,"exists",[],{})))?(await pyMethod(ledger_path,"read_bytes",[],{})):null);
error=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Lena",["skill"]:({["name"]:"STR",["value"]:55}),["why"]:"The compact view did not list her strength."})]}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_npc_layer.py:692 assert error[\"code\"] == \"invalid_params\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(error,"details"),"field"),"npc.skill");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"authored_value"),70):__left})())),"tests/kernel/test_npc_layer.py:693 assert error[\"details\"][\"field\"] == \"npc.skill\" and error[\"details\"][\"authored_value\"] == 70");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(error,"message"),"source");return pyBool(__left)?pyContains(pyAt(error,"fix"),"70"):__left})())),"tests/kernel/test_npc_layer.py:694 assert \"source\" in error[\"message\"] and \"70\" in error[\"fix\"]");
assert.ok(pyBool(pyEqual(((pyBool((await pyMethod(ledger_path,"exists",[],{})))?(await pyMethod(ledger_path,"read_bytes",[],{})):null)),before)),"tests/kernel/test_npc_layer.py:695 assert (ledger_path.read_bytes() if ledger_path.exists() else None) == before");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"),[])),"tests/kernel/test_npc_layer.py:696 assert kernel.table(\"status\")[\"receipts\"] == []");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Lena",["skill"]:({["name"]:"First Aid",["value"]:40}),["why"]:"The source has no First Aid value."}),({["kind"]:"npc",["name"]:"Lena",["skill"]:({["name"]:"STR",["value"]:70}),["why"]:"Keep the source's existing strength."})]}));
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c2","text":"Lena prepares to help."}));
skills=pyAt(pyAt((await ledger(kernel)),"npc-lena"),"skills");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(skills,"First Aid"),"value"),40);return pyBool(__left)?pyEqual(pyAt(pyAt(skills,"STR"),"value"),70):__left})())),"tests/kernel/test_npc_layer.py:704 assert skills[\"First Aid\"][\"value\"] == 40 and skills[\"STR\"][\"value\"] == 70");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_npc_pin_cannot_replace_an_authored_value_but_can_fill_a_missing_skill"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_npc_pin_cannot_replace_an_authored_value_but_can_fill_a_missing_skill(await kernel(t,{}),temporary);});
export async function test_visual_npc_properties_reach_the_keeper_without_turning_belief_into_truth(){
let graph:any,node:any,view:any;

graph=(await ModuleGraph("the-haunting",pyDivide(CONTENT,"starters/the-haunting/module-graph.json")));
node=(await pyMethod(graph,"npc",["Steven Knott"],{}));
(await pyMethod(pyAt(node,"properties"),"update",[],{"biography":"A source-authored upbringing.","knowledge":["The expedition leaves on Monday."],"beliefs":["He suspects a human conspiracy."],"lies":["He claims to be a merchant."]}));
view=(await npc_view(graph,({}),node));
assert.ok(pyBool(pyEqual(pyAt(pyAt(view,"properties"),"biography"),"A source-authored upbringing.")),"tests/kernel/test_npc_layer.py:715 assert view['properties']['biography'] == 'A source-authored upbringing.'");
assert.ok(pyBool(pyEqual(pyAt(view,"knowledge"),["The expedition leaves on Monday."])),"tests/kernel/test_npc_layer.py:716 assert view['knowledge'] == ['The expedition leaves on Monday.']");
assert.ok(pyBool(pyContains(pyAt(view,"believes"),"He suspects a human conspiracy.")),"tests/kernel/test_npc_layer.py:717 assert 'He suspects a human conspiracy.' in view['believes']");
assert.ok(pyBool(pyContains((await pyMethod(graph,"npc_would_say",[node],{})),"He claims to be a merchant.")),"tests/kernel/test_npc_layer.py:718 assert 'He claims to be a merchant.' in graph.npc_would_say(node)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_visual_npc_properties_reach_the_keeper_without_turning_belief_into_truth"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_visual_npc_properties_reach_the_keeper_without_turning_belief_into_truth();});
export async function test_a_belief_about_a_person_does_not_import_their_secret_biography(){
let graph:any,believer:any,target:any,reason:any;
graph=(await ModuleGraph("the-haunting",pyDivide(CONTENT,"starters/the-haunting/module-graph.json")));
believer=(await pyMethod(graph,"npc",["Steven Knott"],{}));
target=(await pyMethod(graph,"npc",["Walter Corbitt"],{}));
reason="He believes the owner is an ordinary recluse.";
graph.claims_by_subject[pyAt(believer,"node_id")]=[({["subject_id"]:pyAt(believer,"node_id"),["predicate"]:"believes",["object"]:({["node_id"]:pyAt(target,"node_id")}),["truth_status"]:"authored-belief",["reason"]:reason})];
assert.ok(pyBool(pyEqual((await pyMethod(graph,"npc_beliefs",[believer],{})),[reason])),"tests/kernel/test_npc_layer.py:729 assert graph.npc_beliefs(believer) == [reason]");
(await pyMethod(pyAt(graph.out_rel,pyAt(believer,"node_id")),"append",[({["relation_kind"]:"impersonates",["from_node_id"]:pyAt(believer,"node_id"),["to_node_id"]:pyAt(believer,"node_id")})],{}));
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const tie of pyIterable((await pyMethod(graph,"npc_ties",[believer],{})))){__rows.push(!pyEqual(pyAt(pyAt(tie,"node"),"node_id"),pyAt(believer,"node_id")));}return __rows;})())))),"tests/kernel/test_npc_layer.py:732 assert all(tie['node']['node_id'] != believer['node_id'] for tie in graph.npc_ties(believer))");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_belief_about_a_person_does_not_import_their_secret_biography"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_belief_about_a_person_does_not_import_their_secret_biography();});
