/**
 * Contract §262.3–§262.5: the lean reading's pure parts -- its inlined input, the high-risk selection, the host's own
 * refusals, pruning, verdict reading, skeleton sections, merge and cross references.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
const temp=playtestScratch('lean-reading','suite-');
await build({stdin:{contents:[`export * from './extensions/module/lean-read.ts';`,`export * from './extensions/module/lean-skeleton.ts';`].join('\n'),
 resolveDir:resolve(import.meta.dirname,'../..'),sourcefile:'lean-api.ts',loader:'ts'},outfile:join(temp,'api.mjs'),bundle:true,platform:'node',format:'esm',
 packages:'external',logLevel:'silent'});
const lean=await import(pathToFileURL(join(temp,'api.mjs')).href);

const block=(page,order,text,extra={})=>({id:`b${page}-${order}-0000000${order}`,page,column:0,order,bbox:[0,0,1,1],text,text_sha256:'x',...extra});
const pages=new Map([
 [20,{page:20,image_only:false,blocks:[block(20,0,'Steve: nearly seventy.'),block(20,1,'Keeper note: convincing him is hard. Unless'),block(20,2,'there is ironclad evidence, rolls need a Hard success.',{continues:'b20-1-00000001'})]}],
 [18,{page:18,image_only:true,blocks:[]}],
]);

test('§262.3: the lean input drops the published dumps for a roster and inlines blocks with their continuation',()=>{
 const input=lean.leanInput({purpose:'detail',focus:'Esso',known_nodes:[{node_id:'npc-steve',node_kind:'npc',name:'Steve',aliases:['Steven'],summary:'long'}],
  known_claims:[{subject_id:'npc-steve'}],commands:{check:'x'}},pages,[{kind:'keeper_truth',names:['Russ'],summary:'stall',pages:[13],text:'They tell Russ to stall.'}]);
 assert.equal(input.known_nodes,undefined);
 assert.equal(input.commands,undefined);
 assert.deepEqual(input.roster,[{node_id:'npc-steve',node_kind:'npc',name:'Steve',aliases:['Steven']}]);
 assert.equal(input.known_claims,1,'only the count of published claims travels');
 assert.deepEqual(input.source_blocks.map(row=>row.id),['b20-0-00000000','b20-1-00000001','b20-2-00000002']);
 assert.equal(input.source_blocks[2].continues,'b20-1-00000001');
 assert.deepEqual(input.image_pages,[18]);
 assert.equal(input.cross_references.length,1);
});

test('§262.3: pages past the source bound are named, not inlined',()=>{
 const big=new Map([[1,{page:1,image_only:false,blocks:[block(1,0,'x'.repeat(30000))]}],[2,{page:2,image_only:false,blocks:[block(2,0,'y'.repeat(30000))]}]]);
 const input=lean.leanInput({},big);
 assert.deepEqual(input.source_blocks.map(row=>row.page),[1]);
 assert.deepEqual(input.more_pages,[2]);
});

const draft=()=>({nodes:[{node_id:'npc-steve',node_kind:'npc',name:'Steve',properties:{secret:'s',voice:'v'},source_refs:[{page:20}]},
  {node_id:'location-esso',node_kind:'location',name:'Esso',source_refs:[{page:20}]},{node_id:'npc-russ',node_kind:'npc',name:'Russ',source_refs:[{page:20}]}],
 claims:[{subject_id:'npc-steve',predicate:'located-in',object:{node_id:'location-esso'},source_refs:[{page:20}]},
  {subject_id:'npc-russ',predicate:'knows',object:{node_id:'npc-steve'},source_refs:[{page:20}]},
  {subject_id:'npc-steve',predicate:'present-in',object:{node_id:'location-esso'},validity:{when:'day'},source_refs:[{page:20}]},
  {subject_id:'npc-russ',predicate:'located-in',object:{node_id:'location-esso'},source_refs:[{page:21}]}],
 exhibits:[{exhibit_id:'exhibit-a',carrier:'location-esso',surface:{text:'Steve: nearly seventy.',verbatim:true},source_refs:[{page:20}]},
  {exhibit_id:'exhibit-b',carrier:'location-esso',surface:{text:'Not in the book.',verbatim:true},source_refs:[{page:20}]},
  {exhibit_id:'exhibit-c',carrier:'npc-russ',surface:{text:'Paraphrase.',verbatim:false},source_refs:[{page:20}]}],
 ready_nodes:['npc-steve','location-esso','npc-russ'],critical:['npc-russ']});

test('§262.4: high-risk records are risky predicates, conditioned claims, every exhibit and closed node kinds',()=>{
 const picked=lean.highRiskCandidates(draft()).map(row=>row.path);
 assert.deepEqual(picked,['/claims/1','/claims/2','/exhibits/0','/exhibits/1','/exhibits/2','/nodes/0','/nodes/2']);
});

test('§262.4: the host refuses a verbatim exhibit not in its pages and a record citing an unread page, without a model',()=>{
 const refused=lean.hostRefusals(draft(),pages,new Set([20]));
 assert.deepEqual(refused.map(row=>row.path),['/exhibits/1','/claims/3']);
});

test('§262.4: pruning removes refused records, a node\'s named fields, and everything naming a removed node',()=>{
 const pruned=draft();
 const removed=lean.pruneDraft(pruned,[{path:'/exhibits/1'},{path:'/nodes/0',fields:['secret','summary']},{path:'/nodes/2'}]);
 assert.deepEqual(removed,['npc-russ']);
 assert.deepEqual(pruned.nodes.map(node=>node.node_id),['npc-steve','location-esso']);
 assert.deepEqual(pruned.nodes[0].properties,{voice:'v'},'the named field goes; summary is never removed');
 assert.deepEqual(pruned.claims.map(claim=>claim.predicate),['located-in','present-in']);
 assert.deepEqual(pruned.exhibits.map(row=>row.exhibit_id),['exhibit-a']);
 assert.deepEqual(pruned.ready_nodes,['npc-steve','location-esso']);
 assert.deepEqual(pruned.critical,[]);
});

test('§262.4: verdicts are read per known ref once, with a closed verdict',()=>{
 const candidates=[{ref:'c1'},{ref:'c2'},{ref:'c3'}];
 const read=lean.readVerdicts({verdicts:[{ref:'c1',verdict:'supported'},{ref:'c1',verdict:'unsupported'},{ref:'c2',verdict:'maybe'},{ref:'c9',verdict:'supported'},
  {ref:'c3',verdict:'uncertain',reason:'r',fields:['secret',3]}]},candidates);
 assert.deepEqual([...read.keys()],['c1','c3']);
 assert.equal(read.get('c1').verdict,'supported');
 assert.deepEqual(read.get('c3').fields,['secret']);
});

test('§262.5: sections start at bookmarks and split at a page when a section passes the token bound',()=>{
 const sections=lean.skeletonSections(10,[{name:'Intro',page:1,children:[]},{name:'Town',page:4,children:[{name:'Inn',page:6}]}],page=>page===7?5500:1500);
 // §263.3: the bound is about 6K tokens per section.
 assert.deepEqual(sections.map(row=>[row.name,row.first,row.last]),[['Intro',1,3],['Town',4,5],['Inn',6,6],['Inn',7,7],['Inn',8,10]]);
 assert.deepEqual(lean.skeletonSections(3,[],()=>1).map(row=>[row.first,row.last]),[[1,3]]);
});

test('§262.5: a section answer keeps only its own block ids and named rows',()=>{
 const answer=lean.sectionAnswer({mentions:[{name:' Russ ',aliases:['Russell'],kind:'npc',blocks:['b13-1','bogus']}],
  keeper_truth:[{names:['Russ'],summary:'stall the repair',blocks:['b13-1']},{names:[],summary:'nameless',blocks:['b13-1']},{names:['X'],summary:'no blocks',blocks:['bogus']}]},new Set(['b13-1']));
 assert.deepEqual(answer.mentions,[{name:'Russ',aliases:['Russell'],kind:'npc',blocks:['b13-1'],evidence:[]}],'§263.3: a mention carries its evidence uses, empty when none');
 assert.deepEqual(answer.keeper_truth,[{names:['Russ'],summary:'stall the repair',blocks:['b13-1']}]);
 assert.deepEqual(answer.cross_references,[]);
});

test('§262.5 × §262.3: merge unifies aliases; a reading of p20 receives the p13 truth about Russ and nothing local',()=>{
 const page={'b13-1':13,'b20-0':20,'b76-0':76,'b20-1':20};
 const text={'b13-1':'They tell Russ to say the parts must be ordered.','b76-0':'Seth tails the PCs.'};
 const merged=lean.mergeSkeleton([
  {section:{name:'Running',first:13,last:13},status:'indexed',answer:{mentions:[{name:'Russ',aliases:[],kind:'npc',blocks:['b13-1']}],cross_references:[],conditional_events:[],
   keeper_truth:[{names:['Russell Williams'],summary:'Russ is told to stall',blocks:['b13-1']}]}},
  {section:{name:'Esso',first:17,last:20},status:'indexed',answer:{mentions:[{name:'Russell Williams',aliases:['Russ'],kind:'npc',blocks:['b20-0']}],
   cross_references:[{names:['Russ'],summary:'local only',blocks:['b20-1']}],conditional_events:[],keeper_truth:[]}},
  {section:{name:'Timeline',first:76,last:76},status:'failed'},
 ],id=>page[id],[18,19],id=>text[id]);
 assert.equal(merged.entities.length,1,'one Russ under two spellings');
 assert.deepEqual(merged.entities[0].pages,[13,20]);
 assert.deepEqual(merged.image_only,[18,19]);
 assert.deepEqual(merged.sections.map(row=>row.status),['indexed','indexed','failed']);
 assert.equal(merged.keeper_truth[0].resolved,true);
 const cross=lean.crossReferencesFor(merged,[20]);
 assert.deepEqual(cross.map(row=>[row.kind,row.pages,row.text]),[['keeper_truth',[13],'They tell Russ to say the parts must be ordered.']]);
 assert.deepEqual(lean.crossReferencesFor(merged,[50]),[],'a page with no entity gets nothing');
});

test('§262.3: a lean job is a plain detail reading under the switch',()=>{
 const env={PI_COC_LEAN_READING:'1'};
 assert.equal(lean.leanEligible({purpose:'detail'},env),true);
 assert.equal(lean.leanEligible({purpose:'detail'},{}),false);
 for(const marker of ['visual_scan','visual_asset','map_scope','visual_identity','node_identity'])assert.equal(lean.leanEligible({purpose:'detail',[marker]:{}},env),false);
 assert.equal(lean.leanEligible({purpose:'detail',material:'map'},env),false);
 assert.equal(lean.leanEligible({purpose:'opening'},env),false);
});

test('§262.3: a check refusal that names only source needs is recognised; any other finding is not',()=>{
 assert.equal(lean.onlySourceNeedFindings({details:{path:'/source_needs',findings:[{path:'/source_needs/0'}]}}),true);
 assert.equal(lean.onlySourceNeedFindings({details:{path:'/source_needs'}}),true);
 assert.equal(lean.onlySourceNeedFindings({details:{findings:[{path:'/source_needs/0'},{path:'/nodes/1'}]}}),false);
 assert.equal(lean.onlySourceNeedFindings({details:{path:'/critical'}}),false);
 assert.equal(lean.onlySourceNeedFindings(undefined),false);
});

test('§262.5: a mention also cites the section blocks that print one of its names', ()=>{
 const answer={mentions:[{name:'Last Stop',aliases:['Last Stop Bar'],kind:'location',blocks:[]},{name:'X',aliases:[],kind:'npc',blocks:['b1-0']}]};
 const grounded=lean.groundMentions(answer,[{id:'b1-0',text:'The town has a bar.'},{id:'b27-3',text:'3D. Last  Stop Bar'},{id:'b27-4',text:'the last stop serves food'}]);
 assert.deepEqual(grounded.mentions[0].blocks,['b27-3','b27-4'],'spacing and case are normalised');
 assert.deepEqual(grounded.mentions[1].blocks,['b1-0'],'a one-character name is never matched by text');
});

test('§262.8: a cast range draft lists the skeleton\'s people printed on the range\'s pages', ()=>{
 const skeleton={language:'zh-Hans',entities:[
  {name:'Russ Williams',aliases:['Russ','Russell'],english:['Russ Williams'],kinds:['npc'],pages:[17,20,45]},
  {name:'Esso',aliases:[],english:['Esso'],kinds:['location'],pages:[17]},
  {name:'Ghost',aliases:[],english:[],kinds:['creature'],pages:[19]},
  {name:'Seth',aliases:[],english:['Seth'],kinds:['npc'],pages:[76]}]};
 const text={17:'Russ Williams owns the station.',20:'Russ fears them.',19:'nothing here'};
 const draft=lean.castDraftFromSkeleton(skeleton,{first:1,last:40},page=>text[page]??'');
 assert.deepEqual(draft,{people:[{book:['Russ Williams','Russ'],play:['Russ Williams','Russ'],notes:['Russ Williams'],pages:[17,20]}]});
 assert.equal(lean.samePrimaryLanguage('zh-Hans','zh-CN'),true);
 assert.equal(lean.samePrimaryLanguage('zh-Hans','en'),false);
 assert.equal(lean.samePrimaryLanguage(undefined,'en'),false);
});

test('§262.9: a lean answer slices the index pages of the names the question prints, then the rows naming them', ()=>{
 const skeleton={entities:[{name:'Last Stop',aliases:['Last Stop Bar'],pages:[3,27,28],blocks:['b27-1','b27-2','b28-0','b3-0']},
  {name:'Seth',aliases:[],pages:[36],blocks:['b36-0']}],
  keeper_truth:[{names:['Last Stop'],summary:'x',pages:[13]}],conditional_events:[{names:['Seth'],pages:[76]}],cross_references:[]};
 assert.deepEqual(lean.answerPages(skeleton,'Who runs the  last stop bar?\nand her name'),[3,27,28,13]);
 assert.deepEqual(lean.answerPages(skeleton,'nothing named here'),[]);
 assert.deepEqual(lean.answerPages(skeleton,'Seth and the Last Stop',3),[3,27,28]);
});
