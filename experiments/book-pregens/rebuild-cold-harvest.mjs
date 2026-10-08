/** Authorized Cold Harvest rebuild through the source service; the old publication is immutable evidence. */
import {mkdir,mkdtemp,readFile,writeFile,copyFile,chmod,rm,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {createRuntime} from '../../runtime/host.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
const out=resolve(process.argv[2]??'');
if(!process.argv[2])throw Error('a new evidence directory is required');
const root=resolve(import.meta.dirname,'../..'),app=join(homedir(),'Library/Application Support/Pipi/pipicoc/pi-coc');
const home=join(out,'home'),original=join(app,'.coc/modules/book-2');
const before=await readFile(join(original,'module.json')),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(out);
await writeFile(join(out,'PREREGISTER.json'),JSON.stringify({model:'grok-build/grok-4.7',thinking:'low',old_meta_sha256:hash(before),
 intent:'Rebuild the original source through the current producer, without old published facts becoming input. Preserve old evidence and validate first interaction plus the source-backed people/places/pregens. A skeleton or source binding alone is not completion.',
 bars:['new source graph, no manual content patch','old publication retained','source-grounded opening_ready','the eight book cards are offered when requested','no pregen written as a Keeper NPC','living/dead source statements use the independent gate'],
 method:'existing ReadingService.prepare and foreground material requests, real tool-enabled Pi reader/reviewer children',live_play:false},null,2)+'\n');
execFileSync('cp',['-c','-R',original,join(out,'original-publication')]);
await mkdir(home);await copyFile(join(original,'source.pdf'),join(home,'Cold Harvest.pdf'));
await mkdir(join(home,'.coc'),{recursive:true});
execFileSync('cp',['-c','-R',join(app,'.coc/source-transcripts'),join(home,'.coc/source-transcripts')]);
const agent=await mkdtemp(join(tmpdir(),'pipicoc-rebuild-agent-'));await chmod(agent,0o700);
let kernel,runtime,reading,writes=Promise.resolve();
const controller=new AbortController();
const stop=()=>controller.abort(new Error('owned source preparation interrupted'));
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,stop);
try{
 for(const name of ['auth.json','models.json','models-store.json','settings.json'])try{await copyFile(join(app,'agent',name),join(agent,name));await chmod(join(agent,name),0o600);}catch(error){if(error.code!=='ENOENT')throw error;}
 const apiFile=join(root,'.tmp/rebuild-source-api.mjs');
 await build({stdin:{contents:"export {createKernelContext} from './kernel-ts/context.ts'; export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts'; export {createKernelRuntime} from './kernel-ts/registry.ts'; export {pythonJsonDumps} from './kernel-ts/json.ts';",resolveDir:root},outfile:apiFile,bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
 const api=await import(pathToFileURL(apiFile).href),context=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'cold-rebuild',locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
 kernel=api.createKernelRuntime(context);
 const call=async(method,params={})=>{try{return JSON.parse(api.pythonJsonDumps(await kernel.handlers[method](params)));}catch(error){if(error.toJson)throw new KernelError(JSON.parse(api.pythonJsonDumps(error.toJson())));throw error;}};
 runtime=createRuntime({owner:'preparation',home},{resourceRoot:root,contentRoot:join(root,'content'),agentHome:agent,nodeExecutable:process.execPath,layout:'source'});
 reading=new ReadingService({home,runtime,call,model:()=>({id:'grok-build/grok-4.7',vision:true,thinking:'low'}),progress:row=>console.log(JSON.stringify({stage:row.stage,purpose:row.purpose})),record:row=>{writes=writes.then(()=>appendFile(join(out,'rows.jsonl'),JSON.stringify(row)+'\n'));}});
 const bound=await reading.prepare({pdf:join(home,'Cold Harvest.pdf'),module_id:'cold-harvest-rebuilt',purpose:'bind'},controller.signal);
 await writeFile(join(out,'binding.json'),JSON.stringify(bound,null,2)+'\n');
 const run=async params=>{
  const requested=await call('module.read.request',{module_id:bound.module_id,foreground:true,...params});
  if(requested.state==='ready')return;
  const job=await call('module.read.claim',{module_id:bound.module_id,owner:'cold-harvest-rebuild'});
  if(job.job_id!==requested.job_id)throw Error('another job owns the next claim; preserve it and stop');
  await reading.runJob(job,controller.signal);
  const state=await call('module.status',{module_id:bound.module_id});
  await writeFile(join(out,`status-${job.job_id}.json`),JSON.stringify(state,null,2)+'\n');
  const queue=JSON.parse(await readFile(join(home,'.coc/modules',bound.module_id,'deepen-queue.json'),'utf8'));
  if(queue.find(row=>row.job_id===job.job_id)?.state!=='completed')throw Error('source job failed; inspect retained evidence before another attempt');
 };
 await run({purpose:'skeleton'});
 const status=await call('module.status',{module_id:bound.module_id}),openings=status.opening_candidates??[];
 await writeFile(join(out,'opening-candidates.json'),JSON.stringify(openings,null,2)+'\n');
 if(!openings.length)throw Error('the source has no prepared opening candidate');
 for(const opening of openings)await run({purpose:'opening',opening_scope:'first_interaction',focus:opening.scene??opening.name});
 await run({purpose:'detail',material:'pregens'});
 await call('campaign.create',{id:'rebuilt-source-check',module:bound.module_id,start_scene:openings[0].scene,play_language:'en'});
 const listing=await call('investigator.list',{campaign:'rebuilt-source-check'});await writeFile(join(out,'listing.json'),JSON.stringify(listing,null,2)+'\n');
 if(listing.pregens_read!=='read'||listing.pregens?.length!==8)throw Error('source-backed card inventory not ready');
 for (const [index, opening] of openings.entries()) {
  const id = `source-opening-check-${index + 1}`;
  await call('campaign.create', {id, module: bound.module_id, start_scene: opening.scene, play_language: 'en'});
  await call('investigator.load', {campaign: id, pregen: listing.pregens[0].pregen});
  const ready = await call('setup.complete', {campaign: id});
  await writeFile(join(out, `opening-ready-${index + 1}.json`), JSON.stringify(ready, null, 2) + '\n');
  if (ready.status !== 'ready_for_table') throw Error('an explicit source opening is not ready');
 }
 console.log(JSON.stringify({module:bound.module_id,cards:listing.pregens.length,preparedOpenings:openings.length,evidence:out}));
}finally{
 await reading?.close();await runtime?.close();await kernel?.close();await writes;
 await rm(agent,{recursive:true});
 if(hash(await readFile(join(original,'module.json')))!==hash(before))throw Error('the original App metadata changed while the isolated rebuild ran');
}
