// Migrated from tests/kernel/test_jev_resolve.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,campaign_dir,git_log,narrate,open_turn,read_json,walk_to_confrontation,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";






export async function options(client:any){
return (await pyMethod(client,"ok",["table.resolve.options",({["campaign"]:CAMPAIGN})],{}));
}
export async function fingerprint(client:any){
let root:any=(await campaign_dir(client.workspace));
let files:any=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const path of pyIterable((await pyMethod(root,"rglob",["*"],{})))){if(pyBool((await pyMethod(path,"is_file",[],{}))))__rows.push([(await pyMethod((await pyMethod(path,"relative_to",[root],{})),"as_posix",[],{})),(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod(path,"read_bytes",[],{}))],{})),"hexdigest",[],{}))]);}return __rows;})()));
return ({["files"]:files,["git"]:(await git_log(client.workspace))});
}
export async function profiles_by_skill(snapshot:any){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(snapshot,"profiles"))){if(pyBool(true))__rows.push([pyAt(row,"skill"),row]);}return __rows;})()));
}
export async function test_options_is_read_only_and_uses_canonical_sheet_and_rule_vocabulary(kernel:any){
(await open_turn(kernel));
let before:any=(await fingerprint(kernel));
let snapshot:any=(await options(kernel));
let after:any=(await fingerprint(kernel));
assert.ok(pyBool(pyEqual(pyAt(snapshot,"version"),1)),"tests/kernel/test_jev_resolve.py:39 assert snapshot[\"version\"] == 1");
assert.ok(pyBool(pyEqual(before,after)),pyStr("the resolve-options snapshot cannot touch campaign state or Git"));
assert.ok(pyBool((await (async()=>{const __left=pyAt(snapshot,"revision");return pyBool(__left)?pyAt(snapshot,"world_revision"):__left})())),"tests/kernel/test_jev_resolve.py:41 assert snapshot[\"revision\"] and snapshot[\"world_revision\"]");
assert.ok(pyBool(pyEqual((await pyMethod(pyAt(snapshot,"context"),"pop",["_binding"],{})),({["campaign"]:"c1",["worldline"]:"main",["loop"]:0,["turn"]:1}))),"tests/kernel/test_jev_resolve.py:45 assert snapshot[\"context\"].pop(\"_binding\") == {\"campaign\": \"c1\", \"worldline\": \"main\", \"loop\": 0, \"turn\": 1}");
assert.ok(pyBool(pyAt((await pyMethod(pyAt(pyAt(pyAt(snapshot,"context"),"first_blow"),"preparation"),"pop",["improvised"],{})),"options")),"tests/kernel/test_jev_resolve.py:47 assert snapshot[\"context\"][\"first_blow\"][\"preparation\"].pop(\"improvised\")[\"options\"]");
assert.ok(pyBool(pyEqual(pyAt(snapshot,"context"),({["scene"]:"Knott's Office",["pending_choice"]:null,["session"]:null,["first_blow"]:({["decision"]:"combat:attack",["intent"]:"combat",["actor"]:"托马斯·海斯",["targets"]:["Steven Knott"],["weapons"]:[".38 Revolver","unarmed","notebook and stub pencil","set of lockpicks","flashlight","badge that impresses clerks more than cops"],["preparation"]:({["targets"]:["Steven Knott"],["completions"]:({["Steven Knott"]:"archetype"}),["weapons"]:["notebook and stub pencil","set of lockpicks","flashlight","badge that impresses clerks more than cops"]})}),["conditions"]:[({["actor"]:"托马斯·海斯",["conditions"]:[]})],["current_receipts"]:[],["declared_action"]:"我仔细观察诺特。",["public_exchange"]:null,["public_narration"]:({["text"]:"开场。\n\n诺特把钥匙拍在桌上。",["truncated"]:false})}))),"tests/kernel/test_jev_resolve.py:48 assert snapshot[\"context\"] == {\n        \"scene\": \"Knott's Office\",\n        \"pending_choice\": None,\n        \"session\": None,\n        # §§135.30.2/159.10.1: Knott is named; his missing profile and unprepared inventory methods stay explicit.\n        \"first_blow\": {\n            \"decision\": \"combat:attack\",\n            \"intent\": \"combat\",\n            \"actor\": \"托马斯·海斯\",\n            \"targets\": [\"Steven Knott\"],\n            \"weapons\": [\n                \".38 Revolver\",\n                \"unarmed\",\n                \"notebook and stub pencil\",\n                \"set of lockpicks\",\n                \"flashlight\",\n                \"badge that impresses clerks more than cops\",\n            ],\n            \"preparation\": {\n                \"targets\": [\"Steven Knott\"],\n                # §180.6 (CK-F2 review follow-up): the completion each listed target takes.\n                \"completions\": {\"Steven Knott\": \"archetype\"},\n                \"weapons\": [\n                    \"notebook and stub pencil\",\n                    \"set of lockpicks\",\n                    \"flashlight\",\n                    \"badge that impresses clerks more than cops\",\n                ],\n            },\n        },\n        \"conditions\": [{\"actor\": \"托马斯·海斯\", \"conditions\": []}],\n        \"current_receipts\": [],\n        \"declared_action\": \"我仔细观察诺特。\",\n        # §159 (6d870987b): what the player was last told, for the Jev check selector's \"is this option consistent with\n        # the situation\" (runtime/jev/hybrid-engine.ts hands it the whole context but `_binding`). Player-visible text only.\n        \"public_exchange\": None,\n        \"public_narration\": {\"text\": \"开场。\\n\\n诺特把钥匙拍在桌上。\", \"truncated\": False},\n    }");
let rows:any=pyAt(snapshot,"profiles");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){if(pyBool(true))__rows.push(pyAt(row,"alias"));}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const index of pyIterable((await pyRange((await pyLen(rows)))))){if(pyBool(true))__rows.push(`profile:${index}`);}return __rows;})()))),"tests/kernel/test_jev_resolve.py:88 assert [row[\"alias\"] for row in rows] == [f\"profile:{index}\" for index in range(len(rows))]");
assert.ok(pyBool(pyEqual((await pyLen(new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){if(pyBool(true))__rows.push([pyAt(row,"actor"),pyAt(row,"skill")]);}return __rows;})())))),(await pyLen(rows)))),"tests/kernel/test_jev_resolve.py:89 assert len({(row[\"actor\"], row[\"skill\"]) for row in rows}) == len(rows)");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){if(pyBool(true))__rows.push(pyEqual(pyAt(row,"actor"),"托马斯·海斯"));}return __rows;})())))),"tests/kernel/test_jev_resolve.py:90 assert all(row[\"actor\"] == \"托马斯·海斯\" for row in rows)");
let bound:any=(await profiles_by_skill(snapshot));
assert.ok(pyBool(pyEqual(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const skill of pyIterable(["Fast Talk","Library Use","Psychology","Spot Hidden","STR","LUCK"])){if(pyBool(true))__rows.push([skill,pyAt(pyAt(bound,skill),"value")]);}return __rows;})())),({["Fast Talk"]:45,["Library Use"]:40,["Psychology"]:45,["Spot Hidden"]:55,["STR"]:60,["LUCK"]:50}))),"tests/kernel/test_jev_resolve.py:92 assert {skill: bound[skill][\"value\"] for skill in\n            (\"Fast Talk\", \"Library Use\", \"Psychology\", \"Spot Hidden\", \"STR\", \"LUCK\")} == {\n        \"Fast Talk\": 45, \"Library Use\": 40, \"Psychology\": 45,\n        \"Spot Hidden\": 55, \"STR\": 60, \"LUCK\": 50,\n    }");
assert.ok(pyBool(pyEqual(pyAt(bound,"Occult"),({...pyAt(bound,"Occult"),["availability"]:"bound",["value"]:5}))),"tests/kernel/test_jev_resolve.py:97 assert bound[\"Occult\"] == {**bound[\"Occult\"], \"availability\": \"bound\", \"value\": 5}");
assert.ok(pyBool(pyEqual(pyAt(bound,"Medicine"),({...pyAt(bound,"Medicine"),["availability"]:"bound",["value"]:1}))),"tests/kernel/test_jev_resolve.py:98 assert bound[\"Medicine\"] == {**bound[\"Medicine\"], \"availability\": \"bound\", \"value\": 1}");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(bound,"Language (Latin)");return pyBool(__left)?!pyContains(bound,"Medicine (Surgery)"):__left})())),"tests/kernel/test_jev_resolve.py:99 assert \"Language (Latin)\" not in bound and \"Medicine (Surgery)\" not in bound");
let decisions:any=pyAt(snapshot,"decisions");
assert.ok(pyBool(pyEqual((await pyLen(decisions)),(await pyLen(new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(decisions)){if(pyBool(true))__rows.push(pyAt(row,"name"));}return __rows;})())))))),"tests/kernel/test_jev_resolve.py:102 assert len(decisions) == len({row[\"name\"] for row in decisions})");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(decisions)){if(pyBool(true))__rows.push(pyEqual((await pySet(row)),new Set(["name","family","description","capability","guidance"])));}return __rows;})())))),"tests/kernel/test_jev_resolve.py:104 assert all(set(row) == {\"name\", \"family\", \"description\", \"capability\", \"guidance\"} for row in decisions)");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(decisions)){if(pyBool(true))__rows.push((await (async()=>{const __left=(await pyIsInstance(pyAt(row,"guidance"),pyList));return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(row,"guidance"))){if(pyBool(true))__rows.push(pyEqual((await pySet(item)),new Set(["text","source_refs"])));}return __rows;})()))):__left})()));}return __rows;})())))),"tests/kernel/test_jev_resolve.py:105 assert all(isinstance(row[\"guidance\"], list) and all(set(item) == {\"text\", \"source_refs\"} for item in row[\"guidance\"])\n               for row in decisions)");
let ordinary:any=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(decisions)){if(pyBool(pyEqual(pyAt(row,"name"),"core-check:ordinary-check")))__rows.push(row);}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(ordinary,"family"),"core-check");return pyBool(__left)?pyEqual(pyAt(ordinary,"capability"),"check"):__left})())),"tests/kernel/test_jev_resolve.py:108 assert ordinary[\"family\"] == \"core-check\" and ordinary[\"capability\"] == \"check\"");
assert.ok(pyBool(pyAt(ordinary,"description")),"tests/kernel/test_jev_resolve.py:109 assert ordinary[\"description\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_options_is_read_only_and_uses_canonical_sheet_and_rule_vocabulary"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_options_is_read_only_and_uses_canonical_sheet_and_rule_vocabulary(await kernel(t,{}));});
export async function test_profile_rows_say_which_skills_the_sheet_holds(kernel:any){

(await open_turn(kernel));
let sheet:any=(await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"party"),"thomas-hayes.json")));
let rows:any=pyAt((await options(kernel)),"profiles");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){if(pyBool(true))__rows.push((await pyIsInstance(pyAt(row,"held"),pyBool)));}return __rows;})())))),"tests/kernel/test_jev_resolve.py:118 assert all(isinstance(row[\"held\"], bool) for row in rows)");
let held:any=new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){if(pyBool(pyAt(row,"held")))__rows.push(pyAt(row,"skill"));}return __rows;})()));
let characteristics:any=new Set(["STR","CON","SIZ","DEX","APP","INT","POW","EDU","LUCK"]);
assert.ok(pyBool(pyEqual(held,pyUnion((await pySet(pyAt(sheet,"skills"))),(pyIntersection(new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){if(pyBool(true))__rows.push(pyAt(row,"skill"));}return __rows;})())),characteristics))))),"tests/kernel/test_jev_resolve.py:121 assert held == set(sheet[\"skills\"]) | ({row[\"skill\"] for row in rows} & characteristics)");
let catalog:any=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){if(pyBool(!pyBool(pyAt(row,"held"))))__rows.push(row);}return __rows;})());
assert.ok(pyBool(catalog),pyStr("the catalog offers skills the sheet does not list, so the flag is under test"));
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(catalog)){if(pyBool(true))__rows.push(!pyContains(pyAt(sheet,"skills"),pyAt(row,"skill")));}return __rows;})())))),"tests/kernel/test_jev_resolve.py:124 assert all(row[\"skill\"] not in sheet[\"skills\"] for row in catalog)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_profile_rows_say_which_skills_the_sheet_holds"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_profile_rows_say_which_skills_the_sheet_holds(await kernel(t,{}));});
export async function test_missing_characteristic_dependencies_stay_unknown_instead_of_becoming_numbers(kernel:any){
(await open_turn(kernel));
let sheet_path:any=pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"party"),"thomas-hayes.json");
let sheet:any=(await read_json(sheet_path));
(await pyMethod(pyAt(sheet,"characteristics"),"pop",["DEX"],{}));
(await pyMethod(pyAt(sheet,"skills"),"pop",["Dodge"],{}));
(await pyMethod(sheet_path,"write_text",[(await pyMethod(json,"dumps",[sheet],{"ensure_ascii":false,"indent":2}))],{"encoding":"utf-8"}));
let before:any=(await fingerprint(kernel));
let snapshot:any=(await options(kernel));
let bound:any=(await profiles_by_skill(snapshot));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(bound,"DEX"),"availability"),"unknown");return pyBool(__left)?(pyAt(pyAt(bound,"DEX"),"value")===null):__left})())),"tests/kernel/test_jev_resolve.py:139 assert bound[\"DEX\"][\"availability\"] == \"unknown\" and bound[\"DEX\"][\"value\"] is None");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(bound,"Dodge"),"availability"),"unknown");return pyBool(__left)?(pyAt(pyAt(bound,"Dodge"),"value")===null):__left})())),"tests/kernel/test_jev_resolve.py:140 assert bound[\"Dodge\"][\"availability\"] == \"unknown\" and bound[\"Dodge\"][\"value\"] is None");
assert.ok(pyBool(pyEqual((await fingerprint(kernel)),before)),"tests/kernel/test_jev_resolve.py:141 assert fingerprint(kernel) == before");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_missing_characteristic_dependencies_stay_unknown_instead_of_becoming_numbers"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_missing_characteristic_dependencies_stay_unknown_instead_of_becoming_numbers(await kernel(t,{}));});
export async function test_options_preserves_actual_pending_choice_and_active_session_without_writing(kernel:any){
(await open_turn(kernel,"我举枪对准棺材里的东西。"));
let ordinal:any=(await walk_to_confrontation(kernel));
let attack:any=(await pyMethod(kernel,"table",["resolve"],{"call_id":`t1-c${ordinal}`,"action":({["intent"]:"combat",["goal"]:"朝科比特开枪",["method"]:"用左轮射击",["target"]:"Walter Corbitt",["weapon"]:".38 Revolver"})}));
assert.ok(pyBool((await (async()=>{const __left=pyAt(attack,"pending_choice");return pyBool(__left)?pyEqual(pyAt(pyAt(attack,"session"),"status"),"active"):__left})())),"tests/kernel/test_jev_resolve.py:151 assert attack[\"pending_choice\"] and attack[\"session\"][\"status\"] == \"active\"");
let before:any=(await fingerprint(kernel));
let snapshot:any=(await options(kernel));
assert.ok(pyBool(pyEqual(pyAt(pyAt(snapshot,"context"),"pending_choice"),pyAt(attack,"pending_choice"))),"tests/kernel/test_jev_resolve.py:156 assert snapshot[\"context\"][\"pending_choice\"] == attack[\"pending_choice\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(snapshot,"context"),"session"),pyAt(attack,"session"))),"tests/kernel/test_jev_resolve.py:157 assert snapshot[\"context\"][\"session\"] == attack[\"session\"]");
assert.ok(pyBool(pyAt(pyAt(snapshot,"context"),"current_receipts")),"tests/kernel/test_jev_resolve.py:158 assert snapshot[\"context\"][\"current_receipts\"]");
assert.ok(pyBool(pyEqual((await fingerprint(kernel)),before)),"tests/kernel/test_jev_resolve.py:159 assert fingerprint(kernel) == before");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_options_preserves_actual_pending_choice_and_active_session_without_writing"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_options_preserves_actual_pending_choice_and_active_session_without_writing(await kernel(t,{}));});
export async function test_first_blow_names_target_and_preparations_until_the_fight_opens(kernel:any){

(await open_turn(kernel,"我一拳打过去。"));
let unprepared:any=pyAt(pyAt((await options(kernel)),"context"),"first_blow");
let improvised:any=(await pyMethod(pyAt(unprepared,"preparation"),"pop",["improvised"],{}));
assert.ok(pyBool((await (async()=>{const __left=pyAt(improvised,"options");return pyBool(__left)?pyLessEqual((await pySet(pyAt(improvised,"close"))),(await pySet(pyAt(pyAt(unprepared,"preparation"),"weapons")))):__left})())),"tests/kernel/test_jev_resolve.py:168 assert improvised[\"options\"] and set(improvised[\"close\"]) <= set(unprepared[\"preparation\"][\"weapons\"])");
assert.ok(pyBool(pyEqual(unprepared,({["decision"]:"combat:attack",["intent"]:"combat",["actor"]:"托马斯·海斯",["targets"]:["Steven Knott"],["weapons"]:[".38 Revolver","unarmed","notebook and stub pencil","set of lockpicks","flashlight","badge that impresses clerks more than cops"],["preparation"]:({["targets"]:["Steven Knott"],["completions"]:({["Steven Knott"]:"archetype"}),["weapons"]:["notebook and stub pencil","set of lockpicks","flashlight","badge that impresses clerks more than cops"]})}))),"tests/kernel/test_jev_resolve.py:169 assert unprepared == {\n        \"decision\": \"combat:attack\", \"intent\": \"combat\", \"actor\": \"托马斯·海斯\", \"targets\": [\"Steven Knott\"],\n        \"weapons\": [\n            \".38 Revolver\", \"unarmed\", \"notebook and stub pencil\", \"set of lockpicks\", \"flashlight\",\n            \"badge that impresses clerks more than cops\",\n        ],\n        \"preparation\": {\n            \"targets\": [\"Steven Knott\"],\n            \"completions\": {\"Steven Knott\": \"archetype\"},\n            \"weapons\": [\n                \"notebook and stub pencil\", \"set of lockpicks\", \"flashlight\", \"badge that impresses clerks more than cops\",\n            ],\n        },\n    }");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"npc",["name"]:"Steven Knott",["archetype"]:"ordinary_adult",["why"]:"test"})]}));
let before:any=(await fingerprint(kernel));
let row:any=pyAt(pyAt((await options(kernel)),"context"),"first_blow");
assert.ok(pyBool(pyAt((await pyMethod(pyAt(row,"preparation"),"pop",["improvised"],{})),"options")),"tests/kernel/test_jev_resolve.py:186 assert row[\"preparation\"].pop(\"improvised\")[\"options\"]");
assert.ok(pyBool(pyEqual((await fingerprint(kernel)),before)),pyStr("a read"));
let present:any=(await (async()=>{const __rows:any[]=[];for(const person of pyIterable(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"present"))){if(pyBool(true))__rows.push(pyAt(person,"name"));}return __rows;})());
assert.ok(pyBool(pyEqual(row,({["decision"]:"combat:attack",["intent"]:"combat",["actor"]:"托马斯·海斯",["targets"]:["Steven Knott"],["weapons"]:[".38 Revolver","unarmed","notebook and stub pencil","set of lockpicks","flashlight","badge that impresses clerks more than cops"],["preparation"]:({["targets"]:[],["completions"]:({}),["weapons"]:["notebook and stub pencil","set of lockpicks","flashlight","badge that impresses clerks more than cops"]})}))),"tests/kernel/test_jev_resolve.py:189 assert row == {\n        \"decision\": \"combat:attack\", \"intent\": \"combat\", \"actor\": \"托马斯·海斯\", \"targets\": [\"Steven Knott\"],\n        \"weapons\": [\n            \".38 Revolver\", \"unarmed\", \"notebook and stub pencil\", \"set of lockpicks\", \"flashlight\",\n            \"badge that impresses clerks more than cops\",\n        ],\n        \"preparation\": {\n            \"targets\": [],\n            \"completions\": {},\n            \"weapons\": [\n                \"notebook and stub pencil\", \"set of lockpicks\", \"flashlight\", \"badge that impresses clerks more than cops\",\n            ],\n        },\n    }");
assert.ok(pyBool(pyEqual(pyAt(row,"targets"),present)),pyStr("the capsule's identities, so the compile's target rows are the addressee rows"));
let opened:any=(await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c2","action":({["intent"]:pyAt(row,"intent"),["decision"]:pyAt(row,"decision"),["target"]:pyAt(pyAt(row,"targets"),0),["weapon"]:"unarmed",["goal"]:"一拳",["method"]:"一拳"})}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(opened,"session"),"kind"),"combat");return pyBool(__left)?pyEqual(pyAt(pyAt(opened,"session"),"status"),"active"):__left})())),"tests/kernel/test_jev_resolve.py:207 assert opened[\"session\"][\"kind\"] == \"combat\" and opened[\"session\"][\"status\"] == \"active\"");
assert.ok(pyBool((pyAt(pyAt((await options(kernel)),"context"),"first_blow")===null)),"tests/kernel/test_jev_resolve.py:208 assert options(kernel)[\"context\"][\"first_blow\"] is None");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_first_blow_names_target_and_preparations_until_the_fight_opens"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_first_blow_names_target_and_preparations_until_the_fight_opens(await kernel(t,{}));});
export async function test_options_rejects_foreign_closed_and_extra_requests(kernel:any){
(await open_turn(kernel));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["table.resolve.options",({["campaign"]:"other"})],{})),"code"),"campaign_not_found")),"tests/kernel/test_jev_resolve.py:213 assert kernel.err(\"table.resolve.options\", {\"campaign\": \"other\"})[\"code\"] == \"campaign_not_found\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["table.resolve.options",({})],{})),"code"),"invalid_params")),"tests/kernel/test_jev_resolve.py:214 assert kernel.err(\"table.resolve.options\", {})[\"code\"] == \"invalid_params\"");
for(const params of pyIterable([({["campaign"]:CAMPAIGN,["extra"]:true}),({["campaign"]:CAMPAIGN,["action"]:({})})])){
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["table.resolve.options",params],{})),"code"),"invalid_params")),"tests/kernel/test_jev_resolve.py:216 assert kernel.err(\"table.resolve.options\", params)[\"code\"] == \"invalid_params\"");
}
(await narrate(kernel,"t1-c1","The current turn closes without a check."));
let closed:any=(await pyMethod(kernel,"err",["table.resolve.options",({["campaign"]:CAMPAIGN})],{}));
assert.ok(pyBool(pyEqual(pyAt(closed,"code"),"campaign_not_ready")),"tests/kernel/test_jev_resolve.py:220 assert closed[\"code\"] == \"campaign_not_ready\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_options_rejects_foreign_closed_and_extra_requests"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_options_rejects_foreign_closed_and_extra_requests(await kernel(t,{}));});
export async function test_options_does_not_change_the_existing_resolve_call_or_exact_replay(kernel:any){
(await open_turn(kernel));
let initial:any=(await options(kernel));
let request:any=({["campaign"]:CAMPAIGN,["call_id"]:"t1-c1",["action"]:({["intent"]:"investigate",["goal"]:"check the room",["method"]:"look carefully",["skill"]:"Spot Hidden"})});
let settled:any=(await pyMethod(kernel,"ok",["table.resolve",request],{}));
assert.ok(pyBool(!pyContains(settled,"_task_advance")),pyStr("ordinary callers retain the existing result shape"));
let after_settlement:any=(await fingerprint(kernel));
let replayed:any=(await pyMethod(kernel,"ok",["table.resolve",request],{}));
let current:any=(await options(kernel));
assert.ok(pyBool(pyEqual(replayed,({...settled,["replayed"]:true}))),"tests/kernel/test_jev_resolve.py:236 assert replayed == {**settled, \"replayed\": True}");
assert.ok(pyBool(pyEqual((await fingerprint(kernel)),after_settlement)),pyStr("exact replay and the following options read add no second settlement"));
assert.ok(pyBool(pyEqual([pyAt(current,"profiles"),pyAt(current,"decisions")],[pyAt(initial,"profiles"),pyAt(initial,"decisions")])),pyStr("profile and rule vocabulary did not change"));
assert.ok(pyBool(pyEqual((pyEqual(pyAt(current,"revision"),pyAt(initial,"revision"))),(pyEqual(pyAt(current,"selection"),pyAt(initial,"selection"))))),"tests/kernel/test_jev_resolve.py:242 assert (current[\"revision\"] == initial[\"revision\"]) == (current[\"selection\"] == initial[\"selection\"])");
assert.ok(pyBool(pyEqual(pyAt((await options(kernel)),"revision"),pyAt(current,"revision"))),pyStr("a second read of the same state is the same revision"));
assert.ok(pyBool(!pyEqual(pyAt(current,"world_revision"),pyAt(initial,"world_revision"))),pyStr("the settled receipt changes task-world freshness"));
let roll:any=pyAt(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"),0);
assert.ok(pyBool(pyEqual(pyAt(pyAt(current,"context"),"current_receipts"),[({["kind"]:"roll",["actor"]:"托马斯·海斯",["scene_change"]:false,["skill"]:"Spot Hidden",["outcome"]:pyAt(pyAt(roll,"check"),"outcome"),["goal"]:"check the room",["passed"]:pyAt(roll,"passed"),["decision"]:"core-check:ordinary-check",["rule"]:null})])),"tests/kernel/test_jev_resolve.py:248 assert current[\"context\"][\"current_receipts\"] == [{\n        \"kind\": \"roll\", \"actor\": \"托马斯·海斯\", \"scene_change\": False, \"skill\": \"Spot Hidden\",\n        \"outcome\": roll[\"check\"][\"outcome\"], \"goal\": \"check the room\", \"passed\": roll[\"passed\"],\n        \"decision\": \"core-check:ordinary-check\", \"rule\": None,\n    }]");
assert.ok(pyBool(pyEqual((await pyLen(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"))),1)),"tests/kernel/test_jev_resolve.py:253 assert len(kernel.table(\"status\")[\"receipts\"]) == 1");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_options_does_not_change_the_existing_resolve_call_or_exact_replay"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_options_does_not_change_the_existing_resolve_call_or_exact_replay(await kernel(t,{}));});
export async function test_tracked_resolve_returns_exact_receipt_revision_and_replays_without_a_second_roll(kernel:any){
(await open_turn(kernel));
let before:any=pyAt((await pyMethod(kernel,"ok",["table.capsule",({["campaign"]:CAMPAIGN})],{})),"_context");
let request:any=({["campaign"]:CAMPAIGN,["call_id"]:"t1-c1",["_task_read_set"]:true,["action"]:({["intent"]:"investigate",["goal"]:"check the room",["method"]:"look carefully",["skill"]:"Spot Hidden"})});
let settled:any=(await pyMethod(kernel,"ok",["table.resolve",request],{}));
let after:any=pyAt((await pyMethod(kernel,"ok",["table.capsule",({["campaign"]:CAMPAIGN})],{})),"_context");
let advance:any=pyAt(settled,"_task_advance");
assert.ok(pyBool(pyEqual(advance,({["campaign"]:CAMPAIGN,["turn"]:1,["worldline"]:"main",["loop"]:0,["operationId"]:"t1-c1",["receiptIds"]:pyAt(settled,"receipts"),["before"]:pyAt(before,"world_revision"),["after"]:pyAt(after,"world_revision"),["task_before"]:pyAt(before,"task_world_revision"),["task_after"]:pyAt(after,"task_world_revision")}))),"tests/kernel/test_jev_resolve.py:266 assert advance == {\n        \"campaign\": CAMPAIGN,\n        \"turn\": 1,\n        \"worldline\": \"main\",\n        \"loop\": 0,\n        \"operationId\": \"t1-c1\",\n        \"receiptIds\": settled[\"receipts\"],\n        \"before\": before[\"world_revision\"],\n        \"after\": after[\"world_revision\"],\n        \"task_before\": before[\"task_world_revision\"],\n        \"task_after\": after[\"task_world_revision\"],\n    }");
assert.ok(pyBool(!pyEqual(pyAt(advance,"before"),pyAt(advance,"after"))),"tests/kernel/test_jev_resolve.py:278 assert advance[\"before\"] != advance[\"after\"]");
assert.ok(pyBool(!pyEqual(pyAt(advance,"task_before"),pyAt(advance,"task_after"))),"tests/kernel/test_jev_resolve.py:279 assert advance[\"task_before\"] != advance[\"task_after\"]");
let written:any=(await fingerprint(kernel));
let replay:any=(await pyMethod(kernel,"ok",["table.resolve",request],{}));
assert.ok(pyBool(pyEqual(replay,({...settled,["replayed"]:true}))),"tests/kernel/test_jev_resolve.py:284 assert replay == {**settled, \"replayed\": True}");
assert.ok(pyBool(pyEqual(pyAt(replay,"_task_advance"),advance)),"tests/kernel/test_jev_resolve.py:285 assert replay[\"_task_advance\"] == advance");
assert.ok(pyBool(pyEqual((await fingerprint(kernel)),written)),"tests/kernel/test_jev_resolve.py:286 assert fingerprint(kernel) == written");
let invalid:any=(await pyMethod(kernel,"err",["table.resolve",({["campaign"]:CAMPAIGN,["call_id"]:"t1-c2",["_task_read_set"]:"yes",["action"]:({["intent"]:"investigate",["goal"]:"x",["method"]:"look",["skill"]:"Spot Hidden"})})],{}));
assert.ok(pyBool(pyEqual(pyAt(invalid,"code"),"invalid_params")),"tests/kernel/test_jev_resolve.py:289 assert invalid[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual((await fingerprint(kernel)),written)),"tests/kernel/test_jev_resolve.py:290 assert fingerprint(kernel) == written");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_tracked_resolve_returns_exact_receipt_revision_and_replays_without_a_second_roll"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_tracked_resolve_returns_exact_receipt_revision_and_replays_without_a_second_roll(await kernel(t,{}));});
