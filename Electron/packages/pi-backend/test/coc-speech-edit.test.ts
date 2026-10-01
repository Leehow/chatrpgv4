/**
 * Contract §165.5.3: after the speech edit lane patches a card, the transcript still folds the Keeper's plain copy of
 * that delivery -- on the live road (the stream reader redraws the card in place) and on the history road (the re-read
 * folds the patch in). The patch is the lane's own (`speechEditPatch`), written by the real `patchCard`; the card is
 * drawn by the backend's `mechanicsEntry`; the fold is the UI's `foldMarkedDeliveries`.
 */
import {expect,it} from 'vitest';
import {cp,mkdtemp,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {readCocBinding} from '../src/coc-view.js';
import {patchCard} from '../../../../extensions/table/card-patch.ts';
import {speechEditPatch} from '../../../../extensions/speech-edit/lines.ts';
import {applyStreamEvent,foldMarkedDeliveries,historyMessages,type ChatMessage} from '../../ui/src/transcript-model';

const LINE='「钥匙在这儿，地址写在租约上。」', EDITED='「行，钥匙在这儿，地址就写在租约上。」';
const MARKED=`{{say:托马斯·海斯}}「我接了。」{{/say}}诺特把钥匙推过来。{{say:Steven Knott}}${LINE}{{/say}}他低头看账本。`;
const RENDERED=`「我接了。」诺特把钥匙推过来。${LINE}他低头看账本。`;
const SPEECH=[{who:{investigator:'thomas-hayes',name:'托马斯·海斯'},text:'「我接了。」'},{who:{npc:'steven-knott',name:'Steven Knott'},text:LINE}];
const card={type:'custom',id:'card-1',parentId:'reply',customType:'coc-mechanics',timestamp:'2026-10-01T10:00:00.000Z',
  data:{turn:1,play_language:'zh-Hans',mechanics:[],marked_text:MARKED,speech:SPEECH}};
const reply={type:'message',id:'reply',parentId:null,timestamp:'2026-10-01T09:59:59.000Z',
  message:{role:'assistant',content:[{type:'text',text:RENDERED}],timestamp:Date.parse('2026-10-01T09:59:59.000Z')}};
/** The `coc-card-patch` entry exactly as the lane appends it. */
function lanePatch():any {
  const written:any[]=[];
  const patch=speechEditPatch(MARKED,SPEECH as any,new Map([[1,EDITED]]))!;
  expect(patchCard({appendEntry:((customType:string,data:unknown)=>{written.push({type:'custom',id:'patch-1',parentId:'card-1',
    customType,data,timestamp:'2026-10-01T10:00:15.000Z'});}) as any},{campaign:'c-speech',card:{turn:1},patch,source:'speech-edit'})).toBe(true);
  return written[0];
}
const plain=(id='reply'):ChatMessage=>({id,role:'assistant',content:RENDERED,timestamp:1});

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
  await writeFile(located.path+'.coc.json',JSON.stringify({campaign:'c-speech',home:root,play_language:'zh-Hans'}));
  (backend as any).cocSessionBindings.set(session.id,(await readCocBinding(located.path))!);
  (backend as any).sessionRuntimeTokens.set(session.id,7);
  return {backend,session,path:located.path as string};
}

it('live: the patched card is redrawn in place with the edited line, and the plain copy still folds',async()=>{
  const {backend,session}=await backendWithSession('coc-speech-edit-live-');
  try {
    const drawn:any[]=[];
    backend.subscribe((frame:any)=>{if(frame.channel==='stream'&&frame.event?.type==='presentation')drawn.push(frame.event);});
    const live={session:{id:session.id},runtimeToken:7,path:(await (backend as any).locate(session.id)).path};
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:card});
    (backend as any).rpcEvent(live,{type:'entry_appended',entry:lanePatch()});
    expect(drawn.map(event=>event.entry.id)).toEqual(['card-1','card-1']);
    const details=drawn[1].entry.presentation.details;
    expect(details.marked_text).toBe(MARKED.replace(LINE,EDITED));
    expect(details.speech[1].text).toBe(EDITED);
    expect(details.speech_original).toEqual({marked_text:MARKED});
    // The transcript as the stream builds it: the Keeper's copy, then the card, then the card redrawn where it sits.
    let messages:ChatMessage[]=[plain()];
    for(const event of drawn)messages=applyStreamEvent(messages,event);
    expect(messages.map(message=>message.id)).toEqual(['reply','card-1']);
    expect(foldMarkedDeliveries(messages).map(message=>message.id)).toEqual(['card-1']);
  } finally {await backend.close();}
},40000);

it('history: the re-read draws the card patched, and the plain copy still folds',async()=>{
  const {backend,session,path}=await backendWithSession('coc-speech-edit-history-');
  try {
    await appendFile(path,[reply,card,lanePatch()].map(row=>JSON.stringify(row)).join('\n')+'\n');
    const entries=await (backend as any).readHistoryCached(path,0,50,session.id) as any[];
    const drawn=entries.find(entry=>entry.id==='card-1');
    expect(drawn.presentation.details.marked_text).toBe(MARKED.replace(LINE,EDITED));
    expect(drawn.presentation.details.speech_original).toEqual({marked_text:MARKED});
    const messages=historyMessages(entries);
    expect(messages.some(message=>message.role==='assistant'&&message.content===RENDERED)).toBe(true);
    const folded=foldMarkedDeliveries(messages);
    expect(folded.some(message=>message.role==='assistant'&&message.content===RENDERED)).toBe(false);
    expect(folded.some(message=>message.id==='card-1')).toBe(true);
  } finally {await backend.close();}
},40000);
