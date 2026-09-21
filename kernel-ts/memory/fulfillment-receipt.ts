/** Finite promise terms bind to originals; only canonical effect receipts carry fulfillment. */
import type {KernelContext} from '../context.js';
import type {CampaignWritePort} from '../transactions.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {CampaignSnapshot} from '../read/campaign.js';
import {RpcError} from '../errors.js';
import {jsonDigest, parsePythonJson, sha256Text} from '../json.js';
import {array, clone, row, string, type Row} from '../read/values.js';
import {cashDecimal, addCash, compareCash, cashText, type Decimal} from '../apply/cash.js';
import {objectOwner} from '../mods/stage.js';
import {ownerLabel} from '../mods/object-transfer.js';
import {EntityIndex} from '../read/memory.js';
import {assertSourceRef, issueSourceRef, resolveSourceRef, type SourceSnapshot} from '../../runtime/jev/source-ref.ts';
import type {SourceRef, ScopeBinding} from '../../runtime/jev/value-contracts.ts';
import {fulfillmentDecimal,validateFulfillmentTerms,fulfillmentReceiptAmount,derivePromiseFulfillment,
    type PromiseScope,type PromiseTerm,type PromiseTermsBinding,type FulfillmentSelection,type PromiseFulfillmentView} from './fulfillment-view.js';
export * from './fulfillment-view.js';

export interface FulfillmentContext {kernel:KernelContext;campaign:CampaignWritePort;world:Row;turn:Row;graph:ModuleGraph}
const ZERO:Decimal={coefficient:0n,exponent:0};
const fail=(reason:string,message:string):never=>{throw new RpcError('needs',message,{details:{reason}});};
const same=(a:any,b:any)=>jsonDigest(a)===jsonDigest(b);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=2048;
const closed=(v:any,keys:string[],required=keys):v is Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)
    && Object.keys(v).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(v,key));
const stateScope=(campaign:string,meta:Row):PromiseScope=>{const worldline=string(meta.active_worldline||'main');return {campaign,worldline,loop:Number(row(row(meta.worldlines)[worldline]).loop??0)};};
const sourceScope=(scope:PromiseScope):ScopeBinding=>({owner:`campaign:${scope.campaign}`,...scope,audience:'keeper'});
const negate=(value:Decimal):Decimal=>({...value,coefficient:-value.coefficient});
async function canonicalTurn(context:FulfillmentContext,commitHint:string,turn:number):Promise<{record:Row;scope:PromiseScope;commit:string}> {
    if(!/^[a-f0-9]{7,64}$/.test(commitHint)||!Number.isSafeInteger(turn)||turn<0) return fail('needs_source','A canonical turn origin is required');
    const resolved=await context.kernel.git.run(context.campaign.id,['rev-parse','--verify',`${commitHint}^{commit}`]),commit=resolved.stdout.trim();
    if(resolved.code||!/^[a-f0-9]{40,64}$/.test(commit)) return fail('needs_source','The original source commit cannot be resolved');
    const [recordBlob,metaBlob]=await Promise.all([context.kernel.git.run(context.campaign.id,['show',`${commit}:turns/${String(turn).padStart(4,'0')}.json`]),
        context.kernel.git.run(context.campaign.id,['show',`${commit}:campaign.json`])]);
    if(recordBlob.code||metaBlob.code) return fail('needs_source','The original committed turn is unavailable');
    const record=row(parsePythonJson(recordBlob.stdout)),meta=row(parsePythonJson(metaBlob.stdout));
    if(record.turn!==turn||record.closed_by!=='narrate'||meta.id!==context.campaign.id) return fail('needs_source','The original turn belongs to another source scope');
    return {record,scope:stateScope(context.campaign.id,meta),commit};
}
export interface PromiseFulfillmentSources {promise:Row;scope:PromiseScope;refs:SourceRef[];snapshots:SourceSnapshot[];scalars:Array<{alias:string;text:string;value:string;ref:SourceRef}>}
/** Verify a current T09 occurrence against its original Git turn. No summary or substring re-anchor. */
export async function promiseFulfillmentSources(context:FulfillmentContext,promiseId:string):Promise<PromiseFulfillmentSources> {
    const snapshot=new CampaignSnapshot(context.kernel,context.campaign.id),matches=(await snapshot.log('memory/candidates.jsonl')).filter(value=>value.id===promiseId);
    if(matches.length!==1) return fail('needs_source','Select one retained promise occurrence');
    const promise=matches[0],active=stateScope(context.campaign.id,await context.campaign.readCampaign());
    if(promise.kind!=='promise'||promise.memory_version!==2||promise.superseded_by!=null||promise.valid_until_turn!=null
        ||promise.status!=='candidate'||promise.state!=='accurate') return fail('promise_not_current','The promise occurrence is not a current source-backed candidate');
    if(promise.worldline!==active.worldline||Number(promise.loop)!==active.loop) return fail('promise_scope_mismatch','The promise belongs to another worldline or loop');
    const original=await canonicalTurn(context,string(row(promise.source).commit),Number(row(promise.source).turn));
    if(!same(original.scope,active)) return fail('promise_scope_mismatch','The promise original belongs to another worldline or loop');
    const refs=clone(array(promise.source_refs)) as SourceRef[],statementRef=promise.statement_ref as SourceRef;
    if(!refs.length||refs.length>16||!refs.some(ref=>same(ref,statementRef))) return fail('needs_source','The promise has no exact original statement reference');
    const snapshots:SourceSnapshot[]=[],scalars:PromiseFulfillmentSources['scalars']=[];
    for(const ref of refs) {
        try{assertSourceRef(ref);}catch{return fail('needs_source','The original promise reference is invalid');}
        const match=/^turn:([0-9]+):(player|keeper)$/.exec(ref.resource);
        if(!match||Number(match[1])!==original.record.turn||ref.sourceType!=='turn'||ref.selector.kind!=='utf16'||!same(ref.scope,sourceScope(active)))
            return fail('needs_source','The promise reference is not its canonical original occurrence');
        const sourceText=string(original.record[match[2]==='keeper'?'rendered_text':'player_text']??''),source:SourceSnapshot={scope:ref.scope,resource:ref.resource,revision:sha256Text(sourceText),sourceType:'turn',text:sourceText};
        let selected:any;
        try{selected=resolveSourceRef(ref,{scope:ref.scope,mode:'historical',read:()=>source,currentRevision:()=>source.revision});}
        catch{return fail('needs_source','The original promise reference is stale or unavailable');}
        if(same(ref,statementRef)&&selected!==promise.statement) return fail('needs_source','The promise statement is not its exact original occurrence');
        if(!snapshots.some(value=>value.resource===source.resource)) snapshots.push(source);
        for(const candidate of fulfillmentNumericCandidates(source,ref.selector)) scalars.push({...candidate,alias:`scalar:${scalars.length}`});
    }
    return {promise:clone(promise),scope:active,refs,snapshots,scalars};
}
/** Immutable typed scalar source: exact numeric fields from a canonical committed receipt. */
export function fulfillmentReceiptSource(scope:PromiseScope,commit:string,turn:number,receipt:Row):SourceSnapshot {
    if(!/^[a-f0-9]{40,64}$/.test(commit)||!Number.isSafeInteger(turn)||turn<0||!text(receipt.id)) return fail('needs_source','A committed receipt identity is required');
    const projected:Row={},allowedFields:string[][]=[];
    for(const key of ['delta','quantity','source_amount','purchase_amount']) {
        const numeric=cashDecimal(receipt[key]);
        if(numeric) {projected[key]=cashText(numeric);allowedFields.push([key]);}
    }
    return {scope:sourceScope(scope),resource:`fulfillment:receipt:${commit}:${turn}:${receipt.id}`,revision:jsonDigest(receipt),sourceType:'record',record:projected,allowedFields};
}
async function scalarValue(context:FulfillmentContext,ref:SourceRef,source:PromiseFulfillmentSources,term:PromiseTerm):Promise<Decimal> {
    let snapshot:SourceSnapshot|undefined;
    if(ref.sourceType==='turn') {
        snapshot=source.snapshots.find(value=>value.resource===ref.resource);
        if(!snapshot||ref.selector.kind!=='utf16'||!source.refs.some(parent=>parent.resource===ref.resource&&parent.selector.kind==='utf16'
            &&ref.selector.kind==='utf16'&&ref.selector.start>=parent.selector.start&&ref.selector.end<=parent.selector.end))
            return fail('needs_source','The scalar token is outside the selected promise occurrence');
        if(!source.scalars.some(value=>same(value.ref,ref))) return fail('unsupported_terms','Select one complete issued finite numeric token');
    } else {
        const match=/^fulfillment:receipt:([a-f0-9]{40,64}):(0|[1-9][0-9]*):(.+)$/.exec(ref.resource);
        if(!match||ref.sourceType!=='record'||ref.selector.kind!=='field') return fail('needs_source','The typed scalar must name an immutable canonical receipt field');
        const original=await canonicalTurn(context,match[1],Number(match[2]));
        if(!same(original.scope,source.scope)) return fail('promise_scope_mismatch','The scalar receipt belongs to another worldline or loop');
        const receipts=array(original.record.receipts).filter(value=>value.id===match[3]);
        if(receipts.length!==1) return fail('needs_source','The selected scalar receipt does not exist in its canonical turn');
        const receipt=receipts[0],field=ref.selector.path.length===1?ref.selector.path[0]:'';
        if(term.kind==='cash') {
            const currency=field==='source_amount'?receipt.source_currency:receipt.currency;
            if(receipt.kind!=='cash'||!['delta','source_amount','purchase_amount'].includes(field)||currency!==term.currency)
                return fail('unsupported_terms','A typed cash scalar must retain its original cash unit');
        } else if(field!=='quantity'||receipt.kind!=='item') return fail('unsupported_terms','A typed item scalar must be an actual item quantity');
        else if(term.kind==='item'&&(receipt.instance!=null||receipt.name!==term.item))
            return fail('unsupported_terms','The typed legacy item quantity belongs to a different item');
        else if(term.kind==='object') {
            const worldBlob=await context.kernel.git.run(context.campaign.id,['show',`${original.commit}:world.json`]);
            if(worldBlob.code) return fail('needs_source','The typed physical quantity has no canonical creation-world snapshot');
            const historicalWorld=row(parsePythonJson(worldBlob.stdout)),instance=row(row(historicalWorld.objects).instances)[receipt.instance];
            if(!instance||!row(row(historicalWorld.objects).definitions)[term.definition!]||instance.definition!==term.definition||term.instance!==undefined&&receipt.instance!==term.instance&&receipt.divided_from_instance!==term.instance)
                return fail('unsupported_terms','The typed physical quantity belongs to a different definition or instance');
        }
        snapshot=fulfillmentReceiptSource(original.scope,original.commit,Number(match[2]),receipt);
    }
    let selected:any;
    try {selected=resolveSourceRef(ref,{scope:sourceScope(source.scope),mode:'historical',read:()=>snapshot,currentRevision:()=>snapshot!.revision});}
    catch{return fail('needs_source','The scalar source reference is stale, foreign or not allowlisted');}
    if(typeof selected!=='string') return fail('unsupported_terms','The scalar source has no exact finite decimal representation');
    return fulfillmentDecimal(selected);
}
/** An allocation may select a token in the actual open player input; totals never use this mutable source. */
export function fulfillmentCurrentInputSource(scope:PromiseScope,turn:number,input:string):SourceSnapshot {
    if(!Number.isSafeInteger(turn)||turn<0||typeof input!=='string') return fail('needs_source','Current input requires an exact open-turn source');
    return {scope:sourceScope(scope),resource:`fulfillment:current-input:${turn}`,revision:sha256Text(input),sourceType:'turn',text:input};
}
export function fulfillmentNumericCandidates(snapshot:SourceSnapshot,range={start:0,end:snapshot.text?.length??0}):Array<{alias:string;text:string;value:string;ref:SourceRef}> {
    if(typeof snapshot.text!=='string') return [];
    const result:Array<{alias:string;text:string;value:string;ref:SourceRef}>=[],selected=snapshot.text.slice(range.start,range.end);
    const tokens=/-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g;
    for(let token=tokens.exec(selected);token;token=tokens.exec(selected)) {
        const start=range.start+token.index,end=start+token[0].length,before=snapshot.text[start-1]??'',after=snapshot.text[end]??'';
        if(/[0-9A-Za-z_.+\-]/.test(before)||/[0-9A-Za-z_+\-]/.test(after)
            ||after==='.'&&/[0-9A-Za-z_.+\-]/.test(snapshot.text[end+1]??'')
            ||/[*/%=^]/.test(before+after)||(before===','&&/[0-9]/.test(snapshot.text[start-2]??''))
            ||(after===','&&/[0-9]/.test(snapshot.text[end+1]??''))) continue;
        try {
            const value=fulfillmentDecimal(token[0]);
            if(compareCash(value,ZERO)>0) result.push({alias:`scalar:${result.length}`,text:token[0],value:cashText(value),ref:issueSourceRef(snapshot,{kind:'utf16',start,end})});
        } catch(error) {if(!(error instanceof RpcError)) throw error;}
    }
    return result;
}
async function allocationValue(context:FulfillmentContext,ref:SourceRef,source:PromiseFulfillmentSources,term:PromiseTerm):Promise<Decimal> {
    if(ref.resource.startsWith('fulfillment:current-input:')) {
        const snapshot=fulfillmentCurrentInputSource(source.scope,Number(context.turn.turn),string(context.turn.player_text??''));
        const candidate=fulfillmentNumericCandidates(snapshot).find(value=>same(value.ref,ref));
        if(!candidate) return fail('needs_source','The partial allocation is not an issued token from the current player input');
        return fulfillmentDecimal(candidate.value);
    }
    return scalarValue(context,ref,source,term);
}
function amountOf(effect:Row):Decimal {
    const value=cashDecimal(effect.kind==='cash'?effect.delta:effect.quantity??1);
    if(!value||compareCash(value,ZERO)<=0||effect.kind!=='cash'&&value.exponent<0) return fail('unsupported_terms','A fulfillment effect must carry a positive finite amount or integral quantity');
    return value;
}
async function canonicalOwner(context:FulfillmentContext,id:string):Promise<Row> {
    const instance=row(row(context.world.objects).instances)[id];
    const owner=instance?{kind:'object',id,name:instance.name}:await objectOwner(context.campaign,context.graph,context.world,id);
    if(owner.id!==id) return fail('fulfillment_target_changed','The term owner is not a canonical current identity');
    return owner;
}
async function effectOwners(context:FulfillmentContext,effect:Row,term:PromiseTerm):Promise<{sourceLabel:string|null}> {
    const recipient=await objectOwner(context.campaign,context.graph,context.world,effect.kind==='cash'?effect.subject:effect.to),payer=await canonicalOwner(context,term.payer);
    await canonicalOwner(context,term.beneficiary);
    if(recipient.id!==term.beneficiary) return fail('fulfillment_target_changed','The proposed effect names a different beneficiary');
    const actualPayer=await objectOwner(context.campaign,context.graph,context.world,effect.kind==='cash'?effect.with:effect.from);
    if(actualPayer.id!==payer.id) return fail('fulfillment_target_changed','The proposed effect names a different source owner');
    if(effect.kind==='cash') {
        if(recipient.kind!=='investigator'||payer.kind!=='npc'||effect.currency!==term.currency||effect.settlement==='spending_level'
            ||!['found','quote'].includes(effect.source)) return fail('unsupported_terms','A finite cash reward needs an existing beneficiary, payer and exact held currency');
        const sheet=(await context.campaign.party()).find(value=>value.id===term.beneficiary);
        if(row(row(sheet?.finance).cash).currency!==term.currency) return fail('fulfillment_target_changed','The beneficiary does not hold the bound cash currency');
        return {sourceLabel:null};
    }
    if(effect.kind==='item') {
        if(recipient.kind!=='investigator'||payer.kind!=='npc'||effect.name!==term.item||effect.weapon!==undefined)
            return fail('unsupported_terms','A simple item reward must use its bound item identity and ordinary nonweapon inventory path');
        const index=new EntityIndex(context.graph,await context.campaign.party() as Row[]),matches=index.matches(effect.from,{kinds:['npc'],investigators:false});
        if(matches.length!==1) return fail('fulfillment_target_changed','The item giver is not a unique current NPC');
        return {sourceLabel:index.canonicalName(matches[0])};
    }
    return {sourceLabel:ownerLabel(context.world,payer)};
}
export interface PreparedFulfillments {
    attach(stagedReceiptsByEffect:ReadonlyMap<number,Row[]>,stagedWorld:Row):void;
    prior:Map<string,PromiseFulfillmentView>;
}
/** Read-only validation before ordinary staging; attachment itself is all-or-nothing in memory. */
export async function prepareFulfillments(input:FulfillmentContext&{bindings:FulfillmentSelection[];effects:Row[]}):Promise<PreparedFulfillments> {
    if(!Array.isArray(input.bindings)||!input.bindings.length||input.bindings.length>8||!Array.isArray(input.effects))
        return fail('unsupported_terms','A bounded fulfillment selection is required');
    const bindings=clone(input.bindings) as FulfillmentSelection[],effects=clone(input.effects),scope=stateScope(input.campaign.id,await input.campaign.readCampaign());
    const snapshot=new CampaignSnapshot(input.kernel,input.campaign.id),history=await snapshot.files('turns');
    const receipts=clone([...history.flatMap(record=>array(record.receipts)),...array(input.turn.receipts)]) as Row[],receiptIds=new Map<string,Row>();
    for(const receipt of receipts) {
        const existing=receiptIds.get(receipt.id);
        if(existing&&!same(existing,receipt)) return fail('fulfillment_receipt_invalid','Current canonical receipt identities are inconsistent');
        receiptIds.set(receipt.id,receipt);
    }
    const prior=new Map<string,PromiseFulfillmentView>(),usedEffects=new Set<number>(),usedPromises=new Set<string>();
    const prepared:Array<{binding:PromiseTermsBinding;effectIndex:number;term:PromiseTerm;amount:Decimal;sourceLabel:string|null}>=[];
    for(const selection of bindings) {
        if(!closed(selection,['binding','effects'])||!Array.isArray(selection.effects)||!selection.effects.length||selection.effects.length>16)
            return fail('unsupported_terms','Each promise selection must bind its actual effect indices');
        const binding=selection.binding;validateFulfillmentTerms(binding,true);
        if(!same(scope,binding.scope)) return fail('promise_scope_mismatch','The fulfillment binding belongs to another campaign, worldline or loop');
        if(usedPromises.has(binding.promiseId)) return fail('unsupported_terms','One batch must use one complete terms binding per promise occurrence');
        usedPromises.add(binding.promiseId);
        const source=await promiseFulfillmentSources(input,binding.promiseId);
        if(!same(source.refs,binding.promiseRefs)) return fail('needs_source','The promise binding changed its exact original references');
        for(const id of binding.conditionReceipts) if(!receiptIds.has(id)) return fail('fulfillment_condition_missing','A selected condition receipt does not exist in current canonical history');
        const view=derivePromiseFulfillment(binding.promiseId,receipts,binding);prior.set(binding.promiseId,view);
        if(view.status==='complete') return fail('promise_already_fulfilled','This exact promise occurrence has already been fulfilled');
        const remaining=view.terms.map(term=>fulfillmentDecimal(term.remaining));
        for(const term of binding.terms) {
            const numeric=await scalarValue(input,term.total.source,source,term);
            if(compareCash(numeric,fulfillmentDecimal(term.total.value))!==0) return fail('unsupported_terms','A finite total differs from its exact scalar source');
            // A paid term is history: its source proof remains immutable, while its gifted property may move or cease to exist.
            if(compareCash(remaining[term.ordinal],ZERO)===0) continue;
            await canonicalOwner(input,term.beneficiary);await canonicalOwner(input,term.payer);
            const definitions=row(row(input.world.objects).definitions);
            if(term.kind==='object'&&!definitions[term.definition!]) return fail('unsupported_terms','The promised physical object has no accepted current definition');
            if(term.kind==='item') {
                const definition=term.definition?definitions[term.definition]:Object.values(definitions).find((value:any)=>value.name===term.item);
                const held=(await input.campaign.party()).some(person=>array(person.equipment).some(value=>typeof value==='string'?value===term.item:row(value).name===term.item));
                if(!held&&(!definition||row(definition).name!==term.item||row(definition).category!=='item'))
                    return fail('unsupported_terms','The simple item identity must already belong to typed equipment or an accepted item definition');
            }
            if(term.instance) {
                const instance=row(row(input.world.objects).instances)[term.instance];
                if(!instance||instance.definition!==term.definition||row(instance.owner).id!==term.payer)
                    return fail('fulfillment_target_changed','The promised instance is absent or has changed definition or source owner');
            }
        }
        for(const mapping of selection.effects) {
            if(!closed(mapping,['effect','term','amountSource'],['effect','term'])||!Number.isSafeInteger(mapping.effect)||mapping.effect<0||mapping.effect>=effects.length
                ||!Number.isSafeInteger(mapping.term)||mapping.term<0||mapping.term>=binding.terms.length||usedEffects.has(mapping.effect))
                return fail('unsupported_terms','Fulfillment effect indices must be unique and select an existing finite term');
            usedEffects.add(mapping.effect);
            const term=binding.terms[mapping.term],effect=effects[mapping.effect];
            if(effect.kind!==term.kind) return fail('fulfillment_target_changed','The effect family differs from its selected term');
            const amount=amountOf(effect),left=remaining[mapping.term];
            if(compareCash(amount,left)>0) return fail('promise_overfulfilled','The proposed effect exceeds this promise term remainder');
            const amountSource=(mapping as any).amountSource as SourceRef|undefined;
            if(amountSource) {
                try{assertSourceRef(amountSource);}catch{return fail('needs_source','The partial allocation has no valid source reference');}
                if(compareCash(await allocationValue(input,amountSource,source,term),amount)!==0) return fail('unsupported_terms','The partial allocation differs from its selected scalar source');
            } else if(compareCash(amount,left)!==0) return fail('needs_source','A partial allocation needs its own exact scalar source');
            remaining[mapping.term]=addCash(left,negate(amount));
            const owners=await effectOwners(input,effect,term);
            prepared.push({binding,effectIndex:mapping.effect,term,amount,sourceLabel:owners.sourceLabel});
        }
    }
    let attached=false;
    return {prior,attach(stagedReceiptsByEffect,stagedWorld) {
        if(attached) return fail('fulfillment_plan_reused','The prepared fulfillment attachment has already been consumed');
        const pending:Array<{receipt:Row;link:Row}>=[],seen=new Set<string>(),simulated=[...receipts];
        for(const value of prepared) {
            const candidates=(stagedReceiptsByEffect.get(value.effectIndex)??[]).filter(receipt=>receipt.kind===(value.term.kind==='cash'?'cash':'item'));
            if(candidates.length!==1) return fail('fulfillment_receipt_invalid','A bound effect must produce exactly one primary cash or item receipt');
            const receipt=candidates[0];
            if(seen.has(receipt.id)||receiptIds.has(receipt.id)||receipt.fulfillment!==undefined) return fail('fulfillment_receipt_invalid','A fulfillment cannot reuse an existing canonical effect receipt');
            seen.add(receipt.id);
            if(value.term.kind!=='cash'&&receipt.from!==value.sourceLabel) return fail('fulfillment_receipt_invalid','The staged transfer has a different source owner');
            if(value.term.kind==='cash'&&receipt.source!==effects[value.effectIndex].source) return fail('fulfillment_receipt_invalid','The staged cash source differs from the prepared effect');
            if(value.term.kind==='object') {
                const instance=row(row(stagedWorld.objects).instances)[receipt.instance],definition=row(row(stagedWorld.objects).definitions)[value.term.definition!];
                if(!instance||!definition||instance.definition!==value.term.definition||row(instance.owner).id!==value.term.beneficiary
                    ||receipt.name!==instance.name||!same(receipt.state,instance.state)
                    ||compareCash(cashDecimal(instance.quantity)??ZERO,cashDecimal(receipt.quantity)??ZERO)!==0)
                    return fail('fulfillment_receipt_invalid','The staged physical instance does not match the accepted definition, quantity and destination');
            }
            const actual=fulfillmentReceiptAmount(receipt,value.term);
            if(compareCash(actual,value.amount)!==0) return fail('fulfillment_receipt_invalid','The actual effect amount differs from its source-bound proposed amount');
            const link:Row={version:1,promise:value.binding.promiseId,promise_source_refs:clone(value.binding.promiseRefs),scope:clone(value.binding.scope),
                terms_digest:value.binding.digest,terms:clone(value.binding.terms),term:value.term.ordinal,condition_receipts:[...value.binding.conditionReceipts],
                applied:cashText(actual),status:'partial',...(value.sourceLabel===null?{}:{source_label:value.sourceLabel})};
            const staged={...receipt,fulfillment:link};simulated.push(staged);
            link.status=derivePromiseFulfillment(value.binding.promiseId,simulated,value.binding).status;
            pending.push({receipt,link});
        }
        // No staged receipt changes until every link and the whole-batch conservation checks passed.
        for(const value of pending) value.receipt.fulfillment=value.link;
        attached=true;
    }};
}
