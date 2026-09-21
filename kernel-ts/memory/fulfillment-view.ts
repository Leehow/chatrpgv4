/** Pure receipt-derived promise fulfillment. No graph, campaign I/O, or effect authority. */
import {RpcError} from '../errors.js';
import {jsonDigest} from '../json.js';
import {cashDecimal,addCash,compareCash,cashText,cashStorage,type Decimal} from '../apply/cash.js';
import {assertSourceRef} from '../../runtime/jev/source-ref.ts';
import type {SourceRef} from '../../runtime/jev/value-contracts.ts';
type Row=Record<string,any>;
const row=(value:any):Row=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value:{};

export interface PromiseScope {campaign:string;worldline:string;loop:number}
export interface PromiseTerm {
    ordinal:number;kind:'cash'|'item'|'object';total:{source:SourceRef;value:string};
    currency?:string;definition?:string;instance?:string;item?:string;beneficiary:string;payer:string;
}
export interface PromiseTermsBinding {
    version:1;promiseId:string;promiseRefs:SourceRef[];scope:PromiseScope;terms:PromiseTerm[];
    conditionReceipts:string[];coverage:{complete:true;used:SourceRef[];omitted:[]};digest:string;
}
export interface FulfillmentSelection {binding:PromiseTermsBinding;effects:Array<{effect:number;term:number;amountSource?:SourceRef}>}
export interface PromiseFulfillmentView {status:'open'|'partial'|'complete';terms:Array<Row>}
const ZERO:Decimal={coefficient:0n,exponent:0};
const fail=(reason:string,message:string):never=>{throw new RpcError('needs',message,{details:{reason}});};
const same=(a:any,b:any)=>jsonDigest(a)===jsonDigest(b);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=2048;
const closed=(v:any,keys:string[],required=keys):v is Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)
    && Object.keys(v).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(v,key));
const negate=(value:Decimal):Decimal=>({...value,coefficient:-value.coefficient});
/** Closed numeric syntax only. The semantic role of the selected token remains the owner decision. */
export function fulfillmentDecimal(value:string):Decimal {
    if(typeof value!=='string'||value.length>128) return fail('unsupported_terms','A finite bounded exact decimal is required');
    const match=/^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(value);
    if(!match) return fail('unsupported_terms','Terms must use exact JSON-number tokens or typed numeric records');
    const fraction=match[3]??'',exponent=Number(match[4]??0)-fraction.length;
    if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>400) return fail('unsupported_terms','The decimal scale is outside the supported finite bound');
    return addCash(ZERO,{coefficient:BigInt(`${match[1]}${match[2]}${fraction}`),exponent});
}
export function fulfillmentDecimalStorage(value:string):any {
    const stored=cashStorage(fulfillmentDecimal(value));
    if(stored===null) return fail('unsupported_terms','The amount cannot be represented by the canonical cash boundary without rounding');
    return stored;
}
export function fulfillmentBindingDigest(binding:Pick<PromiseTermsBinding,'version'|'promiseId'|'promiseRefs'|'scope'|'terms'>):string {
    return jsonDigest({version:binding.version,promiseId:binding.promiseId,promiseRefs:binding.promiseRefs,scope:binding.scope,terms:binding.terms} as any);
}
export function validateFulfillmentTerms(binding:any,full:boolean):asserts binding is PromiseTermsBinding {
    if(!closed(binding,['version','promiseId','promiseRefs','scope','terms','conditionReceipts','coverage','digest'],
        ['version','promiseId','promiseRefs','scope','terms','digest'])||binding.version!==1||!text(binding.promiseId)
        ||!closed(binding.scope,['campaign','worldline','loop'])||!text(binding.scope.campaign)||!text(binding.scope.worldline)
        ||!Number.isSafeInteger(binding.scope.loop)||binding.scope.loop<0||!Array.isArray(binding.promiseRefs)||!binding.promiseRefs.length||binding.promiseRefs.length>16
        ||!Array.isArray(binding.terms)||!binding.terms.length||binding.terms.length>8)
        return fail('unsupported_terms','A bounded source-bound promise terms binding is required');
    for(const ref of binding.promiseRefs) {try{assertSourceRef(ref);}catch{return fail('needs_source','A promise source reference is invalid');}}
    for(const [ordinal,term] of binding.terms.entries()) {
        if(!closed(term,['ordinal','kind','total','currency','definition','instance','item','beneficiary','payer'],['ordinal','kind','total','beneficiary','payer'])
            ||term.ordinal!==ordinal||!['cash','item','object'].includes(term.kind)||!text(term.beneficiary)||!text(term.payer)
            ||!closed(term.total,['source','value'])) return fail('unsupported_terms','Every finite term needs an ordered kind, scalar, beneficiary and source owner');
        try{assertSourceRef(term.total.source);}catch{return fail('needs_source','The finite total has no valid source reference');}
        const total=fulfillmentDecimal(term.total.value);
        if(compareCash(total,ZERO)<=0||cashText(total)!==term.total.value||(term.kind!=='cash'&&total.exponent<0))
            return fail('unsupported_terms','Totals must be positive canonical decimals, with integral item quantities');
        if(term.kind==='cash' ? !text(term.currency)||term.definition!==undefined||term.instance!==undefined||term.item!==undefined
            : term.currency!==undefined || (term.kind==='object' ? !text(term.definition)||term.item!==undefined||term.instance!==undefined&&!text(term.instance)
                : !text(term.item)||term.instance!==undefined||term.definition!==undefined&&!text(term.definition)))
            return fail('unsupported_terms','The term unit must match its cash, item or object effect family');
    }
    if(binding.digest!==fulfillmentBindingDigest(binding as PromiseTermsBinding)) return fail('fulfillment_terms_changed','The finite terms digest does not match its source binding');
    if(full) {
        if(!Array.isArray(binding.conditionReceipts)||!binding.conditionReceipts.length||binding.conditionReceipts.length>16
            ||binding.conditionReceipts.some((id:any)=>!text(id))||new Set(binding.conditionReceipts).size!==binding.conditionReceipts.length
            ||!closed(binding.coverage,['complete','used','omitted'])||binding.coverage.complete!==true||!Array.isArray(binding.coverage.used)
            ||!binding.coverage.used.length||binding.coverage.used.length>32||!Array.isArray(binding.coverage.omitted)||binding.coverage.omitted.length)
            return fail('unsupported_terms','Complete finite term coverage and actual condition receipts are required');
        const required=[...binding.promiseRefs,...binding.terms.map((term:PromiseTerm)=>term.total.source)];
        for(const ref of binding.coverage.used) if(!required.some(value=>same(value,ref))) return fail('needs_source','Coverage refers to an unbound source');
        for(const ref of required) if(!binding.coverage.used.some((value:SourceRef)=>same(value,ref))) return fail('unsupported_terms','Coverage omitted a promise or finite scalar source');
    }
}
function linkBinding(link:Row):PromiseTermsBinding {
    const binding={version:link.version,promiseId:link.promise,promiseRefs:link.promise_source_refs,scope:link.scope,terms:link.terms,digest:link.terms_digest} as PromiseTermsBinding;
    validateFulfillmentTerms(binding,false);return binding;
}
export function fulfillmentReceiptAmount(receipt:Row,term:PromiseTerm,link?:Row):Decimal {
    if(!text(receipt.id)||!text(receipt.call_id)||receipt.subject!==term.beneficiary) return fail('fulfillment_receipt_invalid','The canonical effect receipt has a different beneficiary');
    let value:Decimal|null;
    if(term.kind==='cash') {
        if(receipt.kind!=='cash'||receipt.currency!==term.currency||receipt.with!==term.payer||receipt.settlement==='spending_level')
            return fail('fulfillment_receipt_invalid','The canonical cash receipt has a different currency, source or settlement');
        value=cashDecimal(receipt.delta);
        const before=cashDecimal(receipt.before),after=cashDecimal(receipt.after);
        if(!value||!before||!after||compareCash(addCash(before,value),after)!==0) return fail('fulfillment_receipt_invalid','The canonical cash receipt does not conserve its actual balance');
    } else {
        if(receipt.kind!=='item'||term.kind==='object'&&!text(receipt.instance)||term.kind==='item'&&(receipt.instance!=null||receipt.name!==term.item)
            ||term.instance!==undefined&&receipt.instance!==term.instance&&receipt.divided_from_instance!==term.instance)
            return fail('fulfillment_receipt_invalid','The item receipt does not match the promised item or physical instance');
        value=cashDecimal(receipt.quantity);
        if(!value||value.exponent<0) return fail('fulfillment_receipt_invalid','An item fulfillment requires an actual integral quantity');
        if(term.kind==='item') {
            const before=cashDecimal(receipt.before),after=cashDecimal(receipt.after);
            if(!before||!after||compareCash(addCash(before,value),after)!==0) return fail('fulfillment_receipt_invalid','The canonical item receipt does not conserve holdings');
        }
        if(link&&(!text(link.source_label)||receipt.from!==link.source_label)) return fail('fulfillment_receipt_invalid','The canonical transfer source differs from its verified source label');
    }
    if(!value||compareCash(value,ZERO)<=0) return fail('fulfillment_receipt_invalid','Fulfillment must record a strictly positive actual delta or quantity');
    if(link&&cashText(value)!==link.applied) return fail('fulfillment_receipt_invalid','The fulfillment amount differs from the actual canonical receipt');
    return value;
}
/** Rebuild from receipts only. No memory row or auxiliary fulfillment counter is changed. */
export function derivePromiseFulfillment(promiseId:string,receipts:readonly Row[],expected?:PromiseTermsBinding|{scope:PromiseScope;promiseRefs?:SourceRef[]}):PromiseFulfillmentView {
    let binding=expected&&'terms' in expected?expected:undefined;
    if(binding) validateFulfillmentTerms(binding,false);
    const seen=new Map<string,Row>(),totals=new Map<number,Decimal>(),knownReceipts=new Set(receipts.map(receipt=>receipt.id));
    for(const receipt of receipts) {
        const link=row(receipt.fulfillment);
        if(link.promise!==promiseId) continue;
        if(expected&&!same(link.scope,expected.scope)) continue;
        const current=linkBinding(link);
        if(expected?.promiseRefs&&!same(current.promiseRefs,expected.promiseRefs)) return fail('fulfillment_terms_changed','A reused promise identity points at a different original occurrence');
        if(binding&&current.digest!==binding.digest) return fail('fulfillment_terms_changed','The same promise occurrence has incompatible finite terms');
        binding??=current;
        if(!same(binding.scope,current.scope)) return fail('promise_scope_mismatch','Promise receipts from different scopes cannot be combined');
        if(!Array.isArray(link.condition_receipts)||!link.condition_receipts.length||link.condition_receipts.some((id:any)=>!knownReceipts.has(id))||!['partial','complete'].includes(link.status)
            ||!Number.isSafeInteger(link.term)||link.term<0||link.term>=binding.terms.length)
            return fail('fulfillment_receipt_invalid','The canonical fulfillment link is incomplete');
        const previous=seen.get(receipt.id);
        if(previous) {if(!same(previous,receipt)) return fail('fulfillment_receipt_invalid','Duplicate receipt identity has different effect data');continue;}
        seen.set(receipt.id,receipt);
        const value=fulfillmentReceiptAmount(receipt,binding.terms[link.term],link);
        totals.set(link.term,addCash(totals.get(link.term)??ZERO,value));
    }
    if(!binding) return {status:'open',terms:[]};
    let complete=true;
    const terms=binding.terms.map(term=>{
        const fulfilled=totals.get(term.ordinal)??ZERO,remaining=addCash(fulfillmentDecimal(term.total.value),negate(fulfilled));
        if(compareCash(remaining,ZERO)<0) return fail('promise_overfulfilled','Canonical receipts exceed the finite promise total');
        if(compareCash(remaining,ZERO)>0) complete=false;
        return {ordinal:term.ordinal,kind:term.kind,total:term.total.value,fulfilled:cashText(fulfilled),remaining:cashText(remaining),
            ...Object.fromEntries(['currency','definition','instance','item'].filter(key=>Object.hasOwn(term,key)).map(key=>[key,(term as any)[key]]))};
    });
    return {status:!seen.size?'open':complete?'complete':'partial',terms};
}
