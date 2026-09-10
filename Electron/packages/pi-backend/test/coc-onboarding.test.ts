import {afterEach, expect, it, vi} from 'vitest';
import {mkdir, mkdtemp, readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {CocOnboardingHost} from '../src/coc-onboarding.js';

const services:CocOnboardingHost[]=[];
async function service(){
  const home=await mkdtemp(join(tmpdir(),'coc-onboarding-'));
  const repo=resolve(import.meta.dirname,'../../../..');
  const host=new CocOnboardingHost({repo,home,agentDir:join(home,'agent'),env:{...process.env,PI_COC_READER_CMD:JSON.stringify([process.execPath,join(repo,'tests/extension/fixtures/guidance-reader.mjs')]),UV_CACHE_DIR:'/tmp/pi-coc-uv-cache'}});
  services.push(host);return {host,home};
}
afterEach(()=>{for(const host of services.splice(0))host.dispose()});
const model={id:'test/no-provider',thinking:'low',vision:true};
it('polls document reading once per revision and language without repeating edits',async()=>{
 const {host}=await service();let complete:(value:any)=>void=()=>{};
 const run=vi.spyOn(host as any,'run').mockImplementation(()=>new Promise(resolve=>{complete=resolve}));
 const data={campaign:'one',actor:'Investigator',name:'Slip',version:'v1',play_language:'zh-Hans'};
 expect(host.documentPresentationStatus(data)).toEqual({pending:true});
 expect(host.documentPresentationStatus(data)).toEqual({pending:true});
 complete({text:'每天 $20。',original:'每天 $20。'});await Promise.resolve();
 expect(host.documentPresentationStatus(data).text).toBe('每天 $20。');
 expect(run).toHaveBeenCalledTimes(1);
 expect(run).toHaveBeenCalledWith('document-presentation',data);
 expect(host.documentPresentationStatus({...data,version:'v2'})).toEqual({pending:true});
 expect(run).toHaveBeenCalledTimes(2);
});
it('projects legacy ready imports without discarding guidance or rewriting them on status',async()=>{
 const {host,home}=await service();const job=await host.invoke({action:'begin',name:'old.pdf',size:9},'one',model);
 const path=join(home,'.coc/imports',job.id,'job.json');const saved=JSON.parse(await readFile(path,'utf8'));
 delete saved.preparation;saved.state='ready';saved.guidance={scene:'Office',opening:'Who are you?'};
 const before=JSON.stringify(saved);await writeFile(path,before);
 const resumed=await host.invoke({action:'status',id:job.id},'one',model);
 expect(resumed.canConverse).toBe(true);expect(resumed.preparation.opening.state).toBe('ready');
 expect(await readFile(path,'utf8')).toBe(before);
});
it('joins one background presentation across status polls',async()=>{
 const {host}=await service();let complete:(value:any)=>void=()=>{};
 const run=vi.spyOn(host as any,'run').mockImplementation(()=>new Promise(resolve=>{complete=resolve}));
 const data={campaign:'same-card',revision:2,play_language:'en'};
 expect(host.presentationStatus(data)).toEqual({pending:true});expect(host.presentationStatus(data)).toEqual({pending:true});
 complete({play_language:'en',texts:{Name:'Name'}});await host.presentation(data);
 expect(host.presentationStatus(data)).toEqual({play_language:'en',texts:{Name:'Name'}});expect(run).toHaveBeenCalledTimes(1);
});
it('patches only the owning phase and retains conversation binding across delayed completion',async()=>{
  // Controlled promises exercise coordinator races only; this is not gameplay.
  const {host,home}=await service();
  const pending:Array<{action:string;resolve:(value:any)=>void}>=[];
  vi.spyOn(host as any,'run').mockImplementation((action:any)=>action==='converse'?Promise.resolve({}):
    new Promise(resolve=>pending.push({action,resolve})));
  let job=await host.invoke({action:'select',source:'module',module_id:'book-1',name:'Book'},'one',model);
  pending.shift()!.resolve({module_id:'book-1',guidance:{scene:'Dock'},guidance_key:'a'.repeat(64)});
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(pending[0].action).toBe('opening');
  job=await host.invoke({action:'converse',id:job.id},'one',model);
  const campaign=job.campaign;
  await host.invoke({action:'pause',id:job.id},'one',model);
  await host.invoke({action:'resume',id:job.id},'one',model);
  pending[0].resolve({opening_ready:true});
  await new Promise(resolve=>setTimeout(resolve,0));
  let saved=JSON.parse(await readFile(join(home,'.coc/imports',job.id,'job.json'),'utf8'));
  expect(saved.preparation.opening.state).toBe('running');expect(saved.campaign).toBe(campaign);
  pending[1].resolve({opening_ready:true});
  await new Promise(resolve=>setTimeout(resolve,0));
  saved=JSON.parse(await readFile(join(home,'.coc/imports',job.id,'job.json'),'utf8'));
  expect(saved.state).toBe('conversing');expect(saved.campaign).toBe(campaign);
  expect(saved.preparation.guidance.state).toBe('ready');expect(saved.preparation.opening.state).toBe('ready');
});
it('bounds upload bytes, acknowledges offsets and rejects another session',async()=>{
  const {host,home}=await service();
  await expect(host.invoke({action:'begin',name:'book.pdf',size:129*1024*1024},'one',model)).rejects.toThrow();
  const job=await host.invoke({action:'begin',name:'book.pdf',size:9},'one',model);
  await expect(host.invoke({action:'status',id:job.id},'two',model)).rejects.toThrow('another session');
  await expect(host.invoke({action:'chunk',id:job.id,offset:1,data:'JVBERi0='},'one',model)).rejects.toThrow('offset');
  const next=await host.invoke({action:'chunk',id:job.id,offset:0,data:Buffer.from('%PDF-test').toString('base64')},'one',model);
  expect(next.received).toBe(9);
  const restored=await host.invoke({action:'catalog'},'one',model);
  expect(restored.current_import.id).toBe(job.id);
  expect((await host.invoke({action:'catalog'},'two',model)).current_import).toBeNull();
  expect(await readFile(join(home,'.coc/imports',job.id,'source.pdf'),'utf8')).toBe('%PDF-test');
  const invalid=await host.invoke({action:'finish',id:job.id},'one',model);
  expect(invalid.state).toBe('failed');
  // A failure the overlay shows is a code it can look a word up by, never prose alone.
  expect(typeof invalid.error.code).toBe('string');
  expect(invalid.error.code).not.toBe('');
  expect(invalid.error.message).toBeTruthy();
});

/**
 * A content root of this build's own shape, so a test never depends on the words that ship: `en`
 * holds the authored captions, `zz` ships a seed beside them (contract §23).
 */
async function contentRoot(){
  const root=await mkdtemp(join(tmpdir(),'coc-onboarding-words-'));
  await writeFile(join(root,'languages.json'),JSON.stringify({source:'en',default:'zz',suggested:['zz','en']}));
  await mkdir(join(root,'setup'),{recursive:true});
  await writeFile(join(root,'setup/ui-presentation.md'),'project the captions');
  for(const tag of ['zz','en']){
    await mkdir(join(root,'ui',tag),{recursive:true});
    await writeFile(join(root,'ui',tag,'onboarding.json'),JSON.stringify({heading:`${tag} heading`}));
  }
  return root;
}

it('every onboarding answer carries its own language words, and every refusal a code',async()=>{
  const home=await mkdtemp(join(tmpdir(),'coc-onboarding-'));
  const repo=resolve(import.meta.dirname,'../../../..');
  const host=new CocOnboardingHost({repo,home,agentDir:join(home,'agent'),contentRoot:await contentRoot(),env:{...process.env}});
  services.push(host);
  // Nothing here needs a worker: these are the host's own guards and its own words.
  vi.spyOn(host as any,'run').mockImplementation(()=>Promise.reject(Object.assign(new Error('the reader gave up'),{code:'reading_timeout'})));
  const empty=await host.invoke({action:'current'},'one',model);
  expect(empty.current_import).toBeNull();
  expect(empty.ui.tag).toBe('zz');
  expect(empty.ui.projected).toBe(true);
  expect(empty.ui.words.onboarding.heading).toBe('zz heading');
  const job=await host.invoke({action:'begin',name:'book.pdf',size:9,play_language:'en'},'one',model);
  expect(job.play_language).toBe('en');
  expect(job.ui.tag).toBe('en');
  expect(job.ui.projected).toBe(true);
  expect(job.ui.words.onboarding.heading).toBe('en heading');
  expect((await host.invoke({action:'status',id:job.id},'one',model)).ui.tag).toBe('en');
  // The tag set is open (§23): a tag nothing has registered is taken, answered in the authored
  // words with `projected:false`, and one background projection is started for it. The runner is
  // stubbed to reject above, so the job fails rather than hanging; the answer is unaffected.
  const fresh=await host.invoke({action:'begin',name:'other.pdf',size:9,play_language:'pt-BR'},'three',model);
  expect(fresh.play_language).toBe('pt-BR');
  expect(fresh.ui.tag).toBe('pt-BR');
  expect(fresh.ui.projected).toBe(false);
  expect(fresh.ui.words.onboarding.heading).toBe('en heading');
  const code=async(params:any,session='one',who=model)=>
    (await host.invoke(params,session,who).then(()=>undefined,(error:any)=>error))?.code;
  expect(await code({action:'status',id:job.id},'two')).toBe('import_other_session');
  expect(await code({action:'status',id:'not-a-uuid'})).toBe('unknown_import');
  expect(await code({action:'begin',name:'book.txt',size:9})).toBe('upload_too_large');
  expect(await code({action:'begin',name:'book.pdf',size:9},'one',{...model,vision:false})).toBe('model_without_images');
  // `ww` is not declared, so it is refused rather than quietly swapped for the default.
  // Only a value of no tag shape is refused; a tag nobody registered is a play language (§23).
  expect(await code({action:'begin',name:'book.pdf',size:9,play_language:'WW not a tag'})).toBe('invalid_params');
  expect(await code({action:'select',source:'starter',module_id:'NOT A SLUG'})).toBe('invalid_params');
  expect(await code({action:'hide',id:job.id})).toBe('scenario_not_ready');
  expect(await code({action:'chunk',id:job.id,offset:5,data:'AAAA'})).toBe('upload_chunk_invalid');
  expect(await code({action:'finish',id:job.id})).toBe('upload_incomplete');
  expect(await code({action:'converse',id:job.id})).toBe('guidance_not_ready');
  expect(await code({action:'whatever',id:job.id})).toBe('unknown_action');
  // A phase that failed keeps the reason's own code; the overlay shows a word for it, not the log.
  const started=await host.invoke({action:'select',source:'module',module_id:'book-1',name:'Book'},'one',model);
  await new Promise(resolve=>setTimeout(resolve,0));
  const failed=await host.invoke({action:'status',id:started.id},'one',model);
  expect(failed.preparation.guidance.error.code).toBe('reading_timeout');
  expect(failed.preparation.guidance.error.message).toBeTruthy();
  expect(failed.error.code).toBe('reading_timeout');
});
it('conversation binding is idempotent and never creates an investigator',async()=>{
  const {host,home}=await service();
  const catalog=await host.invoke({action:'catalog'},'one',model);
  expect(catalog.presets.some((p:any)=>p.id==='the-haunting')).toBe(true);
  // §content/starters is a build directory: only a starter that ships
  // `starter-listing.json` with `listed: true` is put in front of players.
  expect(catalog.presets.map((p:any)=>p.id)).toEqual(['the-haunting']);
  expect(catalog.presets[0].title).toBe('鬼屋');
  expect(catalog.presets[0].blurb).toContain('波士顿');
  const english=await host.invoke({action:'catalog',play_language:'en'},'one',model);
  expect(english.presets[0].title).toBe('The Haunting');
  expect(english.presets[0].blurb).toContain('Boston, 1920');
  let job=await host.invoke({action:'select',source:'starter',module_id:'the-haunting',name:'The Haunting',play_language:'en'},'one',model);
  const deadline=Date.now()+10000;
  while(job.state==='preparing'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,50));job=await host.invoke({action:'status',id:job.id},'one',model)}
  expect(job.state).toBe('ready');
  let reused=await host.invoke({action:'select',source:'starter',module_id:'the-haunting',name:'The Haunting',play_language:'en'},'two',model);
  const reuseDeadline=Date.now()+10000;
  while(reused.state==='preparing'&&Date.now()<reuseDeadline){await new Promise(r=>setTimeout(r,50));reused=await host.invoke({action:'status',id:reused.id},'two',model)}
  expect(reused.state).toBe('ready');expect(reused.preparation.guidance.state).toBe('ready');
  expect(job).not.toHaveProperty('guidance');expect(reused).not.toHaveProperty('guidance');
  const {readdir}=await import('node:fs/promises');
  const cache=join(home,'.coc/modules/the-haunting/character-guidance');
  const keys=await readdir(cache);expect(keys).toHaveLength(2);
  for(const key of keys)expect(await readdir(join(cache,key))).toEqual(['accepted.json']);
  const params={action:'converse',id:job.id};
  const first=await host.invoke(params,'one',model);
  const replay=await host.invoke(params,'one',model);
  expect(first.state).toBe('conversing');expect(replay.campaign).toBe(first.campaign);
  const campaign=JSON.parse(await readFile(join(home,'.coc/campaigns',first.campaign,'campaign.json'),'utf8'));
  expect(campaign.status).toBe('setting_up');
  const persisted=JSON.parse(await readFile(join(home,'.coc/imports',job.id,'job.json'),'utf8'));
  expect(campaign.guidance_key).toBe(persisted.guidance_key);
  expect(keys).toContain(campaign.guidance_key);
  const accepted=JSON.parse(await readFile(join(cache,campaign.guidance_key,'accepted.json'),'utf8'));
  expect(accepted.play_language).toBe('en');
  const {readdir:files}=await import('node:fs/promises');
  expect((await files(join(home,'.coc/campaigns',first.campaign,'party'))).filter(x=>x.endsWith('.json'))).toHaveLength(0);
  await expect(host.invoke({action:'create',id:job.id,character:{name:'Forbidden',occupation:'Journalist'}},'one',model)).rejects.toThrow('Unknown onboarding action');
});
it('hides only a finished preparation, and a hidden job stays the current import',async()=>{
  const {host,home}=await service();
  const pending:Array<{action:string;resolve:(value:any)=>void}>=[];
  vi.spyOn(host as any,'run').mockImplementation((action:any)=>new Promise(resolve=>pending.push({action,resolve})));
  const job=await host.invoke({action:'select',source:'module',module_id:'book-1',name:'Book'},'one',model);
  // While preparation runs the overlay carries pause, resume and retry: it cannot be hidden.
  await expect(host.invoke({action:'hide',id:job.id},'one',model)).rejects.toThrow('opening is ready');
  pending.shift()!.resolve({module_id:'book-1',guidance:{scene:'Dock'},guidance_key:'a'.repeat(64),opening_ready:true});
  await new Promise(resolve=>setTimeout(resolve,0));
  const hidden=await host.invoke({action:'hide',id:job.id},'one',model);
  expect(hidden.hidden).toBe(true);
  expect(JSON.parse(await readFile(join(home,'.coc/imports',job.id,'job.json'),'utf8')).hidden).toBe(true);
  const current=await host.invoke({action:'current'},'one',model);
  expect(current.current_import.id).toBe(job.id);
  expect(current.current_import.hidden).toBe(true);
  expect(current.current_import.preparation.opening.state).toBe('ready');
});

it('an eager draft projection and the card that later asks for it are one job',async()=>{
 const {host}=await service();
 const run=vi.spyOn(host as any,'run').mockImplementation(()=>new Promise(()=>{}));
 const labels={'Spot Hidden':'侦查'};
 void host.presentation({campaign:'c1',revision:1,play_language:'zh-Hans',labels});
 // The renderer knows only the revision; the glossary must not split the key into two runs.
 expect(host.presentationStatus({campaign:'c1',revision:1,play_language:'zh-Hans'})).toEqual({pending:true});
 expect(run).toHaveBeenCalledTimes(1);
 expect((run.mock.calls[0]![1] as any).labels).toEqual(labels);
});

it('a presentation that never answers fails with a retryable card instead of staying pending',async()=>{
 const home=await mkdtemp(join(tmpdir(),'coc-onboarding-'));
 const repo=resolve(import.meta.dirname,'../../../..');
 const host=new CocOnboardingHost({repo,home,agentDir:join(home,'agent'),
   env:{...process.env,PI_COC_PRESENTATION_DEADLINE_MS:'30'}});
 services.push(host);
 let aborted=false;
 vi.spyOn(host as any,'run').mockImplementation((...args:any[])=>{
  (args[5] as AbortController).signal.addEventListener('abort',()=>{aborted=true});
  return new Promise(()=>{});
 });
 const data={campaign:'stuck',revision:1,play_language:'en'};
 expect(host.presentationStatus(data)).toEqual({pending:true});
 await expect(host.presentation(data)).rejects.toThrow(/did not finish in time/);
 expect(aborted).toBe(true);
 // The card is told once, and the retry it offers starts a new run rather than re-reading a stall.
 expect(()=>host.presentationStatus(data)).toThrow(/did not finish in time/);
 expect(host.presentationStatus(data)).toEqual({pending:true});
});

it('the possession and clue projections are their own jobs beside the standing one and are not kept once answered',async()=>{
 const {host}=await service();
 const run=vi.spyOn(host as any,'run').mockImplementation((_action:any,data:any)=>Promise.resolve({play_language:'zh-Hans',texts:data.possessions?{intact:'完好'}:data.clues?{'Pools of blood':'血泊'}:{}}));
 const base={campaign:'c1',play_language:'zh-Hans'};
 const [standing,possessions,clues]=await Promise.all([host.presentation({...base,standing:true}),host.presentation({...base,possessions:true}),host.presentation({...base,clues:true})]);
 expect(run).toHaveBeenCalledTimes(3);
 expect(standing.texts).toEqual({});expect(possessions.texts).toEqual({intact:'完好'});expect(clues.texts).toEqual({'Pools of blood':'血泊'});
 expect((run.mock.calls[1]![1] as any).possessions).toBe(true);expect((run.mock.calls[2]![1] as any).clues).toBe(true);
 // A done job is not kept: the next sheet read that finds a new word starts a fresh run.
 await host.presentation({...base,possessions:true});await host.presentation({...base,clues:true});
 expect(run).toHaveBeenCalledTimes(5);
});

it('keeps a failed UI projection rejected until the player explicitly retries',async()=>{
 const {host}=await service();
 const presentation=vi.spyOn(host,'presentation').mockRejectedValue(new Error('projection failed'));
 await expect(host.projectUiWords('fr-CA')).rejects.toThrow('projection failed');
 await expect(host.projectUiWords('fr-CA')).rejects.toThrow('projection failed');
 expect(presentation).toHaveBeenCalledTimes(1);
 host.retryUiWords();
 presentation.mockResolvedValue({});
 await host.projectUiWords('fr-CA');
 expect(presentation).toHaveBeenCalledTimes(2);
});
