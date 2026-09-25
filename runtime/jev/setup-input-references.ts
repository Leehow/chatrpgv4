/** Exact setup selections over actual user text fields. No semantic parsing or transcript search. */
import {createHash} from 'node:crypto';
import {ContractError,isPlainRecord,type ScopeBinding,type SourceRef} from './value-contracts.ts';
import {issueSourceRef,resolveSourceRef,type SourceSnapshot} from './source-ref.ts';
export const SETUP_INPUT_PROTOCOL='setup-input-reference-v1';
export const SETUP_INPUT_LIMITS={fields:32,text:8192,units:2048} as const;
export type SetupInputField='profile.name'|'pending_action';
export interface SetupUserField {occurrence:string;field:number;text:string}
export interface SetupInputSelection {source:string;range?:{first:string;last:string}}
export interface SetupInputSnapshot {
    version:1;protocol:typeof SETUP_INPUT_PROTOCOL;epoch:string;generation:number;branch:string;
    fields:Array<SetupUserField&{ordinal:number;alias:string}>;
    coverage:{complete:boolean;omitted:number;unavailable:boolean};revision:string;
}
export type SetupInputBinding={authority:'player_input';ref:SourceRef}|{authority:'generated'};
export interface SetupInputEnvelope {version:1;protocol:typeof SETUP_INPUT_PROTOCOL;epoch:string;scope:ScopeBinding;snapshot:SetupInputSnapshot;bindings:Partial<Record<SetupInputField,SetupInputBinding>>}
function fail(code:string):never {throw new ContractError(code);}
const closed=(v:unknown,keys:readonly string[],required=keys):v is Record<string,any>=>isPlainRecord(v)&&Object.keys(v).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(v,key));
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):isPlainRecord(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,canonical(v[key])])):v;
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const nonempty=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const scopeFor=(campaign:string):ScopeBinding=>({owner:'setup-input',campaign,audience:'player'});
const body=(snapshot:SetupInputSnapshot)=>({version:snapshot.version,protocol:snapshot.protocol,epoch:snapshot.epoch,generation:snapshot.generation,branch:snapshot.branch,fields:snapshot.fields,coverage:snapshot.coverage});
function units(text:string,alias:string):Array<{alias:string;text:string;start:number;end:number}> {
    const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
    return [...segmenter.segment(text)].map((value,index)=>({alias:`${alias}/u:${index}`,text:value.segment,start:value.index,end:value.index+value.segment.length}));
}
/** The SDK's pending current user message has one text field and is appended after before_agent_start. */
export function setupUserTextFields(branch:readonly unknown[],current?:{occurrence:string;text:string}):SetupUserField[] {
    const fields:SetupUserField[]=[];
    branch.forEach((value,index)=>{
        if(!isPlainRecord(value)||value.type!=='message'||!isPlainRecord(value.message)||value.message.role!=='user') return;
        const occurrence=`branch:${index}:${typeof value.id==='string'?value.id:'entry'}`,content=value.message.content;
        if(typeof content==='string') fields.push({occurrence,field:0,text:content});
        else if(Array.isArray(content)) content.forEach((part,field)=>{if(isPlainRecord(part)&&part.type==='text'&&typeof part.text==='string')fields.push({occurrence,field,text:part.text});});
    });
    if(current&&typeof current.text==='string') fields.push({occurrence:current.occurrence,field:0,text:current.text});
    return fields;
}
function checkSnapshot(value:unknown):asserts value is SetupInputSnapshot {
    if(!closed(value,['version','protocol','epoch','generation','branch','fields','coverage','revision'])||value.version!==1||value.protocol!==SETUP_INPUT_PROTOCOL
        ||!nonempty(value.epoch)||!nonempty(value.branch)||!Number.isSafeInteger(value.generation)||value.generation<1||!Array.isArray(value.fields)||value.fields.length>SETUP_INPUT_LIMITS.fields
        ||!closed(value.coverage,['complete','omitted','unavailable'])||typeof value.coverage.complete!=='boolean'||typeof value.coverage.unavailable!=='boolean'
        ||!Number.isSafeInteger(value.coverage.omitted)||value.coverage.omitted<0||value.coverage.complete!==(value.coverage.omitted===0&&!value.coverage.unavailable)) fail('invalid_setup_input_snapshot');
    let textCount=0,unitCount=0;const aliases=new Set(),occurrences=new Set();
    for(const field of value.fields) {
        if(!closed(field,['occurrence','field','text','ordinal','alias'])||!nonempty(field.occurrence)||typeof field.text!=='string'||!Number.isSafeInteger(field.field)||field.field<0
            ||!Number.isSafeInteger(field.ordinal)||field.ordinal<0||field.alias!==`input:${value.generation}:${field.ordinal}`||aliases.has(field.alias)
            ||occurrences.has(JSON.stringify([field.occurrence,field.field]))) fail('invalid_setup_input_field');
        aliases.add(field.alias);occurrences.add(JSON.stringify([field.occurrence,field.field]));textCount+=field.text.length;if(textCount>SETUP_INPUT_LIMITS.text)fail('invalid_setup_input_revision');unitCount+=units(field.text,field.alias).length;
    }
    if(textCount>SETUP_INPUT_LIMITS.text||unitCount>SETUP_INPUT_LIMITS.units||value.revision!==digest(body(value as unknown as SetupInputSnapshot))) fail('invalid_setup_input_revision');
}
export interface SetupInputCatalog {
    snapshot:SetupInputSnapshot;
    public:{protocol:typeof SETUP_INPUT_PROTOCOL;sources:Array<{alias:string;text:string;units:Array<{alias:string;text:string}>}>;coverage:SetupInputSnapshot['coverage']};
}
export function buildSetupInputCatalog(input:{epoch:string;generation:number;branch:string;fields:readonly SetupUserField[];unavailable?:boolean}):SetupInputCatalog {
    const selected:SetupInputSnapshot['fields']=[];let textCount=0,unitCount=0,omitted=0;
    // Keep recent complete fields; never turn an omitted prefix into a falsely complete source.
    for(let ordinal=input.fields.length-1;ordinal>=0;ordinal--) {
        const field=input.fields[ordinal],alias=`input:${input.generation}:${ordinal}`;
        if(selected.length>=SETUP_INPUT_LIMITS.fields||textCount+field.text.length>SETUP_INPUT_LIMITS.text){omitted++;continue;}
        const count=units(field.text,alias).length;if(unitCount+count>SETUP_INPUT_LIMITS.units){omitted++;continue;}
        selected.push({...field,ordinal,alias});textCount+=field.text.length;unitCount+=count;
    }
    selected.reverse();
    const snapshot:SetupInputSnapshot={version:1,protocol:SETUP_INPUT_PROTOCOL,epoch:input.epoch,generation:input.generation,branch:input.branch,fields:selected,
        coverage:{complete:omitted===0&&!input.unavailable,omitted,unavailable:input.unavailable===true},revision:''};
    snapshot.revision=digest(body(snapshot));checkSnapshot(snapshot);
    return {snapshot:structuredClone(snapshot),public:{protocol:SETUP_INPUT_PROTOCOL,sources:selected.map(field=>({alias:field.alias,text:field.text,
        units:units(field.text,field.alias).map(({alias,text})=>({alias,text}))})),coverage:{...snapshot.coverage}}};
}
function sourceSnapshot(snapshot:SetupInputSnapshot,field:SetupInputSnapshot['fields'][number],scope:ScopeBinding):SourceSnapshot {
    return {scope,resource:`setup-input:${snapshot.epoch}:${field.ordinal}`,revision:snapshot.revision,sourceType:'draft',text:field.text};
}
/** §98 addendum (SL-66): a category check, never a character list -- Unicode general category P* (every kind of
 * punctuation, ASCII or full-width) and Z* (every kind of separator/space) cover it without enumerating glyphs. */
const isPunctuationOrSpace=(text:string):boolean=>[...text].every(ch=>/^[\p{P}\p{Z}]$/u.test(ch));
/** Trim a resolved [start,end) grapheme range to its word boundary: drop leading and trailing units that are
 * wholly punctuation or whitespace. A range that is nothing but punctuation/whitespace is left alone; the
 * caller's `empty_setup_input_selection` check still catches a selection with no word content at all. */
function trimToWordBoundary(units:Array<{alias:string;text:string;start:number;end:number}>,start:number,end:number):{start:number;end:number} {
    const within=units.filter(unit=>unit.start>=start&&unit.end<=end);
    let lo=0,hi=within.length-1;
    while(lo<=hi&&isPunctuationOrSpace(within[lo].text)) lo++;
    while(hi>=lo&&isPunctuationOrSpace(within[hi].text)) hi--;
    return lo>hi?{start,end}:{start:within[lo].start,end:within[hi].end};
}
function selected(snapshot:SetupInputSnapshot,selection:unknown,scope:ScopeBinding,options:{trimToWord?:boolean}={}):{value:string;ref:SourceRef} {
    if(!closed(selection,['source','range'],['source'])||typeof selection.source!=='string') fail('setup_input_requires_source_selection');
    const field=snapshot.fields.find(field=>field.alias===selection.source);if(!field) fail('unknown_or_stale_setup_input_source');
    let start=0,end=field.text.length;
    if(selection.range!==undefined) {
        if(!closed(selection.range,['first','last'])||typeof selection.range.first!=='string'||typeof selection.range.last!=='string')fail('invalid_setup_input_range');
        const issued=units(field.text,field.alias),first=issued.find(unit=>unit.alias===selection.range.first),last=issued.find(unit=>unit.alias===selection.range.last);
        if(!first||!last||first.start>last.start) fail('foreign_or_reversed_setup_input_range');start=first.start;end=last.end;
        // §98 addendum (SL-66): a range selected out of the player's own sentence stops at the word -- the trimmed
        // boundary, not the sentence's own, is what the ref records, so the stamped card and every later reference
        // to it never carry the sentence's punctuation. A whole-field selection (no range: the copied-string path)
        // is untouched -- it is not cut from a sentence and its exact bytes, including any leading/trailing
        // whitespace the player typed, are the contract.
        if(options.trimToWord) ({start,end}=trimToWordBoundary(issued,start,end));
    }
    const source=sourceSnapshot(snapshot,field,scope),ref=issueSourceRef(source,{kind:'utf16',start,end});
    const value=resolveSourceRef(ref,{scope,mode:'active',read:()=>source,currentRevision:()=>source.revision});
    if(!nonempty(value)) fail('empty_setup_input_selection');return {value,ref};
}
/** Target-mode values are selections, or generated names. Copied strings never fall back to legacy. */
export function materializeSetupInputs(catalog:SetupInputCatalog,input:{campaign:string;inputKey:string;values:Partial<Record<SetupInputField,unknown>>}):{values:Partial<Record<SetupInputField,string>>;envelope:SetupInputEnvelope} {
    checkSnapshot(catalog.snapshot);if(!nonempty(input.campaign)||catalog.snapshot.epoch!==input.inputKey) fail('stale_setup_input_epoch');
    const scope=scopeFor(input.campaign),values:Partial<Record<SetupInputField,string>>={},bindings:SetupInputEnvelope['bindings']={};
    for(const [field,value] of Object.entries(input.values)) {
        if(!['profile.name','pending_action'].includes(field)) fail('unknown_setup_input_binding');
        const key=field as SetupInputField;
        if(closed(value,['generated'])) {
            if(key!=='profile.name'||!nonempty(value.generated))fail('invalid_generated_setup_name');
            values[key]=value.generated;bindings[key]={authority:'generated'};
        } else {const resolved=selected(catalog.snapshot,value,scope,{trimToWord:key==='profile.name'});values[key]=resolved.value;bindings[key]={authority:'player_input',ref:resolved.ref};}
    }
    return {values,envelope:{version:1,protocol:SETUP_INPUT_PROTOCOL,epoch:input.inputKey,scope,snapshot:structuredClone(catalog.snapshot),bindings}};
}
/** Called inside the existing setup lock, before draft/prologue mutation. */
export function validateSetupInputs(value:unknown,input:{campaign:string;inputKey:unknown;values:Partial<Record<SetupInputField,unknown>>}):SetupInputEnvelope {
    if(!closed(value,['version','protocol','epoch','scope','snapshot','bindings'])||value.version!==1||value.protocol!==SETUP_INPUT_PROTOCOL
        ||!nonempty(value.epoch)||value.epoch!==input.inputKey||!closed(value.bindings,['profile.name','pending_action'],[])) fail('invalid_setup_input_envelope');
    checkSnapshot(value.snapshot);
    const scope=scopeFor(input.campaign);
    if(!closed(value.scope,['owner','campaign','audience'])||value.scope.owner!==scope.owner||value.scope.campaign!==scope.campaign||value.scope.audience!==scope.audience||value.snapshot.epoch!==value.epoch) fail('foreign_or_stale_setup_input_scope');
    if(Object.keys(value.bindings).sort().join('|')!==Object.keys(input.values).sort().join('|')) fail('missing_setup_input_binding');
    for(const [field,materialized] of Object.entries(input.values)) {
        if(!nonempty(materialized)) fail('empty_setup_input_selection');
        const binding=value.bindings[field];
        if(closed(binding,['authority'])&&binding.authority==='generated') {if(field!=='profile.name')fail('invalid_generated_setup_name');continue;}
        if(!closed(binding,['authority','ref'])||binding.authority!=='player_input') fail('invalid_setup_input_binding');
        const ref=binding.ref as SourceRef,source=value.snapshot.fields.find(field=>sourceSnapshot(value.snapshot,field,scope).resource===ref?.resource);
        if(!source||ref.sourceType!=='draft'||ref.selector?.kind!=='utf16') fail('unknown_or_stale_setup_input_source');
        const boundaries=new Set([0,source.text.length,...units(source.text,source.alias).flatMap(unit=>[unit.start,unit.end])]);
        if(!boundaries.has(ref.selector.start)||!boundaries.has(ref.selector.end)) fail('split_setup_input_grapheme');
        const snapshot=sourceSnapshot(value.snapshot,source,scope),exact=resolveSourceRef(ref,{scope,mode:'active',read:(resource,revision)=>resource===snapshot.resource&&revision===snapshot.revision?snapshot:undefined,currentRevision:resource=>resource===snapshot.resource?snapshot.revision:undefined});
        if(exact!==materialized) fail('setup_input_materialization_mismatch');
    }
    return structuredClone(value) as SetupInputEnvelope;
}
/** Retained provenance is private and bounded; consumers still read the existing materialized strings. */
export function setupInputProvenance(envelope:SetupInputEnvelope,field:SetupInputField):Record<string,unknown>|undefined {
    const binding=envelope.bindings[field];return binding?{version:1,protocol:SETUP_INPUT_PROTOCOL,epoch:envelope.epoch,scope:structuredClone(envelope.scope),snapshot:structuredClone(envelope.snapshot),binding:structuredClone(binding)}:undefined;
}
