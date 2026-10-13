// Migrated from tests/kernel/test_setup.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel,ROOT} from './support.ts';
import {SetupSteps,confirmed_investigator,CAMPAIGN,CONTENT_DIR,KERNEL_DIR,MODULE,PREGEN,campaign_dir,git_log,read_json,read_jsonl,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter,copy,pyReversed,math} from "./setup-native-support.ts";









export let STEPS_PATH:any=pyDivide(pyDivide(CONTENT_DIR,"setup"),"steps.json");



export let STEP_IDS:any=["choose-source","prepare-module","create-campaign","create-investigator","confirm-investigator","browse-library","load-investigator","complete"];


export let NEW_LANE_STEP_IDS:any=(await (async()=>{const __rows:any[]=[];for(const step_id of pyIterable(STEP_IDS)){if(pyBool(!pyContains(["browse-library","load-investigator"],step_id))){__rows.push(step_id);}}return __rows;})());
export let LIBRARY_LANE_STEP_IDS:any=(await (async()=>{const __rows:any[]=[];for(const step_id of pyIterable(STEP_IDS)){if(pyBool(!pyContains(new Set(["create-investigator","confirm-investigator"]),step_id))){__rows.push(step_id);}}return __rows;})());
export async function create_setting_up(kernel:any,campaign_id:any=CAMPAIGN,module:any=MODULE){
return pyAt((await pyMethod(kernel,"ok",["campaign.create",({["id"]:campaign_id,["module"]:module,["play_language"]:"zh-Hans"})],{})),"campaign");
}

export async function test_create_without_pregen_is_setting_up_with_an_empty_party(kernel:any){
let created:any,module:any;
created=(await create_setting_up(kernel));
assert.ok(pyBool(pyEqual(pyAt(created,"status"),"setting_up")),"tests/kernel/test_setup.py:35 assert created[\"status\"] == \"setting_up\"");
assert.ok(pyBool(pyEqual(pyAt(created,"investigators"),[])),"tests/kernel/test_setup.py:36 assert created[\"investigators\"] == []");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(created,"module_generation"),1);return pyBool(__left)?pyEqual((await pyLen(pyAt(created,"module_digest"))),64):__left})())),"tests/kernel/test_setup.py:37 assert created[\"module_generation\"] == 1 and len(created[\"module_digest\"]) == 64");
assert.ok(pyBool(!pyBool((await pyList((await pyMethod((pyDivide((await campaign_dir(kernel.workspace)),"party")),"glob",["*.json"],{})))))),"tests/kernel/test_setup.py:38 assert not list((campaign_dir(kernel.workspace) / \"party\").glob(\"*.json\"))");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"ok",["campaign.list"],{})),"campaigns"),0),"status"),"setting_up")),"tests/kernel/test_setup.py:39 assert kernel.ok(\"campaign.list\")[\"campaigns\"][0][\"status\"] == \"setting_up\"");
module=(await read_json(pyDivide(pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"modules"),MODULE),"module.json")));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(module,"status"),"installed");return pyBool(__left)?pyEqual(pyAt(module,"source"),"starter"):__left})());return pyBool(__left)?pyEqual(pyAt(module,"generation"),1):__left})())),"tests/kernel/test_setup.py:42 assert module[\"status\"] == \"installed\" and module[\"source\"] == \"starter\" and module[\"generation\"] == 1");
assert.ok(pyBool((await pyMethod((pyDivide(pyDivide(pyDivide(pyDivide(kernel.workspace,".coc"),"modules"),MODULE),"module-graph.json")),"exists",[],{}))),"tests/kernel/test_setup.py:43 assert (kernel.workspace / \".coc\" / \"modules\" / MODULE / \"module-graph.json\").exists()");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_create_without_pregen_is_setting_up_with_an_empty_party"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_create_without_pregen_is_setting_up_with_an_empty_party(await kernel(t,{}));});
export async function test_create_with_pregen_stays_active_as_before(kernel:any){
let created:any;
created=pyAt((await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:MODULE,["pregen"]:PREGEN})],{})),"campaign");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(created,"status"),"active");return pyBool(__left)?pyEqual(pyAt(created,"investigators"),[PREGEN]):__left})())),"tests/kernel/test_setup.py:48 assert created[\"status\"] == \"active\" and created[\"investigators\"] == [PREGEN]");
assert.ok(pyBool((pyAt((await pyMethod(kernel,"table",["open"],{})),"opening_needed")===true)),"tests/kernel/test_setup.py:49 assert kernel.table(\"open\")[\"opening_needed\"] is True");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_create_with_pregen_stays_active_as_before"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_create_with_pregen_stays_active_as_before(await kernel(t,{}));});
export async function test_open_refuses_a_campaign_that_is_setting_up_with_the_table_fix(kernel:any){
let steps:any,error:any,method:any,params:any;
(await create_setting_up(kernel));
steps=(await pyMethod(json,"loads",[(await pyMethod(STEPS_PATH,"read_text",[],{"encoding":"utf-8"}))],{}));
error=(await pyMethod(kernel,"table_err",["open"],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"campaign_not_ready")),"tests/kernel/test_setup.py:56 assert error[\"code\"] == \"campaign_not_ready\"");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(error,"fix");const __term1=(await pyMethod(pyAt(steps,"table_open_fix"),"format",[],{"campaign":CAMPAIGN}));const __term2=`bin/pi-coc setup --campaign ${CAMPAIGN}`;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_setup.py:57 assert error[\"fix\"] == steps[\"table_open_fix\"].format(campaign=CAMPAIGN) == f\"bin/pi-coc setup --campaign {CAMPAIGN}\"");
for([method,params] of pyIterable([["look",({})],["capsule",({})],["player_input",({["text"]:"x"})]])){
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",[method],{...params})),"code"),"campaign_not_ready")),"tests/kernel/test_setup.py:59 assert kernel.table_err(method, **params)[\"code\"] == \"campaign_not_ready\"");
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_open_refuses_a_campaign_that_is_setting_up_with_the_table_fix"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_open_refuses_a_campaign_that_is_setting_up_with_the_table_fix(await kernel(t,{}));});
export async function test_first_open_of_a_ready_campaign_makes_it_active(kernel:any){
let done:any,opened:any;
(await create_setting_up(kernel));
(await confirmed_investigator(kernel));
done=(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool(pyEqual(pyAt(done,"status"),"ready_for_table")),"tests/kernel/test_setup.py:66 assert done[\"status\"] == \"ready_for_table\"");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json"))),"status"),"ready_for_table")),"tests/kernel/test_setup.py:67 assert read_json(campaign_dir(kernel.workspace) / \"campaign.json\")[\"status\"] == \"ready_for_table\"");
opened=(await pyMethod(kernel,"table",["open"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(opened,"campaign"),"status"),"active")),"tests/kernel/test_setup.py:69 assert opened[\"campaign\"][\"status\"] == \"active\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(opened,"investigators"),0),"id"),"investigator")),"tests/kernel/test_setup.py:70 assert opened[\"investigators\"][0][\"id\"] == \"investigator\"");
assert.ok(pyBool((pyAt(opened,"opening_needed")===true)),"tests/kernel/test_setup.py:71 assert opened[\"opening_needed\"] is True");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json"))),"status"),"active")),"tests/kernel/test_setup.py:72 assert read_json(campaign_dir(kernel.workspace) / \"campaign.json\")[\"status\"] == \"active\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"table",["open"],{})),"campaign"),"status"),"active")),"tests/kernel/test_setup.py:73 assert kernel.table(\"open\")[\"campaign\"][\"status\"] == \"active\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"B",["occupation"]:"Artist"})],{})),"code"),"campaign_not_ready")),"tests/kernel/test_setup.py:75 assert kernel.err(\"setup.investigator\", {\"campaign\": CAMPAIGN, \"name\": \"B\", \"occupation\": \"Artist\"})[\"code\"] == \"campaign_not_ready\"");
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t0-c1","text":"开场。"}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我看看。"})),"turn"),1)),"tests/kernel/test_setup.py:78 assert kernel.table(\"player_input\", text=\"我看看。\")[\"turn\"] == 1");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_first_open_of_a_ready_campaign_makes_it_active"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_first_open_of_a_ready_campaign_makes_it_active(await kernel(t,{}));});

export async function test_steps_table_is_the_seven_steps_in_order_and_a_dag(kernel:any){
let table:any,by_id:any,step:any,need:any;
table=(await pyMethod(kernel,"ok",["setup.steps",({})],{}));
assert.ok(pyBool(pyEqual(table,(await pyMethod(json,"loads",[(await pyMethod(STEPS_PATH,"read_text",[],{"encoding":"utf-8"}))],{})))),"tests/kernel/test_setup.py:85 assert table == json.loads(STEPS_PATH.read_text(encoding=\"utf-8\"))");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(table,"steps"))){__rows.push(pyAt(s,"id"));}return __rows;})()),STEP_IDS)),"tests/kernel/test_setup.py:86 assert [s[\"id\"] for s in table[\"steps\"]] == STEP_IDS");
assert.ok(pyBool(pyEqual(pyAt(table,"start"),"choose-source")),"tests/kernel/test_setup.py:87 assert table[\"start\"] == \"choose-source\"");
by_id=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(table,"steps"))){__rows.push([pyAt(s,"id"),s]);}return __rows;})()));
for(step of pyIterable(pyAt(table,"steps"))){
assert.ok(pyBool(pyContains(["ask","external","op"],pyAt(step,"kind"))),"tests/kernel/test_setup.py:90 assert step[\"kind\"] in (\"ask\", \"external\", \"op\")");
assert.ok(pyBool(pyEqual(((pyAt(step,"op")!==null)),(pyEqual(pyAt(step,"kind"),"op")))),"tests/kernel/test_setup.py:91 assert (step[\"op\"] is not None) == (step[\"kind\"] == \"op\")");
assert.ok(pyBool(pyContains([null,"starter","pdf"],pyAt(step,"only_for"))),"tests/kernel/test_setup.py:92 assert step[\"only_for\"] in (None, \"starter\", \"pdf\")");
assert.ok(pyBool(pyContains([null,"new","library"],(await pyMethod(step,"get",["investigator_source"],{})))),"tests/kernel/test_setup.py:93 assert step.get(\"investigator_source\") in (None, \"new\", \"library\")");
for(need of pyIterable(pyAt(step,"needs"))){
assert.ok(pyBool((await (async()=>{const __left=pyContains(by_id,need);return pyBool(__left)?pyLess((await pyMethod(STEP_IDS,"index",[need],{})),(await pyMethod(STEP_IDS,"index",[pyAt(step,"id")],{}))):__left})())),"tests/kernel/test_setup.py:95 assert need in by_id and STEP_IDS.index(need) < STEP_IDS.index(step[\"id\"])");
}
assert.ok(pyBool((await (async()=>{const __left=pyAt(pyAt(step,"lines"),"next");return pyBool(__left)?pyAt(pyAt(step,"lines"),"do"):__left})())),"tests/kernel/test_setup.py:96 assert step[\"lines\"][\"next\"] and step[\"lines\"][\"do\"]");
}
assert.ok(pyBool(pyEqual(pyAt(pyAt(by_id,"prepare-module"),"needs"),["choose-source"])),"tests/kernel/test_setup.py:97 assert by_id[\"prepare-module\"][\"needs\"] == [\"choose-source\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(by_id,"prepare-module"),"applies_to"),["pdf","module"])),"tests/kernel/test_setup.py:98 assert by_id[\"prepare-module\"][\"applies_to\"] == [\"pdf\", \"module\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(by_id,"create-investigator"),"needs"),["create-campaign","prepare-module"])),"tests/kernel/test_setup.py:99 assert by_id[\"create-investigator\"][\"needs\"] == [\"create-campaign\", \"prepare-module\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(by_id,"create-investigator"),"investigator_source"),"new")),"tests/kernel/test_setup.py:100 assert by_id[\"create-investigator\"][\"investigator_source\"] == \"new\"");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(by_id,"browse-library"),"investigator_source");const __term1=pyAt(pyAt(by_id,"load-investigator"),"investigator_source");const __term2="library";return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_setup.py:101 assert by_id[\"browse-library\"][\"investigator_source\"] == by_id[\"load-investigator\"][\"investigator_source\"] == \"library\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(by_id,"load-investigator"),"needs"),["browse-library"])),"tests/kernel/test_setup.py:102 assert by_id[\"load-investigator\"][\"needs\"] == [\"browse-library\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(by_id,"complete"),"needs"),["confirm-investigator","load-investigator"])),"tests/kernel/test_setup.py:103 assert by_id[\"complete\"][\"needs\"] == [\"confirm-investigator\", \"load-investigator\"]");
assert.ok(pyBool(pyEqual(pyAt(table,"investigator_sources"),["new","library"])),"tests/kernel/test_setup.py:104 assert table[\"investigator_sources\"] == [\"new\", \"library\"]");
assert.ok(pyBool(pyEqual((await pySet(pyAt(table,"templates"))),new Set(["unknown_step","needs_unmet","already_done","all_done"]))),"tests/kernel/test_setup.py:105 assert set(table[\"templates\"]) == {\"unknown_step\", \"needs_unmet\", \"already_done\", \"all_done\"}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_steps_table_is_the_seven_steps_in_order_and_a_dag"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_steps_table_is_the_seven_steps_in_order_and_a_dag(await kernel(t,{}));});
export async function test_pdf_and_reused_modules_share_preparation_while_starters_skip_it(kernel:any){
let table:any,steps:any;

table=(await pyMethod(kernel,"ok",["setup.steps",({})],{}));
assert.ok(pyBool(pyEqual(pyAt(table,"sources"),["starter","pdf","module"])),"tests/kernel/test_setup.py:111 assert table[\"sources\"] == [\"starter\", \"pdf\", \"module\"]");
steps=(await SetupSteps(STEPS_PATH));
assert.ok(pyBool(((await pyMethod(steps,"applies",["prepare-module","pdf"],{}))===true)),"tests/kernel/test_setup.py:113 assert steps.applies(\"prepare-module\", \"pdf\") is True");
assert.ok(pyBool(((await pyMethod(steps,"applies",["prepare-module","module"],{}))===true)),"tests/kernel/test_setup.py:114 assert steps.applies(\"prepare-module\", \"module\") is True");
assert.ok(pyBool(((await pyMethod(steps,"applies",["prepare-module","starter"],{}))===false)),"tests/kernel/test_setup.py:115 assert steps.applies(\"prepare-module\", \"starter\") is False");
assert.ok(pyBool(pyEqual((await pyMethod(steps,"order",[new Set(["module","new"])],{})),NEW_LANE_STEP_IDS)),"tests/kernel/test_setup.py:116 assert steps.order({\"module\", \"new\"}) == NEW_LANE_STEP_IDS");
assert.ok(pyBool(pyEqual((await pyMethod(steps,"order",[new Set(["pdf","new"])],{})),NEW_LANE_STEP_IDS)),"tests/kernel/test_setup.py:117 assert steps.order({\"pdf\", \"new\"}) == NEW_LANE_STEP_IDS");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_pdf_and_reused_modules_share_preparation_while_starters_skip_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_pdf_and_reused_modules_share_preparation_while_starters_skip_it(await kernel(t,{}));});
export async function test_investigator_source_is_a_second_independent_axis_and_skips_the_other_lane_as_not_applicable(kernel:any){
let table:any,steps:any,library_only:any,new_lane:any,library_lane:any;

table=(await pyMethod(kernel,"ok",["setup.steps",({})],{}));
assert.ok(pyBool(pyEqual(pyAt(table,"investigator_sources"),["new","library"])),"tests/kernel/test_setup.py:128 assert table[\"investigator_sources\"] == [\"new\", \"library\"]");
steps=(await SetupSteps(STEPS_PATH));
assert.ok(pyBool(((await pyMethod(steps,"applies",["create-investigator","new"],{}))===true)),"tests/kernel/test_setup.py:131 assert steps.applies(\"create-investigator\", \"new\") is True");
assert.ok(pyBool(((await pyMethod(steps,"applies",["create-investigator","library"],{}))===false)),"tests/kernel/test_setup.py:132 assert steps.applies(\"create-investigator\", \"library\") is False");
for(library_only of pyIterable(["browse-library","load-investigator"])){
assert.ok(pyBool(((await pyMethod(steps,"applies",[library_only,"library"],{}))===true)),"tests/kernel/test_setup.py:134 assert steps.applies(library_only, \"library\") is True");
assert.ok(pyBool(((await pyMethod(steps,"applies",[library_only,"new"],{}))===false)),"tests/kernel/test_setup.py:135 assert steps.applies(library_only, \"new\") is False");
}
new_lane=(await pyMethod(steps,"order",[new Set(["starter","new"])],{}));
assert.ok(pyBool(pyContains(new_lane,"create-investigator")),"tests/kernel/test_setup.py:140 assert \"create-investigator\" in new_lane");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(new_lane,"browse-library");return pyBool(__left)?!pyContains(new_lane,"load-investigator"):__left})())),"tests/kernel/test_setup.py:141 assert \"browse-library\" not in new_lane and \"load-investigator\" not in new_lane");
library_lane=(await pyMethod(steps,"order",[new Set(["starter","library"])],{}));
assert.ok(pyBool(!pyContains(library_lane,"create-investigator")),"tests/kernel/test_setup.py:146 assert \"create-investigator\" not in library_lane");
assert.ok(pyBool((await (async()=>{const __left=pyContains(library_lane,"browse-library");return pyBool(__left)?pyContains(library_lane,"load-investigator"):__left})())),"tests/kernel/test_setup.py:147 assert \"browse-library\" in library_lane and \"load-investigator\" in library_lane");
assert.ok(pyBool(pyEqual((await pyMethod(steps,"order",[new Set(["pdf","new"])],{})),NEW_LANE_STEP_IDS)),"tests/kernel/test_setup.py:151 assert steps.order({\"pdf\", \"new\"}) == NEW_LANE_STEP_IDS");
assert.ok(pyBool(pyEqual((await pyMethod(steps,"order",[new Set(["pdf","library"])],{})),LIBRARY_LANE_STEP_IDS)),"tests/kernel/test_setup.py:152 assert steps.order({\"pdf\", \"library\"}) == LIBRARY_LANE_STEP_IDS");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_investigator_source_is_a_second_independent_axis_and_skips_the_other_lane_as_not_applicable"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_investigator_source_is_a_second_independent_axis_and_skips_the_other_lane_as_not_applicable(await kernel(t,{}));});
export async function test_kernel_side_ops_in_the_table_exist(kernel:any){
let table:any,methods:any,step:any;
table=(await pyMethod(kernel,"ok",["setup.steps",({})],{}));
methods=(await pySet(pyAt(pyAt((await pyMethod(kernel,"err",["no.such.method"],{})),"details"),"methods")));
for(step of pyIterable(pyAt(table,"steps"))){
if(pyBool(!pyEqual(pyAt(step,"kind"),"op"))){continue;}
if(pyBool(pyEqual((await pyMethod(step,"get",["side"],{})),"extension"))){assert.ok(pyBool(pyEqual(pyAt(step,"op"),"module.prepare")),"tests/kernel/test_setup.py:162 assert step[\"op\"] == \"module.prepare\"");
continue;}
assert.ok(pyBool(pyContains(methods,pyAt(step,"op"))),pyStr(pyAt(step,"op")));
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_kernel_side_ops_in_the_table_exist"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_kernel_side_ops_in_the_table_exist(await kernel(t,{}));});

export async function test_occupations_are_the_rules_table(kernel:any){
let result:any,occupations:any,journalist:any;
result=(await pyMethod(kernel,"ok",["setup.occupations",({})],{}));
occupations=pyAt((await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(pyDivide(pyDivide(CONTENT_DIR,"rulesets"),"coc7"),"rules-json"),"occupations.json")),"read_text",[],{}))],{})),"occupations");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(result,"occupations"))){__rows.push(pyAt(row,"id"));}return __rows;})()),(await pyList(occupations)))),"tests/kernel/test_setup.py:172 assert [row[\"id\"] for row in result[\"occupations\"]] == list(occupations)");
journalist=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(result,"occupations"))){if(pyBool(pyEqual(pyAt(row,"id"),"Journalist"))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(journalist,"skill_point_formula"),pyAt(pyAt(occupations,"Journalist"),"skill_point_formula"))),"tests/kernel/test_setup.py:174 assert journalist[\"skill_point_formula\"] == occupations[\"Journalist\"][\"skill_point_formula\"]");
assert.ok(pyBool(pyEqual(pyAt(journalist,"credit_rating_range"),pyAt(pyAt(occupations,"Journalist"),"credit_rating_range"))),"tests/kernel/test_setup.py:175 assert journalist[\"credit_rating_range\"] == occupations[\"Journalist\"][\"credit_rating_range\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_occupations_are_the_rules_table"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_occupations_are_the_rules_table(await kernel(t,{}));});
export async function test_investigator_writes_a_pregen_shaped_sheet_and_a_receipt(kernel:any){
let result:any,row:any,sheet:any,meta:any,second:any;
(await create_setting_up(kernel));
result=(await pyMethod(kernel,"ok",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"艾达·王",["occupation"]:"Journalist",["concept"]:"战地记者",["age"]:31,["sex"]:"F"})],{}));
assert.ok(pyBool(pyEqual(pyAt(result,"receipt"),"investigator:inv-1")),"tests/kernel/test_setup.py:182 assert result[\"receipt\"] == \"investigator:inv-1\"");
row=pyAt(result,"investigator");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(row,"id"),"inv-1");return pyBool(__left)?pyEqual(pyAt(row,"name"),"艾达·王"):__left})());return pyBool(__left)?pyEqual(pyAt(row,"occupation"),"Journalist"):__left})())),"tests/kernel/test_setup.py:184 assert row[\"id\"] == \"inv-1\" and row[\"name\"] == \"艾达·王\" and row[\"occupation\"] == \"Journalist\"");
sheet=(await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"party"),"inv-1.json")));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pyAt(sheet,"backstory"),"concept"),"战地记者");return pyBool(__left)?pyEqual(pyAt(sheet,"sex"),"F"):__left})());return pyBool(__left)?pyEqual(pyAt(sheet,"age"),31):__left})())),"tests/kernel/test_setup.py:186 assert sheet[\"backstory\"][\"concept\"] == \"战地记者\" and sheet[\"sex\"] == \"F\" and sheet[\"age\"] == 31");
assert.ok(pyBool(pyEqual([pyAt(row,"hp"),pyAt(row,"san"),pyAt(row,"mp"),pyAt(row,"luck")],[pyAt(pyAt(sheet,"derived"),"HP"),pyAt(pyAt(sheet,"derived"),"SAN"),pyAt(pyAt(sheet,"derived"),"MP"),pyAt(pyAt(sheet,"characteristics"),"LUCK")])),"tests/kernel/test_setup.py:187 assert (row[\"hp\"], row[\"san\"], row[\"mp\"], row[\"luck\"]) == (\n        sheet[\"derived\"][\"HP\"], sheet[\"derived\"][\"SAN\"], sheet[\"derived\"][\"MP\"], sheet[\"characteristics\"][\"LUCK\"])");
meta=(await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json")));
assert.ok(pyBool(pyEqual(pyAt(meta,"investigators"),["inv-1"])),"tests/kernel/test_setup.py:190 assert meta[\"investigators\"] == [\"inv-1\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(meta,"setup"),"receipts"),0),"id"),"investigator:inv-1")),"tests/kernel/test_setup.py:191 assert meta[\"setup\"][\"receipts\"][0][\"id\"] == \"investigator:inv-1\"");
assert.ok(pyBool(pyAt(result,"next")),"tests/kernel/test_setup.py:192 assert result[\"next\"]");
second=(await pyMethod(kernel,"ok",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"Bob Reed",["occupation"]:"Artist"})],{}));
assert.ok(pyBool(pyEqual(pyAt(second,"receipt"),"investigator:bob-reed")),"tests/kernel/test_setup.py:195 assert second[\"receipt\"] == \"investigator:bob-reed\"");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json"))),"investigators"),["bob-reed","inv-1"])),"tests/kernel/test_setup.py:196 assert read_json(campaign_dir(kernel.workspace) / \"campaign.json\")[\"investigators\"] == [\"bob-reed\", \"inv-1\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"Bob Reed",["occupation"]:"Artist"})],{})),"code"),"invalid_params")),"tests/kernel/test_setup.py:197 assert kernel.err(\"setup.investigator\", {\"campaign\": CAMPAIGN, \"name\": \"Bob Reed\", \"occupation\": \"Artist\"})[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_investigator_writes_a_pregen_shaped_sheet_and_a_receipt"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_investigator_writes_a_pregen_shaped_sheet_and_a_receipt(await kernel(t,{}));});
export async function test_investigator_allocation_policy_is_the_tables_default_or_the_callers_choice(kernel:any){
let table:any,block:any,spread:any,creation:any,filled:any,error:any;

(await create_setting_up(kernel));
table=(await pyMethod(kernel,"ok",["setup.steps",({})],{}));
block=pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(table,"steps"))){if(pyBool(pyEqual(pyAt(s,"id"),"create-investigator"))){__rows.push(s);}}return __rows;})()))),"allocation");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(block,"default"),"spread");return pyBool(__left)?pyEqual(pyAt(block,"tiers"),[50,70]):__left})());return pyBool(__left)?pyContains(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(table,"steps"))){if(pyBool(pyEqual(pyAt(s,"id"),"create-investigator"))){__rows.push(s);}}return __rows;})()))),"params"),"profile"):__left})())),"tests/kernel/test_setup.py:206 assert block[\"default\"] == \"spread\" and block[\"tiers\"] == [50, 70] and \"profile\" in next(\n        s for s in table[\"steps\"] if s[\"id\"] == \"create-investigator\")[\"params\"]");
spread=(await pyMethod(kernel,"ok",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"Ada",["occupation"]:"Military Officer",["seed"]:"7"})],{}));
creation=pyAt(pyAt(spread,"sheet"),"creation");
assert.ok(pyBool(pyEqual(pyAt(creation,"allocation"),({["policy"]:"spread",["tiers"]:pyAt(block,"tiers"),["source"]:"steps.json create-investigator.allocation"}))),"tests/kernel/test_setup.py:210 assert creation[\"allocation\"] == {\"policy\": \"spread\", \"tiers\": block[\"tiers\"], \"source\": \"steps.json create-investigator.allocation\"}");
assert.ok(pyBool((await (async()=>{const __left=pyAt(pyAt(pyAt(creation,"skills"),"occupation"),"reserved");return pyBool(__left)?pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(pyAt(pyAt(creation,"skills"),"occupation"),"resolved"))){__rows.push(pyAt(pyAt(pyAt(spread,"sheet"),"skills"),s));}return __rows;})())),new Set([pyAt(pyAt(block,"tiers"),0)])):__left})())),"tests/kernel/test_setup.py:211 assert creation[\"skills\"][\"occupation\"][\"reserved\"] and {spread[\"sheet\"][\"skills\"][s] for s in creation[\"skills\"][\"occupation\"][\"resolved\"]} == {block[\"tiers\"][0]}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json"))),"setup"),"receipts"),0),"allocation"),"spread")),"tests/kernel/test_setup.py:212 assert read_json(campaign_dir(kernel.workspace) / \"campaign.json\")[\"setup\"][\"receipts\"][0][\"allocation\"] == \"spread\"");
filled=(await pyMethod(kernel,"ok",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"Bob",["occupation"]:"Military Officer",["seed"]:"7",["allocation"]:"fill"})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(filled,"sheet"),"creation"),"allocation"),"policy"),"fill")),"tests/kernel/test_setup.py:215 assert filled[\"sheet\"][\"creation\"][\"allocation\"][\"policy\"] == \"fill\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(pyAt(filled,"sheet"),"creation"),"skills"),"occupation"),"reserved"),[])),"tests/kernel/test_setup.py:216 assert filled[\"sheet\"][\"creation\"][\"skills\"][\"occupation\"][\"reserved\"] == []");
error=(await pyMethod(kernel,"err",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"Cy",["occupation"]:"Military Officer",["allocation"]:"random"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"stage"),"allocation"):__left})())),"tests/kernel/test_setup.py:218 assert error[\"code\"] == \"invalid_params\" and error[\"details\"][\"stage\"] == \"allocation\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(error,"details"),"expected"),"options"),["spread","fill"])),"tests/kernel/test_setup.py:219 assert error[\"details\"][\"expected\"][\"options\"] == [\"spread\", \"fill\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"Cy",["occupation"]:"Military Officer",["allocation"]:3})],{})),"code"),"invalid_params")),"tests/kernel/test_setup.py:220 assert kernel.err(\"setup.investigator\", {\"campaign\": CAMPAIGN, \"name\": \"Cy\", \"occupation\": \"Military Officer\", \"allocation\": 3})[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_investigator_allocation_policy_is_the_tables_default_or_the_callers_choice"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_investigator_allocation_policy_is_the_tables_default_or_the_callers_choice(await kernel(t,{}));});
export async function test_investigator_only_accepts_occupation_ids(kernel:any){
let error:any;
(await create_setting_up(kernel));
error=(await pyMethod(kernel,"err",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"Ada",["occupation"]:"war correspondent"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(error,"details"),"needs"),"field"),"occupation"):__left})())),"tests/kernel/test_setup.py:226 assert error[\"code\"] == \"needs\" and error[\"details\"][\"needs\"][\"field\"] == \"occupation\"");
assert.ok(pyBool(pyContains(pyAt(pyAt(pyAt(error,"details"),"needs"),"options"),"Journalist")),"tests/kernel/test_setup.py:227 assert \"Journalist\" in error[\"details\"][\"needs\"][\"options\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"",["occupation"]:"Journalist"})],{})),"code"),"invalid_params")),"tests/kernel/test_setup.py:228 assert kernel.err(\"setup.investigator\", {\"campaign\": CAMPAIGN, \"name\": \"\", \"occupation\": \"Journalist\"})[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"Ada",["occupation"]:"Journalist",["age"]:12})],{})),"code"),"invalid_params")),"tests/kernel/test_setup.py:229 assert kernel.err(\"setup.investigator\", {\"campaign\": CAMPAIGN, \"name\": \"Ada\", \"occupation\": \"Journalist\", \"age\": 12})[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"Ada",["occupation"]:"Journalist",["method"]:"point_buy"})],{})),"code"),"invalid_params")),"tests/kernel/test_setup.py:230 assert kernel.err(\"setup.investigator\", {\"campaign\": CAMPAIGN, \"name\": \"Ada\", \"occupation\": \"Journalist\", \"method\": \"point_buy\"})[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(!pyBool((await pyList((await pyMethod((pyDivide((await campaign_dir(kernel.workspace)),"party")),"glob",["*.json"],{})))))),"tests/kernel/test_setup.py:231 assert not list((campaign_dir(kernel.workspace) / \"party\").glob(\"*.json\"))");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_investigator_only_accepts_occupation_ids"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_investigator_only_accepts_occupation_ids(await kernel(t,{}));});

export async function test_complete_needs_a_party_then_hands_off(kernel:any){
let error:any,done:any,meta:any,events:any,replay:any;
(await create_setting_up(kernel));
error=(await pyMethod(kernel,"err",["setup.complete",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(error,"details"),"needs"),"step"),"create-investigator"):__left})())),"tests/kernel/test_setup.py:239 assert error[\"code\"] == \"needs\" and error[\"details\"][\"needs\"][\"step\"] == \"create-investigator\"");
(await confirmed_investigator(kernel));
done=(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool(pyEqual(pyAt(done,"receipt"),"setup:handoff")),"tests/kernel/test_setup.py:242 assert done[\"receipt\"] == \"setup:handoff\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(done,"module_id"),MODULE);return pyBool(__left)?pyEqual(pyAt(done,"module_generation"),1):__left})())),"tests/kernel/test_setup.py:243 assert done[\"module_id\"] == MODULE and done[\"module_generation\"] == 1");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(done,"investigators"),["investigator"]);return pyBool(__left)?pyEqual(pyAt(done,"launch"),`bin/pi-coc --campaign ${CAMPAIGN}`):__left})())),"tests/kernel/test_setup.py:244 assert done[\"investigators\"] == [\"investigator\"] and done[\"launch\"] == f\"bin/pi-coc --campaign {CAMPAIGN}\"");
meta=(await read_json(pyDivide((await campaign_dir(kernel.workspace)),"campaign.json")));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(meta,"status"),"ready_for_table");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(meta,"setup"),"handoff"),"receipt"),"setup:handoff"):__left})())),"tests/kernel/test_setup.py:246 assert meta[\"status\"] == \"ready_for_table\" and meta[\"setup\"][\"handoff\"][\"receipt\"] == \"setup:handoff\"");
events=(await read_jsonl(pyDivide((await campaign_dir(kernel.workspace)),"events.jsonl")));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(events)){__rows.push(pyAt(e,"type"));}return __rows;})()),["setup-completed"])),"tests/kernel/test_setup.py:248 assert [e[\"type\"] for e in events] == [\"setup-completed\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(events,0),"receipt"),"setup:handoff");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(events,0),"data"),"investigators"),["investigator"]):__left})())),"tests/kernel/test_setup.py:249 assert events[0][\"receipt\"] == \"setup:handoff\" and events[0][\"data\"][\"investigators\"] == [\"investigator\"]");
assert.ok(pyBool(pyEqual(pyAt((await git_log(kernel.workspace)),0),`campaign ${CAMPAIGN}: setup handoff`)),"tests/kernel/test_setup.py:250 assert git_log(kernel.workspace)[0] == f\"campaign {CAMPAIGN}: setup handoff\"");
replay=(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(replay,"replayed")===true);return pyBool(__left)?pyEqual(pyAt(replay,"receipt"),"setup:handoff"):__left})())),"tests/kernel/test_setup.py:252 assert replay[\"replayed\"] is True and replay[\"receipt\"] == \"setup:handoff\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_complete_needs_a_party_then_hands_off"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_complete_needs_a_party_then_hands_off(await kernel(t,{}));});
export async function test_complete_is_refused_on_an_unknown_campaign(kernel:any){
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.complete",({["campaign"]:"nope"})],{})),"code"),"campaign_not_found")),"tests/kernel/test_setup.py:256 assert kernel.err(\"setup.complete\", {\"campaign\": \"nope\"})[\"code\"] == \"campaign_not_found\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.investigator",({["campaign"]:"nope",["name"]:"A",["occupation"]:"Artist"})],{})),"code"),"campaign_not_found")),"tests/kernel/test_setup.py:257 assert kernel.err(\"setup.investigator\", {\"campaign\": \"nope\", \"name\": \"A\", \"occupation\": \"Artist\"})[\"code\"] == \"campaign_not_found\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_complete_is_refused_on_an_unknown_campaign"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_complete_is_refused_on_an_unknown_campaign(await kernel(t,{}));});
