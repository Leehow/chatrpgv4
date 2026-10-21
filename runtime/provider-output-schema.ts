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

/** Exact request-only sharing for providers verified to support local references. */
export function sharedOutputSchema(schema:TSchema):TSchema {
 const maps=['properties','patternProperties','dependentSchemas'];
 const lists=['allOf','anyOf','oneOf','prefixItems'];
 const singles=['items','additionalItems','additionalProperties','unevaluatedProperties','unevaluatedItems','contains','not','if','then','else','propertyNames','contentSchema'];
 const children=(node:Row,visit:(child:Row)=>Row):Row=>{
  const result={...node};
  for(const key of maps)if(object(node[key]))result[key]=Object.fromEntries(Object.entries(node[key]).map(([name,child])=>[name,object(child)?visit(child):child]));
  for(const key of lists)if(Array.isArray(node[key]))result[key]=node[key].map(child=>object(child)?visit(child):child);
  for(const key of singles)if(object(node[key]))result[key]=visit(node[key]);
  return result;
 };
 const counts=new Map<string,number>();let scoped=false;
 const count=(node:Row):Row=>{
  if(Object.keys(node).some(key=>['$ref','$dynamicRef','$recursiveRef','$id','id','$anchor','$dynamicAnchor','$recursiveAnchor','$defs','definitions'].includes(key)))scoped=true;
  const key=JSON.stringify(node);if(key.length>=256)counts.set(key,(counts.get(key)??0)+1);
  children(node,count);return node;
 };
 count(schema);if(scoped)return schema;
 const definitions:Row={},names=new Map<string,string>();
 const emit=(node:Row,root=false):Row=>{
  const key=JSON.stringify(node);
  if(!root&&(counts.get(key)??0)>1){
   let name=names.get(key);
   if(!name){name='shared_'+(names.size+1);names.set(key,name);definitions[name]=children(node,child=>emit(child));}
   return {$ref:'#/$defs/'+name};
  }
  return children(node,child=>emit(child));
 };
 const result={...emit(schema,true),...(names.size?{$defs:definitions}:{})};
 return JSON.stringify(result).length<JSON.stringify(schema).length?result as TSchema:schema;
}
