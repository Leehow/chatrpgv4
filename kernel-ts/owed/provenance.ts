/** Immutable delivered sources for the host's existing consent owner. */
import {locateExcerpt} from '../read/excerpt.js';
import {array,number,row,type Row} from '../read/values.js';
import {turnRecordPath} from '../turn-record.js';
import type {CampaignSnapshot} from '../read/campaign.js';
import {owedLedger,resolveOwedEquipment} from './index.js';
export async function owedSourceRecords(campaign:CampaignSnapshot,capsule:Row):Promise<Row[]> {
 const names=new Set(array(capsule.owed).map(value=>row(value).name));
 if(!names.size)return [];
 const ledger=resolveOwedEquipment(owedLedger(await campaign.optional('owed.json')),campaign.party),out:Row[]=[];
 for(const entry of ledger.open.filter(entry=>names.has(entry.name))){
  if(!Number.isSafeInteger(entry.turn)||number(entry.turn)>=number(campaign.turn.turn))continue;
  const record=row(await campaign.optional(turnRecordPath(number(entry.turn))));
  const equipment=entry.kind==='object'&&entry.equipment_basis===true&&campaign.party.some(person=>person.id===entry.owner_id
   &&array(person.equipment).filter(value=>(typeof value==='string'?value:row(value).name)===row(entry.effect).adopt&&!row(value).object_id).length===1);
  if(record.closed_by!=='narrate'||typeof record.commit!=='string'||!record.commit.trim()
   ||!equipment&&(typeof record.rendered_text!=='string'||!locateExcerpt(record.rendered_text,entry.quote)))continue;
  const from=row(entry.departure).from;
  const departure=entry.kind==='move'&&!entry.effect&&typeof from==='string'&&from.trim();
  if(!entry.effect&&!departure)continue;
  out.push({name:entry.name,turn:entry.turn,commit:record.commit,quote:entry.quote,
   player_text:typeof record.player_text==='string'?record.player_text:'',...(entry.effect?{mode:'effect',effect:entry.effect}:{mode:'departure',from})});
 }
 return out;
}
