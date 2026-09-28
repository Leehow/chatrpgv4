/** Source requests and deferred limits are classified by readers, never by lexical routing. */
export const SOURCE_NEED_KINDS=['source_read','runtime_context','deferred','uncertain'] as const;
export type SourceNeed={kind:typeof SOURCE_NEED_KINDS[number];focus:string;question:string;reason:string;trigger:string;source_refs:Array<{page:number}>};
export function sourceNeedKey(need:{source_sha256?:unknown;node_id?:unknown;kind?:unknown;question?:unknown}):string{
 return JSON.stringify([need.source_sha256,need.node_id,need.kind,typeof need.question==='string'?need.question.trim():need.question]);
}
export function validateSourceNeeds(value:unknown,pageCount:number):SourceNeed[]{
 if(!Array.isArray(value)||value.length>32)throw new Error('source_needs must be a bounded array');
 for(const need of value){
   if(!need||typeof need!=='object'||Array.isArray(need)||Object.keys(need).sort().join(',')!=='focus,kind,question,reason,source_refs,trigger'||
     !SOURCE_NEED_KINDS.includes(need.kind))throw new Error('Invalid source need fields or kind');
   for(const [field,limit] of [['focus',160],['question',1200],['reason',600],['trigger',600]] as const)
     if(typeof need[field]!=='string'||!need[field].trim()||Array.from(need[field]).length>limit)throw new Error(`Invalid source need ${field}`);
   if(!Array.isArray(need.source_refs)||need.source_refs.length>12||need.source_refs.some((ref:any)=>!ref||Object.keys(ref).join(',')!=='page'||
     !Number.isSafeInteger(ref.page)||ref.page<1||ref.page>pageCount))throw new Error('Source need references must name original physical pages');
   if(['runtime_context','deferred'].includes(need.kind)&&!need.source_refs.length)throw new Error('A retained source limit needs original-page references');
 }
 return value as SourceNeed[];
}
