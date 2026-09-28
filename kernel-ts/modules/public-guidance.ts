/** Closed public preparation artifact; semantic source and disclosure checks belong to independent review. */
export const PUBLIC_GUIDANCE_FIELDS=['era','starting_place','public_premise','creation_advice'] as const;
export type PublicGuidanceField=typeof PUBLIC_GUIDANCE_FIELDS[number];
export type PublicGuidance=Record<PublicGuidanceField,{status:'value'|'needs_choice'|'unavailable';text:string;source_refs:Array<{page:number}>}>;

export function validatePublicGuidance(value:unknown,pageCount:number):PublicGuidance{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...PUBLIC_GUIDANCE_FIELDS].sort().join(','))
   throw new Error('Public guidance must contain exactly the four public setup fields');
 for(const key of PUBLIC_GUIDANCE_FIELDS){
   const row=(value as PublicGuidance)[key];
   if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!=='source_refs,status,text'||
     !['value','needs_choice','unavailable'].includes(row.status)||typeof row.text!=='string'||Array.from(row.text).length>1000||
     !Array.isArray(row.source_refs)||row.source_refs.length>12||row.source_refs.some(ref=>!ref||typeof ref!=='object'||
       Object.keys(ref).join(',')!=='page'||!Number.isSafeInteger(ref.page)||ref.page<1||ref.page>pageCount))
     throw new Error(`Invalid public setup field: ${key}`);
   if(row.status==='value'?(!row.text.trim()||!row.source_refs.length):row.text!=='')throw new Error(`Invalid public setup value: ${key}`);
 }
 return value as PublicGuidance;
}
