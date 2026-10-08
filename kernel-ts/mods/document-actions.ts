/** Canonical physical paper operations; semantic feasibility remains the Keeper's. */
import {RpcError} from '../errors.js';
import {rootObjectOwner} from '../read/object-owner.js';
import {npcNode,npcsPresent} from '../read/capsule.js';
import {array,normalize,number,row,string,values,type Row} from '../read/values.js';
import type {ApplyContext} from '../apply/index.js';
import type {DomainEvent} from '../transactions.js';
import {observeWriting,changedWriting} from './document-visibility.js';
import {pendingDocumentEdit,directlyCarriedNames} from './document-requests.js';
import {documentVersion,writeDocument} from './documents.js';
import {writingDigest} from '../../runtime/jev/document-completion.ts';

export const PHYSICAL_DOCUMENT_ACTIONS=['open','close','show','observe','requested_edit','cancel_edit'];

function surface(world:Row,item:Row):Row{
    if(!world.document_surfaces)world.document_surfaces={};
    const surfaces=row(world.document_surfaces);return surfaces[item.id]??=( {open:false,shown_to:[],marks:[]} );
}

export async function physicalDocumentAction(context:ApplyContext,item:Row,effect:Row):Promise<{receipt:Row;event:DomainEvent}>{
    const {world,graph,campaign,turn}=context,operation=row(effect.document),action=operation.action;
    if(!item.document)throw new RpcError('needs','Initialize the physical document before using its reading surface');
    if(!string(effect.why).trim())throw new RpcError('invalid_params','A physical document operation needs its actual causal why');
    const own=surface(world,item),root=rootObjectOwner(world,item),here=npcsPresent(graph,world,graph.scene(world.active_scene));
    let observed:Row|undefined,reader:Row|undefined,writingResult:Row|undefined;
    if(['show','observe'].includes(action)){
        reader=npcNode(graph,world,string(operation.reader));
        if(!graph.isPerson(reader))throw new RpcError('invalid_params','A writing observer must be a person');
        if(action==='show'||operation.access!=='held'){
            const reachable=here.some(node=>graph.handle(node)===graph.handle(reader!))
                &&(root.kind==='investigator'||root.kind==='scene'&&root.id===world.active_scene
                    ||root.kind==='npc'&&here.some(node=>graph.handle(node)===root.id));
            if(!reachable||row(item.owner).kind==='object')throw new RpcError('needs','This document is not physically available to this reader here');
        }
    }
    if(action==='open')own.open=true;
    else if(action==='close'){own.open=false;own.shown_to=[];}
    else if(action==='show'){own.open=true;own.shown_to=[...new Set([...array(own.shown_to),string(reader!.node_id)])];}
    else if(action==='observe'){
        const access=operation.access,id=string(reader!.node_id);
        if(!['held','shown','glimpse'].includes(access))throw new RpcError('invalid_params','Document observation access is held, shown or glimpse');
        if(access==='held'){
            if(root.kind!=='npc'||root.id!==graph.handle(reader!)||row(item.owner).kind!=='npc')throw new RpcError('not_owned','This reader does not directly hold this document');
            own.open=true;
        }else if(!own.open||access==='shown'&&!array(own.shown_to).includes(id))throw new RpcError('needs','The current writing is not open to this reader');
        if(access==='glimpse'&&(typeof operation.quote!=='string'||!operation.quote.length))
            throw new RpcError('invalid_params','A glimpse must select the actual visible passage, not the entire carrier');
        observed=observeWriting(world,item,id,{access,quote:operation.quote,turn:number(turn.turn),worldline:(await campaign.readCampaign()).active_worldline??null});
    }else if(action==='requested_edit'||action==='cancel_edit'){
        const request=await pendingDocumentEdit(campaign,world,item);
        if(!request||!['selected','needs_follow_up'].includes(request.status))throw new RpcError('needs','No selected physical editor request is bound to this carrier');
        if(root.kind!=='investigator'||root.id!==request.actor_id||row(item.owner).kind!=='investigator')
            throw new RpcError('not_owned','Take this carrier into the selected investigator custody before editing it');
        if(action==='cancel_edit')own.cancelled_edit_request=request.id;
        else{
            if(!['erase','cross_out','rewrite'].includes(operation.method)||!['legible','illegible','unknown'].includes(operation.legibility)
                ||typeof operation.marks!=='string'||!operation.marks.trim()||operation.marks.length>2000)
                throw new RpcError('invalid_params','Physical editing needs method, marks and established legibility');
            const implements_=array(operation.implements),party=await campaign.party() as Row[],actor=party.find(value=>value.id===root.id);
            const names=actor?directlyCarriedNames(world,actor):[],available=(name:string)=>names.some(value=>normalize(value)===normalize(name));
            if(!implements_.length||implements_.length>8||implements_.some(value=>typeof value!=='string'||!available(value)))
                throw new RpcError('needs','Name the actual directly available carried implement; suitability is a Keeper judgement',{details:{implements:names}});
            const time=[...array(turn.receipts),...(context.staged?.()??[])].some(receipt=>receipt.kind==='time'&&number(receipt.minutes)>0);
            if(!time)throw new RpcError('needs','Settle the physical editing time before changing the writing');
            const beforeText=string(item.document.text),beforeVersion=await documentVersion(campaign,world,item);
            const change=changedWriting(beforeText,request.text),revision=item.document.revision;
            writeDocument(item,request.text);item.document.player_edited=request.action==='save';item.document.last_edit_request=request.id;own.open=true;
            if(change.before.length)own.marks=[...array(own.marks),{method:operation.method,description:operation.marks,
                legibility:operation.legibility,writing:change.before,revision,turn:number(turn.turn)}];
            writingResult={instance:item.id,root_owner:{kind:root.kind,id:root.id},direct_owner:{kind:item.owner.kind,id:item.owner.id},
                operation:'requested_edit',before_version:beforeVersion,after_version:await documentVersion(campaign,world,item),
                before_digest:writingDigest(beforeText),after_digest:writingDigest(string(item.document.text)),changed:beforeText!==item.document.text,
                request:{id:request.id,turn:request.turn,worldline:request.worldline,actor:request.actor_id,instance:request.instance,content_digest:writingDigest(request.text)}};
        }
    }else throw new RpcError('invalid_params','Unknown physical document operation');
    const name=item.name,id=context.mint(`definition:document-${context.callId}`);
    return {receipt:{id,kind:'definition',name,document_operation:action,document_changed:action==='requested_edit',
        ...(reader?{reader:graph.displayName(reader)}:{}),...(observed?{observed_writing:observed.writing,observed_revision:observed.revision,observation_scope:observed.scope}:{}),
        ...(writingResult?{writing_result:writingResult}:{}),visibility:'keeper',call_id:context.callId},
        event:{type:'resource-changed',data:{resource:action==='observe'?'document_observation':'document',item:name,operation:action,
            ...(reader?{reader:graph.displayName(reader)}:{}),...(observed?{writing:observed.writing,revision:observed.revision,scope:observed.scope}:{})}}};
}

export function writingSurface(world:Row,item:Row,before:string,why:string):void{
    const own=surface(world,item),change=changedWriting(before,string(item.document.text));own.open=true;
    if(change.before.length)own.marks=[...array(own.marks),{method:'rewrite',description:why,legibility:'unknown',writing:change.before,revision:item.document.revision-1}];
}
