import {expect,it,vi} from 'vitest';
import {cp,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const mocks=vi.hoisted(()=>({callColdKernel:vi.fn()}));
vi.mock('../src/coc-view.js',async(importOriginal)=>({...await importOriginal<typeof import('../src/coc-view.js')>(),callColdKernel:mocks.callColdKernel}));

/**
 * The card's own actions (§98), on the same bench the override tests use: a session bound to a
 * campaign sidecar, the kernel call mocked, Pi asleep, and the presentation host recording what
 * each fresh revision is asked to draw.
 */
async function boundBackend() {
  const {createPiHostBackend}=await import('../src/index.js');
  const repo=resolve(import.meta.dirname,'../../../..'),root=await mkdtemp(join(tmpdir(),'coc-draft-actions-'));
  const profile=join(root,'profile'),pack=join(profile,'extensions/coc-keeper');await mkdir(pack,{recursive:true});
  await cp(join(repo,'pipiui-extension.json'),join(pack,'pipiui-extension.json'));await cp(join(repo,'pipicoc'),join(pack,'pipicoc'),{recursive:true});
  const presentations:any[]=[];
  const host={presentation:async(request:any)=>{presentations.push(request);return {};},presentationStatus:()=>({pending:true}),close:async()=>{}};
  const registry={get:()=>host,close:async()=>{}};
  const backend=createPiHostBackend({agentDir:profile,sessionsRoot:join(root,'sessions'),runtimeRoot:join(root,'runtime'),defaultPack:'coc-keeper',
    managedNodeModulesRoot:join(repo,'node_modules'),cocOnboardingRegistry:registry as any,
    env:{...process.env,PI_COC_HOME:root,PATH:'/usr/bin:/bin'},piCommand:{executable:join(repo,'pipicoc/rpc'),env:{PATH:process.env.PATH!}},
    spawn:()=>{throw new Error('Pi must remain asleep');}});
  await backend.handle('addProject',[root]);const projects=await backend.handle('listProjects',[]) as any[];
  const session=await backend.handle('newSession',[projects[0].id]) as any;
  const located=await (backend as any).locate(session.id);
  await writeFile(located.path+'.coc.json',JSON.stringify({campaign:'c1',home:root,play_language:'zh-Hans'}));
  vi.spyOn(backend as any,'getModelState').mockResolvedValue({model:{provider:'unknown',id:'fixture'},thinkingLevel:'low'});
  return {backend,repo,root,session,located,presentations};
}

it('draft-spread revises the current draft with the allocator and starts the new revision\'s projection',async()=>{
  mocks.callColdKernel.mockReset();
  const {backend,repo,root,session,located,presentations}=await boundBackend();
  try {
    mocks.callColdKernel.mockResolvedValue({revision:6,sheet:{name:'Eileen'},pins:{characteristics:{DEX:{value:90,by:'player'}}},
      budget:{occupation:{total:110,spent:110,unspent:0},interest:{total:31,spent:31,unspent:0},legal:true,notes:[]},labels:{STR:'力量'}});
    (backend as any).historyCache.set(located.path,{mtimeMs:0,size:0,before:0,limit:1,entries:[]});
    const result=await backend.handle('invokeExtension',['coc-keeper','draft-spread',{revision:5,campaign:'not-trusted'},{sessionId:session.id}]) as any;
    expect(result.ok).toBe(true);
    expect(result.data.revision).toBe(6);
    const call=mocks.callColdKernel.mock.calls[0];
    expect(call[0]).toBe(repo);
    expect(call[1]).toBe(root);
    expect(call[2]).toBe('setup.revise');
    // The campaign is the session's own binding, never the client's.
    expect(call[3]).toEqual({campaign:'c1',revision:5,auto_spread:true});
    expect((backend as any).historyCache.has(located.path)).toBe(false);
    await vi.waitFor(()=>expect(presentations.length).toBe(1));
    expect(presentations[0]).toMatchObject({campaign:'c1',revision:6,play_language:'zh-Hans',labels:{STR:'力量'}});
  } finally {await backend.close();}
},20000);

it('draft-reroll throws the dice again and keeps the pins',async()=>{
  mocks.callColdKernel.mockReset();
  const {backend,session,located,presentations}=await boundBackend();
  try {
    mocks.callColdKernel.mockResolvedValue({revision:7,sheet:{name:'Eileen'},labels:{}});
    const result=await backend.handle('invokeExtension',['coc-keeper','draft-reroll',{revision:6},{sessionId:session.id}]) as any;
    expect(result.ok).toBe(true);
    expect(mocks.callColdKernel.mock.calls[0][2]).toBe('setup.reroll');
    expect(mocks.callColdKernel.mock.calls[0][3]).toEqual({campaign:'c1',revision:6,keep_pins:true});
    expect((backend as any).historyCache.has(located.path)).toBe(false);
    await vi.waitFor(()=>expect(presentations.length).toBe(1));
    expect(presentations[0]).toMatchObject({revision:7});
  } finally {await backend.close();}
},20000);

it('a spread or reroll on a draft that moved answers with the current one, and a needs refusal stays a refusal',async()=>{
  mocks.callColdKernel.mockReset();
  const {backend,session,located,presentations,root}=await boundBackend();
  try {
    (backend as any).historyCache.set(located.path,{mtimeMs:0,size:0,before:0,limit:1,entries:[]});
    mocks.callColdKernel.mockRejectedValue({code:'idempotency_conflict',message:'That is not the current draft'});
    expect(await backend.handle('invokeExtension',['coc-keeper','draft-spread',{revision:1},{sessionId:session.id}]))
      .toEqual({ok:true,data:{superseded:true}});
    // A stale answer never touches the cached page nor starts a projection.
    expect((backend as any).historyCache.has(located.path)).toBe(true);
    await new Promise(resolve=>setTimeout(resolve,50));
    expect(presentations.length).toBe(0);
    const campaignFolder=join(root,'.coc/campaigns/c1');
    await mkdir(join(campaignFolder,'setup/drafts'),{recursive:true});
    await writeFile(join(campaignFolder,'campaign.json'),JSON.stringify({setup:{draft_revision:3}}));
    await writeFile(join(campaignFolder,'setup/drafts/3.json'),JSON.stringify({revision:3,play_language:'zh-Hans',sheet:{name:'current'},limits:{characteristic_min:15}}));
    const moved=await backend.handle('invokeExtension',['coc-keeper','draft-reroll',{revision:1},{sessionId:session.id}]) as any;
    expect(moved.data.superseded).toBe(true);
    expect(moved.data.draft).toMatchObject({revision:3,sheet:{name:'current'}});
    mocks.callColdKernel.mockRejectedValue({code:'needs',message:'Raise the limit first',details:{field:'occupation_points',unlock:true}});
    const refused=await backend.handle('invokeExtension',['coc-keeper','draft-spread',{revision:1},{sessionId:session.id}]) as any;
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe('needs');
    expect(refused.error.details).toMatchObject({field:'occupation_points'});
  } finally {await backend.close();}
},20000);

/**
 * Confirmation is the button, and the button is the host: two cold calls and no model turn. The
 * app says one sentence into the session afterwards, which is why nothing here writes a prompt.
 */
it('draft-confirm confirms the revision and completes setup on the cold kernel, telling no model',async()=>{
  mocks.callColdKernel.mockReset();
  const {backend,repo,root,session,presentations}=await boundBackend();
  try {
    mocks.callColdKernel.mockImplementation(async(_repo:string,_home:string,method:string)=>
      method==='setup.confirm'?{confirmed_revision:5}:{status:'ready'});
    const result=await backend.handle('invokeExtension',['coc-keeper','draft-confirm',{revision:5},{sessionId:session.id}]) as any;
    expect(result).toEqual({ok:true,data:{confirmed:true,revision:5,status:'ready'}});
    expect(mocks.callColdKernel).toHaveBeenCalledTimes(2);
    expect(mocks.callColdKernel.mock.calls[0].slice(0,4)).toEqual([repo,root,'setup.confirm',{campaign:'c1',revision:5,consent:'approved'}]);
    expect(mocks.callColdKernel.mock.calls[1].slice(0,4)).toEqual([repo,root,'setup.complete',{campaign:'c1'}]);
    // Confirming draws no card: the table is what comes next, not another revision.
    await new Promise(resolve=>setTimeout(resolve,50));
    expect(presentations.length).toBe(0);
  } finally {await backend.close();}
},20000);

it('draft-confirm never completes a setup the confirm refused',async()=>{
  mocks.callColdKernel.mockReset();
  const {backend,session}=await boundBackend();
  try {
    mocks.callColdKernel.mockRejectedValue({code:'needs',message:'The draft has no occupation',details:{field:'occupation'}});
    const refused=await backend.handle('invokeExtension',['coc-keeper','draft-confirm',{revision:5},{sessionId:session.id}]) as any;
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe('needs');
    expect(refused.error.details).toMatchObject({field:'occupation'});
    expect(mocks.callColdKernel).toHaveBeenCalledTimes(1);
  } finally {await backend.close();}
},20000);

it('every card action validates its own envelope before any kernel call',async()=>{
  mocks.callColdKernel.mockReset();
  const {backend,session}=await boundBackend();
  try {
    for(const method of ['draft-spread','draft-reroll','draft-confirm']) {
      expect((await backend.handle('invokeExtension',['coc-keeper',method,{revision:1}]) as any).ok).toBe(false);
      expect((await backend.handle('invokeExtension',['coc-keeper',method,{revision:0},{sessionId:session.id}]) as any).ok).toBe(false);
      expect((await backend.handle('invokeExtension',['coc-keeper',method,{revision:'5'},{sessionId:session.id}]) as any).ok).toBe(false);
      expect((await backend.handle('invokeExtension',['coc-keeper',method,{},{sessionId:session.id}]) as any).ok).toBe(false);
    }
    expect(mocks.callColdKernel).not.toHaveBeenCalled();
    // A session with no campaign binding has no draft to act on.
    const projects=await backend.handle('listProjects',[]) as any[];
    const orphan=await backend.handle('newSession',[projects[0].id]) as any;
    for(const method of ['draft-spread','draft-reroll','draft-confirm'])
      expect((await backend.handle('invokeExtension',['coc-keeper',method,{revision:1},{sessionId:orphan.id}]) as any).ok).toBe(false);
    expect(mocks.callColdKernel).not.toHaveBeenCalled();
  } finally {await backend.close();}
},20000);
