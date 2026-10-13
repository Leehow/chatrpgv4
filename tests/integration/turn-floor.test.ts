// Migrated from tests/kernel/test_turn_floor.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,CONTENT_DIR,WORKTREE,campaign_dir,create_campaign,narrate,narrate_opening,open_turn,read_json,first_failure,first_success,resolve_err,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter,copy,pyReversed,math} from "./setup-native-support.ts";
import {rule,threshold,weighted} from "./world-director-scoring.test.ts";





export let PROVIDER:any=(await read_json(pyDivide(pyDivide(pyDivide(WORKTREE,"mods"),"narration-craft"),"mod.json")));
export let STYLE:any=(await read_json(pyDivide(pyDivide(pyDivide(WORKTREE,"mods"),"narration-craft"),pyAt(pyAt(PROVIDER,"contributes"),"style"))));
export let FLOOR_LINES:any=pyAt(STYLE,"floor");
export let DIRECTOR_GRAPH:any=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(CONTENT_DIR,"director"),"director-graph.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
export async function director_of(client:any){
return pyAt((await pyMethod(client,"table",["capsule"],{})),"director");
}

export async function test_style_carries_the_providers_floor_lines_on_every_turn(kernel:any){
let first:any,second:any,beat:any;
first=pyAt((await open_turn(kernel,"我打量诺特。")),"capsule");
assert.ok(pyBool((await (async()=>{const __left=FLOOR_LINES;return pyBool(__left)?pyEqual(pyAt(pyAt(first,"style"),"floor"),FLOOR_LINES):__left})())),"tests/kernel/test_turn_floor.py:28 assert FLOOR_LINES and first[\"style\"][\"floor\"] == FLOOR_LINES");
(await narrate(kernel,"t1-c1","诺特抬起头。"));
second=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我坐下。"})),"capsule");
assert.ok(pyBool(pyEqual(pyAt(pyAt(second,"style"),"floor"),FLOOR_LINES)),pyStr("the brief turns keep the floor"));
assert.ok(pyBool(pyEqual(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt(first,"style"),"directives"))){__rows.push([pyAt(row,"id"),pyAt(row,"line")]);}return __rows;})())),Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [id_,entry] of pyIterable((await pyMethod(pyAt(STYLE,"directives"),"items",[],{})))){__rows.push([id_,pyAt(entry,"full")]);}return __rows;})())))),"tests/kernel/test_turn_floor.py:32 assert {row[\"id\"]: row[\"line\"] for row in first[\"style\"][\"directives\"]} == {id_: entry[\"full\"] for id_, entry in STYLE[\"directives\"].items()}");
beat=pyAt(pyAt(second,"director"),"beat");
assert.ok(pyBool(pyEqual(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt(second,"style"),"directives"))){__rows.push([pyAt(row,"id"),pyAt(row,"line")]);}return __rows;})())),Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const id_ of pyIterable(pyAt(pyAt(STYLE,"beats"),beat))){__rows.push([id_,pyAt(pyAt(pyAt(STYLE,"directives"),id_),"brief")]);}return __rows;})())))),"tests/kernel/test_turn_floor.py:34 assert {row[\"id\"]: row[\"line\"] for row in second[\"style\"][\"directives\"]} == {id_: STYLE[\"directives\"][id_][\"brief\"] for id_ in STYLE[\"beats\"][beat]}");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(second,"head"),"director.offer");return pyBool(__left)?pyContains(pyAt(second,"head"),"Director signals and offers remain advice"):__left})())),"tests/kernel/test_turn_floor.py:35 assert \"director.offer\" in second[\"head\"] and \"Director signals and offers remain advice\" in second[\"head\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_style_carries_the_providers_floor_lines_on_every_turn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_style_carries_the_providers_floor_lines_on_every_turn(await kernel(t,{}));});
export async function test_without_a_style_provider_there_is_no_floor(kernel:any){
let first:any,second:any;
(await create_campaign(kernel));
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:CAMPAIGN,["id"]:"narration-craft",["enabled"]:false})],{}));
(await narrate_opening(kernel));
first=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我打量诺特。"})),"capsule");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(pyAt(first,"style"),"floor");return pyBool(__left)?!pyContains(pyAt(first,"style"),"directives"):__left})())),"tests/kernel/test_turn_floor.py:43 assert \"floor\" not in first[\"style\"] and \"directives\" not in first[\"style\"]");
(await narrate(kernel,"t1-c1","诺特抬起头。"));
second=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我坐下。"})),"capsule");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(pyAt(second,"style"),"floor");return pyBool(__left)?pyEqual((await pySet(pyAt(second,"style"))),new Set(["language","register"])):__left})())),"tests/kernel/test_turn_floor.py:46 assert \"floor\" not in second[\"style\"] and set(second[\"style\"]) == {\"language\", \"register\"}");
assert.ok(pyBool(pyContains(pyAt(second,"director"),"offer")),"tests/kernel/test_turn_floor.py:48 assert \"offer\" in second[\"director\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_without_a_style_provider_there_is_no_floor"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_without_a_style_provider_there_is_no_floor(await kernel(t,{}));});

export async function test_first_player_turn_has_no_previous_turn_to_read(kernel:any){
let director:any;
director=pyAt(pyAt((await open_turn(kernel,"然后呢")),"capsule"),"director");
assert.ok(pyBool(pyContains(pyAt(director,"because"),"empty_turns = 0")),"tests/kernel/test_turn_floor.py:55 assert \"empty_turns = 0\" in director[\"because\"]");
assert.ok(pyBool(pyContains(pyAt(director,"because"),"repeat_input = False")),"tests/kernel/test_turn_floor.py:56 assert \"repeat_input = False\" in director[\"because\"]");
assert.ok(pyBool(pyContains(pyAt(director,"because"),"previous_close = none")),"tests/kernel/test_turn_floor.py:57 assert \"previous_close = none\" in director[\"because\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_first_player_turn_has_no_previous_turn_to_read"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_first_player_turn_has_no_previous_turn_to_read(await kernel(t,{}));});
export async function test_an_empty_turn_and_a_repeated_input_score_recover_from_the_graph(kernel:any){
let director:any;
(await open_turn(kernel,"然后呢"));
(await narrate(kernel,"t1-c1","诺特靠回椅背，等着你。"));
director=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"然后呢"})),"capsule"),"director");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(director,"because"),"empty_turns = 1");return pyBool(__left)?pyLessEqual((await threshold("recover-empty-turns")),1):__left})())),"tests/kernel/test_turn_floor.py:64 assert \"empty_turns = 1\" in director[\"because\"] and 1 >= threshold(\"recover-empty-turns\")");
assert.ok(pyBool(pyContains(pyAt(director,"because"),"repeat_input = True")),"tests/kernel/test_turn_floor.py:65 assert \"repeat_input = True\" in director[\"because\"]");
assert.ok(pyBool(pyContains(pyAt(director,"because"),"previous_close = explicit")),"tests/kernel/test_turn_floor.py:66 assert \"previous_close = explicit\" in director[\"because\"]");
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"RECOVER")),"tests/kernel/test_turn_floor.py:67 assert director[\"beat\"] == \"RECOVER\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"RECOVER"),(await pyMax((await weighted("RECOVER","empty-turn")),(await weighted("RECOVER","repeated-input")))))),"tests/kernel/test_turn_floor.py:69 assert director[\"scores\"][\"RECOVER\"] == max(weighted(\"RECOVER\", \"empty-turn\"), weighted(\"RECOVER\", \"repeated-input\"))");
assert.ok(pyBool((await (async()=>{const __term0=(await rule("RECOVER","repeated-input"));const __term1=(await rule("RECOVER","empty-turn"));const __term2=0;return pyCompare(__term0,__term1,">")&&pyCompare(__term1,__term2,">");})())),"tests/kernel/test_turn_floor.py:70 assert rule(\"RECOVER\", \"repeated-input\") > rule(\"RECOVER\", \"empty-turn\") > 0");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(director,"reason"),"empty-turn");return pyBool(__left)?pyContains(pyAt(director,"reason"),"repeated-input"):__left})())),"tests/kernel/test_turn_floor.py:71 assert \"empty-turn\" in director[\"reason\"] and \"repeated-input\" in director[\"reason\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_empty_turn_and_a_repeated_input_score_recover_from_the_graph"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_empty_turn_and_a_repeated_input_score_recover_from_the_graph(await kernel(t,{}));});
export async function test_a_different_line_after_an_empty_turn_is_not_a_repeat(kernel:any){
let director:any;
(await open_turn(kernel,"然后呢"));
(await narrate(kernel,"t1-c1","诺特靠回椅背，等着你。"));
director=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我接下这活。"})),"capsule"),"director");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(director,"because"),"empty_turns = 1");return pyBool(__left)?pyContains(pyAt(director,"because"),"repeat_input = False"):__left})())),"tests/kernel/test_turn_floor.py:78 assert \"empty_turns = 1\" in director[\"because\"] and \"repeat_input = False\" in director[\"because\"]");
assert.ok(pyBool(pyLess((await rule("RECOVER","empty-turn")),(await rule("PRESSURE","clock-near-full-or-stalled")))),"tests/kernel/test_turn_floor.py:80 assert rule(\"RECOVER\", \"empty-turn\") < rule(\"PRESSURE\", \"clock-near-full-or-stalled\")");
assert.ok(pyBool(pyEqual((await pyMethod(pyAt(director,"scores"),"get",["RECOVER",(await weighted("RECOVER","empty-turn"))],{})),(await weighted("RECOVER","empty-turn")))),"tests/kernel/test_turn_floor.py:81 assert director[\"scores\"].get(\"RECOVER\", weighted(\"RECOVER\", \"empty-turn\")) == weighted(\"RECOVER\", \"empty-turn\")");
assert.ok(pyBool(!pyEqual(pyAt(director,"beat"),"RECOVER")),"tests/kernel/test_turn_floor.py:82 assert director[\"beat\"] != \"RECOVER\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_different_line_after_an_empty_turn_is_not_a_repeat"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_different_line_after_an_empty_turn_is_not_a_repeat(await kernel(t,{}));});
export async function test_a_turn_that_landed_a_receipt_is_not_empty(kernel:any){
let director:any;
(await open_turn(kernel,"我接下这活。"));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-commission"})]}));
(await narrate(kernel,"t1-c2","诺特点头。"));
director=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"然后呢"})),"capsule"),"director");
assert.ok(pyBool(pyContains(pyAt(director,"because"),"empty_turns = 0")),"tests/kernel/test_turn_floor.py:90 assert \"empty_turns = 0\" in director[\"because\"]");
assert.ok(pyBool(!pyContains(pyAt(director,"scores"),"RECOVER")),"tests/kernel/test_turn_floor.py:91 assert \"RECOVER\" not in director[\"scores\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_turn_that_landed_a_receipt_is_not_empty"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_turn_that_landed_a_receipt_is_not_empty(await kernel(t,{}));});

export async function test_recover_offer_leads_with_the_present_person_when_nothing_is_owed(kernel:any){
let director:any,offer:any;
(await open_turn(kernel,"然后呢"));
(await narrate(kernel,"t1-c1","诺特靠回椅背，等着你。"));
director=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"然后呢"})),"capsule"),"director");
offer=pyAt(director,"offer");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __term0=1;const __term1=(await pyLen(offer));const __term2=3;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})());return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(offer)){__rows.push(pyLessEqual(new Set(["kind","line","from"]),(await pySet(row))));}return __rows;})()))):__left})())),"tests/kernel/test_turn_floor.py:101 assert 1 <= len(offer) <= 3 and all({\"kind\", \"line\", \"from\"} <= set(row) for row in offer)");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(offer)){__rows.push(pyLessEqual((await pyLen(pyAt(row,"line"))),120));}return __rows;})())))),"tests/kernel/test_turn_floor.py:102 assert all(len(row[\"line\"]) <= 120 for row in offer)");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pyAt(offer,0),"kind"),"person");return pyBool(__left)?pyEqual(pyAt(pyAt(offer,0),"who"),"Steven Knott"):__left})());return pyBool(__left)?pyEqual(pyAt(pyAt(offer,0),"from"),"present"):__left})())),"tests/kernel/test_turn_floor.py:104 assert offer[0][\"kind\"] == \"person\" and offer[0][\"who\"] == \"Steven Knott\" and offer[0][\"from\"] == \"present\"");
assert.ok(pyBool(pyContains(pyAt(pyAt(offer,0),"line"),"wants:")),"tests/kernel/test_turn_floor.py:105 assert \"wants:\" in offer[0][\"line\"]");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(offer)){__rows.push(pyEqual(pyAt(row,"kind"),"consequence"));}return __rows;})()))))),"tests/kernel/test_turn_floor.py:106 assert not any(row[\"kind\"] == \"consequence\" for row in offer)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_recover_offer_leads_with_the_present_person_when_nothing_is_owed"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_recover_offer_leads_with_the_present_person_when_nothing_is_owed(await kernel(t,{}));});
export async function test_a_failed_check_last_turn_is_the_consequence_still_owed(seeded_kernel:any){
let call_id:any,result:any,director:any,owed:any;

(await open_turn(seeded_kernel,"我打量诺特。"));
const __unpack6315=(await first_failure(seeded_kernel,"t1-c",({"intent":"social","goal":"让诺特多说点","method":"套话","skill":"Persuade","target":"Steven Knott"})));call_id=__unpack6315[0];result=__unpack6315[1];
(await narrate(seeded_kernel,"t1-c99","诺特把嘴闭紧了。"));
director=pyAt(pyAt((await pyMethod(seeded_kernel,"table",["player_input"],{"text":"然后呢"})),"capsule"),"director");
owed=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(director,"offer"))){if(pyBool(pyEqual(pyAt(row,"kind"),"consequence"))){__rows.push(row);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=pyEqual((await pyLen(owed)),1);return pyBool(__left)?pyEqual(pyAt(pyAt(owed,0),"from"),"recent.receipts"):__left})())),"tests/kernel/test_turn_floor.py:117 assert len(owed) == 1 and owed[0][\"from\"] == \"recent.receipts\"");
assert.ok(pyBool(pyContains(pyAt(pyAt(owed,0),"line"),"failed last turn")),"tests/kernel/test_turn_floor.py:118 assert \"failed last turn\" in owed[0][\"line\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_failed_check_last_turn_is_the_consequence_still_owed"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_failed_check_last_turn_is_the_consequence_still_owed(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_an_open_exit_someone_present_knows_becomes_a_route_row(kernel:any){
let capsule:any,routes:any,open_exits:any;
(await open_turn(kernel,"我接下这活。"));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-research-leads"})]}));
capsule=(await pyMethod(kernel,"table",["capsule"],{}));
routes=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt(capsule,"director"),"offer"))){if(pyBool(pyEqual(pyAt(row,"kind"),"route"))){__rows.push(row);}}return __rows;})());
open_exits=new Set((await (async()=>{const __rows:any[]=[];for(const exit of pyIterable(pyAt(pyAt(capsule,"where"),"exits"))){if(pyBool(((await pyMethod((await pyMethod(exit,"get",["unlock_when",({})],{})),"get",["met"],{}))!==false))){__rows.push(pyAt(exit,"to"));}}return __rows;})()));
assert.ok(pyBool(routes),pyStr(pyAt(capsule,"director")));
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(routes)){__rows.push(pyContains(open_exits,pyAt(row,"where")));}return __rows;})())))),"tests/kernel/test_turn_floor.py:128 assert all(row[\"where\"] in open_exits for row in routes)");
assert.ok(pyBool(pyContains(new Set(["mods.thread","where.exits"]),pyAt(pyAt(routes,0),"from"))),"tests/kernel/test_turn_floor.py:129 assert routes[0][\"from\"] in {\"mods.thread\", \"where.exits\"}");
assert.ok(pyBool(pyContains(new Set([null,"Steven Knott"]),(await pyMethod(pyAt(routes,0),"get",["who"],{})))),"tests/kernel/test_turn_floor.py:130 assert routes[0].get(\"who\") in {None, \"Steven Knott\"}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_open_exit_someone_present_knows_becomes_a_route_row"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_open_exit_someone_present_knows_becomes_a_route_row(await kernel(t,{}));});
export async function test_walking_the_offered_route_is_recorded_as_offer_taken(kernel:any){
let capsule:any,route:any,record:any,adoption:any;
(await open_turn(kernel,"我接下这活。"));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-research-leads"})]}));
(await narrate(kernel,"t1-c2","诺特把地址写给你。"));
capsule=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我去查档案。"})),"capsule");
route=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt(capsule,"director"),"offer"))){if(pyBool(pyEqual(pyAt(row,"kind"),"route"))){__rows.push(row);}}return __rows;})())));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"move",["to"]:pyAt(route,"where")})]}));
(await narrate(kernel,"t2-c2","你出了门。"));
record=(await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0002.json")));
adoption=pyAt(record,"director_adoption");
assert.ok(pyBool(pyEqual(pyAt(adoption,"offer_taken"),[`route:${pyAt(route,"where")}`])),"tests/kernel/test_turn_floor.py:143 assert adoption[\"offer_taken\"] == [f\"route:{route['where']}\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_walking_the_offered_route_is_recorded_as_offer_taken"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_walking_the_offered_route_is_recorded_as_offer_taken(await kernel(t,{}));});
export async function test_offer_stays_inside_the_director_budget(kernel:any){
let capsule:any;
capsule=pyAt((await open_turn(kernel,"我打量诺特。")),"capsule");
assert.ok(pyBool(pyLessEqual((await pyLen((await pyMethod((await pyMethod(json,"dumps",[pyAt(capsule,"director")],{"ensure_ascii":false})),"encode",["utf-8"],{})))),2048)),"tests/kernel/test_turn_floor.py:148 assert len(json.dumps(capsule[\"director\"], ensure_ascii=False).encode(\"utf-8\")) <= 2048");
assert.ok(pyBool(pyAt(pyAt(capsule,"director"),"offer")),pyStr("the offer survived the fit"));
assert.ok(pyBool(!pyContains((await pyMethod(capsule,"get",["truncated",[]],{})),"director")),"tests/kernel/test_turn_floor.py:150 assert \"director\" not in capsule.get(\"truncated\", [])");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_offer_stays_inside_the_director_budget"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_offer_stays_inside_the_director_budget(await kernel(t,{}));});

export async function test_an_implicit_close_is_recorded_and_surfaces_in_recent_and_the_signals(kernel:any){
let record:any,capsule:any;
(await open_turn(kernel,"然后呢"));
(await narrate(kernel,"t1-c1","诺特靠回椅背，等着你。",({"implicit":true})));
record=(await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0001.json")));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(record,"closed_by"),"narrate");return pyBool(__left)?pyEqual(pyAt(record,"closed_how"),"implicit"):__left})())),"tests/kernel/test_turn_floor.py:159 assert record[\"closed_by\"] == \"narrate\" and record[\"closed_how\"] == \"implicit\"");
capsule=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"继续"})),"capsule");
assert.ok(pyBool(pyEqual(pyAt(pyAt(capsule,"recent"),(-1)),({["turn"]:1,["player"]:"然后呢",["keeper"]:"诺特靠回椅背，等着你。",["closed"]:"implicit",["receipts"]:0}))),"tests/kernel/test_turn_floor.py:161 assert capsule[\"recent\"][-1] == {\"turn\": 1, \"player\": \"然后呢\", \"keeper\": \"诺特靠回椅背，等着你。\", \"closed\": \"implicit\", \"receipts\": 0}");
assert.ok(pyBool(pyContains(pyAt(pyAt(capsule,"director"),"because"),"previous_close = implicit")),"tests/kernel/test_turn_floor.py:162 assert \"previous_close = implicit\" in capsule[\"director\"][\"because\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_implicit_close_is_recorded_and_surfaces_in_recent_and_the_signals"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_implicit_close_is_recorded_and_surfaces_in_recent_and_the_signals(await kernel(t,{}));});
export async function test_an_explicit_close_is_the_default(kernel:any){
let record:any;
(await open_turn(kernel,"我打量诺特。"));
(await narrate(kernel,"t1-c1","诺特抬起头。"));
record=(await read_json(pyDivide(pyDivide((await campaign_dir(kernel.workspace)),"turns"),"0001.json")));
assert.ok(pyBool(pyEqual(pyAt(record,"closed_how"),"explicit")),"tests/kernel/test_turn_floor.py:169 assert record[\"closed_how\"] == \"explicit\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_explicit_close_is_the_default"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_explicit_close_is_the_default(await kernel(t,{}));});

export async function test_the_director_graph_declares_the_two_recover_rules_and_their_threshold(){
let ids:any,relations:any,manifest:any,counts:any,node:any;
ids=new Set((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(DIRECTOR_GRAPH,"nodes"))){__rows.push(pyAt(node,"node_id"));}return __rows;})()));
assert.ok(pyBool(pyLessEqual(new Set(["scoring-rule:recover:empty-turn","scoring-rule:recover:repeated-input","threshold:recover-empty-turns"]),ids)),"tests/kernel/test_turn_floor.py:176 assert {\"scoring-rule:recover:empty-turn\", \"scoring-rule:recover:repeated-input\", \"threshold:recover-empty-turns\"} <= ids");
relations=new Set((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(DIRECTOR_GRAPH,"relations"))){if(pyBool(pyEqual(pyAt(r,"relation_kind"),"scores"))){__rows.push([pyAt(r,"from_node_id"),pyAt(r,"to_node_id")]);}}return __rows;})()));
assert.ok(pyBool(pyContains(relations,["scoring-rule:recover:empty-turn","director-action:recover"])),"tests/kernel/test_turn_floor.py:178 assert (\"scoring-rule:recover:empty-turn\", \"director-action:recover\") in relations");
assert.ok(pyBool(pyContains(relations,["scoring-rule:recover:repeated-input","director-action:recover"])),"tests/kernel/test_turn_floor.py:179 assert (\"scoring-rule:recover:repeated-input\", \"director-action:recover\") in relations");
manifest=(await read_json(pyDivide(pyDivide(CONTENT_DIR,"director"),"director-graph-manifest.json")));
counts=({});
for(node of pyIterable(pyAt(DIRECTOR_GRAPH,"nodes"))){
counts[pyAt(node,"node_kind")]=pyAdd((await pyMethod(counts,"get",[pyAt(node,"node_kind"),0],{})),1);
}
assert.ok(pyBool(pyEqual(pyAt(manifest,"node_counts"),counts)),"tests/kernel/test_turn_floor.py:184 assert manifest[\"node_counts\"] == counts");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_director_graph_declares_the_two_recover_rules_and_their_threshold"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_director_graph_declares_the_two_recover_rules_and_their_threshold();});

export async function test_attacking_a_person_with_no_stat_block_is_refused_toward_a_receipt_not_toward_prose(kernel:any){
let error:any,fix:any;
(await open_turn(kernel,"我想把你打一顿"));
error=(await resolve_err(kernel,"t1-c1",({"intent":"combat","goal":"打诺特","method":"挥拳","actor":"Thomas Hayes","target":"Steven Knott"})));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"needs")),"tests/kernel/test_turn_floor.py:192 assert error[\"code\"] == \"needs\"");
assert.ok(pyBool(pyContains(pyAt(error,"message"),"no stat block")),"tests/kernel/test_turn_floor.py:193 assert \"no stat block\" in error[\"message\"]");
fix=pyAt(error,"fix");
assert.ok(pyBool(pyContains(fix,"Nothing without a receipt has happened")),"tests/kernel/test_turn_floor.py:195 assert \"Nothing without a receipt has happened\" in fix");
assert.ok(pyBool(pyContains(fix,"do not narrate a blow as landed")),"tests/kernel/test_turn_floor.py:196 assert \"do not narrate a blow as landed\" in fix");
assert.ok(pyBool(!pyContains(fix,"without dice")),"tests/kernel/test_turn_floor.py:197 assert \"without dice\" not in fix");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_attacking_a_person_with_no_stat_block_is_refused_toward_a_receipt_not_toward_prose"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_attacking_a_person_with_no_stat_block_is_refused_toward_a_receipt_not_toward_prose(await kernel(t,{}));});

export async function _fail_the_same_check(client:any,turn_no:any,text:any){
let call_id:any,_:any;

const __unpack11381=(await first_failure(client,`t${turn_no}-c`,({"intent":"investigate","goal":"撬开钉死的柜门","method":"拿铁条一颗一颗撬","skill":"STR","target":"nailed cupboard"})));call_id=__unpack11381[0];_=__unpack11381[1];
(await narrate(client,`t${turn_no}-c99`,"钉子纹丝不动。"));
return pyAt(pyAt((await pyMethod(client,"table",["player_input"],{"text":text})),"capsule"),"director");
}
export async function test_failed_checks_keep_obstacle_signals_without_recovery_debt(seeded_kernel:any){
let after_one:any,after_two:any;

(await open_turn(seeded_kernel,"我打量那口钉死的柜子。"));
after_one=(await _fail_the_same_check(seeded_kernel,1,"再撬一次"));
assert.ok(pyBool(pyEqual((await pyMethod(pyAt(after_one,"because"),"count",["blocked_attempts = 1"],{})),1)),pyStr(pyAt(after_one,"because")));
assert.ok(pyBool(!pyContains(after_one,"recovery")),pyStr("one failed check is play: the risk was real and it cost"));
after_two=(await _fail_the_same_check(seeded_kernel,2,"还是撬不动，我换个角度"));
assert.ok(pyBool(pyEqual((await pyMethod(pyAt(after_two,"because"),"count",["blocked_attempts = 2"],{})),1)),pyStr(pyAt(after_two,"because")));
assert.ok(pyBool(!pyContains(after_two,"recovery")),"tests/kernel/test_turn_floor.py:222 assert \"recovery\" not in after_two");
assert.ok(pyBool(pyLess(0,pyAt(pyAt(after_two,"scores"),"RECOVER"))),"tests/kernel/test_turn_floor.py:223 assert after_two[\"scores\"][\"RECOVER\"] > 0");
assert.ok(pyBool(pyAt(after_two,"offer")),pyStr("Useful options remain available without making one mandatory"));
(await narrate(seeded_kernel,"t3-c1","你停下手，重新想了想已经知道的事。"));
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide(pyDivide((await campaign_dir(seeded_kernel.workspace)),"turns"),"0003.json"))),"receipts"),[])),"tests/kernel/test_turn_floor.py:226 assert read_json(campaign_dir(seeded_kernel.workspace) / \"turns\" / \"0003.json\")[\"receipts\"] == []");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_failed_checks_keep_obstacle_signals_without_recovery_debt"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_failed_checks_keep_obstacle_signals_without_recovery_debt(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_passing_the_obstacle_clears_its_advisory_count(seeded_kernel:any){
let after_two:any,after_pass:any;
(await open_turn(seeded_kernel,"我打量那口钉死的柜子。"));
(await _fail_the_same_check(seeded_kernel,1,"再撬一次"));
after_two=(await _fail_the_same_check(seeded_kernel,2,"还是撬不动"));
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(after_two,"because"),"blocked_attempts = 2");return pyBool(__left)?!pyContains(after_two,"recovery"):__left})())),"tests/kernel/test_turn_floor.py:233 assert \"blocked_attempts = 2\" in after_two[\"because\"] and \"recovery\" not in after_two");
(await first_success(seeded_kernel,"t3-c",({"intent":"investigate","goal":"撬开钉死的柜门","method":"拿铁条一颗一颗撬","skill":"STR","target":"nailed cupboard"})));
(await narrate(seeded_kernel,"t3-c99","钉子终于松了。"));
after_pass=pyAt(pyAt((await pyMethod(seeded_kernel,"table",["player_input"],{"text":"我把柜门拉开"})),"capsule"),"director");
assert.ok(pyBool(pyEqual((await pyMethod(pyAt(after_pass,"because"),"count",["blocked_attempts = 0"],{})),1)),pyStr(pyAt(after_pass,"because")));
assert.ok(pyBool(!pyContains(after_pass,"recovery")),"tests/kernel/test_turn_floor.py:239 assert \"recovery\" not in after_pass");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_passing_the_obstacle_clears_its_advisory_count"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_passing_the_obstacle_clears_its_advisory_count(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
