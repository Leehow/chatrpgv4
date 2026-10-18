/** Pure bounded public dialogue shared by canonical recovery and host consumers. */
type Row=Record<string,any>;
export interface PublicExchange {turn:number|string;player?:string|null;keeper:string;truncated?:boolean}

export function decisionRecentPublic(recent:Row[]=[],delivered:Row[]=[]):PublicExchange[] {
 const byTurn=new Map<number,Row>();
 for(const entry of [...recent,...delivered])if(Number.isFinite(Number(entry.turn))&&entry.closed!=='stranded'&&typeof entry.keeper==='string'&&entry.keeper.trim())byTurn.set(Number(entry.turn),entry);
 return [...byTurn.entries()].sort(([a],[b])=>a-b).slice(-2).map(([turn,entry])=>({turn,player:typeof entry.player==='string'?entry.player:null,
  keeper:entry.keeper.length>8000?entry.keeper.slice(0,4000)+'\n[…]\n'+entry.keeper.slice(-4000):entry.keeper,...(entry.keeper.length>8000?{truncated:true}:{})}));
}
