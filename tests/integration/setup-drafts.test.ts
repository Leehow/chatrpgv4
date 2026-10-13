// Migrated from tests/kernel/test_setup_drafts.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,CONTENT_DIR,RpcClient,campaign_dir,read_json,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter,copy,pyReversed,pyMin,pyMax,math} from "./setup-native-support.ts";






export async function profile(){
return ({["name"]:"Helen",["occupation"]:"Journalist",["age"]:29,["sex"]:"female",["concept"]:"A cautious local reporter seeking rent money.",["own_language"]:"English",["occupation_skills"]:["Art and Craft (Photography)","History","Language (Own)","Library Use","Psychology","Persuade","Spot Hidden","Listen"],["interest_skills"]:["Accounting","Law","First Aid","Drive Auto"],["backstory"]:({["personal_description"]:"A practical coat",["ideology_beliefs"]:"Evidence before rumors",["significant_people"]:"An editor friend",["scenario_bound"]:"Meeting Knott about the house investigation"}),["key_connection"]:({["backstory_field"]:"significant_people",["summary"]:"The editor friend"}),["equipment"]:["Press card","Notebook","Camera","Flashlight"]});
}
export async function begin(kernel:any){
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"en"})],{}));
return (await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:(await profile())})],{}));
}
export async function test_sex_is_required_and_the_issue_says_how_to_draft_it(kernel:any){
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"en"})],{}));
let missing:any=(await profile());
(await pyMethod(missing,"pop",["sex"],{}));
let error:any=(await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:missing})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"needs")),"tests/kernel/test_setup_drafts.py:31 assert error[\"code\"] == \"needs\"");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const issue of pyIterable(pyAt(pyAt(error,"details"),"issues"))){if(pyBool(true))__rows.push((await pyMethod(issue,"startswith",["sex is required"],{})));}return __rows;})())))),"tests/kernel/test_setup_drafts.py:32 assert any(issue.startswith(\"sex is required\") for issue in error[\"details\"][\"issues\"])");
for(const empty of pyIterable(["","   "])){
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({...(await profile()),["sex"]:empty})})],{})),"code"),"needs")),"tests/kernel/test_setup_drafts.py:34 assert kernel.err(\"setup.draft\", {\"campaign\": CAMPAIGN, \"profile\": {**profile(), \"sex\": empty}})[\"code\"] == \"needs\"");
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_sex_is_required_and_the_issue_says_how_to_draft_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_sex_is_required_and_the_issue_says_how_to_draft_it(await kernel(t,{}));});
export async function test_draft_is_complete_without_party_and_confirm_commits_exact_card(kernel:any,tmp_path:any){
let draft:any=(await begin(kernel));
assert.ok(pyBool(pyAt(pyAt(draft,"completeness"),"valid")),"tests/kernel/test_setup_drafts.py:39 assert draft[\"completeness\"][\"valid\"]");
let sheet:any=pyAt(draft,"sheet");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(sheet,"creation"),"skills"),"occupation"),"unspent"),0)),"tests/kernel/test_setup_drafts.py:41 assert sheet[\"creation\"][\"skills\"][\"occupation\"][\"unspent\"] == 0");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(sheet,"creation"),"skills"),"interest"),"unspent"),0)),"tests/kernel/test_setup_drafts.py:42 assert sheet[\"creation\"][\"skills\"][\"interest\"][\"unspent\"] == 0");
assert.ok(pyBool(pyEqual(pyAt(sheet,"equipment"),pyAt((await profile()),"equipment"))),"tests/kernel/test_setup_drafts.py:43 assert sheet[\"equipment\"] == profile()[\"equipment\"]");
assert.ok(pyBool(!pyBool((await pyList((await pyMethod((pyDivide((await campaign_dir(kernel.workspace)),"party")),"glob",["*.json"],{})))))),"tests/kernel/test_setup_drafts.py:44 assert not list((campaign_dir(kernel.workspace) / \"party\").glob(\"*.json\"))");
let committed:any=(await pyMethod(kernel,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["consent"]:"approved"})],{}));
assert.ok(pyBool(pyEqual(pyAt(committed,"sheet"),sheet)),"tests/kernel/test_setup_drafts.py:46 assert committed[\"sheet\"] == sheet");
assert.ok(pyBool(pyAt((await pyMethod(kernel,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["consent"]:"approved"})],{})),"replayed")),"tests/kernel/test_setup_drafts.py:47 assert kernel.ok(\"setup.confirm\", {\"campaign\": CAMPAIGN, \"revision\": draft[\"revision\"], \"consent\": \"approved\"})[\"replayed\"]");
assert.ok(pyBool(pyEqual((await pyLen((await pyList((await pyMethod((pyDivide((await campaign_dir(kernel.workspace)),"party")),"glob",["*.json"],{})))))),1)),"tests/kernel/test_setup_drafts.py:48 assert len(list((campaign_dir(kernel.workspace) / \"party\").glob(\"*.json\"))) == 1");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:CAMPAIGN})],{})),"status"),"ready_for_table")),"tests/kernel/test_setup_drafts.py:49 assert kernel.ok(\"setup.complete\", {\"campaign\": CAMPAIGN})[\"status\"] == \"ready_for_table\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_draft_is_complete_without_party_and_confirm_commits_exact_card"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_draft_is_complete_without_party_and_confirm_commits_exact_card(await kernel(t,{}),temporary);});
export async function test_language_advice_does_not_block_a_player_chosen_low_skill(kernel:any){
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"en"})],{}));
let concept:any=({...(await profile()),["own_language"]:"Chinese",["interest_skills"]:["Language (Other: English)","Accounting","Law","First Aid"]});
let draft:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:concept})],{}));
let limited:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["by"]:"player",["numbers"]:({["skills"]:({["Language (Other: English)"]:1})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(limited,"sheet"),"own_language"),"Chinese")),"tests/kernel/test_setup_drafts.py:59 assert limited[\"sheet\"][\"own_language\"] == \"Chinese\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(limited,"sheet"),"skills"),"Language (Other: English)"),1)),"tests/kernel/test_setup_drafts.py:60 assert limited[\"sheet\"][\"skills\"][\"Language (Other: English)\"] == 1");
let committed:any=(await pyMethod(kernel,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAt(limited,"revision"),["consent"]:"approved"})],{}));
assert.ok(pyBool(pyEqual(pyAt(committed,"sheet"),pyAt(limited,"sheet"))),"tests/kernel/test_setup_drafts.py:63 assert committed[\"sheet\"] == limited[\"sheet\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(committed,"sheet"),"characteristics"),pyAt(pyAt(draft,"sheet"),"characteristics"))),"tests/kernel/test_setup_drafts.py:64 assert committed[\"sheet\"][\"characteristics\"] == draft[\"sheet\"][\"characteristics\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:CAMPAIGN})],{})),"status"),"ready_for_table")),"tests/kernel/test_setup_drafts.py:65 assert kernel.ok(\"setup.complete\", {\"campaign\": CAMPAIGN})[\"status\"] == \"ready_for_table\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_language_advice_does_not_block_a_player_chosen_low_skill"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_language_advice_does_not_block_a_player_chosen_low_skill(await kernel(t,{}));});
export async function test_a_revision_keeps_unrelated_rolls_and_a_stale_revision_cannot_be_confirmed(kernel:any){
let original:any=(await begin(kernel));
let repeated:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:(await profile())})],{}));
assert.ok(pyBool(pyEqual(pyAt(repeated,"revision"),pyAt(original,"revision"))),"tests/kernel/test_setup_drafts.py:71 assert repeated[\"revision\"] == original[\"revision\"]");
let updated:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["age"]:45})})],{}));
assert.ok(pyBool(pyLess(pyAt(original,"revision"),pyAt(updated,"revision"))),"tests/kernel/test_setup_drafts.py:73 assert updated[\"revision\"] > original[\"revision\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(updated,"sheet"),"creation"),"characteristics"),pyAt(pyAt(pyAt(original,"sheet"),"creation"),"characteristics"))),"tests/kernel/test_setup_drafts.py:74 assert updated[\"sheet\"][\"creation\"][\"characteristics\"] == original[\"sheet\"][\"creation\"][\"characteristics\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(updated,"sheet"),"creation"),"luck"),pyAt(pyAt(pyAt(original,"sheet"),"creation"),"luck"))),"tests/kernel/test_setup_drafts.py:75 assert updated[\"sheet\"][\"creation\"][\"luck\"] == original[\"sheet\"][\"creation\"][\"luck\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"call",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAt(original,"revision"),["consent"]:"approved"})],{})),"error"),"code_detail"),"stale_draft")),"tests/kernel/test_setup_drafts.py:76 assert kernel.call(\"setup.confirm\", {\"campaign\": CAMPAIGN, \"revision\": original[\"revision\"], \"consent\": \"approved\"})[\"error\"][\"code_detail\"] == \"stale_draft\"");
assert.ok(pyBool(pyAt((await pyMethod(kernel,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAt(updated,"revision"),["consent"]:"approved"})],{})),"committed")),"tests/kernel/test_setup_drafts.py:77 assert kernel.ok(\"setup.confirm\", {\"campaign\": CAMPAIGN, \"revision\": updated[\"revision\"], \"consent\": \"approved\"})[\"committed\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_revision_keeps_unrelated_rolls_and_a_stale_revision_cannot_be_confirmed"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_revision_keeps_unrelated_rolls_and_a_stale_revision_cannot_be_confirmed(await kernel(t,{}));});
export async function test_bad_semantic_choices_do_not_replace_a_valid_draft(kernel:any){
let original:any=(await begin(kernel));
let bad:any=(await pyMethod(kernel,"call",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["occupation"]:"Mechanic"})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(bad,"error"),"code"),"needs")),"tests/kernel/test_setup_drafts.py:83 assert bad[\"error\"][\"code\"] == \"needs\"");
let restored:any=pyAt(pyAt((await pyMethod(kernel,"ok",["setup.steps",({["campaign"]:CAMPAIGN})],{})),"state"),"draft");
assert.ok(pyBool(pyEqual(pyAt(restored,"sheet"),pyAt(original,"sheet"))),"tests/kernel/test_setup_drafts.py:85 assert restored[\"sheet\"] == original[\"sheet\"]");
assert.ok(pyBool(pyEqual(pyAt(restored,"revision"),pyAt(original,"revision"))),"tests/kernel/test_setup_drafts.py:86 assert restored[\"revision\"] == original[\"revision\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_bad_semantic_choices_do_not_replace_a_valid_draft"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_bad_semantic_choices_do_not_replace_a_valid_draft(await kernel(t,{}));});
export async function test_incomplete_legacy_card_cannot_finish_and_story_questions_are_open(kernel:any){
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting"})],{}));
(await pyMethod(kernel,"ok",["setup.investigator",({["campaign"]:CAMPAIGN,["name"]:"Incomplete",["occupation"]:"Journalist"})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"call",["setup.complete",({["campaign"]:CAMPAIGN})],{})),"error"),"code_detail"),"incomplete_investigator")),"tests/kernel/test_setup_drafts.py:92 assert kernel.call(\"setup.complete\", {\"campaign\": CAMPAIGN})[\"error\"][\"code_detail\"] == \"incomplete_investigator\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_incomplete_legacy_card_cannot_finish_and_story_questions_are_open"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_incomplete_legacy_card_cannot_finish_and_story_questions_are_open(await kernel(t,{}));});
export async function test_prologue_is_source_bound_and_survives_handoff(kernel:any){
let draft:any=(await begin(kernel));
(await pyMethod(kernel,"ok",["setup.prologue",({["campaign"]:CAMPAIGN,["scene"]:"Knott's Office",["guide"]:"Steven Knott",["text"]:"Knott asks who the visitor is.",["handoff"]:"Continue after introductions; the commission is not yet accepted."})],{}));
(await pyMethod(kernel,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["consent"]:"delegated",["last_exchange"]:"My name is Helen."})],{}));
(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:CAMPAIGN})],{}));
let opened:any=(await pyMethod(kernel,"ok",["table.open",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(opened,"setup_prologue"),"introduction"),"name"),"Helen")),"tests/kernel/test_setup_drafts.py:102 assert opened[\"setup_prologue\"][\"introduction\"][\"name\"] == \"Helen\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(opened,"setup_prologue"),"last_exchange"),"My name is Helen.")),"tests/kernel/test_setup_drafts.py:103 assert opened[\"setup_prologue\"][\"last_exchange\"] == \"My name is Helen.\"");
let result:any=(await pyMethod(kernel,"ok",["table.narrate",({["campaign"]:CAMPAIGN,["call_id"]:"t0-c1",["text"]:"Knott waits. What do you say?"})],{}));
assert.ok(pyBool(!pyBool((await pyMethod(result,"get",["pending_choice"],{})))),"tests/kernel/test_setup_drafts.py:105 assert not result.get(\"pending_choice\")");
assert.ok(pyBool(pyContains(pyAt(result,"rendered_text"),"What do you say?")),"tests/kernel/test_setup_drafts.py:106 assert \"What do you say?\" in result[\"rendered_text\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_prologue_is_source_bound_and_survives_handoff"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_prologue_is_source_bound_and_survives_handoff(await kernel(t,{}));});
export async function test_same_input_cannot_approve_its_own_draft(kernel:any){
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"en"})],{}));
let draft:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:(await profile()),["input_key"]:"description"})],{}));
let error:any=(await pyMethod(kernel,"err",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["consent"]:"approved",["input_key"]:"description"})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code_detail"),"confirmation_required")),"tests/kernel/test_setup_drafts.py:113 assert error[\"code_detail\"] == \"confirmation_required\"");
assert.ok(pyBool(pyAt((await pyMethod(kernel,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["consent"]:"approved",["input_key"]:"approval"})],{})),"committed")),"tests/kernel/test_setup_drafts.py:114 assert kernel.ok(\"setup.confirm\", {\"campaign\": CAMPAIGN, \"revision\": draft[\"revision\"], \"consent\": \"approved\", \"input_key\": \"approval\"})[\"committed\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_same_input_cannot_approve_its_own_draft"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_same_input_cannot_approve_its_own_draft(await kernel(t,{}));});
export async function test_parallel_confirmation_writes_one_card(kernel:any){


let draft:any=(await begin(kernel));
let other:any=(new RpcClient(kernel.workspace));
try{let params:any=({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["consent"]:"delegated"});
const results=await Promise.all([kernel.ok('setup.confirm',params),other.ok('setup.confirm',params)]);
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const result of pyIterable(results)){if(pyBool(true))__rows.push(pyAt(result,"committed"));}return __rows;})())))),"tests/kernel/test_setup_drafts.py:127 assert all(result[\"committed\"] for result in results)");
assert.ok(pyBool(pyEqual((await pySum((await (async()=>{const __rows:any[]=[];for(const result of pyIterable(results)){if(pyBool(true))__rows.push((await pyBool((await pyMethod(result,"get",["replayed"],{})))));}return __rows;})()))),1)),"tests/kernel/test_setup_drafts.py:128 assert sum(bool(result.get(\"replayed\")) for result in results) == 1");
assert.ok(pyBool(pyEqual((await pyLen((await pyList((await pyMethod((pyDivide((await campaign_dir(kernel.workspace)),"party")),"glob",["*.json"],{})))))),1)),"tests/kernel/test_setup_drafts.py:129 assert len(list((campaign_dir(kernel.workspace) / \"party\").glob(\"*.json\"))) == 1");}finally{(await pyMethod(other,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_parallel_confirmation_writes_one_card"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_parallel_confirmation_writes_one_card(await kernel(t,{}));});
export async function test_malformed_profile_returns_findings_and_keeps_draft(kernel:any){
let original:any=(await begin(kernel));
for(const patch of pyIterable([({["backstory"]:["wrong"]}),({["occupation_skills"]:[({})]}),({["key_connection"]:["wrong"]})])){
let error:any=(await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:patch})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"needs")),"tests/kernel/test_setup_drafts.py:138 assert error[\"code\"] == \"needs\"");
}
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"ok",["setup.steps",({["campaign"]:CAMPAIGN})],{})),"state"),"draft"),"revision"),pyAt(original,"revision"))),"tests/kernel/test_setup_drafts.py:139 assert kernel.ok(\"setup.steps\", {\"campaign\": CAMPAIGN})[\"state\"][\"draft\"][\"revision\"] == original[\"revision\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_malformed_profile_returns_findings_and_keeps_draft"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_malformed_profile_returns_findings_and_keeps_draft(await kernel(t,{}));});
export async function test_confirmed_draft_cannot_be_replaced_before_handoff(kernel:any){
let original:any=(await begin(kernel));
(await pyMethod(kernel,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAt(original,"revision"),["consent"]:"delegated"})],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["age"]:45})})],{})),"code"),"campaign_not_ready")),"tests/kernel/test_setup_drafts.py:145 assert kernel.err(\"setup.draft\", {\"campaign\": CAMPAIGN, \"profile\": {\"age\": 45}})[\"code\"] == \"campaign_not_ready\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:CAMPAIGN})],{})),"status"),"ready_for_table")),"tests/kernel/test_setup_drafts.py:146 assert kernel.ok(\"setup.complete\", {\"campaign\": CAMPAIGN})[\"status\"] == \"ready_for_table\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_confirmed_draft_cannot_be_replaced_before_handoff"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_confirmed_draft_cannot_be_replaced_before_handoff(await kernel(t,{}));});
export async function test_pending_action_must_come_from_actual_player_input(kernel:any){
let draft:any=(await begin(kernel));
let params:any=({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["consent"]:"delegated",["pending_action"]:"I will inspect the door",["player_requests"]:["Create the card. I will inspect the door next."]});
let bad:any=({...params,["pending_action"]:"I take the keys"});
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.confirm",bad],{})),"code"),"invalid_params")),"tests/kernel/test_setup_drafts.py:153 assert kernel.err(\"setup.confirm\", bad)[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyAt((await pyMethod(kernel,"ok",["setup.confirm",params],{})),"committed")),"tests/kernel/test_setup_drafts.py:154 assert kernel.ok(\"setup.confirm\", params)[\"committed\"]");
let handoff:any=(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(handoff,"prologue"),"pending_action"),"I will inspect the door")),"tests/kernel/test_setup_drafts.py:156 assert handoff[\"prologue\"][\"pending_action\"] == \"I will inspect the door\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_pending_action_must_come_from_actual_player_input"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_pending_action_must_come_from_actual_player_input(await kernel(t,{}));});
export async function test_scenario_bound_is_a_sentence_and_the_issue_says_so(kernel:any){

(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"en"})],{}));
let flagged:any=(await profile());
pyAt(flagged,"backstory")["scenario_bound"]=true;
let issues:any=pyAt(pyAt((await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:flagged})],{})),"details"),"issues");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const issue of pyIterable(issues)){if(pyBool(true))__rows.push((await pyMethod(issue,"startswith",["scenario_bound is prose, not true or false"],{})));}return __rows;})())))),pyStr(issues));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const issue of pyIterable(issues)){if(pyBool(true))__rows.push(pyContains(issue,"backstory categories"));}return __rows;})()))))),pyStr("three categories are there"));
let missing:any=(await profile());
(await pyMethod(pyAt(missing,"backstory"),"pop",["scenario_bound"],{}));
issues=pyAt(pyAt((await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:missing})],{})),"details"),"issues");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const issue of pyIterable(issues)){if(pyBool(true))__rows.push((await pyMethod(issue,"startswith",["supply scenario_bound: a sentence"],{})));}return __rows;})())))),pyStr(issues));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_scenario_bound_is_a_sentence_and_the_issue_says_so"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_scenario_bound_is_a_sentence_and_the_issue_says_so(await kernel(t,{}));});
export async function test_a_key_connection_naming_scenario_bound_is_told_which_categories_it_may_name(kernel:any){

(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"en"})],{}));
let filled:any="personal_description, ideology_beliefs, significant_people";
let bound:any=(await profile());
bound["key_connection"]=({["backstory_field"]:"scenario_bound",["summary"]:"Sent to look into the house"});
let issues:any=pyAt(pyAt((await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:bound})],{})),"details"),"issues");
let issue:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const issue of pyIterable(issues)){if(pyBool((await pyMethod(issue,"startswith",["key_connection.backstory_field \"scenario_bound\""],{}))))__rows.push(issue);}return __rows;})()),null));
assert.ok(pyBool((issue!==null)),pyStr(issues));
assert.ok(pyBool((await (async()=>{const __left=pyContains(issue,filled);return pyBool(__left)?pyContains(issue,"Keep scenario_bound as it is"):__left})())),pyStr(issue));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const other of pyIterable(issues)){if(pyBool(!pyEqual(other,issue)))__rows.push(pyContains(other,"scenario_bound"));}return __rows;})()))))),pyStr("scenario_bound itself is fine"));
let empty:any=(await profile());
empty["key_connection"]=({["backstory_field"]:"traits",["summary"]:"His caution"});
issues=pyAt(pyAt((await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:empty})],{})),"details"),"issues");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const issue of pyIterable(issues)){if(pyBool(true))__rows.push((await (async()=>{const __left=(await pyMethod(issue,"startswith",["key_connection.backstory_field \"traits\" is empty in the backstory"],{}));return pyBool(__left)?pyContains(issue,filled):__left})()));}return __rows;})())))),pyStr(issues));
pyAt(bound,"key_connection")["backstory_field"]="significant_people";
assert.ok(pyBool(pyAt(pyAt((await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:bound})],{})),"completeness"),"valid")),"tests/kernel/test_setup_drafts.py:191 assert kernel.ok(\"setup.draft\", {\"campaign\": CAMPAIGN, \"profile\": bound})[\"completeness\"][\"valid\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_key_connection_naming_scenario_bound_is_told_which_categories_it_may_name"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_key_connection_naming_scenario_bound_is_told_which_categories_it_may_name(await kernel(t,{}));});
export async function test_new_draft_requires_appearance_and_preserves_it_across_skill_changes(kernel:any){
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"en"})],{}));
let missing:any=(await profile());
(await pyMethod(pyAt(missing,"backstory"),"pop",["personal_description"],{}));
pyAt(missing,"backstory")["traits"]="Patient and practical";
let error:any=(await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:missing})],{}));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const issue of pyIterable(pyAt(pyAt(error,"details"),"issues"))){if(pyBool(true))__rows.push(pyContains(issue,"personal_description is required"));}return __rows;})())))),"tests/kernel/test_setup_drafts.py:200 assert any(\"personal_description is required\" in issue for issue in error[\"details\"][\"issues\"])");
let original:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:(await profile())})],{}));
let appearance:any=pyAt(pyAt(pyAt(original,"sheet"),"backstory"),"personal_description");
let kept:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["backstory"]:({["traits"]:"Patient and practical"})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(kept,"sheet"),"backstory"),"personal_description"),appearance);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(kept,"sheet"),"backstory"),"traits"),"Patient and practical"):__left})())),"tests/kernel/test_setup_drafts.py:205 assert kept[\"sheet\"][\"backstory\"][\"personal_description\"] == appearance and kept[\"sheet\"][\"backstory\"][\"traits\"] == \"Patient and practical\"");
let changed:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["interest_skills"]:[...pyAt((await profile()),"interest_skills"),"Natural World"]})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(changed,"sheet"),"backstory"),"personal_description"),appearance)),"tests/kernel/test_setup_drafts.py:207 assert changed[\"sheet\"][\"backstory\"][\"personal_description\"] == appearance");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(changed,"sheet"),"creation"),"characteristics"),pyAt(pyAt(pyAt(original,"sheet"),"creation"),"characteristics"))),"tests/kernel/test_setup_drafts.py:208 assert changed[\"sheet\"][\"creation\"][\"characteristics\"] == original[\"sheet\"][\"creation\"][\"characteristics\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_new_draft_requires_appearance_and_preserves_it_across_skill_changes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_new_draft_requires_appearance_and_preserves_it_across_skill_changes(await kernel(t,{}));});
export async function test_a_stated_aptitude_places_the_quick_fire_array(kernel:any){

let plain:any=(await begin(kernel));
let stated:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["aptitude"]:({["strong"]:["STR"],["weak"]:["INT"],["origin"]:"player"})})})],{}));
let generated:any=pyAt(pyAt(pyAt(stated,"sheet"),"creation"),"characteristics");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(generated,"method"),"quick_fire");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(stated,"sheet"),"creation"),"method"),"quick_fire"):__left})())),"tests/kernel/test_setup_drafts.py:218 assert generated[\"method\"] == \"quick_fire\" and stated[\"sheet\"][\"creation\"][\"method\"] == \"quick_fire\"");
assert.ok(pyBool(pyEqual(pyAt(generated,"aptitude"),({["strong"]:["STR"],["weak"]:["INT"],["origin"]:"player"}))),"tests/kernel/test_setup_drafts.py:219 assert generated[\"aptitude\"] == {\"strong\": [\"STR\"], \"weak\": [\"INT\"], \"origin\": \"player\"}");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(generated,"values"),"STR"),80);return pyBool(__left)?pyEqual(pyAt(pyAt(generated,"values"),"INT"),40):__left})())),"tests/kernel/test_setup_drafts.py:220 assert generated[\"values\"][\"STR\"] == 80 and generated[\"values\"][\"INT\"] == 40");
assert.ok(pyBool(pyEqual((await pySorted((await pyMethod(pyAt(generated,"values"),"values",[],{})))),(await pySorted(pyAt(generated,"array"))))),pyStr("the array, whole, nothing invented"));
assert.ok(pyBool((await (async()=>{const __left=pyLess(pyAt(pyAt(pyAt(plain,"sheet"),"characteristics"),"INT"),pyAt(pyAt(pyAt(stated,"sheet"),"characteristics"),"STR"));return pyBool(__left)?__left:true})())),"tests/kernel/test_setup_drafts.py:222 assert stated[\"sheet\"][\"characteristics\"][\"STR\"] > plain[\"sheet\"][\"characteristics\"][\"INT\"] or True");
assert.ok(pyBool(pyAt(pyAt(stated,"completeness"),"valid")),"tests/kernel/test_setup_drafts.py:223 assert stated[\"completeness\"][\"valid\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_stated_aptitude_places_the_quick_fire_array"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_stated_aptitude_places_the_quick_fire_array(await kernel(t,{}));});
export async function test_clearing_an_aptitude_returns_to_this_players_own_dice(kernel:any){
let plain:any=(await begin(kernel));
let stated:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["aptitude"]:({["strong"]:["DEX"],["origin"]:"concept"})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(stated,"sheet"),"creation"),"characteristics"),"method"),"quick_fire")),"tests/kernel/test_setup_drafts.py:229 assert stated[\"sheet\"][\"creation\"][\"characteristics\"][\"method\"] == \"quick_fire\"");
let cleared:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["aptitude"]:null})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(cleared,"sheet"),"creation"),"characteristics"),pyAt(pyAt(pyAt(plain,"sheet"),"creation"),"characteristics"))),"tests/kernel/test_setup_drafts.py:231 assert cleared[\"sheet\"][\"creation\"][\"characteristics\"] == plain[\"sheet\"][\"creation\"][\"characteristics\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(cleared,"sheet"),"creation"),"luck"),pyAt(pyAt(pyAt(plain,"sheet"),"creation"),"luck"))),"tests/kernel/test_setup_drafts.py:232 assert cleared[\"sheet\"][\"creation\"][\"luck\"] == plain[\"sheet\"][\"creation\"][\"luck\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_clearing_an_aptitude_returns_to_this_players_own_dice"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_clearing_an_aptitude_returns_to_this_players_own_dice(await kernel(t,{}));});
export async function test_an_illegal_aptitude_is_refused_and_keeps_the_valid_draft(kernel:any){
let original:any=(await begin(kernel));
for(const patch of pyIterable([({["strong"]:["Strength"],["origin"]:"player"}),({["strong"]:["STR"],["weak"]:["STR"],["origin"]:"player"}),({["strong"]:"STR",["origin"]:"player"}),({["muscle"]:["STR"]}),({["strong"]:["STR"]}),({["strong"]:["STR","CON"],["origin"]:"concept"})])){
let error:any=(await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["aptitude"]:patch})})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"needs")),pyStr(patch));
}
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"ok",["setup.steps",({["campaign"]:CAMPAIGN})],{})),"state"),"draft"),"revision"),pyAt(original,"revision"))),"tests/kernel/test_setup_drafts.py:242 assert kernel.ok(\"setup.steps\", {\"campaign\": CAMPAIGN})[\"state\"][\"draft\"][\"revision\"] == original[\"revision\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_illegal_aptitude_is_refused_and_keeps_the_valid_draft"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_illegal_aptitude_is_refused_and_keeps_the_valid_draft(await kernel(t,{}));});
export async function test_the_interest_list_is_spent_in_the_order_the_player_cares_about(kernel:any){

(await begin(kernel));
let long_list:any=["Fighting (Brawl)","Throw","First Aid","Climb","Library Use","Navigate","Swim","Jump"];
let front:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["interest_skills"]:long_list})})],{}));
let interest:any=pyAt(pyAt(pyAt(pyAt(front,"sheet"),"creation"),"skills"),"interest");
assert.ok(pyBool(pyEqual(pyAt(interest,"allocation"),"spread")),"tests/kernel/test_setup_drafts.py:252 assert interest[\"allocation\"] == \"spread\"");
assert.ok(pyBool(pyEqual(pyAt(interest,"source"),"steps.json create-investigator.interest_allocation")),"tests/kernel/test_setup_drafts.py:253 assert interest[\"source\"] == \"steps.json create-investigator.interest_allocation\"");
assert.ok(pyBool(pyLess(pyAt(pyAt(pyAt(front,"sheet"),"skills"),"Jump"),pyAt(pyAt(pyAt(front,"sheet"),"skills"),"Fighting (Brawl)"))),"tests/kernel/test_setup_drafts.py:254 assert front[\"sheet\"][\"skills\"][\"Fighting (Brawl)\"] > front[\"sheet\"][\"skills\"][\"Jump\"]");
let back:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["interest_skills"]:(await pyList((await pyReversed(long_list))))})})],{}));
assert.ok(pyBool(pyLess(pyAt(pyAt(pyAt(back,"sheet"),"skills"),"Fighting (Brawl)"),pyAt(pyAt(pyAt(back,"sheet"),"skills"),"Jump"))),"tests/kernel/test_setup_drafts.py:256 assert back[\"sheet\"][\"skills\"][\"Jump\"] > back[\"sheet\"][\"skills\"][\"Fighting (Brawl)\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(pyAt(back,"sheet"),"creation"),"skills"),"interest"),"spent"),pyAt(interest,"spent"))),pyStr("reordering never changes the budget"));
assert.ok(pyBool(pyEqual(pyAt(pyAt(back,"sheet"),"characteristics"),pyAt(pyAt(front,"sheet"),"characteristics"))),pyStr("and never rerolls"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_interest_list_is_spent_in_the_order_the_player_cares_about"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_interest_list_is_spent_in_the_order_the_player_cares_about(await kernel(t,{}));});
export async function test_a_reading_off_the_concept_is_recorded_as_a_reading(kernel:any){

(await begin(kernel));
let read:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["aptitude"]:({["strong"]:["EDU"],["origin"]:"concept"})})})],{}));
let generated:any=pyAt(pyAt(pyAt(read,"sheet"),"creation"),"characteristics");
assert.ok(pyBool(pyEqual(pyAt(pyAt(generated,"aptitude"),"origin"),"concept")),"tests/kernel/test_setup_drafts.py:268 assert generated[\"aptitude\"][\"origin\"] == \"concept\"");
assert.ok(pyBool(pyEqual(pyAt(generated,"method"),"quick_fire")),"tests/kernel/test_setup_drafts.py:269 assert generated[\"method\"] == \"quick_fire\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(generated,"values"),"EDU"),80)),"tests/kernel/test_setup_drafts.py:270 assert generated[\"values\"][\"EDU\"] == 80");
let said:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["aptitude"]:({["strong"]:["EDU"],["origin"]:"player"})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(said,"sheet"),"characteristics"),pyAt(pyAt(read,"sheet"),"characteristics"))),pyStr("only the licence differs"));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(pyAt(said,"sheet"),"creation"),"characteristics"),"aptitude"),"origin"),"player")),"tests/kernel/test_setup_drafts.py:274 assert said[\"sheet\"][\"creation\"][\"characteristics\"][\"aptitude\"][\"origin\"] == \"player\"");
let over:any=(await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["aptitude"]:({["strong"]:["EDU","INT"],["origin"]:"concept"})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(over,"code"),"needs")),"tests/kernel/test_setup_drafts.py:277 assert over[\"code\"] == \"needs\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"ok",["setup.steps",({["campaign"]:CAMPAIGN})],{})),"state"),"draft"),"revision"),pyAt(said,"revision"))),"tests/kernel/test_setup_drafts.py:278 assert kernel.ok(\"setup.steps\", {\"campaign\": CAMPAIGN})[\"state\"][\"draft\"][\"revision\"] == said[\"revision\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_reading_off_the_concept_is_recorded_as_a_reading"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_reading_off_the_concept_is_recorded_as_a_reading(await kernel(t,{}));});

export async function test_a_setting_up_campaign_gets_the_setup_shape_from_mods_context(kernel:any){
(await begin(kernel));
let context:any=(await pyMethod(kernel,"ok",["mods.context",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool(pyContains((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(context,"active"))){if(pyBool(true))__rows.push(pyAt(row,"id"));}return __rows;})()),"guided-creation")),pyStr("the built-in is on by default"));
assert.ok(pyBool(pyLessEqual(new Set(["setup.guidance.v1","setup.aptitude.v1"]),(await pySet(pyAt(context,"capabilities"))))),"tests/kernel/test_setup_drafts.py:287 assert {\"setup.guidance.v1\", \"setup.aptitude.v1\"} <= set(context[\"capabilities\"])");
let guide:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(context,"setup"))){if(pyBool(pyEqual(pyAt(row,"mod"),"guided-creation")))__rows.push(row);}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(guide,"settings"),({["max_guided_turns"]:3}))),"tests/kernel/test_setup_drafts.py:289 assert guide[\"settings\"] == {\"max_guided_turns\": 3}");
assert.ok(pyBool(pyContains(pyAt(guide,"instruction"),"Guided Creation")),"tests/kernel/test_setup_drafts.py:290 assert \"Guided Creation\" in guide[\"instruction\"]");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(context,"instructions");return pyBool(__left)?!pyContains(context,"pending_contacts"):__left})())),pyStr("no capsule shape before the world is open"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_setting_up_campaign_gets_the_setup_shape_from_mods_context"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_setting_up_campaign_gets_the_setup_shape_from_mods_context(await kernel(t,{}));});
export async function test_prose_moves_a_characteristic_with_or_without_the_package(kernel:any){

(await begin(kernel));
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:"guided-creation",["enabled"]:false})],{}));
let context:any=(await pyMethod(kernel,"ok",["mods.context",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool(!pyContains((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(context,"active"))){if(pyBool(true))__rows.push(pyAt(row,"id"));}return __rows;})()),"guided-creation")),"tests/kernel/test_setup_drafts.py:299 assert \"guided-creation\" not in [row[\"id\"] for row in context[\"active\"]]");
let stated:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["aptitude"]:({["strong"]:["STR"],["origin"]:"player"})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(pyAt(stated,"sheet"),"creation"),"characteristics"),"values"),"STR"),80)),"tests/kernel/test_setup_drafts.py:301 assert stated[\"sheet\"][\"creation\"][\"characteristics\"][\"values\"][\"STR\"] == 80");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_prose_moves_a_characteristic_with_or_without_the_package"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_prose_moves_a_characteristic_with_or_without_the_package(await kernel(t,{}));});
export async function test_the_players_own_trade_stays_on_the_card_beside_the_entry(kernel:any){

(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"zh-Hans"})],{}));
let nurse:any=({...(await profile()),["occupation"]:"Doctor of Medicine",["occupation_stated"]:"教会医院的夜班护士",["occupation_skills"]:["First Aid","Language (Other: Latin)","Medicine","Psychology","Science (Biology)","Science (Pharmacy)","Spot Hidden","Listen"]});
let draft:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:nurse})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(draft,"sheet"),"occupation"),"Doctor of Medicine")),"tests/kernel/test_setup_drafts.py:311 assert draft[\"sheet\"][\"occupation\"] == \"Doctor of Medicine\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(draft,"sheet"),"occupation_stated"),"教会医院的夜班护士")),"tests/kernel/test_setup_drafts.py:312 assert draft[\"sheet\"][\"occupation_stated\"] == \"教会医院的夜班护士\"");
(await pyMethod(kernel,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["consent"]:"delegated"})],{}));
let card:any=(await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"party"),"investigator.json")));
assert.ok(pyBool(pyEqual(pyAt(card,"occupation_stated"),"教会医院的夜班护士")),pyStr("the written card keeps the player's words"));
(await pyMethod(kernel,"ok",["setup.complete",({["campaign"]:CAMPAIGN})],{}));
let opened:any=(await pyMethod(kernel,"ok",["table.open",({["campaign"]:CAMPAIGN})],{}));
let party:any=(await pyMethod(json,"dumps",[opened],{"ensure_ascii":false}));
assert.ok(pyBool(pyContains(party,"教会医院的夜班护士")),pyStr("the table reads the player's words, not only the entry"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_players_own_trade_stays_on_the_card_beside_the_entry"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_players_own_trade_stays_on_the_card_beside_the_entry(await kernel(t,{}));});
export async function test_a_stated_trade_must_be_words_or_absent(kernel:any){
let draft:any=(await begin(kernel));
assert.ok(pyBool((pyAt(pyAt(draft,"sheet"),"occupation_stated")===null)),"tests/kernel/test_setup_drafts.py:324 assert draft[\"sheet\"][\"occupation_stated\"] is None");
for(const bad of pyIterable(["","   ",7,["nurse"]])){
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["occupation_stated"]:bad})})],{})),"code"),"needs")),"tests/kernel/test_setup_drafts.py:326 assert kernel.err(\"setup.draft\", {\"campaign\": CAMPAIGN, \"profile\": {\"occupation_stated\": bad}})[\"code\"] == \"needs\"");
}
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"ok",["setup.steps",({["campaign"]:CAMPAIGN})],{})),"state"),"draft"),"revision"),pyAt(draft,"revision"))),"tests/kernel/test_setup_drafts.py:327 assert kernel.ok(\"setup.steps\", {\"campaign\": CAMPAIGN})[\"state\"][\"draft\"][\"revision\"] == draft[\"revision\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_stated_trade_must_be_words_or_absent"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_stated_trade_must_be_words_or_absent(await kernel(t,{}));});
export async function test_a_starting_weapon_is_named_the_way_play_names_it(kernel:any){

(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"zh-Hans"})],{}));
let printable:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({...(await profile()),["era"]:"1920s",["weapons"]:[".38 Automatic"]})})],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const weapon of pyIterable(pyAt(pyAt(printable,"sheet"),"weapons"))){if(pyBool(true))__rows.push(pyAt(weapon,"name"));}return __rows;})()),[".38 Automatic"])),"tests/kernel/test_setup_drafts.py:336 assert [weapon[\"name\"] for weapon in printable[\"sheet\"][\"weapons\"]] == [\".38 Automatic\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(printable,"sheet"),"weapons"),0),"damage_die"),"1D10")),"tests/kernel/test_setup_drafts.py:337 assert printable[\"sheet\"][\"weapons\"][0][\"damage_die\"] == \"1D10\"");
let by_id:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({["weapons"]:["revolver_38"]})})],{}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const weapon of pyIterable(pyAt(pyAt(by_id,"sheet"),"weapons"))){if(pyBool(true))__rows.push(pyAt(weapon,"name"));}return __rows;})()),[".38 Automatic"])),pyStr("the id is a way in, never the name on the card"));
assert.ok(pyBool(!pyContains(pyAt(pyAt(by_id,"sheet"),"equipment"),"revolver_38")),"tests/kernel/test_setup_drafts.py:340 assert \"revolver_38\" not in by_id[\"sheet\"][\"equipment\"]");
assert.ok(pyBool(pyContains(pyAt(pyAt(by_id,"sheet"),"equipment"),".38 Automatic")),"tests/kernel/test_setup_drafts.py:341 assert \".38 Automatic\" in by_id[\"sheet\"][\"equipment\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_starting_weapon_is_named_the_way_play_names_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_starting_weapon_is_named_the_way_play_names_it(await kernel(t,{}));});
export async function authored_era_content(tmp_path:any,era:any){

let content:any=pyDivide(tmp_path,"content");
(await pyMethod(shutil,"copytree",[CONTENT_DIR,content],{}));
let path:any=pyDivide(pyDivide(pyDivide(content,"starters"),"the-haunting"),"module-graph.json");
let graph:any=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))],{}));
let node:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(graph,"nodes"))){if(pyBool(pyEqual(pyAt(node,"node_kind"),"module")))__rows.push(node);}return __rows;})())));
let document:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const entry of pyIterable(pyAt(pyAt(pyAt(node,"properties"),"runtime_projection"),"documents"))){if(pyBool(pyEqual(pyAt(entry,"filename"),"module-meta.json")))__rows.push(entry);}return __rows;})())));
pyAt(document,"root")["era"]=era;
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[graph],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
return content;
}

export let AUTHORED_ERA:any="1895 (default); investigators then enter 1287";
export async function test_an_era_the_rulebook_never_tabulated_builds_the_card_and_says_what_stood_in(tmp_path:any){

let client:any=(new RpcClient(pyDivide(tmp_path,"workspace"),({"content":(await authored_era_content(tmp_path,AUTHORED_ERA))})));
try{(await pyMethod(client,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"en"})],{}));
let default_period:any=pyAt((await pyMethod(json,"loads",[(await pyMethod((pyDivide(CONTENT_DIR,"rulesets/coc7/rules-json/cash-assets.json")),"read_text",[],{"encoding":"utf-8"}))],{})),"default_period");
let draft:any=(await pyMethod(client,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:(await profile())})],{}));
assert.ok(pyBool(pyAt(pyAt(draft,"completeness"),"valid")),pyStr("an untabulated setting must not cost the table its investigator"));
let sheet:any=pyAt(draft,"sheet");
assert.ok(pyBool(pyEqual(pyAt(sheet,"era"),default_period)),pyStr("the card is built against a period the rulebook actually prints"));
assert.ok(pyBool(pyEqual(pyAt(sheet,"setting_era"),AUTHORED_ERA)),pyStr("the authored setting is kept, never rewritten into a table key"));
let finance:any=pyAt(sheet,"finance");
assert.ok(pyBool((await (async()=>{const __left=(finance!==null);return pyBool(__left)?pyEqual(pyAt(finance,"period"),default_period):__left})())),"tests/kernel/test_setup_drafts.py:379 assert finance is not None and finance[\"period\"] == default_period");
assert.ok(pyBool(pyEqual(pyAt(finance,"source"),`cash-assets.periods.${default_period}`)),pyStr("the numbers name the row they came from"));
assert.ok(pyBool(pyEqual(pyAt(finance,"substituted_for"),AUTHORED_ERA)),pyStr("a stand-in period is on the card, not inferred from a missing match"));
let trace:any=pyAt(pyAt(sheet,"creation"),"finance");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(trace,"available")===true);return pyBool(__left)?pyEqual(pyAt(trace,"source"),`cash-assets.periods.${default_period}`):__left})())),"tests/kernel/test_setup_drafts.py:383 assert trace[\"available\"] is True and trace[\"source\"] == f\"cash-assets.periods.{default_period}\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(trace,"substituted_for"),AUTHORED_ERA);return pyBool(__left)?pyContains(pyAt(trace,"note"),default_period):__left})())),"tests/kernel/test_setup_drafts.py:384 assert trace[\"substituted_for\"] == AUTHORED_ERA and default_period in trace[\"note\"]");
assert.ok(pyBool(pyEqual(pyAt(sheet,"cash"),`${pyAt(pyAt(finance,"cash"),"amount")} ${pyAt(pyAt(finance,"cash"),"currency")}`)),"tests/kernel/test_setup_drafts.py:385 assert sheet[\"cash\"] == f\"{finance['cash']['amount']} {finance['cash']['currency']}\"");
(await pyMethod(client,"ok",["setup.confirm",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["consent"]:"approved"})],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(client,"ok",["setup.complete",({["campaign"]:CAMPAIGN})],{})),"status"),"ready_for_table")),"tests/kernel/test_setup_drafts.py:388 assert client.ok(\"setup.complete\", {\"campaign\": CAMPAIGN})[\"status\"] == \"ready_for_table\"");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_era_the_rulebook_never_tabulated_builds_the_card_and_says_what_stood_in"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_era_the_rulebook_never_tabulated_builds_the_card_and_says_what_stood_in(temporary);});
export async function test_a_period_the_agent_invents_is_still_refused_with_the_closed_set(tmp_path:any){

let client:any=(new RpcClient(pyDivide(tmp_path,"workspace"),({"content":(await authored_era_content(tmp_path,AUTHORED_ERA))})));
try{(await pyMethod(client,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"en"})],{}));
let error:any=(await pyMethod(client,"err",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({...(await profile()),["era"]:AUTHORED_ERA})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"field"),"era"):__left})())),"tests/kernel/test_setup_drafts.py:400 assert error[\"code\"] == \"needs\" and error[\"details\"][\"field\"] == \"era\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"source_era"),AUTHORED_ERA)),"tests/kernel/test_setup_drafts.py:401 assert error[\"details\"][\"source_era\"] == AUTHORED_ERA");
let table:any=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(CONTENT_DIR,"rulesets/coc7/rules-json/cash-assets.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"options"),(await pyList(pyAt(table,"periods"))))),pyStr("the closed set is the table's own periods"));
assert.ok(pyBool(!pyContains(((await (async()=>{const __left=(await pyMethod(error,"get",["fix"],{}));return pyBool(__left)?__left:""})())),"blocked")),pyStr("the refusal must not hand the agent a dead end"));
let picked:any=(await pyMethod(client,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({...(await profile()),["era"]:"modern"})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(picked,"sheet"),"era"),"modern")),"tests/kernel/test_setup_drafts.py:407 assert picked[\"sheet\"][\"era\"] == \"modern\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(picked,"sheet"),"finance"),"substituted_for"),AUTHORED_ERA)),"tests/kernel/test_setup_drafts.py:408 assert picked[\"sheet\"][\"finance\"][\"substituted_for\"] == AUTHORED_ERA");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(picked,"sheet"),"finance"),"source"),"cash-assets.periods.modern")),"tests/kernel/test_setup_drafts.py:409 assert picked[\"sheet\"][\"finance\"][\"source\"] == \"cash-assets.periods.modern\"");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_period_the_agent_invents_is_still_refused_with_the_closed_set"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_period_the_agent_invents_is_still_refused_with_the_closed_set(temporary);});
export async function test_a_resumed_setup_counts_the_draft_as_the_investigator_step(kernel:any){

(await begin(kernel));
let completed:any=pyAt((await pyMethod(kernel,"ok",["setup.steps",({["campaign"]:CAMPAIGN})],{})),"completed");
assert.ok(pyBool(pyContains(completed,"create-investigator")),"tests/kernel/test_setup_drafts.py:419 assert \"create-investigator\" in completed");
assert.ok(pyBool(!pyContains(completed,"confirm-investigator")),"tests/kernel/test_setup_drafts.py:420 assert \"confirm-investigator\" not in completed");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_resumed_setup_counts_the_draft_as_the_investigator_step"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_resumed_setup_counts_the_draft_as_the_investigator_step(await kernel(t,{}));});
export async function test_a_model_number_never_overwrites_a_player_pin(kernel:any){
let draft:any=(await begin(kernel));
let sheet:any=pyAt(draft,"sheet");
let dex:any=pyAdd(pyAt(pyAt(sheet,"characteristics"),"DEX"),((pyBool(pyLessEqual(pyAt(pyAt(sheet,"characteristics"),"DEX"),85))?5:(-5))));
let mine:any=(await pyMethod(kernel,"ok",["setup.override",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["edits"]:({["characteristics"]:({["DEX"]:dex}),["skills"]:({["Dodge"]:({["interest"]:10})})})})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(pyAt(mine,"pins"),"characteristics"),"DEX"),"by"),"player");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(pyAt(mine,"pins"),"skills"),"Dodge"),"by"),"player"):__left})())),"tests/kernel/test_setup_drafts.py:428 assert mine[\"pins\"][\"characteristics\"][\"DEX\"][\"by\"] == \"player\" and mine[\"pins\"][\"skills\"][\"Dodge\"][\"by\"] == \"player\"");
let theirs:any=(await pyMethod(kernel,"ok",["setup.revise",({["campaign"]:CAMPAIGN,["revision"]:pyAt(mine,"revision"),["by"]:"model",["numbers"]:({["characteristics"]:({["DEX"]:15}),["skills"]:({["Dodge"]:70})})})],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(theirs,"sheet"),"characteristics"),"DEX"),dex)),"tests/kernel/test_setup_drafts.py:431 assert theirs[\"sheet\"][\"characteristics\"][\"DEX\"] == dex");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(theirs,"sheet"),"skills"),"Dodge"),pyAt(pyAt(pyAt(mine,"sheet"),"skills"),"Dodge"))),"tests/kernel/test_setup_drafts.py:432 assert theirs[\"sheet\"][\"skills\"][\"Dodge\"] == mine[\"sheet\"][\"skills\"][\"Dodge\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(theirs,"pins"),"characteristics"),"DEX"),pyAt(pyAt(pyAt(mine,"pins"),"characteristics"),"DEX"))),"tests/kernel/test_setup_drafts.py:433 assert theirs[\"pins\"][\"characteristics\"][\"DEX\"] == mine[\"pins\"][\"characteristics\"][\"DEX\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(theirs,"pins"),"skills"),"Dodge"),pyAt(pyAt(pyAt(mine,"pins"),"skills"),"Dodge"))),"tests/kernel/test_setup_drafts.py:434 assert theirs[\"pins\"][\"skills\"][\"Dodge\"] == mine[\"pins\"][\"skills\"][\"Dodge\"]");
assert.ok(pyBool(pyEqual((await pySorted(pyAt(theirs,"kept_player_pins"))),["DEX","Dodge"])),"tests/kernel/test_setup_drafts.py:435 assert sorted(theirs[\"kept_player_pins\"]) == [\"DEX\", \"Dodge\"]");
assert.ok(pyBool(pyEqual(pyAt(theirs,"revision"),pyAt(mine,"revision"))),pyStr("nothing changed, so the card did not move"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_model_number_never_overwrites_a_player_pin"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_model_number_never_overwrites_a_player_pin(await kernel(t,{}));});
export async function test_a_named_weapon_plays_by_its_printed_profile_under_the_players_name(kernel:any){

(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"the-haunting",["play_language"]:"en"})],{}));
let draft:any=(await pyMethod(kernel,"ok",["setup.draft",({["campaign"]:CAMPAIGN,["profile"]:({...(await profile()),["weapons"]:[({["name"]:"武士刀",["profile"]:"Sword, medium"}),".38 Automatic","Knife, small"]})})],{}));
let weapons:any=pyAt(pyAt(draft,"sheet"),"weapons");
let katana:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const w of pyIterable(weapons)){if(pyBool(pyEqual(pyAt(w,"name"),"武士刀")))__rows.push(w);}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(await pyMethod(pyAt(katana,"profile"),"startswith",["Sword, medium"],{}));return pyBool(__left)?pyEqual(pyAt(katana,"display_name"),"武士刀"):__left})())),"tests/kernel/test_setup_drafts.py:445 assert katana[\"profile\"].startswith(\"Sword, medium\") and katana[\"display_name\"] == \"武士刀\"");
let printed:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const w of pyIterable(weapons)){if(pyBool(pyEqual(pyAt(w,"name"),".38 Automatic")))__rows.push(w);}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(katana,"damage_die"),"1D6+1");return pyBool(__left)?pyEqual(pyAt(katana,"skill"),"Fighting (Sword)"):__left})());return pyBool(__left)?pyAt(printed,"damage_die"):__left})())),"tests/kernel/test_setup_drafts.py:447 assert katana[\"damage_die\"] == \"1D6+1\" and katana[\"skill\"] == \"Fighting (Sword)\" and printed[\"damage_die\"]");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const w of pyIterable(weapons)){if(pyBool(true))__rows.push((await pyMethod(pyAt(w,"name"),"startswith",["Knife, small"],{})));}return __rows;})())))),pyStr("a printed name shortened to its head still resolves"));
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(pyAt(draft,"sheet"),"equipment"),"武士刀");return pyBool(__left)?!pyContains(pyAt(pyAt(draft,"sheet"),"equipment"),"Sword, medium"):__left})())),"tests/kernel/test_setup_drafts.py:449 assert \"武士刀\" in draft[\"sheet\"][\"equipment\"] and \"Sword, medium\" not in draft[\"sheet\"][\"equipment\"]");
assert.ok(pyBool(pyEqual(pyAt(draft,"moved_to_equipment"),[])),"tests/kernel/test_setup_drafts.py:450 assert draft[\"moved_to_equipment\"] == []");
let refused:any=(await pyMethod(kernel,"call",["setup.revise",({["campaign"]:CAMPAIGN,["revision"]:pyAt(draft,"revision"),["profile"]:({["weapons"]:[({["name"]:"飞刀",["profile"]:"Boomerang of Doom"})]})})],{}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pyAt(refused,"error"),"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(refused,"error"),"details"),"field"),"weapons"):__left})());return pyBool(__left)?pyAt(pyAt(pyAt(refused,"error"),"details"),"candidates"):__left})())),"tests/kernel/test_setup_drafts.py:452 assert refused[\"error\"][\"code\"] == \"needs\" and refused[\"error\"][\"details\"][\"field\"] == \"weapons\" and refused[\"error\"][\"details\"][\"candidates\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_named_weapon_plays_by_its_printed_profile_under_the_players_name"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_named_weapon_plays_by_its_printed_profile_under_the_players_name(await kernel(t,{}));});
