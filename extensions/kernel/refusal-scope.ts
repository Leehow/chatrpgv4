/** Closed effect families separate admission holds without interpreting their prose. */
export function admissionRefusalScope(tool:string,input:unknown):string {
 if(tool!=='apply'||!input||typeof input!=='object')return tool;
 const effects=(input as {effects?:unknown}).effects;
 if(!Array.isArray(effects)||!effects.length)return tool;
 const kinds=effects.map(effect=>effect&&typeof effect==='object'?(effect as {kind?:unknown}).kind:undefined);
 if(kinds.some(kind=>typeof kind!=='string'||!kind))return tool;
 return `${tool}[${[...new Set(kinds as string[])].sort().join(',')}]`;
}
