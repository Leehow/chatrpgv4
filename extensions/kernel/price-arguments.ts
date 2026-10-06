/** Native pre-validation compatibility: one unit_price spelling, never a second price source. */
export function preparePriceArguments(tool:string,args:unknown):unknown {
    if(!args||typeof args!=='object'||Array.isArray(args)||!['apply','narrate'].includes(tool))return args;
    const input=args as Record<string,any>;
    const lines=(items:any)=>Array.isArray(items)?items.map(item=>item&&typeof item==='object'&&typeof item.unit_price==='number'&&Number.isFinite(item.unit_price)
        ?{...item,unit_price:String(item.unit_price)}:item):items;
    return {...input,
        ...(Array.isArray(input.effects)?{effects:input.effects.map((effect:any)=>effect?.kind==='cash'?{...effect,items:lines(effect.items)}:effect)}:{}),
        ...(Array.isArray(input.quotes)?{quotes:input.quotes.map((quote:any)=>({...quote,items:lines(quote.items)}))}:{})};
}
