// Migrated from tests/kernel/test_mod_checker.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {weapon} from "./mod-fixtures.ts";
import {os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,retainedFixture,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,pyType,Counter} from "./world-native-support.ts";
const __file__=new URL('../../tests/kernel/test_mod_checker.py',import.meta.url).pathname;







export let ROOT:any=pyAt((await pyMethod((await pyInvoke(Path,[__file__],{})),"resolve",[],{})).parents,2);
export async function write_json(path:any,value:any){
(await pyMethod(path.parent,"mkdir",[],{"parents":true,"exist_ok":true}));
(await pyMethod(path,"write_text",[pyAdd((await pyMethod(json,"dumps",[value],{"ensure_ascii":false,"indent":2})),"\n")],{"encoding":"utf-8"}));
}
Object.defineProperty(write_json,"__pySignature",{value:[{"name":"path","rest":false,"varargs":false},{"name":"value","rest":false,"varargs":false}]});
export async function test_emitted_mod_checker_reuses_validation_without_kernel_or_state_writes(retained:any){
let root:any,home:any,drafts:any,name:any,value:any,accepted:any,draft:any,before:any,env:any,result:any,response:any;

root=(await pyInvoke(retained,["host-check"],{}));
home=pyDivide(root,"home");
(await pyMethod(home,"mkdir",[],{}));
drafts=[["weapon",(await pyInvoke(weapon,[],{})),true],["document",({["name"]:"Notebook",["category"]:"item",["description"]:"Paper.",["basis"]:"A fixture.",["parameters"]:({["effects"]:[]}),["document"]:({["text"]:pyMultiply("🎲",64000),["presentation"]:"notebook"}),["player_view"]:({["description"]:"Notes.",["fields"]:[]})}),true],["bad",({["name"]:"incomplete"}),false]];
for([name,value,accepted] of pyIterable(drafts)){
draft=pyDivide(root,`${name}.json`);
(await pyInvoke(write_json,[draft,value],{}));
before=(await pyMethod(draft,"read_bytes",[],{}));
env=({...os.environ,["PATH"]:"",["PI_COC_HOME"]:(await pyInvoke(pyStr,[home],{})),["PI_COC_RUNTIME_OPTIONS"]:(await pyMethod(json,"dumps",[({["backend"]:"typescript",["resourceRoot"]:(await pyInvoke(pyStr,[ROOT],{})),["contentRoot"]:(await pyInvoke(pyStr,[pyDivide(ROOT,"content")],{})),["nodeExecutable"]:(await pyMethod(shutil,"which",["node"],{}))})],{}))});
result=(await pyMethod(subprocess,"run",[[(await pyMethod(shutil,"which",["node"],{})),(await pyInvoke(pyStr,[pyDivide(ROOT,"build/runtime/check.mjs")],{})),"--kind","mod-definition","--draft",(await pyInvoke(pyStr,[draft],{}))]],{"cwd":ROOT,"env":env,"capture_output":true,"text":true,"timeout":15}));
response=(await pyMethod(json,"loads",[result.stdout],{}));
(await pyInvoke(write_json,[pyDivide(root,`${name}-result.json`),({["code"]:result.returncode,["response"]:response})],{}));
assert.ok(pyBool(((pyEqual(result.returncode,0))===accepted)),pyStr([name,result.returncode,response]));
assert.ok(pyBool(pyEqual((await pyMethod(draft,"read_bytes",[],{})),before)),pyStr(name));
}
assert.ok(pyBool(!pyBool((await pyMethod((pyDivide(home,".coc")),"exists",[],{})))),"tests/kernel/test_mod_checker.py:49 assert not (home / \".coc\").exists()");
}
Object.defineProperty(test_emitted_mod_checker_reuses_validation_without_kernel_or_state_writes,"__pySignature",{value:[{"name":"retained","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_emitted_mod_checker_reuses_validation_without_kernel_or_state_writes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_emitted_mod_checker_reuses_validation_without_kernel_or_state_writes(retainedFixture(t));});
