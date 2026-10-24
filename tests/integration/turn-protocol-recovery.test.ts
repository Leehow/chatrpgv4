/** Reproduced recovery seams; these are native component tests, not gameplay. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importSource,kernel,openTurn,campaignDir,readJson,prepared} from './support.ts';
import {join} from 'node:path';

const {ModJobs}=await importSource('kernel-ts/mods/jobs.ts');
const {stageHandout}=await importSource('kernel-ts/apply/entities.ts');
const handout={node_id:'commission',kind:'handout',name:'Commission',visibility:'revealable'};
function sourceJob(){
    const job=Object.create(ModJobs.prototype);
    job.knownHandouts=async()=>[];
    return job;
}
const graph={find:(name:string)=>['commission','Commission'].includes(name)?handout:null,
    survivorOf:(node:unknown)=>node,handle:()=> 'commission',displayName:()=> 'Commission'};

test('a revealed missing handout projects document readiness on its actual receipt',async()=>{
    const world={handouts_shown:[]};
    const staged=await stageHandout({graph,world,callId:'t1-c1',turn:{turn:1},campaign:{directory:'/unused'},
        kernel:{stateRoot:'/unused',snapshots:{isFile:async()=>false}}},{kind:'handout',name:'Commission'},async()=>null);
    assert.equal(staged.receipt.attachment.available,false);
    assert.deepEqual(staged.receipt.attachment.document_source,{revealed:true,copyable_text:false,copyable_image:false,
        available:false,reason:'document_source_unavailable',
        note:'Revelation records disclosure; copying needs actual source text or an available player-safe image. A summary is not document text.'});
    assert.deepEqual(world.handouts_shown,['commission']);
});

test('a revealed handout without source bytes is unavailable, not hidden',async()=>{
    await assert.rejects(sourceJob().documentSeed(graph,{handouts_shown:['commission']},
        {handout:'Commission',presentation:'paper'},{id:'c1',directory:'/unused'}),error=>{
        assert.equal(error.code,'needs');
        assert.equal(error.details.reason,'document_source_unavailable');
        assert.equal(error.details.revealed,true);
        assert.equal(error.details.presentation,'paper');
        assert.match(error.fix,/lookup/);
        assert.doesNotMatch(error.fix,/reveal it first/);
        return true;
    });
});

test('an unrevealed handout retains the disclosure boundary',async()=>{
    await assert.rejects(sourceJob().documentSeed(graph,{handouts_shown:[]},
        {handout:'Commission',presentation:'paper'},{id:'c1',directory:'/unused'}),error=>{
        assert.equal(error.code,'invalid_params');
        assert.equal(error.details.reason,'document_source_not_revealed');
        return true;
    });
});

test('an event inside effects explains the top-level contract and commits nothing',async t=>{
    const k=await kernel(t);await openTurn(k);
    const before=readJson(join(campaignDir(k.workspace),'world.json'));
    const error=await k.err('table.apply',{campaign:'c1',call_id:'t1-c1',effects:[
        {kind:'flag',key:'protocol-probe',value:true},{kind:'event',summary:'A conversation'}]});
    assert.equal(error.code,'invalid_params');
    assert.equal(error.details.reason,'event_is_not_effect');
    assert.match(error.fix,/apply\.event/);
    assert.deepEqual(readJson(join(campaignDir(k.workspace),'world.json')),before);
});

test('first document acquisition explains the missing accepted definition',async t=>{
    const k=await kernel(t);await openTurn(k);
    const error=await k.err('table.apply',{campaign:'c1',call_id:'t1-c1',effects:[
        {kind:'object',name:'Commission copy',to:'Thomas Hayes',document:{text:'Player-selected notes.',presentation:'paper'}}]});
    assert.equal(error.code,'invalid_params');
    assert.equal(error.details.reason,'object_definition_required');
    assert.match(error.fix,/define/);
    assert.match(error.fix,/same.*batch/);
});

test('§264.10 a first placement handed over by someone nobody registered keeps the giver as a label',async t=>{
    const k=await kernel(t);await openTurn(k,'I buy the morning paper from the corner stand.');
    const draft={name:'Morning paper',category:'item',description:"Today's edition, folded twice.",
        basis:'Fixture text, not an authored scenario claim.',parameters:{charges:null,effects:[]},player_view:{description:'A newspaper.',fields:[]}};
    const result=await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),
        {kind:'object',name:'Morning paper',definition:'Morning paper',to:'Thomas Hayes',from:'the newsstand vendor',handover:'given'}]});
    const placed=result.outcomes.find((row:any)=>row.name==='Morning paper');
    assert.equal(placed.status,'changed');assert.equal(placed.from,null);
    assert.deepEqual(placed.adjusted,['from: unregistered_giver','handover: no_second_person'],'the giver rides on the receipt as a label');
    const unknown=await k.err('table.apply',{campaign:'c1',call_id:'t1-c2',effects:[
        {kind:'object',name:'Morning paper',to:'Thomas Hayes',from:'somebody unknown',handover:'given'}]});
    assert.equal(unknown.code,'unknown_entity','an existing instance still needs its actual owner');
});
