/** Real RPC profile confirmation: a correct handshake must not be reselected. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import * as driver from '../play/driver.ts';
import {ROOT} from './support.ts';
const FAKE_PI=join(ROOT,'tests/play/fixtures/fake-pi-rpc.mjs');
async function capturedDaemon(t:any,options:any={}){const old=driver.runtime.processFactory,captured:any={};class FakePiProcess{proc={pid:999999};constructor(launcher:any,args:any,_stderr:any,_events:any,_log:any,settings:any){captured.args=args;captured.env=settings.env??null;}call(request:any){(captured.calls??=[]).push(request);if(request.type==='get_state'&&options.ready)return {success:true,data:options.ready};if(request.type==='set_model'&&options.rejectSelection)return {success:false,error:'model unavailable'};return {success:true};}terminate(){}alive(){return true;}}driver.runtime.processFactory=FakePiProcess;const run='fixture-ts-profile-'+randomUUID().slice(0,10);t.after(()=>{driver.runtime.processFactory=old;rmSync(driver.run_dir(run),{recursive:true,force:true});});await driver.Daemon.create(run,'test-campaign',FAKE_PI,options.model??null,options.thinking??null,options.first_step_thinking??false);return captured;}

test('startup accepts an exactly matched profile without a redundant failing selection',async t=>{const c=await capturedDaemon(t,{model:'minimax-cn/MiniMax-M3.1-Flash-Preview',thinking:'medium',ready:{model:{provider:'minimax-cn',id:'MiniMax-M3.1-Flash-Preview'},thinkingLevel:'medium'},rejectSelection:true});assert.deepEqual(c.calls,[{type:'get_state'}]);});
test('startup still rejects failed selection when the current model differs',async t=>{await assert.rejects(capturedDaemon(t,{model:'minimax-cn/MiniMax-M3.1-Flash-Preview',thinking:'medium',ready:{model:{provider:'minimax-cn',id:'MiniMax-M3'},thinkingLevel:'medium'},rejectSelection:true}),/set_model.*failed/);});

test('the default live profile remains Luna high throughout the request and supporting lanes',async t=>{
 const args=driver.build_parser().parse_args(['start','--campaign','default-profile']);
 assert.equal(args.model,'codex-relay/gpt-6-luna');assert.equal(args.thinking,'high');
 const c=await capturedDaemon(t,{model:args.model,thinking:args.thinking,ready:{model:{provider:'codex-relay',id:'gpt-6-luna'},thinkingLevel:'high'}});
 assert.equal(c.args[c.args.indexOf('--thinking')+1],'high');assert.equal(c.env.PI_COC_TEST_MODEL,args.model);
 for(const name of driver.TEST_LANE_MODEL_ENVS){assert.equal(c.env[name],args.model);assert.equal(c.env[name+'_THINKING'],'high');}
});
