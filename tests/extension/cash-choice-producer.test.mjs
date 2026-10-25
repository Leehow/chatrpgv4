/** Closed cash-confirmation producer/consumer seams. Fixtures are not browser or live-play acceptance. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,readJson,RpcClient} from '../integration/support.ts';
import {PurchaseRecovery} from '../../extensions/kernel/purchase-recovery.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
import {playtestScratch} from './playtest-scratch.mjs';
import {openTable} from './harness.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';

const suite=playtestScratch('cash-choice-producer');
const quote='Copy order',alias='Descriptive bill alias';
const items=[{name:'Copy',quantity:1,unit_price:'1.00'}];
const cash={kind:'cash',mode:'quote',quote,category:'purchase',source:'quote',with:'Steven Knott',items};
const draft={...cash};delete draft.kind;delete draft.mode;

test('recovery keeps the registered quote identity and supplies executable ask parameters',async()=>{
    const home=mkdtempSync(join(suite,'policy-')),directory=join(home,'.coc/campaigns/c1');mkdirSync(directory,{recursive:true});
    writeFileSync(join(directory,'campaign.json'),JSON.stringify({active_worldline:'main'}));
    writeFileSync(join(directory,'world.json'),JSON.stringify({cash_quotes:[{...draft,name:quote,subject:'alice',currency:'USD',settled:null}]}));
    const recovery=new PurchaseRecovery(home,'c1',[{id:'alice',name:'Alice'}]);
    const refused=await recovery.failure({effects:[{kind:'cash',quote,bill:alias,subject:'alice'}]},
        new KernelError({code:'needs',message:'The full debit needs acceptance.',details:{reason:'action_not_authorized',cash_debit:3}}),2);
    assert.deepEqual(refused.details.cash_confirmations,[{kind:'mechanics',binds:quote,options:['accept','flee']}]);
    assert.equal((await recovery.offers([],2))[0].quote,quote);
    assert.equal((await recovery.requests(2))[0].quote,quote);
    for(const changed of [{items:[{name:'Copy',quantity:1,unit_price:'2.00'}]},{with:'Another seller'},{currency:'EUR'}])
        await assert.rejects(recovery.offers([{quote,...changed}],2),error=>error.details.reason==='purchase_terms_changed');
    assert.equal((await recovery.offers([{quote}],2))[0].items[0].unit_price,'1.00','a named partial draft reuses its own retained terms');
    await recovery.settled({effects:[{kind:'cash',quote,subject:'alice'}]},
        {receipts:['cash:t3-c1'],_cash_settlements:[{...draft,subject:'alice',quote,settlement:'cash'}]});
    assert.deepEqual(await recovery.requests(3),[]);
    assert.deepEqual(await recovery.offers([],3),[]);
});

async function quoted(t){
    const client=await kernel(t);await openTurn(client,'I choose the one-dollar copy order.');
    await client.table('apply',{call_id:'t1-c0',effects:[{kind:'cash',delta:1,source:'found'},{kind:'cash',delta:-1,source:'found'}]});
    const path=join(campaignDir(client.workspace),'party/thomas-hayes.json'),card=readJson(path);
    card.finance.cash.amount=20;card.finance.spending_level.amount=2;card.finance.daily_spending={day:0,total:2,debited:0};
    writeFileSync(path,JSON.stringify(card));
    await client.table('apply',{call_id:'t1-c1',effects:[cash]});
    const params={kind:'mechanics',options:['accept','flee'],quotes:[draft],_cash_requests:[{quote,subject:'thomas-hayes'}]};
    return {client,params,path};
}

test('a held cash confirmation refuses missing and unrelated binds before producing a pending choice',async t=>{
    const {client,params,path}=await quoted(t);
    let ordinal=2;
    for(const binds of [undefined,'ask-mechanics-t0','Unknown quote']){
        const error=await client.tableErr('ask',{...params,call_id:'t1-c'+ordinal++,...(binds?{binds}:{})});
        assert.equal(error.code,'needs');assert.equal(error.details.reason,'cash_confirmation_binding_required');
        assert.equal(error.details.cash_confirmations[0].binds,quote);
        assert.equal(readJson(join(campaignDir(client.workspace),'turn.json')).pending_choice,null);
        assert.equal(readJson(path).finance.cash.amount,20);
    }
    const result=await client.table('ask',{...params,call_id:'t1-c'+ordinal,binds:quote});
    assert.equal(result.pending_choice.binds,quote);
    const card=result.mechanics.find(row=>row.quote===quote&&row.cash_debit!==undefined);
    assert.equal(card.purchase_amount,1);assert.equal(card.cash_debit,3);
    assert.equal(readJson(path).finance.cash.amount,20,'creating a confirmation never pays');
});

test('unrelated mechanical options remain available beside an unpaid cash requirement',async t=>{
    const {client,params,path}=await quoted(t);
    const result=await client.table('ask',{...params,call_id:'t1-c2',options:['flee','none'],binds:'An independent roll'});
    assert.equal(result.pending_choice.binds,'An independent roll');assert.equal(readJson(path).finance.cash.amount,20);
});

test('ambiguous or financially unavailable quote drafts cannot produce a cash choice',async t=>{
    const {client,params,path}=await quoted(t);
    for(const [index,quotes,reason] of [[2,[draft,draft],'cash_confirmation_binding_required'],
        [3,[{...draft,currency:'EUR'}],'cash_confirmation_unavailable']]){
        const error=await client.tableErr('ask',{...params,call_id:'t1-c'+index,quotes,binds:quote});
        assert.equal(error.details.reason,reason);
        assert.equal(readJson(join(campaignDir(client.workspace),'turn.json')).pending_choice,null);
        assert.equal(readJson(path).finance.cash.amount,20);
    }
});

test('a cancelled quotation cannot be recreated as a held cash confirmation',async t=>{
    const {client,params}=await quoted(t);
    await client.table('apply',{call_id:'t1-c2',effects:[{kind:'cash',mode:'cancel',quote}]});
    const error=await client.tableErr('ask',{...params,call_id:'t1-c3',binds:quote});
    assert.equal(error.details.reason,'cash_confirmation_unavailable');
});

// §249: in the single Keeper the settlement of a registered quotation is the Keeper's own judgment of the player's order. The
// consent refusal that produced a held cash confirmation no longer runs there (the producer itself is covered above); the
// kernel still prices the full debit, daily spending included, and settles it once.
test('a Keeper-judged settlement of a registered quotation pays the full debit once without a consent refusal or held choice',async t=>{
    let reviews=0;
    const engine=createHybridEngine({env:{},decision:{decide:async batch=>{
        if(batch.family==='continuous-action-admission')reviews++;
        const answers=Object.fromEntries(batch.questions.map(question=>{
            if(question.type==='noul')return [question.key,{type:'noul',status:'answered',noul:question.key.startsWith('restriction_')?.01:question.key.startsWith('cash_input_')?.01:question.key.startsWith('cash_offer_')?.01:.99}];
            const values=Object.keys(question.criteria),choice=values.includes('later')?'later':values.includes('unknown')?'unknown':values[0];
            return [question.key,{type:'choice',status:'answered',choice,confidence:.99,
                probabilities:Object.fromEntries(values.map(value=>[value,value===choice?.99:.01/(values.length-1)]))}];
        }));
        return {batchId:batch.id,status:'complete',answers,coverage:{required:Object.keys(answers),answered:Object.keys(answers),unknown:[]},issues:[],usage:{inputTokens:100,outputTokens:0}};
    }}});
    const env={PI_COC_ISOLATED_OUTPUT:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined};
    const errors=[];
    const table=await openTable({realKernel:true,legacyDeliveryFixtures:false,env,runDriver:engine.runDriver,
        prepareWorkspace:async workspace=>{
            const client=new RpcClient(workspace);
            try{
                await client.ok('table.open',{campaign:'test-camp'});
                await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits beside his desk.'});
                await client.ok('table.player_input',{campaign:'test-camp',text:'Please quote the copy order.'});
                await client.ok('table.apply',{campaign:'test-camp',call_id:'t1-c0',effects:[{kind:'cash',delta:1,source:'found'},{kind:'cash',delta:-1,source:'found'}]});
                const path=join(workspace,'.coc/campaigns/test-camp/party/thomas-hayes.json'),card=readJson(path);
                card.finance.cash.amount=20;card.finance.spending_level.amount=2;card.finance.daily_spending={day:0,total:2,debited:0};writeFileSync(path,JSON.stringify(card));
                await client.ok('table.apply',{campaign:'test-camp',call_id:'t1-c1',effects:[cash]});
                await client.ok('table.narrate',{campaign:'test-camp',call_id:'t1-c2',text:'The copy order costs one dollar.'});
                return await client.ok('table.capsule',{campaign:'test-camp',_context_read:true});
            }finally{await client.close();}
        },extraExtensions:[{name:'continuous',factory:engine.extension},{name:'cash-refusal-observer',factory(pi){
            pi.on('tool_result',event=>{if(event.toolName==='apply'&&event.isError)errors.push(event.details?.coc_error);});
        }}],responses:[
            fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'cash',mode:'settle',quote,bill:alias}]})],{stopReason:'toolUse'}),
            fauxAssistantMessage('{{public}}The copy order is settled once.')
        ]});
    t.after(()=>table.dispose());
    await table.session.prompt('I choose the one-dollar copy order.');
    const directory=join(table.workspace,'.coc/campaigns/test-camp');
    const turn=readJson(join(directory,'turns/0002.json'));
    assert.deepEqual(errors,[]);assert.equal(turn.pending_choice,null);
    assert.equal(turn.receipts.filter(row=>row.kind==='cash').length,1);
    assert.equal(turn.receipts.find(row=>row.kind==='cash').delta,-3);
    assert.equal(readJson(join(directory,'party/thomas-hayes.json')).finance.cash.amount,17);
    assert.equal(reviews,0);assert.deepEqual(table.extensionErrors,[]);
    assert.deepEqual(table.telemetry().filter(row=>row.lane==='admission'&&row.path==='keeper_judged').map(row=>({kinds:row.kinds,jev_calls:row.jev_calls})),
        [{kinds:['cash'],jev_calls:0}]);
    assert.equal(existsSync(join(directory,'purchase-recovery.json')),false,'no refused purchase line was retained for recovery');
});
