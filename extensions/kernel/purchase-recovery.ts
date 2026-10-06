/** Host policy: an unpaid purchase keeps its terms and dependent deliveries across retries. */
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {decimalSpelling,addCash,multiplyCash,cashText} from '../../shared/cash-decimal.js';
import {KernelError,isKernelError} from './client.ts';

type Row=Record<string,any>;
type Hold={key:string;effect:Row;deliveries:Row[];amount:string;cash_debit?:number;turn:number};
type State={version:1;lines:Record<string,Hold[]>;aliases?:Record<string,Record<string,string>>};
const name=(value:unknown)=>typeof value==='string'?value.normalize('NFKC').trim().toLowerCase():'';
const numberOf=(value:unknown)=>decimalSpelling(typeof value==='number'?String(value):value);
const priced=(effect:Row)=>effect.kind==='cash'&&effect.mode!=='quote'&&!effect.owed&&effect.category!=='transfer'&&Array.isArray(effect.items);
function amountOf(items:Row[]):string|undefined{
  if(!items.length||items.length>24)return;
  let total={coefficient:0n,exponent:0};
  for(const item of items){const qty=numberOf(item.quantity),unit=numberOf(item.unit_price);if(typeof item.name!=='string'||!item.name.trim()||!qty||!unit||qty.coefficient<=0n||unit.coefficient<0n)return;total=addCash(total,multiplyCash(qty,unit));}
  return total.coefficient>0n?cashText(total):undefined;
}
function terms(effect:Row):string{
  return JSON.stringify(effect.items.map((item:Row)=>[name(item.name),numberOf(item.unit_price)?cashText(numberOf(item.unit_price)!):null]).sort((a:any,b:any)=>a[0].localeCompare(b[0])));
}
export class PurchaseRecovery{
  private readonly path:string;
  private readonly home:string;
  private readonly campaign:string;
  private readonly party:Array<{id?:string;name:string}>;
  private aliases=new Map<string,string>();
  private activeLine:string|undefined;
  constructor(home:string,campaign:string,party:Array<{id?:string;name:string}>){
    this.home=home;this.campaign=campaign;this.party=party;
    this.path=join(home,'.coc/campaigns',campaign,'purchase-recovery.json');
  }
  private subject(effect:Row){const who=name(effect.subject??effect.to);return this.party.find(p=>[name(p.id),name(p.name)].includes(who))?.id??(who||this.party[0]?.id||name(this.party[0]?.name));}
  private seller(value:unknown){return this.aliases.get(name(value))??name(value);}
  private key(effect:Row){return JSON.stringify([this.subject(effect),this.seller(effect.with),effect.items.map((i:Row)=>name(i.name)).sort()]);}
  private payment(hold:Hold,e:Row){return e.kind==='cash'&&e.mode!=='quote'&&e.mode!=='cancel'&&(Array.isArray(e.items)&&this.key(e)===this.key(hold.effect)||typeof e.quote==='string'&&name(e.quote)===name(hold.effect.bill??hold.effect.quote));}
  private cancellation(hold:Hold,e:Row){return e.kind==='cash'&&e.mode==='cancel'&&this.subject(e)===this.subject(hold.effect)&&name(e.bill??e.quote)===name(hold.effect.bill??hold.effect.quote);}
  private async effects(payload:Row):Promise<Row[]>{
    const effects:Array<Row>=Array.isArray(payload.effects)?payload.effects:[];
    if(!effects.some(e=>e.kind==='cash'&&e.mode!=='quote'&&e.mode!=='cancel'&&typeof e.quote==='string'&&!e.items))return effects;
    const world=JSON.parse(await readFile(join(this.home,'.coc/campaigns',this.campaign,'world.json'),'utf8'));
    return effects.map(e=>{if(e.kind!=='cash'||e.items||e.mode==='quote'||e.mode==='cancel')return e;
      const quote=world.cash_quotes?.find((q:Row)=>name(q.name)===name(e.quote)&&name(q.subject)===name(this.subject(e))&&!q.settled&&!q.cancelled);
      return quote?{...quote,...e,items:quote.items}:e;});
  }
  private async state():Promise<{state:State;line:string;holds:Hold[]}>{
    let meta:Row={};try{meta=JSON.parse(await readFile(join(this.home,'.coc/campaigns',this.campaign,'campaign.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const active=String(meta.active_worldline??'main'),loop=meta.worldlines?.[active]?.loop??0;
    const line=loop?`${active}@${loop}`:active;let state:State;
    try{state=JSON.parse(await readFile(this.path,'utf8'));}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new KernelError({code:'needs',message:'Purchase recovery state is unreadable',fix:'Repair the retained policy record before another purchase or its dependent delivery.'});state={version:1,lines:{}};}
    if(state.version!==1||!state.lines||typeof state.lines!=='object'||Array.isArray(state.lines)||Object.values(state.lines).some(rows=>!Array.isArray(rows)||rows.some(r=>!r||typeof r.key!=='string'||!Array.isArray(r.effect?.items)||!amountOf(r.effect.items)||!Array.isArray(r.deliveries))))
      throw new KernelError({code:'needs',message:'Purchase recovery state is invalid',fix:'Repair the retained policy record; do not bypass its payment holds.'});
    if(this.activeLine!==undefined&&this.activeLine!==line)this.aliases.clear();this.activeLine=line;
    for(const [alias,canonical] of Object.entries(state.aliases?.[line]??{}))this.aliases.set(alias,canonical);
    return {state,line,holds:state.lines[line]??[]};
  }
  async observe(payload:Row,previews:Row[]):Promise<void>{
    await this.state();
    for(const r of previews){const effect=payload.effects?.[r.index];if(effect?.with&&typeof r.with==='string'){
      const canonical=name(r.with);for(const alias of [effect.with,r.with,r.with_label])if(typeof alias==='string')this.aliases.set(name(alias),canonical);
    }}
  }
  private async save(state:State){await mkdir(join(this.home,'.coc/campaigns',this.campaign),{recursive:true});const tmp=this.path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(state));await rename(tmp,this.path);}
  async check(payload:Row,turn:number):Promise<void>{
    const {state,line,holds}=await this.state(),effects=await this.effects(payload);
    for(const hold of holds){
      const payment=effects.find(e=>this.payment(hold,e));
      if(payment?.category==='transfer')throw new KernelError({code:'needs',message:'A held purchase cannot become a non-purchase transfer',fix:'Keep the purchase and its merchandise terms. Use its contextual living or purchase category; do not bypass daily settlement by relabelling the payment.',details:{reason:'purchase_category_changed'}});
      if(payment&&Array.isArray(payment.items)&&(terms(payment)!==terms(hold.effect)||payment.currency!==undefined&&hold.effect.currency!==undefined&&name(payment.currency)!==name(hold.effect.currency)))throw new KernelError({code:'needs',message:'A payment retry changed the held merchandise terms',
        fix:`Keep the original merchandise prices ${JSON.stringify(hold.effect.items)}. The original goods cost ${hold.amount}; the separate cash debit ${hold.cash_debit??'from the current preview'} is not an NPC price increase. Correct this same purchase without asking the player to choose the goods again.`,details:{reason:'purchase_terms_changed',original:hold.effect}});
      const dependent=effects.filter(e=>e.kind==='item'&&(e.quantity??1)>0&&hold.deliveries.some(d=>name(d.name)===name(e.name)&&this.subject(d)===this.subject(e)&&(!e.from||!d.from||this.seller(e.from)===this.seller(d.from))));
      if((payment||dependent.length)&&hold.turn!==turn){hold.turn=turn;state.lines[line]=holds;await this.save(state);}
      if(dependent.length&&!payment)throw new KernelError({code:'needs',message:'These purchased items still depend on an unpaid transaction',
        fix:`The held purchase ${JSON.stringify(hold.effect)} has not settled. Do not remove its cash effect and deliver its goods, or claim payment in prose. Retry its original terms with accepted cash authority, or leave the purchase incomplete. A gift or credit arrangement needs its own established terms and ordinary admission.`,details:{reason:'purchase_payment_required',items:dependent.map(e=>e.name)}});
    }
  }
  async failure(payload:Row,error:unknown,turn:number):Promise<unknown>{
    if(!isKernelError(error)||error.details?.reason==='action_proposal_mismatch')return error;
    const effects=await this.effects(payload),candidates=effects.filter(priced).filter((e:Row)=>amountOf(e.items));
    if(!candidates.length)return error;
    const fiscal=typeof error.details?.cash_debit==='number'||candidates.some((e:Row)=>typeof e._cash_debit_limit==='number'&&e._cash_debit_limit>0)
      ||['cash_limit_unaccepted','purchase_terms_changed','purchase_payment_required'].includes(String(error.details?.reason));
    if(!fiscal)return error;
    const {state,line,holds}=await this.state();
    if(typeof error.details?.with==='string')await this.observe(payload,[{index:error.details.cash_index??0,with:error.details.with,with_label:error.details.with_label}]);
    for(const effect of candidates){const key=this.key(effect),existing=holds.find(h=>this.key(h.effect)===key);if(existing){existing.turn=turn;continue;}
      const { _cash_debit_limit:limit,...plain}=effect;
      const deliveries=(payload.effects as Row[]).filter(e=>e.kind==='item'&&(e.quantity??1)>0&&effect.items.some((i:Row)=>name(i.name)===name(e.name)));
      holds.push({key,effect:plain,deliveries,amount:amountOf(effect.items)!,cash_debit:error.details?.cash_debit??limit,turn});
    }
    state.lines[line]=holds;state.aliases={...state.aliases,[line]:Object.fromEntries(this.aliases)};await this.save(state);
    const details=holds.map(h=>({items:h.effect.items,merchandise_amount:h.amount,cash_debit:h.cash_debit}));
    return new KernelError({code:error.code,message:error.message,retryable:error.retryable,next:error.next,
      fix:[error.details?.reason==='action_not_authorized'?'This purchase has not landed. The missing choice concerns the purse cash requirement, not the NPC merchandise price. The quotation card presents both numeric facts; leave the goods unfulfilled until the player accepts that requirement. Do not turn a mechanical cash choice into NPC dialogue.':error.fix,`Unpaid purchase terms: ${JSON.stringify(details)}. Preserve the merchandise prices. Daily catch-up changes the purse debit, never the NPC's price. Ordinary personal living expenses should be classified in their present context before counting additional spending. Do not drop payment and fulfill the goods. The next delivery carries the original offer and its separate cash requirement; explain no bookkeeping as an NPC price increase.`].filter(Boolean).join(' '),
      details:{...error.details,purchase_recovery:details}});
  }
  async settled(payload:Row,result:Row):Promise<void>{
    if(!Array.isArray(payload.effects)||!Array.isArray(result.receipts)||!result.receipts.some((id:unknown)=>typeof id==='string'&&id.startsWith('cash:')))return;
    const {state,line,holds}=await this.state();const remaining=holds.filter(h=>!payload.effects.some((e:Row)=>(this.payment(h,e)||this.cancellation(h,e))&&Array.isArray(result._cash_settlements)&&result._cash_settlements.some((r:Row)=>
      name(r.subject)===name(this.subject(e))&&(e.bill?name(r.bill)===name(e.bill):e.quote?name(r.quote)===name(e.quote):true)&&
      (this.cancellation(h,e)?r.settlement==='cancelled':r.settlement!=='quote'&&r.settlement!=='cancelled'&&Array.isArray(r.items)&&terms(r)===terms(h.effect)))));
    if(remaining.length!==holds.length){state.lines[line]=remaining;await this.save(state);}
  }
  async offers(existing:unknown,turn:number):Promise<Row[]|undefined>{
    const {holds}=await this.state();if(!holds.length)return Array.isArray(existing)?existing:undefined;
    const offers=Array.isArray(existing)?[...existing]:[];
    for(const h of holds.filter(h=>h.turn===turn)){const e=h.effect,quote=e.bill??e.quote??e.items.map((i:Row)=>i.name).join(' + ');
      if(offers.some(o=>name(o.quote)===name(quote)))continue;
      offers.push({quote,items:e.items,category:e.category??'purchase',source:e.source??'quote',...(e.with?{with:e.with}:{}),...(e.subject?{subject:e.subject}:{}),...(e.currency?{currency:e.currency}:{}),...(e.price_id?{price_id:e.price_id}:{}),...(e.why?{why:e.why}:{})});
    }
    return offers.slice(0,8);
  }
  async requests(turn:number):Promise<Row[]>{
    const {holds}=await this.state();return holds.filter(h=>h.turn===turn).map(h=>({quote:h.effect.bill??h.effect.quote??h.effect.items.map((i:Row)=>i.name).join(' + '),subject:this.subject(h.effect)}));
  }
  async funding(payload:Row):Promise<void>{
    const {holds}=await this.state();
    for(const e of Array.isArray(payload.effects)?payload.effects:[]){
      delete e._purchase_quote;
      const hold=holds.find(h=>this.payment(h,e));
      if(hold&&Array.isArray(e.items)&&!e.quote)e._purchase_quote=hold.effect.bill??hold.effect.quote??hold.effect.items.map((i:Row)=>i.name).join(' + ');
    }
  }
}
