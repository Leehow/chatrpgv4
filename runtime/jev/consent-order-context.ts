/** Source syntax and conditional typed position only; neither grants authority. */
type Row=Record<string,any>;
export function declarationSegments(source:string):{index:number;text:string}[] {
 const spans=source.split(/(?<=[,;\u{ff0c}\u{ff1b}\u{3002}.!?])/u).filter(Boolean);
 const bounded=spans.length>64?[...spans.slice(0,63),spans.slice(63).join('')]:spans;
 return bounded.map((text,index)=>({index,text}));
}
export function conditionalExecutionPositions(operations:readonly Row[],preceding:readonly Row[],current:Row|undefined):Row[] {
 const advance=(position:Row|null,operation:Row):Row|null=>{
  if(operation.kind!=='move'&&!(operation.kind==='place'&&operation.action==='move'))return position;
  const place=operation.to==='here'?position?.place:operation.registered_destination?.handle??operation.to;
  if(typeof place!=='string'||!place)return null;
  return {place,...(operation.kind==='place'&&typeof operation.at==='string'?{at:operation.at}:{}),
   ...(operation.kind==='place'&&typeof operation.relation==='string'?{relation:operation.relation}:{})};
 };
 let position=current?structuredClone(current):null;
 for(const operation of preceding)position=advance(position,operation);
 return operations.map(operation=>{
  const after=advance(position,operation);
  const line={...operation,execution_position:{before:position,after,conditional_on_earlier_approval:true}};
  position=after;return line;
 });
}
export const CONSENT_ORDER_CONTEXT=' declaration_segments are exact punctuation-delimited spans in original source order. Read their temporal relations against the proposed operation. Their positions alone grant no consent or timing; a later segment may qualify an earlier one. For this line use its execution_position.before: canonical start advanced through earlier proposed movements, conditional on their independent approval. execution_position.after is only the proposed result of this line, never settled state or permission. A move itself reaches after; later activities do not constrain an earlier arrival.';
