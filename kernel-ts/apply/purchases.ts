/** Exact quote arithmetic and staged daily expenditure; semantic categories belong to the Keeper. */
import {RpcError} from '../errors.js';
import {isJsonObject} from '../json.js';
import {gameDayOf} from '../healing/day.js';
import {array,clone,normalize,number,row,string,type Row} from '../read/values.js';
import {addCash,cashDecimal,cashStorage,compareCash,multiplyCash,type Decimal} from './cash.js';
import {decimalSpelling} from '../../shared/cash-decimal.js';
import type {ApplyContext} from './index.js';

const ZERO:Decimal={coefficient:0n,exponent:0};
export function storedCash(value:Decimal):any {
    const stored=cashStorage(value);
    if(stored===null)throw new RpcError('invalid_params','The purchase amount cannot be stored without rounding');
    return stored;
}
export function purchaseItems(value:unknown):{items:Row[];total:Decimal} {
    if(!Array.isArray(value)||!value.length||value.length>24)throw new RpcError('invalid_params','items must contain 1 to 24 priced lines');
    let total=ZERO;
    const items=value.map((given,index)=>{
        if(!isJsonObject(given)||typeof given.name!=='string'||!given.name.trim())throw new RpcError('invalid_params','Each priced line needs a name',{details:{item:index}});
        const quantity=cashDecimal(given.quantity),price=typeof given.unit_price==='string'?decimalSpelling(given.unit_price):cashDecimal(given.unit_price);
        if(!quantity||quantity.coefficient<=0n||!price||price.coefficient<0n)throw new RpcError('invalid_params','A priced line needs a positive finite quantity and a nonnegative finite unit_price',{details:{item:index}});
        const amount=multiplyCash(quantity,price);total=addCash(total,amount);
        return {name:given.name.trim(),quantity:given.quantity,unit_price:given.unit_price,amount:storedCash(amount)};
    });
    if(total.coefficient<=0n)throw new RpcError('invalid_params','A priced purchase must have a positive total',{
        fix:'Correct the actual merchandise unit_price in items. Coverage can make the actual cash debit zero; it does not make the merchandise price zero. Preserve the chosen service, and do not ask the player again to fix a technical price error.',
        details:{field:'items',lines:items.map((item,index)=>({line:index+1,quantity:item.quantity,unit_price:item.unit_price})),purchase_amount:0}});
    return {items,total};
}
export function bindCashQuote(context:Pick<ApplyContext,'world'|'graph'>,given:Row,subject:string):{effect:Row;quote:Row|null} {
    if(given.mode==='quote'||given.quote===undefined)return {effect:given,quote:null};
    if(typeof given.quote!=='string'||!given.quote.trim())throw new RpcError('invalid_params','quote must name a registered offer');
    const quote=array(context.world.cash_quotes).find(value=>value.subject===subject&&normalize(string(value.name))===normalize(given.quote));
    if(!quote||quote.settled||quote.cancelled)throw new RpcError('needs','This quote is missing or already closed',{
        fix:quote?.settled?'This offer was already settled. Do not pay it again or drop its binding to repeat the expense; a genuinely new expense needs its own chosen scope and terms.':given.items!==undefined?'For a fresh complete priced expense, omit quote and use bill for its local name; settle the chosen service directly under ordinary admission. quote reuses a saved offer, it does not name a new bill. Do not register a preliminary offer just to complete a chosen covered service.':'Register a new offer with mode quote, items and a human-readable quote name before another payment.',
        details:{field:'quote',quote:given.quote}});
    for(const key of ['category','currency','with','source','price_id'])if(given[key]!==undefined&&normalize(string(given[key]))!==normalize(string(quote[key])))
        throw new RpcError('invalid_params',`The supplied ${key} differs from the saved quote`,{details:{field:key,quote:given.quote}});
    if(given.items!==undefined)throw new RpcError('invalid_params','A saved quote already owns its priced lines',{fix:'Omit items when settling the saved quote; register a new offer to change its terms.'});
    const total=cashDecimal(quote.purchase_amount)!;
    const delta={coefficient:-total.coefficient,exponent:total.exponent};
    if(given.delta!==undefined){const supplied=cashDecimal(given.delta);if(!supplied||compareCash(supplied,delta)!==0)throw new RpcError('invalid_params','The supplied amount differs from the computed quote total',{details:{purchase_amount:quote.purchase_amount}});}
    return {effect:{...clone(quote),...given,delta:storedCash(delta),items:clone(quote.items),why:given.why??quote.why},quote};
}
export function expenseCategory(effect:Row,negative:boolean):string {
    const value=effect.owed?'transfer':effect.category??(effect.source==='found'?'transfer':effect.settlement==='spending_level'?'purchase':negative?null:'transfer');
    if(value===null)throw new RpcError('needs','A purchase needs its expense category before settlement',{fix:'Set category living for ordinary food, accommodation or incidental travel within the investigator living standard, purchase for additional spending, or transfer for actual non-purchase cash movement. The kernel chooses coverage and the debit.',details:{field:'category',options:['living','purchase','transfer']}});
    if(!['living','purchase','transfer'].includes(value))throw new RpcError('invalid_params','category must be living, purchase or transfer');
    if(!negative&&value!=='transfer')throw new RpcError('invalid_params','Money received is a cash transfer, not an expense');
    if(effect.owed&&(effect.mode==='quote'||effect.quote!==undefined||effect.items!==undefined||effect.category&&effect.category!=='transfer'))throw new RpcError('invalid_params','Owed cash lands the exact delivered transfer, not a quotation or covered purchase');
    return value;
}
export function expenditure(context:Pick<ApplyContext,'world'|'graph'>,finance:Row,category:string,amount:Decimal):{delta:Decimal;fields:Row;ledger?:Row} {
    if(category==='living'){
        if(typeof finance.living_standard!=='string'||!finance.living_standard.trim())throw new RpcError('needs','Living-standard coverage needs an established living standard',{fix:'Use purchase for additional expenditure until a living standard has been established.'});
        return {delta:ZERO,fields:{category,settlement:'living_standard',purchase_amount:storedCash(amount),living_standard:finance.living_standard}};
    }
    const level=cashDecimal(row(finance.spending_level).amount);
    if(!level||level.coefficient<0n)throw new RpcError('needs','Purchase coverage needs a usable Spending Level',{fix:'Establish the investigator finance period before settling purchases.'});
    const day=gameDayOf(context.graph,number(row(context.world.clock).minutes),context.world.clock),previous=row(finance.daily_spending);
    const totalBefore=previous.day===day?cashDecimal(previous.total):ZERO,debitedBefore=previous.day===day?cashDecimal(previous.debited):ZERO;
    if(!totalBefore||!debitedBefore||totalBefore.coefficient<0n||debitedBefore.coefficient<0n||compareCash(debitedBefore,totalBefore)>0)
        throw new RpcError('invalid_params','The daily expenditure ledger is invalid');
    const total=addCash(totalBefore,amount),due=compareCash(total,level)>0?total:debitedBefore;
    const debit=addCash(due,{coefficient:-debitedBefore.coefficient,exponent:debitedBefore.exponent});
    const ledger={day,total:storedCash(total),debited:storedCash(due)};
    return {delta:{coefficient:-debit.coefficient,exponent:debit.exponent},ledger,
        fields:{category,settlement:debit.coefficient===0n?'spending_level':'cash',purchase_amount:storedCash(amount),spending_level:storedCash(level),spending_day:day,daily_total:ledger.total,daily_debited:ledger.debited}};
}
