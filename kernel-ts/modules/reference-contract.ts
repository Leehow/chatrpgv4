/** Host-owned exact original-text references; no PDF parsing occurs in the kernel. */
export const SOURCE_REFERENCE_PROTOCOL='source-reference-v1';
export const REFERENCE_FIELDS=['era','place','premise','advice','warnings','opening'] as const;
export type ReferenceField=typeof REFERENCE_FIELDS[number];
export type ReferenceExcerpt={id:string;page:number;start:number;end:number;text:string};
export type ReferenceEntry={id:string;name:string;page:number;era_text?:string;era_span?:string};
export type SourceReferencePacket={protocol:typeof SOURCE_REFERENCE_PROTOCOL;source_sha256:string;extraction_version:string;
 purpose:string;question:string;excerpts:ReferenceExcerpt[];fields:Record<ReferenceField,string[]>;entries:ReferenceEntry[];
 places?:{id:string;name:string;page:number}[];partial:true;visual_coverage:'unassessed';unavailable_pages:number[]};
export function validateReferencePacket(value:any,pageCount:number,sourceSha:string):SourceReferencePacket{
 if(!value||value.protocol!==SOURCE_REFERENCE_PROTOCOL||value.source_sha256!==sourceSha||typeof value.extraction_version!=='string'||
  typeof value.purpose!=='string'||typeof value.question!=='string'||value.partial!==true||value.visual_coverage!=='unassessed'||
  !Array.isArray(value.excerpts)||!value.excerpts.length||value.excerpts.length>48||!Array.isArray(value.entries)||value.entries.length>16||
  !Array.isArray(value.unavailable_pages))throw Error('Invalid original-source reference packet');
 const ids=new Set<string>();
 for(const span of value.excerpts){
  if(!span||typeof span.id!=='string'||ids.has(span.id)||!Number.isSafeInteger(span.page)||span.page<1||span.page>pageCount||
   !Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||span.start<0||span.end<=span.start||
   typeof span.text!=='string'||span.text.length!==span.end-span.start||span.text.length>12000)throw Error('Invalid original-source excerpt');
  ids.add(span.id);
 }
 for(const key of REFERENCE_FIELDS)if(!Array.isArray(value.fields?.[key])||value.fields[key].some((id:unknown)=>typeof id!=='string'||!ids.has(id)))throw Error('Invalid reference field selection');
 const entries=new Set();for(const entry of value.entries){
  if(!entry||typeof entry.id!=='string'||!/^scene-source-entry-[0-9]+$/.test(entry.id)||entries.has(entry.id)||
   typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>400||!Number.isSafeInteger(entry.page)||entry.page<1||entry.page>pageCount)throw Error('Invalid reference entrance');
  entries.add(entry.id);
  if(entry.era_text!==undefined&&(typeof entry.era_text!=='string'||entry.era_text.length>200||!value.excerpts.some((span:ReferenceExcerpt)=>span.id===entry.era_span&&span.text.includes(entry.era_text))))throw Error('Era selection is not copied from the original source');
 }
 if(value.places!==undefined&&(!Array.isArray(value.places)||value.places.length>1||value.places.some((place:any)=>!place||!/^scene-source-place-[0-9]+-[0-9]+$/.test(place.id)||typeof place.name!=='string'||!place.name.trim()||!value.excerpts.some((span:ReferenceExcerpt)=>span.page===place.page))))throw Error('Invalid source place identity');
 if(value.unavailable_pages.some((page:unknown)=>!Number.isSafeInteger(page)||Number(page)<1||Number(page)>pageCount))throw Error('Invalid source coverage');
 return value;
}
