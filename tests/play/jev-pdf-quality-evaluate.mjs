/** Source evaluation through the production reader; never a Keeper or scripted player. */
import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRuntime} from '../../runtime/host.ts';
import {ReadingService} from '../../extensions/module/reading-service.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const [book,pdf,selection='calibration',caseId]=process.argv.slice(2);
const fixture=JSON.parse(await readFile(join(root,'tests/play/fixtures/jev-pdf-quality-v1.json'),'utf8'));
const source=fixture.books[book];
if(!source||!pdf||!['calibration','held_out','all'].includes(selection))throw new Error('Usage: quality-evaluate.mjs blood|masks /original.pdf calibration|held_out|all');
const bytes=await readFile(resolve(pdf)),sha=value=>createHash('sha256').update(value).digest('hex');
if(sha(bytes)!==source.source_sha256)throw new Error('The original PDF differs from the frozen quality set');
const cases=source.cases.filter(item=>(selection==='all'||item.set===selection)&&(!caseId||item.id===caseId));
if(!cases.length)throw new Error('The selected quality partition is empty');
const home=join(root,'.pi/jpdf-evaluation',book+'-'+selection+'-'+new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(home,{recursive:true});
const manifest={book,selection,...(caseId?{focused_repeat:caseId}:{}),source_sha256:source.source_sha256,page_count:source.page_count,
 model:'grok-build/grok-4.5',thinking:'low',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 tracked_diff_sha256:sha(execFileSync('git',['diff','HEAD'],{cwd:root})),
 cases:cases.map(item=>({id:item.id,family:item.family,set:item.set})),started_at:new Date().toISOString()};
const changed=[...new Set([...execFileSync('git',['diff','--name-only','HEAD'],{cwd:root,encoding:'utf8'}).trim().split('\n'),
 ...execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split('\n')])].filter(Boolean);
manifest.source_files=await Promise.all(changed.map(async file=>({file,sha256:await readFile(join(root,file)).then(sha,error=>{if(error.code==='ENOENT')return null;throw error;})})));
manifest.runtime_files=await Promise.all(['build/kernel/rpc.mjs','build/runtime/pi-source-reader.mjs','build/extensions/module/reader-submit.mjs','build/extensions/module/reader-context.mjs']
 .map(async file=>({file,sha256:sha(await readFile(join(root,file)))})));
await writeFile(join(home,'manifest.json'),JSON.stringify(manifest,null,2));
const runtime=createRuntime({owner:'check',home},{resourceRoot:root,agentHome:join(root,'.pi/coc-agent')});
const record=row=>{void appendFile(join(home,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),...row})+'\n');};
const reading=new ReadingService({home,runtime,call:(method,params)=>runtime.openKernel().call(method,params),
 model:()=>({id:manifest.model,thinking:manifest.thinking,vision:true}),progress:row=>record({event:'progress',...row}),record});
const results=[];
try{
 const bound=await reading.prepare({pdf:resolve(pdf),purpose:'bind'});
 for(const item of cases){
   const began=Date.now();let result,error;
   try{result=await reading.ensure(bound.module_id,{purpose:'answer',focus:book==='blood'?'Blood Road':'Masks of Nyarlathotep',
     question:item.question,memo:false,foreground:true},AbortSignal.timeout(180000),{allowanceMs:240000});}
   catch(failure){error={code:failure.code??null,message:failure.message,details:failure.details??null};}
   const row={id:item.id,family:item.family,set:item.set,question:item.question,ms:Date.now()-began,result,error};
   results.push(row);await writeFile(join(home,item.id+'.json'),JSON.stringify(row,null,2));
   console.log(JSON.stringify({id:item.id,ms:row.ms,status:result?.source_answer?.status??'failed',home}));
 }
 await writeFile(join(home,'results.json'),JSON.stringify({manifest,results},null,2));
 console.log(JSON.stringify({completed:results.length,home,acceptance:'Source results only; compare with frozen facts independently before assigning pass.'}));
}finally{await reading.close({handOff:true});await runtime.close();}
