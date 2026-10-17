/** PROTOTYPE: source-owned residency only; no world state or semantic classifier. */
import {createHash} from 'node:crypto';
import {publicMaterial} from '../../extensions/table/prescreen-types.ts';

export type Row=Record<string,any>;
const object=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const size=(v:unknown)=>Buffer.byteLength(JSON.stringify(v),'utf8');
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const scope=(b:Row)=>JSON.stringify([b.campaign,b.worldline,b.loop]);
const name=(v:unknown)=>typeof v==='string'?v.normalize('NFKC').toLocaleLowerCase():'';
const SOURCE_AUTHORITIES=new Set(['module_source','campaign_adaptation']);

/** The product can rehydrate an opening capsule without broadcasting another bus event. */
export function projectedSource(messages:readonly Row[]):{binding:Row;capsule:Row}|undefined {
  const at=messages.findLastIndex(message=>message.customType==='coc-capsule'&&object(message.details).context);
  if(at<0)return;
  try{
    const binding=object(object(messages[at].details).context);
    let capsule=object(JSON.parse(messages[at].content));
    for(const message of messages.slice(at+1))if(message.customType==='coc-capsule-update'){
      const update=object(JSON.parse(message.content));capsule={...capsule,...object(update.sections)};
      for(const key of Array.isArray(update.removed)?update.removed:[])delete capsule[key];
    }
    return {binding,capsule};
  }catch{return;}
}

/** Replay only this optional snapshot; native results and every other snapshot stay opaque. */
export function residentSnapshot(messages:readonly Row[],contextType='coc-residency-prototype'):{value:Row;proof:string[]}|undefined {
  let value:Row|undefined;const proof:string[]=[];
  try{
    for(const message of messages){
      if(message.role!=='custom'||typeof message.content!=='string')continue;
      if(message.customType===contextType){
        value=object(JSON.parse(message.content));delete value.context_type;proof.length=0;proof.push(message.content);
      }else if(message.customType==='coc-context-revision'){
        const revision=object(JSON.parse(message.content));
        if(revision.retired?.includes(contextType)){value=undefined;proof.length=0;}
        for(const update of revision.updates??[])if(update.context_type===contextType){
          if(update.value)value=structuredClone(update.value);
          if(!value)throw Error('A residency revision has no initial snapshot');
          Object.assign(value,object(update.sections));for(const key of update.removed??[])delete value[key];
          for(const patch of update.patch??[]){
            if(patch.path===''){if(patch.op!=='replace')throw Error('Unsupported root patch');value=structuredClone(patch.value);continue;}
            const path=String(patch.path).split('/').slice(1).map(part=>part.replaceAll('~1','/').replaceAll('~0','~'));
            let parent:any=value;for(const key of path.slice(0,-1)){if(!Object.hasOwn(parent,key))throw Error('Missing patch parent');parent=parent[key];}
            const key=path.at(-1)!;
            if(Array.isArray(parent)){
              const index=key==='-'?parent.length:Number(key);if(!Number.isSafeInteger(index)||index<0||index>parent.length)throw Error('Invalid array patch');
              if(patch.op==='remove')parent.splice(index,1);else if(patch.op==='add')parent.splice(index,0,structuredClone(patch.value));
              else if(patch.op==='replace'&&index<parent.length)parent[index]=structuredClone(patch.value);else throw Error('Unsupported array patch');
            }else if(patch.op==='remove')delete parent[key];
            else if(['add','replace'].includes(patch.op))Object.defineProperty(parent,key,{value:structuredClone(patch.value),writable:true,enumerable:true,configurable:true});
            else throw Error('Unsupported object patch');
          }
          delete value.context_type;proof.push(message.content);
        }
      }
    }
    return value?{value,proof}:undefined;
  }catch{return;}
}

export class SourceResidency {
  private binding:Row={};
  private groups=new Map<string,{name:string;units:Row[];used:number}>();
  private inspected=new Set<string>();
  private active=new Set<string>();
  private ordinal=0;
  resets=0;

  observe(binding:Row,focus:readonly string[]):void {
    if(!binding.campaign||typeof binding.source_revision!=='string')throw Error('A current source binding is required');
    if(scope(binding)!==scope(this.binding)||binding.source_revision!==this.binding.source_revision){
      this.groups.clear();this.inspected.clear();this.resets++;
    }
    this.binding=structuredClone(binding);
    this.active=new Set(focus.map(name).filter(Boolean));
    for(const key of this.active){const group=this.groups.get(key);if(group)group.used=++this.ordinal;}
  }

  missing(focus:readonly string[]):string[]{return [...new Set(focus)].filter(value=>!this.inspected.has(name(value)));}

  capture(candidates:readonly Row[],binding:Row,requested:readonly string[]):number {
    if(scope(binding)!==scope(this.binding)||binding.source_revision!==this.binding.source_revision
      ||binding.turn!==this.binding.turn)throw Error('Material read completed under a stale request binding');
    let captured=0;
    for(const candidate of candidates){
      const read=object(candidate.read),key=name(read.query);
      if(candidate.kind!=='graph_entity'||!SOURCE_AUTHORITIES.has(candidate.authority)||!key
        ||scope(object(candidate.scope))!==scope(binding)||candidate.source_revision!==binding.source_revision)continue;
      if(!requested.some(value=>name(value)===key))continue;
      let group=this.groups.get(key);
      if(!group){group={name:String(read.query),units:[],used:++this.ordinal};this.groups.set(key,group);}
      const at=group.units.findIndex(unit=>unit.key===candidate.key);
      if(at>=0)group.units[at]=structuredClone(candidate);else group.units.push(structuredClone(candidate));
      captured++;
    }
    for(const value of requested)this.inspected.add(name(value));
    // Optional in-memory body eviction leaves canonical sources untouched and reloadable.
    while([...this.groups.values()].reduce((sum,group)=>sum+group.units.length,0)>256){
      const victim=[...this.groups].filter(([key])=>!this.active.has(key)).sort((a,b)=>a[1].used-b[1].used)[0];
      if(!victim)break;
      this.groups.delete(victim[0]);this.inspected.delete(victim[0]);
    }
    return captured;
  }

  packet(budget:number):{packet:Row;stats:Row} {
    const packet:Row={kind:'keeper_support',turn:this.binding.turn,
      note:'Resident source evidence for the current scope. Source-authored background is not current world state or an NPC knowledge grant. Use current receipts and actor perspectives. Read further only for an actual gap; selected units do not certify a complete entity. Omitted detail remains available through its read route.',
      materials:[],coverage:{full:0,compact:0,references:0,omitted:0}};
    const kept=new Set<string>();
    const ordered=[...this.groups].sort((a,b)=>Number(this.active.has(b[0]))-Number(this.active.has(a[0]))||b[1].used-a[1].used||a[0].localeCompare(b[0]));
    const add=(material:Row,level:string)=>{
      const trial={...packet,materials:[...packet.materials,{...material,detail:level}]};
      if(size(trial)>budget)return false;
      packet.materials=trial.materials;packet.coverage[level==='full'?'full':level==='compact'?'compact':'references']++;
      return true;
    };
    for(const [key,group]of ordered){
      const identity=group.units.find(unit=>object(object(unit.coverage).unit).kind==='identity');
      const units=[...(identity?[identity]:[]),...group.units.filter(unit=>unit!==identity)];
      if(this.active.has(key))for(const unit of units){
        const dependencies=Array.isArray(object(unit.coverage).dependencies)?unit.coverage.dependencies:[];
        if(typeof unit.body!=='string'||dependencies.some((value:string)=>!kept.has(value)))continue;
        const material=publicMaterial(unit as any,'resident material '+(packet.materials.length+1));
        if(add(material,'full'))kept.add(unit.key);
      }
      if(identity&&!kept.has(identity.key)){
        const read=structuredClone(object(identity.read));
        const compact={alias:'resident material '+(packet.materials.length+1),kind:'graph_entity',label:identity.label,
          authority:identity.authority,content:{name:group.name,summary:identity.summary??''},
          coverage:{status:'partial',omitted:['full_source_units'],entity_complete:false},read};
        if(add(compact,'compact'))kept.add(identity.key);
        else if(!add({...compact,content:{name:group.name},coverage:{status:'reference_only',omitted:['source_body']}},'reference'))packet.coverage.omitted++;
      }
    }
    if(size(packet)>budget)packet.materials=[];
    return{packet,stats:{...packet.coverage,cached_groups:this.groups.size,
      cached_units:[...this.groups.values()].reduce((sum,group)=>sum+group.units.length,0),
      bytes:size(packet),digest:digest(packet),source_resets:this.resets}};
  }
}
