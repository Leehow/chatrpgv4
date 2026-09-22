/**
 * Contract §127: a card that named an object while its details were still being prepared opens
 * once they land -- on the live transcript and on every re-read of it.
 *
 * The writer is the Mod host (`extensions/mods/index.ts`), which appends one `coc-object-details`
 * session entry when a deferred definition is in hand; the reader is this backend, and it has two
 * roads to the same card: the live stream reader redraws the card under its own entry id, and the
 * history page merges every such entry in the file into the card it names. A word that reached only
 * one road would leave the other card spinning for good, so both are driven here.
 */
import {expect,it} from 'vitest';
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
