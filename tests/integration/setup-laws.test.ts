// Migrated from tests/kernel/test_setup_laws.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel,ROOT} from './support.ts';
import {playability_check,frozenset,confirmed_investigator,CAMPAIGN,KERNEL_DIR,MODULE,PREGEN,RpcClient,campaign_dir,create_campaign,read_json,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter,copy,pyReversed,math} from "./setup-native-support.ts";











export let REPO_ROOT:any=Path(ROOT);
export let RULES_DIR:any=pyDivide(pyDivide(pyDivide(pyDivide(REPO_ROOT,"content"),"rulesets"),"coc7"),"rules-json");
export let STEPS_PATH:any=pyDivide(pyDivide(pyDivide(REPO_ROOT,"content"),"setup"),"steps.json");



export let NON_KERNEL_OP_EXCEPTIONS:any=(await frozenset(new Set(["module.prepare"])));



export let KNOWN_STARTER_IR_FINDINGS:any=({["mystery-house"]:new Set([["actor_in_no_scene","creature-rat-swarm"]]),["the-haunting-rulebook"]:(await pySet())});

export async function registered_methods(client:any){

return (await pySet(pyAt(pyAt((await pyMethod(client,"err",["nope.method-does-not-exist",({})],{})),"details"),"methods")));
}
export async function load_json(path:any){
return (await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))],{}));
}
export async function setting_up_campaign(client:any,module:any=MODULE,campaign:any=CAMPAIGN,play_language:any="zh-Hans"){

return (await pyMethod(client,"ok",["campaign.create",({["id"]:campaign,["module"]:module,["play_language"]:play_language})],{}));
}
export async function age_bracket(age:any){
let table:any,row:any;
table=(await load_json(pyDivide(RULES_DIR,"age-adjustments.json")));
for(row of pyIterable(pyAt(table,"brackets"))){
if(pyBool((await (async()=>{const __term0=(await pyInt(pyAt(row,"min_age")));const __term1=age;const __term2=(await pyInt(pyAt(row,"max_age")));return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})()))){return row;}
}
throw new Error("raise AssertionError(f\"no age bracket covers age {age}\")");
}
export async function movement_base(str_value:any,dex_value:any,siz_value:any){
let table:any,str_rel:any,dex_rel:any,row:any;
table=(await load_json(pyDivide(RULES_DIR,"movement-rate.json")));
async function relation(value:any){
return (pyBool(pyLess(value,siz_value))?"less_than":((pyBool(pyLess(siz_value,value))?"greater_than":"equal")));
}
const __unpack4428=[(await relation(str_value)),(await relation(dex_value))];str_rel=__unpack4428[0];dex_rel=__unpack4428[1];
for(row of pyIterable(pyAt(table,"rules"))){
if(pyBool(!pyContains(["any",str_rel],pyAt(row,"str_relation_to_siz")))){continue;}
if(pyBool(!pyContains(["any",dex_rel],pyAt(row,"dex_relation_to_siz")))){continue;}
return (await pyInt(pyAt(row,"base_mov")));
}
throw new Error("raise AssertionError(f\"no movement-rate rule matches STR={str_value} DEX={dex_value} SIZ={siz_value}\")");
}
export async function damage_bonus_build(total:any){
let table:any,row:any;
table=(await load_json(pyDivide(RULES_DIR,"damage-bonus-build.json")));
for(row of pyIterable(table)){
if(pyBool((await (async()=>{const __term0=(await pyInt(pyAt(row,"min")));const __term1=total;const __term2=(await pyInt(pyAt(row,"max")));return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})()))){return [pyAt(row,"damage_bonus"),pyAt(row,"build")];}
}
throw new Error("raise AssertionError(f\"no damage-bonus-build row covers STR+SIZ={total}\")");
}
export async function occupation_row(occupation_id:any){
let table:any;
table=pyAt((await load_json(pyDivide(RULES_DIR,"occupations.json"))),"occupations");
return pyAt(table,occupation_id);
}

export async function test_setup_steps_table_matches_the_committed_content_file(kernel:any){
let from_rpc:any,from_disk:any;

from_rpc=(await pyMethod(kernel,"ok",["setup.steps",({})],{}));
from_disk=(await load_json(STEPS_PATH));
assert.ok(pyBool(pyEqual(from_rpc,from_disk)),"tests/kernel/test_setup_laws.py:126 assert from_rpc == from_disk");
assert.ok(pyBool(pyEqual(pyAt(from_rpc,"contract"),"coc.setup-steps.v1")),"tests/kernel/test_setup_laws.py:127 assert from_rpc[\"contract\"] == \"coc.setup-steps.v1\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_setup_steps_table_matches_the_committed_content_file"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_setup_steps_table_matches_the_committed_content_file(await kernel(t,{}));});
export async function test_setup_steps_is_a_dag_and_start_is_a_step(kernel:any){
let steps:any,by_id:any,visiting:any,done:any,step_id:any;
steps=pyAt((await pyMethod(kernel,"ok",["setup.steps",({})],{})),"steps");
by_id=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(steps)){__rows.push([pyAt(row,"id"),row]);}return __rows;})()));
assert.ok(pyBool(pyEqual((await pyLen(by_id)),(await pyLen(steps)))),pyStr("duplicate step ids"));
visiting=(await pySet());
done=(await pySet());
async function visit(step_id:any,chain:any){
let need:any;
if(pyBool(pyContains(done,step_id))){return ;}
assert.ok(pyBool(!pyContains(visiting,step_id)),pyStr(`cycle through ${step_id}: ${chain}`));
(await pyMethod(visiting,"add",[step_id],{}));
for(need of pyIterable((await (async()=>{const __left=(await pyMethod(pyAt(by_id,step_id),"get",["needs"],{}));return pyBool(__left)?__left:[]})()))){
assert.ok(pyBool(pyContains(by_id,need)),pyStr(`${step_id} needs unknown step ${need}`));
(await visit(need,[...chain,need]));
}
(await pyMethod(visiting,"discard",[step_id],{}));
(await pyMethod(done,"add",[step_id],{}));
}
for(step_id of pyIterable(by_id)){
(await visit(step_id,[step_id]));
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_setup_steps_is_a_dag_and_start_is_a_step"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_setup_steps_is_a_dag_and_start_is_a_step(await kernel(t,{}));});
export async function test_setup_steps_ops_are_registered_rpc_methods_with_one_documented_exception(kernel:any){
let steps:any,registered:any,op_steps:any,row:any,op:any;
steps=pyAt((await pyMethod(kernel,"ok",["setup.steps",({})],{})),"steps");
registered=(await registered_methods(kernel));
op_steps=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(steps)){if(pyBool(pyEqual((await pyMethod(row,"get",["kind"],{})),"op"))){__rows.push(row);}}return __rows;})());
assert.ok(pyBool(op_steps),pyStr("expected at least one kind:op step"));
for(row of pyIterable(op_steps)){
op=pyAt(row,"op");
assert.ok(pyBool((await (async()=>{const __left=(await pyIsInstance(op,pyStr));return pyBool(__left)?op:__left})())),pyStr(`step ${pyAt(row,"id")} has no op`));
if(pyBool(pyContains(NON_KERNEL_OP_EXCEPTIONS,op))){continue;}
assert.ok(pyBool(pyContains(registered,op)),pyStr((`step ${pyAt(row,"id")}'s op ${op} is not a registered RPC method `+`(registered: ${(await pySorted(registered))})`)));
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_setup_steps_ops_are_registered_rpc_methods_with_one_documented_exception"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_setup_steps_ops_are_registered_rpc_methods_with_one_documented_exception(await kernel(t,{}));});
export async function test_setup_steps_rejection_and_next_texts_are_nonempty_english_lines(kernel:any){
let steps:any,templates:any,key:any,row:any,lines:any;

steps=(await pyMethod(kernel,"ok",["setup.steps",({})],{}));
templates=pyAt(steps,"templates");
for(key of pyIterable(["unknown_step","needs_unmet","already_done","all_done"])){
assert.ok(pyBool((await (async()=>{const __left=(await pyIsInstance(pyAt(templates,key),pyStr));return pyBool(__left)?(await pyMethod(pyAt(templates,key),"strip",[],{})):__left})())),pyStr(key));
}
for(row of pyIterable(pyAt(steps,"steps"))){
lines=pyAt(row,"lines");
assert.ok(pyBool(pyEqual((await pySet(lines)),new Set(["do","next"]))),pyStr(pyAt(row,"id")));
assert.ok(pyBool((await (async()=>{const __left=(await pyIsInstance(pyAt(lines,"do"),pyStr));return pyBool(__left)?(await pyMethod(pyAt(lines,"do"),"strip",[],{})):__left})())),pyStr([pyAt(row,"id"),"do"]));
assert.ok(pyBool((await (async()=>{const __left=(await pyIsInstance(pyAt(lines,"next"),pyStr));return pyBool(__left)?(await pyMethod(pyAt(lines,"next"),"strip",[],{})):__left})())),pyStr([pyAt(row,"id"),"next"]));
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_setup_steps_rejection_and_next_texts_are_nonempty_english_lines"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_setup_steps_rejection_and_next_texts_are_nonempty_english_lines(await kernel(t,{}));});

export async function test_table_open_on_setting_up_campaign_sends_back_to_setup(kernel:any){
let created:any,error:any;
created=pyAt((await setting_up_campaign(kernel)),"campaign");
assert.ok(pyBool(pyEqual(pyAt(created,"status"),"setting_up")),"tests/kernel/test_setup_laws.py:187 assert created[\"status\"] == \"setting_up\"");
assert.ok(pyBool(pyEqual(pyAt(created,"investigators"),[])),"tests/kernel/test_setup_laws.py:188 assert created[\"investigators\"] == []");
error=(await pyMethod(kernel,"table_err",["open"],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"campaign_not_ready")),"tests/kernel/test_setup_laws.py:191 assert error[\"code\"] == \"campaign_not_ready\"");
assert.ok(pyBool(pyEqual(pyAt(error,"fix"),`bin/pi-coc setup --campaign ${CAMPAIGN}`)),"tests/kernel/test_setup_laws.py:192 assert error[\"fix\"] == f\"bin/pi-coc setup --campaign {CAMPAIGN}\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"status"),"setting_up")),"tests/kernel/test_setup_laws.py:193 assert error[\"details\"][\"status\"] == \"setting_up\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_table_open_on_setting_up_campaign_sends_back_to_setup"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_table_open_on_setting_up_campaign_sends_back_to_setup(await kernel(t,{}));});
export async function test_setup_methods_refuse_a_campaign_that_is_already_active(kernel:any){
let error:any,error2:any;

(await create_campaign(kernel));
error=(await pyMethod(kernel,"err",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"X",["occupation"]:"Antiquarian"})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"campaign_not_ready")),"tests/kernel/test_setup_laws.py:201 assert error[\"code\"] == \"campaign_not_ready\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"status"),"active")),"tests/kernel/test_setup_laws.py:202 assert error[\"details\"][\"status\"] == \"active\"");
error2=(await pyMethod(kernel,"err",["setup.complete",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool(pyEqual(pyAt(error2,"code"),"campaign_not_ready")),"tests/kernel/test_setup_laws.py:205 assert error2[\"code\"] == \"campaign_not_ready\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error2,"details"),"status"),"active")),"tests/kernel/test_setup_laws.py:206 assert error2[\"details\"][\"status\"] == \"active\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_setup_methods_refuse_a_campaign_that_is_already_active"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_setup_methods_refuse_a_campaign_that_is_already_active(await kernel(t,{}));});

export let ANTIQUARIAN_FORMULA_CHARS:any=1;

export async function test_setup_occupations_lists_antiquarian_with_its_book_numbers(kernel:any){
let created:any,occupations:any,row:any,book:any;
created=(await setting_up_campaign(kernel));
occupations=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await pyMethod(kernel,"ok",["setup.occupations",({["campaign"]:CAMPAIGN})],{})),"occupations"))){__rows.push([pyAt(row,"id"),row]);}return __rows;})()));
assert.ok(pyBool(pyContains(occupations,"Antiquarian")),"tests/kernel/test_setup_laws.py:218 assert \"Antiquarian\" in occupations");
row=pyAt(occupations,"Antiquarian");
book=(await occupation_row("Antiquarian"));
assert.ok(pyBool((await (async()=>{const __term0=pyAt(row,"skill_point_formula");const __term1=pyAt(book,"skill_point_formula");const __term2="EDU*4";return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_setup_laws.py:221 assert row[\"skill_point_formula\"] == book[\"skill_point_formula\"] == \"EDU*4\"");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(row,"credit_rating_range");const __term1=pyAt(book,"credit_rating_range");const __term2=[30,70];return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_setup_laws.py:222 assert row[\"credit_rating_range\"] == book[\"credit_rating_range\"] == [30, 70]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_setup_occupations_lists_antiquarian_with_its_book_numbers"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_setup_occupations_lists_antiquarian_with_its_book_numbers(await kernel(t,{}));});
export async function test_setup_investigator_derived_values_match_rulebook_arithmetic(kernel:any){
let result:any,sheet:any,chars:any,derived:any,bracket:any,base_mov:any,expected_db:any,expected_build:any,occ:any,book:any,interest:any;
(await setting_up_campaign(kernel));
result=(await pyMethod(kernel,"ok",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"陈墨",["occupation"]:"Antiquarian",["concept"]:"爱书的旧货商",["age"]:27,["method"]:"quick_fire",["seed"]:"h5-fixed-seed-1"})],{}));
sheet=pyAt(result,"sheet");
chars=pyAt(sheet,"characteristics");
derived=pyAt(sheet,"derived");
assert.ok(pyBool(pyEqual(pyAt(derived,"HP"),Math.floor((pyAdd(pyAt(chars,"CON"),pyAt(chars,"SIZ")))/10))),"tests/kernel/test_setup_laws.py:236 assert derived[\"HP\"] == (chars[\"CON\"] + chars[\"SIZ\"]) // 10");
assert.ok(pyBool(pyEqual(pyAt(derived,"MP"),Math.floor(pyAt(chars,"POW")/5))),"tests/kernel/test_setup_laws.py:237 assert derived[\"MP\"] == chars[\"POW\"] // 5");
assert.ok(pyBool(pyEqual(pyAt(derived,"SAN"),pyAt(chars,"POW"))),"tests/kernel/test_setup_laws.py:238 assert derived[\"SAN\"] == chars[\"POW\"]");
bracket=(await age_bracket(pyAt(sheet,"age")));
base_mov=(await movement_base(pyAt(chars,"STR"),pyAt(chars,"DEX"),pyAt(chars,"SIZ")));
assert.ok(pyBool(pyEqual(pyAt(derived,"MOV"),(await pyMax(0,pySubtract(base_mov,(await pyInt(pyAt(bracket,"mov_penalty")))))))),"tests/kernel/test_setup_laws.py:244 assert derived[\"MOV\"] == max(0, base_mov - int(bracket[\"mov_penalty\"]))");
const __unpack10986=(await damage_bonus_build(pyAdd(pyAt(chars,"STR"),pyAt(chars,"SIZ"))));expected_db=__unpack10986[0];expected_build=__unpack10986[1];
assert.ok(pyBool(pyEqual(pyAt(derived,"DB"),expected_db)),"tests/kernel/test_setup_laws.py:248 assert derived[\"DB\"] == expected_db");
assert.ok(pyBool(pyEqual(pyAt(derived,"BUILD"),expected_build)),"tests/kernel/test_setup_laws.py:249 assert derived[\"BUILD\"] == expected_build");
assert.ok(pyBool(pyEqual((pyAt(chars,"LUCK")%5),0)),"tests/kernel/test_setup_laws.py:252 assert chars[\"LUCK\"] % 5 == 0");
assert.ok(pyBool((await (async()=>{const __term0=15;const __term1=pyAt(chars,"LUCK");const __term2=90;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})())),"tests/kernel/test_setup_laws.py:253 assert 15 <= chars[\"LUCK\"] <= 90");
occ=pyAt(pyAt(pyAt(sheet,"creation"),"skills"),"occupation");
book=(await occupation_row("Antiquarian"));
assert.ok(pyBool(pyEqual(pyAt(pyAt(occ,"budget"),"total"),pyMultiply(pyAt(chars,"EDU"),4))),"tests/kernel/test_setup_laws.py:259 assert occ[\"budget\"][\"total\"] == chars[\"EDU\"] * 4");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(occ,"credit_rating"),"value");const __term1=pyAt(pyAt(book,"credit_rating_range"),0);const __term2=pyAt(sheet,"credit_rating");return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_setup_laws.py:260 assert occ[\"credit_rating\"][\"value\"] == book[\"credit_rating_range\"][0] == sheet[\"credit_rating\"]");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(book,"credit_rating_range"),0);const __term1=pyAt(sheet,"credit_rating");const __term2=pyAt(pyAt(book,"credit_rating_range"),1);return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})())),"tests/kernel/test_setup_laws.py:261 assert book[\"credit_rating_range\"][0] <= sheet[\"credit_rating\"] <= book[\"credit_rating_range\"][1]");
assert.ok(pyBool(pyEqual(pyAt(occ,"points"),pySubtract(pyAt(pyAt(occ,"budget"),"total"),pyAt(pyAt(occ,"credit_rating"),"value")))),"tests/kernel/test_setup_laws.py:262 assert occ[\"points\"] == occ[\"budget\"][\"total\"] - occ[\"credit_rating\"][\"value\"]");
assert.ok(pyBool(pyEqual(pyAdd(pyAt(occ,"spent"),pyAt(occ,"unspent")),pyAt(occ,"points"))),"tests/kernel/test_setup_laws.py:263 assert occ[\"spent\"] + occ[\"unspent\"] == occ[\"points\"]");
interest=pyAt(pyAt(pyAt(sheet,"creation"),"skills"),"interest");
assert.ok(pyBool(pyEqual(pyAt(pyAt(interest,"budget"),"total"),pyMultiply(pyAt(chars,"INT"),2))),"tests/kernel/test_setup_laws.py:268 assert interest[\"budget\"][\"total\"] == chars[\"INT\"] * 2");
assert.ok(pyBool(pyEqual(pyAdd(pyAt(interest,"spent"),pyAt(interest,"unspent")),pyAt(pyAt(interest,"budget"),"total"))),"tests/kernel/test_setup_laws.py:269 assert interest[\"spent\"] + interest[\"unspent\"] == interest[\"budget\"][\"total\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_setup_investigator_derived_values_match_rulebook_arithmetic"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_setup_investigator_derived_values_match_rulebook_arithmetic(await kernel(t,{}));});
export async function test_setup_investigator_is_deterministic_under_the_same_seed(kernel:any){
let common:any,first:any,second:any,key:any;
(await setting_up_campaign(kernel));
common=({["campaign"]:CAMPAIGN,["occupation"]:"Antiquarian",["concept"]:"旧书店主",["age"]:34,["method"]:"quick_fire",["seed"]:"h5-repeat-seed"});
first=pyAt((await pyMethod(kernel,"ok",["setup.investigator",({...common,["name"]:"甲"})],{})),"sheet");
second=pyAt((await pyMethod(kernel,"ok",["setup.investigator",({...common,["name"]:"乙",["id"]:"inv-2"})],{})),"sheet");
for(key of pyIterable(["characteristics","derived","skills","credit_rating"])){
assert.ok(pyBool(pyEqual(pyAt(first,key),pyAt(second,key))),pyStr(key));
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_setup_investigator_is_deterministic_under_the_same_seed"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_setup_investigator_is_deterministic_under_the_same_seed(await kernel(t,{}));});
export async function test_setup_investigator_unknown_occupation_asks_for_one_of_the_options(kernel:any){
let error:any;
(await setting_up_campaign(kernel));
error=(await pyMethod(kernel,"err",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"X",["occupation"]:"not-a-real-job"})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"needs")),"tests/kernel/test_setup_laws.py:286 assert error[\"code\"] == \"needs\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(error,"details"),"needs"),"field"),"occupation")),"tests/kernel/test_setup_laws.py:287 assert error[\"details\"][\"needs\"][\"field\"] == \"occupation\"");
assert.ok(pyBool(pyContains(pyAt(pyAt(pyAt(error,"details"),"needs"),"options"),"Antiquarian")),"tests/kernel/test_setup_laws.py:288 assert \"Antiquarian\" in error[\"details\"][\"needs\"][\"options\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_setup_investigator_unknown_occupation_asks_for_one_of_the_options"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_setup_investigator_unknown_occupation_asks_for_one_of_the_options(await kernel(t,{}));});

export async function test_setup_complete_needs_an_investigator_first(kernel:any){
let error:any;
(await setting_up_campaign(kernel));
error=(await pyMethod(kernel,"err",["setup.complete",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"needs")),"tests/kernel/test_setup_laws.py:297 assert error[\"code\"] == \"needs\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(error,"details"),"needs"),"field"),"investigator")),"tests/kernel/test_setup_laws.py:298 assert error[\"details\"][\"needs\"][\"field\"] == \"investigator\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_setup_complete_needs_an_investigator_first"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_setup_complete_needs_an_investigator_first(await kernel(t,{}));});
export async function test_setup_complete_writes_handoff_and_flips_status_then_opens(kernel:any){
let created:any,investigator_id:any,handoff:any,meta:any,replay:any,opened:any,reopened_meta:any;
(await setting_up_campaign(kernel));
created=(await confirmed_investigator(kernel,({"name":"Shen"})));
investigator_id=pyAt(pyAt(created,"investigator"),"id");
handoff=(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool(pyEqual(pyAt(handoff,"status"),"ready_for_table")),"tests/kernel/test_setup_laws.py:307 assert handoff[\"status\"] == \"ready_for_table\"");
assert.ok(pyBool(pyEqual(pyAt(handoff,"receipt"),"setup:handoff")),"tests/kernel/test_setup_laws.py:308 assert handoff[\"receipt\"] == \"setup:handoff\"");
assert.ok(pyBool(pyEqual(pyAt(handoff,"module_id"),MODULE)),"tests/kernel/test_setup_laws.py:309 assert handoff[\"module_id\"] == MODULE");
assert.ok(pyBool(pyEqual(pyAt(handoff,"investigators"),[investigator_id])),"tests/kernel/test_setup_laws.py:310 assert handoff[\"investigators\"] == [investigator_id]");
assert.ok(pyBool(pyEqual(pyAt(handoff,"launch"),`bin/pi-coc --campaign ${CAMPAIGN}`)),"tests/kernel/test_setup_laws.py:311 assert handoff[\"launch\"] == f\"bin/pi-coc --campaign {CAMPAIGN}\"");
meta=(await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json")));
assert.ok(pyBool(pyEqual(pyAt(meta,"status"),"ready_for_table")),"tests/kernel/test_setup_laws.py:314 assert meta[\"status\"] == \"ready_for_table\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(meta,"setup"),"handoff"),handoff);return pyBool(__left)?__left:pyEqual(pyAt(pyAt(pyAt(meta,"setup"),"handoff"),"receipt"),"setup:handoff")})())),"tests/kernel/test_setup_laws.py:315 assert meta[\"setup\"][\"handoff\"] == handoff or meta[\"setup\"][\"handoff\"][\"receipt\"] == \"setup:handoff\"");
replay=(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool((pyAt(replay,"replayed")===true)),"tests/kernel/test_setup_laws.py:318 assert replay[\"replayed\"] is True");
assert.ok(pyBool(pyEqual(pyAt(replay,"status"),"ready_for_table")),"tests/kernel/test_setup_laws.py:319 assert replay[\"status\"] == \"ready_for_table\"");
opened=(await pyMethod(kernel,"table",["open"],{}));
assert.ok(pyBool((pyAt(opened,"opening_needed")===true)),"tests/kernel/test_setup_laws.py:322 assert opened[\"opening_needed\"] is True");
reopened_meta=(await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json")));
assert.ok(pyBool(pyEqual(pyAt(reopened_meta,"status"),"active")),"tests/kernel/test_setup_laws.py:324 assert reopened_meta[\"status\"] == \"active\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_setup_complete_writes_handoff_and_flips_status_then_opens"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_setup_complete_writes_handoff_and_flips_status_then_opens(await kernel(t,{}));});
export async function test_setup_complete_module_not_ready_is_unreachable_for_a_starter(kernel:any){
let module_meta:any;

(await setting_up_campaign(kernel));
module_meta=(await read_json(pyDivide(pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"modules"),MODULE),"module.json")));
assert.ok(pyBool(pyEqual(pyAt(module_meta,"status"),"installed")),"tests/kernel/test_setup_laws.py:336 assert module_meta[\"status\"] == \"installed\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_setup_complete_module_not_ready_is_unreachable_for_a_starter"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_setup_complete_module_not_ready_is_unreachable_for_a_starter(await kernel(t,{}));});

export async function test_new_starter_creates_a_campaign_opens_and_passes_the_ten_invariants(starter_id:any,kernel:any){
let graph_path:any,created:any,handoff:any,opened:any,graph:any,report:any,hard_invariants:any,other_findings:any,unprovable:any;

graph_path=pyDivide(pyDivide(pyDivide(pyDivide(REPO_ROOT,"content"),"starters"),starter_id),"module-graph.json");
assert.ok(pyBool((await pyMethod(graph_path,"exists",[],{}))),pyStr(`${starter_id} has no module-graph.json yet (scripts/starter_graph.py §14.9)`));
(await setting_up_campaign(kernel,starter_id,undefined,undefined));
created=(await confirmed_investigator(kernel));
assert.ok(pyBool(pyAt(pyAt(created,"investigator"),"id")),"tests/kernel/test_setup_laws.py:373 assert created[\"investigator\"][\"id\"]");
handoff=(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool(pyEqual(pyAt(handoff,"status"),"ready_for_table")),"tests/kernel/test_setup_laws.py:375 assert handoff[\"status\"] == \"ready_for_table\"");
opened=(await pyMethod(kernel,"table",["open"],{}));
assert.ok(pyBool((pyAt(opened,"opening_needed")===true)),"tests/kernel/test_setup_laws.py:378 assert opened[\"opening_needed\"] is True");
assert.ok(pyBool(pyAt(pyAt(opened,"scene"),"name")),"tests/kernel/test_setup_laws.py:379 assert opened[\"scene\"][\"name\"]");
graph=(await load_json(graph_path));
report=(await playability_check(graph));
hard_invariants=new Set(["dangling_relation","no_entrance_declared","no_ending_declared","scene_graph_fragmented","scene_unreachable_from_entrance","conclusion_without_support","clue_supports_nothing"]);
assert.ok(pyBool(!pyBool((pyIntersection((await pySet(pyAt(report,"finding_counts"))),hard_invariants)))),pyStr(pyAt(report,"finding_counts")));
other_findings=new Set((await (async()=>{const __rows:any[]=[];for(const f of pyIterable(pyAt(report,"findings"))){if(pyBool(!pyEqual(pyAt(f,"code"),"node_without_page"))){__rows.push([pyAt(f,"code"),pyAt(f,"subject")]);}}return __rows;})()));
assert.ok(pyBool(pyEqual(other_findings,pyAt(KNOWN_STARTER_IR_FINDINGS,starter_id))),"tests/kernel/test_setup_laws.py:388 assert other_findings == KNOWN_STARTER_IR_FINDINGS[starter_id]");
unprovable=(await pyMethod(pyAt(report,"finding_counts"),"get",["node_without_page",0],{}));
assert.ok(pyBool(pyEqual(unprovable,((pyBool((await pyMethod(graph,"get",["source_refs"],{})))?0:(await pyLen(pyAt(graph,"nodes"))))))),pyStr(unprovable));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("starter_id",["mystery-house","the-haunting-rulebook"]))).entries())test("test_new_starter_creates_a_campaign_opens_and_passes_the_ten_invariants"+((pyCartesian([{}],pyParametrize("starter_id",["mystery-house","the-haunting-rulebook"]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_new_starter_creates_a_campaign_opens_and_passes_the_ten_invariants(row["starter_id"],await kernel(t,{}));});
