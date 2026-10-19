/** Pure bounded public dialogue shared by canonical recovery and host consumers. */
type Row=Record<string,any>;
export interface PublicExchange {turn:number|string;player?:string|null;keeper:string;truncated?:boolean;speech?:Array<{speaker:string;text:string}>}

export function decisionRecentPublic(recent:Row[]=[],delivered:Row[]=[]):PublicExchange[] {
 const byTurn=new Map<number,Row>();
 for(const entry of [...recent,...delivered])if(Number.isFinite(Number(entry.turn))&&entry.closed!=='stranded'&&typeof entry.keeper==='string'&&entry.keeper.trim())byTurn.set(Number(entry.turn),entry);
 return [...byTurn.entries()].sort(([a],[b])=>a-b).slice(-2).map(([turn,entry])=>({turn,player:typeof entry.player==='string'?entry.player:null,
  keeper:entry.keeper.length>8000?entry.keeper.slice(0,4000)+'\n[…]\n'+entry.keeper.slice(-4000):entry.keeper,...(entry.keeper.length>8000?{truncated:true}:{}),
  ...(Array.isArray(entry.speech)?{speech:entry.speech}: {})}));
}

/** Prior utterances keep their speaker; old rendered actions never become current staging. */
export function decisionDialogueContinuity(exchanges:PublicExchange[],people:Row[]):PublicExchange[] {
 const names=new Map<string,Row|null>();
 for(const person of people)for(const name of [person.display_name,person.name])if(typeof name==='string'&&name.trim()){
  const key=name.normalize('NFKC').trim(),prior=names.get(key);
  names.set(key,prior&&prior.ref!==person.ref?null:prior===null?null:person);
 }
 return exchanges.flatMap(entry=>{
  const speech=(entry.speech??[]).flatMap(line=>{
   const person=typeof line.speaker==='string'?names.get(line.speaker.normalize('NFKC').trim()):undefined;
   return person&&typeof line.text==='string'&&line.text.trim()?[`${person.display_name}: ${line.text}`]:[];
  }).slice(-6);
  return speech.length?[{turn:entry.turn,player:entry.player,keeper:speech.join('\n')}]:[];
 }).slice(-2);
}
