/** Omit impossible branches of the closed output grammar; execution keeps its canonical schema. */
import type {TSchema} from 'typebox';
type Row=Record<string,any>;
const object=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);

export function availableOutputSchema(schema:TSchema):TSchema {
 let changed=false;
 const visit=(value:Row):Row|undefined=>{
  if(Array.isArray(value.enum)&&value.enum.length===0||object(value.not)&&Object.keys(value.not).length===0){changed=true;return;}
  const result={...value};
  for(const key of ['anyOf','oneOf'])if(Array.isArray(value[key])){
   const variants=value[key].map(visit).filter(Boolean);
   if(!variants.length)return;
   result[key]=variants;
  }
  if(object(value.properties)){
   const properties:Row={};
   for(const [key,child]of Object.entries(value.properties)){
    const possible=visit(child as Row);
    if(possible)properties[key]=possible;
    else if(value.required?.includes(key))return;
    else if(value.additionalProperties!==false)throw Error('An unavailable output field requires a closed object');
   }
   result.properties=properties;
  }
  if(object(value.items)){
   const items=visit(value.items);
   if(items)result.items=items;
   else if((value.minItems??0)>0)return;
   else{delete result.items;result.maxItems=0;}
  }
  return result;
 };
 const result=visit(schema as Row);
 if(!result)throw Error('The current output contract has no valid input');
 return changed?result as TSchema:schema;
}
