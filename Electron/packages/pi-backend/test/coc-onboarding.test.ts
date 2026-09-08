import {afterEach, expect, it} from 'vitest';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {CocOnboardingHost} from '../src/coc-onboarding.js';

const services:CocOnboardingHost[]=[];
async function service(){
  const home=await mkdtemp(join(tmpdir(),'coc-onboarding-'));
  const repo=resolve(import.meta.dirname,'../../../..');
  const host=new CocOnboardingHost({repo,home,agentDir:join(home,'agent'),env:{...process.env,PI_COC_READER_CMD:JSON.stringify([process.execPath,join(repo,'tests/extension/fixtures/guidance-reader.mjs')]),UV_CACHE_DIR:'/tmp/pi-coc-uv-cache'}});
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
it('conversation binding is idempotent and never creates an investigator',async()=>{
  const {host,home}=await service();
  const catalog=await host.invoke({action:'catalog'},'one',model);
  expect(catalog.presets.some((p:any)=>p.id==='the-haunting')).toBe(true);
  let job=await host.invoke({action:'select',source:'starter',module_id:'the-haunting',name:'The Haunting',play_language:'en'},'one',model);
  const deadline=Date.now()+10000;
  while(job.state==='preparing'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,50));job=await host.invoke({action:'status',id:job.id},'one',model)}
  expect(job.state).toBe('ready');
  let reused=await host.invoke({action:'select',source:'starter',module_id:'the-haunting',name:'The Haunting',play_language:'en'},'two',model);
  const reuseDeadline=Date.now()+10000;
  while(reused.state==='preparing'&&Date.now()<reuseDeadline){await new Promise(r=>setTimeout(r,50));reused=await host.invoke({action:'status',id:reused.id},'two',model)}
  expect(reused.state).toBe('ready');expect(reused.guidance).toEqual(job.guidance);
  const {readdir}=await import('node:fs/promises');
  const cache=join(home,'.coc/modules/the-haunting/character-guidance');
  const keys=await readdir(cache);expect(keys).toHaveLength(1);
  expect(await readdir(join(cache,keys[0],'attempts'))).toHaveLength(1);
  const params={action:'converse',id:job.id};
  const first=await host.invoke(params,'one',model);
  const replay=await host.invoke(params,'one',model);
  expect(first.state).toBe('conversing');expect(replay.campaign).toBe(first.campaign);
  const campaign=JSON.parse(await readFile(join(home,'.coc/campaigns',first.campaign,'campaign.json'),'utf8'));
  expect(campaign.status).toBe('setting_up');
  const {readdir:files}=await import('node:fs/promises');
  expect((await files(join(home,'.coc/campaigns',first.campaign,'party'))).filter(x=>x.endsWith('.json'))).toHaveLength(0);
  await expect(host.invoke({action:'create',id:job.id,character:{name:'Forbidden',occupation:'Journalist'}},'one',model)).rejects.toThrow('Unknown onboarding action');
});
