import {globSync,statSync,readFileSync} from "node:fs";
import {join} from "node:path";
// Migrated from tests/kernel/test_system_language.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {ordinaryMechanics} from './npc-support.ts';
import {CAMPAIGN,MODULE,PREGEN,WORKTREE,open_turn,written,pyObjectFromEntries,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./setup-native-support.ts";






export let GUARDED_DIRS:any=["kernel-ts","content/setup","content/compat"];

export let GUARDED_FILES:any=["mods/narration-craft/style.json","mods/narration-craft/voice-lane.md"];
export let GUARDED_GLOBS:any=["bin/coc-*"];
export let SKIP_PARTS:any=new Set(["__pycache__",".pytest_cache"]);
export let CJK:any=(await pyMethod(re,"compile",["["+"⺀-⿟"+"　-〿"+"぀-ヿ"+"㄀-ㇿ"+"㈀-㏿"+"㐀-䶿"+"一-鿿"+"가-힯"+"豈-﫿"+"︰-﹏"+"＀-￯"+"𠀀-𱍏"+"]"],{}));
export async function guarded_files(){
 const paths:string[]=[];
 for(const directory of GUARDED_DIRS){for(const p of globSync(directory+'/**/*',{cwd:String(WORKTREE)})){if(directory==='kernel-ts'&&!p.endsWith('.ts'))continue;if(p.split('/').some(part=>SKIP_PARTS.has(part)))continue;if(statSync(join(String(WORKTREE),p)).isFile())paths.push(join(String(WORKTREE),p));}}
 paths.push(...GUARDED_FILES.map((p:string)=>join(String(WORKTREE),p)));
 for(const pattern of GUARDED_GLOBS)paths.push(...globSync(pattern,{cwd:String(WORKTREE)}).map(p=>join(String(WORKTREE),p)));
 return paths.sort().map(Path);
}
export async function test_no_cjk_character_anywhere_in_code_or_system_content(){
let hits:any,files:any,path:any,text:any,number:any,line:any;
hits=[];
files=(await guarded_files());
assert.ok(pyBool((await (async()=>{const __left=(await pyAny((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(files)){__rows.push(pyEqual(p.name,"handlers.ts"));}return __rows;})())));return pyBool(__left)?(await pyAny((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(files)){__rows.push((await (async()=>{const __left=pyEqual(p.parent.name,"visual-reader");return pyBool(__left)?pyEqual(p.name,"common.md"):__left;})()));}return __rows;})()))):__left;})())),"tests/kernel/test_system_language.py:60 assert any(p.name == \"handlers.ts\" for p in files) and any(p.parent.name == \"visual-reader\" and p.name == \"common.md\" for p in files)");
assert.ok(pyBool((await (async()=>{const __left=(await pyAny((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(files)){__rows.push(pyEqual(p.name,"coc-source"));}return __rows;})())));return pyBool(__left)?(await pyAny((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(files)){__rows.push(pyEqual(p.name,"style.json"));}return __rows;})()))):__left;})())),"tests/kernel/test_system_language.py:61 assert any(p.name == \"coc-source\" for p in files) and any(p.name == \"style.json\" for p in files)");
for(path of pyIterable(files)){
try{text=new TextDecoder("utf-8",{fatal:true}).decode(readFileSync(String(path)));}catch(error){if(error instanceof TypeError)continue;throw error;}
for([number,line] of pyIterable((await pyEnumerate((await pyMethod(text,"splitlines",[],{})),({"start":1}))))){
if(pyBool((await pyMethod(CJK,"search",[line],{})))){(await pyMethod(hits,"append",[`${(await pyMethod(path,"relative_to",[WORKTREE],{}))}:${number}: ${pySlice((await pyMethod(line,"strip",[],{})),undefined,80)}`],{}));}
}
}
assert.ok(pyBool(!pyBool(hits)),pyStr(pyAdd("CJK characters in code or system content (§16.1):\n",(await pyMethod("\n","join",[pySlice(hits,undefined,40)],{})))));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_no_cjk_character_anywhere_in_code_or_system_content"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_no_cjk_character_anywhere_in_code_or_system_content();});
export async function test_a_zh_hans_turn_is_delivered_verbatim_with_every_receipt_projected(kernel:any){
let status:any,receipts:any,roll:any,dice:any,delta:any,text:any,result:any,mechanics:any,line:any;
(await open_turn(kernel,"我翻看桌上的文件，然后去档案馆。"));
(await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c1","action":({["intent"]:"investigate",["goal"]:"找线索",["method"]:"翻找",["skill"]:"Spot Hidden"})}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"clue",["clue"]:"knott-keys",["label"]:"钥匙"}),({["kind"]:"time",["minutes"]:15,["beyond_travel"]:true}),({["kind"]:"item",["name"]:"温彻斯特霰弹枪",["quantity"]:1}),({["kind"]:"damage",["dice"]:"1D3",["why"]:"被抽屉夹了"}),({["kind"]:"move",["to"]:"hall-of-records",["travel_minutes"]:20,["label"]:"档案馆"})]}));
status=(await pyMethod(kernel,"table",["status"],{}));
receipts=pyObjectFromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await written(pyAt(status,"receipts"))))){__rows.push([pyAdd(pyAt(r,"kind"),((pyBool(pyEqual((await pyMethod(r,"get",["form"],{})),"dice"))?"-dice":""))),r]);}return __rows;})()));
const __unpack4125=[pyAt(receipts,"roll"),pyAt(receipts,"roll-dice"),pyAt(receipts,"delta")];roll=__unpack4125[0];dice=__unpack4125[1];delta=__unpack4125[2];
assert.equal(pyAt(pyAt(receipts,"move"),"from_label"),"Knott's Office","raw movement receipts retain the Keeper heading");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const m of pyIterable(ordinaryMechanics(pyAt(status,"mechanics"),pyAt(status,"receipts")))){__rows.push(pyAt(m,"kind"));}return __rows;})()),["roll","clue","time","item","dice","change","scene"])),"tests/kernel/test_system_language.py:88 assert [m[\"kind\"] for m in status[\"mechanics\"]] == [\"roll\", \"clue\", \"time\", \"item\", \"dice\", \"change\", \"scene\"]");
text=(`你翻了翻文件，掷出 ${pyAt(roll,"roll")}，侦查 ${pyAt(roll,"target")}。抽屉夹了你的手，伤害 ${pyAt(dice,"total")}，`+`生命值从 ${pyAt(delta,"before")} 掉到 ${pyAt(delta,"after")}。一刻钟（15 分钟）后你带着钥匙和一把霰弹枪去了档案馆。`);
result=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":text}));
assert.ok(pyBool(pyEqual(pyAt(result,"rendered_text"),text)),"tests/kernel/test_system_language.py:93 assert result[\"rendered_text\"] == text");
assert.ok(pyBool(!pyContains(pyAt(result,"rendered_text"),"【")),"tests/kernel/test_system_language.py:94 assert \"【\" not in result[\"rendered_text\"]");
mechanics=ordinaryMechanics(pyAt(result,"mechanics"),pyAt(status,"receipts"));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const m of pyIterable(pyAt(result,"mechanics"))){__rows.push(pyAt(m,"receipt"));}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(status,"receipts"))){__rows.push(pyAt(r,"id"));}return __rows;})()))),"tests/kernel/test_system_language.py:96 assert [m[\"receipt\"] for m in mechanics] == [r[\"id\"] for r in status[\"receipts\"]]");
assert.ok(pyBool(pyEqual(pyAt(mechanics,0),({["kind"]:"roll",["marker"]:"check:spot-hidden",["receipt"]:pyAt(roll,"id"),["actor"]:"thomas-hayes",["skill"]:"Spot Hidden",["actor_label"]:"托马斯·海斯",["actor_is_investigator"]:true,["roll"]:pyAt(roll,"roll"),["target"]:pyAt(roll,"target"),["threshold"]:pyAt(roll,"threshold"),["difficulty"]:"regular",["level"]:pyAt(roll,"level"),["passed"]:pyAt(roll,"passed"),["pushed"]:false,["bonus"]:0,["penalty"]:0,["visibility"]:"public",["call"]:"t1-c1",["family"]:"core-check"}))),"tests/kernel/test_system_language.py:97 assert mechanics[0] == {\"kind\": \"roll\", \"marker\": \"check:spot-hidden\", \"receipt\": roll[\"id\"], \"actor\": \"thomas-hayes\", \"skill\": \"Spot Hidden\",\n                            \"actor_label\": \"托马斯·海斯\", \"actor_is_investigator\": True,\n                            \"roll\": roll[\"roll\"], \"target\": roll[\"target\"], \"threshold\": roll[\"threshold\"],\n                            \"difficulty\": \"regular\", \"level\": roll[\"level\"], \"passed\": roll[\"passed\"], \"pushed\": False,\n                            \"bonus\": 0, \"penalty\": 0,\n                            \"visibility\": \"public\", \"call\": \"t1-c1\", \"family\": \"core-check\"}");
assert.ok(pyBool(pyEqual(pyAt(mechanics,1),({["kind"]:"clue",["marker"]:"clue:knott-keys",["receipt"]:"clue:knott-keys-t1",["clue"]:"knott-keys",["label"]:"钥匙",["call"]:"t1-c2"}))),"tests/kernel/test_system_language.py:103 assert mechanics[1] == {\"kind\": \"clue\", \"marker\": \"clue:knott-keys\", \"receipt\": \"clue:knott-keys-t1\", \"clue\": \"knott-keys\", \"label\": \"钥匙\",\n                            \"call\": \"t1-c2\"}");
assert.ok(pyBool(pyEqual(pyAt(mechanics,2),({["kind"]:"time",["marker"]:"time",["receipt"]:"time:t1-c2",["minutes"]:15,["call"]:"t1-c2"}))),"tests/kernel/test_system_language.py:105 assert mechanics[2] == {\"kind\": \"time\", \"marker\": \"time\", \"receipt\": \"time:t1-c2\", \"minutes\": 15, \"call\": \"t1-c2\"}");
assert.ok(pyBool(pyEqual(pyAt(mechanics,3),({["kind"]:"item",["marker"]:"item",["receipt"]:"item:t1-c2",["name"]:"温彻斯特霰弹枪",["quantity"]:1,["to"]:"thomas-hayes",["label"]:"温彻斯特霰弹枪",["to_label"]:"托马斯·海斯",["call"]:"t1-c2"}))),"tests/kernel/test_system_language.py:106 assert mechanics[3] == {\"kind\": \"item\", \"marker\": \"item\", \"receipt\": \"item:t1-c2\", \"name\": \"温彻斯特霰弹枪\", \"quantity\": 1,\n                            \"to\": \"thomas-hayes\", \"label\": \"温彻斯特霰弹枪\", \"to_label\": \"托马斯·海斯\", \"call\": \"t1-c2\"}");
assert.ok(pyBool(pyEqual(pyAt(mechanics,4),({["kind"]:"dice",["marker"]:"dice:damage",["receipt"]:pyAt(dice,"id"),["actor"]:"thomas-hayes",["label"]:"damage",["actor_label"]:"托马斯·海斯",["actor_is_investigator"]:true,["expression"]:"1D3",["faces"]:pyAt(dice,"faces"),["total"]:pyAt(dice,"total"),["visibility"]:"public",["call"]:"t1-c2"}))),"tests/kernel/test_system_language.py:108 assert mechanics[4] == {\"kind\": \"dice\", \"marker\": \"dice:damage\", \"receipt\": dice[\"id\"], \"actor\": \"thomas-hayes\", \"label\": \"damage\",\n                            \"actor_label\": \"托马斯·海斯\", \"actor_is_investigator\": True,\n                            \"expression\": \"1D3\", \"faces\": dice[\"faces\"], \"total\": dice[\"total\"], \"visibility\": \"public\",\n                            \"call\": \"t1-c2\"}");
assert.ok(pyBool(pyEqual(pyAt(mechanics,5),({["kind"]:"change",["marker"]:"change:hp",["receipt"]:pyAt(delta,"id"),["resource"]:"hp",["subject"]:"thomas-hayes",["before"]:pyAt(delta,"before"),["after"]:pyAt(delta,"after"),["subject_label"]:"托马斯·海斯",["subject_is_investigator"]:true,["call"]:"t1-c2"}))),"tests/kernel/test_system_language.py:112 assert mechanics[5] == {\"kind\": \"change\", \"marker\": \"change:hp\", \"receipt\": delta[\"id\"], \"resource\": \"hp\", \"subject\": \"thomas-hayes\",\n                            \"before\": delta[\"before\"], \"after\": delta[\"after\"], \"subject_label\": \"托马斯·海斯\",\n                            \"subject_is_investigator\": True, \"call\": \"t1-c2\"}");
assert.ok(pyBool(pyEqual(pyAt(mechanics,6),({["kind"]:"scene",["marker"]:"scene:hall-of-records",["receipt"]:"move:hall-of-records-t1-c2",["from"]:"commission-briefing",["to"]:"hall-of-records",["minutes"]:20,["from_label"]:"Scene",["to_label"]:"档案馆",["call"]:"t1-c2"}))),"tests/kernel/test_system_language.py:115 assert mechanics[6] == {\"kind\": \"scene\", \"marker\": \"scene:hall-of-records\", \"receipt\": \"move:hall-of-records-t1-c2\", \"from\": \"commission-briefing\",\n                            \"to\": \"hall-of-records\", \"minutes\": 20, \"from_label\": \"Knott's Office\", \"to_label\": \"档案馆\",\n                            \"call\": \"t1-c2\"}");
for(line of pyIterable(pyAdd(pySlice(pyAt(pyAt(result,"facts"),"committed"),1,undefined),pyAt(pyAt(result,"facts"),"keeper_only")))){
assert.ok(pyBool(!pyBool((await pyMethod(CJK,"search",[(await pyMethod((await pyMethod((await pyMethod((await pyMethod(line,"replace",["托马斯·海斯",""],{})),"replace",["钥匙",""],{})),"replace",["温彻斯特霰弹枪",""],{})),"replace",["档案馆",""],{}))],{})))),pyStr(line));
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_zh_hans_turn_is_delivered_verbatim_with_every_receipt_projected"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_zh_hans_turn_is_delivered_verbatim_with_every_receipt_projected(await kernel(t,{}));});
export async function test_story_is_separate_from_roll_and_clock_json(kernel:any){
let done:any;
(await open_turn(kernel));
(await pyMethod(kernel,"table",["resolve"],{"call_id":"t1-c1","action":({["intent"]:"investigate",["goal"]:"x",["method"]:"y",["skill"]:"Spot Hidden"})}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"time",["minutes"]:10})]}));
done=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":"你收起了笔记，走回门边。"}));
assert.ok(pyBool(pyEqual(pyAt(done,"rendered_text"),"你收起了笔记，走回门边。")),"tests/kernel/test_system_language.py:130 assert done[\"rendered_text\"] == \"你收起了笔记，走回门边。\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(done,"mechanics"))){__rows.push(pyAt(row,"kind"));}return __rows;})()),["roll","time"])),"tests/kernel/test_system_language.py:131 assert [row[\"kind\"] for row in done[\"mechanics\"]] == [\"roll\", \"time\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(done,"mechanics"),1),"minutes"),10)),"tests/kernel/test_system_language.py:132 assert done[\"mechanics\"][1][\"minutes\"] == 10");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_story_is_separate_from_roll_and_clock_json"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_story_is_separate_from_roll_and_clock_json(await kernel(t,{}));});
export async function test_no_player_facing_field_is_refused_by_its_script(kernel:any){
let text:any,prose:any,asked:any;

(await open_turn(kernel));
text="The Scene is quiet. The Keeper waits.";
prose=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c1","text":text}));
assert.ok(pyBool(pyEqual(pyAt(prose,"rendered_text"),text)),"tests/kernel/test_system_language.py:141 assert prose[\"rendered_text\"] == text");
(await pyMethod(kernel,"table",["player_input"],{"text":"我四处看看。"}));
asked=(await pyMethod(kernel,"table",["ask"],{"call_id":"t2-c1","prompt":"What does the Investigator do?","options":["Look around","离开"]}));
assert.ok(pyBool(pyEqual(pyAt(asked,"state"),"asked")),"tests/kernel/test_system_language.py:144 assert asked[\"state\"] == \"asked\"");
assert.ok(pyBool(pyEqual(pyAt(asked,"rendered_text"),"")),"tests/kernel/test_system_language.py:145 assert asked[\"rendered_text\"] == \"\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(asked,"interaction"),"options"),["Look around","离开"])),"tests/kernel/test_system_language.py:146 assert asked[\"interaction\"][\"options\"] == [\"Look around\", \"离开\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_no_player_facing_field_is_refused_by_its_script"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_no_player_facing_field_is_refused_by_its_script(await kernel(t,{}));});
export async function test_any_tag_shaped_play_language_opens_a_table_and_a_malformed_one_names_the_shape(kernel:any){
let error:any,asked:any;
error=(await pyMethod(kernel,"err",["campaign.create",({["id"]:CAMPAIGN,["module"]:MODULE,["pregen"]:PREGEN,["play_language"]:"Not A Tag"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"field"),"play_language"):__left;})())),"tests/kernel/test_system_language.py:151 assert error[\"code\"] == \"invalid_params\" and error[\"details\"][\"field\"] == \"play_language\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"suggested"),pyAt((await pyMethod(json,"loads",[(await pyMethod((pyDivide(WORKTREE,"content/languages.json")),"read_text",[],{}))],{})),"suggested"))),"tests/kernel/test_system_language.py:152 assert error[\"details\"][\"suggested\"] == json.loads((WORKTREE / \"content/languages.json\").read_text())[\"suggested\"]");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(pyAt(error,"details"),"options");return pyBool(__left)?pyContains(pyAt(error,"fix"),"BCP-47"):__left;})())),"tests/kernel/test_system_language.py:153 assert \"options\" not in error[\"details\"] and \"BCP-47\" in error[\"fix\"]");
(await pyMethod(kernel,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:MODULE,["pregen"]:PREGEN,["play_language"]:"pt-BR"})],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["view"],{})),"play_language"),"pt-BR")),"tests/kernel/test_system_language.py:156 assert kernel.table(\"view\")[\"play_language\"] == \"pt-BR\"");
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t0-c1","text":"Boston, 1920. Knott sets a key on the desk. 钥匙。"}));
(await pyMethod(kernel,"table",["player_input"],{"text":"I look around."}));
asked=(await pyMethod(kernel,"table",["ask"],{"call_id":"t1-c1","prompt":"What do you do?","options":["Search the desk","离开"]}));
assert.ok(pyBool(pyEqual(pyAt(asked,"state"),"asked")),"tests/kernel/test_system_language.py:161 assert asked[\"state\"] == \"asked\"");
assert.ok(pyBool(pyEqual(pyAt(asked,"rendered_text"),"")),"tests/kernel/test_system_language.py:162 assert asked[\"rendered_text\"] == \"\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(asked,"interaction"),"options"),["Search the desk","离开"])),"tests/kernel/test_system_language.py:163 assert asked[\"interaction\"][\"options\"] == [\"Search the desk\", \"离开\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_any_tag_shaped_play_language_opens_a_table_and_a_malformed_one_names_the_shape"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_any_tag_shaped_play_language_opens_a_table_and_a_malformed_one_names_the_shape(await kernel(t,{}));});
