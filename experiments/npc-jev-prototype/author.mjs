/** Throwaway tool-enabled Pi author. Outputs are diagnostic fiction, not campaign facts. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const HERE=path.dirname(fileURLToPath(import.meta.url)), ROOT=path.resolve(HERE,'../..');
const [mode, destination]=process.argv.slice(2);
if(!['personas','render'].includes(mode)||!destination)throw new Error('Usage: node author.mjs personas|render <artifact-directory>');
const dir=path.resolve(destination);await fs.mkdir(dir,{recursive:true});
const file=mode==='personas'?'personas.json':'performances.json';
try{await fs.access(path.join(dir,file));throw new Error('Output exists; use a fresh directory or reuse the accepted output');}catch(e){if(e.code!=='ENOENT')throw e;}
const bank=JSON.parse(await fs.readFile(path.join(HERE,'inputs.json'),'utf8'));
if(mode==='personas')await fs.writeFile(path.join(dir,'input.json'),JSON.stringify({personas:bank.personas},null,2));
const system=`You are a tool-enabled fiction author for an isolated NPC architecture prototype, not a campaign Keeper or player. This is authored diagnostic content and not live gameplay. Only read input.json in this directory. Do not access parent files, credentials, evaluation labels, networks, other runs or repository configuration. Use read to inspect the input, then write the requested JSON artifact with write; read/write/edit/bash are available. Do not call any model through bash. Do not create scripts that fabricate tool or game evidence. Write prose in the input language. Preserve source facts and uncertainty. Invent only where explicitly permitted. Do not generate identifiers: copy only the short provided semantic ids. Do not add schema fields. End with a brief completion note.`;
const prompt=mode==='personas'?`Read input.json and write personas.json with shape {"personas":[{"id":"provided id","description":"...","source_basis":["short exact input excerpts"],"generated_additions":["..." ]}]}. Return all four supplied ids once. For the first three, produce a coherent 2-3 sentence personality faithful to the description, without new biography, capabilities, goals, secrets or rules. For sparse, freely invent a coherent nuanced personality fitting a watch repairer; do not invent family, secret plots, assets or a prior relationship with the player. Avoid catchphrases. A profile should support choices without prescribing one action for every situation. Use at most 220 Chinese characters per description. This establishes one draft personality per identity; do not generate alternatives or reroll.`:
`Read input.json. It contains selected, actual Jev suggestions over frozen fictional inputs, plus one reunion packet. Write performances.json: {"responses":[{"id":"supplied case id","text":"..."}],"reunion":{"narrative":"...","established_details":["..."],"npc_reports":["..."],"open_proposals":["..."]}}. Produce a short natural response for each supplied case, using only that case's view and selected action; do not mix knowledge across cases. Treat suggestions as proposals: express an offer or condition, do not claim a player has accepted or that a transfer occurred. No explicit personality labels, scores, inner-monologue exposition or repeated slogans. For reunion, use the supplied stored sparse personality unchanged. Fill the three-day gap with a modest plausible continuation without simulating days. Distinguish newly proposed prototype background details, the NPC's own claims and unresolved next steps. No invented player decisions, payment, item transfer or solved player objective. At most 160 Chinese characters per response and 300 for reunion narrative. These remain prototype drafts for review, not canonical world facts.`;
await fs.writeFile(path.join(dir,'system.md'),system);await fs.writeFile(path.join(dir,'prompt.txt'),prompt);
const env={...process.env,PI_CODING_AGENT_DIR:path.join(ROOT,'.pi/coc-agent'),PI_GROK_BUILD_IMAGE_TOOLS:'0'};
for(const name of ['TYPESAFE_API_KEY','EXT_JEV_APIKEY','PI_COC_CAMPAIGN','PI_COC_MODE'])delete env[name];
const model=process.env.NPC_PROTOTYPE_MODEL??'xai/grok-4.6';
const provider=model.startsWith('grok-build/')?['-e',path.join(ROOT,'build/extensions/grok-build-oauth/agent/index.mjs')]:[];
const args=[path.join(ROOT,'node_modules/.bin/pi'),'-p','--no-session','--no-context-files','--no-extensions','--no-skills','--no-prompt-templates','--approve',...provider,'--tools','read,write,edit,bash','--model',model,'--thinking','low','--mode','json','--system-prompt',path.join(dir,'system.md'),'--',prompt];
const began=Date.now();const child=spawn(process.execPath,args,{cwd:dir,env,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='',timedOut=false;child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
let force;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');force=setTimeout(()=>child.kill('SIGKILL'),5000);},180000);
const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});clearTimeout(timer);clearTimeout(force);
await fs.writeFile(path.join(dir,'events.jsonl'),stdout);await fs.writeFile(path.join(dir,'stderr.log'),stderr);
const events=stdout.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
const messages=events.filter(e=>e.type==='message_end'&&e.message?.role==='assistant').map(e=>e.message);
const tools=events.filter(e=>e.type==='tool_execution_start').map(e=>({name:e.toolName,path:e.args?.path}));
const meta={prototype:true,live_play:false,mode,...exit,timedOut,wall_ms:Date.now()-began,models:[...new Set(messages.map(m=>m.model))],providers:[...new Set(messages.map(m=>m.provider))],tool_calls:tools,usage:messages.map(m=>m.usage),stop_reasons:messages.map(m=>m.stopReason),agent_end:events.some(e=>e.type==='agent_end')};
try {const bytes=await fs.readFile(path.join(dir,file));JSON.parse(bytes);meta.output_sha256=createHash('sha256').update(bytes).digest('hex');}catch{meta.output_missing_or_invalid=true;}
await fs.writeFile(path.join(dir,'execution.json'),JSON.stringify(meta,null,2));
console.log(JSON.stringify({directory:dir,file,...meta}));
if(exit.code!==0||timedOut||meta.output_missing_or_invalid||!tools.some(t=>t.name==='read')||!tools.some(t=>t.name==='write'))process.exitCode=1;
