/** Closed effect families separate admission holds without interpreting their prose. */
export function admissionRefusalScope(tool:string,input:unknown):string {
 if(tool!=='apply'||!input||typeof input!=='object')return tool;
 const effects=(input as {effects?:unknown}).effects;
 if(!Array.isArray(effects)||!effects.length)return tool;
 const kinds=effects.map(effect=>effect&&typeof effect==='object'?(effect as {kind?:unknown}).kind:undefined);
 if(kinds.some(kind=>typeof kind!=='string'||!kind))return tool;
 return `${tool}[${[...new Set(kinds as string[])].sort().join(',')}]`;
}
const effectKinds=(input:unknown):string[]=>{
 const effects=input&&typeof input==='object'?(input as {effects?:unknown}).effects:undefined;
 return Array.isArray(effects)?effects.map(effect=>effect&&typeof effect==='object'?(effect as {kind?:unknown}).kind:undefined)
  .filter((kind):kind is string=>typeof kind==='string'&&!!kind):[];
};
/**
 * §268.5: an apply refusal belongs to the kind of the effect the kernel refused (its `index`, else the first effect), so
 * three refusals of one paper shut object writes and leave the place move that would fix them open.
 */
export function refusedEffectScope(tool:string,input:unknown,index:unknown):string {
 if(tool!=='apply')return tool;
 const kinds=effectKinds(input),kind=Number.isInteger(index)&&kinds[index as number]?kinds[index as number]:kinds[0];
 return kind?`${tool}[${kind}]`:tool;
}
/** The per-kind scopes an apply call touches, for the gate that reads what refusals already shut. */
export function effectScopes(tool:string,input:unknown):string[] {
 return tool==='apply'?[...new Set(effectKinds(input))].map(kind=>`${tool}[${kind}]`):[];
}
