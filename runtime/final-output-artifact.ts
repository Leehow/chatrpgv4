/** Structural artifact validation only; coverage is evidence, never semantic authorization. */
import {EmptySpeechStream,sayRanges} from '../kernel-ts/write/speech-pass.ts';
export interface DeliveryPart {text:string;materials?:string[]}
export interface DeliveryCoverage {name: string; start: number; end: number}
export interface DeliveryArtifact {version: 1; text: string; coverage: DeliveryCoverage[]}
/** The delivery owner has already filtered this DTO to permitted public material. */
export function deliveryMaterialNames(materials:unknown):string[]{
  return Array.isArray(materials)?materials.flatMap(material=>material&&typeof material.name==='string'
    ?[material.name,...(typeof material.event_ref==='string'&&material.name.startsWith(material.event_ref+'/')?[material.name.slice(material.event_ref.length+1)]:[])]:[]):[];
}
/** One text representation; constants and positions belong to the host. */
export function compileDeliveryParts(input:unknown,materials:unknown,required:readonly string[]=[]):DeliveryArtifact{
  const value=input as {parts:DeliveryPart[]};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>key!=='parts')
    ||!Array.isArray(value.parts)||!value.parts.length||value.parts.length>128)throw Error('write requires only parts, an array of 1..128 text parts');
  const names=deliveryMaterialNames(materials),rows=Array.isArray(materials)?materials:[];
  let text='',original='';const parts=value.parts.map((part,index)=>{
    if(!part||typeof part!=='object'||Array.isArray(part)||Object.keys(part).some(key=>!['text','materials'].includes(key))
      ||typeof part.text!=='string'||!part.text.trim()||part.materials!==undefined&&(!Array.isArray(part.materials)||part.materials.length>128
        ||part.materials.some(name=>typeof name!=='string'||!names.includes(name))))throw Error(`Invalid parts[${index}]; use text and optional currently supplied material names`);
    original+=part.text;if(Buffer.byteLength(original,'utf8')>128000)throw Error('Final artifact exceeds its transport budget');
    const body=new EmptySpeechStream().push(part.text,true),start=text.length;text+=body;
    if(Buffer.byteLength(text,'utf8')>64000)throw Error('Final text exceeds its budget');
    return {start,end:text.length,names:[...new Set(part.materials??[])]};
  });
  if(new EmptySpeechStream().push(original,true)!==text||new EmptySpeechStream().push(text,true)!==text)throw Error('Keep speech markers and their text within complete parts');
  const speech=sayRanges(text,name=>({label:name}));
  const coverage=parts.flatMap(part=>part.names.flatMap(name=>{
    const matches=rows.filter(material=>material?.name===name);
    if(matches.length!==1)throw Error('A declared material must bind one current supplied material');
    return matches[0].kind==='speech'?speech.map(range=>({name,start:Math.max(part.start,range.start),end:Math.min(part.end,range.end)}))
      .filter(range=>range.start<range.end&&text.slice(range.start,range.end).trim()):[{name,start:part.start,end:part.end}];
  }));
  return validateDeliveryArtifact({version:1,text,coverage},names,required);
}
export function validateDeliveryArtifact(value: unknown, names: readonly string[], required: readonly string[]): DeliveryArtifact {
  const artifact = value as DeliveryArtifact;
  if (!artifact || artifact.version !== 1 || typeof artifact.text !== 'string' || !artifact.text.trim()
    || Buffer.byteLength(artifact.text, 'utf8') > 64000 || !Array.isArray(artifact.coverage) || artifact.coverage.length > 128
    || Object.keys(artifact).some(key => !['version', 'text', 'coverage'].includes(key))) throw Error('Invalid final-output artifact');
  const coverage:DeliveryCoverage[]=[];
  for (const [index,entry] of artifact.coverage.entries()) {
    let span=entry;
    const quoted=entry as unknown as {name:string;quote?:string;occurrence?:number};
    if (quoted.quote!==undefined) {
      if (typeof quoted.quote!=='string'||!quoted.quote.trim()||Object.keys(entry).some(k=>!['name','quote','occurrence'].includes(k))) throw Error('Invalid coverage quotation');
      const occurrence=quoted.occurrence??0;
      if(!Number.isSafeInteger(occurrence)||occurrence<0||occurrence>128)throw Error('Invalid coverage occurrence');
      let start=-1,from=0;
      for(let at=0;at<=occurrence;at++){start=artifact.text.indexOf(quoted.quote,from);if(start<0)throw Error(`Coverage quotation is absent at coverage[${index}].quote; select an exact substring of text`);from=start+quoted.quote.length;}
      span={name:quoted.name,start,end:start+quoted.quote.length};
    }
    if (!span || Object.keys(span).some(key => !['name', 'start', 'end'].includes(key)) || !names.includes(span.name)
      || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end <= span.start
      || span.end > artifact.text.length || !artifact.text.slice(span.start, span.end).trim()) throw Error('Invalid material coverage span');
    coverage.push(span);
  }
  if (required.some(name => !coverage.some(span => span.name === name))) throw Error('Required material has no coverage declaration');
  return {version:1,text:artifact.text,coverage};
}
