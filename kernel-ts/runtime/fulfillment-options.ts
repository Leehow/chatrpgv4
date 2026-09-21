/** Disposable private selection catalogs. Ordinary apply is the only fulfillment writer. */
import {randomUUID} from 'node:crypto';
import type {KernelContext} from '../context.js';
import type {HandlerGroup} from '../handlers.js';
import {RpcError} from '../errors.js';
import {jsonDigest,parsePythonJson,PythonFloat} from '../json.js';
import {CampaignSnapshot,loadCampaignModule} from '../read/campaign.js';
import {CampaignWriter} from '../write/store.js';
import {personLabel,placeLabel} from '../read/capsule.js';
import {taskWorldRevision} from '../read/context.js';
import {array,row,string,clone,type Row} from '../read/values.js';
import {cashDecimal,cashStorage,cashText,compareCash} from '../apply/cash.js';
import {objectOwner} from '../mods/stage.js';
import {deriveCommittedSpeechSpans} from '../../runtime/jev/committed-speech-spans.ts';
import {issueSourceRef} from '../../runtime/jev/source-ref.ts';
import type {SourceRef} from '../../runtime/jev/value-contracts.ts';
import {promiseFulfillmentSources,fulfillmentReceiptSource,fulfillmentCurrentInputSource,fulfillmentNumericCandidates,
    fulfillmentDecimal,fulfillmentBindingDigest,derivePromiseFulfillment,prepareFulfillments,
    type FulfillmentContext,type PromiseFulfillmentSources,type PromiseTermsBinding,type PromiseTerm,type FulfillmentSelection} from '../memory/fulfillment-receipt.js';

const fail=(reason:string,message:string):never=>{throw new RpcError('needs',message,{details:{reason}});};
const same=(a:any,b:any)=>jsonDigest(a)===jsonDigest(b);
const closed=(value:any,keys:string[],required=keys):value is Row=>value!==null&&typeof value==='object'&&!Array.isArray(value)
    &&Object.keys(value).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(value,key));
const select=<T>(map:Map<string,T>,alias:any):T=>typeof alias==='string'&&map.has(alias)?map.get(alias)!:fail('fulfillment_alias_unknown','Select an alias issued by this fulfillment snapshot');
const ZERO=fulfillmentDecimal('0');
/** OperationProposal uses portable JSON, never PythonFloat objects or rounded bigint casts. */
export function fulfillmentPortableNumber(value:string):number {
    const exact=fulfillmentDecimal(value),stored=cashStorage(exact);
    const numeric=stored instanceof PythonFloat?stored.value:stored;
    if(typeof numeric!=='number'||!Number.isFinite(numeric)||!cashDecimal(numeric)||compareCash(cashDecimal(numeric)!,exact)!==0
        ||!cashDecimal(JSON.parse(JSON.stringify(numeric)))||compareCash(cashDecimal(JSON.parse(JSON.stringify(numeric)))!,exact)!==0)
        return fail('unsupported_terms','The exact amount is not a portable JSON number');
    return numeric;
}
/** Source excerpts stop at complete Unicode code points and disclose every truncation. */
export function fulfillmentContextExcerpt(value:string,limit:number):{text:string;omitted:boolean} {
    const points=Array.from(value);return {text:points.slice(0,limit).join(''),omitted:points.length>limit};
}
/** Identity columns are labels or resolved names; unknown historical identities never leak IDs. */
export function fulfillmentConditionDescription(receipt:Row,names:ReadonlyMap<string,string>):Row {
    const identities=new Set(['subject','with','clue','to','from']);
    const numberValue=(value:any):any=>value instanceof PythonFloat?value.value:typeof value==='bigint'?String(value):value;
    return Object.fromEntries(['kind','subject','with','actor_label','skill','level','passed','outcome','name','clue','to','from','quantity','delta','currency','before','after','why','minutes']
        .filter(key=>Object.hasOwn(receipt,key)).map(key=>{
            if(!identities.has(key)) return [key,numberValue(receipt[key])];
            const label=receipt[key+'_label'],identity=typeof receipt[key]==='string'?receipt[key]:row(receipt[key]).id;
            return [key,typeof label==='string'&&label.trim()?label:typeof identity==='string'?names.get(identity)??null:null];
        }));
}
interface Scalar {value:string;ref:SourceRef;kind:'token'|'cash'|'object';currency?:string;instance?:string;definition?:string}
interface Catalog {
    campaign:string;ids:string[];revision:string;worldRevision:string;catalog:Row;context:FulfillmentContext;receipts:Row[];
    promises:Map<string,PromiseFulfillmentSources>;scalars:Map<string,Scalar>;beneficiaries:Map<string,Row>;payers:Map<string,Row>;
    currencies:Map<string,string>;objects:Map<string,Row>;conditions:Map<string,string>;allocations:Map<string,Scalar>;prior:Map<string,PromiseTermsBinding>;priorTerms:Map<string,PromiseTerm>;
}
export async function fulfillmentPromiseNavigation(context:KernelContext,campaign:CampaignSnapshot):Promise<Row> {
    const worldline=string(campaign.meta.active_worldline||'main'),loop=Number(row(row(campaign.meta.worldlines)[worldline]).loop??0);
    const promises:Row[]=[],private_promises:Row={},receipts=[...(await campaign.files('turns')).flatMap(value=>array(value.receipts)),...array(campaign.turn.receipts)];
    for(const value of await campaign.log('memory/candidates.jsonl')) {
        if(value.kind!=='promise'||value.memory_version!==2||value.superseded_by!=null||value.valid_until_turn!=null||value.status!=='candidate'
            ||value.state!=='accurate'||value.worldline!==worldline||Number(value.loop)!==loop) continue;
        const alias=`promise:${promises.length}`;
        const fulfillment=derivePromiseFulfillment(value.id,receipts,{scope:{campaign:campaign.id,worldline,loop},promiseRefs:value.source_refs});
        promises.push({alias,statement:value.statement,subject:value.subject,fulfillment:{status:fulfillment.status,terms:fulfillment.terms.map(term=>({kind:term.kind,total:term.total,fulfilled:term.fulfilled,remaining:term.remaining}))}});private_promises[alias]=value.id;
    }
    return {promises,private_promises};
}
async function buildCatalog(kernel:KernelContext,id:any,ids:string[]):Promise<Catalog> {
    const saved=await CampaignSnapshot.open(kernel,id);await saved.preload('view');
    if(saved.meta.status!=='active'||!['open','acting'].includes(saved.turn.state)) return fail('campaign_not_ready','Fulfillment selection requires the current open player turn');
    const module=await loadCampaignModule(kernel,string(saved.meta.module_id),saved.world,saved.id),campaign=new CampaignWriter(kernel,saved.id);
    const context:FulfillmentContext={kernel,campaign,world:saved.world,turn:saved.turn,graph:module.graph};
    const result:Catalog={campaign:saved.id,ids,revision:'',worldRevision:taskWorldRevision(saved.world,saved.party,saved.turn.receipts,saved.turn.pending_choice),
        catalog:{promises:[],beneficiaries:[],payers:[],objects:[],conditions:[],allocations:[]},context,receipts:[],promises:new Map(),scalars:new Map(),
        beneficiaries:new Map(),payers:new Map(),currencies:new Map(),objects:new Map(),conditions:new Map(),allocations:new Map(),prior:new Map(),priorTerms:new Map()};
    for(const [index,promiseId] of ids.entries()) {
        const source=await promiseFulfillmentSources(context,promiseId),alias=`promise:${index}`;result.promises.set(alias,source);
        const scalars=source.scalars.map(scalar=>{const issued=`total:${result.scalars.size}`;result.scalars.set(issued,{value:scalar.value,ref:scalar.ref,kind:'token'});
            return {alias:issued,text:scalar.text,value:scalar.value,kind:'token'};});
        result.catalog.promises.push({alias,statement:source.promise.statement,subject:source.promise.subject,scalars,original_context:source.snapshots.map(snapshot=>({role:snapshot.resource.endsWith(':keeper')?'keeper':'player',...fulfillmentContextExcerpt(snapshot.text??'',24000)}))});
    }
    const scope=result.promises.values().next().value!.scope;
    for(const person of saved.party) {
        const owner=await objectOwner(campaign,module.graph,saved.world,person.id),alias=`beneficiary:${result.beneficiaries.size}`;
        result.beneficiaries.set(alias,owner);const currency=row(row(person.finance).cash).currency,currencies:Row[]=[];
        if(typeof currency==='string'&&currency) {const unit=`currency:${result.currencies.size}`;result.currencies.set(unit,currency);currencies.push({alias:unit,name:currency});}
        result.catalog.beneficiaries.push({alias,name:owner.name,currencies});
    }
    for(const node of module.graph.nodes.values()) if(node.node_kind==='npc') {
        let owner:Row;try{owner=await objectOwner(campaign,module.graph,saved.world,module.graph.handle(node));}catch(error){if(error instanceof RpcError&&['unknown_entity','ambiguous_entity'].includes(error.code))continue;throw error;}
        const alias=`payer:${result.payers.size}`;
        result.payers.set(alias,owner);result.catalog.payers.push({alias,name:owner.name});
    }
    for(const instance of Object.values(row(row(saved.world.objects).instances)) as Row[]) {
        const definition=row(row(saved.world.objects).definitions)[instance.definition],payer=[...result.payers].find(([,owner])=>owner.id===row(instance.owner).id);
        if(!definition||!payer) continue;
        const alias=`object:${result.objects.size}`;result.objects.set(alias,instance);
        result.catalog.objects.push({alias,name:instance.name,definition_name:definition.name,payer:payer[0],scalars:[]});
    }
    const records=await saved.files('turns'),immutable:Row[]=[];
    for(const retained of records) {
        if(retained.closed_by!=='narrate'||typeof retained.commit!=='string'||!/^[a-f0-9]{7,64}$/.test(retained.commit)) continue;
        const resolved=await kernel.git.run(saved.id,['rev-parse','--verify',`${retained.commit}^{commit}`]),commit=resolved.stdout.trim();
        if(resolved.code||!/^[a-f0-9]{40,64}$/.test(commit)) continue;
        const [recordBlob,metaBlob]=await Promise.all([kernel.git.run(saved.id,['show',`${commit}:turns/${String(retained.turn).padStart(4,'0')}.json`]),kernel.git.run(saved.id,['show',`${commit}:campaign.json`])]);
        if(recordBlob.code||metaBlob.code) continue;
        const original=row(parsePythonJson(recordBlob.stdout)),meta=row(parsePythonJson(metaBlob.stdout)),worldline=string(meta.active_worldline||'main');
        if(meta.id!==saved.id||worldline!==scope.worldline||Number(row(row(meta.worldlines)[worldline]).loop??0)!==scope.loop) continue;
        if(original.turn!==retained.turn||original.closed_by!=='narrate'||!same(original.receipts,retained.receipts))
            return fail('needs_source','Retained effect receipts differ from their canonical committed originals');
        immutable.push({commit,record:original});result.receipts.push(...array(original.receipts));
    }
    result.receipts.push(...array(saved.turn.receipts));
    const names=new Map<string,string>();
    for(const person of saved.party) {const label=personLabel(saved.world,person.id,person.name);names.set(person.id,label);names.set(person.name,label);names.set(label,label);}
    for(const node of module.graph.nodes.values()) {const authored=module.graph.displayName(node),handle=module.graph.handle(node),label=node.node_kind==='npc'?personLabel(saved.world,handle,authored):node.node_kind==='scene'?placeLabel(saved.world,handle,authored):authored;names.set(node.node_id,label);names.set(handle,label);names.set(authored,label);names.set(label,label);}
    for(const instance of Object.values(row(row(saved.world.objects).instances)) as Row[]) {names.set(instance.id,instance.name);names.set(instance.name,instance.name);}
    const seen=new Map<string,Row>();
    for(const receipt of result.receipts) {
        if(typeof receipt.id!=='string') continue;
        if(seen.has(receipt.id)) {if(!same(seen.get(receipt.id),receipt)) return fail('fulfillment_receipt_invalid','Canonical receipt identities conflict');continue;}
        seen.set(receipt.id,receipt);const alias=`condition:${result.conditions.size}`;result.conditions.set(alias,receipt.id);
        const description=fulfillmentConditionDescription(receipt,names);
        result.catalog.conditions.push({alias,description});
    }
    for(const {commit,record} of immutable) for(const receipt of array(record.receipts)) {
        if(receipt.kind!=='cash'&&receipt.kind!=='item') continue;
        const source=fulfillmentReceiptSource(scope,commit,record.turn,receipt);
        for(const field of source.allowedFields??[]) {
            const value=row(source.record)[field[0]];
            if(typeof value!=='string'||compareCash(fulfillmentDecimal(value),ZERO)<=0) continue;
            const physical=[...result.objects].find(([,instance])=>instance.id===receipt.instance),unit=field[0]==='source_amount'?receipt.source_currency:receipt.currency;
            if(receipt.kind==='item'&&(!physical||field[0]!=='quantity')||receipt.kind==='cash'&&!['delta','source_amount','purchase_amount'].includes(field[0])) continue;
            const alias=`total:${result.scalars.size}`,scalar:Scalar={value,ref:issueSourceRef(source,{kind:'field',path:[...field]}),kind:receipt.kind==='cash'?'cash':'object',
                ...(receipt.kind==='cash'?{currency:unit}:{instance:physical![1].id,definition:physical![1].definition})};
            result.scalars.set(alias,scalar);
            const display={alias,text:value,value,kind:scalar.kind,...(scalar.currency?{currency:scalar.currency}:{}),...(physical?{object:physical[0]}:{}),origin:{kind:receipt.kind,name:receipt.name??null,field:field[0],turn:record.turn}};
            for(const promise of result.catalog.promises) promise.scalars.push(display);
            if(physical) result.catalog.objects.find((value:Row)=>value.alias===physical[0]).scalars.push(display);
        }
    }
    const current=fulfillmentCurrentInputSource(scope,Number(saved.turn.turn),string(saved.turn.player_text??''));
    for(const value of fulfillmentNumericCandidates(current)) {
        const alias=`allocation:${result.allocations.size}`;result.allocations.set(alias,{value:value.value,ref:value.ref,kind:'token'});
        result.catalog.allocations.push({alias,text:value.text,value:value.value});
    }
    for(const promise of result.catalog.promises) {
        const source=result.promises.get(promise.alias)!;
        const original=immutable.find(value=>value.record.turn===source.promise.source.turn&&value.commit===source.promise.source.commit)?.record;
        if(original) {
            const speech=deriveCommittedSpeechSpans({markedText:original.marked_text??original.rendered_text,renderedText:original.rendered_text,speech:original.speech??[]});
            promise.original_context=[{role:'player',...fulfillmentContextExcerpt(string(original.player_text??''),24000)},
                {role:'keeper',...fulfillmentContextExcerpt(string(original.rendered_text??''),24000),
                    attribution_status:speech.status,speech_omitted:speech.spans.length>32,
                    speech:speech.spans.slice(0,32).map(value=>({speaker:string(row(value.who).name??row(value.who).label),...fulfillmentContextExcerpt(original.rendered_text.slice(value.start,value.end),2048)}))}];
        }
        const derived=derivePromiseFulfillment(source.promise.id,result.receipts,{scope:source.scope,promiseRefs:source.refs});
        promise.fulfillment={status:derived.status,terms:derived.terms.map(term=>({kind:term.kind,total:term.total,fulfilled:term.fulfilled,remaining:term.remaining}))};
        const link=result.receipts.map(receipt=>row(receipt.fulfillment)).find(link=>link.promise===source.promise.id&&same(link.scope,source.scope));
        if(link) {
            const binding:PromiseTermsBinding={version:1,promiseId:source.promise.id,promiseRefs:clone(source.refs),scope:source.scope,terms:clone(link.terms),digest:link.terms_digest,conditionReceipts:clone(link.condition_receipts),coverage:{complete:true,used:[],omitted:[]}};
            result.prior.set(promise.alias,binding);
            promise.prior_terms=binding.terms.map((term,index)=>{
                const alias='term:'+result.priorTerms.size;result.priorTerms.set(alias,term);
                const beneficiary=[...result.beneficiaries].find(([,owner])=>owner.id===term.beneficiary)?.[0],payer=[...result.payers].find(([,owner])=>owner.id===term.payer)?.[0];
                const currency=term.currency?[...result.currencies].find(([,name])=>name===term.currency)?.[0]:undefined;
                const object=term.instance?[...result.objects].find(([,instance])=>instance.id===term.instance)?.[0]:undefined;
                return {alias,kind:term.kind,total:term.total.value,fulfilled:derived.terms[index].fulfilled,remaining:derived.terms[index].remaining,beneficiary:beneficiary??null,payer:payer??null,...(term.currency?{currency:currency??null}:{}),...(term.instance?{object:object??null}:{}),allocation:'remaining'};
            });
        }
    }
    result.catalog.unsupported_capabilities=['Rates or formulas','Word-only amounts without typed scalar evidence','Ambiguous units or incomplete term coverage','New definitions or new physical instances','Partial stack transfers requiring a named new part'];
    result.revision=jsonDigest({meta:saved.meta,world:result.worldRevision,turn:saved.turn,party:saved.party,memory:await saved.log('memory/candidates.jsonl'),records,
        module:module.generation,graph:[...module.graph.nodes],catalog:result.catalog,sources:[...result.promises.values()],immutable} as any);
    return result;
}
export function fulfillmentHandlers(kernel:KernelContext):HandlerGroup {
    const snapshots=new Map<string,Catalog>();
    return {
        'table.fulfillment.options':async params=>{
            if(!closed(params,['campaign','promises'])||!Array.isArray(params.promises)||!params.promises.length||params.promises.length>8
                ||params.promises.some(value=>typeof value!=='string')||new Set(params.promises).size!==params.promises.length)
                throw new RpcError('invalid_params','Fulfillment options require unique host-bound promise identities');
            const value=await buildCatalog(kernel,params.campaign,params.promises as string[]),snapshot=randomUUID();
            snapshots.set(snapshot,value);while(snapshots.size>32)snapshots.delete(snapshots.keys().next().value!);
            return {version:1,snapshot,revision:value.revision,world_revision:value.worldRevision,catalog:clone(value.catalog)};
        },
        'table.fulfillment.prepare':async params=>{
            if(!closed(params,['campaign','snapshot','selections'])||typeof params.snapshot!=='string'||!Array.isArray(params.selections)||!params.selections.length||params.selections.length>8)
                throw new RpcError('invalid_params','Fulfillment preparation accepts only a snapshot and closed alias selections');
            const retained=snapshots.get(params.snapshot);
            if(!retained||retained.campaign!==params.campaign) return fail('fulfillment_snapshot_stale','The fulfillment snapshot is absent or belongs to another campaign');
            const current=await buildCatalog(kernel,params.campaign,retained.ids);
            if(current.revision!==retained.revision) return fail('fulfillment_snapshot_stale','Fulfillment source, memory, world or current input changed; select again');
            const effects:Row[]=[],bindings:FulfillmentSelection[]=[],seen=new Set<string>();
            for(const selection of params.selections as Row[]) {
                if(!closed(selection,['promise','conditions','coverage','terms'])||selection.coverage!=='complete'||!Array.isArray(selection.conditions)
                    ||!selection.conditions.length||selection.conditions.length>16||new Set(selection.conditions).size!==selection.conditions.length
                    ||!Array.isArray(selection.terms)||!selection.terms.length||selection.terms.length>8||seen.has(selection.promise))
                    return fail('unsupported_terms','Each promise needs a unique complete finite term set and actual condition selections');
                seen.add(selection.promise);const source=select(current.promises,selection.promise),terms:PromiseTerm[]=[],choices:Row[]=[];
                const previous=current.prior.get(selection.promise);
                if(previous&&selection.terms.length!==previous.terms.length) return fail('unsupported_terms','Every previously bound term must remain present');
                for(const [ordinal,choice] of selection.terms.entries()) {
                    if(previous) {
                        if(!closed(choice,['prior','allocation','handover'],['prior','allocation'])) return fail('fulfillment_terms_changed','A partial promise must reuse its issued original term aliases');
                        const term=select(current.priorTerms,choice.prior);
                        if(!same(term,previous.terms[ordinal])||!current.catalog.promises.find((value:Row)=>value.alias===selection.promise).prior_terms.some((value:Row)=>value.alias===choice.prior))
                            return fail('fulfillment_terms_changed','The selected prior term belongs to another promise or order');
                        const beneficiary=[...current.beneficiaries.values()].find(owner=>owner.id===term.beneficiary),payer=[...current.payers.values()].find(owner=>owner.id===term.payer),object=term.instance?row(row(current.context.world.objects).instances)[term.instance]:undefined;
                        if(!beneficiary||!payer) return fail('fulfillment_target_changed','The original finite term owner is unavailable');
                        terms.push(clone(term));choices.push({choice,beneficiary,payer,object});continue;
                    }
                    if(!closed(choice,['kind','total','beneficiary','payer','currency','object','allocation','handover'],['kind','total','beneficiary','payer','allocation'])||!['cash','object'].includes(choice.kind))
                        return fail('unsupported_terms','Finite terms accept only issued cash or existing physical object choices');
                    const total=select(current.scalars,choice.total),beneficiary=select(current.beneficiaries,choice.beneficiary),payer=select(current.payers,choice.payer);
                    const ownTokens=current.catalog.promises.find((value:Row)=>value.alias===selection.promise).scalars;
                    if(!ownTokens.some((value:Row)=>value.alias===choice.total)) return fail('needs_source','The total belongs to a different promise occurrence');
                    const term:PromiseTerm={ordinal,kind:choice.kind,total:{source:total.ref,value:total.value},beneficiary:beneficiary.id,payer:payer.id};
                    let object:Row|undefined;
                    if(choice.kind==='cash') {
                        if(choice.object!==undefined||choice.currency===undefined||total.kind==='object') return fail('unsupported_terms','Cash requires the bound currency and a cash-compatible scalar');
                        term.currency=select(current.currencies,choice.currency);
                        if(total.kind==='cash'&&total.currency!==term.currency) return fail('unsupported_terms','The typed scalar uses a different currency');
                        if(!current.catalog.beneficiaries.find((value:Row)=>value.alias===choice.beneficiary).currencies.some((value:Row)=>value.alias===choice.currency))
                            return fail('fulfillment_target_changed','The beneficiary does not hold the selected currency');
                    } else {
                        if(choice.currency!==undefined||choice.object===undefined||total.kind==='cash') return fail('unsupported_terms','Physical gifts require an existing object and its exact quantity source');
                        object=select(current.objects,choice.object);term.definition=object.definition;term.instance=object.id;
                        if(row(object.owner).id!==payer.id||total.kind==='object'&&(total.instance!==object.id||total.definition!==object.definition))
                            return fail('fulfillment_target_changed','The object or typed quantity belongs to a different owner or instance');
                    }
                    terms.push(term);choices.push({choice,beneficiary,payer,object});
                }
                const binding:PromiseTermsBinding={version:1,promiseId:source.promise.id,promiseRefs:clone(source.refs),scope:source.scope,terms,
                    conditionReceipts:selection.conditions.map((alias:string)=>select(current.conditions,alias)),coverage:{complete:true,used:[...source.refs,...terms.map(term=>term.total.source)],omitted:[]},digest:''};
                binding.digest=fulfillmentBindingDigest(binding);const prior=derivePromiseFulfillment(binding.promiseId,current.receipts,binding),mapping:FulfillmentSelection['effects']=[];
                for(const [ordinal,{choice,beneficiary,payer,object}] of choices.entries()) {
                    const remaining=prior.terms[ordinal].remaining,term=terms[ordinal];
                    if(choice.handover!==undefined&&(term.kind!=='object'||choice.handover!=='given')) return fail('unsupported_terms','Only physical gifts may select the given handover');
                    if(choice.allocation==='defer') continue;
                    const allocation=choice.allocation==='remaining'?undefined:select(current.allocations,choice.allocation);
                    if(remaining==='0'&&!allocation) continue;
                    if(term.kind==='object'&&choice.handover!=='given') return fail('unsupported_terms','An executed physical gift needs the explicitly selected given handover');
                    const amount=fulfillmentPortableNumber(allocation?.value??remaining);
                    if(term.kind==='object'&&(!object||!cashDecimal(object.quantity)||compareCash(cashDecimal(object.quantity)!,fulfillmentDecimal(allocation?.value??remaining))<0))
                        return fail('fulfillment_target_changed','The existing physical instance does not hold the selected exact quantity');
                    if(term.kind==='object'&&compareCash(cashDecimal(object.quantity)!,fulfillmentDecimal(allocation?.value??remaining))>0)
                        return fail('unsupported_terms','A partial physical stack needs an independently prepared named part; this fulfillment route only transfers whole existing instances');
                    effects.push(term.kind==='cash'?{kind:'cash',subject:beneficiary.name,with:payer.name,source:'quote',currency:term.currency,delta:amount}
                        :{kind:'object',name:object.name,from:payer.name,to:beneficiary.name,quantity:amount,handover:'given'});
                    mapping.push({effect:effects.length-1,term:ordinal,...(allocation?{amountSource:allocation.ref}:{})});
                }
                bindings.push({binding,effects:mapping});
            }
            await prepareFulfillments({...current.context,bindings,effects});
            return {effects,bindings:{fulfillments:bindings},revision:current.revision,world_revision:current.worldRevision} as Row;
        }
    };
}
