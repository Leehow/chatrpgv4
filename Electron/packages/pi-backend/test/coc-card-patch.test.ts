/**
 * Contract §132: an asynchronous lane patches a delivery card after it was drawn, with one session
 * entry, `coc-card-patch`, and this backend draws the patched card on both of its roads -- redrawn in
 * place on the live transcript, and folded in on every re-read -- through one resolver
 * (`CocCardLedger`), so the two roads cannot disagree about which card a patch lands on.
 */
import {expect,it} from 'vitest';
import {cp,mkdtemp,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {CocCardLedger,cardPatchOf,mechanicsEntry,mergePatch,readCocBinding} from '../src/coc-view.js';

const card=(id:string,turn:number,rows:unknown[]=[{kind:'item',receipt:`item:${id}`,name:'Lantern',quantity:1,to:'thomas'}])=>
  ({type:'custom',id,customType:'coc-mechanics',timestamp:'2026-09-23T10:00:00.000Z',data:{turn,play_language:'en',mechanics:rows}});
const patch=(id:string,data:Record<string,unknown>,campaign='c-patch')=>({type:'custom',id,customType:'coc-card-patch',
  timestamp:'2026-09-23T10:00:05.000Z',data:{campaign,source:'test-lane',at:'2026-09-23T10:00:05.000Z',...data}});
const details=(entry:any)=>entry.presentation.details as any;

it('merge patch follows RFC 7396: objects merge, null deletes, arrays and scalars replace',()=>{
  expect(mergePatch({a:1,b:{c:2,d:3},e:[1,2]},{b:{c:null,x:4},e:[3],f:'new'})).toEqual({a:1,b:{d:3,x:4},e:[3],f:'new'});
  expect(mergePatch({a:1},'whole')).toBe('whole');
  expect(mergePatch(undefined,{a:{b:null,c:1}})).toEqual({a:{c:1}});
  expect(Object.getPrototypeOf(mergePatch({},JSON.parse('{"__proto__":{"polluted":true}}')))).toBe(Object.prototype);
});

it('the entry is read by campaign, and only the selectors the backend resolves travel',()=>{
  expect(cardPatchOf(patch('p1',{card:{id:'card-1',turn:1,anchor:'abc'},patch:{review:{ok:true}}}),'c-patch'))
    .toEqual({card:{id:'card-1',turn:1},patch:{review:{ok:true}},source:'test-lane'});
  expect(cardPatchOf(patch('p1',{card:{turn:1},patch:{review:{ok:true}}},'other'),'c-patch')).toBeUndefined();
  expect(cardPatchOf(patch('p1',{card:{turn:1},patch:{}}),'c-patch')).toBeUndefined();
  expect(cardPatchOf(patch('p1',{card:{turn:1},patch:[1]}),'c-patch')).toBeUndefined();
  expect(cardPatchOf({type:'custom',customType:'coc-card-patch',data:{card:{turn:1},patch:{a:1}}},'c-patch')).toBeUndefined();
  // §129's word is the same word under its older name.
  expect(cardPatchOf({type:'custom',id:'d',customType:'coc-object-details',data:{campaign:'c-patch',objects:[{name:'Camera',definition:'none'}]}},'c-patch'))
    .toEqual({card:{},patch:{definitions:{Camera:{definition:'none',object:null}}},source:'object-details'});
});

it('a patch by id, by turn and by name each reach their card; patches apply in the order they were read',()=>{
  const ledger=new CocCardLedger('c-patch');
  ledger.note(card('card-1',1));
  ledger.note(card('card-2',2,[{kind:'roll',visibility:'public',roll:12,target:50}]));
  // By turn: the latest card of that turn read before the patch.
  expect(ledger.note(patch('p1',{card:{turn:2},patch:{review:{verdict:'pass'}}}))).toEqual(['card-2']);
  // By id, even for a card this ledger has not read.
  expect(ledger.note(patch('p2',{card:{id:'card-9'},patch:{review:{verdict:'pass'}}}))).toEqual(['card-9']);
  // By name: every card with an item row of that name.
  expect(ledger.note(patch('p3',{card:{},patch:{objects:{Lantern:{usages:{Swing:{name:'Swing',parameters:{damage:'1D6'}}}}}}}))).toEqual(['card-1']);
  expect(ledger.note(patch('p4',{card:{turn:2},patch:{review:{verdict:null,note:'later'}}}))).toEqual(['card-2']);
  const two=details(mechanicsEntry(card('card-2',2,[{kind:'roll',visibility:'public',roll:12,target:50}]),'en',undefined,{},undefined,ledger.patchesFor('card-2')));
  expect(two.review).toEqual({note:'later'});
  const one=details(mechanicsEntry(card('card-1',1),'en',undefined,{},undefined,ledger.patchesFor('card-1')));
  expect(one.mechanics[0]).toMatchObject({name:'Lantern',usages:{Swing:{name:'Swing',parameters:{damage:'1D6'}}}});
  expect(one.objects).toBeUndefined();
  // A card read after a name patch is drawn with it too.
  ledger.note(card('card-3',3));
  expect(details(mechanicsEntry(card('card-3',3),'en',undefined,{},undefined,ledger.patchesFor('card-3'))).mechanics[0].usages.Swing.name).toBe('Swing');
});

it('a patch by turn that arrives before its card binds to the next card of that turn',()=>{
  const ledger=new CocCardLedger('c-patch');
  expect(ledger.note(patch('p1',{card:{turn:4},patch:{review:{verdict:'pass'}}}))).toEqual([]);
  ledger.note(card('card-4',4));
  expect(ledger.patchesFor('card-4').map(item=>item.patch)).toEqual([{review:{verdict:'pass'}}]);
  // A later card of the same turn (a replayed delivery) does not take it a second time.
  ledger.note(card('card-4b',4));
  expect(ledger.patchesFor('card-4b')).toEqual([]);
});

it('an unknown selector is ignored without error, and a patch cannot put a Keeper row or a concealed figure on the card',()=>{
  const ledger=new CocCardLedger('c-patch');
  ledger.note(card('card-1',1));
  expect(ledger.note(patch('p1',{card:{turn:77},patch:{review:{verdict:'pass'}}}))).toEqual([]);
  expect(ledger.note(patch('p2',{card:{},patch:{objects:{Nobody:{usages:{}}}}}))).toEqual([]);
  expect(ledger.note(patch('p3',{card:{},patch:{review:{verdict:'pass'}}}))).toEqual([]);
  expect(ledger.patchesFor('card-1')).toEqual([]);
  expect(ledger.patchesFor(undefined)).toEqual([]);
  const replaced=mechanicsEntry(card('card-1',1),'en',undefined,{},undefined,[{card:{id:'card-1'},source:'t',patch:{mechanics:[
    {kind:'roll',visibility:'keeper',roll:99},{kind:'roll',visibility:'concealed',roll:12,target:50,skill:'Psychology'}]}}]);
  expect(details(replaced).mechanics).toEqual([{kind:'roll',visibility:'concealed',skill:'Psychology'}]);
});

async function backendWithSession(prefix:string) {
  const {createPiHostBackend}=await import('../src/index.js');
  const repo=resolve(import.meta.dirname,'../../../..'),root=await mkdtemp(join(tmpdir(),prefix));
  const profile=join(root,'profile'),pack=join(profile,'extensions/coc-keeper');await mkdir(pack,{recursive:true});
  await cp(join(repo,'pipiui-extension.json'),join(pack,'pipiui-extension.json'));await cp(join(repo,'pipicoc'),join(pack,'pipicoc'),{recursive:true});
  const backend=createPiHostBackend({agentDir:profile,sessionsRoot:join(root,'sessions'),runtimeRoot:join(root,'runtime'),defaultPack:'coc-keeper',
    managedNodeModulesRoot:join(repo,'node_modules'),env:{...process.env,PI_COC_HOME:root},
    piCommand:{executable:join(repo,'pipicoc/rpc'),env:{PATH:process.env.PATH!}},spawn:()=>{throw new Error('Pi must remain asleep');}});
  await backend.handle('addProject',[root]);const projects=await backend.handle('listProjects',[]) as any[];
  const session=await backend.handle('newSession',[projects[0].id]) as any;
  const located=await (backend as any).locate(session.id);
  await writeFile(located.path+'.coc.json',JSON.stringify({campaign:'c-patch',home:root,play_language:'en'}));
  (backend as any).cocSessionBindings.set(session.id,(await readCocBinding(located.path))!);
  (backend as any).sessionRuntimeTokens.set(session.id,7);
  return {backend,session,path:located.path as string};
}

it('a live patch redraws the card in place under its own id with the merged details',async()=>{
  const {backend,session}=await backendWithSession('coc-card-patch-live-');
  try {
    const drawn:any[]=[];
    backend.subscribe((frame:any)=>{if(frame.channel==='stream'&&frame.event?.type==='presentation')drawn.push(frame.event);});
    const live={session:{id:session.id},runtimeToken:7,path:(await (backend as any).locate(session.id)).path};
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:card('card-1',1)});
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:card('card-2',2,[{kind:'roll',visibility:'public',roll:12,target:50}])});
    expect(drawn.map(event=>event.entry.id)).toEqual(['card-1','card-2']);
    // By turn: the card of turn 1 is drawn again, where it sits, with the usage on its row.
    const usage={usages:{Swing:{name:'Swing',parameters:{skill:'Fighting (Brawl)',damage:'1D6'}}}};
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:patch('p1',{card:{turn:1},patch:{objects:{Lantern:usage}}})});
    expect(drawn).toHaveLength(3);
    expect(drawn[2].entry.id).toBe('card-1');
    expect(details(drawn[2].entry).mechanics[0]).toMatchObject({kind:'item',name:'Lantern',...usage});
    expect(details(drawn[2].entry).turn).toBe(1);
    // By id, a top-level field merges into the details and keeps what the first patch opened.
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:patch('p2',{card:{id:'card-1'},patch:{review:{verdict:'pass'}}})});
    expect(drawn).toHaveLength(4);
    expect(details(drawn[3].entry)).toMatchObject({review:{verdict:'pass'}});
    expect(details(drawn[3].entry).mechanics[0].usages.Swing.name).toBe('Swing');
    // The same word again changes nothing, so nothing is drawn.
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:patch('p3',{card:{id:'card-1'},patch:{review:{verdict:'pass'}}})});
    expect(drawn).toHaveLength(4);
    // An unknown selector, another campaign's word and a card this run never drew are ignored without error.
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:patch('p4',{card:{turn:99},patch:{review:{verdict:'pass'}}})});
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:patch('p5',{card:{id:'card-1'},patch:{review:{verdict:'x'}}},'other')});
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:patch('p6',{card:{id:'card-from-before'},patch:{review:{verdict:'pass'}}})});
    expect(drawn).toHaveLength(4);
    // By name: every card this run drew with a row of that name is redrawn, and only those.
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:patch('p7',{card:{},patch:{objects:{Lantern:{lit:true}}}})});
    expect(drawn.map(event=>event.entry.id)).toEqual(['card-1','card-2','card-1','card-1','card-1']);
    expect(details(drawn[4].entry).mechanics[0]).toMatchObject({lit:true,usages:usage.usages});
    // A card drawn after a name patch already landed is drawn patched the first time; a turn patch
    // bound to another card is not its.
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:card('card-3',3)});
    expect(drawn).toHaveLength(6);
    expect(details(drawn[5].entry).mechanics[0].lit).toBe(true);
    expect(details(drawn[5].entry).mechanics[0].usages).toBeUndefined();
  } finally {await backend.close();}
},40000);

it('a re-read folds every patch for a card into it, in file order',async()=>{
  const {backend,session,path}=await backendWithSession('coc-card-patch-history-');
  try {
    await appendFile(path,JSON.stringify({...card('card-1',1),parentId:null})+'\n');
    const read=async()=>details((await (backend as any).readHistoryCached(path,0,50,session.id) as any[]).find(entry=>entry.id==='card-1'));
    expect((await read()).review).toBeUndefined();
    await appendFile(path,JSON.stringify({...patch('p1',{card:{turn:1},patch:{review:{verdict:'revise',note:'first'}}}),parentId:'card-1'})+'\n');
    expect((await read()).review).toEqual({verdict:'revise',note:'first'});
    await appendFile(path,[
      {...patch('p2',{card:{id:'card-1'},patch:{review:{verdict:'pass',note:null}}}),parentId:'p1'},
      {...patch('p3',{card:{},patch:{objects:{Lantern:{usages:{Swing:{name:'Swing',parameters:{damage:'1D6'}}}}}}}),parentId:'p2'},
      {...patch('p4',{card:{turn:42},patch:{review:{verdict:'x'}}}),parentId:'p3'},
    ].map(row=>JSON.stringify(row)).join('\n')+'\n');
    const folded=await read();
    expect(folded.review).toEqual({verdict:'pass'});
    expect(folded.mechanics[0].usages).toEqual({Swing:{name:'Swing',parameters:{damage:'1D6'}}});
  } finally {await backend.close();}
},40000);
