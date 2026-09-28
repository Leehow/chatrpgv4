/** Select an explicitly chosen local PDF; syntax enumerates paths, Jev decides intent. */
import {stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {readJevApiKey} from '../jev/agent/config.js';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';
export function pdfPathCandidates(text:string):string[]{
 return [...new Set([...text.matchAll(/\/[^\n\r"'`<>]+?\.pdf\b/giu)].map(match=>match[0]).filter(isAbsolute))].slice(0,8);
}
export async function selectSetupSource(input:{text:string;language:string;signal?:AbortSignal;env?:NodeJS.ProcessEnv;
 decide?:ReturnType<typeof createDecisionAdapter>['decide'];exists?:(path:string)=>Promise<boolean>}):Promise<string|undefined>{
 const env=input.env??process.env;if(!input.decide&&!readJevApiKey(env))return;
 const paths:string[]=[];for(const path of pdfPathCandidates(input.text))if(await (input.exists??(async file=>(await stat(file).catch(()=>null))?.isFile()===true))(path))paths.push(path);
 if(!paths.length)return;
 const scope={owner:'setup-source-intake',audience:'keeper' as const},signal=input.signal??new AbortController().signal;
 const lease=new TaskLease({owner:'setup-source-intake',goal:'Select the player chosen PDF',scope,readSet:[],capabilities:['decision'],signal,
  budget:{deadlineAt:Date.now()+15000,remainingInputTokens:32000,remainingOutputTokens:4000,remainingCostUsd:.1,remainingActions:1}});
 try{
  const decide=input.decide??createDecisionAdapter({env}).decide;
  const result=await decide({id:randomUUID(),model:JEV_MODEL,family:'setup-source-intake',familyVersion:'1',scope,readSet:[],state:{player:input.text,configured_language:input.language},questions:[
   {key:'chosen',target:'player',type:'choice',instructions:'Which issued local PDF did the player choose to start a campaign? A mere example, negated choice, inspection request or quotation is not a choice. Select none unless a campaign source was chosen.',criteria:{...Object.fromEntries(paths.map((path,i)=>['pdf'+i,{path}])),none:'No campaign source was chosen.'}},
   {key:'start',target:'player',type:'noul',instructions:'Does the player explicitly want to start or create a campaign using a supplied PDF, rather than merely discuss, compare or inspect documents?'},
   {key:'language_change',target:'player',type:'noul',instructions:'Does the player explicitly request a play language different from configured_language? Treat equivalent language names/tags as the same. No stated preference means no change.'}
  ]},lease);
  const a=result.answers,choice=a.chosen;
  if(result.status!=='complete'||choice?.status!=='answered'||choice.type!=='choice'||choice.confidence<.75||a.start?.status!=='answered'||a.start.type!=='noul'||a.start.noul<.85||a.language_change?.status!=='answered'||a.language_change.type!=='noul'||a.language_change.noul>=.5)return;
  return paths[Number(String(choice.choice).replace(/^pdf/,''))];
 }catch(error){if(signal.aborted)throw error;return;}finally{lease.close();}
}
