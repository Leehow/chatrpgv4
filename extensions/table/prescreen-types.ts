/** Small request-local material shapes. Owners keep I/O, authority and lifecycle. */
import {createHash} from 'node:crypto';
import {object,sizeOf,type Row} from './context-policy.ts';
import {presentMemoryEvidence} from '../../runtime/jev/memory-read-owner.ts';

export type PrescreenCandidate={key:string;kind:string;label:string;summary:string;authority:string;
    coverage:Row;body?:string;data?:unknown;method?:string;params?:Row;read?:Row;refs?:unknown[];locator?:string};
export type PrescreenGap={alias:string;kind:string;label:string;reason:string;read?:Row;coverage?:Row;provenance?:Row};
export type SuppliedContext={digest:string;bytes:number;keys:Set<string>;locators:Set<string>;contentDigests:Map<string,string>;materialDigests:Set<string>};

export const digest=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parse=(value:unknown):Row=>{try{return object(JSON.parse(String(value)));}catch{return {};}};

/** Inspect only messages that will actually be sent in the baseline request. */
export function suppliedContext(messages:readonly Row[]):SuppliedContext {
    const keys=new Set<string>(),locators=new Set<string>(),contentDigests=new Map<string,string>(),materialDigests=new Set<string>();let inspected=0;
    const inspect=(value:unknown,depth=0):void=>{if(depth>8||inspected++>=4096||value===undefined)return;
        if(typeof value==='string'){if(value)materialDigests.add(digest(value));try{inspect(JSON.parse(value),depth+1);}catch{/* Ordinary prose is already indexed verbatim. */}return;}
        if(!value||typeof value!=='object')return;materialDigests.add(digest(value));for(const child of Array.isArray(value)?value:Object.values(value as Row))inspect(child,depth+1);};
    for(const message of messages){
        inspect(message.content);
        if(message.customType==='coc-workspace')for(const ref of Array.isArray(parse(message.content).evidence)?parse(message.content).evidence:[]){
            const row=object(ref);if(typeof row.locator==='string'&&typeof row.body==='string'&&row.body){locators.add(row.locator);
                contentDigests.set(`locator:${row.locator}`,digest([row.body,row.coverage??null]));}
        }
        if(message.customType==='coc-prescreen')for(const item of Array.isArray(parse(message.content).materials)?parse(message.content).materials:[]){
            const row=object(item);if(typeof row.key==='string'){keys.add(row.key);contentDigests.set(`key:${row.key}`,digest([row.content??null,row.coverage??null]));}
            const locator=object(row.provenance).locator;if(typeof locator==='string'){locators.add(locator);contentDigests.set(`locator:${locator}`,digest([row.content??null,row.coverage??null]));}
        }
    }
    return {digest:digest(messages),bytes:sizeOf(messages),keys,locators,contentDigests,materialDigests};
}
/** `exclude` names custom message types already carried elsewhere in the same decision state (never sent twice). */
export function suppliedPreview(messages:readonly Row[],limit=8192,exclude:readonly string[]=[]):Row {
    const rows:Row[]=[];let used=0,omitted=0,excluded=0;
    for(const message of [...messages].reverse()){
        if(typeof message.customType==='string'&&exclude.includes(message.customType)){excluded++;continue;}
        const raw=typeof message.content==='string'?message.content:JSON.stringify(message.content??null),remaining=Math.max(0,limit-used);
        if(!remaining){omitted++;continue;}
        const parsed=parse(message.content),evidence=message.customType==='coc-workspace'&&Array.isArray(parsed.evidence)?parsed.evidence:
            message.customType==='coc-prescreen'&&Array.isArray(parsed.materials)?parsed.materials:[];
        const coveragePartial=evidence.some(value=>{const coverage=object(object(value).coverage);return coverage.status!==undefined&&coverage.status!=='complete';});
        const content=Array.from(raw).slice(0,Math.min(2048,remaining)).join(''),row={role:String(message.role??'unknown'),
            ...(typeof message.customType==='string'?{custom_type:message.customType}:{}),content,
            ...(content.length<raw.length||coveragePartial?{partial:true}:{})};
        const bytes=sizeOf(row);if(bytes>remaining){omitted++;continue;}rows.push(row);used+=bytes;
    }
    return {messages:rows.reverse(),omitted,complete:omitted===0&&rows.every(row=>row.partial!==true),
        ...(excluded?{carried_elsewhere:[...exclude]}:{})};
}

export function candidateOf(value:unknown,index:number):PrescreenCandidate|undefined {
    const row=object(value),key=typeof row.key==='string'&&row.key?row.key:typeof row.locator==='string'&&row.locator?row.locator:`candidate:${index}`;
    if(typeof row.kind!=='string'||typeof row.label!=='string'||!row.label||typeof row.authority!=='string')return undefined;
    const params=object(row.params),method=typeof row.method==='string'?row.method:undefined;
    return {key,kind:row.kind,label:row.label,summary:typeof row.summary==='string'?row.summary:'',authority:row.authority,
        coverage:typeof row.coverage==='string'?{status:row.coverage}:object(row.coverage),
        ...(typeof row.body==='string'?{body:row.body}:{}),...(row.data!==undefined?{data:structuredClone(row.data)}:{}),
        ...(method?{method,params}:{}),...(row.read&&typeof row.read==='object'?{read:structuredClone(row.read)}:{}),
        ...(Array.isArray(row.refs)?{refs:structuredClone(row.refs)}:{}),...(typeof row.locator==='string'?{locator:row.locator}:{})};
}

/** Model-visible material. Private keys, executable descriptors and exact refs remain in details. */
export function publicCoverage(candidate:Pick<PrescreenCandidate,'coverage'|'read'>):Row {
    const {dependencies,required_context,...coverage}=structuredClone(candidate.coverage);
    if((Array.isArray(dependencies)&&dependencies.length)||(Array.isArray(required_context)&&required_context.length)){
        const read=object(candidate.read);
        coverage.required_context=read.tool==='lookup'&&read.kind==='module'&&typeof read.query==='string'
            ?[{entity:read.query}]:[{status:'owner_context_required'}];
    }
    return coverage;
}

export function publicMaterial(candidate:PrescreenCandidate,alias:string):Row {
    const data=object(candidate.data),nativeConsultation=candidate.authority==='native_consultation',qualifiedQuestion=data.qualified_question??data.question,
        publicExcerpts=(Array.isArray(data.excerpts)?data.excerpts:[]).map(value=>{const row=object(value);return {page:row.page,text:row.text};}),
        provenance=candidate.locator?{locator:candidate.locator}
        :nativeConsultation?{kind:'native_consultation',question:qualifiedQuestion??null,
            pages:[...new Set((Array.isArray(data.excerpts)?data.excerpts:[]).map(value=>object(value).page).filter(Number.isSafeInteger))]}
        :Number.isSafeInteger(data.page)?{kind:'native_page',page:data.page,...(typeof data.pdf_label==='string'?{label:data.pdf_label}:{})}
        :typeof data.question==='string'?{kind:'checked_source_answer',question:data.question,
            ...(typeof data.focus==='string'?{focus:data.focus}:{}),...(typeof data.limitations==='string'&&data.limitations?{limitations:data.limitations}:{})}:undefined;
    const content=candidate.kind==='memory'?presentMemoryEvidence(candidate.body??candidate.data):nativeConsultation?{
        status:typeof data.status==='string'?data.status:'answered',question:qualifiedQuestion??null,supported:data.supported===true,prepared:false,
        excerpts:publicExcerpts,
        source_refs:structuredClone(Array.isArray(data.source_refs)?data.source_refs:[]),limitations:structuredClone(candidate.coverage.limitations??[]),
    }:candidate.body??candidate.data;
    return {alias,kind:candidate.kind,label:candidate.label,authority:candidate.authority,
        content,coverage:publicCoverage(candidate),
        ...(candidate.read?{read:structuredClone(candidate.read)}:{}),
        ...(provenance?{provenance}:{})};
}
