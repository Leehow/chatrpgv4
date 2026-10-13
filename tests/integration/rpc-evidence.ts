/** Native test transport evidence; values, hashes and receipt identities stay exact. */
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,relative} from 'node:path';
import ts from 'typescript';
export function readCommand(value:string|null):string[]|null{
  if(value===null)return null;
  const result=JSON.parse(value);
  if(!Array.isArray(result)||!result.length||result.some(p=>typeof p!=='string'||!p))throw new TypeError('Test kernel command must be a non-empty JSON argv array');
  return result;
}
const type=(value:any)=>value===null?'null':Array.isArray(value)?'array':typeof value;
export function differences(expected:any,actual:any,path='$',limit=30):string[]{
  if(type(expected)!==type(actual))return [`${path}: ${type(expected)} != ${type(actual)}`];
  if(expected!==null&&typeof expected==='object'){
    if(Array.isArray(expected)&&expected.length!==actual.length)return [`${path}: list length ${expected.length} != ${actual.length}`];
    const result:string[]=[];
    for(const key of [...new Set([...Object.keys(expected),...Object.keys(actual)])].sort()){
      const child=Array.isArray(expected)?`${path}[${key}]`:`${path}.${key}`;
      if(!Object.hasOwn(expected,key)||!Object.hasOwn(actual,key))result.push(`${child}: field missing from ${Object.hasOwn(expected,key)?'candidate':'reference'}`);
      else result.push(...differences(expected[key],actual[key],child,limit-result.length));
      if(result.length>=limit)break;
    }return result;
  }return expected===actual?[]:[`${path}: ${JSON.stringify(expected)} != ${JSON.stringify(actual)}`];
}
export function retainedDirectory(base:string,caseName:string,explicit=process.env.COC_RPC_EVIDENCE_DIR):string{
  if(!caseName||['.','..'].includes(caseName)||caseName.includes('/')||caseName.includes('\\'))throw new TypeError('invalid retained test case name');
  const root=explicit||base;mkdirSync(root,{recursive:true});return mkdtempSync(join(root,caseName+'-'));
}
export function retainComparison(caseName:string,reference:any,candidate:any,fallback:string):[string,string[]]{
  const target=retainedDirectory(fallback,caseName),findings=differences(reference,candidate);
  for(const [name,value] of Object.entries({reference,candidate,comparison:{equal:!findings.length&&!reference.failure&&!candidate.failure,differences:findings}}))writeFileSync(join(target,name+'.json'),JSON.stringify(value,null,2)+'\n');
  return [target,findings];
}
/** Advisory inventory only; finding an internal import never controls test registration. */
export function internalTests(root:string):string[]{
 const result:string[]=[];
 const visit=(dir:string)=>{for(const file of readdirSync(dir,{withFileTypes:true})){const path=join(dir,file.name);if(file.isDirectory()){visit(path);continue;}if(!file.name.endsWith('.test.ts'))continue;
   const tree=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);let internal=false;
   const walk=(node:ts.Node)=>{if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text.includes('kernel-ts/'))internal=true;ts.forEachChild(node,walk);};walk(tree);if(internal)result.push(relative(root,path));
 }};visit(root);return result.sort();
}
export function snapshot(workspace:string){
 const root=join(workspace,'.coc'),files:Record<string,unknown>={},history:Record<string,string[]>={};
 if(!existsSync(root))return {files,history};
 const visit=(folder:string)=>{for(const entry of readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(folder,entry.name),name=relative(root,path);if(name==='repos')continue;if(entry.isDirectory()){visit(path);continue;}if(!entry.isFile())continue;
   const data=readFileSync(path),sha256=createHash('sha256').update(data).digest('hex');
   try{if(name.endsWith('.json'))files[name]=JSON.parse(data.toString('utf8'));else if(name.endsWith('.jsonl'))files[name]=data.toString('utf8').split('\n').filter(line=>line.trim()).map(line=>JSON.parse(line));else files[name]={sha256,bytes:data.length};}
   catch{files[name]={invalid_json_bytes:data.toString('hex'),sha256};}
 }};visit(root);
 const repos=join(root,'repos');if(existsSync(repos))for(const repo of readdirSync(repos).filter(name=>name.endsWith('.git')).sort())history[repo]=execFileSync('git',[`--git-dir=${join(repos,repo)}`,'log','--all','--format=%H %T %P %s'],{encoding:'utf8'}).trim().split('\n').sort();
 return {files,history};
}
