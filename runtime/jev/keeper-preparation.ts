/** Run-local native reads shared by independent judgment and Keeper projection. */
import {isNpcReference} from '../npc-references.ts';
import {attitudeRows} from '../decision-content.ts';

type Row=Record<string,any>;
const object=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const array=(value:unknown):Row[]=>Array.isArray(value)?value.filter(value=>value&&typeof value==='object'&&!Array.isArray(value)):[];
const text=(value:unknown):string=>typeof value==='string'?value:'';
const normalized=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]+/gu,'');
const MAX_NAMED_PEOPLE=8;

/** Identity matching against public issued labels, never an action/intent decision. */
export function preparationPeople(capsule:Row,input:string):{people:Row[];named:number;omitted:number}{
  const present=array(capsule.present),known=array(object(capsule.npc_references).people);
  const labels=new Map<string,Set<string>>();
  for(const person of known){
    const label=normalized(text(person.display_name));
    if(label&&isNpcReference(person.ref)){const refs=labels.get(label)??new Set<string>();refs.add(person.ref);labels.set(label,refs);}
  }
  const words=normalized(input),tokens=new Set(input.match(/\bnpc_[1-9][0-9]*\b/g)??[]);
  const selected=known.filter(person=>isNpcReference(person.ref)&&(tokens.has(person.ref)
    ||(normalized(text(person.display_name))&&words.includes(normalized(person.display_name))
      &&labels.get(normalized(person.display_name))?.size===1)));
  const issued=new Set(present.map(person=>text(person.ref)||text(person.id)||text(person.name)));
  const named=selected.filter(person=>!issued.has(person.ref));
  return{people:[...present,...named.slice(0,MAX_NAMED_PEOPLE)],named:Math.min(named.length,MAX_NAMED_PEOPLE),
    omitted:Math.max(0,named.length-MAX_NAMED_PEOPLE)};
}

export class KeeperPreparation {
  private entry?:{key:string;promise:Promise<Row[]>};
  private readonly options:{input:string;current:()=>boolean;
    call:(method:string,params:Row)=>Promise<unknown>;record:(row:Row)=>void};
  constructor(options:KeeperPreparation['options']){this.options=options;}

  warm(capsule:Row,signal:AbortSignal):void{
    void this.prepare(capsule,signal,'prefetch').catch(()=>{});
  }

  async prepare(capsule:Row,signal:AbortSignal,phase='projection'):Promise<Row[]>{
    const assertCurrent=()=>{if(signal.aborted||!this.options.current())throw Error('keeper_preparation_cancelled');};
    assertCurrent();
    const context=object(capsule._context),targets=preparationPeople(capsule,this.options.input);
    const reusable=typeof context.campaign==='string'&&Number.isSafeInteger(context.turn)
      &&typeof context.worldline==='string'&&Number.isSafeInteger(context.loop)
      &&typeof context.world_revision==='string'&&typeof context.source_revision==='string';
    const key=JSON.stringify([context,targets.people,capsule.voices]);
    if(reusable&&this.entry?.key===key){
      this.options.record({event:'reuse',at:new Date().toISOString(),phase,people:targets.people.length,named:targets.named,reads:0});
      const people=await this.entry.promise;assertCurrent();return people;
    }
    const started=Date.now();
    this.options.record({event:'start',at:new Date().toISOString(),phase,people:targets.people.length,named:targets.named,omitted:targets.omitted});
    const promise=Promise.all(targets.people.map(async person=>{
      const identity=text(person.id)||text(person.ref)||text(person.name);
      try{
        const full=object(await this.options.call('table.look',{focus:'npc',name:identity,_context_read:true}));
        assertCurrent();
        if(full.ref&&person.ref&&full.ref!==person.ref)throw Error('keeper_preparation_actor_changed');
        const voice=array(capsule.voices).find(voice=>voice.name===person.name)??{};
        // Only exact duplicate fields already supplied by the capsule are omitted. §258.7: the attitude is parsed first.
        const attitude=attitudeRows(full.relationships);
        return {...(attitude.length?{attitude}:{}),...Object.fromEntries(Object.entries(full).filter(([field,value])=>field==='name'||field==='ref'
          ||full.name!==person.name||![person,voice].some(supplied=>Object.hasOwn(supplied,field)&&JSON.stringify(supplied[field])===JSON.stringify(value)))),
          ...(isNpcReference(person.ref)?{ref:person.ref}:{})};
      }catch{
        assertCurrent();
        return{name:person.name??person.display_name,...(person.ref?{ref:person.ref}:{}),coverage:'unavailable; use look if needed'};
      }
    })).then(people=>{
      assertCurrent();
      this.options.record({event:'ready',at:new Date().toISOString(),phase,people:people.length,named:targets.named,reads:targets.people.length,
        unavailable:people.filter(person=>person.coverage).length,ms:Date.now()-started});
      return people;
    });
    this.entry=reusable?{key,promise}:undefined;
    return promise;
  }
}
