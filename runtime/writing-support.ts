/** Input-local names for exact evidence. Names never grant publication authority. */
import {createHash} from 'node:crypto';
type Row=Record<string,any>;
const object=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function writingSupportBinding(value:Row):Row {
  return {campaign:value.campaign,turn:value.turn,worldline:value.worldline,loop:value.loop,
    source_revision:value.task_source_revision??value.source_revision};
}

export function createWritingSupportNames(prefix='support') {
  let epoch='',ordinal=0;
  const names=new Map<string,string>();
  return (message:Row,binding:Row):Row=>{
    let packet:Row;
    try{packet=JSON.parse(String(message.content));}catch{return message;}
    if(packet.kind!=='keeper_support'||packet.turn!==binding.turn||!Array.isArray(packet.materials))return message;
    const next=JSON.stringify([binding.campaign,binding.worldline,binding.loop,binding.turn]);
    if(next!==epoch){epoch=next;ordinal=0;names.clear();}
    packet=structuredClone(packet);
    const aliases=new Map<string,string>();
    for(const material of packet.materials){
      const {alias,...body}=material,key=digest([writingSupportBinding(binding),body]);
      let name=names.get(key);
      if(!name){name=`${prefix} ${++ordinal}`;names.set(key,name);}
      aliases.set(alias,name);material.alias=name;
    }
    for(const [section,values] of Object.entries(object(packet.parameters)))
      if(Array.isArray(values))packet.parameters[section]=values.map(alias=>aliases.get(alias)??alias);
    packet.note+=' Material aliases are delivery sources. Only explicitly player-safe text can be reused without your permitted excerpt.';
    return {...message,content:JSON.stringify(packet),details:{...object(message.details),
      writing_support:{binding:writingSupportBinding(binding)}}};
  };
}

/** Closed owner metadata only. No semantic inference from wording or source kind. */
export function publicSupportText(material:Row):string|undefined {
  const content=object(material.content);
  if(content.privacy!==undefined&&content.privacy!=='player_safe'||content.visibility!==undefined&&content.visibility!=='player')return;
  if(content.privacy!=='player_safe'&&content.visibility!=='player')return;
  return typeof content.text==='string'&&content.text.trim()&&content.text.length<=32000?content.text:undefined;
}
