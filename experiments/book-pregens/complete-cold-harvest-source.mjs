/** Continue the authorized rebuild with source-only whole-book detail, never synthetic gameplay. */
import {readFile,writeFile,appendFile,mkdtemp,copyFile,chmod,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {createRuntime} from '../../runtime/host.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
const out=resolve(process.argv[2]??'');if(!process.argv[2])throw Error('the retained rebuilt-source directory is required');
const resume=process.argv.includes('--resume'),suffix=resume?'-resume':'';
const root=resolve(import.meta.dirname,'../..'),home=join(out,'home'),mid='cold-harvest-rebuilt';
const question="Prepare the rest of this authored book as a complete source reference for the Keeper: its farm and investigation places with containment and routes, source NPCs with their stated relationships and outward appearances, clues and their actual discovery/delivery conditions, scene situations, consequences and endings. Read the original book, including the cast section, not merely the current opening. Preserve identities and published supported facts, fill only what the source states and cite original pages. Player pregens stay investigator-template sheets and never become NPCs or places. Do not invent missing statistics or turn background/instructions into player choices. Make source material ready only once its necessary current source dependencies are answered. This is an explicitly authorized source rebuild, not a player action or a playtest.";
if(resume){
 const prior=JSON.parse(await readFile(join(out,'DETAIL-PREREGISTER.json'),'utf8'));
 if(prior.model!=='grok-build/grok-4.7'||prior.question!==question)throw Error('the retained source job identity changed');
}
await writeFile(join(out,`DETAIL-PREREGISTER${suffix}.json`),JSON.stringify({model:'grok-build/grok-4.7',thinking:'low',purpose:'detail',question,
 retry:resume,reason:resume?'Continue the retained draft through the existing reviewed retry path. Preserve all earlier evidence.':'Initial source detail request.',
 bars:['source-backed investigation/cast topology and clue gates','no pregen NPC/location duplicates','the dead/living statements use the independent person gate','retained original App publication unchanged'],
 exclusions:'No Keeper turns, manual source facts, old-generation graph input or claimed full-table acceptance.'},null,2)+'\n',{flag:'wx'});
const agent=await mkdtemp(join(tmpdir(),'pipicoc-source-detail-agent-'));await chmod(agent,0o700);
const controller=new AbortController();for(const name of ['SIGINT','SIGTERM','SIGHUP'])process.once(name,()=>controller.abort(new Error('owned source detail interrupted')));
let kernel,runtime,reading,writes=Promise.resolve();
try{
 const app=join(homedir(),'Library/Application Support/Pipi/pipicoc/pi-coc');
 for(const name of ['auth.json','models.json','models-store.json','settings.json'])try{await copyFile(join(app,'agent',name),join(agent,name));await chmod(join(agent,name),0o600);}catch(error){if(error.code!=='ENOENT')throw error;}
 const api=await import(pathToFileURL(join(root,'.tmp/rebuild-source-api.mjs')).href),ctx=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'source-detail',locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
 kernel=api.createKernelRuntime(ctx);
 const call=async(m,p={})=>{try{return JSON.parse(api.pythonJsonDumps(await kernel.handlers[m](p)));}catch(error){if(error.toJson)throw new KernelError(JSON.parse(api.pythonJsonDumps(error.toJson())));throw error;}};
 const requested=await call('module.read.request',{module_id:mid,purpose:'detail',focus:'Cold Harvest source reference',question,foreground:true,...(resume?{retry:true}:{})});
 const job=await call('module.read.claim',{module_id:mid,owner:'cold-harvest-source-detail'});
 if(job.job_id!==requested.job_id)throw Error('another job owns this claim; preserve and stop');
 await writeFile(join(out,`detail-job${suffix}.json`),JSON.stringify({job_id:job.job_id,work_dir:job.work_dir},null,2)+'\n',{flag:'wx'});
 runtime=createRuntime({owner:'preparation',home},{resourceRoot:root,contentRoot:join(root,'content'),agentHome:agent,nodeExecutable:process.execPath,layout:'source'});
 reading=new ReadingService({home,runtime,call,model:()=>({id:'grok-build/grok-4.7',vision:true,thinking:'low'}),progress:r=>console.log(JSON.stringify({stage:r.stage,purpose:r.purpose})),record:r=>{writes=writes.then(()=>appendFile(join(out,`detail-rows${suffix}.jsonl`),JSON.stringify(r)+'\n'));}});
 await reading.runJob(job,controller.signal);
 const status=await call('module.status',{module_id:mid});await writeFile(join(out,`detail-status${suffix}.json`),JSON.stringify(status,null,2)+'\n');
 const queue=JSON.parse(await readFile(join(home,'.coc/modules',mid,'deepen-queue.json'),'utf8'));
 if(queue.find(r=>r.job_id===job.job_id)?.state!=='completed')throw Error('source detail did not publish; inspect preserved evidence');
 console.log(JSON.stringify({source_job:job.job_id,generation:status.generation,evidence:out}));
}finally{await reading?.close();await runtime?.close();await kernel?.close();await writes;await rm(agent,{recursive:true});}
