# 评审期间补充核对（未修改生产代码）

原两份资料保持提交时原文。这两点新事实与附加调用端摘录供你自行判断，不要求改变评审重点。

1. 已启动的f741112e0全量回归结束：扩展6402项，6391通过、2失败、9跳过；集成2246通过、路由12通过。仍是apply-recovery-native及scene-population两项人数评估依赖失败，最新fae594d08的38项针对性检查通过不等于最新全量通过。没有再启动下一轮测试或打包。

2. 只读纯函数检查发现：turnPacketParameterSchema在非地点模式下确实带了当前time band covers说明；经locationCommandOwner投影后不再包含该说明；直接以locations=true生成时也没有。原因是该投影用自己的根description覆盖原根description。原先只测非地点schema有说明的回归没有覆盖这条实际组合路径。尚未修复，也没有重新试玩。这是可直接复现的接线问题，不是对其延迟影响的证明。

```text
beforeLocationProjection: true
afterLocationProjection: false
withLocationProvider: false
```

## runtime/turn-packet-prototype.ts

```typescript
export function turnPacketParameterSchema(journeySettled=false,timeBands?:readonly string[],moveChoices?:readonly Record<string,unknown>[],sceneRequired=false,bindings?:DecisionBindings,locations=false,timeBandRows?:readonly {handle:string;covers?:string}[]):TSchema {
    const schema:Record<string,any>=structuredClone(TURN_PACKET_PARAMETERS);
    const meanings=timeBandRows?.filter(row=>timeBands?.includes(row.handle)&&row.covers).map(row=>`${row.handle}: ${row.covers}`);
    if(meanings?.length)schema.description=`Optional independent activity costs use the applicable current rule meaning; a category name alone is not its definition. No separate bookkeeping time is required for every command.\n${meanings.join("\n")}`;
    if(bindings){schema.properties.interactions.items=bindCommunicationParameters(schema.properties.interactions.items,bindings);schema.properties.reveal.items=bindCommunicationParameters(schema.properties.reveal.items,bindings,true);}
    const destinations=[...new Set((moveChoices??[]).filter(row=>row.kind==='move'&&typeof row.to==='string').map(row=>row.to as string))];
    const groups=new Map<string,{destinations:string[];via:boolean;bands?:string[]}>();
    for(const to of destinations){
        const choice=moveChoices!.find(row=>row.kind==='move'&&row.to===to)!;
        const via=choice.requires_via===true,bands=Array.isArray(choice.travel_bands)?choice.travel_bands as string[]:undefined;
        const key=JSON.stringify([via,bands]);let group=groups.get(key);
        if(!group){group={destinations:[],via,...(bands?{bands}:{})};groups.set(key,group);}group.destinations.push(to);
    }
    const issuedMoves:TSchema[]=moveChoices===undefined?[move]:[...groups.values()].map(group=>Type.Object({kind:Type.Literal('move'),to:StringEnum(group.destinations),
        ...(group.via?{via:atom()}:{}),...(group.bands?{travel_band:StringEnum(group.bands)}:{})},{additionalProperties:false}));
    const issuedNpc=Type.Object({...npc.properties,to:StringEnum(turnPacketNpcDestinations(moveChoices))},{additionalProperties:false});
    const boundedTime=timeBands?.length?Type.Object({...time.properties,band:Type.Optional(StringEnum([...timeBands]))},timeOptions):time;
    const assessment={contains:scene,minContains:1};
    const stationary=sceneRequired?assessment:{};
    const local=locations?placeStationary.map(command=>command.properties.action.const==='observe'?Type.Omit(command,['relations'],{additionalProperties:false}):command):[],journey=locations?[placeMove]:[];
    const moving=sceneRequired?assessment:{allOf:[{if:{contains:locations?Type.Object({kind:Type.Literal('place'),action:Type.Literal('move')}):Type.Object({kind:Type.Literal('move')})},then:assessment}]};
    const arrivedLocal=Type.Object({kind:Type.Literal('place'),action:Type.Literal('move'),to:Type.Literal('here'),at:atom(240),
        relation:PlaceEffect.anyOf[0].properties.relation,additions:PlaceEffect.anyOf[0].properties.additions},{additionalProperties:false});
    if(journeySettled)schema.properties.commands=Type.Array(Type.Union([...(locations?[arrivedLocal]:[]),...local,issuedNpc,walkOn,scene,relationship]),{maxItems:12,...stationary});
    else schema.properties.commands=Type.Union([Type.Array(Type.Union([...issuedMoves,...journey,Type.Object({...boundedTime.properties,beyond_travel:Type.Literal(true)},timeOptions),...local,issuedNpc,walkOn,scene,relationship]),{maxItems:12,...moving}),Type.Array(Type.Union([boundedTime,...local,issuedNpc,walkOn,scene,relationship]),{maxItems:12,...stationary})]);
    if(sceneRequired)schema.required=[...new Set([...(schema.required??[]),'commands'])];
    return locations?locationCommandOwner(schema as TSchema):schema as TSchema;
}
/** Install the current execution contract after either supported provider conversion. */
```

## extensions/kernel/admission.ts

```typescript
export async function reviewAdmissionJevOnly(options:PrimaryAdmissionReviewOptions):Promise<
    {ok:true;verdict:AdmissionVerdict;ms:number;meta:Record<string,unknown>}
    |{ok:false;reason:string;ms:number;meta:Record<string,unknown>}> {
    const clock=options.clock??hostClock,began=clock.now(),context=options.context;
    const nativeLocation=options.proposal.operations?.some(operation=>operation.kind==='place');
    const serviceContext=options.proposal.operations?.some(operation=>operation.registered_cash_context||operation.acting_party);
    const family='continuous-action-admission',version=options.proposal.kinds?.includes('time')?'22':serviceContext?(nativeLocation?'20':'18'):nativeLocation?'19':context.currentPosition?'15':context.currentClock?'13':options.proposal.ordered||options.proposal.kinds?.includes('place')?'12':'7';
    let mechanicsChoice:{action:string;choice:{name:string;binds:string;options:string[];prompt?:string}}|undefined;
    let mechanicsInput=false,mechanicsBinding:string|undefined;
    try{
        const input=JSON.parse(context.playerText),choice=input?.choice;
        mechanicsInput=input?.kind==='mechanics_choice';
        if(input?.kind==='mechanics_choice'&&typeof input.action==='string'&&choice&&typeof choice==='object'&&!Array.isArray(choice)
            &&typeof choice.name==='string'&&typeof choice.binds==='string'&&Array.isArray(choice.options)
            &&choice.options.every((option:unknown)=>typeof option==='string')&&choice.options.includes(input.action)){
            mechanicsChoice={action:input.action,choice:{name:choice.name,binds:choice.binds,options:choice.options,
                ...(typeof choice.prompt==='string'?{prompt:choice.prompt}:{})}};
            if(input.action==='accept')mechanicsBinding=choice.binds;
        }
    }catch{/* Ordinary player prose is not the mechanics-choice protocol. */}
    const cashRequirements=(options.proposal.cash?.previews??[]).flatMap((row:any)=>{
        const debit=decimalSpelling(String(-row.delta)),price=decimalSpelling(String(row.purchase_amount));
        if(!Number.isSafeInteger(row.index)||row.index<0||!debit||!price||debit.coefficient<=0n||compareCash(debit,price)<=0)return [];
        const reference=row.quote??row.bill;
        const offers=(options.proposal.cash?.quotes??[]).filter((quote:any)=>{
            const amount=decimalSpelling(String(quote.cash_debit));
            return typeof quote.quote==='string'&&quote.origin_turn<context.turn&&amount&&compareCash(amount,debit)===0
                &&quote.subject===row.subject&&quote.with_id===row.with&&quote.currency===row.currency
                &&(!mechanicsInput||mechanicsBinding!==undefined&&norm(quote.quote)===norm(mechanicsBinding))
                &&(typeof reference!=='string'||norm(quote.quote)===norm(reference));
        }).map((quote:any)=>({quote:quote.quote,cash_debit:cashText(debit),merchandise_amount:quote.purchase_amount}));
        return [{index:row.index,cash_debit:cashText(debit),merchandise_amount:cashText(price),currency:String(row.currency),earlier_full_quotes:offers}];
    });
    // A registered journey may refer to directions an NPC just delivered. Use the same
    // bounded public window as prescreen and the author, never private source notes.
    const knownJourneys=options.proposal.operations?.length&&options.proposal.operations.every(operation=>
        (operation.kind==='move'||operation.kind==='place'&&operation.action==='move')&&operation.registered_destination);
    const typedLines=options.proposal.operations?.map(continuousConsentLine);
    const state={current_player_words:context.playerText,...(nativeLocation?{declaration_segments:declarationSegments(context.playerText)}:{}),...(mechanicsChoice?{current_mechanics_choice:mechanicsChoice}:{}),
        ...(options.lineContexts?{line_contexts:options.lineContexts.map(scope=>({current_player_words:scope.playerText,
            ...(nativeLocation?{declaration_segments:declarationSegments(scope.playerText)}:{}),previous_public:scope.delivered.slice(-2).map(row=>({turn:row.turn,player:row.player??null,...(publicDialogue(row.speech).length?{speech:publicDialogue(row.speech)}:{})}))}))}:{}),
        ...(context.interruptedPlayerText?{unfinished_player_words:context.interruptedPlayerText}:{}),
        investigators:context.investigators.map(row=>row.name),scene:context.scene??null,present:context.present,
        ...(context.currentClock?{current_clock:context.currentClock}:{}),
        ...(context.currentPosition?{current_position:context.currentPosition}:{}),
        previous_public:knownJourneys?decisionRecentPublic(context.delivered):context.delivered.slice(-2).map(row=>({turn:row.turn,player:row.player??null,
            ...(publicDialogue(row.speech).length?{speech:publicDialogue(row.speech)}:{})})),
        settled_this_turn:context.landed,
        ...(context.refused.length?{refused_this_turn:context.refused}:{}),
        ...(context.corrections?.length?{argument_corrections:context.corrections}:{}),
        proposal:{tool:options.proposal.tool,lines:nativeLocation&&typedLines?conditionalExecutionPositions(typedLines,options.proposal.preceding?.operations??[],context.currentPosition):typedLines??options.proposal.lines.map(continuousConsentLine),...(options.proposal.kinds?{kinds:options.proposal.kinds}:{}),
            ...(options.proposal.ordered?{execution:{order:'Earlier operations execute before later lines in this same proposed atomic batch.',
                preceding:(options.proposal.preceding?.operations??[]).map(continuousConsentLine),
                authority:'These are proposed operations, not settled facts. Each needs independent consent and canonical validation. Outside plans supply no prerequisite.'}}:{})},
        ...(cashRequirements.length?{cash_requirements:cashRequirements}:{})};
    const revision=createHash('sha256').update(JSON.stringify(state)).digest('hex');
    const batch:DecisionBatch={id:family+':'+revision,model:ADMISSION_JEV_MODEL,family,familyVersion:version,
        scope:{owner:family,campaign:options.campaign,audience:'player'},
        readSet:[{kind:'draft',resource:'turn:'+context.turn+':consent',revision},{kind:'family',resource:family,revision:version}],
        state:state as DecisionBatch['state'],questions:continuousConsentQuestions(options.proposal.lines.map((_,index)=>options.proposal.kinds?.[index]??''),options.proposal.operations?.map(operation=>typeof operation.action==='string'?operation.action:undefined),options.proposal.operations?.map(operation=>operation.kind!=='time'?undefined:typeof operation.band==='string'?'band':operation.until!==undefined?'until':typeof operation.minutes==='number'?'minutes':undefined))};
    for(const question of batch.questions){
        const index=Number(question.key.slice(question.key.lastIndexOf('_')+1)),operation=options.proposal.operations?.[index];
        if(operation?.registered_cash_context)question.instructions+=` Use this line's registered_cash_context kernel preview and actual delta. ${CASH_CONSENT_POLICY}`;
        if(operation?.acting_party)question.instructions+=' acting_party names the non-investigator actor from this effect\'s closed fields. NPC initiative is not an investigator choice: giving or offering an object does not need a player request. Still require consent for the investigator\'s voluntary payment, promise, accepted bargain or keeping something explicitly refused. The actor label alone grants no such commitment.';
    }
    if(options.proposal.ordered)for(const question of batch.questions){
        if(question.key.startsWith('restriction_'))question.instructions=String(question.instructions)
            +' Evaluate this line at its execution position in proposal.execution: after the listed preceding operations and earlier proposal.lines, conditional on their independent approval and validation. An explicitly selected wait or arrival in that prefix can satisfy its timing or position prerequisite; it need not have settled before this atomic batch is reviewed. Later lines and intentions outside the batch cannot satisfy an earlier prerequisite.';
    }
    for(const question of batch.questions)if(question.key.startsWith('restriction_')){question.instructions=String(question.instructions)
        +' current_clock, when present, is the latest canonical local game time before this proposal, including all successful earlier calls. Use its absolute local time to evaluate a selected future-only condition; elapsed receipt minutes alone do not establish a local time. A clock fact grants no consent or physical service completion.'
        +' Actual canonical outcomes in settled_this_turn can establish a completed prerequisite. Receipt identifiers alone do not establish its content. Payment or elapsed time alone does not establish movement, seating, receipt of goods or an unrecorded activity. Prior public narration resolves references only, never current consent.';
        if(options.proposal.kinds?.[Number(question.key.slice('restriction_'.length))]==='time')question.instructions+=
            ' current_position, when present, is the latest canonical local position before this time proposal. If the player selects moving to a position before waiting there, require that position now or an independently approved earlier move in this atomic batch; eventual return to the current endpoint does not fulfill the intermediate visit. Do not replace a selected approach with a wait at the old position.';
    }
    if(options.lineContexts){
        if(options.lineContexts.length!==options.proposal.lines.length)throw Error('Consent line context count differs from its operations');
        for(const question of batch.questions){
            const index=Number(question.key.slice(question.key.lastIndexOf('_')+1));
            // Only field paths change; the same two questions and thresholds judge each operation.
            question.instructions=String(question.instructions).replaceAll('current_player_words',`line_contexts[${index}].current_player_words`)
                .replaceAll('previous_public',`line_contexts[${index}].previous_public`);
        }
    }
    if(nativeLocation)for(const question of batch.questions)if(question.key.startsWith('restriction_')){
        const index=Number(question.key.slice('restriction_'.length));
        question.instructions=String(question.instructions)+CONSENT_ORDER_CONTEXT.replaceAll('declaration_segments',options.lineContexts?`line_contexts[${index}].declaration_segments`:'declaration_segments');
    }
    for(const [index,requirement] of cashRequirements.entries()){
        batch.questions.push({key:'cash_input_'+index,target:'cash_requirements['+index+']',type:'noul',
            instructions:'Does `current_player_words` explicitly accept the exact actual purse withdrawal in this cash requirement? This is the full cash_debit including earlier daily spending, not merely the new merchandise_amount. Judge the player\'s accepted amount, never copy permission from the proposed debit. A generic accept without the amount or a bound full quotation is insufficient.',
            criteria:{true:'The current input explicitly accepts this exact full cash_debit in this currency, including a selected structured confirmation that actually states it.',
                false:'The input accepts only goods, their nominal price, an unbound generic accept, or a different or still conditional cash commitment.'}});
        for(const [offerIndex] of requirement.earlier_full_quotes.entries())batch.questions.push({key:'cash_offer_'+index+'_'+offerIndex,
            target:'cash_requirements['+index+'].earlier_full_quotes['+offerIndex+']',type:'noul',
            instructions:'Has the player accepted this previously issued full quotation? `current_mechanics_choice` is the current player selection in the mechanics-choice input protocol: action accept with choice.binds naming this quote accepts its complete quotation card, including cash_debit; the amount need not be repeated. For natural language use previous_public to resolve a reference to that full quotation. Accepting only merchandise_amount or a different, unbound or still conditional offer does not count.',
            criteria:{true:'The current mechanics choice accepts this named quotation, or the current natural words accept this full quotation including the separate cash requirement.',
                false:'The player has not accepted this full quotation: only a nominal price, another quote, an unbound accept, a condition or a refusal.'}});
    }
    const deadlineAt=Math.min(began+admissionJevTimeoutMs(options.env??process.env),options.providerBudget?.deadlineAt??Infinity);
    const outer=options.signal??new AbortController().signal;
    const signal=options.providerBudget?AbortSignal.any([outer,options.providerBudget.signal]):outer;
    let lease:TaskLease|undefined,accounting:ReturnType<typeof preparationBudget>|undefined;
    const meta:Record<string,unknown>={typed_design:'continuous-consent-noul-v6',jev_calls:0};
    const failed=(reason:string)=>({ok:false as const,reason,ms:clock.now()-began,meta});
    try{
        if(!context.playerText.trim()||!batch.questions.length)return failed('no_consent_input');
        if(!options.decision)return failed('jev_unavailable');
        packDecisionBatch(batch);
        const clocked=options.clock?{clock:options.clock}:{};
        accounting=preparationBudget({decision:options.decision,
            campaign:options.campaign,deadlineAt,signal,...(options.providerBudget?{parent:options.providerBudget}:{}),
            owner:family,goal:'Check the scope of the current player choice',...clocked});
        lease=new TaskLease({owner:family,goal:'Check the scope of the current player choice',scope:batch.scope,
            capabilities:['decision'],readSet:batch.readSet,signal,...clocked,budget:{deadlineAt,remainingInputTokens:200000,
                remainingOutputTokens:20000,remainingCostUsd:.02,remainingActions:1}});
        meta.jev_calls=1;
        const result=await accounting.decision.decide(batch,lease);
        meta.jev_ms=clock.now()-began;meta.jev_input_tokens=result.usage?.inputTokens;
        if(signal.aborted)return failed('cancelled');
        if(result.status!=='complete'||result.batchId!==batch.id)return failed(result.failure?.code??'jev_unavailable');
        const probability=(key:string)=>{const answer=result.answers[key];return answer?.status==='answered'&&answer.type==='noul'?answer.noul:undefined;};
        const allProbabilities=batch.questions.map(question=>probability(question.key));
        const probabilities=options.proposal.lines.map((_,index)=>probability('consent_'+index));
        const restrictionProbabilities=options.proposal.lines.map((_,index)=>probability('restriction_'+index));
        const scopeProbabilities=restrictionProbabilities.map(p=>p===undefined?undefined:1-p);
        meta.line_admit_probabilities=probabilities;
        meta.line_scope_probabilities=scopeProbabilities;
        meta.line_restriction_probabilities=restrictionProbabilities;
        if(allProbabilities.some(p=>!Number.isFinite(p)||p!<0||p!>1))return failed('invalid_typed_answer');
        if(cashRequirements.length)meta.cash_authority_probabilities=cashRequirements.map((requirement:any,index:number)=>({index:requirement.index,
            input:probability('cash_input_'+index),offers:requirement.earlier_full_quotes.map((offer:any,offerIndex:number)=>({quote:offer.quote,probability:probability('cash_offer_'+index+'_'+offerIndex)}))}));
        const refused=probabilities.findIndex((p,index)=>p!<=1-CONTINUOUS_ADMISSION_MIN_PROBABILITY||scopeProbabilities[index]!<=1-CONTINUOUS_ADMISSION_MIN_PROBABILITY);
        const uncertain=refused<0&&probabilities.some((p,index)=>p!<CONTINUOUS_ADMISSION_MIN_PROBABILITY||scopeProbabilities[index]!<CONTINUOUS_ADMISSION_MIN_PROBABILITY);
        const verdict=refused>=0?'not_authorized':uncertain?'uncertain':'authorized';
        const grounds='Typed consent review '+(refused>=0?'refused line '+(refused+1):uncertain?'could not establish the proposed scope':'accepted the proposed scope')
            +'; declaration words: '+JSON.stringify((options.lineContexts?.[Math.max(0,refused)]??context).playerText.slice(0,200));
        const cashLimits:NonNullable<AdmissionVerdict['cash_limits']>=refused>=0?[]:cashRequirements.flatMap((requirement:any,index:number)=>{
            if(!mechanicsInput&&probability('cash_input_'+index)!>=CONTINUOUS_ADMISSION_MIN_PROBABILITY)
                return [{index:requirement.index,amount:requirement.cash_debit,basis:'input' as const,evidence:context.playerText}];
            const offer=requirement.earlier_full_quotes.find((_:unknown,offerIndex:number)=>probability('cash_offer_'+index+'_'+offerIndex)!>=CONTINUOUS_ADMISSION_MIN_PROBABILITY);
            return offer?[{index:requirement.index,amount:requirement.cash_debit,basis:'offer' as const,evidence:offer.quote}]:[];
        });
        if(uncertain)try{void Promise.resolve(options.record({lane:'admission',event:'uncertain_basis',turn:context.turn,basis:decisionEvidence(batch,result.answers)})).catch(()=>{});}catch{/* Diagnostics never change consent. */}
        return{ok:true,ms:clock.now()-began,meta,verdict:{verdict,grounds,
            ...(cashLimits.length?{cash_limits:cashLimits}:{}),
            ...(refused>=0?{missing:'This line adds an unchosen voluntary act or crosses a current player constraint.'}:uncertain?{missing:'The consent decision is uncertain; no authority was established.'}:{}),reviewer:'jev',path:'typed'}};
    }catch(error){return failed(error instanceof PackingError?error.failure:'jev_unavailable');}
    finally{lease?.close();accounting?.close();}
}

const isLaneVerdict = (value?: AdmissionOutcome): boolean => value?.ok === true && value.verdict.verdict !== REVIEW_TIMEOUT;
const isNoGrounds = (value?: AdmissionOutcome): boolean => value?.ok === false && value.reason === NO_GROUNDS;

/**
 * The primary review (§32.10, §32.12.2, §32.12.3.1, §32.12.3.2). The lane (§32.2) -- one call per line for an `apply` batch
 * of more than one reviewed line -- and one typed attempt over the whole proposal start at the same moment.
 *
 * - A line's lane verdict is sufficient when it carries grounds; it stands whatever the typed reading says. A lane answer
 *   without grounds is no answer.
 * - The typed reading settles a line alone only under §32.12.3.2's rule (`typedSettles`): the line's class on the data's
 *   list and its admitting confidence at the settle confidence or above, while that line's lane has given no verdict. Its
 *   lane call is then cancelled, and only its own: the other lines' calls run on. A typed refusal never stands: the lane
 *   decides refusals. A batch partly typed-settled and partly lane-reviewed lands whole or not at all (§32.10's mapping,
 *   applied by the caller).
 * - A line's lane failure is §32.2's outage unless the typed reading settles that line. The review waits for the typed
 *   answer (bounded by its own cap) only where it can still matter: a line it could settle, or one whose lane answered
 *   without grounds (its late admission and pending details read the typed reading). Nowhere else does a line wait for it,
 *   so a line the typed reading does not settle costs no wall time over the lane alone.
 * - At the cap (`timeoutMs`) a line with nothing sufficient, or a line whose lane answered without grounds, is `late`, with
 *   the typed reading and its lane still running (until the hard cap): the caller admits it late or returns it pending.
 *   This function never admits on a failure.
 *
 * Never throws; every outcome names its `path` (whose verdict stood), and every line's row its reviewer, its class, its
 * typed confidence and whether its lane call was cancelled.
 */
```
