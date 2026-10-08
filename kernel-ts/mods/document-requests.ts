/** An editor draft is a selected physical goal, not an immediate writing mutation. */
import {randomUUID} from 'node:crypto';
import {RpcError} from '../errors.js';
import type {CampaignWritePort} from '../transactions.js';
import {array,chars,length,normalize,row,string,values,type Row} from '../read/values.js';
import {nowIso} from '../write/store.js';
import {documentVersion} from './documents.js';
import {changedWriting} from './document-visibility.js';
import {documentEditInput} from '../../runtime/document-edit-input.ts';
export {documentEditInput};

export const DOCUMENT_REQUESTS='document-requests.json';
type RequestReader=Pick<CampaignWritePort,'id'|'readCampaign'|'readSave'>;
export async function documentRequests(campaign:Pick<CampaignWritePort,'readSave'>):Promise<Row>{
    return row(await campaign.readSave(DOCUMENT_REQUESTS)??{entries:{}});
}

export async function documentRequestState(campaign:RequestReader,world:Row,item:Row,request:Row):Promise<string>{
    if(row(item.document).last_edit_request===request.id)return 'applied';
    if(row(row(world.document_surfaces)[item.id]).cancelled_edit_request===request.id)return 'refused';
    if(request.worldline!==((await campaign.readCampaign()).active_worldline??null)
        ||request.version!==await documentVersion(campaign,world,item))return 'stale';
    return string(request.status||'queued');
}

export async function requestDocumentEdit(campaign:CampaignWritePort,world:Row,item:Row,actor:Row,params:Row):Promise<Row>{
    if(Object.keys(params).some(key=>!['campaign','actor','name','version','action','text'].includes(key)))
        throw new RpcError('invalid_params','Unknown document edit request field');
    const version=await documentVersion(campaign,world,item),action=params.action;
    if(params.version!==version)throw new RpcError('revision_conflict','The writing or its custody changed; retain the draft and reload');
    if(!['save','reset'].includes(action)||action==='reset'&&Object.hasOwn(params,'text'))
        throw new RpcError('invalid_params','A physical document request is save with text or reset without client text');
    const text=action==='reset'?item.document.original:params.text;
    if(typeof text!=='string'||length(text)>64000)throw new RpcError('invalid_params','Requested writing must be bounded plain text');
    if(text===item.document.text)return {status:'unchanged',queued_action:false};
    const ledger=await documentRequests(campaign),entries=row(ledger.entries),prior=entries[item.id];
    if(prior){const state=await documentRequestState(campaign,world,item,prior);
        if(['queued','selected','needs_follow_up'].includes(state)){
            if(prior.text===text&&prior.version===version){
                if(state==='needs_follow_up'){prior.status='queued';delete prior.submitted_at;await campaign.writeSave(DOCUMENT_REQUESTS,ledger);}
                return {status:prior.status,queued_action:true,send:prior.status==='queued'&&!prior.submitted_at,
                    request:prior.id,name:item.name,actor:actor.name};
            }
            throw new RpcError('needs','This carrier already has an unfinished physical edit; finish or withdraw it before selecting different writing',
                {details:{reason:'document_edit_pending'}});
        }
    }
    const request={id:randomUUID(),actor_id:actor.id,actor:actor.name,instance:item.id,name:item.name,version,text,action,
        worldline:(await campaign.readCampaign()).active_worldline??null,status:'queued',requested_at:nowIso()};
    entries[item.id]=request;ledger.entries=entries;await campaign.writeSave(DOCUMENT_REQUESTS,ledger);
    return {status:'queued',queued_action:true,send:true,request:request.id,name:item.name,actor:actor.name};
}

/** The host acknowledges the existing player queue; it cannot claim physical settlement. */
export async function acknowledgeDocumentDispatch(campaign:CampaignWritePort,world:Row,item:Row,params:Row):Promise<void>{
    if(typeof params.request!=='string'||typeof params.accepted!=='boolean')throw new RpcError('invalid_params','Document dispatch needs its issued request and queue acceptance');
    const ledger=await documentRequests(campaign),request=row(ledger.entries)[item.id];
    if(!request||request.id!==params.request)throw new RpcError('revision_conflict','This dispatch does not belong to the current document request');
    if(await documentRequestState(campaign,world,item,request)!=='queued')return;
    if(params.accepted)request.submitted_at=nowIso();
    else{request.status='needs_follow_up';delete request.submitted_at;}
    await campaign.writeSave(DOCUMENT_REQUESTS,ledger);
}

/** Bind only an issued closed control request; paper contents never issue a control request. */
export async function selectDocumentRequest(campaign:CampaignWritePort,world:Row,text:string,turn:number):Promise<void>{
    const input=documentEditInput(text);if(!input)return;
    const ledger=await documentRequests(campaign),entries=row(ledger.entries),items=row(row(world.objects).instances);
    const request=Object.values(entries).map(row).find(value=>value.actor===input.actor&&value.name===input.document);
    const item=request?items[request.instance]:null;
    if(!request||!item||!['queued','selected','needs_follow_up'].includes(await documentRequestState(campaign,world,item,request)))
        throw new RpcError('needs','The selected physical document edit is unavailable; retain the draft and reload',
            {details:{reason:'document_edit_unavailable'}});
    request.status='selected';request.turn=turn;await campaign.writeSave(DOCUMENT_REQUESTS,ledger);
}

export async function pendingDocumentEdit(campaign:CampaignWritePort,world:Row,item:Row):Promise<Row|null>{
    const request=row((await documentRequests(campaign)).entries)[item.id];if(!request)return null;
    const status=await documentRequestState(campaign,world,item,request);
    return ['queued','selected','needs_follow_up'].includes(status)?{...request,status}:null;
}

export function directlyCarriedNames(world:Row,actor:Row):string[]{
    const instances=row(row(world.objects).instances),names=array(actor.equipment).flatMap(value=>{
        const name=typeof value==='string'?value:row(value).name,managed=instances[row(value).object_id];
        return typeof name==='string'&&name&&(!row(value).object_id||managed&&row(managed.owner).kind==='investigator'
            &&row(managed.owner).id===actor.id)?[name]:[];
    });
    names.push(...values(instances).filter(item=>row(item.owner).kind==='investigator'&&row(item.owner).id===actor.id).map(item=>string(item.name)));
    return names.filter((name,index)=>names.findIndex(other=>normalize(other)===normalize(name))===index);
}

export async function requestedEditContext(campaign:RequestReader,world:Row,party:Row[]):Promise<Row|null>{
    const ledger=await documentRequests(campaign),items=row(row(world.objects).instances);
    for(const request of Object.values(row(ledger.entries)).map(row)){
        const item=items[request.instance];if(!item||!party.some(actor=>actor.id===request.actor_id))continue;
        const status=await documentRequestState(campaign,world,item,request);
        if(!['selected','needs_follow_up'].includes(status))continue;
        const change=changedWriting(string(item.document.text),request.text);
        const implements_=directlyCarriedNames(world,party.find(actor=>actor.id===request.actor_id)!);
        return {actor:request.actor,document:item.name,status,operation:request.action,implements:implements_.slice(0,16),
            ...(implements_.length>16?{implements_omitted:implements_.length-16}:{}),
            current_revision:item.document.revision,remove:chars(change.before,500),add:chars(change.after,500),
            removed_chars:length(change.before),added_chars:length(change.after),
            instruction:'A selected physical edit. Judge actual means, consequential method choice, elapsed time and witnesses. Use document requested_edit with an exact available implement name and physical marks; the kernel copies the retained player body exactly. Never retype it through write/append, claim an unperformed edit, or give NPCs unseen words. Frame the method in fiction, never mention editor controls or request status. Cancel with cancel_edit only when the goal is withdrawn or refused.'};
    }
    return null;
}

/** A delivered question or interruption does not turn an unperformed request into saved writing. */
export async function finishDocumentRequestTurn(campaign:CampaignWritePort,turn:number):Promise<void>{
    const world=await campaign.readWorld();
    const ledger=await documentRequests(campaign),items=row(row(world.objects).instances);let changed=false;
    for(const request of Object.values(row(ledger.entries)).map(row))if(request.status==='selected'&&request.turn===turn){
        const item=items[request.instance],status=item?await documentRequestState(campaign,world,item,request):'stale';
        request.status=status==='selected'?'needs_follow_up':status;changed=true;
    }
    if(changed)await campaign.writeSave(DOCUMENT_REQUESTS,ledger);
}
