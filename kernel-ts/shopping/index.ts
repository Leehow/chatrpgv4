/**
 * Contract §265: the shop's side of a purchase. The Keeper picks parameters -- which printed record the goods are, what
 * kind of outlet sells them, how rare they are -- and this module answers from those parameters whether the outlet has
 * them, how many, what they cost there and how long an order takes. The answer is a seeded roll over the outlet, the
 * goods and the game week, so the same question asked again in the same week gets the same answer, and a sale this week
 * leaves one fewer on the shelf. Nothing here classifies goods: every semantic choice arrives as a closed parameter.
 */
import {createHash} from 'node:crypto';
import {RpcError} from '../errors.js';
import type {KernelContext} from '../context.js';
import {isJsonObject} from '../json.js';
import {gameDayOf} from '../healing/day.js';
import {activeMods} from '../read/mods.js';
import {moduleDeclaration, type ModuleGraph} from '../read/module-graph.js';
import {array,normalize,number,row,string,type Row} from '../read/values.js';
import {Catalog} from '../rules/catalog.js';
import {RuleTables} from '../rules/tables.js';
import {cashText,decimalSpelling,compareCash} from '../../shared/cash-decimal.js';

export const SHOPPING_CAPABILITY='shopping.stock.v1';
export const SHOP_TRADES=['stocks','sideline','unlikely'] as const;
export const SHOP_SETTLEMENTS=['city','town','village'] as const;
export const SHOP_RARITIES=['everyday','uncommon','rare'] as const;
export const SHOP_GRADES=['cheap','standard','fine'] as const;
const PERIOD_DAYS=7;
/** Percent chance the outlet has the goods this week, by trade then rarity (§265.3). */
const AVAILABILITY:Record<string,Record<string,number>>={
    stocks:{everyday:95,uncommon:70,rare:30},
    sideline:{everyday:60,uncommon:30,rare:8},
    unlikely:{everyday:10,uncommon:3,rare:0},
};
const SETTLEMENT_PENALTY:Record<string,number>={city:0,town:10,village:25};
/** Units on the shelf when the goods are there: [dice count, sides, addend]. */
const STOCK:Record<string,[number,number,number]>={everyday:[2,6,0],uncommon:[1,4,0],rare:[0,0,1]};
/** Days an order takes in a city: [dice count, sides, addend]; a town takes half again as long, a village twice. */
const ORDER_DAYS:Record<string,[number,number,number]>={everyday:[1,3,0],uncommon:[1,6,2],rare:[2,6,5]};
const ORDER_SCALE:Record<string,number>={city:1,town:1.5,village:2};

export interface ShopParams {outlet:string;trade:string;settlement:string;rarity:string;grade:string;order:boolean}
export interface ShopOffer {
    key:string;name:string;price_id:string|null;unit_price:string|null;available:boolean;in_stock:number|null;
    order:{days:number;ready_day:number}|null;note?:string;
}

export async function shoppingActive(kernel:KernelContext,world:Row):Promise<boolean> {
    return (await activeMods(kernel,world)).some(mod=>array(mod.requires).includes(SHOPPING_CAPABILITY));
}
const choice=(value:unknown,field:string,options:readonly string[],fallback?:string):string=>{
    if(value===undefined&&fallback!==undefined)return fallback;
    if(typeof value!=='string'||!options.includes(value))
        throw new RpcError('invalid_params',`shop.${field} must be one of ${options.join(', ')}`,{details:{field:`shop.${field}`,options:[...options]}});
    return value;
};
export function shopParams(value:unknown):ShopParams {
    if(!isJsonObject(value))throw new RpcError('invalid_params','shop is {outlet, trade, settlement, rarity?, grade?, order?}');
    const unknown=Object.keys(value).filter(key=>!['outlet','trade','settlement','rarity','grade','order'].includes(key));
    if(unknown.length)throw new RpcError('invalid_params',`shop has no field ${unknown[0]}`,{details:{field:`shop.${unknown[0]}`}});
    if(typeof value.outlet!=='string'||!value.outlet.trim()||value.outlet.length>200)
        throw new RpcError('invalid_params','shop.outlet names the shop or stall: the place or seller the investigator buys from',{details:{field:'shop.outlet'}});
    if(value.order!==undefined&&typeof value.order!=='boolean')throw new RpcError('invalid_params','shop.order is true or omitted');
    return {outlet:value.outlet.trim(),trade:choice(value.trade,'trade',SHOP_TRADES),settlement:choice(value.settlement,'settlement',SHOP_SETTLEMENTS),
        rarity:choice(value.rarity,'rarity',SHOP_RARITIES,'everyday'),grade:choice(value.grade,'grade',SHOP_GRADES,'standard'),order:value.order===true};
}
function draws(seed:unknown[]):()=>number {
    let counter=0;
    return ()=>createHash('sha256').update(JSON.stringify([...seed,counter++])).digest().readUInt32BE(0);
}
function dice(next:()=>number,[count,sides,addend]:[number,number,number]):number {
    let total=addend;for(let i=0;i<count;i++)total+=next()%sides+1;return total;
}
const cents=(value:number):string=>{const whole=Math.round(value*100);return cashText({coefficient:BigInt(whole),exponent:-2});};
function parseDice(text:string):[number,number]|null {
    const match=/^(\d+)D(\d+)$/i.exec(text.trim());return match?[Number(match[1]),Number(match[2])]:null;
}
/** The outlet's unit price for a printed record (§265.4); null when the book lists none. */
function recordPrice(price:Row,grade:string,next:()=>number):string|null {
    const amount=number(price.amount);
    switch(price.kind){
        case 'fixed':case 'per_unit':return cents(amount);
        case 'minimum':return cents(grade==='fine'?amount*2:amount);
        case 'range':{const low=number(price.min),high=number(price.max);return cents(grade==='cheap'?low:grade==='fine'?high:(low+high)/2);}
        case 'formula':{const parsed=parseDice(string(price.dice));if(!parsed)return null;
            return cents(dice(next,[parsed[0],parsed[1],0])*number(price.multiplier||1)+number(price.addend||0));}
        default:return null;
    }
}
export function shopDay(graph:ModuleGraph,world:Row):number {
    return gameDayOf(graph,number(row(world.clock).minutes),world.clock);
}
const outletKey=(outlet:string)=>normalize(outlet);
const goodsKey=(record:Row|null,name:string)=>record?string(record.entity_id):`name:${normalize(name)}`;
function ledger(world:Row):Row {
    const value=row(world.shop_ledger);return value.version===1&&isJsonObject(value.outlets)?value:{version:1,outlets:{}};
}
function soldThisPeriod(world:Row,outlet:string,key:string,period:number):number {
    const entry=row(row(ledger(world).outlets)[outletKey(outlet)]);
    return number(entry.period)===period?number(row(entry.sold)[key]):0;
}
/** One answer for one kind of goods at one outlet this week (§265.3). `record` is a catalog item row or null. */
export function shopOffer(graph:ModuleGraph,world:Row,shop:ShopParams,record:Row|null,name:string):ShopOffer {
    const day=shopDay(graph,world),period=Math.floor(day/PERIOD_DAYS),key=goodsKey(record,name),outlet=outletKey(shop.outlet);
    const price=row(row(record?.params).price);
    const weekly=draws([graph.moduleId,outlet,key,period]),lasting=draws([graph.moduleId,outlet,key,'price']);
    const unit=record?recordPrice(price,shop.grade,lasting):null;
    const base={key,name:record?string(record.name):name,price_id:record?string(record.entity_id):null,unit_price:unit};
    if(record&&price.kind==='unlisted')
        return {...base,available:false,in_stock:0,order:null,note:'The book lists no open price for this; it is not on any shelf and cannot be ordered over the counter. It changes hands only through a contact.'};
    const chance=Math.max(0,AVAILABILITY[shop.trade][shop.rarity]-SETTLEMENT_PENALTY[shop.settlement]);
    const available=weekly()%100<chance;
    const service=price.kind==='per_unit';
    const rolled=available&&!service?dice(weekly,STOCK[shop.rarity]):0;
    const shelf=!available?0:service?null:Math.max(1,shop.settlement==='village'?Math.floor(rolled/2):rolled);
    const left=shelf===null?null:Math.max(0,shelf-soldThisPeriod(world,shop.outlet,key,period));
    const orderable=shop.trade!=='unlikely'&&!service;
    const days=orderable?Math.ceil(dice(draws([graph.moduleId,outlet,key,'order']),ORDER_DAYS[shop.rarity])*ORDER_SCALE[shop.settlement]):0;
    return {...base,available:available&&(left===null||left>0),in_stock:left,order:orderable?{days,ready_day:day+days}:null};
}
export function moduleEra(graph:ModuleGraph):string|null {
    const era=normalize(string(moduleDeclaration(graph.moduleNode).era));
    return era.includes('1920')?'1920s':era.includes('modern')||era.includes('present')?'modern':null;
}
const catalogs=new WeakMap<KernelContext,Catalog>();
function catalogOf(kernel:KernelContext):Catalog {
    let catalog=catalogs.get(kernel);if(!catalog){catalog=new Catalog(new RuleTables(kernel));catalogs.set(kernel,catalog);}return catalog;
}
export async function itemRecord(kernel:KernelContext,priceId:string):Promise<Row|null> {
    return (await catalogOf(kernel).records(['item'])).find(record=>string(record.entity_id)===priceId)??null;
}
const lineOf=(offer:ShopOffer)=>({name:offer.name,quantity:1,...(offer.unit_price!==null?{unit_price:offer.unit_price}:{}),...(offer.price_id?{price_id:offer.price_id}:{})});
const ANSWER='Binding for this outlet this game week: say what is there, how many and at what price, or that it is not, and what an order takes. Copy a row\'s line into cash items with the same shop object. Where unit_price is absent the book prints no price: estimate one for the period and region.';

/** `table.lookup kind=shop` (§265.2): catalog matches for the goods with this outlet's answer for each, and the goods as named. */
export async function shopLookup(kernel:KernelContext,graph:ModuleGraph,world:Row,params:Row):Promise<Row> {
    if(!await shoppingActive(kernel,world))
        throw new RpcError('not_implemented','lookup kind=shop needs the Shopping package enabled',{fix:'Price goods from lookup kind=catalog and your own judgment of the outlet.'});
    const query=params.query;
    if(typeof query!=='string'||!query.trim())throw new RpcError('invalid_params','kind shop needs query: the goods asked for, in English, as the price list would name them');
    const shop=shopParams(params.shop),era=moduleEra(graph);
    const found=await catalogOf(kernel).search(query.trim(),{kinds:['item'],limit:params.limit??5,...(era?{era}:{})});
    if(!found.ok)throw new RpcError('invalid_params',string(row(found.error).detail||'bad goods query'),{details:row(found.error)});
    const goods=array(found.candidates).map(candidate=>{
        const offer=shopOffer(graph,world,shop,candidate,string(candidate.name));
        return {...offer,source_display:row(row(candidate.params).price).source_display??null,category:candidate.category??null,line:lineOf(offer)};
    });
    const asked=shopOffer(graph,world,shop,null,query.trim());
    return {query,outlet:shop.outlet,day:shopDay(graph,world),goods,as_named:{...asked,line:lineOf(asked)},note:ANSWER};
}

/**
 * §265.5: a cash line set carrying `shop` is checked against the outlet before any money moves. Returns the fields the quote
 * and receipt keep, and, for a sale off the shelf, what to write to the ledger once the cash settles.
 */
export async function shopTerms(kernel:KernelContext,graph:ModuleGraph,world:Row,effect:Row,mode:string):Promise<{fields:Row;sold:Array<[string,number]>}> {
    if(!await shoppingActive(kernel,world))
        throw new RpcError('invalid_params','shop needs the Shopping package enabled',{fix:'Omit shop; price the lines yourself.'});
    const shop=shopParams(effect.shop),day=shopDay(graph,world);
    if(!Array.isArray(effect.items))throw new RpcError('invalid_params','shop checks priced lines: give items',{details:{field:'items'}});
    // A saved order is collected, not re-stocked: its goods were set aside for it.
    if(typeof effect.ready_day==='number'){
        if(mode!=='quote'&&day<effect.ready_day)throw new RpcError('needs',`This order is not in until day ${effect.ready_day}; today is day ${day}`,
            {fix:'Tell the player when it will be in. It can be collected and paid for from that day.',details:{reason:'order_not_ready',ready_day:effect.ready_day,day}});
        return {fields:{shop:effect.shop,ready_day:effect.ready_day},sold:[]};
    }
    const sold:Array<[string,number]>=[];let ready=0;
    for(const [index,line] of effect.items.entries()){
        const lineName=string(row(line).name).trim(),priceId=string(row(line).price_id).trim();
        const record=priceId?await itemRecord(kernel,priceId):null;
        if(priceId&&!record)throw new RpcError('invalid_params',`The price list has no record ${JSON.stringify(priceId)}`,{fix:'Use a price_id lookup kind=shop returned, or drop price_id for goods the book does not print.',details:{field:`items[${index}].price_id`}});
        const offer=shopOffer(graph,world,shop,record,lineName);
        if(offer.unit_price!==null){
            const given=decimalSpelling(String(row(line).unit_price));
            if(!given||compareCash(given,decimalSpelling(offer.unit_price)!)!==0)
                throw new RpcError('invalid_params',`${offer.name} costs ${offer.unit_price} at ${shop.outlet}`,{fix:`Use unit_price "${offer.unit_price}" for this line. A price the player bargained down is the seller's quote: drop shop and price_id for it.`,
                    details:{field:`items[${index}].unit_price`,unit_price:offer.unit_price}});
        }
        const quantity=number(row(line).quantity);
        if(shop.order){
            if(!offer.order)throw new RpcError('needs',`${shop.outlet} cannot order ${offer.name}`,{fix:offer.note??'This outlet does not deal in it; the investigator has to look elsewhere.',details:{reason:'not_orderable',goods:offer.name}});
            ready=Math.max(ready,offer.order.ready_day);
            continue;
        }
        if(!offer.available||offer.in_stock!==null&&quantity>offer.in_stock)
            throw new RpcError('needs',offer.available?`${shop.outlet} has only ${offer.in_stock} ${offer.name}`:`${shop.outlet} has no ${offer.name} this week`,{
                fix:[offer.note,offer.order?`It can be ordered: in ${offer.order.days} days (day ${offer.order.ready_day}); resend with shop.order true if the player orders it.`:'It cannot be ordered here.','Tell the player; do not sell what is not there.'].filter(Boolean).join(' '),
                details:{reason:'out_of_stock',goods:offer.name,in_stock:offer.in_stock,order:offer.order}});
        if(offer.in_stock!==null)sold.push([offer.key,quantity]);
    }
    return {fields:{shop:effect.shop,...(shop.order?{ready_day:ready}:{})},sold:mode==='quote'?[]:sold};
}
/** §265.5: what a settled sale took off the shelf this week. */
export function recordSale(graph:ModuleGraph,world:Row,effect:Row,sold:Array<[string,number]>):void {
    if(!sold.length)return;
    const shop=shopParams(effect.shop),period=Math.floor(shopDay(graph,world)/PERIOD_DAYS),book=ledger(world),key=outletKey(shop.outlet);
    const entry=row(book.outlets[key]),current=number(entry.period)===period?row(entry.sold):{};
    for(const [goods,count] of sold)current[goods]=number(current[goods])+count;
    book.outlets[key]={name:shop.outlet,period,sold:current};world.shop_ledger=book;
}
