/** Staged legacy equipment and era-specific cash; managed instances keep their owner. */
import {RpcError} from '../errors.js';
import {isJsonObject,PythonFloat,jsonDigest} from '../json.js';
import {moduleDeclaration,isAmbiguity} from '../read/module-graph.js';
import {findNamedObject} from '../read/mods.js';
import {EntityIndex} from '../read/memory.js';
import {actor} from '../read/handlers.js';
import {personLabel} from '../read/capsule.js';
import {array,clone,integer,normalize,number,repr,row,string,type Row} from '../read/values.js';
import {RuleTables} from '../rules/tables.js';
import {weaponBandOptions,weaponRowNamed} from '../rules/bands.js';
import {Catalog} from '../rules/catalog.js';
import {required,nowIso} from '../write/store.js';
import {effectId,type StagedEffect} from './bookkeeping.js';
import {addCash,cashDecimal,cashStorage,cashText,compareCash} from './cash.js';
import {bindCashQuote,expenseCategory,expenditure,purchaseItems,storedCash} from './purchases.js';
import type {ApplyContext} from './index.js';
export type CashContext=Pick<ApplyContext,'kernel'|'world'|'graph'|'turn'|'callId'|'ordinal'|'mint'> & {campaign:{party():Promise<readonly Row[]>}};
type Int=number|bigint;
const int=(value:any):Int=>typeof value==='bigint'?value:Math.trunc(number(value));
const add=(a:Int,b:Int):Int=>{const sum=BigInt(a)+BigInt(b);return sum<=BigInt(Number.MAX_SAFE_INTEGER)&&sum>=BigInt(Number.MIN_SAFE_INTEGER)?Number(sum):sum;};
const negate=(value:Int):Int=>typeof value==='bigint'?-value:-value;
const itemMatches=(entry:any,key:string)=>isJsonObject(entry)?['name','label','weapon'].some(field=>normalize(string(entry[field]||''))===key):normalize(string(entry))===key;
const weaponMatches=(entry:any,key:string)=>isJsonObject(entry)&&['weapon_id','name','label'].some(field=>normalize(string(entry[field]||''))===key);
const held=(sheet:Row,key:string):Int=>{const found=array(sheet.equipment).filter(entry=>itemMatches(entry,key));return found.length?found.reduce((sum:Int,entry)=>add(sum,isJsonObject(entry)?int(entry.quantity||1):1),0):array(sheet.weapons).filter(entry=>weaponMatches(entry,key)).length;};
export async function stagedSheet(context:Pick<CashContext,'campaign'>,staged:Map<string,Row>,name:any):Promise<Row>{
    const sheet=actor(await context.campaign.party() as Row[],name),id=string(sheet.id);if(!staged.has(id))staged.set(id,clone(sheet));return staged.get(id)!;
}
async function weaponProfile(context:ApplyContext,sheet:Row,query:any,catalog:Map<string,Row>):Promise<Row>{
    if(typeof query!=='string'||!query.trim())throw new RpcError('invalid_params','weapon must be a weapons-table id or profile name');
    const found=weaponRowNamed(catalog,query);if(found)return found;
    const era=string(sheet.era||moduleDeclaration(context.graph.moduleNode).era||'');
    // Contract §138.6: the profiles behind the options ride as host-only detail (never named by `fix`, so never shown to
    // the model): the host's band question reads a profile's skill and dice without a second catalog read.
    const {options,close,profiles}=weaponBandOptions(catalog,era,query);
    throw new RpcError('needs',`${repr(query)} is not a weapon profile in the rules tables`,{fix:'set weapon to one of details.needs.options (a weapons.json id or its display name), for an improvised weapon, keep the object name in name and choose the closest rulebook profile in weapon; later resolve.weapon uses that object name. Leave weapon out only for non-weapons',details:{needs:{field:'weapon',options,close,profiles,source:'content/rulesets/coc7/rules-json/weapons.json'}}});
}
function addItem(sheet:Row,name:string,quantity:Int,turn:number,source:string|null,label:string|null,profile:Row|null):void{
    const key=normalize(name);if(!Array.isArray(sheet.equipment))sheet.equipment=[];
    const existing=sheet.equipment.find((entry:any)=>isJsonObject(entry)&&normalize(string(entry.name||''))===key);
    if(existing)existing.quantity=add(int(existing.quantity||1),quantity);
    else sheet.equipment.push({name,quantity,turn,...(source?{from:source}:{}),...(label?{label}:{}),...(profile?{weapon:string(profile.weapon_id)}:{})});
    if(profile){
        if(!Array.isArray(sheet.weapons))sheet.weapons=[];
        if(!sheet.weapons.some((weapon:any)=>isJsonObject(weapon)&&string(weapon.weapon_id)===string(profile.weapon_id)&&normalize(string(weapon.name||''))===key)){
            const yards=profile.base_range_yards;
            sheet.weapons.push({weapon_id:string(profile.weapon_id),name,profile:profile.display_name??null,skill:profile.skill??null,damage:profile.damage||profile.damage_die||null,
                range:integer(yards)||typeof yards==='boolean'?`${string(yards)} yards`:null,attacks:profile.uses_per_round??null,ammo:profile.magazine??null,malfunction:profile.malfunction??null,turn,...(label?{label}:{})});
        }
    }
}
function removeItem(sheet:Row,name:string,loss:Int):void{
    const key=normalize(name),equipment=array(sheet.equipment),weapons=array(sheet.weapons);let remaining=loss;
    for(let n=equipment.length-1;n>=0;n--)if(itemMatches(equipment[n],key)){
        const entry=equipment[n],have=isJsonObject(entry)?int(entry.quantity||1):1,take=have<remaining?have:remaining;
        if(isJsonObject(entry)&&have>take)entry.quantity=add(have,negate(take));else equipment.splice(n,1);
        remaining=add(remaining,negate(take));if(remaining===0||remaining===0n)break;
    }
    if(remaining>0)for(let n=weapons.length-1;n>=0&&remaining>0;n--)if(weaponMatches(weapons[n],key)){weapons.splice(n,1);remaining=add(remaining,-1);}
    if(!equipment.some(entry=>itemMatches(entry,key)))sheet.weapons=weapons.filter(entry=>!weaponMatches(entry,key));
}
export async function stageItem(context:ApplyContext,effect:Row,staged:Map<string,Row>,catalog:()=>Promise<Map<string,Row>>):Promise<StagedEffect>{
    const name=required(effect,'name')!;
    if(findNamedObject(row(row(context.world.objects).instances),name))throw new RpcError('invalid_params','This is a managed object instance, not a legacy equipment row',{fix:'use object with from/to to transfer it; keep from/to equal with condition and why to record damage'});
    const quantity=Object.hasOwn(effect,'quantity')?effect.quantity:1;
    if(!integer(quantity)||quantity===0||quantity===0n)throw new RpcError('invalid_params','quantity must be a non-zero integer (negative is a loss)');
    const sheet=await stagedSheet(context,staged,effect.to),id=string(sheet.id),label=typeof effect.label==='string'&&effect.label.trim()?effect.label.trim():null,why=typeof effect.why==='string'?effect.why:null,subject=string(sheet.name||sheet.id);
    const from=effect.from;if(from!=null&&(typeof from!=='string'||!from.trim()))throw new RpcError('invalid_params','from must be an NPC name');
    let source:string|null=null;
    if(from){const index=new EntityIndex(context.graph,await context.campaign.party() as Row[]),exact=index.matches(from,{kinds:['npc'],investigators:false}),found=exact.length?exact:index.looseMatches(from,['npc']);source=found.length===1?index.canonicalName(found[0]):from.trim();}
    const profile=effect.weapon!=null?await weaponProfile(context,sheet,effect.weapon,await catalog()):null,key=normalize(name),before=held(sheet,key);
    if(quantity>0)addItem(sheet,name,quantity,number(context.turn.turn),source,label,profile);
    else {if(before<negate(quantity))throw new RpcError('invalid_params',`${subject} holds ${before} × ${repr(name)}; cannot lose ${negate(quantity)}`,{fix:'an item leaves the sheet only if it is on it: apply the gain first, or a smaller loss',details:{name,held:before,quantity}});removeItem(sheet,name,negate(quantity));}
    const after=held(sheet,key),receipt={id:effectId(context,'item',name),kind:'item',call_id:context.callId,name,label:label||name,subject:id,subject_label:personLabel(context.world,id,subject),from:source,weapon:profile?string(profile.weapon_id):null,quantity,before,after,why,at:nowIso()};
    return {receipt,event:{type:'item-transferred',data:{name,to:id,quantity,...(source?{from:source}:{}),...(profile?{weapon:string(profile.weapon_id)}:{})}}};
}
export async function stagePendingItemIdentity(context:ApplyContext,effect:Row,staged:Map<string,Row>):Promise<StagedEffect&{identity:Row}>{
    const sheet=await stagedSheet(context,staged,effect.to),name=string(effect.name),key=normalize(name);
    if(array(sheet.equipment).some(entry=>itemMatches(entry,key)))throw new RpcError('invalid_params','A pending item identity must be a new equipment row');
    const result=await stageItem(context,effect,staged,async()=>new Map()),token=string(result.receipt.id),
        rowEntry=array(sheet.equipment).find(entry=>isJsonObject(entry)&&normalize(string(entry.name))===key&&number(entry.turn)===number(context.turn.turn));
    if(!isJsonObject(rowEntry))throw new RpcError('internal','The pending item identity was not staged');
    rowEntry.pending_definition=token;result.receipt.pending_definition=true;
    const identity={token,owner:string(sheet.id),name,quantity:rowEntry.quantity??1,row_digest:jsonDigest(rowEntry)};
    return{...result,identity};
}
const money=(value:any):any=>value instanceof PythonFloat&&Number.isInteger(number(value))?number(value):value;
/**
 * Contract §58: where the amount came from. Two real-table defects came in through the same hole --
 * the Keeper answered `delta` with a number and `why` with a correct sentence that the number did not
 * match. BUG-078 narrated half a sol and spent half a dollar; BUG-084 read the player's sentence
 * "six-thirty is what I can afford" as the price of the meal and emptied her purse at the one moment
 * the campaign's whole motive was a balance. The rulebook prints Lunch at 65 cents. Nothing on the
 * path from the player's sentence to the receipt held any price at all, so nothing could disagree.
 *
 * §31's three ends. Writes it: this function, from the source the Keeper cites. Reads it: the cash
 * mechanics card and the capsule's `prices_paid`. Acts on it: the Keeper, which now has to answer
 * "from what?" before it may answer "how much", and has `lookup kind=catalog` to answer it with.
 *
 * The kernel does not price anything itself and owns no price or exchange table -- semantic pricing
 * belongs to the Keeper and to the authored rulebook data. It only resolves the source that was
 * cited, records what that source says, and refuses a citation it cannot resolve.
 */
export const CASH_SOURCES=['price','quote','found'] as const;
const SOURCE_FIX='cite where the amount came from: source "price" with a price_id from lookup kind=catalog kinds=["item"], source "quote" with the person who named it in `with`, or source "found" when no price is involved (found, stolen, wages, a gift, a debt settled). A number the player said about their own purse is a balance, not a price.';
async function cashSource(context:CashContext,effect:Row,heldCurrency:string,subject:string):Promise<Row>{
    const source=effect.source;
    if(typeof source!=='string'||!(CASH_SOURCES as readonly string[]).includes(source))
        throw new RpcError('invalid_params',`a cash amount needs a source; ${repr(source??null)} is not one of ${CASH_SOURCES.join(', ')}`,{fix:SOURCE_FIX,details:{source:source??null,supported:[...CASH_SOURCES]}});
    const declared=effect.currency;
    if(declared!=null&&(typeof declared!=='string'||!declared.trim()))
        throw new RpcError('invalid_params','currency must be the name of the unit the amount is counted in',{fix:'omit currency to count in the unit the balance is already held in',details:{held:heldCurrency}});
    if(typeof declared==='string'&&normalize(declared)!==normalize(heldCurrency))
        throw new RpcError('invalid_params',`${subject} holds this balance in ${heldCurrency}; ${declared.trim()} is a different unit and the kernel does not convert between them`,{fix:`record what actually left or entered the purse in ${heldCurrency}, or settle the exchange in the fiction first and record its result. Do not spend one unit out of a balance counted in another`,details:{declared:declared.trim(),held:heldCurrency}});
    if(source==='quote'){
        if(typeof effect.with!=='string'||!effect.with.trim())
            throw new RpcError('invalid_params','a quoted amount needs the person who named it',{fix:'name them in `with`, or use source "price" when the rulebook prints this price and source "found" when nobody named an amount'});
        return {source};
    }
    if(source==='found')return {source};
    const priceId=effect.price_id;
    if(typeof priceId!=='string'||!priceId.trim())
        throw new RpcError('invalid_params','source "price" needs the price_id of the printed record it charges',{fix:'run lookup kind=catalog kinds=["item"] for the thing being bought and pass the price_id it returns, or use source "quote" when someone in the fiction named the amount instead'});
    const wanted=priceId.trim(),records=await new Catalog(new RuleTables(context.kernel)).records(['item']);
    const found=records.find(record=>string(record.entity_id)===wanted);
    if(!found)
        throw new RpcError('invalid_params',`the rulebook's price list prints no record with price_id ${repr(wanted)}`,{fix:'run lookup kind=catalog kinds=["item"] and pass a price_id it returned; an invented price_id is not a source',details:{price_id:wanted}});
    const price=row(row(found.params).price);
    return {source,price_id:wanted,price_name:found.name??null,price_era:array(found.era)[0]??null,source_amount:price.amount??null,source_currency:price.currency??null,source_display:price.source_display??null,source_provenance:row(found.params).provenance??null};
}
export async function stageCash(context:CashContext,effect:Row,staged:Map<string,Row>):Promise<StagedEffect>{
    const mode=effect.mode??'settle';
    if(effect.bill!==undefined && (typeof effect.bill!=='string'||!effect.bill.trim()||effect.bill.length>200))throw new RpcError('invalid_params','bill must be a nonempty local transaction name of at most 200 characters');
    if(mode!=='quote'&&mode!=='settle')throw new RpcError('invalid_params','cash mode must be quote or settle');
    if(mode==='quote'&&effect.source===undefined)effect={...effect,source:effect.price_id!==undefined?'price':'quote'};
    const requested=effect.settlement;
    if(requested!==undefined&&requested!=='cash'&&requested!=='spending_level')throw new RpcError('invalid_params','settlement must be cash or spending_level');
    const sheet=await stagedSheet(context,staged,effect.subject),id=string(sheet.id),subject=string(sheet.name||sheet.id);
    const bound=bindCashQuote(context,effect,id);effect=bound.effect;
    const priced=effect.items!==undefined?purchaseItems(effect.items):null;
    if(priced){
        const wanted={coefficient:-priced.total.coefficient,exponent:priced.total.exponent},given=cashDecimal(effect.delta);
        if(effect.delta!==undefined&&(!given||compareCash(given,wanted)!==0))throw new RpcError('invalid_params','delta differs from the exact priced-line total',{fix:'Omit delta and use the kernel-computed total, or correct the quoted line items.',details:{purchase_amount:storedCash(priced.total),delta:effect.delta}});
        effect={...effect,delta:storedCash(wanted)};
    }
    const delta=effect.delta,decimalDelta=cashDecimal(delta);
    if(!decimalDelta||decimalDelta.coefficient===0n)throw new RpcError('invalid_params',"delta must be a finite non-zero amount, or items/quote must provide the amount");
    const why=typeof effect.why==='string'?effect.why:null;
    const otherName=typeof effect.with==='string'?effect.with.trim():'';
    let other:Row|null=null;
    if(otherName){
        try{other=context.graph.npc(otherName);}
        catch(error){if(!(error instanceof RpcError)||error.code!=='unknown_entity'||isAmbiguity(error))throw error;}
    }
    const otherId=other?context.graph.handle(other):otherName||null;
    const otherLabel=other?personLabel(context.world,context.graph.handle(other),context.graph.displayName(other)):otherName||null;
    let finance=sheet.finance;
    if(!isJsonObject(finance)||!isJsonObject(finance.cash)){
        const era=string(sheet.era||moduleDeclaration(context.graph.moduleNode).era||''),tables=new RuleTables(context.kernel);
        const raw=integer(sheet.credit_rating)?sheet.credit_rating:row(sheet.skills)['Credit Rating'],credit=integer(raw)?number(raw):0;
        try{finance=await tables.cashAndAssets(credit,era);finance.source=`cash-assets.periods.${era}`;}
        catch(error){if(!(error instanceof Error)||error.name!=='ValueError')throw error;finance={credit_rating:credit,living_standard:null,cash:{amount:0,currency:string(row(await tables.load('cash-assets')).currency||'USD')},assets:null,spending_level:null,period:era||null,source:null,note:`no cash-assets period for era ${repr(era)} (${error.message}); the balance is the sum of cash receipts`};}
    }
    const cash=finance.cash,before=money(cash.amount||0),currency=string(cash.currency||'USD'),decimalBefore=cashDecimal(before);
    if(!decimalBefore)throw new RpcError('invalid_params',`${subject} has an invalid cash balance`,{fix:'repair the investigator cash balance before applying a cash receipt',details:{before,currency}});
    const sourced=await cashSource(context,effect,currency,subject);
    const category=expenseCategory(effect,decimalDelta.coefficient<0n);
    const purchase={coefficient:-decimalDelta.coefficient,exponent:decimalDelta.exponent};
    if(mode==='quote'){
        if(!priced||typeof effect.quote!=='string'||!effect.quote.trim()||category==='transfer'||effect.owed)
            throw new RpcError('invalid_params','A quote needs items, a quote name, a price source and a living or purchase category');
        const name=effect.quote.trim(),amount=storedCash(priced.total),withName=otherName||null;
        const receipt={id:context.mint(`cash:t${context.turn.turn}-c${context.ordinal}`),kind:'cash',call_id:context.callId,resource:'cash',subject:id,subject_label:personLabel(context.world,id,subject),before,after:before,delta:0,
            category,settlement:'quote',quote:name,...(effect.bill?{bill:effect.bill}:{}),purchase_amount:amount,items:priced.items,currency,with:otherId,with_label:otherLabel,...sourced,why,at:nowIso()};
        const quotes=array(context.world.cash_quotes).filter(value=>value.subject!==id||normalize(string(value.name))!==normalize(name));
        quotes.push({name,subject:id,category,purchase_amount:amount,items:priced.items,currency,with:withName,...sourced,why,settled:null,origin_turn:number(context.turn.turn)});
        context.world.cash_quotes=quotes;
        return {receipt,event:null};
    }
    const covered=category==='transfer'?{delta:decimalDelta,fields:{},ledger:undefined}:expenditure(context,finance,category,purchase);
    const effectiveDelta=covered.delta;
    if(effect._cash_debit_limit!==undefined){
        const limit=cashDecimal(effect._cash_debit_limit),debit={coefficient:-effectiveDelta.coefficient,exponent:effectiveDelta.exponent};
        if(!limit||limit.coefficient<0n)throw new RpcError('invalid_params','The admitted cash debit limit is invalid');
        if(effectiveDelta.coefficient<0n&&compareCash(debit,limit)>0)throw new RpcError('needs','The current cash debit exceeds its admitted preview',{fix:'Refresh the cash preview and obtain admission for the current full debit before retrying.',details:{cash_debit:storedCash(debit),admitted_limit:effect._cash_debit_limit}});
    }
    if(requested==='spending_level'&&(category!=='purchase'||decimalDelta.coefficient>=0n))throw new RpcError('invalid_params','spending_level is only a purchase settlement');
    if(requested==='spending_level'&&effectiveDelta.coefficient<0n)throw new RpcError('needs','The daily purchase total is above Spending Level',{fix:'Disclose the full cash debit and wait for the player to accept it or use an existing applicable delegation, then omit settlement.',details:{spending_level:covered.fields.spending_level,daily_total:covered.fields.daily_total,cash_debit:storedCash({coefficient:-effectiveDelta.coefficient,exponent:effectiveDelta.exponent})}});
    const decimalAfter=addCash(decimalBefore,effectiveDelta);
    if(decimalAfter.coefficient<0n)throw new RpcError('invalid_params',`${subject} has ${string(before)} ${currency}; cannot lose ${cashText({coefficient:-effectiveDelta.coefficient,exponent:effectiveDelta.exponent})}`,{fix:'a smaller purchase, or narrate the debt without a cash receipt',details:{before,delta,currency,...(category!=='transfer'?{purchase_amount:covered.fields.purchase_amount,cash_debit:storedCash({coefficient:-effectiveDelta.coefficient,exponent:effectiveDelta.exponent})}:{})}});
    const after=cashStorage(decimalAfter);
    if(after===null)throw new RpcError('invalid_params','cash result cannot be represented without rounding',{fix:'use an amount that can be stored exactly, or keep this amount as a whole-number cash receipt',details:{before,delta,currency}});
    const actualDelta=cashStorage(effectiveDelta);if(actualDelta===null)throw new RpcError('internal','cash delta could not be represented');
    if(covered.ledger)finance.daily_spending=covered.ledger;
    cash.amount=after;sheet.finance=finance;sheet.cash=`${string(after)} ${currency}`;
    const receipt={id:context.mint(`cash:t${context.turn.turn}-c${context.ordinal}`),kind:'cash',call_id:context.callId,resource:'cash',subject:id,subject_label:personLabel(context.world,id,subject),before,after,delta:actualDelta,
        ...covered.fields,...(effect.bill?{bill:effect.bill}:{}),...(priced?{items:priced.items}:{}),...(bound.quote?{quote:bound.quote.name}:{}),with:otherId,with_label:otherLabel,currency,...sourced,why,at:nowIso()};
    if(bound.quote)bound.quote.settled=receipt.id;
    return category!=='transfer'&&effectiveDelta.coefficient===0n
        ?{receipt,event:{type:'purchase-settled',data:{subject:id,amount:covered.fields.purchase_amount,settlement:covered.fields.settlement,...(covered.fields.spending_level!==undefined?{spending_level:covered.fields.spending_level}:{}),currency,why,...(other?{with:context.graph.handle(other)}:{})}}}
        :{receipt,event:{type:'resource-changed',data:{resource:'cash',subject:id,before,after,delta:actualDelta,why,...(other?{with:context.graph.handle(other)}:{})}}};
}
export async function commitInventorySheets(context:ApplyContext,staged:Map<string,Row>):Promise<void>{
    for(const [id,sheet] of staged){const current=(await context.campaign.party()).find(value=>string(value.id)===id);if(!current)continue;for(const key of ['equipment','weapons','finance','cash'])if(Object.hasOwn(sheet,key))current[key]=sheet[key];await context.campaign.writeSheet(current);}
}
