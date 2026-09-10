import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,cp,readFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import * as cocView from '../src/coc-view.js';
import {createPiHostBackend} from '../src/index.js';
import {timelineAnchors,transcriptPrefix} from '../src/coc-timeline.js';

describe('conversation delivery anchors',()=>{
  it('anchors marked deliveries before the commit event and excludes the abandoned future',()=>{
    const rows=[{type:'session'},
      {id:'user',message:{role:'user'}},
      {id:'card',customType:'coc-mechanics',data:{turn:2,marked_text:'A door opens.'}},
      {id:'anchor',type:'custom',customType:'coc-turn-anchor',data:{commit:'abcd123',turn:2}},
      {id:'reply',message:{role:'assistant',content:[{type:'text',text:'A door opens.'}]}},
      {id:'next-user',message:{role:'user'}},
      {id:'future',message:{role:'assistant',content:[{type:'text',text:'Later.'}]}}];
    const [anchor]=timelineAnchors(rows,'session');
    expect(anchor).toEqual({commit:'abcd123',turn:2,messageId:'card',endId:'reply',sessionId:'session'});
    expect(transcriptPrefix(rows,anchor).map(row=>row.id)).toEqual(['user','card','anchor','reply']);
  });
  it('reads legacy successful narrate receipts without assigning uncommitted replies',()=>{
    const rows=[{id:'tool',message:{role:'toolResult',toolName:'narrate',content:[{type:'text',text:JSON.stringify({turn:3,commit:'def1234'})}]}},
      {id:'reply',message:{role:'assistant',content:[{type:'text',text:'Done.'}]}},
      {id:'user',message:{role:'user'}},{id:'chat',message:{role:'assistant',content:[{type:'text',text:'Thinking.'}]}}];
    expect(timelineAnchors(rows,'s')).toEqual([{commit:'def1234',turn:3,messageId:'reply',endId:'reply',sessionId:'s'}]);
  });
});

it('branches the selected delivery into a persisted child, selects it and switches its bound worldline',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coc-conversation-seam-'));
  const repo=resolve(import.meta.dirname,'../../../..');
  const pack=join(root,'profile/extensions/coc-keeper');
  await mkdir(pack,{recursive:true});
  await cp(join(repo,'pipiui-extension.json'),join(pack,'pipiui-extension.json'));
  await cp(join(repo,'pipicoc'),join(pack,'pipicoc'),{recursive:true});
  let currentGraph:any={active:'main',lines:[{name:'main'}],nodes:[]};
  const calls=vi.spyOn(cocView,'callColdKernel').mockImplementation(async(_repo,_home,method,params)=>{
    if(method==='table.graph')return currentGraph;
    if(method==='table.switch')return {ok:true,active:params.line};
    if(method==='table.branch')return {ok:true,active:'if-2-1',branched_from:{line:'main',turn:2,commit:'abc1234'}};
    throw new Error(`Unexpected method ${method}`);
  });
  const backend=createPiHostBackend({agentDir:join(root,'profile'),sessionsRoot:join(root,'sessions'),runtimeRoot:join(root,'runtime'),defaultPack:'coc-keeper',managedNodeModulesRoot:join(repo,'node_modules'),spawn:()=>{throw new Error('A UI branch must not start a model');}});
  vi.spyOn(backend as any,'cocAnswerWords').mockResolvedValue({});
  const frames:any[]=[];backend.subscribe(frame=>frames.push(frame));
  try {
    await backend.handle('addProject',[root]);
    const [project]=await backend.handle('listProjects',[]) as any[];
    const source=await backend.handle('newSession',[project.id,'Source']) as any;
    const file=(await (backend as any).locate(source.id)).path;
    const before=(await readFile(file,'utf8')).trim().split('\n').map(JSON.parse);
    let parent=before.at(-1).id;
    const rows=[{id:'binding',type:'custom',customType:'coc-session',data:{campaign:'c1',home:root,play_language:'en'}},
      {id:'anchor',type:'custom',customType:'coc-turn-anchor',data:{commit:'abc1234',turn:2}},
      {id:'reply',type:'message',message:{role:'assistant',content:[{type:'text',text:'The door opens.'}]}},
      {id:'next',type:'message',message:{role:'user',content:[{type:'text',text:'Go further.'}]}},
      {id:'future',type:'message',message:{role:'assistant',content:[{type:'text',text:'The abandoned future.'}]}}];
    for(const row of rows as any[]){row.parentId=parent;row.timestamp=new Date().toISOString();parent=row.id;}
    await appendFile(file,rows.map(row=>'  '+JSON.stringify(row)).join('\n')+'\n');
    const originalText=await readFile(file,'utf8');
    const result=await backend.handle('invokeExtension',['coc-keeper','timeline.branch',{messageId:'reply'},{sessionId:source.id}]) as any;
    expect(result.ok).toBe(true);
    const child=result.data.session;
    expect(child.cocWorldline).toEqual({campaign:'c1',line:'if-2-1',parentSessionId:source.id});
    const childFile=(await (backend as any).locate(child.id)).path;
    expect(await readFile(childFile,'utf8')).toContain('The door opens.');
    expect(await readFile(childFile,'utf8')).not.toContain('The abandoned future.');
    expect(await readFile(file,'utf8')).toContain('The abandoned future.');
    const afterText=await readFile(file,'utf8');
    expect(afterText.slice(afterText.indexOf('\n')+1)).toBe(originalText.slice(originalText.indexOf('\n')+1));
    expect(frames.some(f=>f.event?.type==='timeline-navigate'&&f.event.payload.session.id===child.id)).toBe(true);
    const selected=await backend.handle('invokeExtension',['coc-keeper','timeline.select',{}, {sessionId:child.id}]) as any;
    expect(selected.ok).toBe(true);
    expect(calls.mock.calls.some(call=>call[2]==='table.switch'&&call[3].line==='if-2-1')).toBe(true);
    const page=await backend.handle('listSessionPage',[project.id,undefined,10]) as any;
    expect(page.sessions.find((s:any)=>s.id===child.id).cocWorldline.parentSessionId).toBe(source.id);
    currentGraph={active:'keeper-line',lines:[{name:'main'},{name:'keeper-line',forked_from:{line:'main',turn:2}}],nodes:[]};
    const followed=await backend.handle('invokeExtension',['coc-keeper','timeline.follow',{previousLine:'main'},{sessionId:source.id}]) as any;
    expect(followed.ok).toBe(true);
    expect(followed.data.session.cocWorldline.line).toBe('keeper-line');
    const replay=await backend.handle('invokeExtension',['coc-keeper','timeline.follow',{previousLine:'main'},{sessionId:source.id}]) as any;
    expect(replay.data.session.id).toBe(followed.data.session.id);
    expect(calls.mock.calls.filter(call=>call[2]==='table.branch')).toHaveLength(1);
  } finally {await backend.close();vi.restoreAllMocks();}
});
