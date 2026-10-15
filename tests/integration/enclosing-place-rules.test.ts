/** New behavior is independent of the frozen migrated assertion corpus. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cpSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {CAMPAIGN,CONTENT_DIR,ROOT,RpcClient} from './support.ts';

test('a new subscene exposes and settles enclosing rules without borrowing sibling rules',async t=>{
 const home=mkdtempSync(join(ROOT,'.tmp/enclosing-rules-'));
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const content=join(home,'content');cpSync(CONTENT_DIR,content,{recursive:true});
 const path=join(content,'starters/the-haunting/module-graph.json'),graph=JSON.parse(readFileSync(path,'utf8'));
 for(const [name,scene] of [['area-observation','scene-commission-briefing'],['other-room-observation','scene-central-library']]){
  graph.nodes.push({node_id:'rule-'+name,node_kind:'rule',name,aliases:[],visibility:'keeper-only',summary:name,
   evidence_span_ids:['span-page-447-anchor-1'],source_refs:[{source_id:'pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting',pdf_index:452}],
   properties:{mechanics:{check:{scope:'actor',values:[{path:'skills.Spot Hidden',label:'Spot Hidden'}],selection:'maximum',difficulty:'regular'}}}});
  graph.relations.push({relation_id:'scope-'+name,relation_kind:'uses-rule',from_node_id:scene,to_node_id:'rule-'+name,properties:{}});
 }
 writeFileSync(path,JSON.stringify(graph));
 const client=new RpcClient(join(home,'table'),{content,env:{COC_KERNEL_SEED:'1'}});
 t.after(()=>client.close());
 await client.ok('campaign.create',{id:CAMPAIGN,module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
 await client.table('narrate',{call_id:'t0-c1',text:'The opening.'});
 await client.table('player_input',{text:'I check a corner of the same office.'});
 await client.table('apply',{call_id:'t1-c1',effects:[{kind:'move',to:'Office side corner',via:'Across the same office floor',
  establish:{summary:'A quiet corner within the office.',within:'scene-commission-briefing'}}]});
 const capsule=await client.table('capsule');
 assert(capsule.where.rules.some((rule:any)=>rule.name==='area-observation'));
 assert(!capsule.where.rules.some((rule:any)=>rule.name==='other-room-observation'));
 const action={intent:'investigate',goal:'Examine the office',method:'Look carefully'};
 const rolled=await client.table('resolve',{call_id:'t1-c2',action:{...action,rule:'area-observation'}});
 assert.equal(rolled.stated.rule,'area-observation');
 const before=(await client.table('status',{projection:'receipts'})).receipts;
 const refused=await client.call('table.resolve',{campaign:CAMPAIGN,call_id:'t1-c3',action:{...action,rule:'other-room-observation'}});
 assert.equal(refused.ok,false);assert.equal(refused.error.code,'not_here');assert.equal(refused.error.details.reason,'rule_not_here');
 assert.deepEqual((await client.table('status',{projection:'receipts'})).receipts,before);
});
