/** Bounded original-page units from the accepted navigation index, never semantic classifications. */
import {array,number,string,type Row} from '../read/values.js';
export const BACKGROUND_SOURCE_PAGES=6;
export type SourceUnit={section:string;first:number;last:number};
export const sourceUnitKey=(unit:SourceUnit):string=>JSON.stringify([unit.section,unit.first,unit.last]);
export function backgroundSourceUnits(sections:Row[],pageCount:number):SourceUnit[]{
 const pages=new Map<number,{section:string;width:number}>(),unreadable=new Set<number>();
 for(const section of sections){
  if(!string(section.name).trim())continue;
  for(const range of array(section.pages)){
   if(!Array.isArray(range)||range.length!==2)continue;
   const first=number(range[0])+1,last=number(range[1])+1;
   if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<1||last<first||last>pageCount)continue;
   for(let page=first;page<=last;page++){
    if(section.state==='unreadable'){unreadable.add(page);continue;}
    if(!pages.has(page)||pages.get(page)!.width>last-first+1)pages.set(page,{section:section.name,width:last-first+1});
   }
  }
 }
 const units:SourceUnit[]=[];
 for(const [page,entry] of [...pages].sort(([a],[b])=>a-b)){
  if(unreadable.has(page))continue;
  const last=units.at(-1);
  if(last&&last.section===entry.section&&page===last.last+1&&page-last.first<BACKGROUND_SOURCE_PAGES)last.last=page;
  else units.push({section:entry.section,first:page,last:page});
 }
 return units;
}
export const sourceUnitPages=(unit:SourceUnit):number[]=>Array.from({length:unit.last-unit.first+1},(_,i)=>unit.first+i);
