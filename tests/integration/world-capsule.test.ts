// Migrated from tests/kernel/test_capsule.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {narrate,OPENING_SCENE,PREGEN,campaign_dir,open_turn,read_json,OPENING_SCENE as _OPENING,campaign_dir as _dir,open_turn as _open_turn,read_json as _read,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_capsule.py',import.meta.url).pathname;


export let BUDGETS:any=({["where"]:4096,["present"]:3072,["known"]:3072,["recent"]:2048});
export async function size(payload:any){
return (await pyInvoke(pyLen,[(await pyMethod((await pyMethod(json,"dumps",[payload],{"ensure_ascii":false})),"encode",["utf-8"],{}))],{}));
}
Object.defineProperty(size,"__pySignature",{value:[{"name":"payload","rest":false,"varargs":false}]});
export async function test_player_input_capsule_has_all_sections(kernel:any){
let result:any,capsule:any,where:any,exits:any,affordances:any,present:any,knott:any,known:any,clues:any,investigator:any,reading:any,name:any,budget:any,refreshed:any;
result=(await pyInvoke(open_turn,[kernel,"我仔细观察诺特。"],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"turn"),1);return pyBool(__left)?pyEqual(pyAt(result,"state"),"open"):__left})())),"tests/kernel/test_capsule.py:14 assert result[\"turn\"] == 1 and result[\"state\"] == \"open\"");
capsule=pyAt(result,"capsule");
assert.ok(pyBool(pyEqual(pyAt(capsule,"turn"),({["number"]:1,["state"]:"open",["pending_choice"]:null,["player_text"]:"我仔细观察诺特。"}))),"tests/kernel/test_capsule.py:16 assert capsule[\"turn\"] == {\"number\": 1, \"state\": \"open\", \"pending_choice\": None,\n                               \"player_text\": \"我仔细观察诺特。\"}");
where=pyAt(capsule,"where");
assert.ok(pyBool(pyEqual(pyAt(where,"scene"),OPENING_SCENE)),"tests/kernel/test_capsule.py:20 assert where[\"scene\"] == OPENING_SCENE");
assert.ok(pyBool(pyEqual(pyAt(where,"display_name"),"Knott's Office")),"tests/kernel/test_capsule.py:21 assert where[\"display_name\"] == \"Knott's Office\"");
assert.ok(pyBool(pyAt(where,"dramatic_question")),"tests/kernel/test_capsule.py:22 assert where[\"dramatic_question\"]");
assert.ok(pyBool(pyAt(where,"pressure_moves")),"tests/kernel/test_capsule.py:23 assert where[\"pressure_moves\"]");
exits=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(where,"exits"))){__rows.push([pyAt(e,"to"),e]);}return __rows;})()));
assert.ok(pyBool(pyContains(exits,"hall-of-records")),"tests/kernel/test_capsule.py:25 assert \"hall-of-records\" in exits");
assert.ok(pyBool(pyEqual(pyAt(pyAt(exits,"hall-of-records"),"unlock_when"),({["condition"]:"clue_discovered: knott-research-leads",["met"]:false}))),"tests/kernel/test_capsule.py:27 assert exits[\"hall-of-records\"][\"unlock_when\"] == {\"condition\": \"clue_discovered: knott-research-leads\", \"met\": False}");
affordances=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(pyAt(where,"affordances"))){__rows.push([pyAt(a,"id"),a]);}return __rows;})()));
assert.ok(pyBool(pyEqual(pyAt(pyAt(affordances,"confirm-commission-terms"),"clue"),"knott-commission")),"tests/kernel/test_capsule.py:29 assert affordances[\"confirm-commission-terms\"][\"clue\"] == \"knott-commission\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(affordances,"confirm-commission-terms"),"npc"),"Steven Knott")),"tests/kernel/test_capsule.py:30 assert affordances[\"confirm-commission-terms\"][\"npc\"] == \"Steven Knott\"");
assert.ok(pyBool(pyAt(where,"keeper_notes")),"tests/kernel/test_capsule.py:31 assert where[\"keeper_notes\"]");
assert.ok(pyBool(pyEqual(pyAt(where,"assets"),[({["name"]:"Handout 1: Mr. Knott's Commission",["kind"]:"handout"})])),"tests/kernel/test_capsule.py:32 assert where[\"assets\"] == [{\"name\": \"Handout 1: Mr. Knott's Commission\", \"kind\": \"handout\"}]");
present=pyAt(capsule,"present");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(present)){__rows.push(pyAt(p,"name"));}return __rows;})()),["Steven Knott"])),"tests/kernel/test_capsule.py:35 assert [p[\"name\"] for p in present] == [\"Steven Knott\"]");
knott=pyAt(present,0);
assert.ok(pyBool(pyEqual(pyAt(knott,"role"),"employer")),"tests/kernel/test_capsule.py:38 assert knott[\"role\"] == \"employer\"");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(await (async()=>{const __left=pyAt(knott,"wants");return pyBool(__left)?pyAt(knott,"voice"):__left})());return pyBool(__left)?pyAt(knott,"fears"):__left})());return pyBool(__left)?pyAt(knott,"hides"):__left})())),"tests/kernel/test_capsule.py:39 assert knott[\"wants\"] and knott[\"voice\"] and knott[\"fears\"] and knott[\"hides\"]");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const f of pyIterable(pyAt(knott,"knows"))){__rows.push(pyAt(f,"clue"));}return __rows;})())),new Set(["knott-commission","knott-research-leads","knott-macario-summary"]))),"tests/kernel/test_capsule.py:40 assert {f[\"clue\"] for f in knott[\"knows\"]} == {\"knott-commission\", \"knott-research-leads\",\n                                                    \"knott-macario-summary\"}");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const f of pyIterable(pyAt(knott,"knows"))){__rows.push((pyAt(f,"discovered")===false));}return __rows;})())))),"tests/kernel/test_capsule.py:42 assert all(f[\"discovered\"] is False for f in knott[\"knows\"])");
assert.ok(pyBool(pyEqual(pyAt(knott,"history"),({["met_turns"]:1,["last_turn"]:0}))),"tests/kernel/test_capsule.py:45 assert knott[\"history\"] == {\"met_turns\": 1, \"last_turn\": 0}");
assert.ok(pyBool(!pyContains(knott,"toward_party")),"tests/kernel/test_capsule.py:46 assert \"toward_party\" not in knott");
known=pyAt(capsule,"known");
assert.ok(pyBool(pyEqual(pyAt(known,"discovered_clues"),[])),"tests/kernel/test_capsule.py:49 assert known[\"discovered_clues\"] == []");
clues=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(known,"clues_here"))){__rows.push([pyAt(c,"name"),c]);}return __rows;})()));
assert.ok(pyBool(pyEqual(pyAt(pyAt(clues,"knott-commission"),"delivery_kind"),"npc_dialogue")),"tests/kernel/test_capsule.py:51 assert clues[\"knott-commission\"][\"delivery_kind\"] == \"npc_dialogue\"");
assert.ok(pyBool((pyAt(pyAt(clues,"knott-commission"),"discovered")===false)),"tests/kernel/test_capsule.py:52 assert clues[\"knott-commission\"][\"discovered\"] is False");
investigator=pyAt(known,"investigator");
assert.ok(pyBool(pyEqual(pyAt(investigator,"id"),PREGEN)),"tests/kernel/test_capsule.py:54 assert investigator[\"id\"] == PREGEN");
assert.ok(pyBool(pyEqual(pyAt(investigator,"sex"),"M")),pyStr("the keeper reads the sheet's sex, never a guess from the name"));
assert.ok(pyBool(pyEqual(pyAt(investigator,"age"),34)),"tests/kernel/test_capsule.py:56 assert investigator[\"age\"] == 34");
assert.ok(pyBool(!pyContains(investigator,"appearance")),pyStr("this pregen writes no description and the capsule invents none"));
assert.ok(pyBool(pyContains(pyAt(investigator,"skills_of_note"),({["name"]:"Spot Hidden",["value"]:55}))),"tests/kernel/test_capsule.py:58 assert {\"name\": \"Spot Hidden\", \"value\": 55} in investigator[\"skills_of_note\"]");
assert.ok(pyBool(pyEqual(pyAt(capsule,"recent"),[({["turn"]:0,["player"]:null,["keeper"]:"开场。\n\n诺特把钥匙拍在桌上。",["closed"]:"explicit",["receipts"]:0})])),"tests/kernel/test_capsule.py:61 assert capsule[\"recent\"] == [{\"turn\": 0, \"player\": None, \"keeper\": \"开场。\\n\\n诺特把钥匙拍在桌上。\", \"closed\": \"explicit\", \"receipts\": 0}]");
reading=pyAt(capsule,"reading");
assert.ok(pyBool((pyAt(reading,"index_complete")===true)),"tests/kernel/test_capsule.py:65 assert reading[\"index_complete\"] is True");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(reading,"sections"),0),"name"),"Knott's Office")),"tests/kernel/test_capsule.py:66 assert reading[\"sections\"][0][\"name\"] == \"Knott's Office\"");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const section of pyIterable(pyAt(reading,"sections"))){__rows.push(pyAt(section,"read"));}return __rows;})())))),"tests/kernel/test_capsule.py:67 assert all(section[\"read\"] for section in reading[\"sections\"])");
assert.ok(pyBool(pyEqual((await pyMethod(capsule,"get",["truncated",[]],{})),["reading","module"])),"tests/kernel/test_capsule.py:69 assert capsule.get(\"truncated\", []) == [\"reading\", \"module\"]");
for([name,budget] of pyIterable((await pyMethod(BUDGETS,"items",[],{})))){
assert.ok(pyBool(pyLessEqual((await pyInvoke(size,[pyAt(capsule,name)],{})),budget)),pyStr(name));
}
refreshed=(await pyMethod(kernel,"table",["capsule"],{}));
assert.ok(pyBool(pyEqual((await pyMethod(refreshed,"pop",["_context"],{})),pyAt(result,"_context"))),"tests/kernel/test_capsule.py:74 assert refreshed.pop(\"_context\") == result[\"_context\"]");
assert.ok(pyBool(pyEqual(refreshed,capsule)),"tests/kernel/test_capsule.py:75 assert refreshed == capsule");
}
Object.defineProperty(test_player_input_capsule_has_all_sections,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_player_input_capsule_has_all_sections"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_player_input_capsule_has_all_sections(await kernel(t,{}));});
export async function test_the_appearance_the_player_wrote_reaches_the_keeper_bounded(kernel:any){
let path:any,sheet:any,written:any,rows:any,known:any,appearance:any;

(await pyInvoke(open_turn,[kernel],{}));
path=pyDivide(pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"party"),`${PREGEN}.json`);
sheet=(await pyInvoke(read_json,[path],{}));
written="瘦高个，穿一件洗白的风衣，右手总插在口袋里。";
pyAt(sheet,"backstory")["personal_description"]=written;
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[sheet],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"known"),"investigator"),"appearance"),written)),"tests/kernel/test_capsule.py:87 assert kernel.table(\"capsule\")[\"known\"][\"investigator\"][\"appearance\"] == written");
rows=(await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"known"),"clues_here"))){__rows.push(pyAt(c,"name"));}return __rows;})());
pyAt(sheet,"backstory")["personal_description"]=pyMultiply(written,20);
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[sheet],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
known=pyAt((await pyMethod(kernel,"table",["capsule"],{})),"known");
appearance=pyAt(pyAt(known,"investigator"),"appearance");
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyInvoke(pyLen,[appearance],{})),200);return pyBool(__left)?pyEqual(appearance,pySlice((pyMultiply(written,20)),undefined,200)):__left})())),"tests/kernel/test_capsule.py:96 assert len(appearance) == 200 and appearance == (written * 20)[:200]");
assert.ok(pyBool((await (async()=>{const __left=pyLessEqual((await pyInvoke(size,[known],{})),pyAt(BUDGETS,"known"));return pyBool(__left)?pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(known,"clues_here"))){__rows.push(pyAt(c,"name"));}return __rows;})()),rows):__left})())),"tests/kernel/test_capsule.py:97 assert size(known) <= BUDGETS[\"known\"] and [c[\"name\"] for c in known[\"clues_here\"]] == rows");
}
Object.defineProperty(test_the_appearance_the_player_wrote_reaches_the_keeper_bounded,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_appearance_the_player_wrote_reaches_the_keeper_bounded"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_appearance_the_player_wrote_reaches_the_keeper_bounded(await kernel(t,{}));});
export async function test_look_focus_variants(kernel:any){
let scene:any,npc:any,key:any,investigator:any,clues:any,error:any;
(await pyInvoke(open_turn,[kernel],{}));
scene=(await pyMethod(kernel,"table",["look"],{}));
assert.ok(pyBool(pyEqual((await pyInvoke(pySet,[scene],{})),new Set(["where","present","roster","establish"]))),"tests/kernel/test_capsule.py:106 assert set(scene) == {\"where\", \"present\", \"roster\", \"establish\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(scene,"establish"),"place"),"id"),OPENING_SCENE)),"tests/kernel/test_capsule.py:107 assert scene[\"establish\"][\"place\"][\"id\"] == OPENING_SCENE");
assert.ok(pyBool(pyEqual(pyAt(scene,"roster"),[])),"tests/kernel/test_capsule.py:108 assert scene[\"roster\"] == []");
assert.ok(pyBool(pyEqual(scene,(await pyMethod(kernel,"table",["look"],{"focus":"scene"})))),"tests/kernel/test_capsule.py:109 assert scene == kernel.table(\"look\", focus=\"scene\")");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"state"),"acting")),"tests/kernel/test_capsule.py:110 assert kernel.table(\"status\")[\"state\"] == \"acting\"");
npc=(await pyMethod(kernel,"table",["look"],{"focus":"npc","name":"Steven Knott"}));
assert.ok(pyBool(pyEqual(pyAt(npc,"kind"),"npc")),"tests/kernel/test_capsule.py:113 assert npc[\"kind\"] == \"npc\"");
assert.ok(pyBool(pyEqual(pyAt(npc,"id"),"steven-knott")),"tests/kernel/test_capsule.py:114 assert npc[\"id\"] == \"steven-knott\"");
assert.ok(pyBool(pyEqual(pyAt(npc,"scene"),OPENING_SCENE)),"tests/kernel/test_capsule.py:115 assert npc[\"scene\"] == OPENING_SCENE");
for(key of pyIterable(["wants","fears","hides","voice","role","keeper_note","social_role","knows"])){
assert.ok(pyBool(pyAt(npc,key)),pyStr(key));
}
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(npc,"ledger"),"turns_present"),"count"),1)),"tests/kernel/test_capsule.py:119 assert npc[\"ledger\"][\"turns_present\"][\"count\"] == 1");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(npc,"ledger"),"stance")===null);return pyBool(__left)?pyEqual(pyAt(pyAt(npc,"ledger"),"interactions"),[]):__left})())),"tests/kernel/test_capsule.py:120 assert npc[\"ledger\"][\"stance\"] is None and npc[\"ledger\"][\"interactions\"] == []");
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":"steven-knott"})),npc)),"tests/kernel/test_capsule.py:121 assert kernel.table(\"look\", focus=\"npc\", name=\"steven-knott\") == npc");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc"})),"present"),0),"name"),"Steven Knott")),"tests/kernel/test_capsule.py:122 assert kernel.table(\"look\", focus=\"npc\")[\"present\"][0][\"name\"] == \"Steven Knott\"");
investigator=(await pyMethod(kernel,"table",["look"],{"focus":"investigator"}));
assert.ok(pyBool(pyEqual(pyAt(investigator,"kind"),"investigator")),"tests/kernel/test_capsule.py:125 assert investigator[\"kind\"] == \"investigator\"");
assert.ok(pyBool(pyEqual(pyAt(investigator,"name"),"托马斯·海斯")),"tests/kernel/test_capsule.py:126 assert investigator[\"name\"] == \"托马斯·海斯\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(investigator,"skills"),"Spot Hidden"),55)),"tests/kernel/test_capsule.py:127 assert investigator[\"skills\"][\"Spot Hidden\"] == 55");
assert.ok(pyBool(pyEqual([pyAt(investigator,"hp"),pyAt(investigator,"san"),pyAt(investigator,"mp"),pyAt(investigator,"luck")],[12,55,11,50])),"tests/kernel/test_capsule.py:128 assert (investigator[\"hp\"], investigator[\"san\"], investigator[\"mp\"], investigator[\"luck\"]) == (12, 55, 11, 50)");
assert.ok(pyBool(!pyContains(investigator,"notes")),"tests/kernel/test_capsule.py:129 assert \"notes\" not in investigator");
clues=(await pyMethod(kernel,"table",["look"],{"focus":"clues"}));
assert.ok(pyBool(pyEqual(pyAt(clues,"discovered_clues"),[])),"tests/kernel/test_capsule.py:132 assert clues[\"discovered_clues\"] == []");
assert.ok(pyBool(pyLessEqual(new Set(["knott-commission","knott-keys"]),new Set((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(clues,"clues_here"))){__rows.push(pyAt(c,"name"));}return __rows;})())))),"tests/kernel/test_capsule.py:133 assert {c[\"name\"] for c in clues[\"clues_here\"]} >= {\"knott-commission\", \"knott-keys\"}");
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"table",["look"],{"focus":"time"})),({["clock"]:({["minutes"]:0})}))),"tests/kernel/test_capsule.py:135 assert kernel.table(\"look\", focus=\"time\") == {\"clock\": {\"minutes\": 0}}");
error=(await pyMethod(kernel,"table_err",["look"],{"focus":"npc","name":"nobody-here"}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"unknown_entity")),"tests/kernel/test_capsule.py:138 assert error[\"code\"] == \"unknown_entity\"");
assert.ok(pyBool(pyContains(pyAt(error,"details"),"candidates")),"tests/kernel/test_capsule.py:139 assert \"candidates\" in error[\"details\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["look"],{"focus":"weather"})),"code"),"invalid_params")),"tests/kernel/test_capsule.py:140 assert kernel.table_err(\"look\", focus=\"weather\")[\"code\"] == \"invalid_params\"");
}
Object.defineProperty(test_look_focus_variants,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_look_focus_variants"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_look_focus_variants(await kernel(t,{}));});
export async function test_lookup_module_and_secret(kernel:any){
let found:any,names:any,entity:any,secret:any,module:any,ending:any;
(await pyInvoke(open_turn,[kernel],{}));
found=(await pyMethod(kernel,"table",["lookup"],{"kind":"module","query":"knott"}));
assert.ok(pyBool((await (async()=>{const __term0=0;const __term1=(await pyInvoke(pyLen,[pyAt(found,"entities")],{}));const __term2=8;return pyCompare(__term0,__term1,"<")&&pyCompare(__term1,__term2,"<=");})())),"tests/kernel/test_capsule.py:146 assert 0 < len(found[\"entities\"]) <= 8");
names=new Set((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(found,"entities"))){__rows.push(pyAt(e,"name"));}return __rows;})()));
assert.ok(pyBool(pyContains(names,"steven-knott")),"tests/kernel/test_capsule.py:148 assert \"steven-knott\" in names");
entity=(await pyNext((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(found,"entities"))){if(pyBool(pyEqual(pyAt(e,"name"),"steven-knott"))){__rows.push(e);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(entity,"kind"),"npc")),"tests/kernel/test_capsule.py:150 assert entity[\"kind\"] == \"npc\"");
assert.ok(pyBool(pyEqual(pyAt(entity,"visibility"),"player-safe")),"tests/kernel/test_capsule.py:152 assert entity[\"visibility\"] == \"player-safe\"");
assert.ok(pyBool(pyContains(pyAt(entity,"relations"),({["kind"]:"present-in",["to"]:OPENING_SCENE}))),"tests/kernel/test_capsule.py:153 assert {\"kind\": \"present-in\", \"to\": OPENING_SCENE} in entity[\"relations\"]");
secret=(await pyMethod(kernel,"table",["lookup"],{"kind":"secret"}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(secret,"scene"),"name"),OPENING_SCENE)),"tests/kernel/test_capsule.py:156 assert secret[\"scene\"][\"name\"] == OPENING_SCENE");
assert.ok(pyBool(pyAt(pyAt(secret,"scene"),"dramatic_question")),"tests/kernel/test_capsule.py:157 assert secret[\"scene\"][\"dramatic_question\"]");
assert.ok(pyBool(pyLessEqual(new Set(["knott-commission","knott-keys"]),new Set((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(secret,"undiscovered_clues"))){__rows.push(pyAt(c,"name"));}return __rows;})())))),"tests/kernel/test_capsule.py:158 assert {c[\"name\"] for c in secret[\"undiscovered_clues\"]} >= {\"knott-commission\", \"knott-keys\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(secret,"npc_secrets"),0),"name"),"Steven Knott")),"tests/kernel/test_capsule.py:159 assert secret[\"npc_secrets\"][0][\"name\"] == \"Steven Knott\"");
assert.ok(pyBool(pyAt(pyAt(pyAt(secret,"npc_secrets"),0),"secret")),"tests/kernel/test_capsule.py:160 assert secret[\"npc_secrets\"][0][\"secret\"]");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(secret,"module_secrets"))){__rows.push((await (async()=>{const __left=pyEqual(pyAt(s,"name"),"corbitt-undead-sorcerer");return pyBool(__left)?pyContains(pyAt(s,"summary"),"Mythos"):__left})()));}return __rows;})())))),"tests/kernel/test_capsule.py:161 assert any(s[\"name\"] == \"corbitt-undead-sorcerer\" and \"Mythos\" in s[\"summary\"]\n               for s in secret[\"module_secrets\"])");
module=(await pyMethod(kernel,"table",["lookup"],{"kind":"secret","scope":"module"}));
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[pyAt(module,"module_secrets")],{})),6)),"tests/kernel/test_capsule.py:165 assert len(module[\"module_secrets\"]) == 6");
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[pyAt(module,"conclusions")],{})),6)),"tests/kernel/test_capsule.py:166 assert len(module[\"conclusions\"]) == 6");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(module,"conclusions"))){__rows.push(pyAt(c,"summary"));}return __rows;})())))),"tests/kernel/test_capsule.py:167 assert all(c[\"summary\"] for c in module[\"conclusions\"])");
ending=(await pyNext((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(module,"endings"))){if(pyBool(pyEqual(pyAt(e,"conclusion"),"corbitt-destroyed"))){__rows.push(e);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(ending,"rewards"),[({["rule"]:"victory-rewards",["sanity"]:"1D6"})]);return pyBool(__left)?pyEqual(pyAt(ending,"requires"),"investigators_win"):__left})())),"tests/kernel/test_capsule.py:173 assert ending[\"rewards\"] == [{\"rule\": \"victory-rewards\", \"sanity\": \"1D6\"}] and ending[\"requires\"] == \"investigators_win\"");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(pyAt(ending,"sanity_reward")===null);return pyBool(__left)?(pyAt(ending,"rule")===null):__left})());return pyBool(__left)?(pyAt(ending,"ends_session")===true):__left})())),"tests/kernel/test_capsule.py:174 assert ending[\"sanity_reward\"] is None and ending[\"rule\"] is None and ending[\"ends_session\"] is True");
assert.ok(pyBool(pyEqual(pyAt(ending,"scene"),"corbitt-confrontation")),"tests/kernel/test_capsule.py:175 assert ending[\"scene\"] == \"corbitt-confrontation\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["lookup"],{"kind":"weird","query":"x"})),"code"),"invalid_params")),"tests/kernel/test_capsule.py:177 assert kernel.table_err(\"lookup\", kind=\"weird\", query=\"x\")[\"code\"] == \"invalid_params\"");
}
Object.defineProperty(test_lookup_module_and_secret,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_lookup_module_and_secret"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_lookup_module_and_secret(await kernel(t,{}));});
export async function test_lookup_module_takes_exact_handles_and_a_starter_reads_only_the_book_it_has(kernel:any){
let held:any,asked:any,error:any;

(await pyInvoke(open_turn,[kernel],{}));
held=(await pyMethod(kernel,"table",["lookup"],{"kind":"module","query":"knott-macario-summary knott-keys knott-research-leads"}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(held,"entities"))){__rows.push(pyAt(e,"name"));}return __rows;})()),["knott-macario-summary","knott-keys","knott-research-leads"])),"tests/kernel/test_capsule.py:184 assert [e[\"name\"] for e in held[\"entities\"]] == [\"knott-macario-summary\", \"knott-keys\", \"knott-research-leads\"]");
assert.ok(pyBool(!pyContains(held,"status")),"tests/kernel/test_capsule.py:185 assert \"status\" not in held");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["lookup"],{"kind":"module","query":"knott-keys lantern"})),"status"),"not_found")),"tests/kernel/test_capsule.py:187 assert kernel.table(\"lookup\", kind=\"module\", query=\"knott-keys lantern\")[\"status\"] == \"not_found\"");
asked=(await pyMethod(kernel,"ok",["module.read.request",({["module_id"]:"the-haunting",["purpose"]:"detail",["focus"]:"steven-knott",["question"]:"What does the commission pay?"})],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(asked,"state"),"queued");return pyBool(__left)?pyAt(asked,"job_id"):__left})())),"tests/kernel/test_capsule.py:192 assert asked[\"state\"] == \"queued\" and asked[\"job_id\"]");
(await pyMethod(kernel,"ok",["module.register",({["module_id"]:"voice-bench"})],{}));
error=(await pyMethod(kernel,"err",["module.read.request",({["module_id"]:"voice-bench",["purpose"]:"detail",["focus"]:"sanyi-teahouse",["question"]:"Who keeps the teahouse?"})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"needs")),"tests/kernel/test_capsule.py:198 assert error[\"code\"] == \"needs\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"reason"),"no_source_document")),"tests/kernel/test_capsule.py:199 assert error[\"details\"][\"reason\"] == \"no_source_document\"");
assert.ok(pyBool(!pyContains((await pyMethod(error,"get",["fix",""],{})),"module.source.bind")),"tests/kernel/test_capsule.py:200 assert \"module.source.bind\" not in error.get(\"fix\", \"\")");
assert.ok(pyBool(pyContains(pyAt(error,"fix"),"lookup kind=module")),"tests/kernel/test_capsule.py:201 assert \"lookup kind=module\" in error[\"fix\"]");
}
Object.defineProperty(test_lookup_module_takes_exact_handles_and_a_starter_reads_only_the_book_it_has,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_lookup_module_takes_exact_handles_and_a_starter_reads_only_the_book_it_has"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_lookup_module_takes_exact_handles_and_a_starter_reads_only_the_book_it_has(await kernel(t,{}));});
export async function test_recall_transcript(kernel:any){
let recalled:any,only_player:any;
(await pyInvoke(open_turn,[kernel,"第一回合的话。"],{}));
recalled=(await pyMethod(kernel,"table",["recall"],{"what":"transcript"}));
assert.ok(pyBool(pyEqual(pyAt(recalled,"turns"),[0,1])),"tests/kernel/test_capsule.py:207 assert recalled[\"turns\"] == [0, 1]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(recalled,"cards"))){__rows.push([pyAt(c,"turn"),pyAt(c,"role"),pyAt(c,"head")]);}return __rows;})()),[[0,"keeper","开场。\n\n诺特把钥匙拍在桌上。"],[1,"player","第一回合的话。"]])),"tests/kernel/test_capsule.py:208 assert [(c[\"turn\"], c[\"role\"], c[\"head\"]) for c in recalled[\"cards\"]] == [\n        (0, \"keeper\", \"开场。\\n\\n诺特把钥匙拍在桌上。\"),\n        (1, \"player\", \"第一回合的话。\"),\n    ]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"transcript","read":({["turn"]:0,["role"]:"keeper"})})),"text"),"开场。\n\n诺特把钥匙拍在桌上。")),"tests/kernel/test_capsule.py:212 assert kernel.table(\"recall\", what=\"transcript\", read={\"turn\": 0, \"role\": \"keeper\"})[\"text\"] == \"开场。\\n\\n诺特把钥匙拍在桌上。\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"transcript","read":({["turn"]:1,["role"]:"player"})})),"text"),"第一回合的话。")),"tests/kernel/test_capsule.py:213 assert kernel.table(\"recall\", what=\"transcript\", read={\"turn\": 1, \"role\": \"player\"})[\"text\"] == \"第一回合的话。\"");
only_player=(await pyMethod(kernel,"table",["recall"],{"what":"transcript","role":"player"}));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(only_player,"cards"))){__rows.push(pyAt(c,"role"));}return __rows;})()),["player"])),"tests/kernel/test_capsule.py:215 assert [c[\"role\"] for c in only_player[\"cards\"]] == [\"player\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"transcript","turns":[1,1]})),"cards"),0),"turn"),1)),"tests/kernel/test_capsule.py:216 assert kernel.table(\"recall\", what=\"transcript\", turns=[1, 1])[\"cards\"][0][\"turn\"] == 1");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"memory"})),"what"),"memory")),"tests/kernel/test_capsule.py:218 assert kernel.table(\"recall\", what=\"memory\")[\"what\"] == \"memory\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["recall"],{"what":"history"})),"what"),"history")),"tests/kernel/test_capsule.py:219 assert kernel.table(\"recall\", what=\"history\")[\"what\"] == \"history\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["recall"],{"what":"dreams"})),"code"),"invalid_params")),"tests/kernel/test_capsule.py:220 assert kernel.table_err(\"recall\", what=\"dreams\")[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["recall"],{"what":"transcript","turns":[3,1]})),"code"),"invalid_params")),"tests/kernel/test_capsule.py:221 assert kernel.table_err(\"recall\", what=\"transcript\", turns=[3, 1])[\"code\"] == \"invalid_params\"");
}
Object.defineProperty(test_recall_transcript,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_recall_transcript"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_recall_transcript(await kernel(t,{}));});
export async function test_capsule_is_kept_with_the_turn_cursor_and_the_closed_record(kernel:any){
let opened:any,cursor:any,record:any;

opened=(await pyInvoke(_open_turn,[kernel,"我看着诺特。"],{}));
cursor=(await pyInvoke(_read,[pyDivide((await pyInvoke(_dir,[kernel.workspace],{})),"turn.json")],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(cursor,"capsule"),"where"),"scene"),_OPENING)),"tests/kernel/test_capsule.py:228 assert cursor[\"capsule\"][\"where\"][\"scene\"] == _OPENING");
assert.ok(pyBool(pyEqual(pyAt(cursor,"capsule"),pyAt(opened,"capsule"))),"tests/kernel/test_capsule.py:229 assert cursor[\"capsule\"] == opened[\"capsule\"]");
(await pyInvoke(narrate,[kernel,"t1-c1","他看着你。"],{}));
record=(await pyInvoke(_read,[pyDivide(pyDivide((await pyInvoke(_dir,[kernel.workspace],{})),"turns"),"0001.json")],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(record,"capsule"),"turn"),"number"),1);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(record,"capsule"),"where"),"scene"),_OPENING):__left})())),"tests/kernel/test_capsule.py:232 assert record[\"capsule\"][\"turn\"][\"number\"] == 1 and record[\"capsule\"][\"where\"][\"scene\"] == _OPENING");
}
Object.defineProperty(test_capsule_is_kept_with_the_turn_cursor_and_the_closed_record,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_capsule_is_kept_with_the_turn_cursor_and_the_closed_record"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_capsule_is_kept_with_the_turn_cursor_and_the_closed_record(await kernel(t,{}));});
export async function test_an_affordance_row_carries_what_it_yields_and_its_gate(kernel:any){
const __yielded:any[]=[];
let where:any,affordances:any,row:any,known:any,clues:any,after:any;

(await pyInvoke(open_turn,[kernel],{}));
where=pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where");
affordances=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(pyAt(where,"affordances"))){__rows.push([pyAt(a,"id"),a]);}return __rows;})()));
row=pyAt(affordances,"confirm-commission-terms");
assert.ok(pyBool(pyEqual(pyAt(row,"clue"),"knott-commission")),"tests/kernel/test_capsule.py:243 assert row[\"clue\"] == \"knott-commission\"");
assert.ok(pyBool(pyEqual(pyAt(row,"clues"),[({["clue"]:"knott-commission",["gate"]:"npc_dialogue: check unspecified",["discovered"]:false,["material"]:"ready"})])),"tests/kernel/test_capsule.py:244 assert row[\"clues\"] == [{\"clue\": \"knott-commission\", \"gate\": \"npc_dialogue: check unspecified\", \"discovered\": False, \"material\": \"ready\"}]");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(pyAt(where,"affordances"))){__rows.push((await (async()=>{const __left=pyContains(a,"clues");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(a,"clues"),0),"clue"),pyAt(a,"clue")):__left})()));}return __rows;})())))),pyStr(pyAt(where,"affordances")));
assert.ok(pyBool((await (async()=>{const __left=!pyContains(row,"status");return pyBool(__left)?!pyContains(row,"route_type"):__left})())),"tests/kernel/test_capsule.py:247 assert \"status\" not in row and \"route_type\" not in row");
known=pyAt((await pyMethod(kernel,"table",["capsule"],{})),"known");
clues=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(known,"clues_here"))){__rows.push([pyAt(c,"name"),c]);}return __rows;})()));
assert.ok(pyBool(pyEqual(pyAt(pyAt(clues,"knott-commission"),"gate"),"npc_dialogue: check unspecified")),"tests/kernel/test_capsule.py:250 assert clues[\"knott-commission\"][\"gate\"] == \"npc_dialogue: check unspecified\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(clues,"knott-commission"),"material"),"ready")),"tests/kernel/test_capsule.py:251 assert clues[\"knott-commission\"][\"material\"] == \"ready\"");
assert.ok(pyBool(!pyContains(pyAt(clues,"knott-commission"),"next")),"tests/kernel/test_capsule.py:252 assert \"next\" not in clues[\"knott-commission\"]");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-commission"})]}));
after=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where"),"affordances"))){__rows.push([pyAt(a,"id"),a]);}return __rows;})()));
assert.ok(pyBool((pyAt(pyAt(pyAt(pyAt(after,"confirm-commission-terms"),"clues"),0),"discovered")===true)),"tests/kernel/test_capsule.py:256 assert after[\"confirm-commission-terms\"][\"clues\"][0][\"discovered\"] is True");
return __yielded;
}
Object.defineProperty(test_an_affordance_row_carries_what_it_yields_and_its_gate,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_affordance_row_carries_what_it_yields_and_its_gate"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_affordance_row_carries_what_it_yields_and_its_gate(await kernel(t,{}));});
