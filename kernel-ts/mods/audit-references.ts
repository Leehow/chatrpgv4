/** Pinned audit occurrences. Reviewers select aliases; only the host owns coordinates. */
import {createHash} from 'node:crypto';
import {issueSourceRef, resolveSourceRef, splitSourceText, type SourceSnapshot} from '../../runtime/jev/source-ref.ts';
import {type ScopeBinding, type SourceRef} from '../../runtime/jev/value-contracts.ts';
import {speechPass} from '../write/speech-pass.ts';
import type {AuditIssue} from './audit-result.js';

type Row = Record<string, any>;
const record = (v: any): v is Row => v !== null && typeof v === 'object' && !Array.isArray(v);
const digest = (v: any) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const EVIDENCE_FILES: Record<string,string> = {'context.json':'context', 'memory.json':'memory', 'history.json':'history',
    'current.json':'current', 'world.json':'world', 'effective.json':'source', 'original.json':'original', 'handouts.json':'handout', 'notes.json':'note'};
// These are schema fields, never a semantic classifier. Identity/provenance/paths are not copy sources.
const TEXT_FIELDS = new Set(['name','label','summary','description','statement','subject','text','quote','reason','fix',
    'fact','content','body','title','player_text','rendered_text','current_input','clue','relation','question','definition','rule','promotion_test','handle',
    'entities','knowers','aliases','dramatic_question','how','why','actor_label','condition','status','state','display_name']);
export interface AuditEvidenceBinding {alias: string; file: string; path: string[]; text: string; start: number; end: number}
/** Host-only structural bindings for targeted views; never associate aliases by copied value. */
export function auditEvidenceBindings(files: Row): AuditEvidenceBinding[] {
    const result: AuditEvidenceBinding[] = [];
    for (const [file,prefix] of Object.entries(EVIDENCE_FILES)) {
        let ordinal = 0;
        const visit = (value: any, path: string[], allowed: boolean) => {
            if (typeof value === 'string' && allowed) {
                for (const range of splitSourceText(value, 1000)) {
                    const text = value.slice(range.start,range.end);
                    if (text.trim()) result.push({alias:`${prefix}:${ordinal++}`,file,path:[...path],text,...range});
                }
            } else if (Array.isArray(value)) value.forEach((child,index) => visit(child,[...path,String(index)],allowed));
            else if (record(value)) for (const key of Object.keys(value).sort()) {
                if (['__proto__','prototype','constructor'].includes(key)) continue;
                visit(value[key],[...path,key],TEXT_FIELDS.has(key) || file === 'handouts.json');
            }
        };
        visit(files[file],[],file === 'handouts.json' || Array.isArray(files[file]) && files[file].every((v: any) => typeof v === 'string'));
    }
    return result;
}
export interface AuditReferenceCatalog {
    sources: Row;
    speechTexts: string[];
    resolve(alias: unknown, families: string[]): Row;
}
/** Rebuilt from immutable job input and evidence on accept/replay. No mutable alias registry exists. */
export function buildAuditReferences(request: Row, files: Row, scope: ScopeBinding = {owner:'audit',audience:'keeper'}): AuditReferenceCatalog {
    const pinnedRequest = structuredClone(request), pinnedFiles = structuredClone(files);
    // The catalog is a projection of the originals, never part of its own source revision.
    delete pinnedRequest.continuity_review;
    const snapshots = new Map<string,SourceSnapshot>(), entries = new Map<string,{family:string; refs:Record<string,SourceRef>; metadata:Row}>();
    const sources: Row = {draft:[],current_input:[],speech:[],evidence:[],objects:[],scenes:[],reentry:[]};
    const snapshot = (resource: string, data: Pick<SourceSnapshot,'text'|'record'|'allowedFields'>, sourceType: SourceRef['sourceType'] = 'record') => {
        const value: SourceSnapshot = {scope,resource,revision:digest(data),sourceType,...data}; snapshots.set(resource,value); return value;
    };
    const add = (alias: string, family: string, refs:Record<string,SourceRef>, metadata:Row = {}) => {
        if (entries.has(alias)) throw new Error('Duplicate host audit alias');
        entries.set(alias,{family,refs,metadata});
    };
    const access = {scope,mode:'active' as const,read:(resource:string,revision:string) => {
        const found = snapshots.get(resource); return found?.revision === revision ? found : undefined;
    },currentRevision:(resource:string) => snapshots.get(resource)?.revision};
    const resolve = (alias: unknown, families:string[]): Row => {
        const entry = typeof alias === 'string' ? entries.get(alias) : undefined;
        if (!entry || !families.includes(entry.family)) throw new Error('Select an issued alias from the required source family');
        return {alias,...entry.metadata,...Object.fromEntries(Object.entries(entry.refs).map(([key,ref]) => [key,resolveSourceRef(ref,access)]))};
    };
    for (const [family,key,text] of [['draft','draft',pinnedRequest.input?.text ?? ''],['input','current_input',pinnedFiles['context.json']?.current_input ?? pinnedRequest.player_text ?? '']]) {
        if (typeof text !== 'string') continue;
        const source = snapshot(`audit:${family}`,{text},'draft');
        for (const [index,range] of splitSourceText(text,1000).entries()) {
            if (!text.slice(range.start,range.end).trim()) continue;
            const alias = `${family}:${index}`;
            add(alias,family,{text:issueSourceRef(source,{kind:'utf16',...range})}); sources[key].push(resolve(alias,[family]));
        }
    }
    const speech = speechPass(pinnedRequest.input?.text ?? '',name => ({label:name})).speech;
    const speechSource = snapshot('audit:speech',{record:speech,allowedFields:speech.flatMap((_,i) => [[String(i),'text'],[String(i),'who','label']])});
    speech.forEach((line,i) => {
        const alias = `speech:${i}`;
        add(alias,'speech',{text:issueSourceRef(speechSource,{kind:'field',path:[String(i),'text']}),speaker:issueSourceRef(speechSource,{kind:'field',path:[String(i),'who','label']})});
        sources.speech.push(resolve(alias,['speech']));
    });
    for (const binding of auditEvidenceBindings(pinnedFiles)) {
        let text: any = pinnedFiles[binding.file]; for (const key of binding.path) text = text[key];
        const source = snapshot(`audit:evidence:${binding.file}:${JSON.stringify(binding.path)}`,{text});
        add(binding.alias,'evidence',{text:issueSourceRef(source,{kind:'utf16',start:binding.start,end:binding.end})},{file:binding.file});
        if (sources.evidence.length < 24) sources.evidence.push(resolve(binding.alias,['evidence']));
    }
    const fieldEntry = (alias:string,family:string,destination:string,document:string,original:Row,paths:Record<string,string[]>,metadata:Row={}) => {
        const refs:Record<string,SourceRef> = {};
        for (const [key,path] of Object.entries(paths)) {
            const source = snapshot(`audit:field:${document}:${JSON.stringify(path)}`,{record:original,allowedFields:[path]});
            refs[key]=issueSourceRef(source,{kind:'field',path});
        }
        add(alias,family,refs,metadata); sources[destination].push(resolve(alias,[family]));
    };
    const childEntries = (value:any):Array<[string,any]> => value && typeof value === 'object' ? Object.entries(value) : [];
    let objectOrdinal=0;
    const object = (value:any,path:string[],category?:string) => {
        const name=typeof value === 'string' ? value : value?.name;
        if (typeof name !== 'string') return;
        const paths:Record<string,string[]> = {name:typeof value === 'string' ? path : [...path,'name']};
        const supplied=typeof value?.category === 'string' && ['weapon','spell','item'].includes(value.category);
        if (supplied) paths.category=[...path,'category'];
        fieldEntry(`object:${objectOrdinal++}`,'object','objects','request',pinnedRequest,paths,supplied ? {} : {category:category ?? 'item'});
    };
    for (const [i,value] of childEntries(pinnedRequest.unregistered_equipment)) object(value,['unregistered_equipment',i]);
    for (const kind of ['definitions','instances']) for (const [i,value] of childEntries(pinnedRequest.objects?.[kind])) object(value,['objects',kind,i]);
    for (const [i,person] of childEntries(pinnedRequest.party)) for (const [kind,category] of [['weapons','weapon'],['spells','spell']])
        for (const [j,value] of childEntries(person[kind])) object(value,['party',i,kind,j],category);
    const context = pinnedFiles['context.json'] ?? {};
    const scene = (alias:string,document:string,original:Row,path:string[]) => fieldEntry(alias,'scene','scenes',document,original,{name:path});
    if (typeof context.location_authority?.current_scene === 'string') scene('scene:active','context.json',context,['location_authority','current_scene']);
    else if (typeof context.scene_commitment?.active?.name === 'string') scene('scene:active','context.json',context,['scene_commitment','active','name']);
    else if (typeof context.scene?.name === 'string') scene('scene:active','context.json',context,['scene','name']);
    const movePath=context.scene_commitment?.moves ? ['scene_commitment','moves'] : ['location_authority','move_receipts'];
    for (const [i,move] of childEntries(context[movePath[0]]?.[movePath[1]])) {
        const key=typeof move.to_label === 'string' ? 'to_label' : 'to';
        if (typeof move[key] === 'string') scene(`scene:move:${i}`,'context.json',context,[...movePath,i,key]);
    }
    let sceneOrdinal=0;
    for (const [i,node] of childEntries(pinnedFiles['effective.json']?.graph?.nodes))
        if (node.node_kind === 'scene' && typeof node.name === 'string') scene(`scene:${sceneOrdinal++}`,'effective.json',pinnedFiles['effective.json'],['graph','nodes',i,'name']);
    const reentry=context.causal_reentry ?? {};
    if (typeof reentry.bridge?.clue === 'string' && typeof reentry.bridge?.relation === 'string')
        fieldEntry('bridge','reentry','reentry','context.json',context,{clue:['causal_reentry','bridge','clue'],relation:['causal_reentry','bridge','relation']});
    for (const [i,value] of childEntries(reentry.known)) if (typeof value.name === 'string' && typeof value.relation === 'string')
        fieldEntry(`known:${i}`,'reentry','reentry','context.json',context,{clue:['causal_reentry','known',i,'name'],relation:['causal_reentry','known',i,'relation']});
    return {sources,speechTexts:speech.map(line => line.text),resolve};
}

/** Strict shape translation preserves every adverse semantic row, or rejects the whole artifact. */
export function materializeAuditReferences(value: any, catalog: AuditReferenceCatalog): {value?: Row; errors:AuditIssue[]} {
    const errors: AuditIssue[] = [], add = (path:string,message:string) => errors.push({path,message});
    const shape = (v:any, keys:string[], path:string): v is Row => {
        if (!record(v)) {add(path,'Expected an object'); return false;}
        for (const key of keys) if (!Object.hasOwn(v,key)) add(`${path}/${key}`,'Required selector field is missing');
        for (const key of Object.keys(v)) if (!keys.includes(key)) add(`${path}/${key}`,'Unexpected field; copied v1 fields are not permitted in schema 2');
        return true;
    };
    const select = (alias:any,families:string[],path:string,field='text',nullable=false): any => {
        if (nullable && alias === null) return null;
        try {return catalog.resolve(alias,families)[field];} catch {add(path,'Select an issued alias from the required source family'); return null;}
    };
    const list = (values:any,path:string,fn:(v:any,path:string,i:number)=>any,max=32): any[] => {
        if (!Array.isArray(values)) {add(path,'Expected an array'); return [];}
        if (values.length > max) {add(path,`At most ${max} entries are allowed`); return [];}
        return values.map((v,i) => fn(v,`${path}/${i}`,i));
    };
    const selectedList = (values:any,path:string,families:string[],field='text',max=32) => {
        const seen = new Set();
        return list(values,path,(v,p) => {if (seen.has(v)) add(p,'Duplicate occurrence selection'); seen.add(v); return select(v,families,p,field);},max);
    };
    if (!shape(value,['schema','missing','findings','continuity_review'],'')) return {errors};
    if (value.schema !== 2) add('/schema','Expected schema 2');
    const missingSeen = new Set();
    const output: Row = {missing:list(value.missing,'/missing',(v,p) => {
        if (!shape(v,['subject','category','reason'],p)) return v;
        if (missingSeen.has(v.subject)) add(`${p}/subject`,'Duplicate occurrence selection');
        missingSeen.add(v.subject);
        const selected = select(v.subject,['object'],`${p}/subject`,'name');
        return {name:selected,category:v.category,reason:v.reason};
    },16),findings:value.findings};
    const review = value.continuity_review, path='/continuity_review';
    const optional = ['intelligibility_review','player_address_review','speech_review','outcome_review','location_review','locus_review','reentry_review'];
    if (!shape(review,['verdict','summary','conflicts',...optional.filter(key => Object.hasOwn(review ?? {},key))],path)) return {errors};
    const conflictSeen = new Set();
    const result:Row = {verdict:review.verdict,summary:review.summary,conflicts:list(review.conflicts,`${path}/conflicts`,(v,p) => {
        if (!shape(v,['claim_source','reason','evidence_sources'],p)) return v;
        if (conflictSeen.has(v.claim_source)) add(`${p}/claim_source`,'Duplicate occurrence selection');
        conflictSeen.add(v.claim_source);
        const evidence = selectedList(v.evidence_sources,`${p}/evidence_sources`,['evidence'],'text',3);
        return {claim:select(v.claim_source,['draft'],`${p}/claim_source`),reason:v.reason,evidence:evidence.map((quote,i) => ({quote,file:select(v.evidence_sources[i],['evidence'],`${p}/evidence_sources/${i}`,'file')}))};
    },10)};
    for (const name of ['intelligibility_review','player_address_review']) if (Object.hasOwn(review,name)) {
        const v = review[name], p=`${path}/${name}`;
        if (shape(v,['verdict','source'],p)) result[name]={verdict:v.verdict,quote:select(v.source,['draft'],`${p}/source`,'text',true)};
    }
    if (Object.hasOwn(review,'speech_review')) {
        const v=review.speech_review,p=`${path}/speech_review`;
        if (shape(v,['verdict','lines'],p)) {
            const lines=list(v.lines,`${p}/lines`,(line,at,i) => {
                if (!shape(line,['source','verdict','reason'],at)) return line;
                if (line.source !== `speech:${i}`) add(`${at}/source`,'Speech occurrences must each appear once in original order');
                return {quote:select(line.source,['speech'],`${at}/source`),verdict:line.verdict,reason:line.reason};
            });
            if (lines.length !== catalog.speechTexts.length) add(`${p}/lines`,'Select every issued speech occurrence exactly once');
            result.speech_review={verdict:v.verdict,lines};
        }
    }
    if (Object.hasOwn(review,'outcome_review')) {
        const v=review.outcome_review,p=`${path}/outcome_review`;
        if (shape(v,['verdict','basis','claim_sources'],p)) result.outcome_review={verdict:v.verdict,basis:v.basis,claims:selectedList(v.claim_sources,`${p}/claim_sources`,['draft'],'text',8)};
    }
    if (Object.hasOwn(review,'location_review')) {
        const v=review.location_review,p=`${path}/location_review`;
        if (shape(v,['verdict','basis','current_scene_source','asserted_elsewhere_sources'],p)) result.location_review={verdict:v.verdict,basis:v.basis,
            current_scene:select(v.current_scene_source,['scene'],`${p}/current_scene_source`,'name'),asserted_elsewhere:selectedList(v.asserted_elsewhere_sources,`${p}/asserted_elsewhere_sources`,['draft'],'text',8)};
    }
    if (Object.hasOwn(review,'locus_review')) {
        const v=review.locus_review,p=`${path}/locus_review`;
        if (shape(v,['verdict','mode','basis','locus_source','claim_source'],p)) result.locus_review={verdict:v.verdict,mode:v.mode,basis:v.basis,
            locus:select(v.locus_source,['scene'],`${p}/locus_source`,'name',true),claim:select(v.claim_source,['draft'],`${p}/claim_source`,'text',true)};
    }
    if (Object.hasOwn(review,'reentry_review')) {
        const v=review.reentry_review,p=`${path}/reentry_review`;
        if (v === null) result.reentry_review=null;
        else if (shape(v,['verdict','basis','source','evidence_source'],p)) {
            if (['bridge_receipt','bridge_offer','authority_unavailable'].includes(v.basis) && v.evidence_source !== 'bridge')
                add(`${p}/evidence_source`,'This basis requires the issued bridge selection');
            if (['acquired_clarification','player_discharge'].includes(v.basis) && !(typeof v.evidence_source === 'string' && v.evidence_source.startsWith('known:')))
                add(`${p}/evidence_source`,'This basis requires an issued known evidence selection');
            result.reentry_review={verdict:v.verdict,basis:v.basis,
            quote:select(v.source,[v.basis === 'player_discharge' ? 'input' : 'draft'],`${p}/source`,'text',true),
            clue:select(v.evidence_source,['reentry'],`${p}/evidence_source`,'clue',true),relation:select(v.evidence_source,['reentry'],`${p}/evidence_source`,'relation',true)};
        }
    }
    output.continuity_review=result;
    return errors.length ? {errors} : {value:output,errors};
}

/** Error paths follow the model's selector schema, while semantic validation stays shared. */
export function auditReferenceIssues(errors: readonly AuditIssue[]): AuditIssue[] {
    return errors.map(issue => {
        let path=issue.path;
        path=path.replace(/^\/missing\/(\d+)\/name$/, '/missing/$1/subject')
            .replace(/(\/conflicts\/\d+)\/claim$/, '$1/claim_source')
            .replace(/(\/conflicts\/\d+)\/evidence(?:\/(\d+)(?:\/(?:file|quote))?)?$/, (_all,prefix,index) => `${prefix}/evidence_sources${index === undefined ? '' : `/${index}`}`)
            .replace(/(\/(?:intelligibility_review|player_address_review))\/quote$/, '$1/source')
            .replace(/(\/speech_review\/lines\/\d+)\/quote$/, '$1/source')
            .replace(/(\/outcome_review)\/claims(?=\/|$)/, '$1/claim_sources')
            .replace(/(\/location_review)\/current_scene$/, '$1/current_scene_source')
            .replace(/(\/location_review)\/asserted_elsewhere(?=\/|$)/, '$1/asserted_elsewhere_sources')
            .replace(/(\/locus_review)\/locus$/, '$1/locus_source')
            .replace(/(\/locus_review)\/claim$/, '$1/claim_source')
            .replace(/(\/reentry_review)\/quote$/, '$1/source')
            .replace(/(\/reentry_review)\/(?:clue|relation)$/, '$1/evidence_source');
        const message=issue.message.startsWith('Required object:') ? 'Required selector review object; use the schema 2 fields from the pinned audit instructions'
            : issue.message.startsWith('Copy ') ? `Select an issued alias for ${issue.message.slice(5)}`
            : issue.message.startsWith('Name ') ? `Select an issued alias for ${issue.message.slice(5)}` : issue.message;
        return {...issue,path,message};
    });
}
