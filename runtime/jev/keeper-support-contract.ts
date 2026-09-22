/** Fixed host-built support contracts. Semantic aliases never grant execution authority. */
import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {isDeepStrictEqual} from 'node:util';
import {ContractError,isPlainRecord} from './value-contracts.ts';

const word=()=>Type.String({minLength:1});
const choices=<T extends string>(values:readonly T[])=>Type.Unsafe<T>(Type.Union(values.map(value=>Type.Literal(value))));
const record=()=>Type.Record(Type.String(),Type.Unknown());
export const SupportRequestSchema=Type.Object({schema_version:Type.Literal(1),
    purpose:choices(['preload','lookup','classify'] as const),query:word()},{additionalProperties:false});
export type SupportRequest=Static<typeof SupportRequestSchema>;
export function supportRequest(query:string,purpose:SupportRequest['purpose']='preload'):SupportRequest {
    const value={schema_version:1,purpose,query};
    if(!Check(SupportRequestSchema,value)||!query.trim())throw new ContractError('invalid_support_request');
    return value;
}
export function validateSupportRequest(value:unknown):SupportRequest {
    if(!Check(SupportRequestSchema,value)||!value.query.trim())throw new ContractError('invalid_support_request');
    return structuredClone(value);
}

export const SUPPORT_SECTIONS=['scene','people','objects','rules','history','source'] as const;
const MaterialSchema=Type.Object({alias:word(),kind:word(),label:word(),authority:word(),content:Type.Unknown(),coverage:record(),
    read:Type.Optional(record()),provenance:Type.Optional(record())},{additionalProperties:false});
const GapSchema=Type.Object({alias:word(),kind:word(),label:word(),reason:word(),read:Type.Optional(record()),
    coverage:Type.Optional(record()),provenance:Type.Optional(record())},{additionalProperties:false});
const ActionSchema=Type.Object({actor:word(),intent:choices(['investigate','social','move'] as const),goal:word(),method:word(),skill:word(),
    decision:Type.Literal('core-check:ordinary-check'),modifiers:Type.Object({difficulty:choices(['regular','hard','extreme'] as const),
        bonus_dice:Type.Integer({minimum:0,maximum:2}),penalty_dice:Type.Integer({minimum:0,maximum:2}),reason:word()},{additionalProperties:false})},{additionalProperties:false});
export const CheckAdviceSchema=Type.Object({kind:Type.Literal('check_preflight'),
    disposition:choices(['ordinary','no_roll','incumbent','needs_player','unknown'] as const),action:Type.Optional(ActionSchema),
    unresolved:Type.Array(Type.String()),authorization:Type.Literal('advisory_only'),settled:Type.Literal(false),
    basis:Type.Optional(Type.Array(Type.Object({role:choices(['player','keeper'] as const),text:Type.String()},{additionalProperties:false})))},
    {additionalProperties:false});
const AssessmentSchema=Type.Object({coverage:choices(['sufficient','missing','uncertain'] as const),
    consistency:choices(['clear','conflict','uncertain'] as const)},{additionalProperties:false});
const RetrievalSchema=Type.Object({version:Type.Literal(1),status:choices(['ready','partial'] as const),stop_reason:word(),
    steps:Type.Integer({minimum:0}),rounds:Type.Integer({minimum:0})},{additionalProperties:false});
export const KeeperSupportSchema=Type.Object({schema_version:Type.Literal(1),kind:Type.Literal('keeper_support'),
    turn:Type.Integer({minimum:0}),request:word(),authority:Type.Literal('advisory'),complete:Type.Literal(false),
    parameters:Type.Object(Object.fromEntries(SUPPORT_SECTIONS.map(section=>[section,Type.Array(word())])),{additionalProperties:false}),
    materials:Type.Array(MaterialSchema),assessment:AssessmentSchema,gaps:Type.Array(GapSchema),
    retrieval:Type.Union([RetrievalSchema,Type.Null()]),check:CheckAdviceSchema,coverage:record(),note:Type.String()},
    {additionalProperties:false});
export type KeeperSupport=Static<typeof KeeperSupportSchema>;
type Row=Record<string,any>;
const object=(value:unknown):Row=>isPlainRecord(value)?value:{};
export const unknownCheck=(reason:string):Static<typeof CheckAdviceSchema>=>({kind:'check_preflight',disposition:'unknown',
    unresolved:[reason],authorization:'advisory_only',settled:false});

/** Section assignment reads only closed owner type fields, never names or prose. */
function sectionOf(material:Row):typeof SUPPORT_SECTIONS[number] {
    if(['rule','rule_clause','catalog','catalog_record'].includes(material.kind))return'rules';
    if(['memory','committed_record'].includes(material.kind))return'history';
    if(['npc','investigator'].includes(material.kind))return'people';
    if(material.kind==='object')return'objects';
    if(material.kind==='session')return'scene';
    if(material.kind==='graph_entity'){
        let body=material.content;if(typeof body==='string')try{body=JSON.parse(body);}catch{return'source';}
        const kind=object(object(body).entity).kind;
        if(kind==='scene')return'scene';
        if(['npc','investigator','investigator-template'].includes(kind))return'people';
        if(['object','item','handout','asset'].includes(kind))return'objects';
    }
    return'source';
}

/** Build before every budget trial so required schema fields are never appended after packing. */
export function keeperSupportView(value:Row):KeeperSupport {
    const materials=Array.isArray(value.materials)?value.materials:[],parameters=Object.fromEntries(SUPPORT_SECTIONS.map(section=>[section,[] as string[]]));
    for(const material of materials)parameters[sectionOf(material)].push(material.alias);
    const assessment=object(value.assessment),retrieval=object(value.retrieval);
    return {schema_version:1,kind:'keeper_support',turn:value.turn,request:value.request,authority:'advisory',complete:false,parameters,
        materials,gaps:Array.isArray(value.gaps)?value.gaps:[],assessment:{coverage:assessment.coverage??'uncertain',consistency:assessment.consistency??'uncertain'},
        retrieval:value.retrieval?{version:1,status:retrieval.status,stop_reason:retrieval.stop_reason,steps:retrieval.steps,rounds:retrieval.rounds??0}:null,
        check:value.check??unknownCheck('not_prepared'),coverage:value.coverage??{},
        note:'Keeper support v1. parameters indexes material aliases; empty means not supplied. Read content, authority and gaps together. Check advice is not consent or a roll. Use ordinary lookup/recall for missing evidence and guarded resolve/apply for actions.'} as KeeperSupport;
}

export function validateKeeperSupport(value:unknown):KeeperSupport {
    if(!Check(KeeperSupportSchema,value))throw new ContractError('invalid_keeper_support');
    try{if(!isDeepStrictEqual(value,JSON.parse(JSON.stringify(value))))throw new Error('not_json');}
    catch{throw new ContractError('invalid_keeper_support_json');}
    const aliases=new Set(value.materials.map(material=>material.alias));
    if(aliases.size!==value.materials.length)throw new ContractError('duplicate_support_alias');
    const listed=SUPPORT_SECTIONS.flatMap(section=>value.parameters[section]);
    if(listed.length!==aliases.size||new Set(listed).size!==listed.length||listed.some(alias=>!aliases.has(alias)))
        throw new ContractError('invalid_support_parameters');
    if((value.check.disposition==='ordinary')!==Boolean(value.check.action))throw new ContractError('invalid_check_advice');
    return structuredClone(value);
}
