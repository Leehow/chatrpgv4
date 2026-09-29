import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {handoutReadingAnswer,type HandoutReadingDeps} from '../src/coc-handout-reading.js';
import {CocOnboardingHost} from '../src/coc-onboarding.js';

const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1cAAAAASUVORK5CYII=','base64');
const homes:string[]=[];
afterEach(()=>{for(const home of homes.splice(0))rmSync(home,{recursive:true,force:true});});
function world(){
  const home=mkdtempSync(join(tmpdir(),'coc-handout-reading-'));homes.push(home);
  const campaign=join(home,'.coc/campaigns/test'),assets=join(home,'.coc/module-campaigns/test/modules/book-1/assets');
  mkdirSync(campaign,{recursive:true});mkdirSync(assets,{recursive:true});writeFileSync(join(campaign,'campaign.json'),JSON.stringify({module_id:'book-1'}));
  const path=join(assets,'clipping.png');writeFileSync(path,PNG);
  const rows=[{handout:'clipping',name:'Clipping',text:'',document:'ready',media_type:'image/png',path},
    {handout:'letter',name:'Letter',text:'Dear sir'},
    {handout:'secret',name:'Secret',text:'',document:'ready',media_type:'image/png',path,visibility:'keeper-only'}];
  const started:any[]=[];
  const deps=(over:Partial<HandoutReadingDeps>={}):HandoutReadingDeps=>({params:{handout:'clipping'},binding:{home,campaign:'test',play_language:'en'},
    view:async()=>({handouts:rows}),table:async()=>({model:'table/vision',thinking:'high',vision:true}),lane:async()=>({model:'lane/fast',thinking:'low'}),
    host:{handoutReadingStatus:data=>{started.push(data);return {pending:true};}},...over});
  return {home,path,rows,started,deps};
}
const code=(promise:Promise<unknown>)=>promise.then(()=>'ok',error=>(error as {code?:string}).code);

it('starts a job from a handle alone and hands it only the checked file, its digest and the two model choices',async()=>{
  const w=world();
  const answer=await handoutReadingAnswer(w.deps({params:{handout:'clipping',path:'/etc/passwd',campaign:'other',play_language:'fr',image:{path:'/x'}}}));
  expect(answer).toEqual({status:'pending',handout:'clipping'});
  expect(w.started).toHaveLength(1);
  const [job]=w.started;
  // Nothing the renderer added got through: the language and campaign are the session's, the path is the row's.
  expect(job).toMatchObject({campaign:'test',handout:'clipping',play_language:'en',model:'table/vision',thinking:'high',vision:true,lane:{model:'lane/fast',thinking:'low'}});
  expect(job.image.path).toBe(realpathSync(w.path));
  expect(job.image.media_type).toBe('image/png');
  expect(job.image.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(Object.keys(job).sort()).toEqual(['campaign','handout','image','lane','model','play_language','thinking','vision']);
});

it('answers a finished reading with the reading, whether it is kept, and the picture\'s digest',async()=>{
  const w=world();
  const ready=await handoutReadingAnswer(w.deps({host:{handoutReadingStatus:()=>({title:'T',text:'Body',keep:false,digest:'ignored'})}}));
  expect(ready).toMatchObject({status:'ready',handout:'clipping',keep:false,title:'T',text:'Body'});
  expect((ready as any).digest).toMatch(/^[a-f0-9]{64}$/);
  expect(await handoutReadingAnswer(w.deps({host:{handoutReadingStatus:()=>({title:'T',text:'B',keep:true})}}))).toMatchObject({keep:true});
});

it('refuses what the player does not hold, each with its own code',async()=>{
  const w=world();
  expect(await code(handoutReadingAnswer(w.deps({binding:undefined})))).toBe('campaign_unbound');
  for(const params of [undefined,{},{handout:''},{handout:'  '},{handout:7},{handout:'x'.repeat(201)},{handout:'never-delivered'}])
    expect(await code(handoutReadingAnswer(w.deps({params})))).toBe('invalid_params');
  // Held, but not a picture the player can read: a text card, a keeper-only picture, a gone file.
  expect(await code(handoutReadingAnswer(w.deps({params:{handout:'letter'}})))).toBe('handout_not_available');
  expect(await code(handoutReadingAnswer(w.deps({params:{handout:'secret'}})))).toBe('handout_not_available');
  rmSync(w.path);
  expect(await code(handoutReadingAnswer(w.deps()))).toBe('handout_not_available');
  expect(w.started).toHaveLength(0);
});

it('a handle the table view does not list is refused even when a row of another campaign would have matched',async()=>{
  const w=world();
  const view=vi.fn(async()=>({handouts:[]}));
  expect(await code(handoutReadingAnswer(w.deps({view})))).toBe('invalid_params');
  expect(view).toHaveBeenCalledTimes(1);
});

const service=()=>{
  const home=mkdtempSync(join(tmpdir(),'coc-handout-host-'));homes.push(home);
  const host=new CocOnboardingHost({repo:resolve(import.meta.dirname,'../../../..'),home,agentDir:join(home,'agent'),env:{...process.env}});
  return host;
};
const data=(over:Record<string,unknown>={})=>({campaign:'test',handout:'clipping',play_language:'en',image:{path:'/x.png',media_type:'image/png',sha256:'a'.repeat(64)},...over});

it('runs one worker job per campaign, handout, image and language, and polls it to its reading',async()=>{
  const host=service();let finish:(value:any)=>void=()=>{};
  const run=vi.spyOn(host as any,'run').mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
  expect(host.handoutReadingStatus(data())).toEqual({pending:true});
  expect(host.handoutReadingStatus(data())).toEqual({pending:true});
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][0]).toBe('handout-reading');
  finish({title:'T',text:'B',keep:false,digest:'d'});await new Promise(resolve=>setTimeout(resolve,0));
  expect(host.handoutReadingStatus(data())).toEqual({title:'T',text:'B',keep:false,digest:'d'});
  expect(run).toHaveBeenCalledTimes(1);
  // Another language, another campaign and another image are other jobs.
  host.handoutReadingStatus(data({play_language:'fr'}));host.handoutReadingStatus(data({campaign:'two'}));
  host.handoutReadingStatus(data({image:{sha256:'b'.repeat(64)}}));
  expect(run).toHaveBeenCalledTimes(4);
  host.dispose();
});

it('a failed job is a one-shot mailbox: the refusal a player can act on keeps its code, anything else is one caption, and the next ask starts fresh',async()=>{
  const host=service();
  const failures:any[]=[Object.assign(new Error('The chosen model cannot read images'),{code:'model_without_images'}),
    Object.assign(new Error('The preparation stopped before it answered.'),{code:'interrupted'}),
    Object.assign(new Error('boom'),{code:'preparation_failed'}),Object.assign(new Error('late'),{code:'presentation_timeout'})];
  const run=vi.spyOn(host as any,'run').mockImplementation(()=>Promise.reject(failures.shift()));
  const seen:string[]=[];
  for(let round=0;round<4;round++){
    expect(host.handoutReadingStatus(data())).toEqual({pending:true});
    await new Promise(resolve=>setTimeout(resolve,0));
    try{host.handoutReadingStatus(data());seen.push('no failure');}catch(error){seen.push((error as {code:string}).code);}
  }
  expect(seen).toEqual(['model_without_images','handout_reading_failed','handout_reading_failed','presentation_timeout']);
  expect(run).toHaveBeenCalledTimes(4);
  host.dispose();
});

it('a handout row on an older transcript gets its handle from the receipt id, and a row that has one keeps it',async()=>{
  const {mechanicsEntry}=await import('../src/coc-view.js');
  const entry=(row:Record<string,unknown>)=>((mechanicsEntry({type:'custom',id:'d',customType:'coc-mechanics',data:{turn:1,mechanics:[row]}},'en') as any).presentation.details.mechanics[0]);
  expect(entry({kind:'handout',receipt:'handout:globe-1918-t6',name:'Globe'}).handout).toBe('globe-1918');
  // A handle that itself contains `-t<digits>` is read from the front: only the turn suffix is dropped.
  expect(entry({kind:'handout',receipt:'handout:card-t2-t14',name:'Card'}).handout).toBe('card-t2');
  expect(entry({kind:'handout',receipt:'handout:old-t3',handout:'kept',name:'Card'}).handout).toBe('kept');
  expect(entry({kind:'handout',receipt:'something-else',name:'Card'}).handout).toBeUndefined();
  expect(entry({kind:'handout',name:'Card'}).handout).toBeUndefined();
});
