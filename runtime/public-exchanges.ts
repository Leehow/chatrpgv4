/** Pure bounded public dialogue shared by canonical recovery and host consumers. */
type Row=Record<string,any>;
export interface PublicExchange {turn:number|string;player?:string|null;keeper:string;truncated?:boolean;portrayal?:Row;speech?:Array<{speaker:string;text:string}>}

export function decisionRecentPublic(recent:Row[]=[],delivered:Row[]=[]):PublicExchange[] {
 const byTurn=new Map<number,Row>();
 for(const entry of [...recent,...delivered])if(Number.isFinite(Number(entry.turn))&&entry.closed!=='stranded'&&typeof entry.keeper==='string'&&entry.keeper.trim())byTurn.set(Number(entry.turn),entry);
 return [...byTurn.entries()].sort(([a],[b])=>a-b).slice(-2).map(([turn,entry])=>({turn,player:typeof entry.player==='string'?entry.player:null,
  keeper:entry.keeper.length>8000?entry.keeper.slice(0,4000)+'\n[…]\n'+entry.keeper.slice(-4000):entry.keeper,...(entry.keeper.length>8000?{truncated:true}:{}),
  ...(Array.isArray(entry.speech)?{speech:entry.speech}: {})}));
}

/** Selected transcripts remain prior public evidence, never mandatory fresh assertions. */
export function decisionResponseHistory(responses:Row[],people:Row[],turn:number):{responses:Row[];history:PublicExchange[]} {
 const cast=new Map(people.map(person=>[person.ref,person]));
 const history:PublicExchange[]=[];
 const current=responses.map(response=>{
  if(!Array.isArray(response.claims))return response;
  const claims=response.claims.filter((claim:Row)=>{
   const value=claim.value,person=cast.get(response.actor);
   if(claim.kind!=='recent_speech'||claim.actor!==response.actor||typeof person?.display_name!=='string'
    ||value?.authority!=='conversation_report'||value.attribution?.kind!=='speech'||value.attribution?.speaker?.kind!=='npc'
    ||typeof value.statement!=='string'||!Number.isSafeInteger(value.turn)||value.turn>=turn)return true;
   history.push({turn:Number(value.turn),player:null,keeper:'',speech:[{speaker:person.display_name,text:value.statement}]});
   return false;
  });
  return {...response,claims};
 });
 return {responses:current,history};
}

/** Prior utterances keep their speaker; old rendered actions never become current staging. */
export function decisionDialogueContinuity(exchanges:PublicExchange[],people:Row[]):PublicExchange[] {
 const names=new Map<string,Row|null>();
 for(const person of people)for(const name of [person.display_name,person.name])if(typeof name==='string'&&name.trim()){
  const key=name.normalize('NFKC').trim(),prior=names.get(key);
  names.set(key,prior&&prior.ref!==person.ref?null:prior===null?null:person);
 }
 const grouped=new Map<number|string,{turn:number|string;player:string|null|undefined;lines:Set<string>}>();
 for(const entry of exchanges){
  const speech=(entry.speech??[]).flatMap(line=>{
   const person=typeof line.speaker==='string'?names.get(line.speaker.normalize('NFKC').trim()):undefined;
   return person&&typeof line.text==='string'&&line.text.trim()?[`${person.display_name}: ${line.text}`]:[];
  }).slice(-6);
  if(!speech.length)continue;
  const prior=grouped.get(entry.turn)??{turn:entry.turn,player:entry.player,lines:new Set<string>()};
  if(entry.player)prior.player=entry.player;
  speech.forEach(line=>prior.lines.add(line));grouped.set(entry.turn,prior);
 }
 const selected=[...grouped.values()].map(entry=>({turn:entry.turn,player:entry.player,keeper:[...entry.lines].slice(-6).join('\n')}));
 const fallback=people.flatMap(person=>{
  const entry=person.last_public_exchange;
  if(typeof person.display_name!=='string'||names.get(person.display_name.normalize('NFKC').trim())?.ref!==person.ref)return [];
  if(!entry||!Number.isFinite(Number(entry.turn))||exchanges.some(row=>Number(row.turn)===Number(entry.turn)
   &&row.speech?.some(line=>typeof line.speaker==='string'&&names.get(line.speaker.normalize('NFKC').trim())?.ref===person.ref)))return [];
  const speech=(entry.words??[]).filter((text:unknown)=>typeof text==='string'&&text.trim()).slice(-6);
  return speech.length?[{turn:entry.turn,player:null,keeper:speech.map((text:string)=>`${person.display_name}: ${text}`).join('\n')}]:[];
 });
 const result:PublicExchange[]=[...fallback,...selected];
 for(const person of people){
  const portrayal=person.last_public_rendering;
  if(!portrayal||typeof portrayal.text!=='string'||!portrayal.text.trim()
   ||typeof person.display_name!=='string'||names.get(person.display_name.normalize('NFKC').trim())?.ref!==person.ref)continue;
  const prior=result.find(entry=>Number(entry.turn)===Number(portrayal.turn));
  if(prior)prior.portrayal={...portrayal,actor:person.ref};
  else result.push({turn:portrayal.turn,player:null,keeper:'',portrayal:{...portrayal,actor:person.ref}});
 }
 return result.sort((a,b)=>Number(a.turn)-Number(b.turn)).slice(-4);
}
