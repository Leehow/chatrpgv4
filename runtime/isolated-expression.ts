/** A private Keeper brief and one fresh prose task; publication remains with the existing owner. */
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {HostRuntime} from './host.ts';
import {readAuthorModelChoice} from './author-model.ts';
import {ArtifactTextStream} from './final-output-stream.ts';

type Row=Record<string,any>;
export interface ExpressionBrief {
  keeper_only?:string[];
  scene:string;
  narrative_content:string[];
  npc_turns:Array<{speaker:string;intent:string;personality:string|null;emotion:string|null}>;
  writing?:string|Row;
}
const string=(value:unknown):value is string=>typeof value==='string';
export function expressionBrief(text:string):ExpressionBrief {
  const value=JSON.parse(text);
  if(!value||Array.isArray(value)||typeof value!=='object'
    ||Object.keys(value).some(key=>!['keeper_only','scene','narrative_content','npc_turns','writing'].includes(key))
    ||value.keeper_only!==undefined&&(!Array.isArray(value.keeper_only)||!value.keeper_only.every(string))
    ||!string(value.scene)||!Array.isArray(value.narrative_content)||!value.narrative_content.every(string)
    ||!Array.isArray(value.npc_turns)||value.npc_turns.length>48
    ||value.writing!==undefined&&!string(value.writing)&&(!value.writing||typeof value.writing!=='object'||Array.isArray(value.writing))
    ||value.npc_turns.some((person:Row)=>!person||typeof person!=='object'||Array.isArray(person)
      ||Object.keys(person).some(key=>!['speaker','intent','personality','emotion'].includes(key))
      ||!string(person.speaker)||!string(person.intent)
      ||person.personality!==null&&!string(person.personality)||person.emotion!==null&&!string(person.emotion)))
    throw Error('Invalid private expression brief');
  return value;
}

/** Composition bytes never reach the public stream. Reference answers retain their existing path. */
export class ExpressionPlanStream {
  private pending='';
  private mode:'compose'|'reference'|undefined;
  private decoder=new ArtifactTextStream();
  get record(){return this.decoder.record;}
  push(chunk:string):string {
    if(!this.mode){
      this.pending+=chunk;
      const head=this.pending.trimStart();
      if(['{{compose}}','{{reference}}'].some(marker=>marker.startsWith(head)))return '';
      if(head.startsWith('{{compose}}')){
        this.mode='compose';chunk='{{public}}'+head.slice('{{compose}}'.length);
      }else if(head.startsWith('{{reference}}')){this.mode='reference';chunk=head;}
      else throw Error('Expected a private composition brief or reference answer');
      this.pending='';
    }
    const delta=this.decoder.push(chunk);
    return this.mode==='reference'?delta:'';
  }
  finish(){
    const result=this.decoder.finish();
    return this.mode==='compose'?{...result,expression:expressionBrief(result.text)}:result;
  }
}

export const EXPRESSION_PROFILE={model:'opencode-go/deepseek-v4.1-flash',thinking:'off'} as const;
export const expressionAuthorProfile=(env:NodeJS.ProcessEnv=process.env)=>env.PI_COC_TEST_MODEL==='minimax-cn/MiniMax-M3.1-Flash-Preview'
  ?{model:'minimax-cn/MiniMax-M3.1-Flash-Preview',thinking:'medium' as const}:EXPRESSION_PROFILE;
export const EXPRESSION_INSTRUCTION=`Write the final story response in the supplied play_language. The initial message contains the scene, narrative points and each NPC's intent, personality and emotion. Choose the words yourself. Use connected narration and natural spoken dialogue, with room for each character's voice. Address the investigator as you. Attribute NPC speech with {{say:Public Name}}...{{/say}}. Begin your final response with {{public}} followed by the complete prose. Only the story and dialogue belong in that response.`;

export async function writeIsolatedExpression(input:{runtime:HostRuntime;campaign:string;turn:number;run:string;
  brief:ExpressionBrief;language:string;signal?:AbortSignal;stream:{push:(delta:string)=>void};record:(row:Row)=>Promise<void>}) {
  const {runtime,brief,language,signal,stream,record,campaign,turn,run}=input;
  const profile=process.env.PI_COC_TEST_MODEL==='minimax-cn/MiniMax-M3.1-Flash-Preview'
    ?expressionAuthorProfile():{...EXPRESSION_PROFILE,...await readAuthorModelChoice(runtime.agentHome)};
  const attempt=join(runtime.home,'.coc','expression-writes',randomUUID());
  await mkdir(attempt,{recursive:true});
  const {keeper_only,...expression}=brief;
  const packet={play_language:language,...expression};
  await writeFile(join(attempt,'task.json'),JSON.stringify(packet));
  const decoder=new ArtifactTextStream(),models=new Set<string>();
  let raw='',finished=false,failure:unknown;
  await record({lane:'isolated-expression',event:'start',campaign,turn,run,attempt,...profile,
    packet_bytes:Buffer.byteLength(JSON.stringify(packet)),context:'brief_only',...(keeper_only?{keeper_only}:{})});
  try {
    const outcome=await runtime.runTask({kind:'reader',request:{cwd:attempt,systemPrompt:EXPRESSION_INSTRUCTION,
      brief:JSON.stringify(packet),...profile,pinnedModel:true,tools:'read,write,edit,bash',finalOutput:true,
      timeoutMs:120000,maxRequests:4,eventLog:join(attempt,'events.jsonl'),onEvent:event=>{
        if(failure)return;
        try {
          signal?.throwIfAborted();
          const message=event.message;
          if(message?.role==='assistant'&&message.model){
            const actual=`${message.provider}/${message.model}`;models.add(actual);
            if(actual!==profile.model)throw Error('Unexpected isolated expression model');
          }
          if(event.type==='message_update'&&event.assistantMessageEvent?.type==='text_delta'){
            if(finished)throw Error('An expression response is already complete');
            const delta=String(event.assistantMessageEvent.delta??'');raw+=delta;
            const text=decoder.push(delta);if(text)stream.push(text);
          }
          if(event.type==='message_end'&&message?.role==='assistant'&&['error','aborted','length'].includes(message.stopReason)&&raw)
            throw Error('Isolated expression was interrupted after exposure');
          if(event.type==='tool_execution_start'&&raw)throw Error('An exposed expression cannot continue with tools');
          if(event.type==='message_end'&&message?.role==='assistant'&&message.stopReason==='stop'){
            const text=(message.content??[]).filter((part:Row)=>part.type==='text').map((part:Row)=>part.text).join('');
            if(!raw&&text){raw=text;const delta=decoder.push(text);if(delta)stream.push(delta);}
            if(text!==raw)throw Error('Expression completion differs from its stream');
            finished=true;
          }
        }catch(error){failure=error;throw error;}
      }}},signal);
    if(failure)throw failure;
    if(!outcome.ok||!finished||!models.size)throw Error(outcome.error??'Isolated expression did not complete');
    const result=decoder.finish();
    await writeFile(join(attempt,'response.txt'),result.text);
    await record({lane:'isolated-expression',event:'written',campaign,turn,run,attempt,...profile,
      ms:outcome.ms,usage:outcome.usage,actual_models:[...models]});
    return {version:1 as const,text:result.text,coverage:[],...profile};
  }catch(error){
    await record({lane:'isolated-expression',event:'failed',campaign,turn,run,attempt,...profile,reason:String(error)});
    throw error;
  }
}
