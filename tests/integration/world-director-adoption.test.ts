// Migrated from tests/kernel/test_director_adoption.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {narrate,campaign_dir,open_turn,read_json,resolve,walk_to_confrontation,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_director_adoption.py',import.meta.url).pathname;



export async function test_subsystem_adoption_counts_rolls_made_inside_the_session(seeded_kernel:any){
let n:any,attack:any,capsule:any,defend:any,record:any,adoption:any;
(await pyInvoke(open_turn,[seeded_kernel,"我对科比特开枪。"],{}));
n=(await pyInvoke(walk_to_confrontation,[seeded_kernel],{}));
attack=(await pyInvoke(resolve,[seeded_kernel,`t1-c${n}`],{"intent":"combat","goal":"开枪","method":"举枪就射","target":"Walter Corbitt","weapon":".38 Revolver"}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(attack,"session"),"kind"),"combat")),"tests/kernel/test_director_adoption.py:12 assert attack[\"session\"][\"kind\"] == \"combat\"");
(await pyInvoke(narrate,[seeded_kernel,`t1-c${pyAdd(n,1)}`,"枪响。"],{}));
(await pyMethod(seeded_kernel,"table",["player_input"],{"text":"我再开一枪。"}));
capsule=pyAt((await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[seeded_kernel.workspace],{})),"turn.json")],{})),"capsule");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(capsule,"director"),"beat"),"SUBSYSTEM");return pyBool(__left)?pyEqual(pyAt(pyAt(capsule,"director"),"override"),"session"):__left})())),"tests/kernel/test_director_adoption.py:19 assert capsule[\"director\"][\"beat\"] == \"SUBSYSTEM\" and capsule[\"director\"][\"override\"] == \"session\"");
defend=(await pyInvoke(resolve,[seeded_kernel,"t2-c1"],{"intent":"combat","goal":"硬吃这一枪","method":"不躲","actor":"Walter Corbitt","target":"thomas-hayes","defense":"none","weapon":"unarmed"}));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(defend,"receipts"))){__rows.push((await pyMethod(r,"startswith",["session:"],{})));}return __rows;})()))))),"tests/kernel/test_director_adoption.py:22 assert not any(r.startswith(\"session:\") for r in defend[\"receipts\"])");
(await pyInvoke(narrate,[seeded_kernel,"t2-c2","他没有躲。"],{}));
record=(await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[seeded_kernel.workspace],{})),"turns"),"0002.json")],{}));
adoption=pyAt(record,"director_adoption");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(adoption,"beat"),"SUBSYSTEM");return pyBool(__left)?(pyAt(adoption,"adopted")===true):__left})())),"tests/kernel/test_director_adoption.py:26 assert adoption[\"beat\"] == \"SUBSYSTEM\" and adoption[\"adopted\"] is True");
assert.ok(pyBool((await (async()=>{const __left=pyAt(adoption,"evidence");return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(adoption,"evidence"))){__rows.push((await pyMethod(e,"startswith",["roll:"],{})));}return __rows;})()))):__left})())),"tests/kernel/test_director_adoption.py:27 assert adoption[\"evidence\"] and all(e.startswith(\"roll:\") for e in adoption[\"evidence\"])");
}
Object.defineProperty(test_subsystem_adoption_counts_rolls_made_inside_the_session,"__pySignature",{value:[{"name":"seeded_kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_subsystem_adoption_counts_rolls_made_inside_the_session"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_subsystem_adoption_counts_rolls_made_inside_the_session(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});
