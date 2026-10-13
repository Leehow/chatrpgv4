/** Synthetic authored rule input, exercising the production RPC boundary. */
import {cpSync} from 'node:fs';
import {join} from 'node:path';
import {isolated} from './rules-engine-support.ts';
import {RpcClient,CONTENT_DIR,ROOT,readJson,writeJson,campaignDir} from './support.ts';
export const source={source_id:'pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting',pdf_index:452};
export const span='span-page-447-anchor-1';
export async function derivedTable(t:any,seed:number,rules:Record<string,any>,mutate?:(content:string)=>void){
  const {workspace}=await isolated(t),content=join(workspace,'content');cpSync(CONTENT_DIR,content,{recursive:true});
  cpSync(join(ROOT,'mods/pushed-roll'),join(workspace,'mods/pushed-roll'),{recursive:true});
  const path=join(content,'starters/the-haunting/module-graph.json'),graph=readJson(path);
  for(const [slug,mechanics] of Object.entries(rules)){
    graph.nodes.push({node_id:`rule-${slug}`,node_kind:'rule',name:slug,visibility:'keeper-only',aliases:[],summary:`${slug}.`,evidence_span_ids:[span],properties:{mechanics},source_refs:[source]});
    graph.relations.push({relation_id:`relation-derived-${graph.relations.length}`,relation_kind:'uses-rule',from_node_id:'scene-commission-briefing',to_node_id:`rule-${slug}`,properties:{}});
  }
  writeJson(path,graph);mutate?.(content);
  const client=new RpcClient(join(workspace,'case'),{content,env:{COC_KERNEL_SEED:String(seed)}});t.after(()=>client.close());
  await client.ok('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await client.table('narrate',{call_id:'t0-c1',text:'The opening.'});await client.table('player_input',{text:'I look around the office.'});return client;
}
export const savedReceipts=(client:RpcClient)=>readJson(join(campaignDir(client.workspace),'turn.json')).receipts;
export const savedSheet=(client:RpcClient)=>readJson(join(campaignDir(client.workspace),'party/thomas-hayes.json'));
export const savedClock=(client:RpcClient)=>readJson(join(campaignDir(client.workspace),'world.json')).clock.minutes;
export const apply=(client:RpcClient,call_id:string,...effects:any[])=>client.call('table.apply',{campaign:'c1',call_id,effects});
export function ok(response:any){if(!response.ok)throw new Error(JSON.stringify(response.error));return response.result;}
