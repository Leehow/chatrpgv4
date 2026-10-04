/** Installs exact-source context through the existing module generation owner. */
import{join,relative,dirname}from'node:path';
import{readFile}from'node:fs/promises';
import{sha256File,writeJsonAtomic}from'../fileio.js';
import{RpcError}from'../errors.js';
import{array,row,string,number,normalize,type Row}from'../read/values.js';
import{ModuleStore}from'./store.js';
import{inside,resolvedPath}from'./paths.js';
import{assembleVisual,applyOpeningChoice,resolveStartScene}from'./visual.js';
import{validateReferencePacket,referenceEntryExcerpt,SOURCE_REFERENCE_PROTOCOL}from'./reference-contract.js';
import{validatePublicGuidance}from'./public-guidance.js';
import{validSourceLanguage}from'./contract.js';
import{nowIso}from'../write/store.js';
const fail=(message:string):never=>{throw new RpcError('invalid_params',message)};
export async function publishReferenceContext(store:ModuleStore,meta:Row,params:Row):Promise<Row>{
 const mid=string(meta.id),root=await resolvedPath(store.moduleDir(mid)),work=await resolvedPath(string(params.work_dir));
 if(!inside(await resolvedPath(join(root,'work')),work))fail('Reference work must belong to the bound source');
 if(meta.source!=='pdf'||!validSourceLanguage(params.play_language)||typeof params.guidance_key!=='string'||!/^[a-f0-9]{64}$/.test(params.guidance_key))fail('Invalid reference guidance binding');
 const packetPath=join(work,'source-reference.json'),receiptPath=join(work,'source-reference-complete.json'),textPath=join(work,'reference-guidance.txt');
 for(const file of [packetPath,receiptPath,textPath,join(work,'task.json')])if(!inside(work,await resolvedPath(file)))fail('Reference artifact escaped its host task');
 const receipt=row(await store.context.snapshots.readJson(receiptPath)),packet=validateReferencePacket(JSON.parse(await readFile(packetPath,'utf8')),number(meta.page_count),string(meta.file_sha256));
 if(receipt.protocol!==SOURCE_REFERENCE_PROTOCOL||receipt.kind!=='guidance'||receipt.source_sha256!==meta.file_sha256||receipt.packet_sha256!==await sha256File(packetPath)||receipt.text_sha256!==await sha256File(textPath)||receipt.task_sha256!==await sha256File(join(work,'task.json')))fail('Reference receipt does not match the final artifacts');
 if(receipt.checks_policy!=='material-issues-v1')fail('Unknown source guidance check policy');
 for(const key of ['wrong_orientation','card_restriction','advice_omission','warning_omission','plot_disclosure','causal_conflict'])if(row(row(receipt.checks)[key]).status!=='answered'||number(row(row(receipt.checks)[key]).noul)>=.8)fail('Public source guidance contains an unresolved material issue');
 const text=await readFile(textPath,'utf8');if(!text.trim()||text.length>4000||!packet.entries.length)fail('Reference guidance is incomplete');
 const publicFields=validatePublicGuidance(receipt.public_fields,number(meta.page_count));
 for(const field of Object.values(publicFields))if(field.status==='value'&&!text.includes(field.text))fail('Public fields must be views of the same final guide');
 const previous=await store.readGraph(mid),contract=await store.contract();
 const entries=packet.entries,bindings:Row={};
 for(const entry of entries){
  const scenes=array(previous?.nodes).filter(node=>node.node_kind==='scene');
  const named=scenes.filter(node=>[node.node_id,node.name,...array(node.aliases)].some(name=>normalize(name)===normalize(entry.name)||name===entry.id));
  const samePage=scenes.filter(node=>(row(node.properties).is_entrance||array(previous?.entry_scene_ids).includes(node.node_id))&&array(node.source_refs).some(ref=>ref.source_id===`pdf:${mid}`&&number(ref.pdf_index)+1===entry.page));
  const old=named.length===1?named[0]:!named.length&&samePage.length===1?samePage[0]:undefined;
  bindings[entry.id]={node_id:old?.node_id??entry.id,name:old?.name??entry.name};
 }
 const entryIds=entries.map(entry=>bindings[entry.id].node_id);
 const nodes:Row[]=previous?[]:[{node_id:`module-${mid}`,node_kind:'module',name:meta.title,visibility:'keeper-only',properties:{entry_scene_ids:entryIds,
  ...(entries.length===1&&entries[0].era_text?{era:entries[0].era_text}:{})},source_refs:[{page:entries[0].page}]}];
 for(const entry of entries){const excerpt=referenceEntryExcerpt(packet,entry);
  if(array(previous?.nodes).some(node=>node.node_id===bindings[entry.id].node_id))continue;
  nodes.push({node_id:entry.id,node_kind:'scene',name:entry.name,summary:excerpt?.text??'',visibility:'keeper-only',source_refs:[{page:entry.page}],
   properties:{is_entrance:true,source_reference_anchor:true,...(entry.era_text?{investigator_setup:{era:entry.era_text}}:{})}});}
 const graph=assembleVisual(previous,{nodes,claims:[],node_refs:[],ready_nodes:[],critical:[],required_review:[],coverage:{},dependencies:[],review_policy:'module-logic-v1'},meta,contract);
 const requested=string(params.start_scene??''),priorChoice=string(row(meta.opening_choice).start_scene??'');
 const chosen=requested?resolveStartScene(graph,requested,contract):entryIds.includes(priorChoice)?priorChoice:entries.length===1?entryIds[0]:null;
 if(requested&&!chosen)fail('Selected opening is not in the bound original context');
 if(chosen&&!entryIds.includes(chosen))fail('Selected opening has no bound original reference');
 if(chosen)applyOpeningChoice(graph,chosen,contract);
 const packetFile=join('source-references',String(receipt.packet_sha256),'packet.json');await writeJsonAtomic(join(root,packetFile),packet);
 // The stored representation is canonical JSON, so its persisted digest is measured after writing.
 const packetDigest=await sha256File(join(root,packetFile));
 meta.source_reference={protocol:SOURCE_REFERENCE_PROTOCOL,source_sha256:meta.file_sha256,packet_file:packetFile,packet_sha256:packetDigest,entry_ids:entryIds,entry_bindings:bindings,at:nowIso()};
 meta.reading??={};meta.reading.materials=array(meta.reading.materials).filter(item=>item.key!=='source-reference:'+meta.file_sha256);
 meta.reading.materials.push({key:'source-reference:'+meta.file_sha256,purpose:'reference-context',reference_only:true,node_ids:entryIds,generation:number(meta.generation)+1});
 if(!previous){meta.reading.state='preparing';meta.status='assembled';meta.opening_ready=false;meta.opening=await store.opening(graph);meta.opening.opening_ready=false;}
 if(chosen)meta.opening_choice={start_scene:chosen,at:nowIso()};
 await store.writeGraph(meta,graph);
 let guidance:Row|undefined;
 if(chosen){const entry=entries.find(entry=>bindings[entry.id].node_id===chosen)??fail('Selected opening has no original reference');
  const span=referenceEntryExcerpt(packet,entry),excerpts=span?`[Original physical page ${span.page}]\n${span.text}`:'';
  guidance={opening:text,advice:text,scene:bindings[entry.id].name,guide:'',handoff:'Use the bound original source as reference while graph fragments arrive. Original context (private):\n'+excerpts};
  const folder=join(root,'character-guidance',params.guidance_key);
  await writeJsonAtomic(join(folder,'accepted.json'),{fingerprint:params.guidance_key,approved:true,guidance,source_sha256:meta.file_sha256,source_reference:meta.source_reference,at:nowIso()});
  await writeJsonAtomic(join(folder,'public.json'),{fingerprint:params.guidance_key,approved:true,fields:publicFields,source_sha256:meta.file_sha256});
  meta.character_guidance??={};meta.character_guidance[params.guidance_key]={scene:guidance.scene,play_language:params.play_language,source_reference:true};
 }
 await store.writeModule(meta);
 const candidates=await store.candidates(graph);
 return {module_id:mid,state:chosen?'ready':'blocked',setup_ready:!!chosen,reference_ready:!!chosen,graph_complete:false,guidance_key:params.guidance_key,
  ...(guidance?{guidance,scene:guidance.scene}:{opening:{choice:{candidates}},introduction:text}),public_fields:publicFields,generation:meta.generation};
}
export async function referenceReady(store:ModuleStore,mid:string,focus=''):Promise<boolean>{
 const meta=await store.module(mid),ref=row(meta.source_reference);
 if(ref.protocol!==SOURCE_REFERENCE_PROTOCOL||ref.source_sha256!==meta.file_sha256||typeof ref.packet_file!=='string')return false;
 try{const file=await resolvedPath(join(store.moduleDir(mid),ref.packet_file));if(!inside(await resolvedPath(store.moduleDir(mid)),file)||await sha256File(file)!==ref.packet_sha256)return false;
  const packet=validateReferencePacket(JSON.parse(await readFile(file,'utf8')),number(meta.page_count),string(meta.file_sha256));
  const wanted=focus||string(row(meta.opening_choice).start_scene??'')||(packet.entries.length===1?packet.entries[0].id:'');
  return packet.entries.some(entry=>{const bound=row(row(ref.entry_bindings)[entry.id]);return [entry.id,entry.id.replace(/^scene-/,''),entry.name,bound.node_id,string(bound.node_id??'').replace(/^scene-/,''),bound.name].some(value=>typeof value==='string'&&value.trim()&&normalize(value)===normalize(wanted));});
 }catch{return false;}
}
/** The scene a source place names in `graph`: by its name, an alias or its own id. §184.5's merge asks it of the library. */
export function placeScene(graph:Row|null,place:{id:string;name:string}):Row|undefined{
 return array(graph?.nodes).find(node=>node.node_kind==='scene'&&[node.node_id,node.name,...array(node.aliases)].some(value=>normalize(value)===normalize(place.name)||value===place.id));
}
/** Publish a requested source place's minimum typed identity, leaving enrichment asynchronous. */
export async function publishReferencePlace(store:ModuleStore,meta:Row,params:Row):Promise<Row>{
 if(meta.source!=='pdf')fail('Direct reference materialization requires a bound original PDF');
 const mid=string(meta.id),root=await resolvedPath(store.moduleDir(mid)),work=await resolvedPath(string(params.work_dir));
 if(!inside(await resolvedPath(join(root,'work')),work))fail('Reference work must belong to the bound source');
 const packetPath=join(work,'source-reference.json'),receiptPath=join(work,'source-reference-complete.json'),taskPath=join(work,'task.json');
 for(const file of [packetPath,receiptPath,taskPath])if(!inside(work,await resolvedPath(file)))fail('Reference artifact escaped its task');
 const receipt=row(await store.context.snapshots.readJson(receiptPath)),task=row(await store.context.snapshots.readJson(taskPath));
 if(receipt.protocol!==SOURCE_REFERENCE_PROTOCOL||receipt.kind!=='excerpts'||task.materialize_place!==true||receipt.source_sha256!==meta.file_sha256||receipt.packet_sha256!==await sha256File(packetPath)||receipt.task_sha256!==await sha256File(taskPath))fail('Source place receipt does not match its original task');
 const packet=validateReferencePacket(JSON.parse(await readFile(packetPath,'utf8')),number(meta.page_count),string(meta.file_sha256));
 if(!packet.places?.length)return {state:'unavailable'};
 const graph=await store.readGraph(mid);if(!graph)fail('The source graph is unavailable');
 const place=packet.places[0],old=placeScene(graph,place);
 if(old&&array(row(meta.reading).materials).some(material=>array(material.node_ids).includes(old.node_id)))return {state:'ready',scene:old.node_id,name:old.name,reused:true};
 const identity=old?.node_id??place.id;
 const node={node_id:place.id,node_kind:'scene',name:place.name,visibility:'keeper-only',summary:packet.excerpts.filter(span=>span.page===place.page).map(span=>span.text).join(''),source_refs:[{page:place.page}],properties:{source_reference_anchor:true}};
 const merged=old?graph!:assembleVisual(graph,{nodes:[node],claims:[],node_refs:[],ready_nodes:[],critical:[],required_review:[],coverage:{},dependencies:[],review_policy:'module-logic-v1'},meta,await store.contract());
 const file=join('source-references',String(receipt.packet_sha256),'packet.json');await writeJsonAtomic(join(root,file),packet);
 meta.reading??={};meta.reading.materials??=[];meta.reading.materials.push({key:'source-place:'+identity,purpose:'reference-context',reference_only:true,node_ids:[identity],packet_file:file,packet_sha256:await sha256File(join(root,file)),generation:number(meta.generation)+1});
 await store.writeGraph(meta,merged);await store.writeModule(meta);
 return {state:'ready',scene:identity,name:old?.name??place.name,reference_ready:true,graph_complete:false};
}
