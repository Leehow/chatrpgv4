/** Native engine test wiring; no rule arithmetic is implemented here. */
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {after,type TestContext} from 'node:test';
import {importSource,CONTENT_DIR,ROOT} from './support.ts';
export {importSource,CONTENT_DIR,ROOT};
export const native=await importSource('tests/integration/rules-engine-native.ts');
export const {createKernelContext,RuleTables,CheckArithmetic,CampaignWriter,PythonRandom}=native;
export const plain=(value:any):any=>JSON.parse(native.pythonJsonDumps(value));
const workspace=mkdtempSync(join(ROOT,'.tmp/rules-engine-'));
after(()=>rmSync(workspace,{recursive:true,force:true}));
export const context=await createKernelContext({workspace,content:CONTENT_DIR});
export const tables=new RuleTables(context);
export const arithmetic=await CheckArithmetic.create(tables);
export async function isolated(t:TestContext){
  const workspace=mkdtempSync(join(ROOT,'.tmp/rules-case-'));
  t.after(()=>rmSync(workspace,{recursive:true,force:true}));
  const context=await createKernelContext({workspace,content:CONTENT_DIR});
  return {workspace,context,campaign:new CampaignWriter(context,'case-1')};
}
