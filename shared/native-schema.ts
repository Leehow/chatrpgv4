/** Redundant property views make closed unions legible without replacing their guards. */
type Schema=Record<string,any>;
const object=(value:unknown):value is Schema=>!!value&&typeof value==='object'&&!Array.isArray(value);
const unique=(values:unknown[])=>[...new Map(values.map(value=>[JSON.stringify(value),value])).values()];

export function legibleClosedSchema<T extends Schema>(schema:T):T {
 const visit=(node:any):any=>{
  if(!object(node))return node;
  const own={...node,...(object(node.properties)?{properties:Object.fromEntries(Object.entries(node.properties).map(([key,value])=>[key,visit(value)]))}:{}),
   ...(object(node.items)?{items:visit(node.items)}:{})};
  const variants=node.anyOf;
  if(Array.isArray(variants)&&variants.length&&variants.every(object)){
   const values=variants.flatMap(branch=>typeof branch.const==='string'?[branch.const]:Array.isArray(branch.enum)&&branch.enum.every((value:unknown)=>typeof value==='string')?branch.enum:[]);
   if(variants.every(branch=>typeof branch.const==='string'||Array.isArray(branch.enum)&&branch.enum.every((value:unknown)=>typeof value==='string')))
    return {type:'string',enum:unique(values),...own};
   if(variants.every(branch=>branch.type==='array'&&object(branch.items)&&branch.prefixItems===undefined)){
    const items=unique(variants.flatMap(branch=>Array.isArray(branch.items.anyOf)?branch.items.anyOf:[branch.items]));
    return {type:'array',items:visit(items.length===1?items[0]:{anyOf:items}),...own};
   }
   if(variants.every(branch=>branch.type==='object'&&branch.additionalProperties===false&&object(branch.properties)&&branch.patternProperties===undefined)){
    const fields=new Map<string,unknown[]>();
    for(const branch of variants)for(const [key,value]of Object.entries(branch.properties))fields.set(key,[...(fields.get(key)??[]),value]);
    const properties=Object.fromEntries([...fields].map(([key,values])=>{const choices=unique(values);return[key,visit(choices.length===1?choices[0]:{anyOf:choices})];}));
    const required=(variants[0].required??[]).filter((key:string)=>variants.every(branch=>branch.required?.includes(key)));
    return {type:'object',properties,required,additionalProperties:false,...own};
   }
   return own;
  }
  return own;
 };
 return visit(structuredClone(schema));
}
