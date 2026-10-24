/**
 * Contract §263: pointer reading. Refs slice the host's own block text; the pointer index keeps only its section's blocks;
 * the release check certifies candidates against protected facts; only approved, in-scope words reach the catalog; the
 * author never receives a testimony's stance.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join,resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
const temp=playtestScratch('pointer-reading','suite-');
await build({stdin:{contents:[`export * from './extensions/module/source-refs.ts';`,`export * from './extensions/module/lean-skeleton.ts';`,
 `export * from './extensions/module/release-check.ts';`,`export {DecisionContent,TESTIMONY_AUTHORITY,BOOK_WORDS_AUTHORITY,Interaction} from './runtime/decision-content.ts';`].join('\n'),
 resolveDir:resolve(import.meta.dirname,'../..'),sourcefile:'pointer-api.ts',loader:'ts'},outfile:join(temp,'api.mjs'),bundle:true,platform:'node',format:'esm',
 packages:'external',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
const DOC='d'.repeat(64),LAYOUT='blocks-v1';

test('§263.1: a quote becomes a byte range the host slices back; changed words, another layout or a split character void it',()=>{
 const block={id:'b20-0-aaaaaaaa',text:'Café owner Russ is tall and thin.\nKeeper note: he was told to stall.'};
 const ref=api.refFromQuote(DOC,LAYOUT,block,'Russ is tall  and thin.');
 assert.ok(ref);
 const blocks=new Map([[block.id,block]]);
 assert.equal(api.sliceRef(ref,DOC,LAYOUT,blocks),'Russ is tall and thin.');
 assert.equal(api.sliceRef(ref,DOC,'blocks-v2',blocks),undefined,'another layout version');
 assert.equal(api.sliceRef(ref,'e'.repeat(64),LAYOUT,blocks),undefined,'another document');
 assert.equal(api.sliceRef(ref,DOC,LAYOUT,new Map([[block.id,{...block,text:block.text.replace('tall','short')}]])),undefined,'changed words');
 assert.equal(api.sliceRef({...ref,spans:[{block:block.id,start:4,end:6}]},DOC,LAYOUT,blocks),undefined,'a range inside a character');
 assert.equal(api.refFromQuote(DOC,LAYOUT,{id:'b1-0-x',text:'a b a b'},'a b'),undefined,'a quote that occurs twice makes no ref');
 assert.equal(api.refFromQuote(DOC,LAYOUT,block,'he was paid'),undefined,'an absent quote makes no ref');
 assert.equal(api.sliceRef(api.refFromQuote(DOC,LAYOUT,block),DOC,LAYOUT,blocks),block.text,'no quote is the whole block');
 const other=api.refFromQuote(DOC,LAYOUT,{id:'b21-0-bbbbbbbb',text:'Russ is tall and thin.'},'Russ is tall and thin.');
 assert.notEqual(api.refKey(other),api.refKey(ref),'equal words at another place are another ref');
});

const ids=new Set(['b17-1-a','b20-0-b','b20-1-c','b14-1-d']);
test('§263.3: a section answer keeps its pointer lists only on its own blocks and closed words',()=>{
 const answer=api.sectionAnswer({mentions:[{name:'Russ',kind:'npc',blocks:['b17-1-a'],evidence:[{block:'b17-1-a',use:'appearance'},{block:'b99-0-z',use:'appearance'},{block:'b20-0-b',use:'gossip'}]}],
  protected_facts:[{names:['Russ'],risk:'plan',summary:'Russ was told to stall the repair',blocks:['b20-1-c','b99-0-z']},{names:['X'],summary:'no blocks',blocks:['b99-0-z']}],
  release_candidates:[{name:'Russ',kind:'appearance',block:'b17-1-a',quote:'tall and thin'},{name:'Russ',kind:'secret',block:'b17-1-a'},{name:'Russ',kind:'description',block:'b99-0-z'}],
  continuations:[['b17-1-a','b20-0-b'],['b17-1-a','b99-0-z']]},ids);
 assert.deepEqual(answer.mentions[0].evidence,[{block:'b17-1-a',use:'appearance'},{block:'b20-0-b',use:'mention'}]);
 assert.deepEqual(answer.protected_facts,[{names:['Russ'],risk:'plan',summary:'Russ was told to stall the repair',blocks:['b20-1-c']}]);
 assert.deepEqual(answer.release_candidates,[{name:'Russ',kind:'appearance',block:'b17-1-a',quote:'tall and thin'}]);
 assert.deepEqual(answer.continuations,[['b17-1-a','b20-0-b']]);
});

const texts={'b17-1-a':'Russ (Af): Russ is tall and thin, in a clean white shirt.','b20-0-b':'An oily rag hangs from his pocket.','b20-1-c':'Keeper note: Russ was told to stall.','b14-1-d':'Dr Brenner is a cultist who seems friendly.'};
const merged=()=>api.mergeSkeleton([{section:{name:'A',first:13,last:21},status:'indexed',answer:api.sectionAnswer({
 mentions:[{name:'Russ',kind:'npc',blocks:['b17-1-a'],evidence:[{block:'b17-1-a',use:'appearance'}]},{name:'Dr Brenner',aliases:['Brenner'],kind:'npc',blocks:['b14-1-d']}],
 protected_facts:[{names:['Russ'],risk:'plan',summary:'Russ was told to stall the repair',blocks:['b20-1-c']},{names:['Brenner'],risk:'identity',summary:'Brenner is a cultist',blocks:['b14-1-d']}],
 release_candidates:[{name:'Russ',kind:'appearance',block:'b17-1-a',quote:'Russ is tall and thin, in a clean white shirt.'},{name:'Brenner',kind:'appearance',block:'b14-1-d'}],
 continuations:[['b17-1-a','b20-0-b']]},ids)}],id=>Number(/^b(\d+)-/.exec(id)[1]),[18,19],id=>texts[id],DOC);

test('§263.2–263.3: the merged index carries refs, fact ids, completeness and continued blocks for attribution (T01)',()=>{
 const skeleton=merged();
 assert.equal(skeleton.version,4);
 assert.equal(skeleton.complete,true);
 const russ=skeleton.entities.find(entity=>entity.name==='Russ');
 assert.ok(russ.blocks.includes('b20-0-b'),'the page-20 block that continues his page-17 description is his');
 assert.equal(russ.evidence.find(row=>row.block==='b20-0-b').use,'appearance');
 assert.equal(skeleton.release_candidates.length,2);
 const blocks=new Map(Object.entries(texts).map(([id,text])=>[id,{id,text}]));
 assert.equal(api.sliceRef(skeleton.release_candidates[0].ref,DOC,LAYOUT,blocks),'Russ is tall and thin, in a clean white shirt.');
 assert.ok(skeleton.protected_facts.every(fact=>/^pf-[0-9a-f]{12}$/.test(fact.id)));
 assert.equal(skeleton.release_candidates.find(row=>row.entity==='Dr Brenner')?.entity,'Dr Brenner','a candidate names the merged entity');
});

test('§263.4: relevant facts are found by the names the words print and by page, not by meaning (T10)',()=>{
 const skeleton=merged();
 const far={entity:'Gas station',page:30};
 const facts=api.relevantFacts(skeleton,far,'Brenner waves from the porch.',()=>0);
 assert.ok(facts.some(fact=>fact.summary==='Brenner is a cultist'),'a remote identity secret is found because the words print the name');
 assert.equal(api.releaseStatus('safe','appearance',false,false),'candidate','Keeper prose waits for the whole book');
 assert.equal(api.releaseStatus('safe','read_aloud',false,false),'approved');
 assert.equal(api.releaseStatus('safe','appearance',true,true),'candidate','omitted facts never approve');
 assert.equal(api.releaseStatus('uncertain','read_aloud',true,false),'restricted');
});

/** A runtime whose single call answers with `reply(input)` as the child's final assistant text. */
const fakeRuntime=(reply,root)=>({contentRoot:root,async runTask(task){
 const input=JSON.parse(task.request.brief.slice(0,task.request.brief.lastIndexOf('}')+1));
 task.request.onEvent({type:'message_end',message:{role:'assistant',content:[{type:'text',text:JSON.stringify(reply(input))}]}});
 return {ok:true,code:0,timedOut:false,ms:1,stderr:'',command:[],usage:{inputTokens:100,outputTokens:10,costUsd:0,actions:1,unknownCalls:0}};
}});

test('§263.4–263.5: a mixed secret the checker calls unsafe is never issued; an approved look is issued only with its person present (T02)',async()=>{
 const home=join(temp,'home-'+Date.now());await mkdir(join(home,'source-skeletons'),{recursive:true});
 const root=resolve(import.meta.dirname,'../../content');
 const skeleton=merged();
 const rows=[];
 const runtime=fakeRuntime(input=>({verdicts:input.candidates.map(candidate=>({id:candidate.id,verdict:/cultist/.test(candidate.text)?'unsafe':'safe',reason:'x',facts:[]}))}),root);
 const blocks=new Map(Object.entries(texts).map(([id,text])=>[id,{id,text}]));
 const release=await api.checkReleases({runtime,moduleId:'m',home,sha:DOC,skeleton,blocks,model:{id:'test/model'},signal:new AbortController().signal,record:row=>rows.push(row)});
 assert.deepEqual(release.rows.map(row=>[row.entity,row.status]).sort(),[['Dr Brenner','restricted'],['Russ','approved']]);
 assert.ok(rows.some(row=>row.event==='release_check'&&row.usage));
 const stored=JSON.parse(await readFile(api.releasePath(home,DOC),'utf8'));
 const passages=api.withForms(api.approvedPassages(stored,DOC,blocks),skeleton);
 assert.equal(passages.length,1);
 assert.deepEqual(api.passagesInScope(passages,{where:{display_name:'Esso'},present:[{display_name:'Nate'}]}),[],'Russ is not here');
 const here=api.passagesInScope(passages,{where:{display_name:'Esso'},present:[{display_name:'Russ'}]});
 assert.equal(here.length,1);
 // A revoked row is not issued again, whatever its verdict (T12).
 await writeFile(api.releasePath(home,DOC),JSON.stringify({...stored,revoked:[here[0].key]}));
 const again=await api.checkReleases({runtime,moduleId:'m',home,sha:DOC,skeleton,blocks,model:{id:'test/model'},signal:new AbortController().signal,record:()=>{}});
 assert.equal(api.approvedPassages(again,DOC,blocks).length,0);
});

test('§263.5–263.6: book words replace the opening passages; the author hears no stance and may get a delivery (T11)',()=>{
 const content=new api.DecisionContent();
 const capsule={where:{scene:'esso',display_name:'Esso'},opening_pages:{scene:'esso',text:'[Original physical page 17]\nKeeper note: the secret plan.'}};
 const plain=content.prepare('a',capsule,[]);
 assert.ok(plain.facts.some(fact=>fact.value?.name?.startsWith('Original page 17')),'without pointer reading the opening passage is issued');
 const pointer=new api.DecisionContent().prepare('b',capsule,[],[],[],[],[],[],[{page:17,kind:'description',entity:'Esso',text:'A faded Esso sign.'}]);
 assert.ok(!pointer.facts.some(fact=>fact.value?.name?.startsWith('Original page')),'the opening\'s pages are no longer selectable');
 const book=pointer.facts.find(fact=>fact.kind==='book_words');
 assert.equal(book.value.text,'A faded Esso sign.');
 assert.equal(book.value.authority,api.BOOK_WORDS_AUTHORITY);
 assert.ok(!/lie|deflect|truth/i.test(api.TESTIMONY_AUTHORITY.replace('do not judge or correct','')),'the testimony authority says nothing of truth');
 const variants=api.Interaction.anyOf??[];
 assert.ok(variants.some(variant=>variant.properties?.delivery),'an interaction may carry delivery');
});

test('§263.10: the book\'s plans about who is here reach the Keeper as reading only (T03)',()=>{
 const skeleton=merged();
 const plans=api.plansInScope(skeleton,{where:{display_name:'Esso'},present:[{display_name:'Russ'}]});
 assert.deepEqual(plans.map(row=>[row.kind,row.summary]),[['protected','Russ was told to stall the repair']]);
 assert.deepEqual(api.plansInScope(skeleton,{where:{display_name:'Church'},present:[]}),[],'nothing of an absent person');
 const materials=new api.DecisionContent().prepare('p',{where:{scene:'esso',display_name:'Esso'}},[],[],[],[],[],[],[],plans);
 assert.equal(materials.book_truth.rows.length,1);
 assert.ok(!materials.facts.some(fact=>JSON.stringify(fact).includes('stall')),'never a selectable fact');
});

test('§263.3: local ids in a section answer map back to the book\'s block ids',()=>{
 const long=new Map([['k1','b17-1-a'],['k2','b20-0-b']]);
 const out=api.longIds({mentions:[{name:'Russ',blocks:['k1'],evidence:[{block:'k2',use:'appearance'}]}],release_candidates:[{name:'Russ',kind:'appearance',block:'k1'}],continuations:[['k1','k2']],language:'en'},long);
 assert.deepEqual(out.mentions[0].blocks,['b17-1-a']);
 assert.equal(out.mentions[0].evidence[0].block,'b20-0-b');
 assert.equal(out.release_candidates[0].block,'b17-1-a');
 assert.deepEqual(out.continuations,[['b17-1-a','b20-0-b']]);
});

test('§263.4: a page no call would read holds back only the looks of people it names',async()=>{
 const home=join(temp,'blocked-'+Date.now());await mkdir(join(home,'source-skeletons'),{recursive:true});
 const skeleton={...merged(),blocked_pages:[96]};
 const blocks=new Map([...Object.entries(texts).map(([id,text])=>[id,{id,text}]),['b96-0-z',{id:'b96-0-z',text:'Dr Brenner STR 60 CON 70'}]]);
 const runtime=fakeRuntime(input=>({verdicts:input.candidates.map(candidate=>({id:candidate.id,verdict:'safe',reason:'x',facts:[]}))}),resolve(import.meta.dirname,'../../content'));
 const release=await api.checkReleases({runtime,moduleId:'m',home,sha:DOC,skeleton,blocks,model:{id:'test/model'},signal:new AbortController().signal,record:()=>{}});
 assert.deepEqual(release.rows.map(row=>[row.entity,row.status]).sort(),[['Dr Brenner','candidate'],['Russ','approved']]);
});
