/** Closed selections over the canonical fulfillment catalog; no effect or number is generated. */
import {isPlainRecord,type DecisionBatch,type DecisionDescriptor,type DecisionQuestion,type Json} from './contracts.ts';
import type {TaskStep,TaskView} from './task-runtime.ts';
import {JEV_MODEL,packDecisionBatch} from './question-packing.ts';
type Row=Record<string,any>;
export const FULFILLMENT_POLICY_VERSION='1';
const FAMILY='promise-fulfillment',VERSION=FULFILLMENT_POLICY_VERSION;
const finish=(status:'complete'|'partial'|'needs_player',needs:string[]):TaskStep=>({kind:'finish',status,remainingNeeds:needs});
const pick=(view:TaskView,key:string,q:string):string|undefined=>{const a=view.decisions.find(x=>x.key===key)?.result.answers[q];return a?.status==='answered'&&a.type==='choice'?a.choice:undefined;};
const asked=(view:TaskView,key:string)=>view.decisions.some(x=>x.key===key);
const choices=(rows:Row[],describe:(row:Row)=>DecisionDescriptor):Record<string,DecisionDescriptor>=>Object.fromEntries(rows.map(row=>[row.alias,describe(row)]));
const question=(key:string,instructions:string,criteria:Record<string,DecisionDescriptor>):DecisionQuestion=>({key,target:key,type:'choice',instructions,criteria});
function decide(view:TaskView,key:string,state:Row,questions:DecisionQuestion[]):TaskStep {
  const batch:Omit<DecisionBatch,'id'|'scope'|'readSet'>={model:JEV_MODEL,family:FAMILY,familyVersion:VERSION,state:state as Json,questions};
  try{packDecisionBatch({...batch,id:'validation',scope:view.context.scope,readSet:view.context.readSet});}
  catch{return finish('partial',['The complete fulfillment evidence exceeds the bounded decision input.']);}
  return {kind:'decision',key,batch};
}
const operation=(name:string,key:string,args:Record<string,Json>):TaskStep=>({kind:'operation',key,operation:name,args,capability:'apply',basis:[]});
const find=(rows:Row[],alias:string|undefined)=>rows.find(row=>row.alias===alias);
const unavailable=()=>finish('partial',['Required fulfillment evidence, a finite source value or an issued identity is unavailable.']);

/** Returns null when the goal does not request fulfillment and ordinary effect selection should continue. */
export function fulfillmentStep(view:TaskView,rawInput:string,options:Row):TaskStep|null {
  const navigation=options.promises;
  if(!Array.isArray(navigation)||!navigation.length)return null;
  if(!isPlainRecord(options.private_promises)||navigation.some(p=>!isPlainRecord(p)||typeof p.alias!=='string'||typeof p.statement!=='string'))return unavailable();
  const relevance='fulfillment-request';
  if(!asked(view,relevance))return decide(view,relevance,{rawInput,goal:view.plan.goal,promises:navigation},navigation.map(p=>question(p.alias,
    'Does the current declaration request actual fulfillment of this promise? Asking what was said, accepting a job, or asking for leads is not a request for payment or a gift. An unclear possible match needs original evidence.',
    {inspect:'This promise may be the reward being claimed now; inspect its original and current conditions.',not_requested:'The current goal does not request this reward.',unknown:'It may be the requested reward but the short record is insufficient.'})));
  const requested=navigation.filter(p=>['inspect','unknown'].includes(pick(view,relevance,p.alias)??'unknown'));
  if(!requested.length)return null;
  if(requested.length>8||requested.some(p=>typeof options.private_promises[p.alias]!=='string'))return unavailable();
  const packet=view.observations.find(x=>x.proposal.operation==='apply.fulfillment.options');
  if(!packet)return operation('apply.fulfillment.options','fulfillment-options',{promises:requested.map(p=>options.private_promises[p.alias])});
  if(packet.packet.status!=='succeeded'||!isPlainRecord(packet.packet.result))return unavailable();
  const body=packet.packet.result as Row,rawCatalog=body.catalog;
  if(typeof body.snapshot!=='string'||!isPlainRecord(rawCatalog)||['promises','beneficiaries','payers','objects','conditions','allocations'].some(k=>!Array.isArray(rawCatalog[k])))return unavailable();
  const catalog=rawCatalog as Row & {promises:Row[];beneficiaries:Row[];payers:Row[];objects:Row[];conditions:Row[];allocations:Row[]};
  const state={rawInput,goal:view.plan.goal,constraints:view.plan.constraints,current:options.context,
    unsupported_capabilities:Array.isArray(catalog.unsupported_capabilities)?catalog.unsupported_capabilities:Array.isArray(catalog.unavailable)?catalog.unavailable:[],
    operation_contract:'A supported reward settles through canonical apply before guarded narration describes it. A promise or retrieval result alone never pays. Use actual condition receipts, original attribution, finite units and current ownership. Do not invent values, new goals or a willing payer.'};
  const selections:Row[]=[];
  for(const promise of catalog.promises as Row[]) {
    if(!isPlainRecord(promise)||typeof promise.alias!=='string'||!Array.isArray(promise.scalars)||!Array.isArray(promise.original_context)
      ||promise.original_context.some((p:Row)=>p.omitted===true||p.speech_omitted===true||Array.isArray(p.speech)&&p.speech.some((s:Row)=>s.omitted===true)))return unavailable();
    const prefix=`fulfillment:${promise.alias}`,original={...state,promise,beneficiaries:catalog.beneficiaries,payers:catalog.payers};
    const requestKey=`${prefix}:due`;
    if(!asked(view,requestKey))return decide(view,requestKey,{...original,conditions:catalog.conditions},[
      question('due','Is this exact original promise now due and requested, supported by actual condition receipts and the current situation? A player assertion, a retrieved report, absent module text, or the planner goal does not itself prove completion. Do not pay an already completed promise or an unavailable/unwilling source.',
        {due:'The exact promise is due now and the player requested its fulfillment.',not_due:'It is not due, already fulfilled, not requested or cannot be delivered now.',unknown:'Completion, applicability, payer authority or requested fulfillment is unresolved.'}),
      question('terms','Are all reward terms finite cash totals or identified existing physical gifts with issued scalar/quantity evidence? A rate, formula, ambiguous unit or number available only as unbound words is unsupported.',
        {finite:'All finite reward terms can be bound from this catalog.',unsupported:'At least one required term, number, unit or definition cannot be bound.',unknown:'Complete finite terms cannot be determined.'}),
      question('amount_shape','Independently classify the original reward amount. A numeric token followed by a per-day, per-person, percentage, profit or other computational relation is not itself a fixed total. The existence of that token or a matching wallet amount does not remove the relation.',
        {fixed:'Only fixed finite totals or identified existing physical quantities are promised.',rate_or_formula:'At least one term requires a rate, duration, division, formula or conversion.',unknown:'A required total or its unit relationship is unclear.'}),
      ...catalog.conditions.map((c:Row)=>question(c.alias,`Does this actual receipt support a condition of ${promise.alias}? Only include a receipt that bears on this promise, not an unrelated successful action.`,
        {supports:'This actual receipt supports the required condition.',irrelevant:'It does not support a required condition.',unknown:'Its relevance or adequacy is unresolved.'})),
    ]);
    const due=pick(view,requestKey,'due');
    if(due==='not_due')continue;
    if(due!=='due'||pick(view,requestKey,'terms')!=='finite'||pick(view,requestKey,'amount_shape')!=='fixed')return unavailable();
    const conditions=catalog.conditions.filter((c:Row)=>pick(view,requestKey,c.alias)==='supports').map((c:Row)=>c.alias);
    if(!conditions.length||conditions.length>16)return unavailable();
    const terms:Row[]=[];
    if(Array.isArray(promise.prior_terms)) {
      for(const prior of promise.prior_terms as Row[]) {
        const key=`${prefix}:prior:${prior.alias}`;
        if(String(prior.remaining)==='0'){terms.push({prior:prior.alias,allocation:'defer'});continue;}
        if(!asked(view,key))return decide(view,key,{...original,term:prior,allocations:catalog.allocations},[
          question('allocation','Select only the current requested allocation of this immutable remaining term. Its original total and identities cannot change.',
            {remaining:'Settle its exact remaining amount now.',defer:'Leave this known term owed for a later settlement.',...choices(catalog.allocations,(r:Row)=>({text:r.text,value:r.value})),unknown:'The requested allocation is not bound.'}),
          ...(prior.kind==='object'?[question('handover','Does this current physical reward transfer have a willing giver and willing recipient? An old promise is not permission to take by force; a check-based transfer remains with its incumbent owner.',
            {given:'Both parties willingly make this due gift now.',not_given:'Do not make this transfer now.',unknown:'Current willingness is unresolved.'})]:[]),
        ]);
        const allocation=pick(view,key,'allocation');
        if(!allocation||!['remaining','defer'].includes(allocation)&&!find(catalog.allocations,allocation))return unavailable();
        if(prior.kind==='object'&&allocation!=='defer'&&pick(view,key,'handover')!=='given')return unavailable();
        terms.push({prior:prior.alias,allocation,...(prior.kind==='object'&&allocation!=='defer'?{handover:'given'}:{})});
      }
    } else {
      let ended=false;
      for(let termIndex=0;termIndex<=8;termIndex++) {
        const key=`${prefix}:term:${termIndex}`,known={...original,selected_terms:terms,objects:catalog.objects};
        if(!asked(view,key))return decide(view,key,known,[question('kind',
          'Select the next distinct finite reward term in the original promise that selected_terms has not accounted for. Do not split one entitlement into duplicate terms. Done means every reward in the original is accounted for, not that one useful term was found.',
          {cash:'One further finite cash term.',object:'One further existing physical gift.',done:'Every finite reward term has been selected.',unsupported:'A remaining term is outside the supported catalog.',unknown:'Remaining reward coverage is unresolved.'})]);
        const kind=pick(view,key,'kind');
        if(kind==='done'){ended=true;break;}
        if(!['cash','object'].includes(kind??'')||termIndex===8)return unavailable();
        const targetKey=`${key}:target`;
        if(!asked(view,targetKey))return decide(view,targetKey,{...known,kind},[
          question('beneficiary','Select the actual beneficiary of this next reward term; never substitute a convenient character.',{...choices(catalog.beneficiaries,r=>r.name),unknown:'No single issued beneficiary is supported.'}),
          ...(kind==='cash'?[question('payer','Select the actual promising payer of this cash term. Another NPC report does not authorize their funds.',{...choices(catalog.payers,r=>r.name),unknown:'No single issued payer is supported.'})]
            :[question('object','Select the exact existing physical gift in this next term. A similarly named or unaccepted definition is not a substitute.',{...choices(catalog.objects,r=>({name:r.name,definition:r.definition_name,payer:r.payer})),unknown:'No existing issued physical gift matches.'})]),
        ]);
        const beneficiary=find(catalog.beneficiaries,pick(view,targetKey,'beneficiary'));
        const object=kind==='object'?find(catalog.objects,pick(view,targetKey,'object')):undefined;
        const payer=kind==='cash'?find(catalog.payers,pick(view,targetKey,'payer')):object?find(catalog.payers,object.payer):undefined;
        if(!beneficiary||!payer||kind==='object'&&!object)return unavailable();
        const scalarKey=`${key}:scalar`;
        const scalars=(promise.scalars as Row[]).filter(s=>s.kind==='token'||kind==='cash'&&s.kind==='cash'||kind==='object'&&s.kind==='object'&&s.object===object!.alias);
        if(!asked(view,scalarKey))return decide(view,scalarKey,{...original,kind,selected_terms:terms,beneficiary,payer,
          ...(object?{object}:{}),scalars,allocations:catalog.allocations},[
          question('total','Select the exact scalar for the full finite entitlement of this term. A date, required task count, previous unrelated payment, rate or current wallet balance is not the promised total.',
            {...choices(scalars,r=>({source:r.text,value:r.value,kind:r.kind,...(r.currency?{currency:r.currency}:{}),...(r.origin?{origin:r.origin}:{})})),unknown:'No exact issued scalar supports the full total.'}),
          ...(kind==='cash'?[question('currency','Select the issued beneficiary currency explicitly matching this cash term; no conversion or inferred default unit.',
            {...choices(beneficiary.currencies??[],r=>r.name),unknown:'No issued currency matches.'})]:[]),
          question('allocation','Select the requested amount of this known term for the current effect batch. Remaining means its full finite total for this first fulfillment. Do not invent a partial amount.',
            {remaining:'Settle the exact finite entitlement now.',defer:'Keep this known term owed for later.',...choices(catalog.allocations,r=>({text:r.text,value:r.value})),unknown:'Current allocation is not bound.'}),
          ...(kind==='object'?[question('handover','Does the exact selected physical gift have both a willing giver and willing recipient now? Do not replace a required contested check or forceful taking with a promised-gift route.',
            {given:'Both parties willingly make the due gift now.',not_given:'Do not transfer it now.',unknown:'Current willingness is unresolved.'})]:[]),
        ]);
        const total=find(scalars,pick(view,scalarKey,'total')),allocation=pick(view,scalarKey,'allocation');
        const currency=kind==='cash'?find(beneficiary.currencies??[],pick(view,scalarKey,'currency')):undefined;
        if(!total||kind==='cash'&&!currency||!allocation||!['remaining','defer'].includes(allocation)&&!find(catalog.allocations,allocation))return unavailable();
        if(kind==='object'&&allocation!=='defer'&&pick(view,scalarKey,'handover')!=='given')return unavailable();
        const term={kind,total:total.alias,beneficiary:beneficiary.alias,payer:payer.alias,...(currency?{currency:currency.alias}:{}),...(object?{object:object.alias}:{}),allocation,
          ...(kind==='object'&&allocation!=='defer'?{handover:'given'}:{})};
        if(terms.some(value=>JSON.stringify({...value,allocation:null,handover:null})===JSON.stringify({...term,allocation:null,handover:null})))return unavailable();
        terms.push(term);
      }
      if(!ended||!terms.length)return unavailable();
    }
    if(terms.every(term=>term.allocation==='defer'))continue;
    const coverageKey=`${prefix}:complete`;
    if(!asked(view,coverageKey))return decide(view,coverageKey,{...original,terms,conditions:catalog.conditions.filter((c:Row)=>conditions.includes(c.alias)),scalars:promise.scalars,objects:catalog.objects},[
      question('complete','Check all original reward terms, attribution, finite units, identities, exact scalar meaning, condition evidence and requested allocations. No term may be omitted, duplicated, inferred from an unrelated number or relabeled to permit payment. Known deferred terms remain owed. This must cover the whole original promise before any partial fulfillment.',
        {supported:'All finite terms and the current requested allocations are supported.',unsupported:'The binding omits, duplicates, reinterprets or invents a term or condition.',unknown:'Any required part remains unresolved.'}),
    ]);
    if(pick(view,coverageKey,'complete')!=='supported')return unavailable();
    selections.push({promise:promise.alias,conditions,coverage:'complete',terms});
  }
  if(!selections.length)return finish('complete',['No requested promise is due for an additional effect now.']);
  const prepared=view.observations.find(x=>x.proposal.operation==='apply.fulfillment.prepare');
  if(!prepared)return operation('apply.fulfillment.prepare','fulfillment-prepare',{snapshot:body.snapshot,selections:selections as unknown as Json});
  if(prepared.packet.status!=='succeeded'||!isPlainRecord(prepared.packet.result))return unavailable();
  const ready=prepared.packet.result as Row;
  if(!Array.isArray(ready.effects)||!ready.effects.length||!isPlainRecord(ready.bindings)||!Array.isArray(ready.bindings.fulfillments))return unavailable();
  return {kind:'operation',key:'apply-settlement',operation:'apply',capability:'apply',basis:[],args:{effects:ready.effects as Json[]},bindings:ready.bindings as {fulfillments:Json[]}};
}
