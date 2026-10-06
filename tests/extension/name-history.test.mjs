/** JEV-OPEN-01: disclosure keeps its two floors while reusing only operation-local inputs. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
const root=resolve(import.meta.dirname,'../..'), scratch=playtestScratch('name-history');
await build({stdin:{contents:`export {prepareNameHistory} from './kernel-ts/journal/name-history.ts';
export {toldTurn} from './kernel-ts/journal/naming.ts';
export {castToldTurn} from './kernel-ts/read/cast.ts';
export {CampaignSnapshot} from './kernel-ts/read/campaign.ts';
export {CampaignWriter} from './kernel-ts/write/store.ts';
export {createKernelContext} from './kernel-ts/context.ts';`,resolveDir:root},outfile:join(scratch,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const api=await import(pathToFileURL(join(scratch,'api.mjs')));
const node={node_id:'npc-ari',name:'Ari Stone'}, graph={handle:()=> 'ari',displayName:n=>n.name};
const person={names:['Ari Stone']};
const committed=(turn,fields={})=>({turn,closed_by:'narrate',commit:'saved',...fields});

test('the graph and unread-cast retain different eligibility, chronological order and upper bounds',()=>{
    const records=[committed(10,{rendered_text:'Ari Stone'}),committed(5,{commit:[],rendered_text:'Ari Stone'}),
        committed(1.5,{rendered_text:'Ari Stone'}),committed(1,{closed_by:'ask',rendered_text:'Ari Stone'}),
        committed(NaN,{rendered_text:'Ari Stone'})];
    const history=api.prepareNameHistory(records);
    assert.equal(api.toldTurn(graph,node,history),1.5);
    assert.equal(api.castToldTurn(person,history),5,'cast keeps JS truth for an empty array; fractional turns do not qualify');
    assert.equal(api.toldTurn(graph,node,history,1),null);
    assert.equal(api.toldTurn(graph,node,history,NaN),null);
    assert.deepEqual(records.map(r=>r.turn),[10,5,1.5,1,NaN],'preparation does not reorder the saved collection');
    assert.equal(api.prepareNameHistory(history),history);
    const big=api.prepareNameHistory([committed(2n,{rendered_text:'Ari Stone'})]);
    assert.equal(api.toldTurn(graph,node,big),2);
    assert.equal(api.castToldTurn(person,big),2);
});

test('cleared told text and shown speaker wording remain authoritative, with exact speaker identity and word boundaries',()=>{
    const lines=shown=>[{who:{npc:'ari',name:'Ari Stone',shown}}];
    const records=[committed(1,{rendered_text:'Ari Stone',told_text:''}),
        committed(2,{speech:lines('')}),committed(3,{speech:lines('the caller')}),
        committed(4,{speech:[{who:{npc:'other',name:'Ari Stone'}}]}),
        committed(5,{rendered_text:'Diary Stonework'}),committed(6,{speech:[{who:{npc:'ari',name:'Ari Stone'}}]})];
    const history=api.prepareNameHistory(records);
    assert.equal(api.toldTurn(graph,node,history,5),null);
    assert.equal(api.toldTurn(graph,node,history),6,'legacy speech without shown reads its recorded name');
    assert.equal(api.castToldTurn(person,history),null,'unread cast still never learns from a speech identity');
    const accent={node_id:'npc-renee',name:'Renee Stone'};
    assert.equal(api.toldTurn(graph,accent,[committed(7,{rendered_text:'Renée_Stone waits.'})]),7);
});

test('many people normalize one saved text only once in a preparation, and a fresh preparation sees changed inputs',()=>{
    let reads=0;
    const record=committed(1);
    Object.defineProperty(record,'rendered_text',{get(){reads++;return 'A name-free delivery.';}});
    reads=0;
    const history=api.prepareNameHistory([record]);
    for(const name of ['Ari Stone','Bea Stone','Cal Stone']){
        assert.equal(api.toldTurn(graph,{...node,name},history),null);
        assert.equal(api.castToldTurn({names:[name]},history),null);
    }
    assert.equal(reads,1);
    assert.equal(api.toldTurn(graph,node,api.prepareNameHistory([committed(2,{rendered_text:'Ari Stone'})])),2);
});

test('name preload reads its consumers, tolerates the same optional journal failure, and remembers empty history per snapshot',async()=>{
    const workspace=join(scratch,'snapshot'), dir=join(workspace,'.coc','campaigns','c1');
    await mkdir(join(dir,'party'),{recursive:true});
    await writeFile(join(dir,'party','pc.json'),JSON.stringify({id:'pc',name:'Investigator'}));
    await writeFile(join(dir,'npc-journal.json'),'{bad journal');
    const context=await api.createKernelContext({workspace,content:join(root,'content')});
    const paths=[],snapshots={...context.snapshots};
    for(const key of ['readJson','readJsonl','sortedChildNames'])snapshots[key]=async(...args)=>{paths.push([key,args[0]]);return context.snapshots[key](...args);};
    const measured={...context,snapshots}, snap=new api.CampaignSnapshot(measured,'c1');
    await snap.preload('names');
    assert.equal(snap.party.length,1);
    assert.equal(await snap.optional('npc-journal.json'),null);
    assert.deepEqual(await snap.turnRecords(),[]);
    assert.deepEqual(await snap.turnRecords(),[]);
    assert.equal(paths.filter(([key,path])=>key==='sortedChildNames'&&path===join(dir,'turns')).length,1);
    assert.ok(paths.every(([,path])=>!path.includes('/save/')&&!path.includes('/memory/')&&!path.endsWith('npc-ledger.json')));
    await mkdir(join(dir,'turns'));
    await writeFile(join(dir,'turns','000002.json'),JSON.stringify(committed(2,{rendered_text:'Ari Stone'})));
    const fresh=new api.CampaignSnapshot(measured,'c1');
    assert.equal(api.toldTurn(graph,node,await fresh.turnRecords()),2,'a later snapshot rereads the full history');
    const writer=new api.CampaignWriter(measured,'c1'), inputs=await writer.recordInputs();
    assert.ok(Object.isFrozen(inputs[0]),'quotation readers receive frozen saved inputs');
    const mutable=await writer.records();
    mutable[0].rendered_text='A mutable consumer changes only its copy.';
    assert.equal((await writer.recordInputs())[0].rendered_text,'Ari Stone');
    await writeFile(join(dir,'turns','000002.json'),JSON.stringify(committed(2,{rendered_text:'Bea Stone'})));
    assert.equal((await writer.recordInputs())[0].rendered_text,'Bea Stone','quotation readers reread current saved inputs on every call');
    await writeFile(join(dir,'turns','000003.json'),'{bad mandatory record');
    await assert.rejects(new api.CampaignSnapshot(measured,'c1').preload('names'));
    await assert.rejects(writer.recordInputs(),'quotation mandatory-file failures still propagate');
    await context.git.close();
});
