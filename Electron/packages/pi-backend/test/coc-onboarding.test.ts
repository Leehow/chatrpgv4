import {afterEach, expect, it} from 'vitest';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {CocOnboardingHost} from '../src/coc-onboarding.js';

const services:CocOnboardingHost[]=[];
async function service(){
  const home=await mkdtemp(join(tmpdir(),'coc-onboarding-'));
  const repo=resolve(import.meta.dirname,'../../../..');
  const host=new CocOnboardingHost({repo,home,agentDir:join(home,'agent'),env:{...process.env,UV_CACHE_DIR:'/tmp/pi-coc-uv-cache'}});
  services.push(host);return {host,home};
}
afterEach(()=>{for(const host of services.splice(0))host.dispose()});
const model={id:'test/no-provider',thinking:'low',vision:true};
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
  expect(invalid.error).toBeTruthy();
});
it('preset setup uses the canonical kernel and creating twice keeps one investigator',async()=>{
  const {host}=await service();
  const catalog=await host.invoke({action:'catalog'},'one',model);
  expect(catalog.presets.some((p:any)=>p.id==='the-haunting')).toBe(true);
  let job=await host.invoke({action:'select',source:'starter',module_id:'the-haunting',name:'The Haunting'},'one',model);
  const deadline=Date.now()+10000;
  while(job.state==='preparing'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,50));job=await host.invoke({action:'status',id:job.id},'one',model)}
  expect(job.state).toBe('ready');
  const params={action:'create',id:job.id,character:{name:'Ada',occupation:'Journalist',age:27},play_language:'en'};
  const created=await host.invoke(params,'one',model);
  const replay=await host.invoke(params,'one',model);
  expect(created.state).toBe('created');expect(replay.campaign).toBe(created.campaign);
  expect(replay.view.investigators).toHaveLength(1);expect(replay.view.investigators[0].name).toBe('Ada');
  expect(replay.view.investigators[0].hp).toBeGreaterThan(0);
});
