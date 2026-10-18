/** Bounded host-issued choices inside the native RunDriver, never a second gameplay loop. */
import {scenePopulationRequired} from '../scene-population.ts';
import {createHash,randomUUID} from 'node:crypto';
import {buildCandidates,keeperCall} from './candidates.ts';
import type {Candidate} from './step-policy.ts';
import type {DecisionBatch,DecisionResult,Json,OperationProposal,ReadSet} from './contracts.ts';
import {probabilityMassValid} from './contracts.ts';
import type {DecisionPort} from './decision-port.ts';
import {JEV_MODEL,JEV_LONG_CONTEXT_LIMIT,packDecisionBatch,PackingError} from './question-packing.ts';
import {TaskLease} from './task-context.ts';
import {continuousConsentQuestions,continuousConsentDisposition,continuousConsentLine} from './continuous-consent.ts';
import type {HostOperationContext,OperationIdentity} from '../../extensions/kernel/canonical-operation-dispatcher.ts';

type Row=Record<string,any>;
const object=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const array=(value:unknown):any[]=>Array.isArray(value)?value:[];
const text=(value:unknown):string=>typeof value==='string'?value:'';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const CONTINUOUS_TURN_FAMILY='continuous-turn';
export const CONTINUOUS_TURN_GATE=.9;
/** Routing only: all world mutations still require the unchanged selection/restriction gates. */
export const ROUTINE_ADDITIONAL_WORK_MAX=.4;
const MAX_CANDIDATES=24,DECISION_MS=4000;

export interface ContinuousTurnOptions {
    run:string;inputRevision:string;playerText:string;campaign:string;
    session:HostOperationContext['session'];
    decision:DecisionPort;
    call:(method:string,params:Row)=>Promise<Row>;
    dispatch:(proposal:OperationProposal,context:HostOperationContext)=>Promise<any>;
    current:()=>boolean;
    record:(row:Row)=>void;
    packet?:boolean;
    previousPublic?:Array<{turn:number|string;player?:string|null;keeper:string;truncated?:boolean}>;
    investigators?:string[];
}

export class ContinuousTurn {
    prepared=false;
    decided=false;
    executed=false;
    batch?:DecisionBatch;
    batches:DecisionBatch[]=[];
    candidates:Candidate[]=[];
    selected:Candidate[]=[];
    snapshot:Row={};
    outcome?:Row;
    replyScope?:string;
    additionalWork?:number;
    prescreen?:Row;
    published=false;
    private reusable:number[]=[];
    private readonly identities=new Map<string,OperationIdentity>();
    private readonly options:ContinuousTurnOptions;
    constructor(options:ContinuousTurnOptions){this.options=options;}

    private readSet(capsule:Row):ReadSet {
        const context=object(capsule._context),revision=text(context.task_world_revision)||text(context.world_revision);
        if(!revision||context.campaign!==this.options.campaign||!Number.isSafeInteger(context.turn))throw Error('continuous_scope_unavailable');
        const reads:ReadSet=[{kind:'world',resource:this.options.campaign,revision},
            {kind:'draft',resource:'input:'+this.options.run,revision:this.options.inputRevision},
            {kind:'family',resource:CONTINUOUS_TURN_FAMILY,revision:this.options.packet?'packet-3':'2'}];
        if(this.options.packet){
            const source=text(context.task_source_revision)||text(context.source_revision);
            if(!source)throw Error('continuous_source_scope_unavailable');
            reads.push({kind:'source',resource:this.options.campaign,revision:source});
        }
        return reads;
    }

    async prepare(signal:AbortSignal):Promise<void>{
        this.prepared=true;
        try{
            const capsule=await this.options.call('table.capsule',{_context_read:true});
            if(signal.aborted||!this.options.current())throw Error('continuous_input_cancelled');
            this.readSet(capsule);
            this.snapshot=capsule;
            if(object(capsule._context).turn===0){this.decided=true;return;}
            const applyOptions=await this.options.call('table.apply.options',{});
            if(signal.aborted||!this.options.current())throw Error('continuous_input_cancelled');
            // The existing candidate builder owns identities, availability and satisfied rule gates.
            // Open parameters and new NPC choices stay with the same Keeper.
            const issued=buildCandidates({capsule,applyOptions,resolveOptions:{}},this.options.playerText);
            this.candidates=issued
                .filter(candidate=>candidate.verb==='apply'&&(this.options.packet?candidate.family==='move':['move','clue','handout'].includes(candidate.family))
                    &&candidate.unbound.every(parameter=>!parameter.required
                        ||parameter.vocabulary==='closed'&&!parameter.binder&&!parameter.band&&!!parameter.options?.length))
                .slice(0,MAX_CANDIDATES);
            this.reusable=this.candidates.map((_,index)=>index);
            if(!this.candidates.length){this.decided=true;this.options.record({lane:'continuous-turn',event:'no_bound_candidates',run:this.options.run,packet:this.options.packet===true,
                deferred:issued.filter(candidate=>candidate.family==='move').map(candidate=>({key:candidate.key,parameters:candidate.unbound}))});return;}
            const context=object(capsule._context),scope={owner:'continuous-turn:'+this.options.run,campaign:this.options.campaign,
                ...(typeof context.worldline==='string'?{worldline:context.worldline}:{}),
                ...(Number.isSafeInteger(context.loop)?{loop:context.loop}:{}),audience:'keeper' as const};
            if(this.options.packet){
                const lines=this.candidates.map(candidate=>{
                    const detail=object(candidate.detail),destination=object(detail.destination);
                    return continuousConsentLine({...object(array(keeperCall(candidate).args.effects)[0]),
                        registered_destination:{...destination,canonical_name:object(object(object(candidate.basis).row).description).display_name??candidate.bound.to,
                            aliases:array(destination.names).filter(value=>typeof value==='string'),
                            ...(text(detail.source_context)&&detail.source_context!==destination.summary?{source_context:detail.source_context}:{})}});
                });
                const batch:DecisionBatch={id:randomUUID(),model:JEV_MODEL,family:CONTINUOUS_TURN_FAMILY,familyVersion:'packet-3',scope,
                    readSet:this.readSet(capsule),state:{current_player_words:this.options.playerText,
                        investigators:this.options.investigators??[],scene:object(capsule.where).scene??null,
                        previous_public:this.options.previousPublic??[],proposal:{tool:'apply',lines}},
                    questions:[...continuousConsentQuestions(lines.map(()=> 'move')),{key:'additional_work',target:'current_player_words',type:'noul',
                        instructions:'Does the current declaration select an activity besides one routine party journey? Judge selected additional work only, not destination selection, authorization or success. Arrival and ordinary route description belong to that journey. Speech, a greeting, a question, investigation, a transaction, a local task or another trip are additional work. A future or conditional proposal that needs discussion also has additional work. Constraints excluding entry, purchases or other acts do not themselves request additional activities.',
                        criteria:{true:'Something besides the one routine journey needs to be handled, including any speech or NPC decision.',
                            false:'Only that journey is requested, with nothing else to decide or respond to.'}}]};
                // One request or no automatic authority: never fan out a large scene into a foreground cascade.
                try{packDecisionBatch(batch);}catch(error){
                    if(!(error instanceof PackingError)||error.failure!=='packing_limit')throw error;
                    batch.longContext=true;packDecisionBatch(batch);
                }
                this.batches=[batch];this.batch=batch;
                this.options.record({lane:'continuous-turn',event:'prepared',run:this.options.run,packet:true,candidates:lines.length,
                    input_chars:this.options.playerText.length,investigators:this.options.investigators?.length??0,
                    public_context:(this.options.previousPublic??[]).map(row=>({turn:row.turn,player_chars:row.player?.length??0,keeper_chars:row.keeper.length,digest:hash(row),truncated:row.truncated===true})),
                    described_destinations:lines.filter(line=>text(object(line.registered_destination).summary)||text(line.registered_destination.source_context)).length,
                    batches:[{candidates:lines.length,estimate:packDecisionBatch(batch).estimate}]});
                return;
            }
            const questions:DecisionBatch['questions']=[];
            const candidates=this.candidates.map((candidate,index)=>{
                questions.push({key:'need_'+index,target:'whether to execute candidate '+index+' now',type:'choice',
                    instructions:'Judge this one proposed operation against player_words and current_context. Choose now only when the player actually selected it or an already established result entails it, and no unresolved check, NPC decision or source fact is needed first. A question, future plan, quotation, negation, pause or interest alone does not authorize a move, acquisition or disclosure. An available option is not a player choice. Unknown is valid.',
                    criteria:{now:'This operation is selected and ready now.',later:'This operation is not selected now.',unknown:'Its authority or a necessary result is not established.'}});
                for(const [slot,parameter] of candidate.unbound.entries())if(parameter.required&&parameter.vocabulary==='closed'){
                    questions.push({key:'slot_'+index+'_'+slot,target:'value of '+parameter.name+' for candidate '+index,type:'choice',
                        instructions:(parameter.instruction||'Select only the value actually supported for this proposed operation.')+' Unknown is valid. Do not invent a value.',
                        criteria:{...Object.fromEntries((parameter.options??[]).map(value=>[value,parameter.descriptions?.[value]??value])),unknown:'No supported value is established.'}});
                }
                return {index,name:candidate.label,operation:keeperCall(candidate).args,
                    ...(candidate.detail?{conditions:candidate.detail}:{}),...(candidate.routeFact?{condition:candidate.routeFact}: {})};
            });
            const base={id:randomUUID(),model:JEV_MODEL,family:CONTINUOUS_TURN_FAMILY,familyVersion:'2',scope,
                readSet:this.readSet(capsule),state:{player_words:this.options.playerText,
                    current_context:{scene:object(capsule.where).scene,party:capsule.party??[],known:capsule.known??{}},candidates},questions};
            const make=(indexes:number[]):DecisionBatch=>({...base,id:randomUUID(),state:{...base.state,candidates:indexes.map(index=>candidates[index])},
                questions:questions.filter(question=>indexes.some(index=>question.key==='need_'+index||question.key.startsWith('slot_'+index+'_')))});
            const flush=(indexes:number[])=>{if(indexes.length)this.batches.push(make(indexes));};
            let group:number[]=[];
            for(let index=0;index<candidates.length;index++){
                try{packDecisionBatch(make([...group,index]));group.push(index);}
                catch(error){if(!(error instanceof PackingError)||error.failure!=='packing_limit')throw error;
                    flush(group);group=[];
                    try{packDecisionBatch(make([index]));group=[index];}
                    catch(single){if(!(single instanceof PackingError)||single.failure!=='packing_limit')throw single;
                        this.options.record({lane:'continuous-turn',event:'candidate_deferred',run:this.options.run,candidate:this.candidates[index].key,
                            reason:single.failure,estimate:single.estimate});}
                }
            }
            flush(group);this.batch=this.batches[0];
            if(!this.batch)this.decided=true;
            this.options.record({lane:'continuous-turn',event:'prepared',run:this.options.run,candidates:candidates.length,
                batches:this.batches.map(batch=>({candidates:array(object(batch.state).candidates).length,estimate:packDecisionBatch(batch).estimate}))});
        }catch(error){
            this.decided=true;
            this.options.record({lane:'continuous-turn',event:'preparation_unavailable',run:this.options.run,reason:String(error)});
        }
    }

    async decide(signal:AbortSignal):Promise<DecisionResult|undefined>{
        this.decided=true;
        const batch=this.batch;
        if(!batch||!this.options.current()||signal.aborted)return;
        const lease=new TaskLease({owner:CONTINUOUS_TURN_FAMILY,goal:'Select already supported ordinary operations',scope:batch.scope,
            capabilities:['decision'],readSet:batch.readSet,signal,budget:{deadlineAt:Date.now()+DECISION_MS,
                remainingInputTokens:batch.longContext?JEV_LONG_CONTEXT_LIMIT:64000,remainingOutputTokens:4000,remainingCostUsd:.02,remainingActions:this.batches.length}});
        try{
            const outcomes=await Promise.allSettled(this.batches.map(batch=>this.options.decision.decide(batch,lease)));
            const answers:DecisionResult['answers']={};
            for(const [index,outcome]of outcomes.entries()){
                if(outcome.status==='rejected'){this.options.record({lane:'continuous-turn',event:'decision_unavailable',run:this.options.run,reason:String(outcome.reason)});continue;}
                const result=outcome.value,issued=this.batches[index];
                if(result.status==='complete'&&result.batchId===issued.id)for(const question of issued.questions)if(result.answers[question.key])answers[question.key]=result.answers[question.key];
                this.options.record({lane:'continuous-turn',event:'decision',run:this.options.run,family:issued.family,model:issued.model,
                    status:result.status,answers:result.answers,usage:result.usage,ms:result.elapsedMs});
            }
            const result=outcomes.find(outcome=>outcome.status==='fulfilled');
            const current=this.options.current()&&!signal.aborted;
            const admitted=(key:string)=>{
                const answer=answers[key];
                return answer?.status==='answered'&&answer.type==='choice'&&Number.isFinite(answer.confidence)
                    &&answer.confidence!>=CONTINUOUS_TURN_GATE&&answer.confidence!<=1&&answer.choice!=='unknown'
                    &&answer.probabilities&&probabilityMassValid(Object.values(answer.probabilities))
                    &&answer.probabilities[answer.choice]>=CONTINUOUS_TURN_GATE?answer.choice:undefined;
            };
            if(current){
                if(this.options.packet){
                    const probability=(key:string)=>{const answer=answers[key],value=answer?.status==='answered'&&answer.type==='noul'?answer.noul:undefined;
                        return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1?value:undefined;};
                    const choices=this.candidates.map((candidate,index)=>({effects:keeperCall(candidate).args.effects,
                        selection:probability('consent_'+index),veto:probability('restriction_'+index)}));
                    this.prescreen={run:this.options.run,playerText:this.options.playerText,worldRevision:object(this.snapshot._context).world_revision,
                        taskRevision:object(this.snapshot._context).task_world_revision,
                        sourceRevision:object(this.snapshot._context).task_source_revision??object(this.snapshot._context).source_revision,choices};
                    this.additionalWork=probability('additional_work');
                    this.replyScope=typeof this.additionalWork==='number'&&this.additionalWork<=ROUTINE_ADDITIONAL_WORK_MAX?'travel_only':'remaining_work';
                    this.reusable=choices.flatMap((choice,index)=>continuousConsentDisposition(choice.selection,choice.veto)==='not_authorized'?[]:[index]);
                    this.selected=this.candidates.filter((_,index)=>continuousConsentDisposition(choices[index].selection,choices[index].veto)==='authorized');
                    if(this.selected.length!==1)this.selected=[];
                    this.options.record({lane:'continuous-turn',event:'selection',run:this.options.run,packet:true,scope:this.replyScope??'unclear',additional_work:this.additionalWork??null,
                        selected:this.selected.map(candidate=>candidate.key),decisions:choices.map((choice,index)=>({candidate:this.candidates[index].key,
                            status:continuousConsentDisposition(choice.selection,choice.veto),selection:choice.selection??null,veto:choice.veto??null}))});
                    return result?.status==='fulfilled'?result.value:undefined;
                }
                this.reusable=this.candidates.flatMap((_,index)=>admitted('need_'+index)==='later'?[]:[index]);
                this.selected=this.candidates.flatMap((candidate,index)=>{
                    if(admitted('need_'+index)!=='now')return [];
                    const extra:Row={};
                    for(const [slot,parameter] of candidate.unbound.entries())if(parameter.required){
                        const value=admitted('slot_'+index+'_'+slot);
                        if(!value||!parameter.options?.includes(value))return [];
                        extra[parameter.name]=value;
                    }
                    return [{...candidate,bound:{...candidate.bound,...extra}}];
                });
                // Conflicting destinations are a genuine open choice, never several silent moves.
                const allMovesDecided=this.candidates.every((candidate,index)=>candidate.family!=='move'||['now','later'].includes(admitted('need_'+index)??''));
                if(!allMovesDecided)this.selected=this.selected.filter(candidate=>candidate.family!=='move');
                if(this.selected.filter(candidate=>candidate.family==='move').length>1)this.selected=[];
            }
            this.options.record({lane:'continuous-turn',event:'selection',run:this.options.run,selected:this.selected.map(candidate=>candidate.key)});
            return result?.status==='fulfilled'?result.value:undefined;
        }catch(error){this.options.record({lane:'continuous-turn',event:'decision_unavailable',run:this.options.run,reason:String(error)});}
        finally{lease.close();}
    }

    get routineReady():boolean{return this.options.packet===true&&this.executed&&this.replyScope==='travel_only'&&this.outcome?.status==='succeeded';}

    /** Already paid-for option reads remain advisory material when automatic execution is uncertain. */
    materials(capsule:Row):Row|undefined{
        if(!this.decided||!this.reusable.length||!this.options.current())return;
        const prepared=object(this.snapshot._context),fresh=object(capsule._context),source=text(prepared.task_source_revision)||text(prepared.source_revision);
        if(!source||source!==(text(fresh.task_source_revision)||text(fresh.source_revision))
            ||['campaign','worldline','loop','turn'].some(key=>prepared[key]!==fresh[key])
            ||hash(this.readSet(this.snapshot))!==hash(this.readSet(capsule)))return;
        const candidates:Row[]=[],coverage={complete:0,partial:0,omitted:0};
        const packet={authority:'Current host-issued option material, not authorization or a disclosure grant. Reuse these facts before looking them up again.',candidates,coverage};
        const fits=(row:Row)=>Buffer.byteLength(JSON.stringify({...packet,candidates:[...candidates,row]}),'utf8')<=24*1024-128;
        for(const index of this.reusable){const candidate=this.candidates[index],meta={name:candidate.label,operation:keeperCall(candidate).args,parameters:candidate.unbound};
            const complete={...meta,...(candidate.detail?{conditions:candidate.detail}:{}),...(candidate.routeFact?{condition:candidate.routeFact}:{})};
            if(fits(complete)){candidates.push(complete);coverage.complete++;continue;}
            const partial={...meta,material_coverage:'Source conditions omitted for bounded context; read the named target if those conditions are needed.'};
            if(fits(partial)){candidates.push(partial);coverage.partial++;}else coverage.omitted++;
        }
        return packet;
    }

    async execute(signal:AbortSignal,step:string):Promise<Row>{
        this.executed=true;
        if(!this.batch||!this.selected.length||!this.options.current()||signal.aborted)return {status:'refused'};
        const batch=this.batch,context=object(this.snapshot._context);
        const lease=new TaskLease({owner:CONTINUOUS_TURN_FAMILY,goal:'Execute selected ordinary operations once',scope:batch.scope,
            capabilities:['apply'],readSet:batch.readSet,signal,budget:{deadlineAt:Date.now()+15000,
                remainingInputTokens:200000,remainingOutputTokens:20000,remainingCostUsd:.05,remainingActions:8}});
        const selected=[...this.selected.filter(candidate=>candidate.family!=='move'),...this.selected.filter(candidate=>candidate.family==='move')];
        const effects=selected.flatMap(candidate=>keeperCall(candidate).args.effects as Json[]);
        const proposal:OperationProposal={id:randomUUID(),taskId:lease.context.id,operation:'apply',args:{effects},capability:'apply',
            scope:batch.scope,readSet:batch.readSet,basis:[]};
        const validate=async()=>{
            if(!this.options.current()||signal.aborted)throw Error('continuous_input_cancelled');
            const latest=await this.options.call('table.capsule',{_revision_only:true}),actual=object(latest._context);
            if(hash(this.readSet(latest))!==hash(batch.readSet)
                ||['worldline','loop','turn'].some(key=>actual[key]!==context[key]))throw Error('continuous_state_changed');
        };
        try{
            this.outcome=await this.options.dispatch(proposal,{task:lease,session:this.options.session,
                journal:{load:async id=>this.identities.get(id),save:async identity=>{this.identities.set(identity.operationId,structuredClone(identity));}},
                validateCurrent:validate,recover:async()=>{throw Error('Inspect current receipts before recovering an uncertain operation');},
                trace:event=>this.options.record({lane:'continuous-turn',run:this.options.run,...event}),
                origin:{origin:'policy',run:this.options.run,step,clerk:'continuous_turn',
                    basis:{family:CONTINUOUS_TURN_FAMILY,playerText:this.options.playerText,worldRevision:context.world_revision,effects}}});
        }catch(error){this.outcome={status:'refused',reason:String(error)};}
        finally{lease.close();}
        if(this.options.packet&&this.outcome?.status==='succeeded'){
            const current=await this.options.call('table.capsule',{_context_read:true});
            if(scenePopulationRequired(current)){this.replyScope='remaining_work';this.options.record({lane:'continuous-turn',event:'scene_population_required',run:this.options.run,reason:object(object(current.where).temporal).review_reasons??['population_unassessed']});}
        }
        this.options.record({lane:'continuous-turn',event:'execution',run:this.options.run,status:this.outcome?.status,
            ...(this.outcome?.status!=='succeeded'?{failure:this.outcome}:{}),
            selected:selected.map(candidate=>candidate.key)});
        return this.outcome??{status:'refused'};
    }
}
