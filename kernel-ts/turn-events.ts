/** Canonical semantic receipts and their derived perspectives; ordinary effects retain their owners. */
import {RpcError} from './errors.js';
import {isJsonObject,jsonDigest} from './json.js';
import type {ModuleGraph} from './read/module-graph.js';
import {personNode} from './read/capsule.js';
import {array,clone,normalize,number,row,string,type Row} from './read/values.js';
import {sayRanges,type SpeakerResolver} from './write/speech-pass.js';

const modes=['observed','heard','read','belief'],states=['accurate','uncertain','distorted'];
const word=(value:unknown,max=1200):value is string=>typeof value==='string'&&!!value.trim()&&[...value].length<=max;
function invalid(field:string,fix='Use the event contract; unknown actors, references or fields are not accepted'):never{throw new RpcError('invalid_params',`Invalid event ${field}`,{fix,details:{field:`event.${field}`}});}
function shape(value:unknown,keys:string[],field:string):Row{
  if(!isJsonObject(value)||Object.keys(value).some(key=>!keys.includes(key)))invalid(field);
  return value;
}
function list(value:unknown,field:string,max=24):Row[]{if(value===undefined)return [];if(!Array.isArray(value)||value.length>max)invalid(field);return value;}
export function eventScope(meta:Row,campaign?:string,turn?:number):Row{
  const worldline=string(meta.active_worldline||'main');
  return {campaign,worldline,loop:number(row(row(meta.worldlines)[worldline]).loop),turn,worldlines:row(meta.worldlines)};
}
/** Existing branch records inherit their parent's history only through the registered fork/merge boundary. */
function eligible(event:Row,scope:Row,cognition=false):boolean{
  const origin=row(event.scope);
  if(scope.campaign&&origin.campaign!==scope.campaign)return false;
  if(typeof scope.turn==='number'&&number(origin.turn)>scope.turn)return false;
  const active=string(scope.worldline||origin.worldline),lines=row(scope.worldlines),limits=new Map<string,number>();
  const visit=(line:string,limit:number,path:Set<string>)=>{
    if(path.has(line)||limit<=(limits.get(line)??-1))return;
    limits.set(line,limit);const next=new Set(path).add(line),entry=row(lines[line]);
    if(cognition&&entry.kind==='loop'&&scope.across_loops!==true)return;
    for(const parent of [entry.forked_from,...array(entry.parents)].filter(isJsonObject))
      if(word(parent.line))visit(parent.line,Math.min(limit,number(parent.turn)),next);
  };
  visit(active,typeof scope.turn==='number'?scope.turn:Number.MAX_SAFE_INTEGER,new Set());
  const limit=limits.get(string(origin.worldline));
  if(limit===undefined||number(origin.turn)>limit)return false;
  const expected=origin.worldline===active?number(scope.loop):number(row(lines[origin.worldline]).loop);
  return !cognition||scope.across_loops===true||number(origin.loop)===expected;
}
export function canonicalEvents(records:Row[],current:Row[]=[],scope:Row={}):Row[]{
  records=records.flatMap(record=>[record,...array(record.semantic_ancestors)]);
  const events=new Map<string,Row>();
  const key=(event:Row)=>jsonDigest({id:event.id,scope:event.scope});
  // A durable record wins over the same still-open ask cursor.
  for(const receipt of [...current,...records.filter(record=>record.status!=='superseded'&&record.superseded_by==null)
    .flatMap(record=>array(record.receipts))]){
    if(receipt.kind!=='event'||row(receipt.event).version!==1)continue;
    const event=clone(receipt.event);if(!eligible(event,scope))continue;
    events.set(key(event),event);
  }
  const delivered=new Map<string,Row>();
  for(const record of records.filter(r=>r.status!=='superseded'&&r.superseded_by==null&&r.interaction_scope!=='reference'&&r.interaction_scope!=='uncertain'))
    for(const disclosure of array(record.disclosures)){
      const event=events.get(key({id:disclosure.event_id,scope:disclosure.event_scope}));
      if(disclosure.status==='delivered'&&event&&eligible(event,scope))delivered.set(`${key(event)}:${disclosure.material}`,disclosure);
    }
  return [...events.values()].map(event=>{
    const delivery=(name:string)=>delivered.get(`${key(event)}:${name}`);
    return {...event,scoped_ref:`event:${row(event.scope).worldline}:t${row(event.scope).turn}:${event.name}`,status:event.material&&!delivery(event.material)?'pending':'active',
      knowledge:array(event.knowledge).map(item=>({...item,status:item.material&&!delivery(item.material)?'pending':'active'})),
      relationships:array(event.relationships).map(item=>({...item,status:item.material&&!delivery(item.material)?'pending':'active'})),
      disclosures:array(event.materials).map(item=>delivery(item.name)??{material:item.name,status:'permitted',visibility:item.visibility})};
  });
}
/** An accepted asked cursor proves publication even if the last record activation write was interrupted. */
export function publishedEventRecord(record:Row,turn:Row):Row{
  const accepted=row(row(row(turn.calls)[record.disclosure_call]).result);
  if(turn.state!=='asked'||record.turn!==turn.turn||!Array.isArray(record.pending_disclosures)||accepted.state!=='asked'
    ||jsonDigest(accepted.disclosures)!==jsonDigest(record.pending_disclosures))return record;
  return {...record,disclosures:record.pending_disclosures,outcome:eventOutcome(array(record.receipts),record.pending_disclosures)};
}
export function stageEvent(raw:unknown,input:{graph:ModuleGraph;world:Row;party:Row[];meta:Row;campaign:string;turn:number;id:string;
  receipts:Row[];prior:Row[];records:Row[];sources?:Row[]}):Row{
  const value=shape(raw,['name','summary','causes','materials','knowledge','relationships','corrects','material'],'record');
  if(Buffer.byteLength(JSON.stringify(value),'utf8')>32000)invalid('record exceeds 32 KiB');
  if(!word(value.name,120)||value.summary!==undefined&&!word(value.summary))invalid('name/summary');
  const scope=eventScope(input.meta,input.campaign,input.turn),prior=canonicalEvents(input.records,input.prior,scope);
  const ref=`event:t${input.turn}:${value.name.trim()}`;
  if(prior.some(event=>event.ref===ref))invalid('name already recorded this turn');
  const actor=(name:unknown):Row=>{
    if(!word(name,200))invalid('actor');
    const person=input.party.find(sheet=>[sheet.id,sheet.name].some(key=>normalize(string(key))===normalize(name)));
    if(person)return {kind:'investigator',id:person.id,name:person.name};
    const node=personNode(input.graph,input.world,name);
    if(!node)invalid(`unknown actor ${name}`);
    return {kind:'npc',id:input.graph.handle(node),name:input.graph.displayName(node)};
  };
  const materials=list(value.materials,'materials').map((raw,index)=>{
    const item=shape(raw,['name','text','kind','visibility','speaker','audience'],`materials[${index}]`);
    if(!word(item.name,120)||!word(item.text,4000)||!['fact','description','context','speech'].includes(item.kind)||!['player','keeper'].includes(item.visibility))invalid('material');
    const name=`${ref}/${item.name.trim()}`;
    if(name.length>200)invalid('material alias exceeds reference budget');
    if(item.kind==='speech'){
      if(!Array.isArray(item.audience)||!item.audience.length||item.audience.length>16)invalid('speech audience');
      return {name,text:item.text,kind:item.kind,visibility:item.visibility,speaker:actor(item.speaker),audience:item.audience.map(actor)};
    }
    if(item.speaker!==undefined||item.audience!==undefined)invalid('non-speech audience');
    return {name,text:item.text,kind:item.kind,visibility:item.visibility};
  });
  if(new Set(materials.map(item=>item.name)).size!==materials.length)invalid('duplicate materials');
  const material=(name:unknown):string|undefined=>{
    if(name===undefined)return undefined;
    if(!word(name,120))invalid('material binding');
    const found=materials.find(item=>item.name===`${ref}/${name.trim()}`);
    if(!found||found.visibility!=='player')invalid('material binding must name a permitted public component');
    return found.name;
  };
  const knowledge=list(value.knowledge,'knowledge').map((raw,index)=>{
    const item=shape(raw,['actor','statement','mode','source','state','material'],`knowledge[${index}]`);
    if(!word(item.statement)||!modes.includes(item.mode)||!states.includes(item.state))invalid('knowledge');
    const who=actor(item.actor),source=item.source===undefined?undefined:actor(item.source);
    if(item.mode==='heard'&&!source)invalid('heard source');
    const binding=material(item.material),bound=materials.find(m=>m.name===binding);
    if(bound?.kind==='speech'&&(item.mode!=='heard'||source?.id!==row(bound.speaker).id||!array(bound.audience).some(a=>a.id===who.id)))invalid('speech cognition must match actual speaker and audience','Bind heard cognition only for an audience member hearing this material speaker, with source equal to that speaker. Knowledge already acquired from the actual player input is independent: omit its material field, rather than binding it to the NPC reply.');
    if(item.mode==='belief'&&who.kind==='investigator')invalid('player belief requires the existing player assertion owner');
    return {actor:who,statement:item.statement,mode:item.mode,state:item.state,...(source?{source}:{}),...(binding?{material:binding}:{})};
  });
  const relationships=list(value.relationships,'relationships').map((raw,index)=>{
    const item=shape(raw,['actor','toward','statement','material'],`relationships[${index}]`);
    if(!word(item.statement))invalid('relationship');
    const binding=material(item.material);
    return {actor:actor(item.actor),toward:actor(item.toward),statement:item.statement,...(binding?{material:binding}:{})};
  });
  const reference=(name:unknown):Row=>{
    if(!word(name,200))invalid('reference');
    const matches=prior.filter(event=>event.ref===name||event.scoped_ref===name);
    if(matches.length>1)invalid('ambiguous reference across worldlines');
    const event=matches[0];
    if(event)return {name,event:event.id,scope:event.scope};
    if(input.prior.some(receipt=>receipt.id===name))return {name,receipts:[name]};
    if(name==='receipts'&&input.prior.length)return {name,receipts:input.prior.map(receipt=>receipt.id)};
    const source=array(input.sources).find(source=>source.name===name);
    if(source)return clone(source);
    invalid('unissued reference','Causes are optional. Use only an exact event reference issued by outcome/history, an issued source alias, an exact receipt id already issued this turn, or receipts for earlier settled receipts. Omit unsupported causes; the successful batch effects are linked automatically.');
  };
  const causes=list(value.causes,'causes',16).map(reference),corrects=value.corrects===undefined?undefined:reference(value.corrects),binding=material(value.material);
  if(corrects&&!corrects.event)invalid('correction must reference one canonical event');
  if(!value.summary&&!knowledge.length&&!relationships.length&&!input.receipts.length)invalid('requires an occurrence or semantic change');
  const {worldlines:_registry,...origin}=scope;
  return {id:input.id,kind:'event',visibility:'keeper',event:{version:1,id:input.id,ref,name:value.name.trim(),summary:value.summary??null,scope:origin,
    effects:input.receipts.map(receipt=>receipt.id),causes,materials,knowledge,relationships,...(binding?{material:binding}:{}),...(corrects?{corrects}:{})}};
}
/** Activated only by the existing accepted publication owner, never by private checks. */
export function eventDisclosures(receipts:Row[],evidence:Row,speech:Row[],resolve:SpeakerResolver):Row[]{
  const covered=new Set(array(evidence.coverage).map(item=>item.name)),materials=array(evidence.materials),result:Row[]=[];
  const text=string(evidence.artifact_text),ranges=sayRanges(text,resolve);
  for(const receipt of receipts)if(receipt.kind==='event')for(const material of array(row(receipt.event).materials)){
    if(material.visibility!=='player')continue;
    const delivered=materials.filter(item=>item.event_material===material.name&&covered.has(item.name)&&item.text===material.text).some(selected=>
      material.kind!=='speech'||ranges.some(range=>{
        const who=row(range.who),speaker=row(material.speaker);
        return (who.npc??who.investigator)===speaker.id&&speech.some(line=>(row(line.who).npc??row(line.who).investigator)===speaker.id)
          &&array(evidence.coverage).some(span=>span.name===selected.name&&Math.min(number(span.end),range.end)>Math.max(number(span.start),range.start)
            &&text.slice(Math.max(number(span.start),range.start),Math.min(number(span.end),range.end)).trim());
      }));
    if(!delivered)continue;
    result.push({material:material.name,event:row(receipt.event).ref,event_id:row(receipt.event).id,event_scope:row(receipt.event).scope,status:'delivered',audience:array(material.audience),
      packet:evidence.packet,authority:'accepted_delivery'});
  }
  return result;
}
export function eventOutcome(receipts:Row[],disclosures:Row[]=[]):Row{
  const all=canonicalEvents([{receipts,disclosures}],[],{}),corrected=correctedEvents(all);
  const events=all.map(event=>corrected.has(jsonDigest({id:event.id,scope:event.scope}))?{...event,status:'corrected'}:event);
  const publicMaterials=events.filter(event=>event.status!=='corrected').flatMap(event=>array(event.materials).filter(item=>item.visibility==='player')
    .map(item=>({...clone(item),authority:'canonical_event',event_material:item.name,event_ref:event.ref,revision:jsonDigest(event),
      ...(item.kind==='speech'?{speaker:row(item.speaker).name,audience:array(item.audience).map(a=>a.name)}:{})})));
  return {version:1,events:events.filter(event=>event.status==='active'),world_effects:receipts.filter(r=>r.kind!=='event'&&r.kind!=='npc'),
    npc_effects:[...receipts.filter(r=>r.kind==='npc'),...events.flatMap(event=>array(event.relationships).map(item=>({...item,event:event.ref})))],
    knowledge_changes:events.flatMap(event=>array(event.knowledge).map(item=>({...item,event:event.ref}))),
    intent_changes:receipts.filter(r=>r.intent).map(r=>({npc:r.npc??row(r.intent).npc,...row(r.intent)})),
    disclosures:events.flatMap(event=>array(event.disclosures)),public_materials:publicMaterials};
}
export function actorEventView(events:Row[],names:string[],scope:Row={}):Row{
  const mine=(actor:Row)=>names.some(name=>normalize(name)===normalize(string(actor.id))||normalize(name)===normalize(string(actor.name)));
  const cognition:Row[]=[],relationships:Row[]=[];
  const corrected=correctedEvents(events);
  for(const event of [...events].sort((a,b)=>number(row(a.scope).turn)-number(row(b.scope).turn))){
    if(corrected.has(jsonDigest({id:event.id,scope:event.scope}))||!eligible(event,scope,true))continue;
    for(const item of array(event.knowledge))if(item.status==='active'&&mine(row(item.actor))){
      const {material:_privateMaterial,...perceived}=item;
      cognition.push({...perceived,turn:row(event.scope).turn,authority:'canonical_event'});
    }
    for(const item of array(event.relationships))if(item.status==='active'&&mine(row(item.actor)))relationships.push({toward:row(item.toward).name,
      evidence:[{statement:item.statement,turn:row(event.scope).turn,authority:'canonical_event'}]});
  }
  return {cognition:cognition.slice(-12),relationships:relationships.slice(-6),
    coverage:{cognition_omitted:Math.max(0,cognition.length-12),relationships_omitted:Math.max(0,relationships.length-6),read:{what:'memory'}}};
}
function correctedEvents(events:Row[]):Set<string>{return new Set(events.filter(e=>e.status==='active'&&row(e.corrects).event)
  .map(e=>jsonDigest({id:row(e.corrects).event,scope:row(e.corrects).scope})));}
/** Derived only from canonical receipts; legacy extraction cannot supply this authority. */
export function eventMemory(events:Row[],scope:Row):Row[]{
  const result:Row[]=[],corrected=correctedEvents(events);
  for(const event of events){
    if(corrected.has(jsonDigest({id:event.id,scope:event.scope})))continue;
    const occurrence=`${event.id}:${jsonDigest(event.scope).slice(0,12)}`;
    const base={status:'established',confidence:null,privacy:'keeper_only',valid_from_turn:row(event.scope).turn,
      worldline:row(event.scope).worldline,loop:row(event.scope).loop,source:{event:event.ref,scoped_ref:event.scoped_ref,scope:event.scope}};
    if(event.status==='active'&&word(event.summary))result.push({...base,id:`${occurrence}:occurrence`,kind:'world_event',subject:'world',knowers:[],entities:[],statement:event.summary,state:'accurate'});
    if(!eligible(event,scope,true))continue;
    for(const [index,item] of array(event.knowledge).entries())if(item.status==='active')result.push({...base,id:`${occurrence}:knowledge:${index}`,
      kind:item.mode==='belief'?'belief':'knowledge',subject:row(item.actor).name,knowers:[row(item.actor).name],entities:[],statement:item.statement,state:item.state,
      acquisition:item.mode,attributed_source:item.source??null});
    for(const [index,item] of array(event.relationships).entries())if(item.status==='active')result.push({...base,id:`${occurrence}:relationship:${index}`,
      kind:'relationship',subject:row(item.actor).name,knowers:[row(item.actor).name],entities:[row(item.toward).name],statement:item.statement,state:'accurate'});
  }
  return result;
}
