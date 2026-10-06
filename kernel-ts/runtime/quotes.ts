/** Durable quotation drafts belong to delivered turns; only the background writer prices them. */
import type {KernelContext} from '../context.js';
import type {HandlerGroup} from '../handlers.js';
import {RpcError} from '../errors.js';
import {isJsonObject} from '../json.js';
import {array, clone, normalize, number, row, string, type Row} from '../read/values.js';
import {activeName, activeLine} from '../read/worldline.js';
import {loadCampaignModule} from '../read/campaign.js';
import {stageCash, type CashContext} from '../apply/inventory.js';
import {mechanicsOf} from '../read/mechanics.js';
import type {createWriteRuntime} from '../write/index.js';

const FIELDS = ['quote','category','items','subject','with','source','price_id','currency','why'] as const;
export const quotationScope = (meta:Row):Row => ({line:activeName(meta), loop:number(activeLine(meta).loop)});
const sameScope = (a:Row,b:Row):boolean => a.line===b.line && a.loop===b.loop;
export const quotationRecords=(records:readonly Row[],meta:Row):Row[]=>records.filter(record=>record.commit && array(record.quote_drafts).length && sameScope(row(record.quote_scope),quotationScope(meta)));


/** No price/source work on the delivery path. Even a bad draft cannot withhold finished prose. */
export function quotationDrafts(value:unknown, turn:number, meta:Row, party:Row[]):Row[] {
    if (!Array.isArray(value)) return [];
    const scope=quotationScope(meta);
    return value.slice(0,8).map((raw,index)=>{
        const draft=isJsonObject(raw)?Object.fromEntries(FIELDS.filter(key=>Object.hasOwn(raw,key)).map(key=>[key,raw[key]])):{};
        if(draft.subject===undefined && party.length===1)draft.subject=party[0].id;
        else if(typeof draft.subject==='string'){
            const subject=party.find(sheet=>[sheet.id,sheet.name].some(name=>normalize(string(name))===normalize(draft.subject)));
            if(subject)draft.subject=subject.id;
        }
        return {key:`quote:${scope.line}:${scope.loop}:t${turn}:q${index}`, draft};
    });
}
export function pendingQuotation(draft:Row):Row {
    return {kind:'cash',receipt:draft.key,quote_key:draft.key,quote:string(row(draft.draft).quote),purpose:string(row(draft.draft).why),
        settlement:'quote',quote_status:'pending'};
}

export function quotationHandlers(context:KernelContext, writer:ReturnType<typeof createWriteRuntime>):HandlerGroup {
    return {'table.quotes.flush':async (params):Promise<Row>=>{
        const campaign=await writer.campaign(params),meta=await campaign.readCampaign(),scope=quotationScope(meta);
        const records=quotationRecords(await campaign.recordInputs(),meta);
        if(params.turn===undefined)return {turns:records.map(record=>number(record.turn)).sort((a,b)=>a-b),
            keys:Object.fromEntries(records.map(record=>[number(record.turn),array(record.quote_drafts)[0].key]))};
        if(!Number.isSafeInteger(params.turn)||number(params.turn)<0)throw new RpcError('invalid_params','Quotation turn must be a committed turn number');
        const record=await campaign.readTurnRecord(number(params.turn));
        if(!record?.commit || !sameScope(row(record.quote_scope),scope))return {turn:params.turn,quotes:{},stale:true};
        const drafts=array(record.quote_drafts), world=await campaign.readWorld(),jobs=row(world.cash_quote_jobs),quotes:Row={};
        if(!drafts.length)return {turn:params.turn,quotes};
        const module=await loadCampaignModule(context,string(meta.module_id),world,campaign.id);
        let changed=false;
        for(const draft of drafts){
            const key=string(draft.key),input=row(draft.draft);
            if(isJsonObject(jobs[key])){quotes[key]=jobs[key].mechanic;continue;}
            let mechanic:Row=pendingQuotation(draft),reason:string|undefined,receipt:Row|undefined;
            const newer=array(world.cash_quotes).some(quote=>normalize(string(quote.name))===normalize(string(input.quote)) && quote.subject===input.subject && number(quote.origin_turn)>number(record.turn))
                || records.some(later=>number(later.turn)>number(record.turn) && array(later.quote_drafts).some(other=>normalize(string(row(other.draft).quote))===normalize(string(input.quote)) && row(other.draft).subject===input.subject));
            if(newer){mechanic={...mechanic,quote_status:'superseded'};reason='newer_offer';}
            else try{
                // A failed draft cannot partially replace another offer, or affect any player's sheet.
                const stagedWorld=clone(world),cashContext:CashContext={kernel:context,world:stagedWorld,graph:module.graph,
                    turn:{turn:record.turn},campaign,callId:key,ordinal:0,mint:()=>key};
                const staged=await stageCash(cashContext,{...input,kind:'cash',mode:'quote'},new Map());
                receipt=staged.receipt;
                world.cash_quotes=stagedWorld.cash_quotes;
                mechanic={...mechanicsOf(receipt),quote_key:key,quote_status:'ready'};
            }catch(error){
                mechanic={...mechanic,quote_status:'failed'};
                reason=error instanceof Error?error.message:'Quotation registration failed';
            }
            jobs[key]={turn:record.turn,mechanic,...(receipt?{receipt}:{}),...(reason?{reason}:{})};
            quotes[key]=mechanic;changed=true;
        }
        if(changed){world.cash_quote_jobs=jobs;await campaign.writeWorld(world);}
        return {turn:params.turn,quotes};
    }};
}
