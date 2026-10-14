/** Navigation ranges are structural; only a vision reader classifies their contents. */
import {isJsonObject} from '../json.ts';
/** The existing index publication shape, also checked before a reader's successful submission. */
export function checkIndexDraftShape(draft:any,pageCount?:number):void {
    if(!isJsonObject(draft)||!Array.isArray(draft.sections))throw new Error('index draft needs a sections array');
    for(const [sectionIndex,section] of draft.sections.entries()){
        const path=`index sections[${sectionIndex}]`;
        if(!isJsonObject(section)||typeof section.name!=='string')throw new Error(`${path}.name must be a string`);
        if(!Array.isArray(section.pages)||!section.pages.length)throw new Error(`${path}.pages must be a nonempty nested array of [start,end] physical page pairs`);
        for(const [rangeIndex,pair] of section.pages.entries()){
            const range=`${path}.pages[${rangeIndex}]`;
            if(!Array.isArray(pair)||pair.length!==2||pair.some(value=>typeof value!=='bigint'&&!(typeof value==='number'&&Number.isInteger(value))))
                throw new Error(`${range} must be a two-integer [start,end] pair; pages uses the nested shape [[start,end],...]`);
            const start=Number(pair[0]),end=Number(pair[1]);
            if(!(1<=start&&start<=end)||pageCount!==undefined&&end>pageCount)
                throw new Error(`${range} must satisfy 1 <= start <= end${pageCount===undefined?'':` <= original page_count (${pageCount})`}`);
        }
        if(Object.hasOwn(section,'source_refs')){
            const references=`${path}.source_refs`;
            if(!Array.isArray(section.source_refs))throw new Error(`${references} must be an array of objects with a positive integer page`);
            for(const [referenceIndex,reference] of section.source_refs.entries()){
                const referencePath=`${references}[${referenceIndex}]`;
                if(!isJsonObject(reference))throw new Error(`${referencePath} must be an object with a positive integer page`);
                const page=reference.page;
                if(typeof page!=='bigint'&&!(typeof page==='number'&&Number.isInteger(page)))
                    throw new Error(`${referencePath}.page must be a positive integer physical page`);
                if(!(Number(page)>=1)||pageCount!==undefined&&Number(page)>pageCount)
                    throw new Error(`${referencePath}.page must satisfy 1 <= page${pageCount===undefined?'':` <= original page_count (${pageCount})`}`);
            }
        }
    }
}
export type VisualScan = {first:number; last:number};
export type VisualCandidate = {page:number;kind:'map'|'handout'|'illustration'|'uncertain';label:string};
export const VISUAL_SCAN_PAGES = 20;
export function visualScanRanges(count:number):VisualScan[] {
    if(!Number.isSafeInteger(count)||count<1)return [];
    return Array.from({length:Math.ceil(count/VISUAL_SCAN_PAGES)},(_,i)=>({first:i*VISUAL_SCAN_PAGES+1,last:Math.min(count,(i+1)*VISUAL_SCAN_PAGES)}));
}
export const visualScanKey=(range:VisualScan):string=>`${range.first}-${range.last}`;
export function validVisualScan(value:any,count:number):value is VisualScan {
    return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='first,last'
        &&visualScanRanges(count).some(range=>range.first===value.first&&range.last===value.last);
}
export function requireVisualOverview(range:VisualScan,pages:Iterable<number>):void {
    const delivered=new Set(pages);
    for(let page=range.first;page<=range.last;page++)if(!delivered.has(page))
        throw new Error(`Visual discovery requires a successfully delivered overview of physical page ${page}`);
}
export function visualCandidates(value:unknown,range:VisualScan):VisualCandidate[]{
    if(!Array.isArray(value)||value.length>80)throw new Error('visual_candidates must be a bounded navigation list');
    const seen=new Set<string>();
    return value.map(item=>{
        if(!item||typeof item!=='object'||Object.keys(item).sort().join(',')!=='kind,label,page'
            ||!Number.isSafeInteger(item.page)||item.page<range.first||item.page>range.last
            ||!['map','handout','illustration','uncertain'].includes(item.kind)||typeof item.label!=='string'||!item.label.trim()||item.label.length>200)
            throw new Error('Each visual candidate needs an assigned page, kind and short navigation label');
        const key=`${item.page}:${item.kind}`;
        if(seen.has(key))throw new Error('Duplicate visual page/kind candidate');
        seen.add(key);return {...item,label:item.label.trim()};
    });
}
