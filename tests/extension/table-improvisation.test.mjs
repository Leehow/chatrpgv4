import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundle=await build({stdin:{contents:"export {ModuleGraph} from './kernel-ts/read/module-graph.ts'; export {withTableEntities,tableEntityId} from './kernel-ts/read/table-entities.ts'; export {admissionRequest} from './extensions/kernel/admission.ts'; export {report} from './kernel-ts/worldline/confluence-plan.ts';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const api=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('campaign places and evidence remain readable when later source has the same name; source bytes remain unchanged',()=>{
 const name='Riverside photographic shop',clue='The delivery address';
 const raw={nodes:[{node_id:'source-shop',node_kind:'scene',name,summary:'The source describes another counter layout.',properties:{}}],relations:[],claims:[]};
 const before=JSON.stringify(raw),world={table_entities:[
  {id:api.tableEntityId('scene',name),kind:'scene',name,summary:'The shop established at this table.',turn:2},
  {id:api.tableEntityId('clue',clue),kind:'clue',name:clue,summary:'A warehouse address.',scene:name,turn:2}]};
 const module=api.withTableEntities({graph:new api.ModuleGraph('book',raw,'digest',{}),material:()=> 'missing'},world);
 assert.equal(module.graph.scene(name).summary,'The shop established at this table.');
 assert.equal(module.graph.search(name).length,1);
 assert.equal(module.graph.search(name)[0].summary,'The shop established at this table.');
 assert.equal(module.graph.clue(clue).summary,'A warehouse address.');
 assert.equal(module.material(name),'ready');
 assert.equal(module.material(clue),'ready');
 assert.equal(module.graph.sceneClueIds(module.graph.scene(name)).length,1);
 assert(module.graph.search(clue).some(node=>node.name===clue));
 assert.equal(JSON.stringify(raw),before);
 assert.equal(module.graph.nodes.get('source-shop').summary,'The source describes another counter layout.');
});

test('new place establishment remains visible to ordinary player admission',()=>{
 const proposal=api.admissionRequest('apply',{effects:[{kind:'move',to:'Riverside photographic shop',via:'Walk there',establish:{summary:'A public shop'}}]},{party:['Nora'],scene:{handle:'cemetery'}});
 assert(proposal);
 assert.match(JSON.stringify(proposal.lines),/establish/);
 assert.match(JSON.stringify(proposal.lines),/Riverside photographic shop/);
 const changed=api.admissionRequest('apply',{effects:[{kind:'move',to:'Riverside photographic shop',via:'Walk there',establish:{summary:'A different physical location'}}]},{party:['Nora'],scene:{handle:'cemetery'}});
 assert.notEqual(changed.key,proposal.key,'changed establishment must not reuse an earlier admission');
});

test('confluence cannot silently discard another branch campaign entity',()=>{
 assert.throws(()=>api.report(new api.ModuleGraph('book',{nodes:[],relations:[]},'digest',{}),[
  {line:'one',world:{active_scene:'dock',table_entities:[]}},
  {line:'two',world:{active_scene:'dock',table_entities:[{name:'A shop',kind:'scene'}]}}
 ],'dock'),error=>error.code==='needs'&&error.details.reason==='table_entity_merge_conflict');
});
