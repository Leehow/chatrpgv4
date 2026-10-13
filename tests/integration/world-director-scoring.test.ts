// Migrated from tests/kernel/test_director_scoring.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {narrate,CONTENT_DIR,RpcClient,campaign_dir,open_turn,read_json,read_jsonl,first_failure,resolve,seed_wound,walk_to_confrontation,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_director_scoring.py',import.meta.url).pathname;




export let DIRECTOR_GRAPH:any=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(CONTENT_DIR,"director"),"director-graph.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
export let ONTOLOGY:any=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(CONTENT_DIR,"ontology"),"system-ontology.json")),"read_text",[],{"encoding":"utf-8"}))],{}));
export let STRUCTURE:any="branching_investigation";

export let GROUND_FLOOR_CLUES:any=["corbitt-diaries","upstairs-disturbance","catholic-wards","nailed-windows"];
export let BRIEFING_CLUES:any=["knott-commission","knott-research-leads","knott-macario-summary","knott-keys"];
export let DOCUMENTARY_HISTORY_CLUES:any=["house-built-1835","neighbor-lawsuit-1852","second-lawsuit-outcome-unrecorded"];

export async function _legacy(){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(DIRECTOR_GRAPH,"nodes"))){if(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(n,"get",["plane"],{})),"vocabulary");return pyBool(__left)?pyContains((await pyMethod(n,"get",["properties",({})],{})),"legacy_key"):__left})()))){__rows.push([pyAt(n,"node_id"),pyAt(pyAt(n,"properties"),"legacy_key")]);}}return __rows;})()));
}
Object.defineProperty(_legacy,"__pySignature",{value:[]});
export async function rule(action:any,condition:any){
let legacy:any,node:any,props:any;
legacy=(await pyInvoke(_legacy,[],{}));
for(node of pyIterable(pyAt(DIRECTOR_GRAPH,"nodes"))){
props=(await (async()=>{const __left=(await pyMethod(node,"get",["properties"],{}));return pyBool(__left)?__left:({})})());
if(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(node,"node_kind"),"scoring-rule");return pyBool(__left)?pyEqual(pyAt(legacy,pyAt(props,"action_ref")),action):__left})());return pyBool(__left)?pyEqual(pyAt(props,"condition_id"),condition):__left})()))){return pyAt(props,"value");}
}
throw new Error("raise KeyError((action, condition))");
}
Object.defineProperty(rule,"__pySignature",{value:[{"name":"action","rest":false,"varargs":false},{"name":"condition","rest":false,"varargs":false}]});
export async function weight(action:any,structure:any=STRUCTURE){
let legacy:any,node:any,props:any;
legacy=(await pyInvoke(_legacy,[],{}));
for(node of pyIterable(pyAt(DIRECTOR_GRAPH,"nodes"))){
props=(await (async()=>{const __left=(await pyMethod(node,"get",["properties"],{}));return pyBool(__left)?__left:({})})());
if(pyBool(((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(node,"node_kind"),"structure-weight");return pyBool(__left)?pyEqual(pyAt(legacy,pyAt(props,"structure_ref")),structure):__left})());return pyBool(__left)?pyEqual(pyAt(legacy,pyAt(props,"action_ref")),action):__left})())))){return pyAt(props,"value");}
}
throw new Error("raise KeyError((structure, action))");
}
Object.defineProperty(weight,"__pySignature",{value:[{"name":"action","rest":false,"varargs":false},{"name":"structure","rest":false,"varargs":false}]});
export async function threshold(name:any){
let node:any;
for(node of pyIterable(pyAt(DIRECTOR_GRAPH,"nodes"))){
if(pyBool((await (async()=>{const __left=pyEqual(pyAt(node,"node_kind"),"threshold");return pyBool(__left)?pyEqual(pyAt(pyAt(node,"properties"),"threshold_id"),name):__left})()))){return pyAt(pyAt(node,"properties"),"value");}
}
throw new Error("raise KeyError(name)");
}
Object.defineProperty(threshold,"__pySignature",{value:[{"name":"name","rest":false,"varargs":false}]});
export async function tiebreak(){
return (await pyNext((await (async()=>{const __rows:any[]=[];for(const n of pyIterable(pyAt(DIRECTOR_GRAPH,"nodes"))){if(pyBool(pyEqual(pyAt(n,"node_kind"),"tiebreak-order"))){__rows.push(pyAt(pyAt(n,"properties"),"order"));}}return __rows;})())));
}
Object.defineProperty(tiebreak,"__pySignature",{value:[]});
export async function weighted(action:any,condition:any,structure:any=STRUCTURE){
return (await pyInvoke(pyRound,[pyMultiply((await pyInvoke(rule,[action,condition],{})),(await pyInvoke(weight,[action,structure],{}))),(await pyInvoke(threshold,["score-precision-digits"],{}))],{}));
}
Object.defineProperty(weighted,"__pySignature",{value:[{"name":"action","rest":false,"varargs":false},{"name":"condition","rest":false,"varargs":false},{"name":"structure","rest":false,"varargs":false}]});
export async function capped_linear(action:any,condition:any,steps:any,structure:any=STRUCTURE){
let base:any,per_turn:any,cap:any;
const __unpack2691=(await pyInvoke(rule,[action,condition],{}));base=__unpack2691[0];per_turn=__unpack2691[1];cap=__unpack2691[2];
return (await pyInvoke(pyRound,[pyMultiply((await pyInvoke(pyMin,[cap,pyAdd(base,pyMultiply(per_turn,steps))],{})),(await pyInvoke(weight,[action,structure],{}))),(await pyInvoke(threshold,["score-precision-digits"],{}))],{}));
}
Object.defineProperty(capped_linear,"__pySignature",{value:[{"name":"action","rest":false,"varargs":false},{"name":"condition","rest":false,"varargs":false},{"name":"steps","rest":false,"varargs":false},{"name":"structure","rest":false,"varargs":false}]});
export async function grounded_names(director_node_ids:any){
let refs:any,sources:any,targets:any,decisions:any,names:any,decision_refs:any;

refs=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(ONTOLOGY,"references"))){__rows.push([pyAt(r,"ref_id"),r]);}return __rows;})()));
sources=new Set((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(ONTOLOGY,"references"))){if(pyBool(pyContains(director_node_ids,pyAt(r,"semantic_id")))){__rows.push(pyAt(r,"ref_id"));}}return __rows;})()));
targets=(await pyInvoke(pySorted,[new Set((await (async()=>{const __rows:any[]=[];for(const rel of pyIterable(pyAt(ONTOLOGY,"relations"))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(rel,"relation_kind"),"grounded-by");return pyBool(__left)?pyContains(sources,pyAt(rel,"from_ref")):__left})()))){__rows.push(pyAt(pyAt(refs,pyAt(rel,"to_ref")),"semantic_id"));}}return __rows;})()))],{}));
decisions=(await (async()=>{const __rows:any[]=[];for(const t of pyIterable(targets)){if(pyBool((await pyMethod(t,"startswith",["decision:"],{})))){__rows.push(t);}}return __rows;})());
names=(await (async()=>{const __rows:any[]=[];for(const t of pyIterable(targets)){__rows.push((pyBool((await pyMethod(t,"startswith",["decision:"],{})))?(await pyMethod(":","join",[pySlice((await pyMethod(t,"split",[":"],{})),2,undefined)],{})):t));}return __rows;})());
decision_refs=new Set((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(ONTOLOGY,"references"))){if(pyBool(pyContains(decisions,pyAt(r,"semantic_id")))){__rows.push(pyAt(r,"ref_id"));}}return __rows;})()));
(await pyMethod(names,"extend",[(await pyInvoke(pySorted,[new Set((await (async()=>{const __rows:any[]=[];for(const rel of pyIterable(pyAt(ONTOLOGY,"relations"))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(rel,"relation_kind"),"may-emit-effect");return pyBool(__left)?pyContains(decision_refs,pyAt(rel,"from_ref")):__left})()))){__rows.push(pyAt(pyAt(refs,pyAt(rel,"to_ref")),"semantic_id"));}}return __rows;})()))],{}))],{}));
return names;
}
Object.defineProperty(grounded_names,"__pySignature",{value:[{"name":"director_node_ids","rest":false,"varargs":true}]});
export async function director_of(client:any){
return pyAt((await pyMethod(client,"table",["capsule"],{})),"director");
}
Object.defineProperty(director_of,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function next_turn(client:any,turn:any,text:any="继续。",narration:any="……"){

(await pyInvoke(narrate,[client,`t${turn}-c9`,narration],{}));
return pyAt(pyAt((await pyMethod(client,"table",["player_input"],{"text":text})),"capsule"),"director");
}
Object.defineProperty(next_turn,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"turn","rest":false,"varargs":false},{"name":"text","rest":false,"varargs":false},{"name":"narration","rest":false,"varargs":false}]});

export async function test_first_turn_character_scores_the_graph_value_times_the_structure_weight(kernel:any){
let director:any;
director=pyAt(pyAt((await pyInvoke(open_turn,[kernel,"我打量诺特。"],{})),"capsule"),"director");
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"CHARACTER")),"tests/kernel/test_director_scoring.py:93 assert director[\"beat\"] == \"CHARACTER\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"CHARACTER"),(await pyInvoke(weighted,["CHARACTER","agenda-npc-in-scene"],{})))),"tests/kernel/test_director_scoring.py:94 assert director[\"scores\"][\"CHARACTER\"] == weighted(\"CHARACTER\", \"agenda-npc-in-scene\")");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"PRESSURE"),(await pyInvoke(weighted,["PRESSURE","baseline"],{})))),"tests/kernel/test_director_scoring.py:95 assert director[\"scores\"][\"PRESSURE\"] == weighted(\"PRESSURE\", \"baseline\")");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(director,"because"),"agenda_npc_present = 1");return pyBool(__left)?pyContains(pyAt(director,"because"),`structure_type = ${STRUCTURE}`):__left})())),"tests/kernel/test_director_scoring.py:96 assert \"agenda_npc_present = 1\" in director[\"because\"] and f\"structure_type = {STRUCTURE}\" in director[\"because\"]");
assert.ok(pyBool(pyEqual(pyAt(director,"grounded_by"),[])),"tests/kernel/test_director_scoring.py:97 assert director[\"grounded_by\"] == []");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(director,"override");return pyBool(__left)?!pyContains(director,"reveal"):__left})())),"tests/kernel/test_director_scoring.py:98 assert \"override\" not in director and \"reveal\" not in director");
assert.ok(pyBool((await pyMethod(pyAt(director,"reason"),"startswith",["CHARACTER"],{}))),"tests/kernel/test_director_scoring.py:99 assert director[\"reason\"].startswith(\"CHARACTER\")");
}
Object.defineProperty(test_first_turn_character_scores_the_graph_value_times_the_structure_weight,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_first_turn_character_scores_the_graph_value_times_the_structure_weight"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_first_turn_character_scores_the_graph_value_times_the_structure_weight(await kernel(t,{}));});
export async function test_reveal_on_investigate_intent_with_gates_and_registry_grounding(seeded_kernel:any){
let kernel:any,director:any,reveal:any,gates:any;
kernel=seeded_kernel;
(await pyInvoke(open_turn,[kernel,"我仔细观察诺特。"],{}));
(await pyInvoke(resolve,[kernel,"t1-c1"],{"intent":"investigate","goal":"看他有没有隐瞒","method":"用侦查","skill":"Spot Hidden"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"clue",["clue"]:"knott-keys"})]}));
director=(await pyInvoke(next_turn,[kernel,1],{}));
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"REVEAL")),"tests/kernel/test_director_scoring.py:108 assert director[\"beat\"] == \"REVEAL\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"REVEAL"),(await pyInvoke(weighted,["REVEAL","investigate-intent"],{})))),"tests/kernel/test_director_scoring.py:109 assert director[\"scores\"][\"REVEAL\"] == weighted(\"REVEAL\", \"investigate-intent\")");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"DEEPEN"),(await pyInvoke(weighted,["DEEPEN","dramatic-question-present"],{})))),"tests/kernel/test_director_scoring.py:110 assert director[\"scores\"][\"DEEPEN\"] == weighted(\"DEEPEN\", \"dramatic-question-present\")");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(director,"because"),"intent = investigate");return pyBool(__left)?pyContains(pyAt(director,"because"),"undiscovered_here = 3"):__left})())),"tests/kernel/test_director_scoring.py:111 assert \"intent = investigate\" in director[\"because\"] and \"undiscovered_here = 3\" in director[\"because\"]");
reveal=pyAt(director,"reveal");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __term0=0;const __term1=(await pyInvoke(pyLen,[reveal],{}));const __term2=5;return pyCompare(__term0,__term1,"<")&&pyCompare(__term1,__term2,"<=");})());return pyBool(__left)?pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(reveal)){__rows.push(pyAt(r,"clue"));}return __rows;})())),pySubtract((await pyInvoke(pySet,[BRIEFING_CLUES],{})),new Set(["knott-keys"]))):__left})())),"tests/kernel/test_director_scoring.py:113 assert 0 < len(reveal) <= 5 and {r[\"clue\"] for r in reveal} == set(BRIEFING_CLUES) - {\"knott-keys\"}");
gates=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(reveal)){__rows.push([pyAt(r,"clue"),pyAt(r,"gate")]);}return __rows;})()));
assert.ok(pyBool(pyEqual(pyAt(gates,"knott-commission"),"npc_dialogue: check unspecified")),"tests/kernel/test_director_scoring.py:116 assert gates[\"knott-commission\"] == \"npc_dialogue: check unspecified\"");
assert.ok(pyBool(pyEqual(pyAt(gates,"knott-research-leads"),"npc_dialogue: check unspecified; guarded by obligation knott-accept-commission")),"tests/kernel/test_director_scoring.py:118 assert gates[\"knott-research-leads\"] == \"npc_dialogue: check unspecified; guarded by obligation knott-accept-commission\"");
assert.ok(pyBool(pyEqual(pyAt(director,"grounded_by"),(await pyInvoke(grounded_names,["scoring-rule:reveal:investigate-intent"],{})))),"tests/kernel/test_director_scoring.py:119 assert director[\"grounded_by\"] == grounded_names(\"scoring-rule:reveal:investigate-intent\")");
assert.ok(pyBool(pyContains(pyAt(director,"grounded_by"),"core-check:ordinary-check")),"tests/kernel/test_director_scoring.py:120 assert \"core-check:ordinary-check\" in director[\"grounded_by\"]");
assert.ok(pyBool(pyContains(pyAt(director,"grounded_by"),"effect:coc7:magic:learn-spell-spell-learned")),"tests/kernel/test_director_scoring.py:121 assert \"effect:coc7:magic:learn-spell-spell-learned\" in director[\"grounded_by\"]");
}
Object.defineProperty(test_reveal_on_investigate_intent_with_gates_and_registry_grounding,"__pySignature",{value:[{"name":"seeded_kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_reveal_on_investigate_intent_with_gates_and_registry_grounding"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_reveal_on_investigate_intent_with_gates_and_registry_grounding(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_reveal_on_social_intent_scores_lower_than_investigate(seeded_kernel:any){
let kernel:any,director:any;
kernel=seeded_kernel;
(await pyInvoke(open_turn,[kernel,"我恭维诺特。"],{}));
(await pyInvoke(resolve,[kernel,"t1-c1"],{"intent":"social","goal":"让他多说点","method":"用魅惑套话","target":"Steven Knott"}));
director=(await pyInvoke(next_turn,[kernel,1],{}));
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"REVEAL")),"tests/kernel/test_director_scoring.py:129 assert director[\"beat\"] == \"REVEAL\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"REVEAL"),(await pyInvoke(weighted,["REVEAL","social-intent"],{})))),"tests/kernel/test_director_scoring.py:130 assert director[\"scores\"][\"REVEAL\"] == weighted(\"REVEAL\", \"social-intent\")");
assert.ok(pyBool(pyEqual(pyAt(director,"grounded_by"),(await pyInvoke(grounded_names,["scoring-rule:reveal:social-intent"],{})))),"tests/kernel/test_director_scoring.py:131 assert director[\"grounded_by\"] == grounded_names(\"scoring-rule:reveal:social-intent\")");
}
Object.defineProperty(test_reveal_on_social_intent_scores_lower_than_investigate,"__pySignature",{value:[{"name":"seeded_kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_reveal_on_social_intent_scores_lower_than_investigate"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_reveal_on_social_intent_scores_lower_than_investigate(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_choice_on_idle_intent_with_two_undiscovered_clues(kernel:any){
let director:any;
(await pyInvoke(open_turn,[kernel,"我发呆。"],{}));
(await pyInvoke(resolve,[kernel,"t1-c1"],{"intent":"idle","goal":"","method":""}));
director=(await pyInvoke(next_turn,[kernel,1],{}));
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"CHOICE")),"tests/kernel/test_director_scoring.py:138 assert director[\"beat\"] == \"CHOICE\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"CHOICE"),(await pyInvoke(weighted,["CHOICE","two-undiscovered-clues"],{})))),"tests/kernel/test_director_scoring.py:139 assert director[\"scores\"][\"CHOICE\"] == weighted(\"CHOICE\", \"two-undiscovered-clues\")");
assert.ok(pyBool(pyLessEqual((await pyInvoke(threshold,["choice-undiscovered-clue-count"],{})),4)),"tests/kernel/test_director_scoring.py:140 assert 4 >= threshold(\"choice-undiscovered-clue-count\")");
assert.ok(pyBool(pyEqual(pyAt(director,"grounded_by"),[])),"tests/kernel/test_director_scoring.py:141 assert director[\"grounded_by\"] == []");
}
Object.defineProperty(test_choice_on_idle_intent_with_two_undiscovered_clues,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_choice_on_idle_intent_with_two_undiscovered_clues"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_choice_on_idle_intent_with_two_undiscovered_clues(await kernel(t,{}));});
export async function test_cut_on_explicit_move_intent(kernel:any){
let director:any;
(await pyInvoke(open_turn,[kernel,"我们出发去档案馆。"],{}));
(await pyInvoke(resolve,[kernel,"t1-c1"],{"intent":"move","goal":"去档案馆","method":"走过去"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"clue",["clue"]:"knott-keys"})]}));
director=(await pyInvoke(next_turn,[kernel,1],{}));
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"CUT")),"tests/kernel/test_director_scoring.py:149 assert director[\"beat\"] == \"CUT\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"CUT"),(await pyInvoke(weighted,["CUT","explicit-move-intent"],{})))),"tests/kernel/test_director_scoring.py:150 assert director[\"scores\"][\"CUT\"] == weighted(\"CUT\", \"explicit-move-intent\")");
assert.ok(pyBool(pyEqual(pyAt(director,"grounded_by"),(await pyInvoke(grounded_names,["scoring-rule:cut:explicit-move-intent"],{})))),"tests/kernel/test_director_scoring.py:151 assert director[\"grounded_by\"] == grounded_names(\"scoring-rule:cut:explicit-move-intent\")");
}
Object.defineProperty(test_cut_on_explicit_move_intent,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_cut_on_explicit_move_intent"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_cut_on_explicit_move_intent(await kernel(t,{}));});
export async function test_cut_on_a_met_exit_condition_beats_character(kernel:any){
let director:any;
(await pyInvoke(open_turn,[kernel,"我问他线索。"],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-research-leads"})]}));
director=(await pyInvoke(next_turn,[kernel,1],{}));
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(director,"because"),"exit_condition_met = True");return pyBool(__left)?pyContains(pyAt(director,"because"),"intent = none"):__left})())),"tests/kernel/test_director_scoring.py:158 assert \"exit_condition_met = True\" in director[\"because\"] and \"intent = none\" in director[\"because\"]");
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"CUT")),"tests/kernel/test_director_scoring.py:159 assert director[\"beat\"] == \"CUT\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"CUT"),(await pyInvoke(weighted,["CUT","exit-condition-met"],{})))),"tests/kernel/test_director_scoring.py:160 assert director[\"scores\"][\"CUT\"] == weighted(\"CUT\", \"exit-condition-met\")");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"CHARACTER"),(await pyInvoke(weighted,["CHARACTER","agenda-npc-in-scene"],{})))),"tests/kernel/test_director_scoring.py:161 assert director[\"scores\"][\"CHARACTER\"] == weighted(\"CHARACTER\", \"agenda-npc-in-scene\")");
}
Object.defineProperty(test_cut_on_a_met_exit_condition_beats_character,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_cut_on_a_met_exit_condition_beats_character"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_cut_on_a_met_exit_condition_beats_character(await kernel(t,{}));});
export async function test_cut_on_main_line_complete_from_a_reachable_conclusion(kernel:any){
let world_path:any,world:any,director:any;
(await pyInvoke(open_turn,[kernel,"我们把图书馆翻遍了。"],{}));
world_path=pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"world.json");
world=(await pyInvoke(read_json,[world_path],{}));
world["discovered_clues"]=(await pyInvoke(pyList,[DOCUMENTARY_HISTORY_CLUES],{}));
(await pyMethod(world_path,"write_text",[(await pyMethod(json,"dumps",[world],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
director=(await pyInvoke(director_of,[kernel],{}));
assert.ok(pyBool(pyContains(pyAt(director,"because"),"main_line_complete = True")),"tests/kernel/test_director_scoring.py:171 assert \"main_line_complete = True\" in director[\"because\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"CUT"),(await pyInvoke(weighted,["CUT","main-line-complete"],{})))),"tests/kernel/test_director_scoring.py:172 assert director[\"scores\"][\"CUT\"] == weighted(\"CUT\", \"main-line-complete\")");
}
Object.defineProperty(test_cut_on_main_line_complete_from_a_reachable_conclusion,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_cut_on_main_line_complete_from_a_reachable_conclusion"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_cut_on_main_line_complete_from_a_reachable_conclusion(await kernel(t,{}));});
export async function test_montage_intent_scores_but_loses_to_an_agenda_npc(kernel:any){
let director:any;
(await pyInvoke(open_turn,[kernel,"我们花一下午翻报纸。"],{}));
(await pyInvoke(resolve,[kernel,"t1-c1"],{"intent":"montage","goal":"翻报纸","method":""}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"clue",["clue"]:"knott-keys"})]}));
director=(await pyInvoke(next_turn,[kernel,1],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"MONTAGE"),(await pyInvoke(weighted,["MONTAGE","montage-intent"],{})))),"tests/kernel/test_director_scoring.py:180 assert director[\"scores\"][\"MONTAGE\"] == weighted(\"MONTAGE\", \"montage-intent\")");
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"CHARACTER")),"tests/kernel/test_director_scoring.py:181 assert director[\"beat\"] == \"CHARACTER\"");
}
Object.defineProperty(test_montage_intent_scores_but_loses_to_an_agenda_npc,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_montage_intent_scores_but_loses_to_an_agenda_npc"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_montage_intent_scores_but_loses_to_an_agenda_npc(await kernel(t,{}));});
export async function test_pressure_on_a_stalled_turn_ties_with_cut_and_the_tiebreak_order_decides(kernel:any){
let director:any,pressure:any,cut:any,order:any;
(await pyInvoke(open_turn,[kernel,"我们走吧。"],{}));
(await pyInvoke(resolve,[kernel,"t1-c1"],{"intent":"move","goal":"离开","method":"走"}));
director=(await pyInvoke(next_turn,[kernel,1],{}));
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(director,"because"),"stalled_turns = 1");return pyBool(__left)?pyLessEqual((await pyInvoke(threshold,["pressure-stalled-turns"],{})),1):__left})())),"tests/kernel/test_director_scoring.py:188 assert \"stalled_turns = 1\" in director[\"because\"] and 1 >= threshold(\"pressure-stalled-turns\")");
pressure=(await pyInvoke(weighted,["PRESSURE","clock-near-full-or-stalled"],{}));
cut=(await pyInvoke(weighted,["CUT","explicit-move-intent"],{}));
assert.ok(pyBool(pyEqual(pressure,cut)),pyStr("the fixture relies on the graph tying these two"));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(director,"scores"),"PRESSURE"),pressure);return pyBool(__left)?pyEqual(pyAt(pyAt(director,"scores"),"CUT"),cut):__left})())),"tests/kernel/test_director_scoring.py:192 assert director[\"scores\"][\"PRESSURE\"] == pressure and director[\"scores\"][\"CUT\"] == cut");
order=(await pyInvoke(tiebreak,[],{}));
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),((pyBool(pyLess((await pyMethod(order,"index",["PRESSURE"],{})),(await pyMethod(order,"index",["CUT"],{}))))?"PRESSURE":"CUT")))),"tests/kernel/test_director_scoring.py:194 assert director[\"beat\"] == (\"PRESSURE\" if order.index(\"PRESSURE\") < order.index(\"CUT\") else \"CUT\")");
}
Object.defineProperty(test_pressure_on_a_stalled_turn_ties_with_cut_and_the_tiebreak_order_decides,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_pressure_on_a_stalled_turn_ties_with_cut_and_the_tiebreak_order_decides"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_pressure_on_a_stalled_turn_ties_with_cut_and_the_tiebreak_order_decides(await kernel(t,{}));});
export async function test_recover_yielded_scene_and_stalled_transition_after_two_stalled_turns(kernel:any){
let turn:any,director:any;
(await pyInvoke(open_turn,[kernel,"我把办公室翻了个遍。"],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":(await (async()=>{const __rows:any[]=[];for(const c of pyIterable(BRIEFING_CLUES)){__rows.push(({["kind"]:"clue",["clue"]:c}));}return __rows;})())}));
(await pyInvoke(narrate,[kernel,"t1-c2","都找到了。"],{}));
for(turn of pyIterable([2,3])){
(await pyMethod(kernel,"table",["player_input"],{"text":"我等着。"}));
(await pyInvoke(resolve,[kernel,`t${turn}-c1`],{"intent":"idle","goal":"","method":""}));
(await pyInvoke(narrate,[kernel,`t${turn}-c2`,"没有别的。"],{}));
}
director=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"还是等。"})),"capsule"),"director");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(director,"because"),"stalled_turns = 2");return pyBool(__left)?pyContains(pyAt(director,"because"),"turns_in_scene = 4"):__left})())),"tests/kernel/test_director_scoring.py:206 assert \"stalled_turns = 2\" in director[\"because\"] and \"turns_in_scene = 4\" in director[\"because\"]");
assert.ok(pyBool(pyContains(pyAt(director,"because"),"undiscovered_here = 0")),"tests/kernel/test_director_scoring.py:207 assert \"undiscovered_here = 0\" in director[\"because\"]");
assert.ok(pyBool((await (async()=>{const __left=pyLessEqual((await pyInvoke(threshold,["recover-stalled-turns"],{})),2);return pyBool(__left)?pyLessEqual((await pyInvoke(threshold,["cut-stalled-transition-turns"],{})),2):__left})())),"tests/kernel/test_director_scoring.py:208 assert 2 >= threshold(\"recover-stalled-turns\") and 2 >= threshold(\"cut-stalled-transition-turns\")");
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"RECOVER")),"tests/kernel/test_director_scoring.py:209 assert director[\"beat\"] == \"RECOVER\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"RECOVER"),(await pyInvoke(weighted,["RECOVER","stalled-turns"],{})))),"tests/kernel/test_director_scoring.py:210 assert director[\"scores\"][\"RECOVER\"] == weighted(\"RECOVER\", \"stalled-turns\")");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"PRESSURE"),(await pyInvoke(weighted,["PRESSURE","yielded-scene"],{})))),"tests/kernel/test_director_scoring.py:211 assert director[\"scores\"][\"PRESSURE\"] == weighted(\"PRESSURE\", \"yielded-scene\")");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"CUT"),(await pyInvoke(pyMax,[(await pyInvoke(weighted,["CUT","exit-condition-met"],{})),(await pyInvoke(capped_linear,["CUT","stalled-transition-pressure",2],{}))],{})))),"tests/kernel/test_director_scoring.py:213 assert director[\"scores\"][\"CUT\"] == max(weighted(\"CUT\", \"exit-condition-met\"),\n                                            capped_linear(\"CUT\", \"stalled-transition-pressure\", 2))");
}
Object.defineProperty(test_recover_yielded_scene_and_stalled_transition_after_two_stalled_turns,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_recover_yielded_scene_and_stalled_transition_after_two_stalled_turns"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_recover_yielded_scene_and_stalled_transition_after_two_stalled_turns(await kernel(t,{}));});
export async function test_payoff_rises_with_structured_memory_overlap(kernel:any){
let narrated:any,director:any;
(await pyInvoke(open_turn,[kernel,"我和诺特谈。"],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-keys"})]}));
narrated=(await pyInvoke(narrate,[kernel,"t1-c2","诺特答应了。"],{}));
(await pyMethod(kernel,"ok",["memory.submit",({["campaign"]:"c1",["job_id"]:pyAt(pyAt(narrated,"extraction"),"job_id"),["candidates"]:[({["kind"]:"knowledge",["subject"]:"Steven Knott",["statement"]:"诺特知道马卡里奥一家的下落。"})]})],{}));
director=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"继续。"})),"capsule"),"director");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"PAYOFF"),(await pyInvoke(capped_linear,["PAYOFF","structured-entity-overlap",1],{})))),"tests/kernel/test_director_scoring.py:224 assert director[\"scores\"][\"PAYOFF\"] == capped_linear(\"PAYOFF\", \"structured-entity-overlap\", 1)");
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"CHARACTER")),"tests/kernel/test_director_scoring.py:225 assert director[\"beat\"] == \"CHARACTER\"");
}
Object.defineProperty(test_payoff_rises_with_structured_memory_overlap,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_payoff_rises_with_structured_memory_overlap"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_payoff_rises_with_structured_memory_overlap(await kernel(t,{}));});
export async function test_subsystem_scores_from_combat_intent_after_the_fight_ended(tmp_path:any){
let client:any,n:any,record:any,director:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"9"})})));
try{(await pyInvoke(open_turn,[client,"我举枪对准棺材里的东西。"],{}));
n=(await pyInvoke(walk_to_confrontation,[client],{}));
(await pyInvoke(resolve,[client,`t1-c${n}`],{"intent":"combat","goal":"朝科比特开枪","method":"用左轮射击","target":"Walter Corbitt","weapon":".38 Revolver"}));
(await pyInvoke(resolve,[client,`t1-c${pyAdd(n,1)}`],{"intent":"combat","goal":"他迎着子弹","method":"","actor":"Walter Corbitt","defense":"none"}));
(await pyInvoke(resolve,[client,`t1-c${pyAdd(n,2)}`],{"intent":"combat","goal":"双方僵持","method":"","decision":"combat:end","outcome":"stalemate"}));
assert.ok(pyBool((pyAt(pyAt((await pyMethod(client,"table",["look"],{})),"where"),"session")===null)),"tests/kernel/test_director_scoring.py:237 assert client.table(\"look\")[\"where\"][\"session\"] is None");
(await pyInvoke(narrate,[client,`t1-c${pyAdd(n,3)}`,"枪声停了。"],{}));
record=(await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"turns"),"0001.json")],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(record,"intents"),(-1)),"combat")),"tests/kernel/test_director_scoring.py:240 assert record[\"intents\"][-1] == \"combat\"");
director=pyAt(pyAt((await pyMethod(client,"table",["player_input"],{"text":"我盯着他。"})),"capsule"),"director");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(director,"because"),"session = none");return pyBool(__left)?pyContains(pyAt(director,"because"),"intent = combat"):__left})())),"tests/kernel/test_director_scoring.py:242 assert \"session = none\" in director[\"because\"] and \"intent = combat\" in director[\"because\"]");
if(pyBool(!pyContains(director,"override"))){assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"SUBSYSTEM")),"tests/kernel/test_director_scoring.py:244 assert director[\"beat\"] == \"SUBSYSTEM\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"SUBSYSTEM"),(await pyInvoke(weighted,["SUBSYSTEM","combat-flee-cast-intent"],{})))),"tests/kernel/test_director_scoring.py:245 assert director[\"scores\"][\"SUBSYSTEM\"] == weighted(\"SUBSYSTEM\", \"combat-flee-cast-intent\")");
assert.ok(pyBool(pyEqual(pyAt(director,"grounded_by"),(await pyInvoke(grounded_names,["scoring-rule:subsystem:combat-flee-cast-intent"],{})))),"tests/kernel/test_director_scoring.py:246 assert director[\"grounded_by\"] == grounded_names(\"scoring-rule:subsystem:combat-flee-cast-intent\")");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(director,"grounded_by"),"combat:attack");return pyBool(__left)?pyContains(pyAt(director,"grounded_by"),"magic:cast-spell"):__left})())),"tests/kernel/test_director_scoring.py:247 assert \"combat:attack\" in director[\"grounded_by\"] and \"magic:cast-spell\" in director[\"grounded_by\"]");}}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_subsystem_scores_from_combat_intent_after_the_fight_ended,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_subsystem_scores_from_combat_intent_after_the_fight_ended"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_subsystem_scores_from_combat_intent_after_the_fight_ended(temporary);});
export async function test_advance_is_the_default_and_grounds_nothing(kernel:any){
let director:any;
(await pyInvoke(open_turn,[kernel,"我们去房子。"],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"corbitt-house-ground"}),...(await (async()=>{const __rows:any[]=[];for(const c of pyIterable(GROUND_FLOOR_CLUES)){__rows.push(({["kind"]:"clue",["clue"]:c}));}return __rows;})())]}));
(await pyInvoke(resolve,[kernel,"t1-c2"],{"intent":"idle","goal":"","method":""}));
director=(await pyInvoke(next_turn,[kernel,1],{}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(director,"beat"),"ADVANCE");return pyBool(__left)?pyEqual(pyAt(director,"scores"),({})):__left})());return pyBool(__left)?pyEqual(pyAt(director,"grounded_by"),[]):__left})())),"tests/kernel/test_director_scoring.py:258 assert director[\"beat\"] == \"ADVANCE\" and director[\"scores\"] == {} and director[\"grounded_by\"] == []");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(director,"override");return pyBool(__left)?!pyContains(director,"reveal"):__left})())),"tests/kernel/test_director_scoring.py:259 assert \"override\" not in director and \"reveal\" not in director");
assert.ok(pyBool(pyAt(director,"reason")),"tests/kernel/test_director_scoring.py:260 assert director[\"reason\"]");
}
Object.defineProperty(test_advance_is_the_default_and_grounds_nothing,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_advance_is_the_default_and_grounds_nothing"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_advance_is_the_default_and_grounds_nothing(await kernel(t,{}));});

export async function test_pending_choice_overrides_to_choice(kernel:any){
let director:any;
(await pyInvoke(open_turn,[kernel,"我问他。"],{}));
(await pyMethod(kernel,"table",["ask"],{"call_id":"t1-c1","prompt":"你要收下钥匙吗？","options":["收下","拒绝"]}));
director=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"收下。"})),"capsule"),"director");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(director,"beat"),"CHOICE");return pyBool(__left)?pyEqual(pyAt(director,"override"),"pending_choice"):__left})())),"tests/kernel/test_director_scoring.py:269 assert director[\"beat\"] == \"CHOICE\" and director[\"override\"] == \"pending_choice\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(director,"scores"),({["CHOICE"]:1.0}));return pyBool(__left)?pyEqual(pyAt(director,"grounded_by"),[]):__left})())),"tests/kernel/test_director_scoring.py:270 assert director[\"scores\"] == {\"CHOICE\": 1.0} and director[\"grounded_by\"] == []");
assert.ok(pyBool(pyContains(pyAt(director,"because"),"pending_choice = True")),"tests/kernel/test_director_scoring.py:271 assert \"pending_choice = True\" in director[\"because\"]");
}
Object.defineProperty(test_pending_choice_overrides_to_choice,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_pending_choice_overrides_to_choice"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_pending_choice_overrides_to_choice(await kernel(t,{}));});
export async function test_fumble_overrides_to_pressure(kernel:any){
let record_path:any,record:any,director:any;
(await pyInvoke(open_turn,[kernel,"我翻抽屉。"],{}));
(await pyInvoke(resolve,[kernel,"t1-c1"],{"intent":"investigate","goal":"找线索","method":"用侦查","skill":"Spot Hidden"}));
(await pyInvoke(narrate,[kernel,"t1-c2","手一滑。"],{}));
record_path=pyDivide(pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"turns"),"0001.json");
record=(await pyInvoke(read_json,[record_path],{}));
(await pyMethod(pyAt(pyAt(record,"receipts"),(-1)),"update",[({["level"]:"fumble",["passed"]:false})],{}));
(await pyMethod(record_path,"write_text",[(await pyMethod(json,"dumps",[record],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
director=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"糟了。"})),"capsule"),"director");
assert.ok(pyBool(pyContains(pyAt(director,"because"),"last_roll = fumble")),"tests/kernel/test_director_scoring.py:283 assert \"last_roll = fumble\" in director[\"because\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(director,"beat"),"PRESSURE");return pyBool(__left)?pyEqual(pyAt(director,"override"),"fumble"):__left})())),"tests/kernel/test_director_scoring.py:284 assert director[\"beat\"] == \"PRESSURE\" and director[\"override\"] == \"fumble\"");
}
Object.defineProperty(test_fumble_overrides_to_pressure,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_fumble_overrides_to_pressure"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_fumble_overrides_to_pressure(await kernel(t,{}));});
export async function test_dying_overrides_to_subsystem_with_pressure_and_the_registered_grounding(kernel:any){
let director:any;
(await pyInvoke(open_turn,[kernel,"我倒在地上。"],{}));
(await pyInvoke(seed_wound,[kernel.workspace,0],{"conditions":["major_wound","dying"],"minutes_ago":5}));
director=(await pyInvoke(director_of,[kernel],{}));
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(director,"because"),"hp_state = dying");return pyBool(__left)?pyContains(pyAt(director,"because"),"extra = PRESSURE"):__left})())),"tests/kernel/test_director_scoring.py:291 assert \"hp_state = dying\" in director[\"because\"] and \"extra = PRESSURE\" in director[\"because\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(director,"beat"),"SUBSYSTEM");return pyBool(__left)?pyEqual(pyAt(director,"override"),"dying"):__left})())),"tests/kernel/test_director_scoring.py:292 assert director[\"beat\"] == \"SUBSYSTEM\" and director[\"override\"] == \"dying\"");
assert.ok(pyBool(pyEqual(pyAt(director,"grounded_by"),(await pyInvoke(grounded_names,["craft-directive:dying-forces-rescue-subsystem","craft-directive:dying-clock-kind"],{})))),"tests/kernel/test_director_scoring.py:293 assert director[\"grounded_by\"] == grounded_names(\"craft-directive:dying-forces-rescue-subsystem\",\n                                                     \"craft-directive:dying-clock-kind\")");
assert.ok(pyBool(pyLessEqual(new Set(["healing:dying-hour-clock","healing:dying-round-clock","rule:coc7:healing:dying-entry"]),(await pyInvoke(pySet,[pyAt(director,"grounded_by")],{})))),"tests/kernel/test_director_scoring.py:295 assert {\"healing:dying-hour-clock\", \"healing:dying-round-clock\", \"rule:coc7:healing:dying-entry\"} <= set(director[\"grounded_by\"])");
}
Object.defineProperty(test_dying_overrides_to_subsystem_with_pressure_and_the_registered_grounding,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_dying_overrides_to_subsystem_with_pressure_and_the_registered_grounding"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_dying_overrides_to_subsystem_with_pressure_and_the_registered_grounding(await kernel(t,{}));});
export async function test_live_session_overrides_to_subsystem_grounded_by_the_session_rule(tmp_path:any){
let client:any,n:any,director:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"9"})})));
try{(await pyInvoke(open_turn,[client,"我举枪。"],{}));
n=(await pyInvoke(walk_to_confrontation,[client],{}));
(await pyInvoke(resolve,[client,`t1-c${n}`],{"intent":"combat","goal":"开枪","method":"用左轮射击","target":"Walter Corbitt","weapon":".38 Revolver"}));
director=(await pyInvoke(director_of,[client],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(director,"beat"),"SUBSYSTEM");return pyBool(__left)?pyEqual(pyAt(director,"override"),"session"):__left})())),"tests/kernel/test_director_scoring.py:305 assert director[\"beat\"] == \"SUBSYSTEM\" and director[\"override\"] == \"session\"");
assert.ok(pyBool(pyContains(pyAt(director,"because"),"session = combat")),"tests/kernel/test_director_scoring.py:306 assert \"session = combat\" in director[\"because\"]");
assert.ok(pyBool(pyEqual(pyAt(director,"grounded_by"),(await pyInvoke(grounded_names,["scoring-rule:subsystem:combat-flee-cast-intent"],{})))),"tests/kernel/test_director_scoring.py:307 assert director[\"grounded_by\"] == grounded_names(\"scoring-rule:subsystem:combat-flee-cast-intent\")");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_live_session_overrides_to_subsystem_grounded_by_the_session_rule,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_live_session_overrides_to_subsystem_grounded_by_the_session_rule"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_live_session_overrides_to_subsystem_grounded_by_the_session_rule(temporary);});
export async function test_hp_state_reads_the_rulebook_thresholds(kernel:any){
(await pyInvoke(open_turn,[kernel,"我受了伤。"],{}));
(await pyInvoke(seed_wound,[kernel.workspace,9],{"minutes_ago":10}));
assert.ok(pyBool(pyContains(pyAt((await pyInvoke(director_of,[kernel],{})),"because"),"hp_state = wounded")),"tests/kernel/test_director_scoring.py:315 assert \"hp_state = wounded\" in director_of(kernel)[\"because\"]");
(await pyInvoke(seed_wound,[kernel.workspace,3],{"conditions":["major_wound"],"minutes_ago":10}));
assert.ok(pyBool(pyContains(pyAt((await pyInvoke(director_of,[kernel],{})),"because"),"hp_state = major_wound")),"tests/kernel/test_director_scoring.py:317 assert \"hp_state = major_wound\" in director_of(kernel)[\"because\"]");
}
Object.defineProperty(test_hp_state_reads_the_rulebook_thresholds,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_hp_state_reads_the_rulebook_thresholds"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_hp_state_reads_the_rulebook_thresholds(await kernel(t,{}));});

export async function adoption_of(client:any,turn:any){
return pyAt((await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"turns"),`${pyFormat(turn,"04d")}.json`)],{})),"director_adoption");
}
Object.defineProperty(adoption_of,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"turn","rest":false,"varargs":false}]});
export async function director_telemetry(client:any){
return (await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await pyInvoke(read_jsonl,[pyDivide((await pyInvoke(campaign_dir,[client.workspace],{})),"telemetry.jsonl")],{})))){if(pyBool(pyEqual((await pyMethod(row,"get",["lane"],{})),"director"))){__rows.push(row);}}return __rows;})());
}
Object.defineProperty(director_telemetry,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function test_character_adoption_needs_someone_present_and_no_move(kernel:any){
let adoption:any,rows:any;
(await pyInvoke(open_turn,[kernel,"我和诺特聊。"],{}));
(await pyInvoke(narrate,[kernel,"t1-c1","他说了很多。"],{}));
adoption=(await pyInvoke(adoption_of,[kernel,1],{}));
assert.ok(pyBool(pyEqual(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const k of pyIterable(["beat","adopted","evidence"])){__rows.push([k,pyAt(adoption,k)]);}return __rows;})())),({["beat"]:"CHARACTER",["adopted"]:true,["evidence"]:[]}))),"tests/kernel/test_director_scoring.py:334 assert {k: adoption[k] for k in (\"beat\", \"adopted\", \"evidence\")} == {\"beat\": \"CHARACTER\", \"adopted\": True, \"evidence\": []}");
rows=(await pyInvoke(director_telemetry,[kernel],{}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(pyAt(rows,(-1)),"turn"),1);return pyBool(__left)?pyEqual(pyAt(pyAt(rows,(-1)),"beat"),"CHARACTER"):__left})());return pyBool(__left)?(pyAt(pyAt(rows,(-1)),"adopted")===true):__left})())),"tests/kernel/test_director_scoring.py:336 assert rows[-1][\"turn\"] == 1 and rows[-1][\"beat\"] == \"CHARACTER\" and rows[-1][\"adopted\"] is True");
(await pyMethod(kernel,"table",["player_input"],{"text":"我走了。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"move",["to"]:"central-library"})]}));
(await pyInvoke(narrate,[kernel,"t2-c2","你离开了。"],{}));
assert.ok(pyBool((pyAt((await pyInvoke(adoption_of,[kernel,2],{})),"adopted")===false)),"tests/kernel/test_director_scoring.py:340 assert adoption_of(kernel, 2)[\"adopted\"] is False");
}
Object.defineProperty(test_character_adoption_needs_someone_present_and_no_move,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_character_adoption_needs_someone_present_and_no_move"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_character_adoption_needs_someone_present_and_no_move(await kernel(t,{}));});
export async function test_cut_adoption_is_a_move_receipt(kernel:any){
let adoption:any;
(await pyInvoke(open_turn,[kernel,"我们出发。"],{}));
(await pyInvoke(resolve,[kernel,"t1-c1"],{"intent":"move","goal":"去图书馆","method":"走"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"clue",["clue"]:"knott-keys"})]}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(next_turn,[kernel,1],{})),"beat"),"CUT")),"tests/kernel/test_director_scoring.py:347 assert next_turn(kernel, 1)[\"beat\"] == \"CUT\"");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"move",["to"]:"central-library"})]}));
(await pyInvoke(narrate,[kernel,"t2-c2","到了。"],{}));
adoption=(await pyInvoke(adoption_of,[kernel,2],{}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(adoption,"beat"),"CUT");return pyBool(__left)?(pyAt(adoption,"adopted")===true):__left})());return pyBool(__left)?pyEqual(pyAt(adoption,"evidence"),["move:central-library-t2-c1"]):__left})())),"tests/kernel/test_director_scoring.py:351 assert adoption[\"beat\"] == \"CUT\" and adoption[\"adopted\"] is True and adoption[\"evidence\"] == [\"move:central-library-t2-c1\"]");
}
Object.defineProperty(test_cut_adoption_is_a_move_receipt,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_cut_adoption_is_a_move_receipt"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_cut_adoption_is_a_move_receipt(await kernel(t,{}));});
export async function test_choice_adoption_is_a_turn_closed_by_ask(kernel:any){
let adoption:any;
(await pyInvoke(open_turn,[kernel,"我发呆。"],{}));
(await pyInvoke(resolve,[kernel,"t1-c1"],{"intent":"idle","goal":"","method":""}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(next_turn,[kernel,1],{})),"beat"),"CHOICE")),"tests/kernel/test_director_scoring.py:357 assert next_turn(kernel, 1)[\"beat\"] == \"CHOICE\"");
(await pyMethod(kernel,"table",["ask"],{"call_id":"t2-c1","prompt":"先做哪件？","options":["问诺特","翻抽屉"]}));
adoption=(await pyInvoke(adoption_of,[kernel,2],{}));
assert.ok(pyBool(pyEqual(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const k of pyIterable(["beat","adopted","evidence"])){__rows.push([k,pyAt(adoption,k)]);}return __rows;})())),({["beat"]:"CHOICE",["adopted"]:true,["evidence"]:[]}))),"tests/kernel/test_director_scoring.py:360 assert {k: adoption[k] for k in (\"beat\", \"adopted\", \"evidence\")} == {\"beat\": \"CHOICE\", \"adopted\": True, \"evidence\": []}");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(director_telemetry,[kernel],{})),(-1)),"closed_by"),"ask")),"tests/kernel/test_director_scoring.py:361 assert director_telemetry(kernel)[-1][\"closed_by\"] == \"ask\"");
}
Object.defineProperty(test_choice_adoption_is_a_turn_closed_by_ask,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_choice_adoption_is_a_turn_closed_by_ask"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_choice_adoption_is_a_turn_closed_by_ask(await kernel(t,{}));});
export async function test_pressure_adoption_is_time_damage_or_a_negative_delta(kernel:any){
let director:any,adoption:any;
(await pyInvoke(open_turn,[kernel,"我们走吧。"],{}));
(await pyInvoke(resolve,[kernel,"t1-c1"],{"intent":"move","goal":"离开","method":"走"}));
director=(await pyInvoke(next_turn,[kernel,1],{}));
if(pyBool(!pyEqual(pyAt(director,"beat"),"PRESSURE"))){return ;}
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"time",["minutes"]:20})]}));
(await pyInvoke(narrate,[kernel,"t2-c2","时间流逝。"],{}));
adoption=(await pyInvoke(adoption_of,[kernel,2],{}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(adoption,"beat"),"PRESSURE");return pyBool(__left)?(pyAt(adoption,"adopted")===true):__left})());return pyBool(__left)?pyEqual(pyAt(adoption,"evidence"),["time:t2-c1"]):__left})())),"tests/kernel/test_director_scoring.py:373 assert adoption[\"beat\"] == \"PRESSURE\" and adoption[\"adopted\"] is True and adoption[\"evidence\"] == [\"time:t2-c1\"]");
}
Object.defineProperty(test_pressure_adoption_is_time_damage_or_a_negative_delta,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_pressure_adoption_is_time_damage_or_a_negative_delta"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_pressure_adoption_is_time_damage_or_a_negative_delta(await kernel(t,{}));});
export async function test_reveal_adoption_only_counts_a_listed_clue(seeded_kernel:any){
let kernel:any,director:any,adoption:any;
kernel=seeded_kernel;
(await pyInvoke(open_turn,[kernel,"我仔细观察诺特。"],{}));
(await pyInvoke(resolve,[kernel,"t1-c1"],{"intent":"investigate","goal":"看他","method":"用侦查","skill":"Spot Hidden"}));
director=(await pyInvoke(next_turn,[kernel,1],{}));
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"REVEAL")),"tests/kernel/test_director_scoring.py:381 assert director[\"beat\"] == \"REVEAL\"");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"clue",["clue"]:pyAt(pyAt(pyAt(director,"reveal"),0),"clue")})]}));
(await pyInvoke(narrate,[kernel,"t2-c2","找到了。"],{}));
adoption=(await pyInvoke(adoption_of,[kernel,2],{}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(adoption,"adopted")===true);return pyBool(__left)?pyEqual(pyAt(adoption,"evidence"),[`clue:${pyAt(pyAt(pyAt(director,"reveal"),0),"clue")}-t2`]):__left})())),"tests/kernel/test_director_scoring.py:385 assert adoption[\"adopted\"] is True and adoption[\"evidence\"] == [f\"clue:{director['reveal'][0]['clue']}-t2\"]");
}
Object.defineProperty(test_reveal_adoption_only_counts_a_listed_clue,"__pySignature",{value:[{"name":"seeded_kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_reveal_adoption_only_counts_a_listed_clue"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_reveal_adoption_only_counts_a_listed_clue(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
export async function test_a_pushed_failure_does_not_create_director_consequence_debt(tmp_path:any){
let client:any,call_id:any,_:any,n:any,pushed:any,director:any,digits:any,base:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"7"})})));
try{(await pyInvoke(open_turn,[client,"我翻抽屉。"],{}));
const __unpack21313=(await pyInvoke(first_failure,[client,"t1-c"],{"intent":"investigate","goal":"找线索","method":"用侦查","skill":"Spot Hidden"}));call_id=__unpack21313[0];_=__unpack21313[1];
n=pyAdd((await pyInvoke(pyInt,[pyAt((await pyMethod(call_id,"rsplit",["-c",1],{})),1)],{})),1);
pushed=(await pyInvoke(resolve,[client,`t1-c${n}`],{"intent":"investigate","goal":"找线索","method":"用侦查","skill":"Spot Hidden","push":true,"stakes":"抽屉会卡住"}));
if(pyBool((await pyMethod(pyAt(pushed,"outcome"),"get",["passed"],{})))){return ;}
(await pyInvoke(narrate,[client,`t1-c${pyAdd(n,1)}`,"还是没找到。"],{}));
director=pyAt(pyAt((await pyMethod(client,"table",["player_input"],{"text":"继续。"})),"capsule"),"director");
assert.ok(pyBool(!pyContains(pyAt(director,"because"),"pushed_fail_pending = True")),"tests/kernel/test_director_scoring.py:400 assert \"pushed_fail_pending = True\" not in director[\"because\"]");
if(pyBool(pyContains(director,"override"))){return ;}
digits=(await pyInvoke(threshold,["score-precision-digits"],{}));
assert.ok(pyBool(pyContains(pyAt(director,"because"),"stalled_turns = 1")),"tests/kernel/test_director_scoring.py:405 assert \"stalled_turns = 1\" in director[\"because\"]");
base=(await pyInvoke(pyMin,[(await pyInvoke(Number,[(await pyInvoke(threshold,["pressure-posture-ceiling"],{}))],{})),(await pyInvoke(pyRound,[(await pyInvoke(rule,["PRESSURE","clock-near-full-or-stalled"],{})),digits],{}))],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"PRESSURE"),(await pyInvoke(pyRound,[pyMultiply(base,(await pyInvoke(weight,["PRESSURE"],{}))),digits],{})))),"tests/kernel/test_director_scoring.py:408 assert director[\"scores\"][\"PRESSURE\"] == round(base * weight(\"PRESSURE\"), digits)");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_pushed_failure_does_not_create_director_consequence_debt,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_pushed_failure_does_not_create_director_consequence_debt"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_pushed_failure_does_not_create_director_consequence_debt(temporary);});
export async function test_a_live_session_still_scores_the_other_beats_so_a_stalled_fight_shows(tmp_path:any){
let client:any,n:any,director:any;

client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"9"})})));
try{(await pyInvoke(open_turn,[client,"我举枪。"],{}));
n=(await pyInvoke(walk_to_confrontation,[client],{}));
(await pyInvoke(resolve,[client,`t1-c${n}`],{"intent":"combat","goal":"开枪","method":"用左轮射击","target":"Walter Corbitt","weapon":".38 Revolver"}));
director=(await pyInvoke(next_turn,[client,1],{"text":"我举枪。"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(director,"beat"),"SUBSYSTEM");return pyBool(__left)?pyEqual(pyAt(director,"override"),"session"):__left})())),"tests/kernel/test_director_scoring.py:422 assert director[\"beat\"] == \"SUBSYSTEM\" and director[\"override\"] == \"session\"");
assert.ok(pyBool(pyContains(pyAt(director,"because"),"repeat_input = True")),"tests/kernel/test_director_scoring.py:423 assert \"repeat_input = True\" in director[\"because\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"SUBSYSTEM"),1.0)),"tests/kernel/test_director_scoring.py:424 assert director[\"scores\"][\"SUBSYSTEM\"] == 1.0");
assert.ok(pyBool(pyEqual(pyAt(pyAt(director,"scores"),"RECOVER"),(await pyInvoke(weighted,["RECOVER","repeated-input"],{})))),"tests/kernel/test_director_scoring.py:425 assert director[\"scores\"][\"RECOVER\"] == weighted(\"RECOVER\", \"repeated-input\")");
assert.ok(pyBool(pyEqual(pyAt(director,"grounded_by"),(await pyInvoke(grounded_names,["scoring-rule:subsystem:combat-flee-cast-intent"],{})))),"tests/kernel/test_director_scoring.py:426 assert director[\"grounded_by\"] == grounded_names(\"scoring-rule:subsystem:combat-flee-cast-intent\")");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_a_live_session_still_scores_the_other_beats_so_a_stalled_fight_shows,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_live_session_still_scores_the_other_beats_so_a_stalled_fight_shows"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_live_session_still_scores_the_other_beats_so_a_stalled_fight_shows(temporary);});
