// Migrated from tests/kernel/test_director_laws.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {RpcClient,campaign_dir,create_campaign,narrate,narrate_opening,open_turn,read_json,read_jsonl,resolve,walk_to_confrontation,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_director_laws.py',import.meta.url).pathname;







export let REPO_ROOT:any=pyAt((await pyMethod((await pyInvoke(Path,[__file__],{})),"resolve",[],{})).parents,2);
export let ONTOLOGY_PATH:any=pyDivide(pyDivide(pyDivide(REPO_ROOT,"content"),"ontology"),"system-ontology.json");
export let BEATS:any=new Set(["REVEAL","DEEPEN","PRESSURE","CHARACTER","CHOICE","CUT","MONTAGE","PAYOFF","RECOVER","SUBSYSTEM","ADVANCE"]);




export let GROUND_FLOOR_CLUES:any=["corbitt-diaries","upstairs-disturbance","catholic-wards","nailed-windows"];

export async function snapshot_files(directory:any){
let out:any,path:any;

out=({});
for(path of pyIterable((await pyInvoke(pySorted,[(await pyMethod(directory,"rglob",["*"],{}))],{})))){
if(pyBool((await pyMethod(path,"is_file",[],{})))){out[(await pyInvoke(pyStr,[(await pyMethod(path,"relative_to",[directory],{}))],{}))]=(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod(path,"read_bytes",[],{}))],{})),"hexdigest",[],{}));}
}
return out;
}
Object.defineProperty(snapshot_files,"__pySignature",{value:[{"name":"directory","rest":false,"varargs":false}]});
export async function load_ontology(){
return (await pyMethod(json,"loads",[(await pyMethod(ONTOLOGY_PATH,"read_text",[],{"encoding":"utf-8"}))],{}));
}
Object.defineProperty(load_ontology,"__pySignature",{value:[]});
export async function strip_ruleset_prefix(semantic_id:any){
let parts:any;

parts=(await pyMethod(semantic_id,"split",[":"],{}));
return (pyBool(pyLess(2,(await pyInvoke(pyLen,[parts],{}))))?(await pyMethod(":","join",[pySlice(parts,2,undefined)],{})):semantic_id);
}
Object.defineProperty(strip_ruleset_prefix,"__pySignature",{value:[{"name":"semantic_id","rest":false,"varargs":false}]});
export async function grounded_by_universe(ontology:any){
let refs:any,names:any,grounded_decision_refs:any,rel:any,target:any;

refs=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(ontology,"references"))){__rows.push([pyAt(r,"ref_id"),r]);}return __rows;})()));
names=(await pyInvoke(pySet,[],{}));
grounded_decision_refs=(await pyInvoke(pySet,[],{}));
for(rel of pyIterable(pyAt(ontology,"relations"))){
if(pyBool(!pyEqual(pyAt(rel,"relation_kind"),"grounded-by"))){continue;}
target=(await pyMethod(refs,"get",[pyAt(rel,"to_ref")],{}));
if(pyBool(!pyBool(target))){continue;}
(await pyMethod(grounded_decision_refs,"add",[pyAt(rel,"to_ref")],{}));
(await pyMethod(names,"add",[pyAt(target,"semantic_id")],{}));
(await pyMethod(names,"add",[(await pyInvoke(strip_ruleset_prefix,[pyAt(target,"semantic_id")],{}))],{}));
}
for(rel of pyIterable(pyAt(ontology,"relations"))){
if(pyBool((await (async()=>{const __left=!pyEqual(pyAt(rel,"relation_kind"),"may-emit-effect");return pyBool(__left)?__left:!pyContains(grounded_decision_refs,pyAt(rel,"from_ref"))})()))){continue;}
target=(await pyMethod(refs,"get",[pyAt(rel,"to_ref")],{}));
if(pyBool(!pyBool(target))){continue;}
(await pyMethod(names,"add",[pyAt(target,"semantic_id")],{}));
(await pyMethod(names,"add",[(await pyInvoke(strip_ruleset_prefix,[pyAt(target,"semantic_id")],{}))],{}));
}
return names;
}
Object.defineProperty(grounded_by_universe,"__pySignature",{value:[{"name":"ontology","rest":false,"varargs":false}]});
export async function director_of(client:any){
let capsule:any;
capsule=(await pyMethod(client,"table",["capsule"],{}));
assert.ok(pyBool(pyContains(capsule,"director")),pyStr("capsule has no `director` section (§13.1) -- slice 3 kernel side not landed yet"));
return pyAt(capsule,"director");
}
Object.defineProperty(director_of,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function discover_ground_floor_with_idle_intent(client:any){

(await pyInvoke(open_turn,[client,"我们先去看看地面层。"],{}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"corbitt-house-ground"}),...(await (async()=>{const __rows:any[]=[];for(const clue of pyIterable(GROUND_FLOOR_CLUES)){__rows.push(({["kind"]:"clue",["clue"]:clue}));}return __rows;})())]}));
(await pyMethod(client,"table",["resolve"],{"call_id":"t1-c2","action":({["intent"]:"idle",["goal"]:"",["method"]:""})}));
(await pyInvoke(narrate,[client,"t1-c3","地面层已经翻遍了，没有别的动静。"],{}));
}
Object.defineProperty(discover_ground_floor_with_idle_intent,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});

export async function test_capsule_has_no_write_side(kernel:any){
let directory:any,before:any,_:any,after:any;
(await pyInvoke(open_turn,[kernel,"我看看四周。"],{}));
directory=(await pyInvoke(campaign_dir,[kernel.workspace],{}));
before=(await pyInvoke(snapshot_files,[directory],{}));
for(_ of pyIterable((await pyInvoke(pyRange,[5],{})))){
(await pyMethod(kernel,"table",["capsule"],{}));
}
after=(await pyInvoke(snapshot_files,[directory],{}));
assert.ok(pyBool(pyEqual(after,before)),"tests/kernel/test_director_laws.py:116 assert after == before");
}
Object.defineProperty(test_capsule_has_no_write_side,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_capsule_has_no_write_side"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_capsule_has_no_write_side(await kernel(t,{}));});

export async function test_director_is_byte_identical_across_repeated_calls(kernel:any){
let first:any,second:any;
(await pyInvoke(open_turn,[kernel,"我环视委托人的办公室。"],{}));
first=pyAt((await pyMethod(kernel,"table",["capsule"],{})),"director");
second=pyAt((await pyMethod(kernel,"table",["capsule"],{})),"director");
assert.ok(pyBool(pyEqual((await pyMethod(json,"dumps",[first],{"ensure_ascii":false,"sort_keys":true})),(await pyMethod(json,"dumps",[second],{"ensure_ascii":false,"sort_keys":true})))),"tests/kernel/test_director_laws.py:125 assert json.dumps(first, ensure_ascii=False, sort_keys=True) == json.dumps(second, ensure_ascii=False, sort_keys=True)");
}
Object.defineProperty(test_director_is_byte_identical_across_repeated_calls,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_director_is_byte_identical_across_repeated_calls"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_director_is_byte_identical_across_repeated_calls(await kernel(t,{}));});
export async function test_director_is_byte_identical_across_processes_for_the_same_state(tmp_path:any){
let workspace:any,first:any,director_1:any,second:any,director_2:any;
workspace=pyDivide(tmp_path,"ws");
first=(new RpcClient(workspace));
try{(await pyInvoke(open_turn,[first,"我环视委托人的办公室。"],{}));
director_1=pyAt((await pyMethod(first,"table",["capsule"],{})),"director");}finally{(await pyMethod(first,"close",[],{}));}
second=(new RpcClient(workspace));
try{director_2=pyAt((await pyMethod(second,"table",["capsule"],{})),"director");}finally{(await pyMethod(second,"close",[],{}));}
assert.ok(pyBool(pyEqual((await pyMethod(json,"dumps",[director_1],{"ensure_ascii":false,"sort_keys":true})),(await pyMethod(json,"dumps",[director_2],{"ensure_ascii":false,"sort_keys":true})))),"tests/kernel/test_director_laws.py:143 assert json.dumps(director_1, ensure_ascii=False, sort_keys=True) == json.dumps(director_2, ensure_ascii=False, sort_keys=True)");
}
Object.defineProperty(test_director_is_byte_identical_across_processes_for_the_same_state,"__pySignature",{value:[{"name":"tmp_path","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_director_is_byte_identical_across_processes_for_the_same_state"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_director_is_byte_identical_across_processes_for_the_same_state(temporary);});

export async function test_live_combat_session_overrides_to_subsystem(seeded_kernel:any){
let n:any,director:any;
(await pyInvoke(open_turn,[seeded_kernel,"我举枪对准棺材里的东西。"],{}));
n=(await pyInvoke(walk_to_confrontation,[seeded_kernel],{}));
(await pyInvoke(resolve,[seeded_kernel,`t1-c${n}`],{"intent":"combat","goal":"朝科比特开枪","method":"用左轮射击","target":"Walter Corbitt","weapon":".38 Revolver"}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(seeded_kernel,"table",["look"],{})),"where"),"session"),"kind"),"combat")),"tests/kernel/test_director_laws.py:154 assert seeded_kernel.table(\"look\")[\"where\"][\"session\"][\"kind\"] == \"combat\"");
director=(await pyInvoke(director_of,[seeded_kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"SUBSYSTEM")),"tests/kernel/test_director_laws.py:157 assert director[\"beat\"] == \"SUBSYSTEM\"");
assert.ok(pyBool((await pyMethod(director,"get",["override"],{}))),pyStr("session != none must set director.override (§13.3 third layer)"));
}
Object.defineProperty(test_live_combat_session_overrides_to_subsystem,"__pySignature",{value:[{"name":"seeded_kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_live_combat_session_overrides_to_subsystem"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_live_combat_session_overrides_to_subsystem(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});

export async function test_advance_is_the_default_when_no_rule_fires(kernel:any){
let director:any;
(await pyInvoke(discover_ground_floor_with_idle_intent,[kernel],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"继续检查地面层，看看还有没有别的动静。"}));
director=(await pyInvoke(director_of,[kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"ADVANCE")),pyStr(("expected ADVANCE with every scoring-rule condition false (0 undiscovered clues, "+"0 agenda NPCs present, idle intent, no exit condition, turns_in_scene<3); got "+`${director} -- if some other beat won, either a scoring-rule condition this test `+"didn't account for is true, or an unconditional condition (e.g. a 'baseline' rule "+"for PRESSURE) is scoring nonzero even with nothing to react to (see report).")));
assert.ok(pyBool(pyEqual(pyAt(director,"grounded_by"),[])),"tests/kernel/test_director_laws.py:175 assert director[\"grounded_by\"] == []");
assert.ok(pyBool(!pyContains(director,"override")),"tests/kernel/test_director_laws.py:176 assert \"override\" not in director");
}
Object.defineProperty(test_advance_is_the_default_when_no_rule_fires,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_advance_is_the_default_when_no_rule_fires"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_advance_is_the_default_when_no_rule_fires(await kernel(t,{}));});

export async function test_grounded_by_entries_are_registered_ontology_targets(kernel:any){
let ontology:any,universe:any,director:any,name:any;
ontology=(await pyInvoke(load_ontology,[],{}));
universe=(await pyInvoke(grounded_by_universe,[ontology],{}));
(await pyInvoke(open_turn,[kernel,"我仔细观察诺特，问他委托的细节。"],{}));
director=(await pyInvoke(director_of,[kernel],{}));
for(name of pyIterable(pyAt(director,"grounded_by"))){
assert.ok(pyBool(pyContains(universe,name)),pyStr([name,(await pyInvoke(pySorted,[universe],{}))]));
}
}
Object.defineProperty(test_grounded_by_entries_are_registered_ontology_targets,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_grounded_by_entries_are_registered_ontology_targets"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_grounded_by_entries_are_registered_ontology_targets(await kernel(t,{}));});

export async function test_scores_are_bounded_and_at_most_three(kernel:any){
let director:any,scores:any,beat:any,value:any;
(await pyInvoke(open_turn,[kernel,"我仔细观察诺特，问他委托的细节。"],{}));
director=(await pyInvoke(director_of,[kernel],{}));
scores=pyAt(director,"scores");
assert.ok(pyBool((await (async()=>{const __term0=1;const __term1=(await pyInvoke(pyLen,[scores],{}));const __term2=3;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})())),"tests/kernel/test_director_laws.py:196 assert 1 <= len(scores) <= 3");
for([beat,value] of pyIterable((await pyMethod(scores,"items",[],{})))){
assert.ok(pyBool(pyContains(BEATS,beat)),"tests/kernel/test_director_laws.py:198 assert beat in BEATS");
assert.ok(pyBool((await pyInvoke(pyIsInstance,[value,[pyInt,Number]],{}))),"tests/kernel/test_director_laws.py:199 assert isinstance(value, (int, float))");
assert.ok(pyBool((await (async()=>{const __term0=0;const __term1=value;const __term2=1.3;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})())),pyStr([beat,value]));
}
assert.ok(pyBool(pyContains(BEATS,pyAt(director,"beat"))),"tests/kernel/test_director_laws.py:201 assert director[\"beat\"] in BEATS");
}
Object.defineProperty(test_scores_are_bounded_and_at_most_three,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_scores_are_bounded_and_at_most_three"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_scores_are_bounded_and_at_most_three(await kernel(t,{}));});

export async function test_reveal_adoption_true_when_the_listed_clue_is_applied(kernel:any){
let director:any,reveal:any,clue:any,receipts:any,clue_receipt:any,record:any,adoption:any;
(await pyInvoke(_setup_investigate_intent_scene,[kernel],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"继续在地面层翻找。"}));
director=(await pyInvoke(director_of,[kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"REVEAL")),pyStr(director));
reveal=pyAt(director,"reveal");
assert.ok(pyBool(reveal),pyStr("REVEAL beat must list at least one undiscovered clue (§13.3)"));
clue=pyAt(pyAt(reveal,0),"clue");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t3-c1","effects":[({["kind"]:"clue",["clue"]:clue})]}));
receipts=pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts");
clue_receipt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(receipts)){if(pyBool(pyEqual(pyAt(r,"kind"),"clue"))){__rows.push(pyAt(r,"id"));}}return __rows;})())));
(await pyInvoke(narrate,[kernel,"t3-c2","终于找到了那份记录。"],{}));
record=(await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"turns"),"0003.json")],{}));
assert.ok(pyBool(pyContains(record,"director_adoption")),pyStr("narrate must write director_adoption into the turn record (§13.7)"));
adoption=pyAt(record,"director_adoption");
assert.ok(pyBool(pyEqual(pyAt(adoption,"beat"),"REVEAL")),"tests/kernel/test_director_laws.py:224 assert adoption[\"beat\"] == \"REVEAL\"");
assert.ok(pyBool((pyAt(adoption,"adopted")===true)),"tests/kernel/test_director_laws.py:225 assert adoption[\"adopted\"] is True");
assert.ok(pyBool(pyContains(pyAt(adoption,"evidence"),clue_receipt)),"tests/kernel/test_director_laws.py:226 assert clue_receipt in adoption[\"evidence\"]");
}
Object.defineProperty(test_reveal_adoption_true_when_the_listed_clue_is_applied,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_reveal_adoption_true_when_the_listed_clue_is_applied"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_reveal_adoption_true_when_the_listed_clue_is_applied(await kernel(t,{}));});
export async function test_reveal_adoption_false_when_the_turn_only_narrates(kernel:any){
let director:any,record:any,adoption:any;
(await pyInvoke(_setup_investigate_intent_scene,[kernel],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"继续在地面层翻找。"}));
director=(await pyInvoke(director_of,[kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(director,"beat"),"REVEAL")),pyStr(director));
(await pyInvoke(narrate,[kernel,"t3-c1","这一轮什么都没找到。"],{}));
record=(await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"turns"),"0003.json")],{}));
assert.ok(pyBool(pyContains(record,"director_adoption")),"tests/kernel/test_director_laws.py:238 assert \"director_adoption\" in record");
adoption=pyAt(record,"director_adoption");
assert.ok(pyBool(pyEqual(pyAt(adoption,"beat"),"REVEAL")),"tests/kernel/test_director_laws.py:240 assert adoption[\"beat\"] == \"REVEAL\"");
assert.ok(pyBool((pyAt(adoption,"adopted")===false)),"tests/kernel/test_director_laws.py:241 assert adoption[\"adopted\"] is False");
}
Object.defineProperty(test_reveal_adoption_false_when_the_turn_only_narrates,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_reveal_adoption_false_when_the_turn_only_narrates"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_reveal_adoption_false_when_the_turn_only_narrates(await kernel(t,{}));});
export async function _setup_investigate_intent_scene(client:any){

(await pyInvoke(open_turn,[client,"我们先去看看地面层。"],{}));
(await pyMethod(client,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"corbitt-house-ground"})]}));
(await pyInvoke(narrate,[client,"t1-c2","地面层空空荡荡。"],{}));
(await pyMethod(client,"table",["player_input"],{"text":"仔细搜索地面层。"}));
(await pyMethod(client,"table",["resolve"],{"call_id":"t2-c1","action":({["intent"]:"investigate",["goal"]:"搜索地面层",["method"]:"用侦查",["skill"]:"Spot Hidden"})}));
(await pyInvoke(narrate,[client,"t2-c2","你翻了个遍，但天色已经暗了下来，什么都没找全。"],{}));
}
Object.defineProperty(_setup_investigate_intent_scene,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
