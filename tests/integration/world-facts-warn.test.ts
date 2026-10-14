// Migrated from tests/kernel/test_facts_warn.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,campaign_dir,create_campaign,narrate_opening,open_turn,read_json,read_jsonl,written,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";



export let INV:any="托马斯·海斯";
export async function size(payload:any){
return (await pyLen((await pyMethod((await pyMethod(json,"dumps",[payload],{"ensure_ascii":false})),"encode",["utf-8"],{}))));
}

export async function test_narrate_facts_are_sentences_from_receipts_and_world(kernel:any){
let opening:any,committed:any,receipts:any,roll:any,_:any,dice:any,delta:any,text:any,result:any,verdict:any,keeper_only:any,record:any;
(await create_campaign(kernel));
opening=(await narrate_opening(kernel));
assert.equal(pyAt(pyAt((await kernel.table("capsule")),"where"),"display_name"),"Knott's Office","the public location fact does not erase the Keeper heading");
committed=pyAt(pyAt(opening,"facts"),"committed");
assert.ok(pyBool(pyEqual(committed,["Location: Scene","Present: Steven Knott"])),"tests/kernel/test_facts_warn.py:22 assert committed == [\"Location: Knott's Office\", \"Present: Steven Knott\"]");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(pyAt(pyAt(opening,"facts"),"keeper_only"))){if(pyBool(true))__rows.push((await pyMethod(line,"startswith",["Undiscovered clue: knott-keys -- "],{})));}return __rows;})())))),"tests/kernel/test_facts_warn.py:23 assert any(line.startswith(\"Undiscovered clue: knott-keys -- \") for line in opening[\"facts\"][\"keeper_only\"])");
assert.ok(pyBool(pyEqual(pyAt(opening,"extraction"),({["job_id"]:"extract:c1:t0"}))),"tests/kernel/test_facts_warn.py:24 assert opening[\"extraction\"] == {\"job_id\": \"extract:c1:t0\"}");
(await pyMethod(kernel,"table",["player_input"],{"text":"我翻看桌上的文件。"}));
(await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c1","action":({["intent"]:"investigate",["goal"]:"找线索",["method"]:"翻找",["skill"]:"Spot Hidden"})}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"clue",["clue"]:"knott-keys",["label"]:"钥匙"}),({["kind"]:"time",["minutes"]:15,["beyond_travel"]:true}),({["kind"]:"damage",["dice"]:"1D3",["why"]:"被抽屉夹了"}),({["kind"]:"move",["to"]:"hall-of-records",["travel_minutes"]:20})]}));
receipts=pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts");
const __unpack1705=(await written(receipts));roll=__unpack1705[0];_=__unpack1705[1];_=__unpack1705[2];dice=__unpack1705[3];delta=__unpack1705[4];_=__unpack1705[5];
text=`你出了门：掷出 ${pyAt(roll,"roll")}（侦查 ${pyAt(roll,"target")}），伤害 ${pyAt(dice,"total")}，生命值 12 到 ${pyAt(delta,"after")}，过了 15 分钟。`;
result=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":text}));
verdict=(pyBool(pyAt(roll,"passed"))?"passed":"failed");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"facts"),"committed"),["Player declared: 我翻看桌上的文件。",`${INV}'s Spot Hidden check ${verdict} (${pyAt(roll,"level")})`,"Clue found: 钥匙","Time advances 15 min",`${INV} rolls damage 1D3: ${pyAt(dice,"total")}`,`hp: ${INV} 12 -> ${pyAt(delta,"after")}`,"Scene: Knott's Office -> Hall of Records (20 min)","Location: Hall of Records","Present: the Hall of Records clerk"])),"tests/kernel/test_facts_warn.py:41 assert result[\"facts\"][\"committed\"] == [\n        \"Player declared: 我翻看桌上的文件。\",\n        f\"{INV}'s Spot Hidden check {verdict} ({roll['level']})\",\n        \"Clue found: 钥匙\",\n        \"Time advances 15 min\",\n        f\"{INV} rolls damage 1D3: {dice['total']}\",\n        f\"hp: {INV} 12 -> {delta['after']}\",\n        \"Scene: Knott's Office -> Hall of Records (20 min)\",\n        \"Location: Hall of Records\",\n        \"Present: the Hall of Records clerk\",\n    ]");
keeper_only=pyAt(pyAt(result,"facts"),"keeper_only");
assert.ok(pyBool(pyLessEqual((await size(keeper_only)),2048)),"tests/kernel/test_facts_warn.py:53 assert size(keeper_only) <= 2048");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(keeper_only)){if(pyBool((await pyMethod(line,"startswith",["Undiscovered clue: "],{}))))__rows.push(line);}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const line of pyIterable(keeper_only)){if(pyBool((await pyMethod(line,"startswith",[["Undiscovered clue: will-executor-chapel -- ","Undiscovered clue: chapel-closed-1912 -- "]],{}))))__rows.push(line);}return __rows;})()))),"tests/kernel/test_facts_warn.py:54 assert [line for line in keeper_only if line.startswith(\"Undiscovered clue: \")] == [\n        line for line in keeper_only\n        if line.startswith((\"Undiscovered clue: will-executor-chapel -- \", \"Undiscovered clue: chapel-closed-1912 -- \"))]");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(keeper_only)){if(pyBool(true))__rows.push(pyContains(line,"knott-keys"));}return __rows;})()))))),"tests/kernel/test_facts_warn.py:57 assert not any(\"knott-keys\" in line for line in keeper_only)");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(keeper_only)){if(pyBool(true))__rows.push((await pyMethod(line,"startswith",["Module secret: corbitt-buried-alive-will -- "],{})));}return __rows;})())))),"tests/kernel/test_facts_warn.py:58 assert any(line.startswith(\"Module secret: corbitt-buried-alive-will -- \") for line in keeper_only)");
record=(await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0001.json")));
assert.ok(pyBool(pyEqual(pyAt(record,"facts"),pyAt(result,"facts"))),"tests/kernel/test_facts_warn.py:60 assert record[\"facts\"] == result[\"facts\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":text})),"facts"),pyAt(result,"facts"))),"tests/kernel/test_facts_warn.py:62 assert kernel.table(\"narrate\", call_id=\"t1-c3\", text=text)[\"facts\"] == result[\"facts\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_narrate_facts_are_sentences_from_receipts_and_world"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_narrate_facts_are_sentences_from_receipts_and_world(await kernel(t,{}));});
export async function test_keeper_only_lists_present_npc_secrets_and_drops_discovered_clues(kernel:any){
let keeper_only:any,secret:any,secrets:any;
(await open_turn(kernel));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-keys"})]}));
keeper_only=pyAt(pyAt((await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c2","text":"诺特把钥匙推过来。"})),"facts"),"keeper_only");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(keeper_only)){if(pyBool(true))__rows.push((await pyMethod(line,"startswith",["Undiscovered clue: knott-keys"],{})));}return __rows;})()))))),"tests/kernel/test_facts_warn.py:69 assert not any(line.startswith(\"Undiscovered clue: knott-keys\") for line in keeper_only)");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(keeper_only)){if(pyBool(true))__rows.push((await pyMethod(line,"startswith",["Undiscovered clue: knott-commission -- "],{})));}return __rows;})())))),"tests/kernel/test_facts_warn.py:70 assert any(line.startswith(\"Undiscovered clue: knott-commission -- \") for line in keeper_only)");
secret=(await (async()=>{const __rows:any[]=[];for(const line of pyIterable(keeper_only)){if(pyBool((await pyMethod(line,"startswith",["Steven Knott's secret -- "],{}))))__rows.push(line);}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual((await pyLen(secret)),1);return pyBool(__left)?pyContains(pyAt(secret,0),"agenda: Clear the Corbitt House"):__left})());return pyBool(__left)?pyContains(pyAt(secret,0),"secret: He knows only rumor"):__left})())),"tests/kernel/test_facts_warn.py:72 assert len(secret) == 1 and \"agenda: Clear the Corbitt House\" in secret[0] and \"secret: He knows only rumor\" in secret[0]");
secrets=(await (async()=>{const __rows:any[]=[];for(const [i,line] of pyIterable((await pyEnumerate(keeper_only)))){if(pyBool((await pyMethod(line,"startswith",["Module secret: "],{}))))__rows.push(i);}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=secrets;return pyBool(__left)?pyEqual(secrets,(await pyList((await pyRange(pyAt(secrets,0),(await pyLen(keeper_only))))))):__left})())),"tests/kernel/test_facts_warn.py:75 assert secrets and secrets == list(range(secrets[0], len(keeper_only)))");
assert.ok(pyBool(pyLessEqual((await size(keeper_only)),2048)),"tests/kernel/test_facts_warn.py:76 assert size(keeper_only) <= 2048");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_keeper_only_lists_present_npc_secrets_and_drops_discovered_clues"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_keeper_only_lists_present_npc_secrets_and_drops_discovered_clues(await kernel(t,{}));});

export async function warn(client:any,turn:any,findings:any,lane:any="verifier"){
return (await pyMethod(client,"ok",["table.warn",({["campaign"]:CAMPAIGN,["turn"]:turn,["lane"]:lane,["findings"]:findings})],{}));
}
export async function test_warn_anchors_quotes_as_substrings_and_drops_the_rest(kernel:any){
let state_before:any,result:any,record:any,telemetry:any,bad_kind:any,many:any;
(await open_turn(kernel));
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c1","text":"诺特看着你。\n\n他没有说话，只是把钥匙推了过来。"}));
state_before=(await pyMethod(kernel,"table",["status"],{}));
result=(await warn(kernel,1,[({["kind"]:"reveal",["quote"]:"他没有说话",["why"]:"科比特的事玩家还不该知道"}),({["kind"]:"uncommitted_state",["quote"]:"你拿走了钥匙",["why"]:"没有 clue 收据"}),({["kind"]:"player_agency",["quote"]:"诺特看着你。",["why"]:"替玩家决定了站位"}),({["kind"]:"reveal",["quote"]:"   ",["why"]:"空引文"})]));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(result,"turn"),1);return pyBool(__left)?pyEqual(pyAt(result,"lane"),"verifier"):__left})());return pyBool(__left)?pyEqual(pyAt(result,"accepted"),2):__left})())),"tests/kernel/test_facts_warn.py:95 assert result[\"turn\"] == 1 and result[\"lane\"] == \"verifier\" and result[\"accepted\"] == 2");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const d of pyIterable(pyAt(result,"dropped"))){if(pyBool(true))__rows.push(pyAt(d,"index"));}return __rows;})()),[1,3])),"tests/kernel/test_facts_warn.py:96 assert [d[\"index\"] for d in result[\"dropped\"]] == [1, 3]");
assert.ok(pyBool(pyEqual(pyAt(result,"warnings"),[({["kind"]:"reveal",["quote"]:"他没有说话",["why"]:"科比特的事玩家还不该知道"}),({["kind"]:"player_agency",["quote"]:"诺特看着你。",["why"]:"替玩家决定了站位"})])),"tests/kernel/test_facts_warn.py:97 assert result[\"warnings\"] == [\n        {\"kind\": \"reveal\", \"quote\": \"他没有说话\", \"why\": \"科比特的事玩家还不该知道\"},\n        {\"kind\": \"player_agency\", \"quote\": \"诺特看着你。\", \"why\": \"替玩家决定了站位\"},\n    ]");
record=(await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0001.json")));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const w of pyIterable(pyAt(record,"warnings"))){if(pyBool(true))__rows.push([pyAt(w,"lane"),pyAt(w,"kind"),pyAt(w,"quote")]);}return __rows;})()),[["verifier","reveal","他没有说话"],["verifier","player_agency","诺特看着你。"]])),"tests/kernel/test_facts_warn.py:102 assert [(w[\"lane\"], w[\"kind\"], w[\"quote\"]) for w in record[\"warnings\"]] == [\n        (\"verifier\", \"reveal\", \"他没有说话\"), (\"verifier\", \"player_agency\", \"诺特看着你。\")]");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const w of pyIterable(pyAt(record,"warnings"))){if(pyBool(true))__rows.push(pyAt(w,"at"));}return __rows;})())))),"tests/kernel/test_facts_warn.py:104 assert all(w[\"at\"] for w in record[\"warnings\"])");
telemetry=(await read_jsonl(pyDivide((await campaign_dir(kernel.workspace)),"telemetry.jsonl")));
assert.ok(pyBool(pyEqual(pyAt(telemetry,(-1)),({...pyAt(telemetry,(-1)),["lane"]:"verifier",["turn"]:1,["ok"]:true,["findings"]:4,["accepted"]:2,["dropped"]:2}))),"tests/kernel/test_facts_warn.py:106 assert telemetry[-1] == {**telemetry[-1], \"lane\": \"verifier\", \"turn\": 1, \"ok\": True, \"findings\": 4, \"accepted\": 2, \"dropped\": 2}");
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"table",["status"],{})),state_before)),"tests/kernel/test_facts_warn.py:107 assert kernel.table(\"status\") == state_before");
bad_kind=(await pyMethod(kernel,"err",["table.warn",({["campaign"]:CAMPAIGN,["turn"]:1,["lane"]:"verifier",["findings"]:[({["kind"]:"spoiler",["quote"]:"诺特看着你。",["why"]:""})]})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(bad_kind,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(bad_kind,"details"),"index"),0):__left})())),"tests/kernel/test_facts_warn.py:112 assert bad_kind[\"code\"] == \"invalid_params\" and bad_kind[\"details\"][\"index\"] == 0");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["table.warn",({["campaign"]:CAMPAIGN,["turn"]:1,["lane"]:"editor",["findings"]:[]})],{})),"code"),"invalid_params")),"tests/kernel/test_facts_warn.py:113 assert kernel.err(\"table.warn\", {\"campaign\": CAMPAIGN, \"turn\": 1, \"lane\": \"editor\", \"findings\": []})[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["table.warn",({["campaign"]:CAMPAIGN,["turn"]:7,["lane"]:"verifier",["findings"]:[]})],{})),"code"),"invalid_params")),"tests/kernel/test_facts_warn.py:114 assert kernel.err(\"table.warn\", {\"campaign\": CAMPAIGN, \"turn\": 7, \"lane\": \"verifier\", \"findings\": []})[\"code\"] == \"invalid_params\"");
many=(await warn(kernel,1,(await (async()=>{const __rows:any[]=[];for(const i of pyIterable((await pyRange(11)))){if(pyBool(true))__rows.push(({["kind"]:"reveal",["quote"]:"钥匙",["why"]:(await pyStr(i))}));}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(many,"accepted"),10);return pyBool(__left)?pyEqual(pyAt(many,"dropped"),[({["index"]:10,["kind"]:"reveal",["reason"]:"more than 10 findings"})]):__left})())),"tests/kernel/test_facts_warn.py:117 assert many[\"accepted\"] == 10 and many[\"dropped\"] == [{\"index\": 10, \"kind\": \"reveal\", \"reason\": \"more than 10 findings\"}]");
assert.ok(pyBool(pyEqual((await pyLen(pyAt((await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0001.json"))),"warnings"))),12)),"tests/kernel/test_facts_warn.py:118 assert len(read_json(campaign_dir(kernel.workspace) / \"turns\" / \"0001.json\")[\"warnings\"]) == 12");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_warn_anchors_quotes_as_substrings_and_drops_the_rest"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_warn_anchors_quotes_as_substrings_and_drops_the_rest(await kernel(t,{}));});
export async function test_warn_locates_a_quote_whose_quotation_marks_were_retyped(kernel:any){
let prose:any,result:any,record:any,telemetry:any;

(await open_turn(kernel));
prose="王铁柱没有回头。\n\n\"搬行李。\"这三个字在他嘴里搁了一下。\"我扛一天麻袋挣八毛。\"";
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c1","text":prose}));
result=(await warn(kernel,1,[({["kind"]:"unmarked_speech",["quote"]:"“搬行李。”这三个字在他嘴里搁了一下。",["why"]:"说出口的话没有标记"}),({["kind"]:"unmarked_speech",["quote"]:"「我扛一天麻袋挣八毛。」",["why"]:"说出口的话没有标记"}),({["kind"]:"reveal",["quote"]:"“他没有说话”",["why"]:"正文里没有这句"})]));
assert.ok(pyBool(pyEqual(pyAt(result,"accepted"),2)),"tests/kernel/test_facts_warn.py:133 assert result[\"accepted\"] == 2");
assert.ok(pyBool(pyEqual(pyAt(result,"dropped"),[({["index"]:2,["kind"]:"reveal",["reason"]:"quote is not a substring of rendered_text"})])),"tests/kernel/test_facts_warn.py:134 assert result[\"dropped\"] == [{\"index\": 2, \"kind\": \"reveal\", \"reason\": \"quote is not a substring of rendered_text\"}]");
record=(await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0001.json")));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const w of pyIterable(pyAt(record,"warnings"))){if(pyBool(true))__rows.push(pyAt(w,"quote"));}return __rows;})()),["\"搬行李。\"这三个字在他嘴里搁了一下。","\"我扛一天麻袋挣八毛。\""])),"tests/kernel/test_facts_warn.py:136 assert [w[\"quote\"] for w in record[\"warnings\"]] == ['\"搬行李。\"这三个字在他嘴里搁了一下。', '\"我扛一天麻袋挣八毛。\"']");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const w of pyIterable(pyAt(record,"warnings"))){if(pyBool(true))__rows.push(pyContains(pyAt(record,"rendered_text"),pyAt(w,"quote")));}return __rows;})())))),"tests/kernel/test_facts_warn.py:137 assert all(w[\"quote\"] in record[\"rendered_text\"] for w in record[\"warnings\"])");
telemetry=(await read_jsonl(pyDivide((await campaign_dir(kernel.workspace)),"telemetry.jsonl")));
assert.ok(pyBool(pyEqual(pyAt(pyAt(telemetry,(-1)),"unanchored"),[({["index"]:2,["kind"]:"reveal",["quote"]:"“他没有说话”"})])),"tests/kernel/test_facts_warn.py:139 assert telemetry[-1][\"unanchored\"] == [{\"index\": 2, \"kind\": \"reveal\", \"quote\": \"\\u201c他没有说话\\u201d\"}]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_warn_locates_a_quote_whose_quotation_marks_were_retyped"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_warn_locates_a_quote_whose_quotation_marks_were_retyped(await kernel(t,{}));});
export async function test_warn_files_the_verifiers_play_language_finding(kernel:any){
let finding:any,result:any,capsule:any;

(await open_turn(kernel));
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c1","text":"Knott slides the keys across the desk."}));
finding=({["kind"]:"play_language_mismatch",["quote"]:"slides the keys",["why"]:"not zh-Hans"});
result=(await warn(kernel,1,[finding]));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"accepted"),1);return pyBool(__left)?pyEqual(pyAt(result,"dropped"),[]):__left})())),"tests/kernel/test_facts_warn.py:150 assert result[\"accepted\"] == 1 and result[\"dropped\"] == []");
assert.ok(pyBool(pyEqual(pyAt(result,"warnings"),[finding])),"tests/kernel/test_facts_warn.py:151 assert result[\"warnings\"] == [finding]");
capsule=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"继续。"})),"capsule");
assert.ok(pyBool(pyEqual(pyAt(capsule,"warnings"),[({["turn"]:1,...finding})])),"tests/kernel/test_facts_warn.py:153 assert capsule[\"warnings\"] == [{\"turn\": 1, **finding}]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_warn_files_the_verifiers_play_language_finding"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_warn_files_the_verifiers_play_language_finding(await kernel(t,{}));});
export async function test_warn_files_an_investigator_identity_mismatch_without_classifying_it(kernel:any){
let finding:any,result:any,capsule:any;
(await open_turn(kernel));
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c1","text":"警员点头说：先生，已经登记好了。"}));
finding=({["kind"]:"investigator_identity_mismatch",["quote"]:"先生，已经登记好了",["why"]:"调查员身份记录与这个称呼冲突"});
result=(await warn(kernel,1,[finding]));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"accepted"),1);return pyBool(__left)?pyEqual(pyAt(result,"warnings"),[finding]):__left})())),"tests/kernel/test_facts_warn.py:161 assert result[\"accepted\"] == 1 and result[\"warnings\"] == [finding]");
capsule=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我纠正他的称呼。"})),"capsule");
assert.ok(pyBool(pyEqual(pyAt(capsule,"warnings"),[({["turn"]:1,...finding})])),"tests/kernel/test_facts_warn.py:163 assert capsule[\"warnings\"] == [{\"turn\": 1, **finding}]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_warn_files_an_investigator_identity_mismatch_without_classifying_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_warn_files_an_investigator_identity_mismatch_without_classifying_it(await kernel(t,{}));});
export async function test_warnings_reach_the_next_capsule_only_for_the_latest_committed_turn(kernel:any){
let capsule:any;
(await open_turn(kernel));
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c1","text":"诺特看着你。"}));
(await warn(kernel,1,[({["kind"]:"reveal",["quote"]:"诺特看着你",["why"]:"早了"})]));
capsule=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"继续。"})),"capsule");
assert.ok(pyBool(pyEqual(pyAt(capsule,"warnings"),[({["turn"]:1,["kind"]:"reveal",["quote"]:"诺特看着你",["why"]:"早了"})])),"tests/kernel/test_facts_warn.py:171 assert capsule[\"warnings\"] == [{\"turn\": 1, \"kind\": \"reveal\", \"quote\": \"诺特看着你\", \"why\": \"早了\"}]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"warnings"),pyAt(capsule,"warnings"))),"tests/kernel/test_facts_warn.py:172 assert kernel.table(\"capsule\")[\"warnings\"] == capsule[\"warnings\"]");
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t2-c1","text":"他点头。"}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"再来。"})),"capsule"),"warnings"),[])),"tests/kernel/test_facts_warn.py:174 assert kernel.table(\"player_input\", text=\"再来。\")[\"capsule\"][\"warnings\"] == []");
(await warn(kernel,2,[({["kind"]:"player_agency",["quote"]:"他点头",["why"]:"x"})]));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"warnings"),[({["turn"]:2,["kind"]:"player_agency",["quote"]:"他点头",["why"]:"x"})])),"tests/kernel/test_facts_warn.py:177 assert kernel.table(\"capsule\")[\"warnings\"] == [{\"turn\": 2, \"kind\": \"player_agency\", \"quote\": \"他点头\", \"why\": \"x\"}]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_warnings_reach_the_next_capsule_only_for_the_latest_committed_turn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_warnings_reach_the_next_capsule_only_for_the_latest_committed_turn(await kernel(t,{}));});

export async function test_capsule_memory_section_is_the_ranked_head_within_budget(kernel:any){
let long:any,capsule:any,hits:any;
(await open_turn(kernel));
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c1","text":"第一回合。"}));
long=pyAdd("诺特",pyMultiply("的话很长",70));
(await pyMethod(kernel,"ok",["memory.submit",({["campaign"]:CAMPAIGN,["job_id"]:"extract:c1:t1",["candidates"]:[...(await (async()=>{const __rows:any[]=[];for(const i of pyIterable((await pyRange(7)))){if(pyBool(true))__rows.push(({["kind"]:"knowledge",["subject"]:"Steven Knott",["entities"]:[INV],["statement"]:`${i}${long}`}));}return __rows;})()),({["kind"]:"world_event",["subject"]:"world",["statement"]:"w"})]})],{}));
capsule=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"继续。"})),"capsule");
hits=pyAt(capsule,"memory");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __term0=0;const __term1=(await pyLen(hits));const __term2=6;return pyCompare(__term0,__term1,"<")&&pyCompare(__term1,__term2,"<");})());return pyBool(__left)?pyContains(pyAt(capsule,"truncated"),"memory"):__left})())),"tests/kernel/test_facts_warn.py:192 assert 0 < len(hits) < 6 and \"memory\" in capsule[\"truncated\"]");
assert.ok(pyBool(pyLessEqual((await size(hits)),1536)),"tests/kernel/test_facts_warn.py:193 assert size(hits) <= 1536");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(hits,0),"id"),"mem:t1-1");return pyBool(__left)?pyEqual(pyAt(pyAt(hits,0),"kind"),"knowledge"):__left})())),"tests/kernel/test_facts_warn.py:194 assert hits[0][\"id\"] == \"mem:t1-1\" and hits[0][\"kind\"] == \"knowledge\"");
assert.ok(pyBool(pyEqual((await pySet(pyAt(hits,0))),new Set(["id","kind","subject","statement","turn","status","state","authority"]))),"tests/kernel/test_facts_warn.py:196 assert set(hits[0]) == {\"id\", \"kind\", \"subject\", \"statement\", \"turn\", \"status\", \"state\", \"authority\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory"})),"hits"),0),"subject"),"Steven Knott")),"tests/kernel/test_facts_warn.py:197 assert kernel.table(\"recall\", what=\"memory\")[\"hits\"][0][\"subject\"] == \"Steven Knott\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_capsule_memory_section_is_the_ranked_head_within_budget"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_capsule_memory_section_is_the_ranked_head_within_budget(await kernel(t,{}));});
export async function test_capsule_memory_section_takes_six_ranked_hits(kernel:any){
let capsule:any;
(await open_turn(kernel));
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c1","text":"第一回合。"}));
(await pyMethod(kernel,"ok",["memory.submit",({["campaign"]:CAMPAIGN,["job_id"]:"extract:c1:t1",["candidates"]:[({["kind"]:"world_event",["subject"]:"world",["statement"]:"w"}),...(await (async()=>{const __rows:any[]=[];for(const i of pyIterable((await pyRange(7)))){if(pyBool(true))__rows.push(({["kind"]:"knowledge",["subject"]:"Steven Knott",["entities"]:[INV],["statement"]:`短${i}`}));}return __rows;})())]})],{}));
capsule=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"继续。"})),"capsule");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const h of pyIterable(pyAt(capsule,"memory"))){if(pyBool(true))__rows.push(pyAt(h,"id"));}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const k of pyIterable((await pyRange(2,8)))){if(pyBool(true))__rows.push(`mem:t1-${k}`);}return __rows;})()))),"tests/kernel/test_facts_warn.py:209 assert [h[\"id\"] for h in capsule[\"memory\"]] == [f\"mem:t1-{k}\" for k in range(2, 8)]");
assert.ok(pyBool(!pyContains((await pyMethod(capsule,"get",["truncated",[]],{})),"memory")),"tests/kernel/test_facts_warn.py:210 assert \"memory\" not in capsule.get(\"truncated\", [])");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"memory"),pyAt(capsule,"memory"))),"tests/kernel/test_facts_warn.py:211 assert kernel.table(\"capsule\")[\"memory\"] == capsule[\"memory\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_capsule_memory_section_takes_six_ranked_hits"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_capsule_memory_section_takes_six_ranked_hits(await kernel(t,{}));});
export async function test_capsule_warnings_section_budget(kernel:any){
let text:any,quote:any,capsule:any;
(await open_turn(kernel));
text=pyAdd("诺特看着你，",pyMultiply("慢慢地说了很多很多话，",30));
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c1","text":text}));
quote=pySlice(text,undefined,100);
(await warn(kernel,1,(await (async()=>{const __rows:any[]=[];for(const _ of pyIterable((await pyRange(10)))){if(pyBool(true))__rows.push(({["kind"]:"reveal",["quote"]:quote,["why"]:pyMultiply("理由",90)}));}return __rows;})())));
capsule=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"继续。"})),"capsule");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __term0=0;const __term1=(await pyLen(pyAt(capsule,"warnings")));const __term2=10;return pyCompare(__term0,__term1,"<")&&pyCompare(__term1,__term2,"<");})());return pyBool(__left)?pyContains(pyAt(capsule,"truncated"),"warnings"):__left})())),"tests/kernel/test_facts_warn.py:221 assert 0 < len(capsule[\"warnings\"]) < 10 and \"warnings\" in capsule[\"truncated\"]");
assert.ok(pyBool(pyLessEqual((await size(pyAt(capsule,"warnings"))),1024)),"tests/kernel/test_facts_warn.py:222 assert size(capsule[\"warnings\"]) <= 1024");
assert.ok(pyBool(pyEqual(pyAt(pyAt(capsule,"warnings"),0),({["turn"]:1,["kind"]:"reveal",["quote"]:quote,["why"]:pyMultiply("理由",90)}))),"tests/kernel/test_facts_warn.py:223 assert capsule[\"warnings\"][0] == {\"turn\": 1, \"kind\": \"reveal\", \"quote\": quote, \"why\": \"理由\" * 90}");
assert.ok(pyBool(!pyContains(capsule,"resume")),"tests/kernel/test_facts_warn.py:224 assert \"resume\" not in capsule");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_capsule_warnings_section_budget"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_capsule_warnings_section_budget(await kernel(t,{}));});

export async function test_narrate_facts_carry_what_the_player_was_already_told(kernel:any){
let opening:any,result:any,public_value:any,told:any,again:any;
(await create_campaign(kernel));
opening=(await narrate_opening(kernel));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual((await pyLen(pyAt(pyAt(opening,"facts"),"public"))),1);return pyBool(__left)?(await pyMethod(pyAt(pyAt(pyAt(opening,"facts"),"public"),0),"startswith",[`Investigator: ${INV} (`],{})):__left})());return pyBool(__left)?pyContains(pyAt(pyAt(pyAt(opening,"facts"),"public"),0),"; sex: "):__left})())),pyStr(pyAt(pyAt(opening,"facts"),"public")));
(await pyMethod(kernel,"table",["player_input"],{"text":"我问诺特这房子的事。"}));
result=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c1","text":"诺特说起了马卡里奥一家。"}));
public_value=pyAt(pyAt(result,"facts"),"public");
assert.ok(pyBool((await (async()=>{const __left=(await pyMethod(pyAt(public_value,0),"startswith",[`Investigator: ${INV} (`],{}));return pyBool(__left)?pyContains(pyAt(public_value,0),"; sex: "):__left})())),"tests/kernel/test_facts_warn.py:237 assert public[0].startswith(f\"Investigator: {INV} (\") and \"; sex: \" in public[0]");
told=(await (async()=>{const __rows:any[]=[];for(const line of pyIterable(public_value)){if(pyBool((await pyMethod(line,"startswith",["Told at turn 0: "],{}))))__rows.push(line);}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=told;return pyBool(__left)?pyContains(pyAt(told,0),"诺特把钥匙拍在桌上"):__left})())),pyStr(public_value));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(pyAt(pyAt(result,"facts"),"keeper_only"))){if(pyBool(true))__rows.push((await pyMethod(line,"startswith",["Undiscovered clue: knott-keys -- "],{})));}return __rows;})())))),"tests/kernel/test_facts_warn.py:241 assert any(line.startswith(\"Undiscovered clue: knott-keys -- \") for line in result[\"facts\"][\"keeper_only\"])");
assert.ok(pyBool(pyLessEqual((await size(public_value)),2048)),"tests/kernel/test_facts_warn.py:242 assert size(public) <= 2048");
(await pyMethod(kernel,"table",["player_input"],{"text":"我再问一句。"}));
again=pyAt(pyAt((await pyMethod(kernel,"table",["narrate"],{"call_id":"t2-c1","text":"诺特叹了口气。"})),"facts"),"public");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(again)){if(pyBool((await pyMethod(line,"startswith",["Told at turn"],{}))))__rows.push(pySlice(line,undefined,15));}return __rows;})()),["Told at turn 0:","Told at turn 1:"])),"tests/kernel/test_facts_warn.py:246 assert [line[:15] for line in again if line.startswith(\"Told at turn\")] == [\"Told at turn 0:\", \"Told at turn 1:\"]");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const line of pyIterable(again)){if(pyBool(true))__rows.push(pyContains(line,"诺特说起了马卡里奥一家"));}return __rows;})())))),"tests/kernel/test_facts_warn.py:247 assert any(\"诺特说起了马卡里奥一家\" in line for line in again)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_narrate_facts_carry_what_the_player_was_already_told"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_narrate_facts_carry_what_the_player_was_already_told(await kernel(t,{}));});
