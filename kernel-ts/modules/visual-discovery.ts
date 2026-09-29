/** Navigation ranges are structural; only a vision reader classifies their contents. */
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
