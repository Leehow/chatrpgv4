/** Schema-declared transport syntax only; never action inference. */
import {Type,type TSchema} from 'typebox';
import {Value} from 'typebox/value';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {isDeepStrictEqual} from 'node:util';

type Result={args:unknown;repairs:number;integerRepairs:number;booleanRepairs?:number;textRepairs?:number};
type Shape=TSchema&{type?:string;minimum?:number;maximum?:number;anyOf?:TSchema[];oneOf?:TSchema[];items?:TSchema|TSchema[];properties?:Record<string,TSchema>};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const nativeSchemas=new WeakMap<object,TSchema>();
const arrayEnvelope=(value:unknown):{values:unknown[]|undefined;layers:number}=>{
 let candidate=value,layers=0;
 while(object(candidate)&&Object.keys(candidate).length===1&&Object.hasOwn(candidate,'item')&&layers<4){candidate=candidate.item;layers++;}
 return {values:Array.isArray(candidate)?candidate:layers?[candidate]:undefined,layers};
};
/** Literal discriminators exclude impossible branches without interpreting invalid fields. */
function compatible(schema:TSchema,value:unknown,depth=0):boolean {
 if(depth>32)return false;
 const shape=schema as Shape,variants=shape.anyOf??shape.oneOf;
 if(variants&&shape.type===undefined)return variants.some(branch=>compatible(branch,value,depth+1));
 if(shape.type==='array'&&shape.items&&!Array.isArray(shape.items)){
  const {values}=arrayEnvelope(value);
  return !values||values.every(item=>compatible(shape.items as TSchema,item,depth+1));
 }
 return shape.type!=='object'||!object(value)||Object.entries(shape.properties??{}).every(([key,property])=>
  !Object.hasOwn(property,'const')||(!Object.hasOwn(value,key)?!shape.required?.includes(key):isDeepStrictEqual(value[key],property.const)));
}
const valid=(schema:TSchema,value:unknown,native:boolean)=>{
 try{
  if(Value.Check(schema,value))return true;
  if(!native)return false;
  let parameters=nativeSchemas.get(schema);
  if(!parameters){parameters=Type.Object({value:schema});nativeSchemas.set(schema,parameters);}
  // The SDK clones this isolated argument. Its coercions prove acceptability only;
  // the returned transport keeps its original scalar values for the real validator.
  validateToolArguments({name:'argument-syntax',description:'',parameters},{type:'toolCall',id:'argument-syntax',name:'argument-syntax',arguments:{value}});
  return true;
 }catch{return false;}
};

export function normalizeToolArgumentSyntax(schema:TSchema,input:unknown,options:{boundedIntegers?:boolean;exactBooleans?:boolean;nativeValidation?:boolean;partialTransport?:boolean}={}):Result {
 const visit=(schema:TSchema,value:unknown,depth:number):Result=>{
  const shape=schema as Shape;
  const unchanged={args:value,repairs:0,integerRepairs:0};
  if(depth>32)return unchanged;
  if(options.exactBooleans&&shape.type==='boolean'&&(value==='true'||value==='false')){
   const decoded=value==='true';
   if(Value.Check(schema,decoded))return {args:decoded,repairs:0,integerRepairs:0,booleanRepairs:1};
  }
  if(options.boundedIntegers&&shape.type==='integer'&&typeof shape.minimum==='number'&&Number.isFinite(shape.minimum)&&typeof shape.maximum==='number'&&Number.isFinite(shape.maximum)&&typeof value==='string'){
   const number=Number(value);
   if(Number.isSafeInteger(number)&&String(number)===value&&number>=shape.minimum&&number<=shape.maximum)return {args:number,repairs:0,integerRepairs:1};
  }
  const variants=shape.anyOf??shape.oneOf;
  if(Array.isArray(variants)&&shape.type===undefined){
   const visited=variants.map((branch:TSchema)=>({branch,result:visit(branch,value,depth+1)}));
   const validMatches=visited.filter(({branch,result})=>valid(branch,result.args,options.nativeValidation===true));
   const matches=validMatches.length?validMatches:options.partialTransport?visited.filter(({branch,result})=>compatible(branch,result.args)):[];
   return matches.length===1||(shape.anyOf||options.partialTransport&&!validMatches.length)&&matches.length>1&&matches.every(match=>isDeepStrictEqual(match.result.args,matches[0].result.args))?matches[0].result:unchanged;
  }
  if(shape.type==='array'&&shape.items&&!Array.isArray(shape.items)){
   const {values,layers}=arrayEnvelope(value);
   if(!values)return unchanged;
   const children=values.map(item=>visit(shape.items as TSchema,item,depth+1));
   const repairs=children.reduce((sum,child)=>sum+child.repairs,0);
   const integerRepairs=children.reduce((sum,child)=>sum+child.integerRepairs,0);
   const booleanRepairs=children.reduce((sum,child)=>sum+(child.booleanRepairs??0),0);
   const textRepairs=children.reduce((sum,child)=>sum+(child.textRepairs??0),0);
   const next=repairs||integerRepairs||booleanRepairs||textRepairs?children.map(child=>child.args):values;
   if(layers&&!options.partialTransport&&!valid(schema,next,options.nativeValidation===true))return unchanged;
   return layers||repairs||integerRepairs||booleanRepairs||textRepairs?{args:next,repairs:repairs+(layers?1:0),integerRepairs,...(booleanRepairs?{booleanRepairs}:{}),...(textRepairs?{textRepairs}:{})}:unchanged;
  }
  if(shape.type==='object'&&object(value)){
   const fields=Object.entries(shape.properties??{});
   if(options.partialTransport&&shape.additionalProperties===false&&fields.length===1&&typeof value.$text==='string'){
    const [field,property]=fields[0],prefix=field+'>';
    if(property.type==='string'&&value[field]===''&&Object.keys(value).length===2&&value.$text.startsWith(prefix)){
     const decoded={[field]:value.$text.slice(prefix.length)};
     if(Value.Check(schema,decoded))return {args:decoded,repairs:0,integerRepairs:0,textRepairs:1};
    }
   }
   let next=value,repairs=0,integerRepairs=0,booleanRepairs=0,textRepairs=0;
   for(const [key,property] of Object.entries(shape.properties??{})){
    if(!Object.hasOwn(value,key))continue;
    const child=visit(property as TSchema,value[key],depth+1);
    if(child.repairs||child.integerRepairs||child.booleanRepairs||child.textRepairs){next={...next,[key]:child.args};repairs+=child.repairs;integerRepairs+=child.integerRepairs;booleanRepairs+=child.booleanRepairs??0;textRepairs+=child.textRepairs??0;}
   }
   return {args:next,repairs,integerRepairs,...(booleanRepairs?{booleanRepairs}:{}),...(textRepairs?{textRepairs}:{})};
  }
  return unchanged;
 };
 return visit(schema,input,0);
}
