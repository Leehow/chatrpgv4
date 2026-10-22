import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NpcReferences} from '../../runtime/npc-references.ts';
import {turnPacket} from '../../runtime/turn-packet-prototype.ts';

test('only supplied references bind, and a new input retires the preceding bindings',()=>{
 const refs=new NpcReferences();
 refs.observe('campaign:1',{present:[{ref:'npc_17',display_name:'The clerk',name_known:false},{kind:'creature',ref:'npc_18'}]});
 assert.doesNotThrow(()=>refs.require('campaign:1',['npc_17']));
 for(const actor of ['The clerk','npc_18','npc_19','npc_0','npc_017'])assert.throws(()=>refs.require('campaign:1',[actor]),/unissued/);
 refs.observe('campaign:1',{ref:'npc_19',display_name:'The porter',name_known:false});
 assert.doesNotThrow(()=>refs.require('campaign:1',['npc_17','npc_19']));
 refs.observe('campaign:2',{present:[{ref:'npc_19'}]});
 assert.throws(()=>refs.require('campaign:2',['npc_17']),/unissued/);
 assert.throws(()=>refs.require('campaign:1',['npc_19']),/unissued/);
 refs.observe('campaign:2',{npc_references:{people:[{ref:'npc_17',display_name:'The clerk',name_known:false}]}});
 assert.doesNotThrow(()=>refs.require('campaign:2',['npc_17']),'known off-stage people bind from supplied material without inventing presence');
});
test('the native wire binds both speech and presence by reference rather than a free name',()=>{
 const packet=actor=>JSON.stringify({version:4,commands:[{kind:'npc',actor,to:'Library',reason:'selected escort'}],interactions:[{actor,to:['investigator_1'],act:'answer',content:[{fact_ref:'fact_1'}]}]});
 assert.equal(turnPacket(packet('npc_17')).interactions[0].actor,'npc_17');
 for(const actor of ['The clerk','npc_0','npc_017'])assert.throws(()=>turnPacket(packet(actor)));
});

test('a claim about a present person named by public appellation binds to that person (live el-v2-20261021a T19)',()=>{
 const refs=new NpcReferences();const scope='c:8';
 refs.observe(scope,{present:[{ref:'npc_13',display_name:'看房的中间人',name_known:false}]});
 const claim={predicate:'whereabouts',actor:'看房的中间人',to:'corbitt-house-ground',when:'now'};
 const original={version:4,commands:[],interactions:[{actor:'npc_13',to:['investigator_1'],act:'ask',content:[{new:claim}]}]};
 const bound=refs.bindActors(scope,original);
 assert.equal(bound.repairs,1);assert.deepEqual(bound.args.interactions[0].content[0].new,{...claim,actor:'npc_13'});
 assert.equal(original.interactions[0].content[0].new.actor,'看房的中间人','the submitted packet is not mutated');
 assert.equal(bound.args.interactions[0].content[0].new.to,'corbitt-house-ground','a place field is not a person field');
 refs.observe(scope,{ref:'npc_14',display_name:'看房的中间人',name_known:false});
 assert.equal(refs.bindActors(scope,original).repairs,0,'two same-name identities remain ambiguous');
});

test('only one exact issued public appellation normalizes to its original actor reference',()=>{
 const refs=new NpcReferences();const scope='c:8';
 refs.observe(scope,{present:[{ref:'npc_1',display_name:'The clerk',name:'Hidden name',name_known:false}]});
 const original={version:4,commands:[],interactions:[{actor:' the CLERK ',to:['investigator_1'],act:'answer',content:[{fact_ref:'fact_1'}]}]};
 const bound=refs.bindActors(scope,original);
 assert.equal(bound.repairs,1);assert.equal(turnPacket(JSON.stringify(bound.args)).interactions[0].actor,'npc_1');
 assert.equal(original.interactions[0].actor,' the CLERK ');
 for(const actor of ['Hidden name','clerk','npc_01'])assert.equal(refs.bindActors(scope,{...original,interactions:[{actor,act:'silent'}]}).repairs,0);
 refs.observe(scope,{ref:'npc_2',display_name:'The clerk',name_known:false});
 assert.equal(refs.bindActors(scope,original).repairs,0,'two same-name identities remain ambiguous');
 refs.observe('c:9',{present:[]});assert.equal(refs.bindActors(scope,original).repairs,0);
});

test('an issued reference names its person by their one public appellation, and a shared one names nobody (live el-v2-20261021c T14)',()=>{
 const refs=new NpcReferences();const scope='c:8';
 refs.observe(scope,{present:[{ref:'npc_2',display_name:'Arty Wilmot',name_known:true}]});
 assert.equal(refs.publicName(scope,'npc_2'),'Arty Wilmot');
 assert.equal(refs.publicName(scope,'npc_9'),undefined,'an unissued reference names nobody');
 assert.equal(refs.publicName('c:9','npc_2'),undefined,'another input scope names nobody');
 refs.observe(scope,{ref:'npc_3',display_name:'arty wilmot',name_known:true});
 assert.equal(refs.publicName(scope,'npc_2'),undefined,'two people sharing the appellation stay ambiguous');
});
