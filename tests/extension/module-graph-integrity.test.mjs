import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT=resolve(import.meta.dirname,'../..'),evidence=await mkdtemp(join(tmpdir(),'coc-graph-integrity-'));
await symlink(join(ROOT,'node_modules'),join(evidence,'node_modules'),'dir');
await build({stdin:{contents:"export {createKernelContext} from './kernel-ts/context.ts';export {ModuleStore} from './kernel-ts/modules/store.ts';export {loadModule} from './kernel-ts/read/campaign.ts';export {jsonDigest,parsePythonJson,pythonJsonDumps,PythonFloat} from './kernel-ts/json.ts';export {writeJsonAtomic} from './kernel-ts/fileio.ts';",resolveDir:ROOT},
 outfile:join(evidence,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',target:'node22',logLevel:'silent'});
const api=await import(pathToFileURL(join(evidence,'api.mjs')).href);
const json=async path=>api.parsePythonJson(await readFile(path,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const rawGraph=(id,value)=>({contract_id:'coc.module-graph.v3',schema_version:3,module_id:id,
 nodes:[{node_id:`module-${id}`,node_kind:'module',name:'Book',properties:{value}}],relations:[],claims:[]});
async function fixture(value=new api.PythonFloat(1)) {
 const home=await mkdtemp(join(evidence,'case-')),context=await api.createKernelContext({workspace:home,content:join(ROOT,'content')}),store=new api.ModuleStore(context);
 const meta={id:'test-book',source:'pdf',generation:0};
 await store.writeGraph(meta,rawGraph(meta.id,value));await store.writeModule(meta);
 const graphPath=await store.graphPath(meta.id),manifestPath=join(dirname(graphPath),'module-graph-manifest.json');
 const reads=[()=>store.readGraph(meta.id),()=>store.graph(meta.id),()=>api.loadModule(context,meta.id)];
 return {home,context,store,meta,graphPath,manifestPath,reads};
}
async function refused(reads,component) {
 for(const read of reads)await assert.rejects(read(),error=>{
  assert.equal(error.code,'campaign_not_ready');assert.equal(error.details.reason,'module_graph_integrity');
  assert.equal(error.details.component,component);return true;
 });
}

test('published reads preserve float identity and hot-cache identity for unchanged verified bytes',async()=>{
 const f=await fixture(),first=await f.store.graph(f.meta.id);
 assert.equal(first,await f.store.graph(f.meta.id));
 for(const read of f.reads)await read();
 assert.ok((await f.store.readGraph(f.meta.id)).nodes[0].properties.value instanceof api.PythonFloat);
});

test('all graph consumers reject changed bytes even after the graph cache was primed',async()=>{
 const f=await fixture();await f.store.graph(f.meta.id);
 const original=await readFile(f.graphPath),changed=Buffer.concat([original,Buffer.from(' ')]);
 await writeFile(f.graphPath,changed);
 const metaBefore=await readFile(f.store.moduleJson(f.meta.id)),manifestBefore=await readFile(f.manifestPath);
 await refused(f.reads,'graph_digest');
 assert.deepEqual(await readFile(f.graphPath),changed);assert.deepEqual(await readFile(f.store.moduleJson(f.meta.id)),metaBefore);
 assert.deepEqual(await readFile(f.manifestPath),manifestBefore);
});

test('updating a raw digest cannot bypass the canonical generation manifest',async()=>{
 const f=await fixture(),changed=api.pythonJsonDumps(rawGraph(f.meta.id,new api.PythonFloat(2)));
 await writeFile(f.graphPath,changed);f.meta.graph_digest=sha(changed);await f.store.writeModule(f.meta);
 await refused(f.reads,'manifest_digest');
});

test('missing publication hashes and altered manifest identity are refused',async()=>{
 const missing=await fixture();delete missing.meta.graph_digest;await missing.store.writeModule(missing.meta);
 await refused(missing.reads,'metadata_digest');
 const identity=await fixture(),manifest=await json(identity.manifestPath);manifest.module_id='another-book';
 await api.writeJsonAtomic(identity.manifestPath,manifest);await refused(identity.reads,'module_identity');
 const generation=await fixture(),wrong=await json(generation.manifestPath);wrong.generation++;
 await api.writeJsonAtomic(generation.manifestPath,wrong);await refused(generation.reads,'generation');
});

test('a new publication changes the pointer without changing the prior generation',async()=>{
 const f=await fixture(),old=await readFile(f.graphPath);await f.store.graph(f.meta.id);
 await f.store.writeGraph(f.meta,rawGraph(f.meta.id,new api.PythonFloat(2)));
 assert.equal((await f.store.module(f.meta.id)).generation,1);
 assert.equal((await f.store.graph(f.meta.id)).raw.nodes[0].properties.value.value,1);
 await f.store.writeModule(f.meta);
 assert.equal((await f.store.graph(f.meta.id)).raw.nodes[0].properties.value.value,2);
 assert.deepEqual(await readFile(f.graphPath),old);
});

async function starterFixture(){
 const home=await mkdtemp(join(evidence,'starter-')),content=join(home,'content'),source=join(content,'starters','test-starter');
 await mkdir(source,{recursive:true});
 for(const name of ['rulesets','modules'])await symlink(join(ROOT,'content',name),join(content,name),'dir');
 const graph={...rawGraph('test-starter',1),unpaged:true,entry_scene_ids:['scene-room'],ending_scene_ids:[]};
 graph.nodes.push({node_id:'scene-room',node_kind:'scene',name:'Room',properties:{is_entrance:true}});
 await api.writeJsonAtomic(join(source,'module-graph.json'),graph);
 const context=await api.createKernelContext({workspace:home,content}),store=new api.ModuleStore(context);
 await store.register('test-starter');return {home,content,source,graph,context,store};
}

test('registering changed starter content retains the already published graph',async()=>{
 const {source,graph,store}=await starterFixture();
 const oldPath=await store.graphPath('test-starter'),old=await readFile(oldPath);
 graph.nodes[1].name='Updated room';await api.writeJsonAtomic(join(source,'module-graph.json'),graph);
 await store.register('test-starter');
 assert.notEqual(await store.graphPath('test-starter'),oldPath);
 assert.deepEqual(await readFile(oldPath),old);await store.graph('test-starter');
});

test('unchanged starter registration cannot follow an external graph pointer',async()=>{
 const {home,store}=await starterFixture(),meta=await store.module('test-starter');
 const previous=await store.graphPath('test-starter'),external=join(home,'outside');await mkdir(external);
 for(const name of ['module-graph.json','module-graph-manifest.json','assets.json'])
  await writeFile(join(external,name),await readFile(join(dirname(previous),name)));
 meta.graph_file=join(external,'module-graph.json');await store.writeModule(meta);
 const saved=await readFile(store.moduleJson(meta.id));
 await refused([()=>store.register(meta.id)],'graph_path');
 assert.deepEqual(await readFile(store.moduleJson(meta.id)),saved);
});

test('starter publication uses one captured source buffer even when the source changes mid-call',async()=>{
 const {source,graph,context,store}=await starterFixture(),sourcePath=join(source,'module-graph.json');
 graph.nodes[1].name='Version two';await api.writeJsonAtomic(sourcePath,graph);
 const third=api.parsePythonJson(api.pythonJsonDumps(graph));third.nodes[1].name='Version three';
 let changed=false;
 const raced={...context,snapshots:{...context.snapshots,async readJson(path){
  if(path===store.moduleJson('test-starter')&&!changed){changed=true;await api.writeJsonAtomic(sourcePath,third);}
  return context.snapshots.readJson(path);
 }}};
 const writer=new api.ModuleStore(raced);await writer.register('test-starter');
 assert.ok(changed);assert.equal((await writer.graph('test-starter')).raw.nodes[1].name,'Version two');
 assert.equal((await json(sourcePath)).nodes[1].name,'Version three');
});

test('a failed candidate validation leaves the previous starter pointer intact',async()=>{
 const {source,graph,store}=await starterFixture(),metaPath=store.moduleJson('test-starter'),before=await readFile(metaPath);
 graph.module_id='another-book';await api.writeJsonAtomic(join(source,'module-graph.json'),graph);
 await refused([()=>store.register('test-starter')],'module_identity');
 assert.deepEqual(await readFile(metaPath),before);await store.graph('test-starter');
});
