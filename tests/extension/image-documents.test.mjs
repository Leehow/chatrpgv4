/** Image carriers use real RPC ownership, deferred creation and the shared player-host gate. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdir,readFile,writeFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {table,root,temporary} from './object-usages-fixture.mjs';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import modsExtension from '../../extensions/mods/index.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
import {withDocumentImage} from '../../shared/handout-images.js';
import {documentPresentationStatus} from '../../extensions/mods/document-presentation.ts';
import {waitFor} from './wait.mjs';
import {createCanvas,loadImage} from '@napi-rs/canvas';
const MAP='Corbitt House Investigator Map';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1cAAAAASUVORK5CYII=','base64');
const draft={name:'Folded map',category:'item',description:'The acquired investigator map.',basis:'The revealed source.',
  parameters:{charges:null,effects:[]},player_view:{description:'The acquired investigator map.',fields:[]},
  document:{handout:MAP,presentation:'map'}};
async function pictured(t){
 const game=await table(t),folder=join(game.home,'.coc/modules/the-haunting'),file=join(folder,'assets.json');
 const assets=JSON.parse(await readFile(file,'utf8'));
 Object.assign(assets.assets.find(row=>row.id==='handout-the-haunting-corbitt-house-investigator-map'),{path:'assets/player/map.png',media_type:'image/png'});
 await mkdir(join(folder,'assets/player'),{recursive:true});await writeFile(join(folder,'assets/player/map.png'),PNG);await writeFile(file,JSON.stringify(assets));
 return game;
}
async function accept(game,value=draft){
 const job=await game.call('mods.job',{role:'create',input:{name:value.name,category:'item',description:value.description}});
 await writeFile(join(job.cwd,'result.json'),JSON.stringify(value));
 return game.call('mods.accept',{job:job.job});
}
test('only revealed images become immutable inventory carriers; copies survive source changes and custody transfers',async t=>{
 const game=await pictured(t);
 await assert.rejects(accept(game),/already revealed/);
 await game.apply([{kind:'handout',name:MAP}]);
 assert.equal(Object.values((await game.world()).objects.instances).some(item=>item.document),false,'display does not grant custody');
 const accepted=await accept(game);
 await game.apply([{kind:'define',name:draft.name,category:'item',_definition:accepted.definition,_provenance:accepted.provenance},
  {kind:'object',name:'My folded map',definition:draft.name,to:game.sheet.name}]);
 const params={actor:game.sheet.id,name:'My folded map'};
 const view=await game.call('mods.document.view',params);
 assert.equal(view.editing,'read_only');assert.equal(view.presentation,'map');
 await game.apply([{kind:'object',name:params.name,from:game.sheet.name,to:game.sheet.name,document:{action:'open'},why:'Unfolding the retained map.'}]);
 const looked=JSON.stringify(await game.call('table.look',{focus:'object',name:params.name}));
 assert.equal(looked.includes('document-assets'),false,'host-only paths never enter Keeper context');
 assert.equal((await game.call('mods.document.options')).documents.some(item=>item.name===params.name),false,'an image is not a writable blank page');
 await assert.rejects(game.call('table.look',{focus:'object',name:params.name,document_page:1}),/no searchable text/);
 const audit=await game.call('mods.context');assert.equal(audit.objects.instances.find(item=>item.name===params.name).document.read_only,true);
 assert.ok(view.image.path.startsWith(join(await realpath(game.directory),'document-assets')));
 assert.deepEqual(await readFile(view.image.path),PNG);
 assert.equal(withDocumentImage(view,{home:game.home,campaign:'c1'}).image,'data:image/png;base64,'+PNG.toString('base64'));
 assert.equal(documentPresentationStatus({home:game.home,runner:()=>{throw new Error('Image must not call a text translator');}},view),view);
 const owned=await game.call('table.view');
 assert.equal(owned.investigators[0].objects.find(item=>item.name===params.name).document.read_only,true);
 await writeFile(join(game.home,'.coc/modules/the-haunting/assets/player/map.png'),'source changed');
 assert.deepEqual(await readFile(view.image.path),PNG);
 for(const method of ['mods.document.apply','mods.document.request'])for(const action of ['save','reset'])
  await assert.rejects(game.call(method,{...params,version:view.version,action,...(action==='save'?{text:'Replacement'}:{})}),/read-only/);
 await assert.rejects(game.apply([{kind:'object',name:params.name,from:game.sheet.name,to:game.sheet.name,document:{action:'write',text:'Overwrite'},why:'Attempted edit.'}]),/read-only/);
 await assert.rejects(game.apply([{kind:'object',name:params.name,from:game.sheet.name,to:game.sheet.name,document:{action:'append',text:'Overwrite'},why:'Attempted edit.'}]),/writable|read-only/);
 await assert.rejects(accept(game,{...draft,name:'Forged image',document:{presentation:'image',image:view.image}}),/host-owned/);
 await game.apply([{kind:'object',name:params.name,from:game.sheet.name,to:'Steven Knott',handover:'given',why:'The investigator hands over the map.'}]);
 await assert.rejects(game.call('mods.document.view',params),/does not own/);
 await game.apply([{kind:'object',name:params.name,from:'Steven Knott',to:game.sheet.name,handover:'given',why:'Knott returns the same map.'}]);
 const returned=await game.call('mods.document.view',params);assert.deepEqual(returned.image,view.image);
 await writeFile(view.image.path,'tampered');
 assert.throws(()=>withDocumentImage(returned,{home:game.home,campaign:'c1'}),/unavailable or has changed/);
});

test('a queued image definition places its item immediately and lands on that same instance after background acceptance',async t=>{
 const game=await pictured(t);await game.apply([{kind:'handout',name:MAP}]);
 const events=new EventEmitter(),entries=[],hooks=new Map();let bridge,release;
 const barrier=new Promise(resolve=>{release=resolve;});
 const pi={events,on:(name,fn)=>hooks.set(name,fn),appendEntry:(customType,data)=>entries.push({customType,data})};
 events.on('coc:mods-bridge',value=>{bridge=value;});modsExtension(pi);
 events.emit('coc:kernel-bridge',{call:(method,params)=>game.call(method,JSON.parse(JSON.stringify(params))),mintCallId:()=>game.next(),runtime:{
  async runTask(task){await barrier;await writeFile(join(task.request.cwd,'result.json'),JSON.stringify(draft));return {ok:true,code:0,timedOut:false,ms:1,stderr:'',command:[]};},
  async check(){return {ok:true};}
 }});
 const payload={campaign:'c1',effects:[{kind:'define',name:draft.name,category:'item',description:draft.description},
  {kind:'object',name:'My queued map',definition:draft.name,to:game.sheet.name,why:'I take the offered map.'}]};
 await bridge.prepare('apply',payload);assert.equal(typeof payload.effects[0]._queued,'string');
 await game.apply(payload.effects);
 const before=Object.values((await game.world()).objects.instances).find(item=>item.name==='My queued map');
 assert.ok(before);assert.equal(before.document,undefined);
 release();await waitFor(()=>entries.some(entry=>entry.customType==='coc-object-details'),{label:'image creator accepted in background'});
 await game.call('table.narrate',{call_id:game.next(),text:'You fold the map and keep it.'});
 await game.call('table.player_input',{text:'I open my map.'});await bridge.after('player_input',{campaign:'c1'});
 const after=Object.values((await game.world()).objects.instances).find(item=>item.name==='My queued map');
 assert.equal(after.id,before.id);assert.equal(after.document.presentation,'map');assert.ok(after.document.image.sha256);
});

test('player reference collection is routed to the host control instead of fictional definition generation',async()=>{
 const manifest=JSON.parse(await readFile(join(root,'mods/enhanced-items/mod.json'),'utf8'));
 assert.equal(manifest.version,'1.4.2');assert.ok(manifest.requires.includes('objects.image-references.v1'));
 const agent=await readFile(join(root,'mods/enhanced-items/agent.md'),'utf8');
 const creator=await readFile(join(root,'mods/enhanced-items/creator.md'),'utf8');
 assert.ok(agent.includes('do not use define/object for UI collection'));
 assert.ok(creator.includes('never require definition generation'));
});

// The published graph's image_asset_id owns this source; no handout-registry mutation fills missing MIME.
test('a revealed published handout resolves its linked raster without repairing its registry',async t=>{
 const game=await table(t),folder=join(game.home,'.coc/modules/the-haunting'),path=join(folder,'assets/player/corbitt-house-investigator-map.png');
 await mkdir(join(folder,'assets/player'),{recursive:true});await writeFile(path,PNG);
 const before=await readFile(join(folder,'assets.json'));
 const shown=await game.apply([{kind:'handout',name:MAP}]);
 assert.equal(shown.receipts.length,1);
 const status=await game.call('table.status'),handout=status.receipts.find(row=>row.kind==='handout');
 assert.equal(handout.attachment.image_media_type||handout.attachment.media_type,'image/png');
 const job=await game.call('mods.job',{role:'create',input:{name:draft.name,category:'item',description:draft.description}});
 const request=JSON.parse(await readFile(join(job.cwd,'request.json'),'utf8'));
 assert.ok(request.known_handouts.some(row=>row.name===MAP&&row.image===true));
 const accepted=await accept(game);
 await game.apply([{kind:'define',name:draft.name,category:'item',_definition:accepted.definition,_provenance:accepted.provenance},
  {kind:'object',name:'Linked source map',definition:draft.name,to:game.sheet.name}]);
 const view=await game.call('mods.document.view',{actor:game.sheet.id,name:'Linked source map'});
 assert.equal(view.editing,'read_only');assert.deepEqual(await readFile(view.image.path),PNG);assert.deepEqual(await readFile(join(folder,'assets.json')),before);
});

for(const wrapperName of [null,'Investigator entrance sketch','Retained second-print sketch'])test(`held region maps acquire only the current masked render through background creation${wrapperName?` with ${wrapperName}`:''}`,async t=>{
 const game=await table(t),folder=join(game.home,'.coc/modules/the-haunting'),path=join(folder,'assets/player/corbitt-house-investigator-map.png');
 const handout=wrapperName??MAP;
 if(wrapperName){
  // Publish the same reviewed link under a distinct wrapper title through the real generation writer.
  const modulePath=join(temporary,'map-publication-api.mjs');
  await build({stdin:{contents:"export {ModuleStore} from './kernel-ts/modules/store.ts'; export {closeSourceState} from './kernel-ts/modules/source-state.ts';",resolveDir:root,sourcefile:'map-publication-api.ts'},outfile:modulePath,bundle:true,packages:'external',format:'esm',platform:'node',target:'node22',logLevel:'silent'});
  const {ModuleStore,closeSourceState}=await import(pathToFileURL(modulePath).href),store=new ModuleStore(game.context);
  try{
   const meta=await store.module('the-haunting'),graph=JSON.parse(await readFile(await store.graphPath('the-haunting',meta),'utf8'));
   const wrapper=graph.nodes.find(node=>node.node_id==='handout-the-haunting-corbitt-house-investigator-map');
   wrapper.name=wrapperName;
   if(wrapperName==='Retained second-print sketch'){
    const canonical=graph.nodes.find(node=>node.node_id==='asset-player-corbitt-house-map'),variant=structuredClone(canonical);
    variant.node_id='asset-second-print-map';variant.name='Second print of the house plan';graph.nodes.push(variant);
    const correspondence=Object.fromEntries(canonical.properties.map_regions.map(region=>[region.region_id,region.region_id]));
    graph.relations.push({relation_id:'rel-identity-asset-second-print-map-to-asset-player-corbitt-house-map',relation_kind:'variant-of',
     from_node_id:variant.node_id,to_node_id:canonical.node_id,properties:{identity_review:{verdict:'same',region_correspondence:correspondence},region_correspondence:correspondence}});
    wrapper.properties.image_asset_id=variant.node_id;
   }
   await store.writeGraph(meta,graph);await store.writeModule(meta);
  }finally{closeSourceState(game.context.stateRoot);}
 }
 await mkdir(join(folder,'assets/player'),{recursive:true});
 const source=createCanvas(200,200),ctx=source.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,200,200);
 // The authored entry hall reaches y=.59; keep this stripe entirely inside the unknown room.
 ctx.fillStyle='#0000ff';ctx.fillRect(26,122,52,16);await writeFile(path,source.toBuffer('image/png'));
 if(wrapperName)await game.apply([{kind:'handout',name:handout}]);
 await game.apply([{kind:'map',name:'player-corbitt-house-map',regions:['ground-entry-hall'],label:'My observed map',
  region_labels:{'ground-entry-hall':'Entry hall'},level_labels:{'Ground Floor':'Ground Floor'},why:'Seen through the entrance.'}]);
 const job=await game.call('mods.job',{role:'create',input:{name:draft.name,category:'item',description:draft.description}});
 const request=JSON.parse(await readFile(join(job.cwd,'request.json'),'utf8'));
 assert.equal(request.known_handouts.filter(row=>row.name===handout&&row.image===true).length,1);
 assert.deepEqual(job.document_sources,[{name:handout,map:'player-corbitt-house-map'}]);
 assert.equal(JSON.stringify(request.known_handouts).includes('render'),false,'creator source names do not expose rendering inputs');
 assert.equal(Object.values((await game.world()).objects.instances).some(item=>item.document),false);
 await writeFile(join(job.cwd,'result.json'),JSON.stringify({...draft,document:{handout,presentation:'image'}}));
 await assert.rejects(game.call('mods.accept',{job:job.job}),/must be rendered/);
 const events=new EventEmitter(),entries=[],attempts=[],calls=[];let bridge;
 const pi={events,on(){},appendEntry:(customType,data)=>entries.push({customType,data})};
 events.on('coc:mods-bridge',value=>{bridge=value;});modsExtension(pi);
 events.emit('coc:kernel-bridge',{async call(method,params){
  calls.push({method,params});
  try{return await game.call(method,JSON.parse(JSON.stringify(params)));}
  catch(error){if(typeof error.code==='string')throw new KernelError({code:error.code,message:error.message,fix:error.fix,details:error.details});throw error;}
 },mintCallId:()=>game.next(),runtime:{home:game.home,
  async runTask(task){attempts.push(task.request.brief);await writeFile(join(task.request.cwd,'result.json'),JSON.stringify({...draft,document:{handout:`  ${handout.toUpperCase().replaceAll(' ','   ')}  `,presentation:'image'}}));return {ok:true,code:0,timedOut:false,ms:1,stderr:'',command:[]};},
  async check(){return {ok:true};}
 }});
 const payload={campaign:'c1',effects:[{kind:'define',name:draft.name,category:'item',description:draft.description},
  {kind:'object',name:'Observed map image',definition:draft.name,to:game.sheet.name,why:'I keep a copy of the view I hold.'}]};
 await bridge.prepare('apply',payload);await game.apply(payload.effects);
 const before=Object.values((await game.world()).objects.instances).find(item=>item.name==='Observed map image');assert.ok(before);
 try{await waitFor(()=>entries.some(entry=>entry.customType==='coc-object-details'),{label:'masked image creator accepted'});}
 catch(error){throw new Error(`${error.message}\nCreator attempts: ${JSON.stringify(attempts)}\nBridge calls: ${JSON.stringify(calls)}\nEntries: ${JSON.stringify(entries)}`,{cause:error});}
 assert.equal(attempts.length,1,'the host warms the map before the first acceptance');
 assert.ok(calls.some(call=>call.method==='table.look'&&call.params.focus==='map'&&call.params.name==='player-corbitt-house-map'));
 await game.call('table.narrate',{call_id:game.next(),text:'You retain the entrance view.'});
 await game.call('table.player_input',{text:'I open my observed map.'});await bridge.after('player_input',{campaign:'c1'});
 const after=Object.values((await game.world()).objects.instances).find(item=>item.name==='Observed map image');
 assert.equal(after.id,before.id);
 const view=await game.call('mods.document.view',{actor:game.sheet.id,name:after.name});assert.equal(view.editing,'read_only');
 const retained=await readFile(view.image.path);assert.notDeepEqual(retained,await readFile(path));
 const image=await loadImage(retained),output=createCanvas(image.width,image.height),out=output.getContext('2d');out.drawImage(image,0,0);
 const pixels=out.getImageData(0,0,image.width,image.height).data;let red=0,blue=0;
 for(let i=0;i<pixels.length;i+=4){if(pixels[i]>200&&pixels[i+2]<40)red++;if(pixels[i+2]>200&&pixels[i]<40)blue++;}
 assert.ok(red>0);assert.equal(blue,0,'unknown living-room pixels cannot become an image item');
 await writeFile(path,PNG);assert.deepEqual(await readFile(view.image.path),retained,'an acquired snapshot is immutable');
});

test('a document carrier accepts the same revealed handout reference as display without bypassing disclosure',async t=>{
 const game=await pictured(t),source='handout-the-haunting-corbitt-house-investigator-map';
 const document={handout:source,presentation:'image'};
 await assert.rejects(game.apply([{kind:'object',name:'Unrevealed copy',to:game.sheet.name,document}]),/already revealed/);
 const definition=await accept(game,{...draft,name:'Paper carrier',document:undefined});
 await game.apply([{kind:'define',name:'Paper carrier',category:'item',_definition:definition.definition,_provenance:definition.provenance},
  {kind:'handout',name:source},
  {kind:'object',name:'Issued reference copy',definition:'Paper carrier',to:game.sheet.name,document,why:'Take the document that was just handed over.'}]);
 const view=await game.call('mods.document.view',{actor:game.sheet.id,name:'Issued reference copy'});
 assert.equal(view.editing,'read_only');assert.deepEqual(await readFile(view.image.path),PNG);
 await assert.rejects(game.apply([{kind:'object',name:'Unknown copy',to:game.sheet.name,document:{handout:'nonexistent-handout',presentation:'image'}}]),/already revealed/);
});
