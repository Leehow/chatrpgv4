/** Stage 2 experiment observer. Owner views replace the old additive catalog/packet. */
import {appendFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {requestSize,pairedTools,type Row} from '../../extensions/table/context-policy.ts';

const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const contains=(v:unknown,text:string):boolean=>typeof v==='string'?v.includes(text):v&&typeof v==='object'
  ?(Array.isArray(v)?v:Object.values(v)).some(value=>contains(value,text)):false;

export default function residencyPrototype(pi:any):void {
  const enabled=process.env.PI_COC_RESIDENCY_PROTOTYPE==='on';
  let pending:Row|undefined,sequence=0;
  const root=process.env.PI_COC_HOME;
  const append=(file:string,row:Row)=>{
    if(!root)return;
    mkdirSync(join(root,'.coc'),{recursive:true});
    appendFileSync(join(root,'.coc',file),JSON.stringify(row)+'\n');
  };
  const note=(row:Row)=>append('context-residency-prototype.jsonl',{
    at:new Date().toISOString(),lane:'context-residency-prototype',stage:2,mode:enabled?'on':'off',...row});
  pi.on('input',()=>{pending=undefined;});
  // Keep the public event shape used by the stage 1 regression; no bridge read is necessary.
  pi.events.on('coc:kernel-bridge',()=>{});
  pi.events.on('coc:residency-projection',(value:Row)=>{
    value.project=async()=>{
      const began=performance.now(),bytes=requestSize(value.messages);
      pending={sequence:++sequence,at:new Date().toISOString(),binding:value.binding,key:value.key,budget:value.budget,
        fresh:structuredClone(value.messages),fresh_bytes:bytes};
      note({event:'projected',sequence,turn:value.binding?.turn,owner_reads:0,captured:0,
        before_bytes:bytes,after_bytes:bytes,ms:performance.now()-began});
      return {messages:value.messages};
    };
  });
  pi.on('context',(event:Row)=>{if(pending)pending.outgoing=structuredClone(event.messages);});
  pi.on('before_provider_request',(event:Row)=>{
    const sent=pending;pending=undefined;if(!sent)return;
    const outgoing:Row[]=sent.outgoing??[];
    const custom=outgoing.filter(message=>message.role==='custom'&&typeof message.content==='string');
    const delivered=outgoing.length>0&&pairedTools(outgoing)&&custom.every(message=>contains(event.payload,message.content));
    append('context-residency-projections.jsonl',{...sent,outgoing,delivered,outgoing_bytes:requestSize(outgoing),
      fresh_digest:hash(sent.fresh),outgoing_digest:hash(outgoing)});
    note({event:'delivered',sequence:sent.sequence,turn:sent.binding?.turn,delivered,
      owner_reads:0,fresh_bytes:sent.fresh_bytes,outgoing_bytes:requestSize(outgoing)});
  });
}
