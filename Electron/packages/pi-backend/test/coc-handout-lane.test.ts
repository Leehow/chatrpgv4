/**
 * VT-01: the handouts lane settles on a table that holds an image-only handout.
 *
 * A pictured handout (§152.3) is a `table.view.handouts` row with a `name` and no body, and no
 * `<campaign>/handouts/<handle>.md` is written for it. `handoutTexts` counts that name as a word the
 * handouts lane owes, while the lane's own input (`handoutInput`) reads only those `.md` files. A
 * board read therefore found the title missing, started the lane, the lane answered without it,
 * the landing pushed `sheet_changed`, the panel read again, and the title was missing again: one
 * lane run per re-read, for as long as the board was open, and the title never reached the play
 * language.
 *
 * The lane mock here resolves, and it resolves with exactly what the real lane would save for the
 * request it is handed: it is the worker's `handouts` branch (`pipicoc/onboarding-worker.ts`,
 * `prepareHandoutPresentation({...input, ...})`) with only the model replaced by a runner that
 * answers every word it is issued. A mock that never resolves could never show the loop.
 *
 * The table is the real kernel's: the shipped starter, the module's asset row naming a cropped
 * image for one handout (what a PDF module's visual reader registers for a clipping; the starter
 * ships no crops, so the fixture writes a one-pixel PNG), `apply handout`, and `table.view` read
 * cold by the host exactly as the case board reads it.
 */
import {expect,it,vi} from 'vitest';
import {cp,mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {SHEET_LANES,type SheetLane,laneWords,readCocBinding,readColdSheet} from '../src/coc-view.js';
import {KernelClient} from '../../../../extensions/kernel/client.js';
import {prepareHandoutPresentation} from '../../../../extensions/module/character-presentation.ts';

const repo=resolve(import.meta.dirname,'../../../..');
const MAP='Corbitt House Investigator Map';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1cAAAAASUVORK5CYII=','base64');
const projected=(text:string)=>`projected: ${text}`;
const sleep=(ms:number)=>new Promise(done=>setTimeout(done,ms));

/** A campaign whose table holds the investigator map as a picture only, through the real kernel. */
async function imageHandoutTable(root:string,campaign:string,language:string):Promise<void> {
  const client=new KernelClient({command:[process.execPath,join(repo,'build/kernel/rpc.mjs'),'--workspace',root,'--content',join(repo,'content')],cwd:repo,env:{}});
  try {
    await client.call('campaign.create',{id:campaign,module:'the-haunting',pregen:'thomas-hayes',play_language:language});
    const module=join(root,'.coc/modules/the-haunting'),file=join(module,'assets.json');
    const assets=JSON.parse(await readFile(file,'utf8'));
    const row=assets.assets.find((item:any)=>item.id==='handout-the-haunting-corbitt-house-investigator-map');
    Object.assign(row,{path:'assets/player/corbitt-house-investigator-map.png',media_type:'image/png'});
    await mkdir(join(module,'assets/player'),{recursive:true});
    await writeFile(join(module,'assets/player/corbitt-house-investigator-map.png'),PNG);
    await writeFile(file,JSON.stringify(assets));
    await client.call('table.open',{campaign});
    await client.call('table.narrate',{campaign,call_id:'t0-c1',text:'Mr. Knott hands over the keys.'});
    await client.call('table.player_input',{campaign,text:'I ask for a plan of the house.'});
    await client.call('table.apply',{campaign,call_id:'t1-c1',effects:[{kind:'handout',name:MAP,why:'Knott unfolds the plan.'}]});
    await client.call('table.narrate',{campaign,call_id:'t1-c2',text:'The plan lies open on the desk.'});
  } finally {await client.close();}
}

/** The model, replaced: every issued word comes back projected, in the protocol the checker reads. */
async function answeringRunner(request:any) {
  const packet=JSON.parse(await readFile(join(request.cwd,'texts.json'),'utf8'));
  await writeFile(join(request.cwd,'presentation.json'),JSON.stringify({protocol:packet.protocol,
    texts:packet.sources.map((source:any)=>({source:source.alias,action:'translate',text:projected(source.text)})),finance_equipment_sources:[]}));
  return {ok:true,code:0,timedOut:false,ms:1,stderr:'',command:[]};
}

async function host(root:string,campaign:string,language:string) {
  const runs:any[]=[];let running=0;
  const registry={get:()=>({presentation:async(request:any)=>{
    runs.push(request);running++;
    try {
      if(request.handouts!==true)throw new Error(`only the handouts lane owes words on this table, not ${JSON.stringify(request)}`);
      return await prepareHandoutPresentation({...request,home:root,contentRoot:join(repo,'content'),known_labels:{},runner:answeringRunner});
    } finally {running--;}
  }}),dispose(){},async close(){}} as any;
  const profile=join(root,'profile'),pack=join(profile,'extensions/coc-keeper');await mkdir(pack,{recursive:true});
  await cp(join(repo,'pipiui-extension.json'),join(pack,'pipiui-extension.json'));await cp(join(repo,'pipicoc'),join(pack,'pipicoc'),{recursive:true});
  const {createPiHostBackend}=await import('../src/index.js');
  const backend=createPiHostBackend({agentDir:profile,sessionsRoot:join(root,'sessions'),runtimeRoot:join(root,'runtime'),defaultPack:'coc-keeper',managedNodeModulesRoot:join(repo,'node_modules'),cocOnboardingRegistry:registry,env:{...process.env,PI_COC_HOME:root},piCommand:{executable:join(repo,'pipicoc/rpc'),env:{PATH:process.env.PATH!}},spawn:()=>{throw new Error('Pi must remain asleep');}});
  vi.spyOn(backend as any,'getModelState').mockResolvedValue({model:{provider:'unknown',id:'fixture'},thinkingLevel:'low'});
  vi.spyOn(backend as any,'ensure').mockResolvedValue({});
  await backend.handle('addProject',[root]);const projects=await backend.handle('listProjects',[]) as any[];
  const session=await backend.handle('newSession',[projects[0].id]) as any;
  const located=await (backend as any).locate(session.id);
  await writeFile(located.path+'.coc.json',JSON.stringify({campaign,home:root,play_language:language}));
  return {backend,session,located,runs,running:()=>running};
}

/** Every lane but `handouts` already holds its words, so the only run a read can start is that lane's. */
async function settleOtherLanes(root:string,campaign:string,language:string,view:unknown) {
  const folder=join(root,'.coc/campaigns',campaign,'setup/presentations');await mkdir(folder,{recursive:true});
  for(const lane of Object.keys(SHEET_LANES) as SheetLane[]) {
    if(lane==='handouts')continue;
    const wanted=await laneWords(repo,lane,view);
    await writeFile(join(folder,`${lane}-${language}.json`),JSON.stringify({play_language:language,texts:Object.fromEntries(wanted.map(word=>[word,word]))}));
  }
}

it('one board read of a table holding an image-only handout starts one handouts run, and the re-read it causes starts none',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coc-handout-lane-'));
  const campaign='pictured',language='zh-Hans';
  await imageHandoutTable(root,campaign,language);
  const view=await readColdSheet(repo,{campaign,home:root,play_language:language}) as any;
  // The kernel lists the picture as a held document with a name and no body; no `.md` exists for it.
  expect(view.handouts).toHaveLength(1);
  expect(view.handouts[0]).toMatchObject({handout:'the-haunting-corbitt-house-investigator-map',name:MAP,text:'',media_type:'image/png',document:'ready'});
  // The lane's collector owes the title -- this is the word the loop was about.
  expect(await laneWords(repo,'handouts',view)).toEqual([MAP]);
  await settleOtherLanes(root,campaign,language,view);

  const {backend,session,runs,running}=await host(root,campaign,language);
  // The board panel re-reads on every push from the pack's channel (`pipicoc/board.js` subscribeExt).
  // A cap keeps a loop from running the test forever; the fix must never reach it.
  const CAP=4;let rereads=0,inflight=0;
  const read=()=>backend.handle('invokeExtension',['coc-keeper','board',{}, {sessionId:session.id}]) as Promise<any>;
  backend.subscribe((frame:any)=>{
    if(frame.channel!=='ext.coc-keeper'||frame.event?.type!=='sheet_changed'||rereads>=CAP)return;
    rereads++;inflight++;void read().finally(()=>{inflight--;});
  });
  try {
    const first=await read();
    expect(first.data.status).toBe('ready');
    // Quiet = no read in flight, no lane job held, no lane run executing, for half a second.
    for(let quiet=0,tick=0;quiet<20&&tick<800;tick++){
      await sleep(25);
      quiet=inflight||running()||(backend as any).cocLaneJobs.size?0:quiet+1;
    }
    console.log(`[VT-01] board reads: 1 + ${rereads} re-read(s) on sheet_changed; handouts lane runs: ${runs.length}`);
    expect(runs.length,`handouts lane runs after one board read (a loop reaches ${CAP+1})`).toBe(1);
    expect(rereads).toBe(1);
    expect(runs[0]).toMatchObject({campaign,play_language:language,handouts:true});
    // The title travels to the lane as input, since no file the lane reads carries it.
    expect(runs[0].handout_names).toEqual([MAP]);
    const saved=JSON.parse(await readFile(join(root,'.coc/campaigns',campaign,'setup/presentations',`handouts-${language}.json`),'utf8'));
    expect(saved.texts[MAP]).toBe(projected(MAP));
    // And the board draws it: the title is in the play language, and reading again asks for nothing.
    const again=await read();
    await sleep(100);
    expect(again.data.view.labels[MAP]).toBe(projected(MAP));
    expect(runs.length).toBe(1);
  } finally {await backend.close();}
},60000);

it('an image-only handout handed over this turn projects its title and redraws the card in place',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coc-handout-delivery-'));
  const campaign='delivered',language='zh-Hans';
  await imageHandoutTable(root,campaign,language);
  const {backend,session,located,runs}=await host(root,campaign,language);
  try {
    (backend as any).cocSessionBindings.set(session.id,(await readCocBinding(located.path))!);
    const drawn:any[]=[];
    backend.subscribe((frame:any)=>{if(frame.channel==='stream'&&frame.event?.type==='presentation')drawn.push(frame.event);});
    // The row §16.2 projects for a pictured handout: a name, a document, no body.
    const entry={type:'custom',id:'pictured-1',customType:'coc-mechanics',timestamp:'2026-09-29',data:{turn:1,play_language:language,
      mechanics:[{kind:'handout',receipt:'handout:the-haunting-corbitt-house-investigator-map-t1',name:MAP,document:'ready',label:MAP,
        path:join(root,'.coc/modules/the-haunting/assets/player/corbitt-house-investigator-map.png'),media_type:'image/png'}]}};
    (backend as any).sessionRuntimeTokens.set(session.id,7);
    (backend as any).rpcEvent({session:{id:session.id},runtimeToken:7},{type:'entry_appended',entry});
    for(let i=0;i<200&&drawn.length<2;i++)await sleep(20);
    expect(runs).toHaveLength(1);
    expect(runs[0].handouts).toBe(true);
    expect(runs[0].handout_names).toEqual([MAP]);
    expect(drawn.map((event:any)=>event.entry.id)).toEqual(['pictured-1','pictured-1']);
    expect(drawn[0].entry.presentation.details.labels[MAP]).toBeUndefined();
    expect(drawn[1].entry.presentation.details.labels[MAP]).toBe(projected(MAP));
  } finally {await backend.close();}
},60000);
