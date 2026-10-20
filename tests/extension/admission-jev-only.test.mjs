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

test('local movement can resolve a spatial reference from delivered description without turning it into consent',async()=>{
 const selected=options(),decide=selected.value.decision.decide;let batch;
 selected.value.decision={decide:(value,lease)=>{batch=value;return decide(value,lease);}};
 const description='Two tables stand under the street windows. The customer occupies one; the other is empty.';
 const proposal=admission.admissionRequest('apply',{effects:[{kind:'place',action:'move',to:'Lunchroom',at:'Window tables',relation:'seated at the empty table'}]},
  {party:['Thomas Hayes'],consentOnly:true,destinations:[{requested:'Lunchroom',handle:'Lunchroom',label:'Lunchroom',summary:'A small lunchroom.'}]});
 const result=await admission.reviewAdmissionJevOnly({...selected.value,proposal,context:{...context,playerText:'I sit at that empty window table.',
  delivered:[{turn:0,player:'I look around.',keeper:description}],landed:['apply landed: cash:t1-c1; canonical outcomes: [{"kind":"cash","status":"changed","settlement":"living_standard","purchase_amount":0.25}]']}});
 assert(JSON.stringify(batch.state.previous_public).includes(description),'actual delivered spatial description is needed to resolve that table');
 assert.equal(batch.questions.length,2,'reference context adds no vote or authority');
 assert.equal(result.verdict.verdict,'authorized');
});

test('enhanced location admission names its entry and Keeper-creation semantics without granting uncertain consent',async()=>{
    const selected=options('authorized',.42),decide=selected.value.decision.decide;let batch;
    selected.value.decision={decide:(value,lease)=>{batch=value;return decide(value,lease);}};
    const effect={kind:'place',action:'move',to:'Ordinary Inn',at:'counter',additions:[{name:'Ordinary Inn',description:'A public lobby.'}]};
    const proposal=admission.admissionRequest('apply',{effects:[effect]},{party:['Thomas Hayes'],consentOnly:true});
    const result=await admission.reviewAdmissionJevOnly({...selected.value,proposal});
    assert.equal(batch.familyVersion,'12');assert.equal(batch.state.proposal.lines[0].to,effect.to);
    assert.match(batch.state.proposal.lines[0].arrival_scope.additions,/Keeper-authored/);
    assert.match(batch.questions[1].instructions,/entry or boundary crossing/);
    assert.equal(result.verdict.verdict,'uncertain');
});

test('admission uses the Noul probability without a multiclass confidence',async()=>{
    const result=await admission.reviewAdmissionJevOnly(options('authorized',.86).value);
    assert.equal(result.ok,true);assert.equal(result.verdict.verdict,'authorized');
    assert.deepEqual(result.meta.line_admit_probabilities,[.86]);
    assert.equal(result.meta.jev_confidence,undefined);
});

test('observation consent reads ordered waits without treating them as already settled or bypassing restrictions',async()=>{
    const wait={kind:'time',minutes:5,why:'The selected rest.'};
    const observe={kind:'place',action:'observe',to:'Street',sense:'sight',access:'clear',scope:'The opposite pavement',facts:['The seller reaches the next shop.']};
    const scope={party:['Thomas Hayes'],consentOnly:true};
    const proposal=admission.admissionRequest('apply',{effects:[wait,observe]},scope);
    const reversed=admission.admissionRequest('apply',{effects:[observe,wait]},scope);
    assert.notEqual(proposal.key,reversed.key,'observing before waiting is a different transaction');
    const own=admission.lineProposal(proposal,1),earlier=admission.lineProposal(reversed,0);
    assert.deepEqual(own.operations,[observe],'a split line contains only its own operation');
    assert.deepEqual(own.preceding.operations,[wait]);
    assert.deepEqual(earlier.preceding.operations,[],'a later wait cannot supply an earlier prerequisite');
    const alone=admission.admissionRequest('apply',{effects:[observe]},scope);
    const joined=admission.besideBatch(alone,own.beside,own.preceding);
    const first=admission.besideBatch(alone,earlier.beside,earlier.preceding);
    assert.notEqual(joined.key,first.key,'identical siblings in a different order must be reviewed again');
    const selected=options(),decide=selected.value.decision.decide;let batch;
    selected.value.decision={decide:async(value,lease)=>{batch=value;const answer=await decide(value,lease);
        answer.answers.restriction_0.noul=.99;return answer;}};
    const result=await admission.reviewAdmissionJevOnly({...selected.value,proposal:joined});
    assert.equal(batch.familyVersion,'12');
    assert.deepEqual(batch.state.proposal.execution.preceding,[wait]);
    assert.match(batch.state.proposal.execution.authority,/not settled facts/);
    assert.equal(batch.state.proposal.lines.length,1);
    assert.equal(batch.questions.length,2,'the same selection and restriction questions remain');
    assert.match(batch.questions[1].instructions,/independent approval and validation/);
    assert.equal(result.verdict.verdict,'not_authorized','the ordered prefix cannot override a current restriction');
});

test('ordinary service consent retains the time prefix without requiring an observation',async()=>{
 const wait={kind:'time',minutes:14,why:'Wait until service opens.'};
 const meal={kind:'time',band:'brief_activity',why:'Eat the selected meal.'};
 const scope={party:['Thomas Hayes'],consentOnly:true};
 const proposal=admission.admissionRequest('apply',{effects:[wait,meal]},scope);
 const reversed=admission.admissionRequest('apply',{effects:[meal,wait]},scope);
 assert.notEqual(proposal.key,reversed.key,'a later wait cannot authorize an earlier meal');
 const own=admission.lineProposal(proposal,1);
 assert.deepEqual(own.preceding?.operations,[wait]);
 const selected=options(),decide=selected.value.decision.decide;let batch;
 selected.value.decision={decide:async(value,lease)=>{batch=value;const answer=await decide(value,lease);answer.answers.restriction_0.noul=.99;return answer;}};
 const result=await admission.reviewAdmissionJevOnly({...selected.value,proposal:own,
  context:{...context,playerText:'I wait until five, then eat the soup, bread and coffee; pay no more than one dollar.',currentClock:{minutes:406,at:'1920-10-12T16:46',day_part:'afternoon'}}});
 assert.deepEqual(batch.state.proposal.execution.preceding,[wait]);
 assert.equal(batch.state.current_clock.at,'1920-10-12T16:46');
 assert.equal(batch.familyVersion,'13');
 assert.equal(batch.questions.length,2);
 assert.equal(result.verdict.verdict,'not_authorized','the prefix never waives independent restrictions');
});

test('physical delivery precedes consumption even when the batch has no clock or observation',()=>{
 const gain={kind:'item',name:'Soup',from:'Server',to:'Thomas Hayes',quantity:1};
 const consume={kind:'item',name:'Soup',to:'Thomas Hayes',quantity:-1};
 const scope={party:['Thomas Hayes'],consentOnly:true};
 const proposed=admission.admissionRequest('apply',{effects:[gain,consume]},scope);
 const reversed=admission.admissionRequest('apply',{effects:[consume,gain]},scope);
 assert.notEqual(proposed.key,reversed.key,'kernel execution order also matters for physical services');
 assert.deepEqual(admission.lineProposal(proposed,1).preceding?.operations,[gain]);
 assert.deepEqual(admission.lineProposal(reversed,0).preceding?.operations,[]);
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
    assert.equal(mixed.lines.length,1);assert.deepEqual(mixed.kinds,['move']);
    assert.match(mixed.lines[0],/Central Library/);assert.equal(mixed.atomicEvent,undefined);
    assert.equal(admission.admissionRequest('apply',payload,{party:['Thomas Hayes']}).atomicEvent,true);
});

test('the existing time effect kind reaches the typed permission reader without adding an NPC review',async()=>{
    const payload={effects:[{kind:'time',minutes:5,why:'The requested assistant fetches the records.'},
        {kind:'npc',name:'Clerk',mood:'working'},{kind:'flag',name:'cabinet-open',value:true}],event:{name:'records-ready',summary:'The clerk opens the cabinet.'}};
    const projected=admission.admissionRequest('apply',payload,{party:['Thomas Hayes'],consentOnly:true});
    const selected=options(),decide=selected.value.decision.decide;let batch;
    selected.value.decision={decide:(value,lease)=>{batch=value;return decide(value,lease);}};
    const result=await admission.reviewAdmissionJevOnly({...selected.value,proposal:projected,
        context:{...context,playerText:'Please fetch the records. I stay at the desk and watch.'}});
    assert.equal(result.ok,true);assert.deepEqual(batch.state.proposal.kinds,['time']);
    assert.equal(batch.questions.length,2);assert.equal(selected.calls(),1);
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

test('registered journey consent retains committed public history only as bounded reference evidence',async()=>{
 const chosen=options(),run=chosen.value.decision.decide;let seen;
 const proposed=admission.admissionRequest('apply',{effects:[{kind:'move',to:'Central Library',via:'public street'}]},
   {party:['Thomas Hayes'],consentOnly:true,destinations:[{requested:'Central Library',handle:'central-library',label:'Central Library'}]});
 const result=await admission.reviewAdmissionJevOnly({...chosen.value,proposal:proposed,
   context:{...context,delivered:[{turn:0,player:'I came from the Central Library.',keeper:'UNRELATED_AUTHOR_RULE: payments first.'}]},
   decision:{decide:async(batch,lease)=>{seen=batch;return run(batch,lease);}}});
 assert.equal(result.verdict.verdict,'authorized');
 assert.deepEqual(seen.state.previous_public,[{turn:0,player:'I came from the Central Library.',keeper:'UNRELATED_AUTHOR_RULE: payments first.'}]);
 assert.equal(seen.state.proposal.lines[0].registered_destination.label,'Central Library');
 assert.equal(seen.questions.length,2);assert.equal(chosen.calls(),1);
});

test('ordinary object consent sees prior public speech and player references without authored physical replay',async()=>{
 const selected=options();let seen;
 const payload={effects:[{kind:'object',name:'Photographed roll',from:'Thomas Hayes',to:'Clerk',handover:'given'}]};
 const proposed=admission.admissionRequest('apply',payload,{party:['Thomas Hayes'],consentOnly:true});
 await admission.reviewAdmissionJevOnly({...selected.value,proposal:proposed,context:{...context,playerText:'I give the photographed roll to the clerk.',
  delivered:[{turn:0,player:'I ask about processing.',keeper:'OLD_AUTHOR_ACTION: puts the returned roll back in the pan.',speech:[{speaker:'Clerk',text:'The original payment covers processing.'}]}]},
  decision:{decide:async(batch,lease)=>{seen=batch;return selected.value.decision.decide(batch,lease);}}});
 assert.deepEqual(seen.state.previous_public,[{turn:0,player:'I ask about processing.',speech:[{speaker:'Clerk',text:'The original payment covers processing.'}]}]);
 assert.ok(!JSON.stringify(seen.state).includes('OLD_AUTHOR_ACTION'));
 assert.equal(seen.questions.length,2);assert.equal(selected.calls(),1);
});

test('a spatial prerequisite reads the current position without relaxing consent',async()=>{
 const selected=options(),decide=selected.value.decision.decide;let batch;selected.value.decision={decide:async(value,lease)=>{batch=value;const answer=await decide(value,lease);answer.answers.restriction_0.noul=.99;return answer;}};
 const proposal=admission.admissionRequest('apply',{effects:[{kind:'time',until:{time:'18:00'},why:'Wait at the counter.'}]},{party:['Thomas Hayes'],consentOnly:true});
 const result=await admission.reviewAdmissionJevOnly({...selected.value,proposal,context:{...context,playerText:'I go to the counter, wait until six, then return to the window.',currentClock:{minutes:465,at:'1920-10-12T17:45'},currentPosition:{place:'Dining room',at:'window',relation:'beside'}}});
 assert.equal(batch.state.current_position.at,'window');assert.equal(batch.familyVersion,'15');assert.equal(batch.questions.length,2);assert.match(batch.questions.find(q=>q.key==='restriction_0').instructions,/intermediate visit/);assert.equal(result.verdict.verdict,'not_authorized');
});

test('a selected movement establishes the position prerequisite rather than requiring arrival first',async()=>{
 const selected=options(),decide=selected.value.decision.decide;let batch;selected.value.decision={decide:async(value,lease)=>{batch=value;return decide(value,lease);}};
 const proposal=admission.admissionRequest('apply',{effects:[{kind:'place',action:'move',to:'Dining room',at:'counter',relation:'beside'}]},{party:['Thomas Hayes'],consentOnly:true});
 await admission.reviewAdmissionJevOnly({...selected.value,proposal,context:{...context,playerText:'I go to the counter, wait until six, then return to the window.',currentPosition:{place:'Dining room',at:'window',relation:'beside'}}});
 const instruction=batch.questions.find(q=>q.key==='restriction_0').instructions;assert.match(instruction,/move itself establishes arrival/);assert(!instruction.includes('before this time proposal'));assert.equal(batch.state.current_position.at,'window');assert.equal(batch.questions.length,2);
});
