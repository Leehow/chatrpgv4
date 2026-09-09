/** Stage and land worldline operations through the existing sidecar history. */
import {join} from 'node:path';
import type {KernelContext} from '../context.js';
import type {CampaignWritePort} from '../transactions.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {RpcError} from '../errors.js';
import {isJsonObject} from '../json.js';
import {array,clone,equal,integer,number,repr,row,sorted,string,truth,type Row} from '../read/values.js';
import {checked} from '../write/history.js';
import {nowIso} from '../write/store.js';
import {activeName,registry,newLine,validateName,loopAnchor,resetPolicy} from './identity.js';
import {currentLine,head,lineCommit,run,checkout,createBranch,deleteBranch,commitIfDirty,type WorldlineContext} from './history.js';
import {readAnchor,anchorTurn,anchorMinutes,buildAnchor,records,rewindsKept,clockMinutes,rebaseSaves,writeReset,type ClockEngine} from './reset.js';
import {readEchoes,writeEchoes,mergeEchoes,generateEchoes} from './echoes.js';
import * as confluence from './confluence.js';
export type {ClockEngine} from './reset.js';
export {lineSeed} from './identity.js';
export function createWorldlineRuntime(kernel:KernelContext,engines:readonly ClockEngine[]=[]){
    const bind=(campaign:CampaignWritePort):WorldlineContext=>({kernel,campaign});
    async function open(campaign:CampaignWritePort,meta:Row):Promise<void>{
        const context=bind(campaign);let changed=false,on=await currentLine(context);
        if(on==null){const sha=await head(context);if(sha&&await lineCommit(context,'main')==null)await createBranch(context,'main',sha);checked(await run(context,['symbolic-ref','HEAD','refs/heads/wl/main']),'symbolic-ref');on='main';}
        let wanted=activeName(meta);
        if(wanted!==on){if(await lineCommit(context,wanted)==null)wanted=on;else{await commitIfDirty(context,`worldline ${on}: sealed before opening ${wanted}`);await checkout(context,wanted);changed=true;}}
        const lines=clone(registry(meta));if(!Object.hasOwn(lines,wanted)){lines[wanted]=newLine(string(meta.id||''),wanted,wanted==='main'?'main':'if',0,null);changed=true;}
        for(const [name,value] of Object.entries(lines)){const status=name===wanted?'active':value.status||'dormant';if(status==='merged'||value.status==='merged')continue;if(value.status!==status){value.status=status;changed=true;}}
        if(meta.active_worldline!==wanted){meta.active_worldline=wanted;changed=true;}
        if(!equal(meta.worldlines,lines)){meta.worldlines=lines;changed=true;}
        if(changed)await campaign.writeCampaign(meta);
    }
    async function forkPlan(context:WorldlineContext,meta:Row,graph:ModuleGraph,world:Row,effect:Row,lines:Row,source:string,turn:number):Promise<Row>{
        const name=validateName(effect.name,'name');
        if(Object.hasOwn(lines,name)||await lineCommit(context,name)!=null)throw new RpcError('invalid_params',`worldline ${repr(name)} already exists`,{fix:'pick a name no line has, or switch to it',details:{lines:sorted(Object.keys(lines))}});
        const mode=effect.mode;
        if(!['if','loop'].includes(mode))throw new RpcError('invalid_params',"fork mode must be one of ['if', 'loop']",{fix:"if branches the line as it stands; loop rewinds to the module's anchor",details:{mode:mode??null}});
        const plan:Row={operation:'fork',line:name,mode,from:{line:source,turn,commit:null},loop:number(row(lines[source]).loop)};
        if(mode==='if'){
            const from=effect.from_turn;if(from!=null){
                if(!integer(from)||number(from)<0)throw new RpcError('invalid_params','from_turn must be a turn number',{details:{from_turn:from}});
                if(number(from)!==turn){const record=await context.campaign.readTurnRecord(number(from));if(!record||!truth(record.commit))throw new RpcError('invalid_params',`turn ${from} has no commit on this line`,{fix:'fork from a turn this line committed, or omit from_turn for this one',details:{from_turn:from,committed_turns:(await records(context)).filter(record=>truth(record.commit)).map(record=>record.turn)}});plan.from={line:source,turn:number(from),commit:string(record.commit)};}
            }return plan;
        }
        const anchor=loopAnchor(graph,graph.scene(world.active_scene));
        if(!anchor)throw new RpcError('invalid_params','this module declares no loop anchor',{fix:'mode: if forks the line as it stands',details:{module:graph.moduleId,relation:'resets-to'}});
        const [relation,node]=anchor,handle=graph.handle(node),stored=await readAnchor(context);
        const at=stored?.scene===handle?{turn:stored.turn,commit:stored.commit}:await anchorTurn(context,meta,handle);
        if(!at)throw new RpcError('invalid_params',`the party has never been in the anchor scene ${repr(handle)}`,{fix:'the loop can only rewind to a scene this line has played',details:{anchor:handle}});
        plan.loop=number(row(lines[source]).loop)+1;plan.anchor={scene:handle,...at};plan.reset=resetPolicy(relation);
        if(rewindsKept(plan.reset))await rebaseSaves(context,engines,await anchorMinutes(context,at)-clockMinutes(world),false);
        return plan;
    }
    async function stage(campaign:CampaignWritePort,graph:ModuleGraph,world:Row,effect:Row,turn:Row,index:number,count:number,mint:(base:string)=>string,callId:string):Promise<{receipt:Row;plan:Row}>{
        const context=bind(campaign),meta=await campaign.readCampaign(),kind=string(effect.kind),turnNumber=number(turn.turn);
        if(truth(turn.worldline))throw new RpcError('invalid_params','a turn carries at most one worldline effect',{fix:'fork or switch once per turn; the line changes after this turn commits',details:{already:row(turn.worldline).operation??null}});
        if(index!==count-1)throw new RpcError('invalid_params','a worldline effect must be the last effect of its batch',{fix:'apply everything the turn changed first, then fork or switch',details:{index,effects:count}});
        const lines=registry(meta),source=activeName(meta),label=typeof effect.label==='string'&&effect.label.trim()?effect.label.trim():null;
        let plan:Row,receipt:Row;
        if(kind==='merge'){plan=await confluence.plan(context,graph,meta,effect,source,turnNumber);plan.label=label;plan.source_turn=turnNumber;receipt=confluence.receiptOf(plan,turnNumber,callId,label,mint);}
        else {
            if(kind==='fork')plan=await forkPlan(context,meta,graph,world,effect,lines,source,turnNumber);
            else{
                const name=validateName(effect.line,'line'),entry=lines[name];
                if(!isJsonObject(entry)||await lineCommit(context,name)==null)throw new RpcError('invalid_params',`no worldline ${repr(name)}`,{fix:'switch to a line this campaign has, or fork one',details:{lines:sorted(Object.keys(lines))}});
                if(entry.status==='merged')throw new RpcError('invalid_params',`worldline ${repr(name)} was merged and cannot be played again`,{details:{line:name,status:'merged'}});
                if(name===source)throw new RpcError('invalid_params',`worldline ${repr(name)} is already the active line`,{details:{line:name}});
                plan={operation:'switch',line:name,mode:null,from:{line:source,turn:null,commit:null},loop:number(entry.loop)};
            }
            plan.label=label;plan.source_turn=turnNumber;if(plan.from.turn==null)plan.from.turn=turnNumber;
            receipt={id:mint(`${kind}:${plan.line}-t${turnNumber}`),kind:'worldline',call_id:callId,operation:kind,line:plan.line,mode:plan.mode??null,loop:plan.loop,from:{line:source,turn:plan.from.turn},label,visibility:'public',at:nowIso()};
        }
        plan.receipt=receipt.id;return {receipt,plan};
    }
    async function transition(campaign:CampaignWritePort,graph:ModuleGraph,plan:Row,turn:number):Promise<Row>{
        const context=bind(campaign);if(plan.operation==='merge')return confluence.perform(context,graph,plan,turn);
        const meta=await campaign.readCampaign(),before=clone(meta),source=string(plan.from.line),target=string(plan.line),lines=clone(registry(meta));
        if(plan.operation==='fork'&&plan.mode==='loop'&&!await readAnchor(context))await campaign.writeSave('worldlines/anchor.json',await buildAnchor(context,string(plan.anchor.scene),plan.anchor,source));
        const seal=await commitIfDirty(context,`worldline ${source}: sealed at turn ${turn}`),base=seal||await head(context);let created=false;
        try{
            if(plan.operation==='fork'){const fork=string(plan.from.commit||base);plan.from.commit=fork;await createBranch(context,target,fork);created=true;}
            await checkout(context,target);
            if(isJsonObject(lines[source])){lines[source].status='dormant';lines[source].last_turn=turn;lines[source].last_commit=base;}
            if(plan.operation==='fork')lines[target]=newLine(campaign.id,target,plan.mode==='loop'?'loop':'if',number(plan.loop),clone(plan.from));
            else if(isJsonObject(lines[target]))lines[target].status='active';
            meta.worldlines=lines;meta.active_worldline=target;await campaign.writeCampaign(meta);
            let message=plan.operation==='fork'?`worldline ${target}: forked from ${source} at turn ${turn}`:`worldline ${target}: resumed from ${source} at turn ${turn}`;
            if(plan.operation==='fork'&&plan.mode==='loop'){
                await writeReset(context,graph,plan,engines);
                await writeEchoes(context,mergeEchoes(await readEchoes(context),await generateEchoes(context,source,number(row(lines[source]).loop))));await campaign.writeCampaign(meta);message=`loop ${plan.loop} reset`;
            }
            const landed=await commitIfDirty(context,message)||await head(context);lines[target].last_commit=landed;
            lines[target].last_turn=await kernel.snapshots.pathExists(join(campaign.directory,'turn.json'))?(await campaign.readTurn()).turn??null:null;await campaign.writeCampaign(meta);
        }catch(error){try{await checkout(context,source,true);if(created)await deleteBranch(context,target);await campaign.writeCampaign(before);}catch{}throw error;}
        return {operation:plan.operation,line:target,from:source,mode:plan.mode??null,loop:number(plan.loop),seal:base,commit:row(lines[target]).last_commit??null};
    }
    return Object.freeze({open,stage,transition});
}
export function eventOf(plan:Row):{type:string;data:Row}{
    return plan.operation==='fork'?{type:'worldline-forked',data:{name:plan.line,mode:plan.mode??null,loop:number(plan.loop),from:clone(plan.from)}}:
        plan.operation==='merge'?{type:'worldline-merged',data:{name:plan.line,lines:array(plan.lines),into:plan.into??null,conflicts:array(row(plan.report).conflicts).length}}:
        {type:'worldline-switched',data:{line:plan.line,from:clone(plan.from)}};
}
