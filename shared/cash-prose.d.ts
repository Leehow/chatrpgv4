type Row=Record<string,any>;
export function priceRows(effects?:unknown,quotes?:unknown):Row[];
export function bindPriceText(text:string,rows:readonly Row[]):{text:string;bound:Row[];unresolved:string[]};
