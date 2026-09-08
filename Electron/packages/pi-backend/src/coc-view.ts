import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import type { HistoryEntry } from '@pipi/host-api';
import { KernelClient } from '../../../../extensions/kernel/client.js';

export type CocBinding = {campaign:string; home:string; play_language:string; mode?:string};
function binding(value:any): CocBinding | undefined {
  return value && typeof value.campaign === 'string' && typeof value.home === 'string'
    && ['zh-Hans','en'].includes(value.play_language) ? value : undefined;
}
export async function readCocBinding(sessionPath:string): Promise<CocBinding | undefined> {
  let found:CocBinding|undefined;
  const lines=createInterface({input:createReadStream(sessionPath),crlfDelay:Infinity});
  for await(const line of lines) {
    try {const row=JSON.parse(line);if(row.type==='custom'&&row.customType==='coc-session')found=binding(row.data)??found;} catch {}
  }
  if(found)return found;
  try {return binding(JSON.parse(await readFile(sessionPath+'.coc.json','utf8')));} catch {return undefined;}
}
export function mechanicsEntry(row:any, language?:string): HistoryEntry | undefined {
  if(row?.type==='custom' && row.customType==='coc-choice' && Array.isArray(row.data?.options)) {
    return {id:row.id,role:'assistant',content:'',timestamp:Date.parse(row.timestamp)||0,
      presentation:{renderer:'coc-choice',details:row.data}};
  }
  if(row?.type!=='custom'||row.customType!=='coc-mechanics'||!Array.isArray(row.data?.mechanics))return;
  const mechanics=row.data.mechanics.filter((x:any)=>x&&typeof x==='object'&&x.visibility!=='keeper');
  if(!mechanics.length)return;
  // §16.6: the delivery with its markers still in it, when the Keeper placed any. It rides with the
  // rows because one component has to own both to draw a row where the sentence is.
  const marked=typeof row.data.marked_text==='string'&&row.data.marked_text?{marked_text:row.data.marked_text}:{};
  return {id:row.id,role:'assistant',content:'',timestamp:Date.parse(row.timestamp)||0,
    presentation:{renderer:'coc-mechanics',details:{turn:row.data.turn,mechanics,labels:row.data.labels,...marked,play_language:row.data.play_language??language??'en'}}};
}
export async function readColdSheet(repo:string, context:CocBinding):Promise<unknown> {
  return callColdKernel(repo, context.home, 'table.view', {campaign:context.campaign});
}
/** Host management can work before a Keeper exists; this never opens a fictional turn. */
export async function callColdKernel(repo:string, home:string, method:string, params:Record<string,unknown>):Promise<unknown> {
  const client=new KernelClient({command:['uv','run','--frozen','python','-m','coc.rpc','--workspace',home,'--content',join(repo,'content')],cwd:repo,
    env:{...process.env,PYTHONPATH:join(repo,'kernel'),PYTHONDONTWRITEBYTECODE:'1'} as Record<string,string>,timeoutMs:15000});
  try {return await client.call(method,params);} finally {await client.close();}
}
