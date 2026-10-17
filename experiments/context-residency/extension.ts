/** PROTOTYPE: loaded explicitly by the experiment launcher; never a product mount. */
import {appendFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {getCurrentSystemMessage} from '@earendil-works/pi-ai';
import {bindingOf,customMessage,requestBudget,requestSize,sizeOf,object} from '../../extensions/table/context-policy.ts';
import {createWritingSupportNames,writingSupportBinding} from '../../runtime/writing-support.ts';
import {SourceResidency,projectedSource,residentSnapshot,type Row} from './residency.ts';

const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const contains=(v:unknown,text:string):boolean=>typeof v==='string'?v.includes(text):v&&typeof v==='object'
  ?(Array.isArray(v)?v:Object.values(v)).some(value=>contains(value,text)):false;

export default function residencyPrototype(pi:any):void {
  const enabled=process.env.PI_COC_RESIDENCY_PROTOTYPE==='on';
  const prejournal=process.env.PI_COC_RESIDENCY_STAGE==='prejournal';
  const resident=new SourceResidency(),supportNames=createWritingSupportNames('resident');
  let bridge:any,capsule:Row={},binding:Row={},generation=0,lastTurn=-1;
  let readNames:string[]=[],pending:Row|undefined;
  const calls=new Map<string,Row>();
  const root=process.env.PI_COC_HOME;
  const note=(row:Row)=>{
    const data={at:new Date().toISOString(),lane:'context-residency-prototype',mode:enabled?'on':'off',
      campaign:binding.campaign,turn:binding.turn,...row};
    try{if(root){mkdirSync(join(root,'.coc'),{recursive:true});appendFileSync(join(root,'.coc','context-residency-prototype.jsonl'),JSON.stringify(data)+'\n');}}catch{}
  };
  pi.events.on('coc:kernel-bridge',(value:any)=>{bridge=value?.call?value:undefined;});
  pi.events.on('coc:capsule',(value:any)=>{capsule=object(value?.capsule);binding=object(value?.context);generation++;});
  pi.on('input',()=>{generation++;pending=undefined;});
  pi.on('tool_call',(event:any)=>{if(event.toolName==='lookup'&&event.input?.kind==='module')calls.set(event.toolCallId,object(event.input));});
  pi.on('tool_result',(event:any)=>{
    const call=calls.get(event.toolCallId);calls.delete(event.toolCallId);
    if(!call||event.isError)return;
    const names=(Array.isArray(event.details?.entities)?event.details.entities:[]).map((row:Row)=>row.name).filter((value:unknown)=>typeof value==='string');
    for(const value of names){readNames=readNames.filter(name=>name!==value);readNames.push(value);}
    readNames=readNames.slice(-16);
  });
  const project=async(event:any,ctx:any,source?:Row)=>{
    const supplied=source??projectedSource(event.messages);
    if(supplied&&bindingOf(supplied.binding)){binding=supplied.binding;capsule=supplied.capsule;}
    const began=Date.now(),before=requestSize(event.messages),current=bindingOf(binding);
    note({event:'baseline',bytes:before,provider:ctx.model?.provider,model:ctx.model?.id});
    if(!enabled||!current||!bridge||bridge.campaign!==current.campaign)return;
    // The prototype does not install another transform after the MiniMax-only request journal.
    if(!prejournal&&['minimax','minimax-cn'].includes(ctx.model?.provider)){note({event:'skipped',reason:'journal_order_requires_integration'});return;}
    const ticket=generation,scope=hash([current.campaign,current.worldline,current.loop,current.turn,current.source_revision]);
    const names=[String(object(capsule.where).scene??''),...(Array.isArray(capsule.present)?capsule.present:[]).flatMap((p:Row)=>[p.name,p.id]),...readNames]
      .filter((value:unknown):value is string=>typeof value==='string'&&!!value);
    resident.observe(current,names);
    const wanted=resident.missing(names);
    let ownerReads=0,captured=0;
    try{
      if(wanted.length){
        ownerReads++;
        const found=object(await bridge.call('table.workspace.read',{campaign:current.campaign,names:[...new Set(names)].slice(0,16),
          query:'',candidate_limit:128,preselect:{version:2,mode:'catalog',limit:256}}));
        if(ticket!==generation||scope!==hash([binding.campaign,binding.worldline,binding.loop,binding.turn,binding.source_revision])){
          note({event:'fallback',reason:'request_changed',owner_reads:ownerReads,ms:Date.now()-began});return;
        }
        if(found.status!=='valid'||object(found.authority).checked!==true)throw Error('Current source owner did not endorse materials');
        captured=resident.capture(Array.isArray(object(found.materials).candidates)?found.materials.candidates:[],object(found.binding),wanted);
      }
      const projection=ctx.sessionManager?.buildSessionProjection?.();
      const system=projection?getCurrentSystemMessage(projection.messages):undefined;
      const systemBytes=system?sizeOf(system)+1:sizeOf({system:ctx.getSystemPrompt?.()??'',tools:pi.getAllTools?.()??[]});
      const ceiling=requestBudget(ctx.model?.contextWindow),remaining=ceiling-systemBytes-before-1024;
      const budget=Math.max(0,Math.min(24*1024,remaining));
      const {packet,stats}=resident.packet(budget);
      if(!packet.materials.length){note({event:'omitted',reason:'no_material_or_headroom',...stats,owner_reads:ownerReads,captured,budget,ms:Date.now()-began});return;}
      const message=supportNames(customMessage('coc-residency-prototype',packet),current);
      if(requestSize([...event.messages,message])+systemBytes>ceiling)throw Error('Optional packet exceeds whole-request budget');
      pending={message,binding:writingSupportBinding(current),turn:current.turn,stats};
      note({event:'projected',...stats,owner_reads:ownerReads,captured,budget,system_bytes:systemBytes,before_bytes:before,
        after_bytes:requestSize([...event.messages,message]),new_turn:current.turn!==lastTurn,ms:Date.now()-began});
      lastTurn=current.turn;
      return{messages:[...event.messages,message]};
    }catch(error){note({event:'fallback',reason:String(error),owner_reads:ownerReads,ms:Date.now()-began});}
  };
  if(prejournal){
    pi.events.on('coc:residency-projection',(value:any)=>{value.project=()=>project({messages:value.messages},value.ctx,{binding:value.binding,capsule:value.capsule});});
    pi.on('context',(event:any)=>{if(pending)pending.outgoing=event.messages;});
  }else pi.on('context',project);
  pi.on('before_provider_request',(event:any)=>{
    const sent=pending;pending=undefined;if(!sent)return;
    const replay=prejournal?residentSnapshot(sent.outgoing??[]):undefined;
    const delivered=prejournal?!!replay&&isDeepStrictEqual(replay.value,JSON.parse(sent.message.content))
      &&replay.proof.every(content=>contains(event.payload,content)):contains(event.payload,String(sent.message.content));
    if(delivered){const packet=JSON.parse(sent.message.content);pi.events.emit('coc:writing-support',{binding:sent.binding,materials:packet.materials});}
    note({event:'delivered',delivered,journal_replayed:prejournal,material_count:sent.stats.full+sent.stats.compact+sent.stats.references,digest:sent.stats.digest});
  });
}
