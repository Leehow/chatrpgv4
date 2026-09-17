import {expect,it,vi} from 'vitest';
import {cp,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const mocks=vi.hoisted(()=>({callColdKernel:vi.fn()}));
vi.mock('../src/coc-view.js',async(importOriginal)=>({...await importOriginal<typeof import('../src/coc-view.js')>(),callColdKernel:mocks.callColdKernel}));

/**
 * A backend with a session bound to a campaign sidecar, in the shape the cold-host tests in
 * coc-view.test.ts use: the kernel call is mocked, Pi never spawns, and the presentation host
 * records what the override projection is asked to draw.
 */
async function boundBackend() {
  const {createPiHostBackend}=await import('../src/index.js');
  const repo=resolve(import.meta.dirname,'../../../..'),root=await mkdtemp(join(tmpdir(),'coc-draft-override-'));
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

it('draft-override calls the kernel cold, refreshes history, and starts the new revision\'s projection',async()=>{
  mocks.callColdKernel.mockReset();
  const {backend,repo,root,session,located,presentations}=await boundBackend();
  try {
    mocks.callColdKernel.mockResolvedValue({revision:2,sheet:{name:'艾琳'},profile:{name:'艾琳'},labels:{STR:'力量'},limits:{characteristic_min:15}});
    (backend as any).historyCache.set(located.path,{mtimeMs:0,size:0,before:0,limit:1,entries:[]});
    const result=await backend.handle('invokeExtension',['coc-keeper','draft-override',
      {revision:1,edits:{characteristics:{STR:50}},limits_override:{skill_cap:80},campaign:'not-trusted',sheet:{name:'not-trusted'}},
      {sessionId:session.id}]) as any;
    expect(result).toEqual({ok:true,data:{revision:2,sheet:{name:'艾琳'},profile:{name:'艾琳'},labels:{STR:'力量'},limits:{characteristic_min:15}}});
    expect(mocks.callColdKernel).toHaveBeenCalledTimes(1);
    const call=mocks.callColdKernel.mock.calls[0];
    expect(call[0]).toBe(repo);
    expect(call[1]).toBe(root);
    expect(call[2]).toBe('setup.override');
    // The campaign comes from the session binding, and no client-supplied sheet reaches the kernel.
    expect(call[3]).toEqual({campaign:'c1',revision:1,edits:{characteristics:{STR:50}},limits_override:{skill_cap:80}});
    // The cached page is stale the moment the kernel answers, and the new revision's words start.
    expect((backend as any).historyCache.has(located.path)).toBe(false);
    await vi.waitFor(()=>expect(presentations.length).toBe(1));
    expect(presentations[0]).toMatchObject({campaign:'c1',revision:2,play_language:'zh-Hans',labels:{STR:'力量'}});
  } finally {await backend.close();}
},20000);

it('draft-override dry_run returns the would-be result with no cache or projection side effects',async()=>{
  mocks.callColdKernel.mockReset();
  const {backend,session,located,presentations}=await boundBackend();
  try {
    mocks.callColdKernel.mockResolvedValue({revision:2,sheet:{name:'preview'},labels:{},limits:{}});
    (backend as any).historyCache.set(located.path,{mtimeMs:0,size:0,before:0,limit:1,entries:[]});
    const result=await backend.handle('invokeExtension',['coc-keeper','draft-override',
      {revision:1,edits:{characteristics:{STR:50}},dry_run:true},{sessionId:session.id}]) as any;
    expect(result.ok).toBe(true);
    expect(result.data.revision).toBe(2);
    expect(mocks.callColdKernel.mock.calls[0][3]).toEqual({campaign:'c1',revision:1,edits:{characteristics:{STR:50}},dry_run:true});
    expect((backend as any).historyCache.has(located.path)).toBe(true);
    await new Promise(resolve=>setTimeout(resolve,50));
    expect(presentations.length).toBe(0);
  } finally {await backend.close();}
},20000);

it('draft-override degrades a stale revision to superseded and maps other kernel errors',async()=>{
  mocks.callColdKernel.mockReset();
  const {backend,session,located,presentations,root}=await boundBackend();
  try {
    (backend as any).historyCache.set(located.path,{mtimeMs:0,size:0,before:0,limit:1,entries:[]});
    mocks.callColdKernel.mockRejectedValue({code:'idempotency_conflict',message:'The override is not the current draft'});
    expect(await backend.handle('invokeExtension',['coc-keeper','draft-override',{revision:1,edits:{characteristics:{STR:50}}},{sessionId:session.id}]))
      .toEqual({ok:true,data:{superseded:true}});
    // A stale answer never touches the cached page nor starts a projection.
    expect((backend as any).historyCache.has(located.path)).toBe(true);
    await new Promise(resolve=>setTimeout(resolve,50));
    expect(presentations.length).toBe(0);
    // When the campaign's draft store is readable the superseded answer carries the current draft,
    // so the card the player was editing can be redrawn on what is real.
    mocks.callColdKernel.mockRejectedValue({code:'idempotency_conflict',codeDetail:'stale_draft',message:'Confirm the current draft'});
    const campaignFolder=join(root,'.coc/campaigns/c1');
    await mkdir(join(campaignFolder,'setup/drafts'),{recursive:true});
    await writeFile(join(campaignFolder,'campaign.json'),JSON.stringify({setup:{draft_revision:3}}));
    await writeFile(join(campaignFolder,'setup/drafts/3.json'),JSON.stringify({revision:3,play_language:'zh-Hans',sheet:{name:'current'},limits:{characteristic_min:15}}));
    const moved=await backend.handle('invokeExtension',['coc-keeper','draft-override',{revision:1,edits:{characteristics:{STR:50}}},{sessionId:session.id}]) as any;
    expect(moved.ok).toBe(true);
    expect(moved.data.superseded).toBe(true);
    expect(moved.data.draft).toMatchObject({revision:3,sheet:{name:'current'}});
    // `stale_draft` under any other code is a refusal, not a stale answer: a needs refusal is
    // validation, and its details ride the denial so the modal can mark the exact input.
    mocks.callColdKernel.mockRejectedValue({code:'needs',codeDetail:'stale_draft',message:'Confirm the current draft'});
    const misfiled=await backend.handle('invokeExtension',['coc-keeper','draft-override',{revision:1,edits:{characteristics:{STR:50}}},{sessionId:session.id}]) as any;
    expect(misfiled.ok).toBe(false);
    expect(misfiled.error.code).toBe('needs');
    mocks.callColdKernel.mockRejectedValue({code:'needs',message:'occupation points overspent',details:{pool:'occupation',total:200,spend:220,field:'Firearms',range:[20,75]}});
    const refused=await backend.handle('invokeExtension',['coc-keeper','draft-override',{revision:1,edits:{characteristics:{STR:50}}},{sessionId:session.id}]) as any;
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe('needs');
    expect(refused.error.details).toMatchObject({pool:'occupation',field:'Firearms'});
  } finally {await backend.close();}
},20000);

it('draft-override validates its own envelope before any kernel call',async()=>{
  mocks.callColdKernel.mockReset();
  const {backend,session}=await boundBackend();
  try {
    const noSession=await backend.handle('invokeExtension',['coc-keeper','draft-override',{revision:1,edits:{}}]) as any;
    expect(noSession.ok).toBe(false);
    const badRevision=await backend.handle('invokeExtension',['coc-keeper','draft-override',{revision:0,edits:{}},{sessionId:session.id}]) as any;
    expect(badRevision.ok).toBe(false);
    const badEdits=await backend.handle('invokeExtension',['coc-keeper','draft-override',{revision:1,edits:'STR=50'},{sessionId:session.id}]) as any;
    expect(badEdits.ok).toBe(false);
    const badLimits=await backend.handle('invokeExtension',['coc-keeper','draft-override',{revision:1,edits:{},limits_override:7},{sessionId:session.id}]) as any;
    expect(badLimits.ok).toBe(false);
    const badFlag=await backend.handle('invokeExtension',['coc-keeper','draft-override',{revision:1,edits:{},dry_run:'yes'},{sessionId:session.id}]) as any;
    expect(badFlag.ok).toBe(false);
    expect(mocks.callColdKernel).not.toHaveBeenCalled();
    // A session with no campaign binding cannot override anything.
    const projects=await backend.handle('listProjects',[]) as any[];
    const orphan=await backend.handle('newSession',[projects[0].id]) as any;
    const unbound=await backend.handle('invokeExtension',['coc-keeper','draft-override',{revision:1,edits:{}},{sessionId:orphan.id}]) as any;
    expect(unbound.ok).toBe(false);
    expect(mocks.callColdKernel).not.toHaveBeenCalled();
  } finally {await backend.close();}
},20000);

/**
 * §98: the card may move a skill between the two pools and change the age, which are profile facts
 * rather than numeric edits. Exactly three keys travel this way, so the patch cannot be used as an
 * open door into the rest of the draft.
 */
it('draft-override carries a profile patch of exactly the three fields the card can change',async()=>{
  mocks.callColdKernel.mockReset();
  const {backend,session}=await boundBackend();
  try {
    mocks.callColdKernel.mockResolvedValue({revision:2,sheet:{name:'Eileen'},labels:{}});
    const profile={occupation_skills:['Accounting','Library Use'],interest_skills:['Dodge'],age:52};
    await backend.handle('invokeExtension',['coc-keeper','draft-override',{revision:1,edits:{},profile},{sessionId:session.id}]);
    expect(mocks.callColdKernel.mock.calls[0][3]).toEqual({campaign:'c1',revision:1,edits:{},profile});
    // One list alone is a patch too; the kernel keeps whatever the card did not send.
    await backend.handle('invokeExtension',['coc-keeper','draft-override',{revision:1,edits:{},profile:{age:19}},{sessionId:session.id}]);
    expect(mocks.callColdKernel.mock.calls[1][3]).toEqual({campaign:'c1',revision:1,edits:{},profile:{age:19}});
  } finally {await backend.close();}
},20000);

it('draft-override refuses a profile that is not the three fields, before any kernel call',async()=>{
  mocks.callColdKernel.mockReset();
  const {backend,session}=await boundBackend();
  try {
    const refuse=async(profile:unknown)=>{
      const answer=await backend.handle('invokeExtension',['coc-keeper','draft-override',{revision:1,edits:{},profile},{sessionId:session.id}]) as any;
      expect(answer.ok).toBe(false);
      expect(answer.error.code).toBe('invalid_params');
      return answer.error.message as string;
    };
    // A field nobody asked for is named, not silently dropped: a patch that half-applies is worse
    // than one that is refused.
    expect(await refuse({name:'Someone else'})).toContain('name');
    expect(await refuse({occupation:''})).toContain('occupation');
    expect(await refuse({occupation:7})).toContain('occupation');
    expect(await refuse({custom_skills:[{name:'Bagpipes'}]})).toContain('custom_skills');
    expect(await refuse({custom_skills:[{name:'Bagpipes',base:5,pool:'interest'}]})).toContain('custom_skills');
    expect(await refuse({custom_skills:{name:'Bagpipes',base:5}})).toContain('custom_skills');
    expect(await refuse({occupation_skills:'Accounting'})).toContain('occupation_skills');
    expect(await refuse({interest_skills:[7]})).toContain('interest_skills');
    expect(await refuse({age:'52'})).toContain('age');
    expect(await refuse({age:28.5})).toContain('age');
    expect(await refuse('occupation_skills=Accounting')).toContain('profile');
    expect(mocks.callColdKernel).not.toHaveBeenCalled();
  } finally {await backend.close();}
},20000);

/**
 * §98: the worksheet sends what each pool bought. A bare number is still a final value, for a card
 * drawn before the boxes existed.
 */
it('draft-override accepts a skill edit as a final value or as the two boxes, and refuses anything else',async()=>{
  mocks.callColdKernel.mockReset();
  const {backend,session}=await boundBackend();
  try {
    mocks.callColdKernel.mockResolvedValue({revision:2,sheet:{name:'Eileen'},labels:{}});
    const skills={Accounting:{occupation:45,interest:0},Dodge:{interest:26},'Spot Hidden':60};
    await backend.handle('invokeExtension',['coc-keeper','draft-override',{revision:1,edits:{skills}},{sessionId:session.id}]);
    expect(mocks.callColdKernel.mock.calls[0][3]).toEqual({campaign:'c1',revision:1,edits:{skills}});
    await backend.handle('invokeExtension',['coc-keeper','draft-override',
      {revision:1,edits:{skills:{Accounting:{occupation:45}}},profile:{occupation:'mechanic',custom_skills:[{name:'Bagpipes',base:5}]}},{sessionId:session.id}]);
    expect(mocks.callColdKernel.mock.calls[1][3]).toMatchObject({profile:{occupation:'mechanic',custom_skills:[{name:'Bagpipes',base:5}]}});
    mocks.callColdKernel.mockClear();
    for(const bad of [{Accounting:'45'},{Accounting:{occupation:-1}},{Accounting:{occupation:1.5}},{Accounting:{pool:'occupation'}},{Accounting:null}]) {
      const answer=await backend.handle('invokeExtension',['coc-keeper','draft-override',{revision:1,edits:{skills:bad}},{sessionId:session.id}]) as any;
      expect(answer.ok).toBe(false);
      expect(answer.error.message).toContain('Accounting');
    }
    expect(mocks.callColdKernel).not.toHaveBeenCalled();
  } finally {await backend.close();}
},20000);

it('draft-catalog reads the book cold, through the session\'s own campaign',async()=>{
  mocks.callColdKernel.mockReset();
  const {backend,repo,root,session}=await boundBackend();
  try {
    const book={occupations:[{id:'lawyer',label:'Lawyer',skills:['Law'],credit_rating_range:[30,80],formula:'EDU*4'}],skills:[{name:'Law',label:'Law'}],weapons:[]};
    mocks.callColdKernel.mockResolvedValue(book);
    const answer=await backend.handle('invokeExtension',['coc-keeper','draft-catalog',{},{sessionId:session.id}]) as any;
    expect(answer).toEqual({ok:true,data:book});
    expect(mocks.callColdKernel.mock.calls[0].slice(0,4)).toEqual([repo,root,'setup.catalog',{campaign:'c1'}]);
    // No session, no campaign: the book a campaign plays by is the campaign's.
    expect((await backend.handle('invokeExtension',['coc-keeper','draft-catalog',{}]) as any).ok).toBe(false);
    const projects=await backend.handle('listProjects',[]) as any[];
    const orphan=await backend.handle('newSession',[projects[0].id]) as any;
    expect((await backend.handle('invokeExtension',['coc-keeper','draft-catalog',{},{sessionId:orphan.id}]) as any).ok).toBe(false);
    expect(mocks.callColdKernel).toHaveBeenCalledTimes(1);
  } finally {await backend.close();}
},20000);
