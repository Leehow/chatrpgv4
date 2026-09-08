/** Module-owned, reviewed guidance shared by character creation sessions. */
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {dirname, join, resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runReader, type ReaderRequest, type ReaderOutcome} from './reader.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const promptPath = join(root, 'content/setup/character-guidance.md');
const reviewPath = join(root, 'content/setup/character-guidance-review.md');
type Row = Record<string, any>;
export type Guidance = {opening:string; advice:string; scene:string; guide:string; handoff:string};
type Options = {home:string; module_id:string; play_language:string; opening?:string;
  occupations:Array<{id:string; name:string}>; model?:string; thinking?:string; signal?:AbortSignal;
  runner?:(request:ReaderRequest)=>Promise<ReaderOutcome>};
const digest = (value:string) => createHash('sha256').update(value).digest('hex');
function text(value:unknown, empty=false):string {
  if(typeof value !== 'string' || (!empty && !value.trim()) || value.length>4000) throw new Error('Invalid character guidance text');
  return value;
}
export function validateGuidance(value:Row, _occupations?:Options['occupations']):Guidance {
  if(!value || typeof value!=='object')throw new Error('Invalid character guidance');
  return {opening:text(value.opening),advice:text(value.advice),scene:text(value.scene),guide:text(value.guide,true),handoff:text(value.handoff)};
}
async function json(path:string) {
  const raw=await readFile(path,'utf8');
  if(Buffer.byteLength(raw)>64*1024)throw new Error('Character guidance exceeds the file limit');
  return JSON.parse(raw);
}
export async function prepareCharacterGuidance(options:Options):Promise<Guidance> {
  if(options.signal?.aborted)throw new Error('Character guidance cancelled');
  if(!/^[a-z0-9-]{1,64}$/.test(options.module_id))throw new Error('Invalid module');
  if(!['zh-Hans','en'].includes(options.play_language))throw new Error('Invalid play language');
  const folder=resolve(options.home,'.coc/modules',options.module_id);
  const meta=JSON.parse(await readFile(join(folder,'module.json'),'utf8'));
  const graphPath=resolve(folder,meta.graph_file || 'module-graph.json');
  const rel=relative(folder,graphPath);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('Module graph escapes its store');
  const graphBytes=await readFile(graphPath,'utf8');
  const [prompt,reviewPrompt]=await Promise.all([readFile(promptPath,'utf8'),readFile(reviewPath,'utf8')]);
  const selectedOpening=options.opening || meta.opening_choice?.start_scene || meta.opening?.start_scene || '';
  const key=digest(JSON.stringify([graphBytes,selectedOpening,options.play_language,options.occupations,prompt,reviewPrompt]));
  const cache=join(folder,'character-guidance',key);
  try {
    const saved=await json(join(cache,'accepted.json'));
    if(saved.fingerprint===key && saved.approved===true)return validateGuidance(saved.guidance,options.occupations);
  } catch { /* A missing or invalid cache is rebuilt; attempts remain on disk. */ }
  if(options.signal?.aborted)throw new Error('Character guidance cancelled');
  const attempt=join(cache,'attempts',randomUUID());
  await mkdir(attempt,{recursive:true});
  const graph=JSON.parse(graphBytes);
  // Only semantic names and prose enter the model packet; opaque graph keys stay host-side.
  const nodes=(graph.nodes||[]).map((node:Row)=>({name:node.name,kind:node.node_kind,
    visibility:node.visibility,summary:node.summary}));
  const opening=(graph.nodes||[]).find((node:Row)=>node.node_id===selectedOpening||node.name===selectedOpening)?.name;
  const publicFields=['era','place','player_safe_summary','investigator_hook','investigator_constraints'];
  const publicSetup=(graph.nodes||[]).filter((node:Row)=>node.node_kind==='module').flatMap((node:Row)=>{
    const authored=[node.properties||{},...(node.properties?.runtime_projection?.documents||[])
      .filter((doc:Row)=>doc.filename==='module-meta.json').map((doc:Row)=>doc.root)];
    return authored.map((record:Row)=>Object.fromEntries(publicFields.filter(key=>typeof record[key]==='string').map(key=>[key,record[key]])));
  });
  const packet={public_setup:publicSetup,play_language:options.play_language,opening:opening||null,nodes,
    occupations:options.occupations.map(row=>({name:row.name}))};
  await writeFile(join(attempt,'packet.json'),JSON.stringify(packet,null,2));
  await writeFile(join(attempt,'author-prompt.md'),prompt);
  await writeFile(join(attempt,'review-prompt.md'),reviewPrompt);
  const runner=options.runner||runReader;
  const request={cwd:attempt,model:options.model,thinking:options.thinking,signal:options.signal};
  let guidance: Guidance | undefined;
  let review: Row = {approved:false,issues:[]};
  for(let round=1;round<=2;round++) {
    await writeFile(join(attempt,'packet.json'),JSON.stringify(packet,null,2));
    const authored=await runner({...request,systemPrompt:promptPath,eventLog:join(attempt,'author.jsonl'),
      brief:round===1?'Read packet.json and write guidance.json according to your instructions.':
        'Revise guidance.json using the independent review findings in review.json. Preserve source facts and obey the original instructions.'});
    if(!authored.ok||options.signal?.aborted)throw new Error('Character guidance could not be prepared. Retry preparation.');
    guidance=validateGuidance(await json(join(attempt,'guidance.json')),options.occupations);
    await writeFile(join(attempt,'guidance.json'),JSON.stringify(guidance,null,2));
    await writeFile(join(attempt,`guidance-round-${round}.json`),JSON.stringify(guidance,null,2));
    await writeFile(join(attempt,'packet.json'),JSON.stringify(packet,null,2));
    const reviewed=await runner({...request,systemPrompt:reviewPath,eventLog:join(attempt,'reviewer.jsonl'),
      brief:'Independently review packet.json and guidance.json. Write review.json.'});
    if(!reviewed.ok||options.signal?.aborted)throw new Error('Character guidance review interrupted. Retry preparation.');
    review=await json(join(attempt,'review.json'));
    await writeFile(join(attempt,`review-round-${round}.json`),JSON.stringify(review,null,2));
    if(JSON.stringify(validateGuidance(await json(join(attempt,'guidance.json')),options.occupations))!==JSON.stringify(guidance))throw new Error('Character guidance changed during review');
    if(review.approved===true && Array.isArray(review.issues) && !review.issues.length)break;
  }
  if(review.approved!==true||!Array.isArray(review.issues)||review.issues.length)throw new Error('Character guidance needs revision. Retry preparation.');
  const pending=join(cache,randomUUID()+'.tmp');
  await writeFile(pending,JSON.stringify({fingerprint:key,approved:true,guidance},null,2));
  await rename(pending,join(cache,'accepted.json'));
  return guidance;
}
