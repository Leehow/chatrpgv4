/** Module-owned, reviewed guidance shared by character creation sessions. */
import {createHash, randomUUID} from 'node:crypto';
import {access, mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {join, resolve, relative, isAbsolute} from 'node:path';
import {resourceRootFrom} from '../../runtime/deployment.mjs';
import {coded} from '../ui/errors.ts';
import {reasoned, readerFailureReason} from './reader.ts';
import type {ReaderRequest, ReaderOutcome} from './reader.ts';

const root = resourceRootFrom(import.meta.url);
type Row = Record<string, any>;
export const SETUP_GUIDANCE_REFERENCE_PROTOCOL='setup-guidance-reference-v2' as const;
/**
 * The play language is open (contract section 23): a tag is accepted by shape alone, the same
 * BCP-47 shape the kernel's `validSourceLanguage` checks, and never looked up in a list.
 */
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
/** Whether the starter ships a reviewed bundle for `tag`: the file `character-guidance/<tag>.json` exists, fresh or stale. */
async function bundleShipped(content:string, moduleId:string, tag:string):Promise<boolean> {
  try { await access(join(content,'starters',moduleId,'character-guidance',`${tag}.json`)); return true; }
  catch { return false; }
}
export type Guidance = {opening:string; advice:string; scene:string; guide:string; handoff:string};
type Options = {home:string; contentRoot?:string; module_id:string; play_language:string; opening?:string;
  buildBundle?:boolean;
  occupations:Array<{id:string; name:string}>; model?:string; thinking?:string; signal?:AbortSignal;
  runner?:(request:ReaderRequest)=>Promise<ReaderOutcome>};
const digest = (value:string) => createHash('sha256').update(value).digest('hex');
// Graph identity aliases are closed authored identifiers, not semantic guesses.
function openingNode(graph:Row, meta:Row, selected?:string):Row|undefined {
  const value=selected || meta.opening_choice?.start_scene || meta.opening?.start_scene || '';
  const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[_\s-]+/g,' ').trim();
  return (graph.nodes||[]).find((node:Row)=>{
    if(node.node_kind!=='scene')return false;
    const record=node.properties?.runtime_projection?.record || node.properties || {};
    const handle=record.scene_id || node.node_id?.replace(/^scene-/, '');
    return [node.node_id,node.name,handle,...(node.aliases||[]),record.display_name,record.name,record.title]
      .some(alias=>typeof alias==='string' && normalize(alias)===normalize(value));
  });
}
const recordOf=(node:Row):Row=>node.properties?.runtime_projection?.record || node.properties || {};
const identities=(node:Row):string[]=>[node.node_id,node.name,recordOf(node).npc_id,recordOf(node).handle]
  .filter((value):value is string=>typeof value==='string');
function openingGuideNodes(graph:Row, scene:Row|undefined):Row[] {
  if(!scene)return [];
  const ids=new Set<string>();
  for(const relation of Array.isArray(graph.relations)?graph.relations:[])if(relation?.relation_kind==='present-in'&&relation.to_node_id===scene.node_id&&typeof relation.from_node_id==='string')ids.add(relation.from_node_id);
  for(const id of Array.isArray(recordOf(scene).npc_ids)?recordOf(scene).npc_ids:[])if(typeof id==='string')ids.add(id);
  return (Array.isArray(graph.nodes)?graph.nodes:[]).filter((node:Row)=>node.node_kind==='npc'&&typeof node.name==='string'&&node.name.trim()&&identities(node).some(id=>ids.has(id)));
}
type GuideSource={alias:string;name:string;summary?:string};
function guideSources(graph:Row,scene:Row|undefined):GuideSource[] {
  return openingGuideNodes(graph,scene).map((node,index)=>({alias:`guide:${index}`,name:node.name,
    ...(typeof node.summary==='string'&&node.summary.trim()?{summary:node.summary}:{})}));
}
export async function guidanceFingerprint(options:Options):Promise<string> {
  const content = options.contentRoot ?? join(root, 'content');
  const folder=resolve(options.home,'.coc/modules',options.module_id);
  const meta=JSON.parse(await readFile(join(folder,'module.json'),'utf8'));
  const prompts=await Promise.all([join(content,'setup/character-guidance.md'),join(content,'setup/character-guidance-review.md'),...(meta.file_sha256?[join(content,'setup/visual-guidance.md')]:[])].map(path=>readFile(path,'utf8')));
  const bytes=await readFile(join(folder,meta.graph_file||'module-graph.json'),'utf8');
  const graph=JSON.parse(bytes),scene=openingNode(graph,meta,options.opening);
  const source=meta.file_sha256 || digest(bytes);
  const binding={protocol:SETUP_GUIDANCE_REFERENCE_PROTOCOL,scene:scene?{node:scene.node_id,name:scene.name}:null,
    guides:openingGuideNodes(graph,scene).map(node=>({node:node.node_id,name:node.name}))};
  return digest(JSON.stringify([source,binding,options.play_language,options.occupations,prompts]));
}
export async function acceptedGuidance(home:string,moduleId:string,key:string):Promise<Guidance> {
  if(!/^[a-f0-9]{64}$/.test(key))throw coded('invalid_params','Invalid guidance reference');
  const folder=resolve(home,'.coc/modules',moduleId);
  const meta=JSON.parse(await readFile(join(folder,'module.json'),'utf8'));
  const saved=await json(join(folder,'character-guidance',key,'accepted.json'));
  if(saved.fingerprint!==key||saved.approved!==true||
    (meta.reading_version && meta.source !== 'starter' && !meta.character_guidance?.[key]))throw coded('guidance_not_ready','Guidance has not been accepted');
  return validateGuidance(saved.guidance);
}
function text(value:unknown, empty=false):string {
  if(typeof value !== 'string' || (!empty && !value.trim()) || value.length>4000) throw coded('guidance_unavailable','Invalid character guidance text');
  return value;
}
export function validateGuidance(value:Row, _occupations?:Options['occupations']):Guidance {
  if(!value || typeof value!=='object')throw coded('guidance_unavailable','Invalid character guidance');
  return {opening:text(value.opening),advice:text(value.advice),scene:text(value.scene),guide:text(value.guide,true),handoff:text(value.handoff)};
}
export function validateGuidanceReference(value:Row,scene:string,guides:GuideSource[]):Guidance {
  if(!value||typeof value!=='object'||Array.isArray(value)||value.protocol!==SETUP_GUIDANCE_REFERENCE_PROTOCOL||
    Object.keys(value).sort().join(',')!=='advice,guide,handoff,opening,protocol')throw coded('guidance_unavailable','Invalid character guidance');
  const selected=value.guide;
  if(selected!==null&&typeof selected!=='string')throw coded('guidance_unavailable','Invalid character guidance guide selection');
  if(guides.length ? !guides.some(guide=>guide.alias===selected) : selected!==null)
    throw coded('guidance_unavailable','Invalid character guidance guide selection');
  return {opening:text(value.opening),advice:text(value.advice),scene:text(scene),
    guide:selected===null?'':guides.find(guide=>guide.alias===selected)!.name,handoff:text(value.handoff)};
}
async function json(path:string) {
  const raw=await readFile(path,'utf8');
  if(Buffer.byteLength(raw)>64*1024)throw coded('guidance_unavailable','Character guidance exceeds the file limit');
  return JSON.parse(raw);
}
export async function prepareCharacterGuidance(options:Options):Promise<Guidance> {
  const content = options.contentRoot ?? join(root, 'content');
  const promptPath = join(content, 'setup/character-guidance.md');
  const reviewPath = join(content, 'setup/character-guidance-review.md');
  if(options.signal?.aborted)throw coded('interrupted','Character guidance cancelled');
  if(!/^[a-z0-9-]{1,64}$/.test(options.module_id))throw coded('invalid_params','Invalid module');
  if(typeof options.play_language!=='string'||!LANGUAGE_TAG.test(options.play_language))throw coded('invalid_params','Invalid play language: name it as a BCP-47 language tag such as pt-BR');
  const folder=resolve(options.home,'.coc/modules',options.module_id);
  const meta=JSON.parse(await readFile(join(folder,'module.json'),'utf8'));
  const graphPath=resolve(folder,meta.graph_file || 'module-graph.json');
  const rel=relative(folder,graphPath);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw coded('invalid_params','Module graph escapes its store');
  const graphBytes=await readFile(graphPath,'utf8');
  const [prompt,reviewPrompt]=await Promise.all([readFile(promptPath,'utf8'),readFile(reviewPath,'utf8')]);
  const selectedOpening=options.opening || meta.opening_choice?.start_scene || meta.opening?.start_scene || '';
  const key=await guidanceFingerprint(options);
  const cache=join(folder,'character-guidance',key);
  if(meta.character_guidance?.[key])return acceptedGuidance(options.home,options.module_id,key);
  try {
    const saved=await json(join(cache,'accepted.json'));
    if(saved.fingerprint===key && saved.approved===true && !saved.draft_sha256)return validateGuidance(saved.guidance,options.occupations);
  } catch { /* A missing or invalid cache is rebuilt; attempts remain on disk. */ }
  // A listed starter ships reviewed bundles for the tags it has them for. A bundle that exists for
  // this tag but was not accepted above is stale and is never regenerated during selection; a tag
  // the starter ships no bundle for generates its guidance per campaign, as a PDF module does.
  if(meta.bundled_guidance_required && !options.buildBundle && await bundleShipped(content,options.module_id,options.play_language))
    throw coded('guidance_not_ready','Bundled starter guidance for this language is stale. Rebuild the starter guidance bundle.');
  if(options.signal?.aborted)throw coded('interrupted','Character guidance cancelled');
  const attempt=join(cache,'attempts',randomUUID());
  await mkdir(attempt,{recursive:true});
  const graph=JSON.parse(graphBytes);
  // Only semantic names and prose enter the model packet; opaque graph keys stay host-side.
  const nodes=(graph.nodes||[]).map((node:Row)=>({name:node.name,kind:node.node_kind,
    visibility:node.visibility,summary:node.summary}));
  const selectedScene=openingNode(graph,meta,selectedOpening);
  if(!selectedScene||typeof selectedScene.name!=='string'||!selectedScene.name.trim())throw coded('preparation_failed','The selected opening scene is unavailable for character guidance');
  const opening=selectedScene.name,guides=guideSources(graph,selectedScene);
  const publicFields=['era','place','player_safe_summary','investigator_hook','investigator_constraints'];
  const publicSetup=(graph.nodes||[]).filter((node:Row)=>node.node_kind==='module').flatMap((node:Row)=>{
    const authored=[node.properties||{},...(node.properties?.runtime_projection?.documents||[])
      .filter((doc:Row)=>doc.filename==='module-meta.json').map((doc:Row)=>doc.root)];
    return authored.map((record:Row)=>Object.fromEntries(publicFields.filter(key=>typeof record[key]==='string').map(key=>[key,record[key]])));
  });
  const packet={protocol:SETUP_GUIDANCE_REFERENCE_PROTOCOL,public_setup:publicSetup,play_language:options.play_language,opening,guides,nodes,
    occupations:options.occupations.map(row=>({name:row.name}))};
  await writeFile(join(attempt,'packet.json'),JSON.stringify(packet,null,2));
  await writeFile(join(attempt,'author-prompt.md'),prompt);
  await writeFile(join(attempt,'review-prompt.md'),reviewPrompt);
  const runner=options.runner;
  if(!runner)throw coded('preparation_failed','Character guidance requires its owner runtime');
  const request={cwd:attempt,model:options.model,thinking:options.thinking,signal:options.signal};
  let guidance: Guidance | undefined,rawGuidance:Row|undefined;
  let review: Row = {approved:false,issues:[]};
  for(let round=1;round<=2;round++) {
    await writeFile(join(attempt,'packet.json'),JSON.stringify(packet,null,2));
    const authored=await runner({...request,systemPrompt:promptPath,eventLog:join(attempt,'author.jsonl'),
      brief:round===1?'Read packet.json and write guidance.json according to your instructions.':
        'Revise guidance.json using the independent review findings in review.json. Preserve source facts and obey the original instructions.'});
    if(!authored.ok||options.signal?.aborted)throw coded(options.signal?.aborted?'interrupted':'preparation_failed',
      reasoned('Character guidance could not be prepared. Retry preparation.',options.signal?.aborted?undefined:readerFailureReason(authored)));
    rawGuidance=await json(join(attempt,'guidance.json'));
    guidance=validateGuidanceReference(rawGuidance,opening,guides);
    await writeFile(join(attempt,'guidance.json'),JSON.stringify(rawGuidance,null,2));
    await writeFile(join(attempt,`guidance-round-${round}.json`),JSON.stringify(rawGuidance,null,2));
    await writeFile(join(attempt,'packet.json'),JSON.stringify(packet,null,2));
    const reviewed=await runner({...request,systemPrompt:reviewPath,eventLog:join(attempt,'reviewer.jsonl'),
      brief:'Independently review packet.json and guidance.json. Write review.json.'});
    if(!reviewed.ok||options.signal?.aborted)throw coded(options.signal?.aborted?'interrupted':'preparation_failed','Character guidance review interrupted. Retry preparation.');
    review=await json(join(attempt,'review.json'));
    await writeFile(join(attempt,`review-round-${round}.json`),JSON.stringify(review,null,2));
    if(JSON.stringify(await json(join(attempt,'guidance.json')))!==JSON.stringify(rawGuidance))throw coded('preparation_failed','Character guidance changed during review');
    if(review.approved===true && Array.isArray(review.issues) && !review.issues.length)break;
  }
  if(review.approved!==true||!Array.isArray(review.issues)||review.issues.length)throw coded('preparation_failed','Character guidance needs revision. Retry preparation.');
  const pending=join(cache,randomUUID()+'.tmp');
  await writeFile(pending,JSON.stringify({fingerprint:key,approved:true,guidance},null,2));
  await rename(pending,join(cache,'accepted.json'));
  return guidance;
}
