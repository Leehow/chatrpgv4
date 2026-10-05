/**
 * Contract §129: a card that named an object while its details were still being prepared opens
 * once they land -- on the live transcript and on every re-read of it.
 *
 * The writer is the Mod host (`extensions/mods/index.ts`), which appends one `coc-object-details`
 * session entry when a deferred definition is in hand; the reader is this backend, and it has two
 * roads to the same card: the live stream reader redraws the card under its own entry id, and the
 * history page merges every such entry in the file into the card it names. A word that reached only
 * one road would leave the other card spinning for good, so both are driven here.
 */
import {expect,it,vi} from 'vitest';
import {cp,mkdtemp,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {mechanicsEntry,objectDetailsOf,pendingObjectNames,readCocBinding} from '../src/coc-view.js';

const PENDING={kind:'item',receipt:'definition:queued-adopt-t0-c2',name:'沈默的旧皮腔相机',adopted:'旧皮腔相机',
  definition:'pending',definition_name:'旧皮腔相机',call:'t0-c2'};
const OBJECT={category:'item',description:'折叠式皮腔相机。',traits:[],parameters:{charges:8}};
const card=(id='card-t0')=>({type:'custom',id,customType:'coc-mechanics',timestamp:'2026-09-22T17:49:09.017Z',
  data:{turn:0,play_language:'zh-Hans',mechanics:[{kind:'roll',receipt:'roll:a-t0-c1',visibility:'public',roll:16,target:60},PENDING]}});
const details=(objects:unknown[],campaign='c-details',id='details-1')=>({type:'custom',id,customType:'coc-object-details',
  timestamp:'2026-09-22T17:49:30.000Z',data:{campaign,objects}});

it('the details entry is read by name and campaign, and a card says what it still waits on',()=>{
  expect(pendingObjectNames(card())).toEqual(['旧皮腔相机']);
  expect(objectDetailsOf(details([{name:'旧皮腔相机',definition:'ready',object:OBJECT}]),'c-details'))
    .toEqual([['旧皮腔相机',{definition:'ready',object:OBJECT}]]);
  // Another campaign's word is not this card's, and a malformed row is not a word at all.
  expect(objectDetailsOf(details([{name:'旧皮腔相机',definition:'ready',object:OBJECT}],'other'),'c-details')).toEqual([]);
  expect(objectDetailsOf(details([{name:'旧皮腔相机',definition:'ready'},{definition:'none'}]),'c-details')).toEqual([]);
  expect(objectDetailsOf(details([{name:'胶卷',definition:'none'}]),'c-details')).toEqual([['胶卷',{definition:'none'}]]);
});

it('a pending row is drawn pending, and drawn open once its details are known',()=>{
  const waiting=(mechanicsEntry(card(),'zh-Hans')!.presentation!.details as any).mechanics[1];
  expect(waiting).toMatchObject({definition:'pending',definition_name:'旧皮腔相机'});
  expect(waiting.object).toBeUndefined();
  const known=new Map([['旧皮腔相机',{definition:'ready',object:OBJECT}]]);
  const opened=(mechanicsEntry(card(),'zh-Hans',undefined,{},undefined,known)!.presentation!.details as any).mechanics[1];
  expect(opened).toMatchObject({definition:'ready',object:OBJECT,name:'沈默的旧皮腔相机',adopted:'旧皮腔相机'});
  // A dropped preparation stops the wait without inventing anything to open.
  const dropped=(mechanicsEntry(card(),'zh-Hans',undefined,{},undefined,new Map([['旧皮腔相机',{definition:'none'}]]))!
    .presentation!.details as any).mechanics[1];
  expect(dropped.definition).toBe('none');
  expect(dropped.object).toBeUndefined();
});

async function backendWithSession(prefix:string, registry?:any) {
  const {createPiHostBackend}=await import('../src/index.js');
  const repo=resolve(import.meta.dirname,'../../../..'),root=await mkdtemp(join(tmpdir(),prefix));
  const profile=join(root,'profile'),pack=join(profile,'extensions/coc-keeper');await mkdir(pack,{recursive:true});
  await cp(join(repo,'pipiui-extension.json'),join(pack,'pipiui-extension.json'));await cp(join(repo,'pipicoc'),join(pack,'pipicoc'),{recursive:true});
  const backend=createPiHostBackend({agentDir:profile,sessionsRoot:join(root,'sessions'),runtimeRoot:join(root,'runtime'),defaultPack:'coc-keeper',
    managedNodeModulesRoot:join(repo,'node_modules'),env:{...process.env,PI_COC_HOME:root},...(registry?{cocOnboardingRegistry:registry(root)}:{}),
    piCommand:{executable:join(repo,'pipicoc/rpc'),env:{PATH:process.env.PATH!}},spawn:()=>{throw new Error('Pi must remain asleep');}});
  await backend.handle('addProject',[root]);const projects=await backend.handle('listProjects',[]) as any[];
  const session=await backend.handle('newSession',[projects[0].id]) as any;
  const located=await (backend as any).locate(session.id);
  await writeFile(located.path+'.coc.json',JSON.stringify({campaign:'c-details',home:root,play_language:'zh-Hans'}));
  (backend as any).cocSessionBindings.set(session.id,(await readCocBinding(located.path))!);
  (backend as any).sessionRuntimeTokens.set(session.id,7);
  return {backend,session,path:located.path as string};
}

it('the live card is redrawn in place under its own id when the details land',async()=>{
  const {backend,session}=await backendWithSession('coc-details-live-');
  try {
    const drawn:any[]=[];
    backend.subscribe((frame:any)=>{if(frame.channel==='stream'&&frame.event?.type==='presentation')drawn.push(frame.event);});
    const live={session:{id:session.id},runtimeToken:7,path:(await (backend as any).locate(session.id)).path};
    // Through the stream reader itself, so the wiring is covered and not only the routine it calls.
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:card()});
    expect(drawn).toHaveLength(1);
    expect(drawn[0].entry.presentation.details.mechanics[1].definition).toBe('pending');
    // A word about another object leaves this card alone.
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:details([{name:'胶卷',definition:'ready',object:OBJECT}],'c-details','d-0')});
    expect(drawn).toHaveLength(1);
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:details([{name:'旧皮腔相机',definition:'ready',object:OBJECT}])});
    expect(drawn).toHaveLength(2);
    expect(drawn[1].entry.id).toBe('card-t0');
    expect(drawn[1].entry.presentation.details.mechanics[1]).toMatchObject({definition:'ready',object:OBJECT});
    // Once opened the card is no longer waiting: a repeated word draws nothing more.
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:details([{name:'旧皮腔相机',definition:'ready',object:OBJECT}],'c-details','d-2')});
    expect(drawn).toHaveLength(2);
    // A card drawn after its details already landed is drawn open the first time.
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:card('card-t1')});
    expect(drawn).toHaveLength(3);
    expect(drawn[2].entry.presentation.details.mechanics[1].definition).toBe('ready');
  } finally {await backend.close();}
},40000);

it('a re-read of the transcript draws the card with details that landed after it',async()=>{
  const {backend,session,path}=await backendWithSession('coc-details-history-');
  try {
    await appendFile(path,JSON.stringify({...card(),parentId:null})+'\n');
    const read=async()=>(await (backend as any).readHistoryCached(path,0,50,session.id) as any[]).find(entry=>entry.id==='card-t0');
    expect((await read()).presentation.details.mechanics[1].definition).toBe('pending');
    // The word lands later in the file, after the card it names.
    await appendFile(path,JSON.stringify({...details([{name:'旧皮腔相机',definition:'ready',object:OBJECT}]),parentId:'card-t0'})+'\n');
    expect((await read()).presentation.details.mechanics[1]).toMatchObject({definition:'ready',object:OBJECT});
  } finally {await backend.close();}
},40000);

it('a redraw for words that land later keeps the details that already opened the card',async()=>{
  // Two redraws share one card: the clue lane's words (startDeliveryPresentation) and the object's
  // details. Whichever lands second must not draw the card back without the first.
  const summary='Knott points them toward the Globe.';
  let release:()=>void=()=>{};
  const held=new Promise<void>(resolve=>{release=resolve;});
  const {backend,session}=await backendWithSession('coc-details-lane-',(root:string)=>({get:()=>({presentation:async()=>{
    await held;
    const folder=join(root,'.coc/campaigns/c-details/setup/presentations');await mkdir(folder,{recursive:true});
    await writeFile(join(folder,'clues-zh-Hans.json'),JSON.stringify({play_language:'zh-Hans',texts:{[summary]:'诺特指向环球报。'}}));
    return {texts:{}};
  }}),dispose(){},async close(){}}));
  try {
    const drawn:any[]=[];
    backend.subscribe((frame:any)=>{if(frame.channel==='stream'&&frame.event?.type==='presentation')drawn.push(frame.event);});
    const live={session:{id:session.id},runtimeToken:7,path:(await (backend as any).locate(session.id)).path};
    const withClue={...card(),data:{...card().data,mechanics:[...card().data.mechanics,{kind:'clue',receipt:'clue:k-t0',clue:'k',label:'委托',summary}]}};
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:withClue});
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:details([{name:'旧皮腔相机',definition:'ready',object:OBJECT}])});
    expect(drawn.map(event=>event.entry.presentation.details.mechanics[1].definition)).toEqual(['pending','ready']);
    release();
    for(let i=0;i<200&&drawn.length<3;i++)await new Promise(r=>setTimeout(r,20));
    expect(drawn).toHaveLength(3);
    expect(drawn[2].entry.id).toBe('card-t0');
    expect(drawn[2].entry.presentation.details.labels[summary]).toBe('诺特指向环球报。');
    expect(drawn[2].entry.presentation.details.mechanics[1]).toMatchObject({definition:'ready',object:OBJECT});
  } finally {await backend.close();}
},40000);

it('loading an old pending card starts detail-only recovery and redraws that same card',async()=>{
  const {backend,session,path}=await backendWithSession('coc-details-reopen-');
  const host=backend as any, drawn:any[]=[];
  const live={session:{id:session.id},runtimeToken:7,path};
  const ensure=vi.spyOn(host,'ensure').mockImplementation(async(_id,_generation,detailsOnly)=>{
    expect(detailsOnly).toBe(true);
    host.live.set(session.id,live);
    return live;
  });
  vi.spyOn(host,'liveProcessUsable').mockReturnValue(true);
  backend.subscribe((frame:any)=>{if(frame.channel==='stream'&&frame.event?.type==='presentation')drawn.push(frame.event);});
  try {
    await appendFile(path,JSON.stringify({...card(),parentId:null})+'\n');
    const history=await backend.handle('getSessionHistory',[session.id,0,50]) as any[];
    expect(history.find(entry=>entry.id==='card-t0').presentation.details.mechanics[1].definition).toBe('pending');
    await Promise.all([...host.cocDetailsRecoveries.values()]);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(drawn).toHaveLength(0);
    host.rpcEvent(live,{type:'entry_appended',entry:details([{name:'旧皮腔相机',definition:'ready',object:OBJECT}])});
    expect(drawn).toHaveLength(1);
    expect(drawn[0].entry.id).toBe('card-t0');
    expect(drawn[0].entry.presentation.details.mechanics[1]).toMatchObject({definition:'ready',object:OBJECT});
  } finally {host.live.delete(session.id);await backend.close();}
},40000);

it('details completed during cold startup reach the preloaded historical card',async()=>{
  const {backend,session,path}=await backendWithSession('coc-details-startup-');
  const host=backend as any, drawn:any[]=[];
  const live={session:{id:session.id},runtimeToken:7,path};
  vi.spyOn(host,'ensure').mockImplementation(async()=>{
    await appendFile(path,JSON.stringify({...details([{name:'旧皮腔相机',definition:'ready',object:OBJECT}]),parentId:'card-t0'})+'\n');
    host.live.set(session.id,live);
    return live;
  });
  vi.spyOn(host,'liveProcessUsable').mockReturnValue(true);
  backend.subscribe((frame:any)=>{if(frame.channel==='stream'&&frame.event?.type==='presentation')drawn.push(frame.event);});
  try {
    await appendFile(path,JSON.stringify({...card(),parentId:null})+'\n');
    await backend.handle('preloadSession' as never,[session.id]);
    await Promise.all([...host.cocDetailsRecoveries.values()]);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].entry.id).toBe('card-t0');
    expect(drawn[0].entry.presentation.details.mechanics[1]).toMatchObject({definition:'ready',object:OBJECT});
  } finally {host.live.delete(session.id);await backend.close();}
},40000);

it('a failed COC startup is not retried by history reads and a model change permits recovery',async()=>{
  const {backend,session,path}=await backendWithSession('coc-details-startup-failure-');
  const host=backend as any, errors:any[]=[];
  const failure=new Error('Model not found: grok-build/grok-4.5');
  const spawn=vi.spyOn(host,'spawnLive').mockRejectedValue(failure);
  backend.subscribe((frame:any)=>{if(frame.channel==='stream'&&frame.event?.type==='error')errors.push(frame.event);});
  const read=async()=>{
    const history=await backend.handle('getSessionHistory',[session.id,0,50]) as any[];
    await Promise.all([...host.cocDetailsRecoveries.values()]);
    return history;
  };
  try {
    await appendFile(path,JSON.stringify({...card(),parentId:null})+'\n');
    expect((await read()).find(entry=>entry.id==='card-t0').presentation.details.mechanics[1].definition).toBe('pending');
    for(let i=0;i<12;i++)await read();
    await expect(host.ensure(session.id)).rejects.toBe(failure);
    await writeFile(path+'.coc-watchdog-recovery.json',JSON.stringify({version:1,sessionId:session.id}));
    host.scheduleCocWatchdogRecovery(session.id,path,7);
    await new Promise(resolve=>setTimeout(resolve,20));
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].content).toBe(failure.message);

    vi.spyOn(host,'loadModelCatalog').mockResolvedValue(undefined);
    vi.spyOn(host,'composeSessionModelState').mockReturnValue({model:{provider:'working',id:'model',name:'Working'},thinkingLevel:'low',availableThinkingLevels:['low']});
    await backend.handle('setModel',[session.id,'working','model']);
    const live={session:{id:session.id},runtimeToken:7,path};
    spawn.mockImplementation(async()=>{
      await appendFile(path,JSON.stringify({...details([{name:'旧皮腔相机',definition:'ready',object:OBJECT}]),parentId:'card-t0'})+'\n');
      host.live.set(session.id,live);
      return live;
    });
    vi.spyOn(host,'liveProcessUsable').mockReturnValue(true);
    await read();
    expect(spawn).toHaveBeenCalledTimes(2);
    expect((await read()).find(entry=>entry.id==='card-t0').presentation.details.mechanics[1].definition).toBe('ready');
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(1);
  } finally {host.live.delete(session.id);await backend.close();}
},40000);

it('model and usage reads do not replace a dead COC process',async()=>{
  const {backend,session,path}=await backendWithSession('coc-details-dead-read-');
  const host=backend as any;
  const live={session:{id:session.id},runtimeToken:7,path,process:{exitCode:1}};
  host.live.set(session.id,live);
  const ensure=vi.spyOn(host,'ensure').mockRejectedValue(new Error('A read must not start Pi'));
  vi.spyOn(host,'liveProcessUsable').mockReturnValue(false);
  vi.spyOn(host,'loadModelCatalog').mockResolvedValue(undefined);
  vi.spyOn(host,'coldSessionStats').mockResolvedValue({sessionId:session.id,tokens:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0},cost:0});
  try {
    await backend.handle('getModelState',[session.id]);
    await backend.handle('getSessionStats',[session.id]);
    expect(ensure).not.toHaveBeenCalled();
  } finally {host.live.delete(session.id);await backend.close();}
},40000);

it('archived and read-only history do not start item recovery',async()=>{
  const {backend,session,path}=await backendWithSession('coc-details-read-only-');
  const host=backend as any, ensure=vi.spyOn(host,'ensure');
  try {
    await appendFile(path,JSON.stringify({...card(),parentId:null})+'\n');
    host.sidebarArchivedCache.add(session.id);
    await backend.handle('getSessionHistory',[session.id,0,50]);
    host.sidebarArchivedCache.delete(session.id);
    vi.spyOn(host,'leaseFor').mockReturnValue({query:async()=>({writable:false})});
    await backend.handle('preloadSession' as never,[session.id]);
    await Promise.all([...host.cocDetailsRecoveries.values()]);
    expect(ensure).not.toHaveBeenCalled();
  } finally {await backend.close();}
},40000);

it('a loaded historical card joins its existing busy owner for later detail patches',async()=>{
  const {backend,session,path}=await backendWithSession('coc-details-busy-');
  const host=backend as any, drawn:any[]=[], live={session:{id:session.id},runtimeToken:7,path};
  host.live.set(session.id,live);
  vi.spyOn(host,'ensure').mockResolvedValue(live);
  vi.spyOn(host,'canRewriteSessionFile').mockReturnValue(false);
  vi.spyOn(host,'liveProcessUsable').mockReturnValue(true);
  backend.subscribe((frame:any)=>{if(frame.channel==='stream'&&frame.event?.type==='presentation')drawn.push(frame.event);});
  try {
    await appendFile(path,JSON.stringify({...card(),parentId:null})+'\n');
    await backend.handle('getSessionHistory',[session.id,0,50]);
    await Promise.all([...host.cocDetailsRecoveries.values()]);
    host.rpcEvent(live,{type:'entry_appended',entry:details([{name:'旧皮腔相机',definition:'ready',object:OBJECT}])});
    expect(drawn).toHaveLength(1);
    expect(drawn[0].entry.id).toBe('card-t0');
    expect(drawn[0].entry.timestamp).toBe(Date.parse(card().timestamp));
  } finally {host.live.delete(session.id);await backend.close();}
},40000);
