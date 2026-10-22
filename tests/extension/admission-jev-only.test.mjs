import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as admission from '../../extensions/kernel/admission.ts';

const context={turn:1,playerText:'I go to the Central Library.',investigators:[{name:'Thomas Hayes'}],
    present:[],delivered:[],landed:[],refused:[],bookText:[{where:'private',text:'SECRET_DOES_NOT_AUTHORIZE'}]};
const proposal={tool:'apply',key:'move',lines:['Move Thomas Hayes to Central Library.'],kinds:['move']};
function options(verdict='authorized',probability=.99){
    let calls=0;
    return {calls:()=>calls,value:{campaign:'c1',context,proposal,record:()=>{},env:{},
        ctx:{get model(){throw Error('A generative reviewer must not start');}},
        decision:{decide:async batch=>{
            calls++;
            assert.equal(batch.family,'continuous-action-admission');
            assert.doesNotMatch(JSON.stringify(batch.state),/SECRET_DOES_NOT_AUTHORIZE/);
            const answers=Object.fromEntries(batch.questions.map(question=>{
                assert.equal(question.type,'noul');
                const selected=verdict==='not_authorized'?1-probability:probability;
                return [question.key,{status:'answered',type:'noul',noul:question.key.startsWith('restriction_')?1-selected:selected}];
            }));
            return {batchId:batch.id,status:'complete',answers,
                coverage:{required:Object.keys(answers),answered:Object.keys(answers),unknown:[]},issues:[],usage:{inputTokens:100,outputTokens:0}};
        }}}};
}

test('typed action admission needs one Jev batch and no generative review',async()=>{
    assert.equal(typeof admission.reviewAdmissionJevOnly,'function');
    const selected=options();
    const result=await admission.reviewAdmissionJevOnly(selected.value);
    assert.equal(result.ok,true);assert.equal(result.verdict.verdict,'authorized');
    assert.equal(result.verdict.reviewer,'jev');assert.equal(selected.calls(),1);
});

test('uncertain typed admission never grants authority',async()=>{
    const rows=[],selected=options('authorized',.5);selected.value.record=row=>rows.push(row);
    const result=await admission.reviewAdmissionJevOnly(selected.value);
    assert.equal(result.ok,true);assert.equal(result.verdict.verdict,'uncertain');
    const basis=rows.find(row=>row.event==='uncertain_basis').basis;assert.equal(basis.request.state.current_player_words,context.playerText);assert.equal(basis.answers.consent_0.noul,.5);assert(!JSON.stringify(basis).includes('SECRET_DOES_NOT_AUTHORIZE'));assert(basis.bytes<=32768);
});

test('admission uses the Noul probability without a multiclass confidence',async()=>{
    const result=await admission.reviewAdmissionJevOnly(options('authorized',.86).value);
    assert.equal(result.ok,true);assert.equal(result.verdict.verdict,'authorized');
    assert.deepEqual(result.meta.line_admit_probabilities,[.86]);
    assert.equal(result.meta.jev_confidence,undefined);
});

test('a confident Jev refusal stands without asking a generative judge',async()=>{
    const selected=options('not_authorized');
    const result=await admission.reviewAdmissionJevOnly(selected.value);
    assert.equal(result.ok,true);assert.equal(result.verdict.verdict,'not_authorized');assert.equal(selected.calls(),1);
});

test('selection cannot override a current restriction, and uncertainty in either axis holds authority',async()=>{
    for(const [selectedProbability,scopeProbability,expected] of [[.99,.01,'not_authorized'],[.99,.5,'uncertain'],[.5,.99,'uncertain'],[.62,.61,'authorized']]){
        const selected=options(),decide=selected.value.decision.decide;
        selected.value.decision={decide:async(batch,lease)=>{const answer=await decide(batch,lease);
            answer.answers.consent_0.noul=selectedProbability;answer.answers.restriction_0.noul=1-scopeProbability;return answer;}};
        const result=await admission.reviewAdmissionJevOnly(selected.value);
        assert.equal(result.ok,true);assert.equal(result.verdict.verdict,expected);assert.equal(selected.calls(),1);
        assert.ok(Math.abs(result.meta.line_scope_probabilities[0]-scopeProbability)<1e-12);
    }
});

test('NPC disclosures and event truth do not masquerade as voluntary player choices',()=>{
    const payload={effects:[{kind:'clue',clue:'a-new-name'},{kind:'handout',name:'a-shown-note'}],
        event:{name:'reply',summary:'Knott gives a new name.'}};
    const scope={party:['Thomas Hayes'],consentOnly:true};
    assert.equal(admission.admissionRequest('apply',payload,scope),null);
    const mixed=admission.admissionRequest('apply',{...payload,effects:[...payload.effects,{kind:'move',to:'Central Library'}]},scope);
    assert.equal(mixed,null,'§249: the single Keeper judges the journey; the batch has no reviewed line');
    assert.equal(admission.admissionRequest('apply',payload,{party:['Thomas Hayes']}).atomicEvent,true);
});

const cashItems=[{name:'Round trip',quantity:1,unit_price:25}];
const cashProposal={tool:'apply',key:'purchase',lines:['Pay the agreed 25 USD round trip; actual purse debit is 47 USD.'],kinds:['cash'],
    cash:{previews:[{index:0,delta:-47,purchase_amount:25,currency:'USD',subject:'thomas',with:'driver',items:cashItems,quote:'Round-trip quotation'}],
        quotes:[{quote:'Round-trip quotation',cash_debit:47,purchase_amount:25,currency:'USD',subject:'thomas',with_id:'driver',items:cashItems,origin_turn:1}]}};
async function cashReview(probabilities,playerText='I accept the actual 47 USD debit once, including the prior daily spending.',change={}){
    const selected=options(),batches=[];
    const decide=selected.value.decision.decide;
    selected.value.decision={decide:async(batch,lease)=>{
        batches.push(batch);
        const answer=await decide(batch,lease);
        for(const [key,p] of Object.entries(probabilities))if(answer.answers[key])answer.answers[key].noul=p;
        return answer;
    }};
    const review=await admission.reviewAdmissionJevOnly({...selected.value,proposal:cashProposal,
        context:{...context,turn:2,playerText},...change});
    return {review,batches,calls:selected.calls(),context:{...context,turn:2,playerText}};
}

test('typed cash approval produces the exact preview limit in the same batch',async()=>{
    const {review,batches,calls,context:actual}=await cashReview({cash_input_0:.99,cash_offer_0_0:.01});
    assert.equal(review.ok,true);assert.equal(calls,1);
    assert.equal(batches[0].familyVersion,'7');
    assert.deepEqual(review.verdict.cash_limits,[{index:0,amount:'47',basis:'input',evidence:actual.playerText}]);
    assert.equal(admission.boundCashAuthority(cashProposal,actual,review.verdict).verdict,'authorized');
});

test('a full earlier quotation can authorize its exact cash requirement',async()=>{
    const input=JSON.stringify({kind:'mechanics_choice',action:'accept',choice:{name:'cash-choice',binds:'Round-trip quotation',options:['accept','flee']}});
    const {review,batches,context:actual}=await cashReview({cash_input_0:.01,cash_offer_0_0:.99},input);
    assert.equal(batches[0].state.current_mechanics_choice.choice.binds,'Round-trip quotation');
    assert.deepEqual(review.verdict.cash_limits,[{index:0,amount:'47',basis:'offer',evidence:'Round-trip quotation'}]);
    assert.equal(admission.boundCashAuthority(cashProposal,actual,review.verdict).verdict,'authorized');
    const changed={...cashProposal,cash:{...cashProposal.cash,quotes:[{...cashProposal.cash.quotes[0],origin_turn:2}]}};
    assert.equal(admission.boundCashAuthority(changed,actual,review.verdict).verdict,'not_authorized','a new undisclosed quote grants no limit');
});

test('nominal purchase approval and uncertain cash acceptance never grant the extra debit',async()=>{
    for(const probability of [.01,.5]){
        const {review,context:actual}=await cashReview({cash_input_0:probability,cash_offer_0_0:probability},'I accept the 25 USD ride price.');
        assert.equal(review.ok,true);assert.equal(review.verdict.cash_limits,undefined);
        assert.equal(admission.boundCashAuthority(cashProposal,actual,review.verdict).verdict,'not_authorized');
    }
});

test('an unbound, differently bound or declined mechanics choice cannot gain cash authority even from a false yes',async()=>{
    for(const input of [
        {kind:'mechanics_choice',action:'accept'},
        {kind:'mechanics_choice',action:'accept',choice:{name:'c',binds:'Previous ask identifier',options:['accept','flee'],prompt:'Actual debit 47 USD'}},
        {kind:'mechanics_choice',action:'flee',choice:{name:'c',binds:'Round-trip quotation',options:['accept','flee']}}
    ]){
        const {review,batches,context:actual}=await cashReview({},JSON.stringify(input));
        assert.equal(batches[0].questions.filter(q=>q.key.startsWith('cash_offer_')).length,0);
        assert.equal(review.verdict.cash_limits,undefined);
        assert.equal(admission.boundCashAuthority(cashProposal,actual,review.verdict).verdict,'not_authorized');
    }
});

test('consent errors retain every blocking line and axis without admitting a subset',async()=>{
 for(const refused of [false,true]){
  const selected=options(),decide=selected.value.decision.decide;
  selected.value.decision={decide:async(batch,lease)=>{const result=await decide(batch,lease);
   result.answers.consent_1.noul=refused?.05:.51;
   result.answers.restriction_2.noul=.43;return result;
  }};
  const proposed={tool:'apply',key:'mixed-hold',lines:['Selected payment.','Receive selected goods.','Selected activity cost.'],kinds:['cash','item','time']};
  const result=await admission.reviewAdmissionJevOnly({...selected.value,proposal:proposed});
  assert.equal(result.ok,true);assert.equal(result.verdict.verdict,refused?'not_authorized':'uncertain');
  assert.match(result.verdict.grounds,/line 2: selection not established/);
  assert.match(result.verdict.grounds,/line 3: restriction clearance not established/);
  assert.doesNotMatch(result.verdict.grounds,/line 1:/);
  const error=admission.admissionRefusal(proposed,result.verdict,false,'same_keeper');
  assert.equal(error.details.grounds,result.verdict.grounds);assert.equal(selected.calls(),1);
  assert.equal(admission.CONTINUOUS_ADMISSION_MIN_PROBABILITY,.6);
 }
});

test('§249: the typed consent review receives no Keeper-judged line, while maps, usages and checks stay reviewed (§249.6: documents are the Keeper\'s)',()=>{
 const scope={party:['Thomas Hayes'],consentOnly:true};
 const judged=[{kind:'move',to:'Central Library'},{kind:'place',action:'move',to:'Inn',at:'counter',relation:'beside'},
  {kind:'place',action:'observe',to:'Street',sense:'sight',access:'clear',scope:'The pavement',facts:['A cart passes.']},
  {kind:'place',action:'feature',to:'Inn',at:'door',state:'open'},{kind:'time',until:{time:'18:00'},why:'Wait.'},{kind:'time',minutes:5,why:'Wait.'},
  {kind:'time',band:'brief_activity',why:'Eat.'},{kind:'item',name:'Soup',from:'Server',to:'Thomas Hayes',quantity:1},{kind:'item',name:'Soup',to:'Thomas Hayes',quantity:-1},
  {kind:'object',name:'Roll',from:'Thomas Hayes',to:'Clerk',handover:'given'},{kind:'cash',mode:'settle',quote:'Supper',subject:'investigator',with:'Server'}];
 for(const effect of judged)assert.equal(admission.admissionRequest('apply',{effects:[effect]},scope),null,JSON.stringify(effect));
 assert.equal(admission.admissionRequest('apply',{effects:judged},scope),null);
 assert.deepEqual(admission.keeperJudgedKinds(judged),['move','place','time','item','object','cash']);
 const write={kind:'object',name:'Notebook',to:'Thomas Hayes',document:{action:'append',text:'1835 entry.'}};
 for(const [effect,kind] of [[{kind:'map',name:'Ground floor'},'map'],[{kind:'usage',name:'Lantern'},'usage']]){
  const proposal=admission.admissionRequest('apply',{effects:[effect]},scope);assert(proposal,kind);assert.deepEqual(proposal.kinds,[kind]);
 }
 assert.equal(admission.admissionRequest('apply',{effects:[write]},scope),null,'a document write is the Keeper\'s own judgment');
 assert.deepEqual(admission.keeperJudgedKinds([write]),['object']);
 assert.deepEqual(admission.admissionRequest('apply',{effects:[write]},{party:['Thomas Hayes']}).kinds,['object'],'outside the single Keeper the write is still reviewed');
 assert(admission.admissionRequest('resolve',{action:{decision:'core-check:spot-hidden',actor:'Thomas Hayes'}},scope));
 const lane=admission.admissionRequest('apply',{effects:[judged[1]]},{party:['Thomas Hayes']});
 assert.deepEqual(lane.kinds,['place'],'the lane reviewer path outside the single Keeper is unchanged');
});
