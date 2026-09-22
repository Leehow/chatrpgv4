import assert from 'node:assert/strict';
import {test} from 'node:test';
import {keeperSupportView,validateKeeperSupport,supportRequest,validateSupportRequest} from '../../runtime/jev/keeper-support-contract.ts';

const material=(alias,kind,content)=>({alias,kind,label:alias,authority:'module_source',content,coverage:{status:'partial'}});
test('fixed support slots point to exact materials without inventing missing values',()=>{
    const packet=validateKeeperSupport(keeperSupportView({turn:2,request:'Inspect the room.',materials:[
        material('room','graph_entity',JSON.stringify({entity:{kind:'scene',name:'Office'}})),
        material('person','npc',{name:'Alice'}),material('rule','rule_clause','Exact rule.'),material('past','memory','Attributed report.')]}));
    assert.deepEqual(packet.parameters,{scene:['room'],people:['person'],objects:[],rules:['rule'],history:['past'],source:[]});
    assert.equal(packet.check.disposition,'unknown');assert.equal(packet.check.action,undefined);
    assert.deepEqual(packet.assessment,{coverage:'uncertain',consistency:'uncertain'});
    assert.equal(packet.retrieval,null);assert.equal(packet.complete,false);
});
test('invalid slot references, host metadata and unbound check actions fail the support contract',()=>{
    const packet=keeperSupportView({turn:1,request:'Read.',materials:[material('source','source','Exact text.')]});
    assert.throws(()=>validateKeeperSupport({...packet,parameters:{...packet.parameters,source:['invented']}}),/invalid_support_parameters/);
    assert.throws(()=>validateKeeperSupport({...packet,task_id:'private-id'}),/invalid_keeper_support/);
    assert.throws(()=>validateKeeperSupport({...packet,check:{...packet.check,disposition:'ordinary'}}),/invalid_check_advice/);
    assert.throws(()=>validateKeeperSupport({...packet,check:{...packet.check,settled:true}}),/invalid_keeper_support/);
});
test('semantic request schema is fixed and returns a private copy',()=>{
    const request=supportRequest('Find the evidence.');const copy=validateSupportRequest(request);request.query='Changed';
    assert.equal(copy.query,'Find the evidence.');assert.equal(copy.purpose,'preload');
    assert.throws(()=>supportRequest(' '),/invalid_support_request/);
    assert.throws(()=>validateSupportRequest({schema_version:1,purpose:'settle',query:'Roll now.'}),/invalid_support_request/);
    assert.throws(()=>validateSupportRequest({...copy,campaign:'model-invented'}),/invalid_support_request/);
});
