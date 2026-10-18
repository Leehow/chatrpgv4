/** Exact transport envelopes at schema-declared arrays; never action inference. */
import type {TSchema} from 'typebox';
import {Value} from 'typebox/value';
import {isDeepStrictEqual} from 'node:util';

type Result={args:unknown;repairs:number;integerRepairs:number};
type Shape=TSchema&{type?:string;minimum?:number;maximum?:number;anyOf?:TSchema[];oneOf?:TSchema[];items?:TSchema|TSchema[];properties?:Record<string,TSchema>};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const valid=(schema:TSchema,value:unknown)=>{try{return Value.Check(schema,value);}catch{return false;}};

export function normalizeToolArgumentSyntax(schema:TSchema,input:unknown,options:{boundedIntegers?:boolean}={}):Result {
 const visit=(schema:TSchema,value:unknown,depth:number):Result=>{
  const shape=schema as Shape;
  const unchanged={args:value,repairs:0,integerRepairs:0};
  if(depth>32)return unchanged;
  if(options.boundedIntegers&&shape.type==='integer'&&typeof shape.minimum==='number'&&Number.isFinite(shape.minimum)&&typeof shape.maximum==='number'&&Number.isFinite(shape.maximum)&&typeof value==='string'){
   const number=Number(value);
   if(Number.isSafeInteger(number)&&String(number)===value&&number>=shape.minimum&&number<=shape.maximum)return {args:number,repairs:0,integerRepairs:1};
  }
  const variants=shape.anyOf??shape.oneOf;
  if(Array.isArray(variants)){
   const matches=variants.map((branch:TSchema)=>({branch,result:visit(branch,value,depth+1)}))
    .filter(({branch,result})=>valid(branch,result.args));
   return matches.length===1||shape.anyOf&&matches.length>1&&matches.every(match=>isDeepStrictEqual(match.result.args,matches[0].result.args))?matches[0].result:unchanged;
  }
  if(shape.type==='array'&&shape.items&&!Array.isArray(shape.items)){
   let candidate=value,layers=0;
   while(object(candidate)&&Object.keys(candidate).length===1&&Object.hasOwn(candidate,'item')&&layers<4){candidate=candidate.item;layers++;}
   const values=Array.isArray(candidate)?candidate:layers?[candidate]:undefined;
   if(!values)return unchanged;
   const children=values.map(item=>visit(shape.items as TSchema,item,depth+1));
   const repairs=children.reduce((sum,child)=>sum+child.repairs,0);
   const integerRepairs=children.reduce((sum,child)=>sum+child.integerRepairs,0);
   const next=repairs||integerRepairs?children.map(child=>child.args):values;
   if(layers&&!valid(schema,next))return unchanged;
   return layers||repairs||integerRepairs?{args:next,repairs:repairs+(layers?1:0),integerRepairs}:unchanged;
  }
  if(shape.type==='object'&&object(value)){
   let next=value,repairs=0,integerRepairs=0;
   for(const [key,property] of Object.entries(shape.properties??{})){
    if(!Object.hasOwn(value,key))continue;
    const child=visit(property as TSchema,value[key],depth+1);
    if(child.repairs||child.integerRepairs){next={...next,[key]:child.args};repairs+=child.repairs;integerRepairs+=child.integerRepairs;}
   }
   return {args:next,repairs,integerRepairs};
  }
  return unchanged;
 };
 return visit(schema,input,0);
}
