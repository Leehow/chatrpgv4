/** The existing staged apply batch, with named domain contributions. */
import type { KernelContext } from '../context.js';
import type { HandlerGroup } from '../handlers.js';
import type { CampaignWritePort, DomainEvent, TurnTransaction } from '../transactions.js';
import { RpcError } from '../errors.js';
import {moveEstablishmentRefusal} from '../../shared/move-protocol.ts';
import {stageEvent,eventOutcome} from '../turn-events.js';
import {StagedCampaignWriter} from './staged-campaign.js';
import { isJsonObject } from '../json.js';
import { CampaignSnapshot, loadCampaignModule, type LoadedModule } from '../read/campaign.js';
import { worldRevision, taskWorldRevision } from '../read/context.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { actor as selectActor, sceneView, unsupported } from '../read/handlers.js';
import { array, clone, entries, integer, number, repr, row, string, truth, type Row } from '../read/values.js';
import { playsFromReading } from '../modules/bound-source.js';
import { RuleTables } from '../rules/tables.js';
import { RuleObservations } from '../read/rule-facts.js';
import { CheckArithmetic } from '../resolve/arithmetic.js';
import { SettleContext } from '../resolve/context.js';
import { readCalledPeople } from '../resolve/pipeline.js';
import { npcPatient } from '../healing/patient.js';
import { requirePatientBlock } from '../combat/stat-block.js';
import { markersOf } from '../resolve/projection.js';
import {initializeNpcVariations} from '../resolve/npc-variation.js';
import {ensureNpcReferences} from '../npc/references.js';
import {withTablePeople} from '../read/table-people.js';
import {isNpcVariationRoll} from '../npc/variation.js';
import { createWriteRuntime } from '../write/index.js';
import { nowIso } from '../write/store.js';
import { advanceClock, stageClock } from './clock.js';
import {openingActivityShape,stageSceneActivity} from './activity.js';
import {openingInformationShape} from '../../runtime/opening-information.ts';
import {operationOutcomes} from './outcomes.js';
import { stageMove } from './move.js';
import {appendJsonl} from '../fileio.js';
import {join} from 'node:path';
import {stageFlag,stageNote,stageRuling,stageThreat} from './bookkeeping.js';
import {stageClue,stageNpc,stageHandout,landPeople,landRequests,openingSeatShape} from './entities.js';
import { passNpcTurn } from '../combat/execution.js';
import { effectIntent } from './intent.js';
import { armDrawn } from './draw.js';
import type {MaterialGate,TextLanding} from '../modules/reading.js';
import {stagePerson} from './person.js';
import {calledPerson,personNode,sceneLabel} from '../read/capsule.js';
import {castPersonNamed, newcomerRefusal} from '../read/cast.js';
import {passageOf} from '../read/table-people.js';
import {presentArrivalMaps,revealMap} from '../read/maps.js';
import {stageItem,stageCash,stageCarriedGoods,commitInventorySheets} from './inventory.js';
import type {createWorldlineRuntime} from '../worldline/index.js';
import type {createModRuntime} from '../mods/index.js';
import type {CampaignWriter} from '../write/store.js';
import {prepareFulfillments, type FulfillmentSelection} from '../memory/fulfillment-receipt.js';
import {activeScene, openGuards} from '../read/obligations.js';
import {bindStated, stampBasis, type StatedEffect} from './stated.js';
import {bindBand} from './band.js';
import { bindUntil } from './until.js';
import { owedBands, readOwed } from '../owed/index.js';
import { owedRowFor, settleOwed } from '../owed/land.js';
import { APPLY_KINDS } from './kinds.js';
const KINDS = [...APPLY_KINDS];
export interface ApplyContext {
    readonly kernel: KernelContext;
    readonly transaction: TurnTransaction;
    readonly campaign: CampaignWritePort;
    readonly world: Row;
    readonly turn: Row;
    readonly graph: ModuleGraph;
    readonly module: LoadedModule;
    readonly callId: string;
    readonly ordinal: number;
    mint(base: string): string;
    settlement(subject?: any): Promise<SettleContext>;
    /** The receipts this call has staged so far, in order (§135.30.7: a move earlier in the same batch is a departure). */
    staged?(): Row[];
    stageText?(path:string,text:string):void;
    /** §154 (prototype): the host runs lean `apply` arguments (`_lean`), so what a lean call leaves out and a reader needs is filled here. */
    readonly lean?: boolean;
}
export interface ApplyResources {
    damage(context: ApplyContext, effect: Row): Promise<{
        receipts: Row[];
        event: DomainEvent;
    }>;
    recovery(context: ApplyContext, minutes: number): Promise<{
        receipts: Row[];
        events: DomainEvent[];
        recovered: Row[];
    }>;
    dayBoundary(context: ApplyContext, clockBefore: number): Promise<Row | null>;
}
export interface ApplyContributions {
    readonly adaptation?: (context: ApplyContext, effect: Row) => Promise<{receipt: Row; event: Row}>;
    readonly worldlines?: ReturnType<typeof createWorldlineRuntime>;
    readonly mods?: ReturnType<ReturnType<typeof createModRuntime>['apply']>;
    readonly resources?: ApplyResources;
    readonly ending?: (context: ApplyContext, effect: Row) => Promise<{
        receipt: Row;
        event: DomainEvent;
    }>;
    /**
     * §22.4.7: `gate` names the move destinations and the scenes entered on their index text; §22.4.7.1: the names in a
     * person's seat, the people landed before and the host's landings. Returns what it let through on the book's text.
     */
    readonly requireMaterial?: (graph: ModuleGraph, names: any[], gate?: MaterialGate) => Promise<TextLanding[] | void>;
    /** §107.1: queue the arrived scene's map reading in the background; never refuses the move. */
    readonly queueArrivalMap?: (graph: ModuleGraph, scene: Row) => Promise<Row>;
    readonly queueSceneExhibits?: (graph: ModuleGraph, scene: Row) => Promise<Row>;
    readonly materialReady?: (moduleId: string, name: string) => Promise<boolean>;
    readonly queueAdjacentReading?: (graph: ModuleGraph, scene: Row) => Promise<string[]>;
    readonly asset?: (moduleId:string,name:string)=>Promise<Row|null>;
    readonly weaponCatalog?: (graph:ModuleGraph)=>Promise<Map<string,Row>>;
}
/** §253.1: a place command that registers the opening scene without moving the investigator. */
const openingPlaceShape = (effect: Row): boolean => string(effect.kind) === 'place' && ['establish', 'observe', 'feature', 'relate'].includes(string(effect.action));
function atIndex(error: RpcError, index: number): RpcError {
    return new RpcError(error.code, error.message, { fix: error.fix, codeDetail: error.codeDetail, details: { index, ...error.details } });
}
export function createApplyHandlers(kernel: KernelContext, writer: ReturnType<typeof createWriteRuntime>, contributions: ApplyContributions = {}): HandlerGroup {
    const tables = new RuleTables(kernel);
    return { 'table.apply': async (params) => {
            const malformed = moveEstablishmentRefusal(params.effects);
            if (malformed) throw new RpcError(malformed.code, malformed.message, malformed);
            const transaction = await writer.transaction(params, { repairLegacyTrail: false, preload: false }), { campaign, turn } = transaction;
            const effects = Array.isArray(params.effects) ? params.effects.map(effect => isJsonObject(effect) ? {...effect} : effect) : params.effects;
            const callParams = Array.isArray(effects) ? { ...params, effects: effects.map(effect => isJsonObject(effect) ? Object.fromEntries(entries(effect).filter(([key]) => !key.startsWith('_')||key==='_new_person'||key==='_population')) : effect) } : params;
            // §253.1: the opening registers where it stands (place establish/observe/feature/relate) without moving anyone.
            // §198.3: beside the preparations the opening already admits, an npc effect shaped as a seat (stageNpc decides whether
            // it is one: a person the book places in the opening scene whom nobody has placed yet).
            const opening = Array.isArray(effects) && effects.length > 0 && effects.every(effect => isJsonObject(effect)
                && (['define', 'object', 'ability', 'usage', 'clock','scene'].includes(string(effect.kind)) || openingPlaceShape(effect) || openingSeatShape(effect) || openingActivityShape(effect) || openingInformationShape(effect)));
            const started = await transaction.beginWrite('table.apply', callParams, { allowOpening: opening });
            if (started.kind === 'replay')
                return started.result;
            if (params._task_read_set !== undefined && typeof params._task_read_set !== 'boolean')
                throw new RpcError('invalid_params', '_task_read_set must be boolean');
            if (params._lean !== undefined && typeof params._lean !== 'boolean')
                throw new RpcError('invalid_params', '_lean must be boolean');
            const beforeTaskRevision = params._task_read_set === true
                ? worldRevision(transaction.world, await campaign.party() as Row[], turn.receipts, turn.pending_choice) : undefined;
            const beforeTaskCore = params._task_read_set === true
                ? taskWorldRevision(transaction.world, await campaign.party() as Row[], turn.receipts, turn.pending_choice) : undefined;
            if (!Array.isArray(effects) || (!effects.length && params.event === undefined))
                throw new RpcError('invalid_params', 'params.effects must be a non-empty list');
            const eventEffectIndex=effects.findIndex(effect=>isJsonObject(effect)&&effect.kind==='event');
            if(eventEffectIndex>=0)throw new RpcError('invalid_params','An event is not an effect kind',{
                fix:'Put the occurrence in top-level apply.event beside effects. Keep only actual state changes in effects; resend the corrected batch without repeating earlier committed operations.',
                details:{reason:'event_is_not_effect',index:eventEffectIndex,field:'event'}
            });
            if (effects.some(effect => isJsonObject(effect) && effect.kind === 'usage') && effects.some(effect => !isJsonObject(effect) || !['define','object','usage'].includes(string(effect.kind))))
                throw new RpcError('invalid_params','A usage preparation batch contains only define, object and usage; apply other actions separately');
            if (effects.some(effect => isJsonObject(effect) && effect.kind === 'adaptation') && effects.length !== 1)
                throw new RpcError('invalid_params', 'Accept an adaptation alone; ordinary effects belong to later calls');
            const available = (kind: string) => kind === 'adaptation' ? !!contributions.adaptation : ['clock','clue','npc','item','cash','flag','note','person','ruling','threat','scene'].includes(kind) || (['define','object','ability','dossier','usage','place'].includes(kind)?!!contributions.mods:['fork','switch','merge'].includes(kind)?!!contributions.worldlines:['handout','map'].includes(kind)?!!contributions.asset:['time', 'damage', 'move'].includes(kind) ? !!contributions.resources : kind === 'ending' ? !!contributions.ending : false);
            // A partial backend refuses unimplemented batches before any domain draws or writes.
            for (const [index, effect] of effects.entries())
                if (isJsonObject(effect) && typeof effect.kind === 'string' && KINDS.includes(effect.kind) && !available(effect.kind))
                    throw atIndex(new RpcError('not_implemented', `effect kind ${repr(effect.kind)} has no implementation in this TypeScript kernel yet`), index);
            const module = await loadCampaignModule(kernel, string((await campaign.readCampaign()).module_id), transaction.world, campaign.id), graph = module.graph;
            const fulfillment = params._fulfillments === undefined ? undefined : await prepareFulfillments({
                kernel, campaign, world:transaction.world, turn, graph, effects:effects as Row[], bindings:params._fulfillments as unknown as FulfillmentSelection[]});
            const authored: Row = { place: 'to', move: 'to', clue: 'clue', npc: 'name', handout: 'name', map: 'name' };
            const kinds: Record<string, string[]> = { place: ['scene'], move: ['scene'], clue: ['clue'], npc: ['npc'], handout: ['handout', 'asset'], map: ['handout', 'asset'] };
            const seated = effects.filter(isJsonObject).filter(effect => Object.hasOwn(authored, string(effect.kind))&&(effect.kind!=='place'||effect.action!=='establish'));
            const names = seated.map(effect => {
                const name = effect[authored[string(effect.kind)]];
                if (typeof name !== 'string') return name;
                if(effect.kind==='place'&&name==='here')return graph.scene(string(transaction.world.active_scene)).node_id;
                // §188.4 (§87.8): an `npc` effect's person is read by the junction, so a person this table calls by its own
                // word meets the gate as the book's person it is; a word two people carry is left to `apply npc`'s refusal.
                let person: Row | null = null;
                if (effect.kind === 'npc') try { person = personNode(graph,transaction.world,name); } catch { person = null; }
                const node = person ?? (['handout','map'].includes(string(effect.kind)) ? graph.find(name, ['handout']) ?? graph.find(name, ['asset']) : graph.find(name, kinds[string(effect.kind)]));
                return node?.node_id ?? name;
            });
            if (playsFromReading(module.meta) && (!contributions.requireMaterial || !contributions.materialReady))
                throw new RpcError('not_implemented', 'The source material contribution is not implemented in the TypeScript apply runtime');
            // §22.4.7 (SL-47): a move into a scene not yet read may land on its index text when the host asks (`_land_on_index`).
            const moves = new Map<unknown, {effect: number; land: boolean}>();
            for (const [index, effect] of effects.entries()) if (isJsonObject(effect) && (effect.kind === 'move'||effect.kind==='place'&&effect.action==='move') && typeof effect.to === 'string') {
                const node = graph.find(effect.to, ['scene']);
                moves.set(node?.node_id ?? effect.to, { effect: index, land: effect._land_on_index === true });
            }
            const entered = new Set(array(transaction.world.index_scenes).filter((value): value is string => typeof value === 'string'));
            // §177.3: a newcomer (`walk_on: true`) may not take, or carry, a name of anyone the book names -- read or not, told or
            // not -- nor the word this table calls one of them. Asked before the material gate, which would otherwise read a
            // newcomer's borrowed name as the book's person waiting to be read. A word that is already one of this table's own
            // people is theirs (`personOfEffect`), and a book person's word keeps its own refusal there.
            for (const [index, effect] of effects.entries()) {
                if (!isJsonObject(effect) || effect.kind !== 'npc' || effect.walk_on !== true || typeof effect.name !== 'string') continue;
                let existing: Row | null = null;
                try { existing = personNode(graph, transaction.world, effect.name); } catch { existing = null; }
                if (existing) continue;
                // A host-vouched full source name or exact unread cast identity uses the existing source entrance.
                if (effect.creature == null && (passageOf(effect, effect.name) || castPersonNamed(graph, transaction.world, effect.name))) {
                    effect.walk_on = false;
                    continue;
                }
                const refusal = newcomerRefusal(graph, transaction.world, effect.name);
                if (refusal) throw atIndex(new RpcError('invalid_params', refusal.message, { fix: refusal.fix, details: { field: 'npc.name', reason: 'book_name', query: effect.name } }), index);
            }
            // §22.4.7.1 (SL-56): an `npc` effect's name stands in a person's seat; the host may ask to land it on the book's text.
            const people = new Set(seated.flatMap((effect, index) => effect.kind === 'npc' ? [names[index]] : []));
            const textPeople = new Set(array(transaction.world.index_people).filter((value): value is string => typeof value === 'string'));
            let textLanded: TextLanding[] = [];
            if (contributions.requireMaterial)
                textLanded = (await contributions.requireMaterial(graph, names, { sceneUse: 'play', moves, entered, people, textPeople, land: landRequests(params._land_on_text),
                    cast: name => castPersonNamed(graph, transaction.world, name) })) ?? [];
            else if (playsFromReading(module.meta))
                throw new RpcError('not_implemented', 'The source material gate is not implemented in the TypeScript apply runtime');
            const indexLanded = textLanded.filter(entry => entry.kind === 'scene');
            if (!Object.hasOwn(transaction.world, 'scene_trail')) {
                const repaired = await writer.transaction(params, { preload: false });
                Object.assign(transaction.world, repaired.world);
            }
            const staged: Row = clone(transaction.world), taken = new Set(array(turn.receipts).map(value => string(value.id)));
            const receipts: Row[] = [], events: DomainEvent[] = [], ids: string[] = [], eventNotLanded:RpcError[]=[];
            const effectReceipts = new Map<number, Row[]>();
            const stagedSheets=new Map<string,Row>(),stagedNotes:Row[]=[],stagedRulings:Row[]=[],attachments:Row[]=[],mapViews:Row[]=[],already:string[]=[];
            const buffered=new StagedCampaignWriter(kernel,campaign.id),effectCampaign=buffered;
            const context: ApplyContext = { kernel, transaction:{...transaction,campaign:effectCampaign}, campaign:effectCampaign, world: staged, turn, graph, module, callId: started.callId, ordinal: started.ordinal,
                stageText:(path:string,text:string)=>buffered.stageText(path,text),
                ...(params._lean === true ? { lean: true } : {}),
                staged: () => receipts,
                mint(base) { let id = base, next = 2; while (taken.has(id))
                    id = `${base}-${next++}`; taken.add(id); return id; },
                async settlement(subject) {
                    const snapshot = new CampaignSnapshot(kernel, campaign.id);
                    snapshot.meta = await effectCampaign.readCampaign();
                    snapshot.world = staged;
                    snapshot.turn = turn;
                    snapshot.party = await effectCampaign.party() as Row[];
                    // An effect can be about someone who is not at the table (contract §66). The
                    // rules engines read a row, never a party membership, so the NPC's own numbers
                    // become the subject and an investigator stands in as the actor -- exactly the
                    // arrangement `resolveActor` already makes when an NPC acts inside a session.
                    // Before this, `selectActor` refused every name but a party member's, which is
                    // why a settled check about an NPC had nowhere to put its result.
                    // §188.4 (§87.8): a body named by this table's word is that person, read as their handle, exactly as the
                    // resolve entrance reads a seat: the graph's actor and an investigator answer first, and a word two people
                    // carry is refused before anything is rolled.
                    if (typeof subject === 'string' && subject.trim())
                        subject = readCalledPeople(snapshot.party, graph, staged, { target: subject }).target;
                    // §180.6 (CK-F2): a body whose block lacks what its hit points are read from is refused with its completion.
                    if (typeof subject === 'string' && snapshot.party.length)
                        await requirePatientBlock(kernel, graph, staged, subject);
                    const patient = typeof subject === 'string' && snapshot.party.length ? npcPatient(graph, staged, subject) : null;
                    const sheet = patient ? snapshot.party[0] : selectActor(snapshot.party, subject);
                    const settlement = new SettleContext(kernel, { ...transaction, campaign:effectCampaign,world: staged }, snapshot, module, tables, await CheckArithmetic.create(tables), await RuleObservations.load(kernel), started.callId, started.ordinal, sheet, patient ?? sheet, {});
                    settlement.mint = base => context.mint(base);
                    return settlement;
                }
            };
            let timeEffects = 0, restMinutes = 0;
            const refused: { index: number; error: RpcError }[] = [];
            let stagedWorldline:Row|null=null;
            // §22.4.7.1 (SL-56): the people this batch names that landed on the book's text, registered before their effects stage.
            const personText = landPeople(context, textLanded);
            // §158.5: an effect may land a row the post review found owed; the ledger is read only when one names a row.
            const owedLedger = effects.some(effect => isJsonObject(effect) && effect.owed !== undefined) ? await readOwed(kernel, campaign.id) : null;
            const owedUsed = new Set<string>();
            // §218.3: a move that names a road row takes that row's usual minutes; the rows are read only when one does.
            const travelRows = effects.some(effect => isJsonObject(effect) && (effect.kind==='move'||effect.kind==='place') && effect.travel_band != null) ? (await owedBands(kernel)).travelMinutes : null;
            for (const [index, given] of effects.entries()) {
                try {
                    if (!isJsonObject(given) || typeof given.kind !== 'string')
                        throw new RpcError('invalid_params', 'each effect needs a string kind');
                    const kind = given.kind;
                    if (!KINDS.includes(kind))
                        unsupported('kind', kind, KINDS, `unknown effect kind ${repr(kind)}`);
                    // Contract §136.22: `stated` takes the amount from the book; §138: `band` rolls it inside a rules row;
                    // §145.1: `until` names the moment a time effect runs to. Without any of them the amount is the Keeper's.
                    const owedRow = owedLedger ? await owedRowFor(campaign, graph, staged, owedLedger, given) : null;
                    if (owedRow && owedUsed.has(string(owedRow.name)))
                        throw new RpcError('invalid_params', `owed row ${string(owedRow.name)} is landed once`, {
                            fix: 'Keep owed on one effect of the batch; the row is landed by that one.', details: { field: 'owed', reason: 'owed_repeated', owed: owedRow.name } });
                    if (owedRow) owedUsed.add(string(owedRow.name));
                    const bound: StatedEffect = await bindBand(context, bindStated(context, bindUntil(context, given))), effect = bound.effect, amounts = ['damage', 'time', 'threat', 'flag', 'cash'].includes(kind);
                    if(['fork','switch','merge'].includes(kind)){
                        const moved=await contributions.worldlines!.stage(campaign,graph,staged,effect,turn,index,effects.length,context.mint,started.callId);
                        receipts.push(moved.receipt);ids.push(moved.receipt.id);taken.add(moved.receipt.id);stagedWorldline=moved.plan;continue;
                    }
                    if (kind === 'damage') {
                        const result = await contributions.resources!.damage(context, effect);
                        for (const minted of result.receipts)
                            stampBasis(minted, bound);
                        receipts.push(...result.receipts);
                        ids.push(...result.receipts.map(value => string(value.id)));
                        events.push({ ...result.event, receipt: result.receipts.at(-1)?.id });
                        continue;
                    }
                    let receipt: Row, event: DomainEvent|null, carried: Awaited<ReturnType<typeof stageCarriedGoods>> = [];
                    if (kind === 'adaptation') {
                        if (!contributions.adaptation) throw new RpcError('not_implemented', 'Adaptation acceptance is unavailable');
                        ({receipt, event} = await contributions.adaptation(context, effect) as {receipt: Row; event: DomainEvent});
                    }
                    else if(kind==='place') ({receipt,event}=await contributions.mods!.locations(context,effect,travelRows));
                    else if (kind === 'move') {
                        const moved = stageMove(context, effect, travelRows);
                        receipt = moved.receipt;
                        effectReceipts.set(index,[receipt]);
                        if (!moved.event) {
                            receipts.push(receipt);
                            ids.push(string(receipt.id));
                            taken.add(string(receipt.id));
                            continue;
                        }
                        event = moved.event;
                    }
                    else if (kind === 'clock') {
                        receipt = stageClock(context, effect);
                        receipts.push(receipt);
                        ids.push(string(receipt.id));
                        taken.add(string(receipt.id));
                        continue;
                    }
                    else if (kind === 'ending')
                        ({ receipt, event } = await contributions.ending!(context, effect));
                    else if(kind==='clue'){
                        // §201.1: a told clue lands where the party stands; the owed row already proved the delivery told it.
                        const clue=await stageClue(context,effect,owedRow?.kind==='clue');receipt=clue.receipt;
                        if(!clue.event){already.push(receipt.clue);ids.push(receipt.id);continue;}event=clue.event;
                    }
                    else if(kind==='npc'){
                        ({receipt,event}=await stageNpc(context,effect));
                        if(receipt.unchanged===true){effectReceipts.set(index,[receipt]);continue;}
                    }
                    else if(kind==='scene')({receipt,event}=stageSceneActivity(context,effect) as {receipt:Row;event:DomainEvent});
                    else if(kind==='handout'){
                        ({receipt,event}=await stageHandout(context,effect,module.asset ? (_id, name) => module.asset!(name) : contributions.asset!) as {receipt:Row;event:DomainEvent});attachments.push(receipt.attachment);
                    }
                    else if(kind==='map'){
                        const mapped=await revealMap(context,effect,contributions.asset!);receipt=mapped.receipt;event=mapped.event as DomainEvent;
                        // §39.4: an update on a map already pictured has no picture to prepare.
                        if(mapped.view)mapViews.push({...mapped.view,receipt:receipt.id,label:receipt.label});
                    }
                    else if(kind==='item')({receipt,event}=await stageItem(context,effect,stagedSheets,()=>{
                        if(!contributions.weaponCatalog)throw new RpcError('not_implemented','The weapon catalog contribution is unavailable');return contributions.weaponCatalog(graph);
                    }) as {receipt:Row;event:DomainEvent});
                    else if(kind==='cash'){
                        ({receipt,event}=await stageCash(context,effect,stagedSheets) as {receipt:Row;event:DomainEvent});
                        carried=await stageCarriedGoods(context,effect,receipt,stagedSheets,()=>{
                            if(!contributions.weaponCatalog)throw new RpcError('not_implemented','The weapon catalog contribution is unavailable');return contributions.weaponCatalog(graph);
                        });
                    }
                    else if(kind==='threat')({receipt,event}=stageThreat(context,effect) as {receipt:Row;event:DomainEvent});
                    else if(kind==='flag')({receipt,event}=stageFlag(context,effect) as {receipt:Row;event:DomainEvent});
                    else if(kind==='note')({receipt,event}=await stageNote(context,effect,stagedNotes) as {receipt:Row;event:DomainEvent});
                    else if(kind==='person')({receipt,event}=await stagePerson(context,effect) as {receipt:Row;event:DomainEvent});
                    else if(kind==='ruling')({receipt,event}=await stageRuling(context,effect,stagedRulings) as {receipt:Row;event:DomainEvent});
                    else if(['define','object','ability','dossier','usage'].includes(kind))({receipt,event}=await contributions.mods!.stage(context,effect,stagedSheets));
                    else {
                        const minutes = effect.minutes;
                        if (!integer(minutes) || number(minutes) < 0)
                            throw new RpcError('invalid_params', 'minutes must be a non-negative integer');
                        const beyond = given.beyond_travel;
                        if (beyond !== undefined && typeof beyond !== 'boolean')
                            throw new RpcError('invalid_params', 'beyond_travel must be true or false', {
                                fix: 'give beyond_travel: true only when this time passes beyond the journey of a move in the same batch; otherwise leave it out',
                                details: { field: 'beyond_travel', reason: 'beyond_travel_invalid' } });
                        const [before, after] = advanceClock(staged, minutes as number | bigint), clock = staged.clock;
                        const why = typeof effect.why === 'string' ? effect.why : null;
                        timeEffects++;
                        restMinutes += number(minutes);
                        receipt = { id: `time:t${turn.turn}-c${started.ordinal}` + (timeEffects > 1 ? `-${timeEffects}` : ''), kind: 'time', call_id: started.callId, minutes, why, clock_before: before, clock_after: after,
                            // §145.1: the time the Keeper named, beside the minutes the kernel bound it to.
                            ...(effect.until != null ? { until: effect.until } : {}), ...(beyond === true ? { beyond_travel: true } : {}), at: nowIso() };
                        event = { type: 'time-advanced', data: { minutes, why, clock: clone(clock) } };
                    }
                    // §158.5: the receipt says which told state it landed, and from which delivered turn.
                    if (owedRow) Object.assign(receipt, { owed: owedRow.name, told_turn: owedRow.turn });
                    if (amounts)
                        stampBasis(receipt, bound);
                    // §142.2: an effect that is the result of what someone set out to do says whose and which.
                    if (effect.intent_ref != null && !isJsonObject(receipt.intent))
                        receipt.intent = await effectIntent(context, effect, `effects[${index}]`);
                    receipts.push(receipt);
                    effectReceipts.set(index,[receipt,...carried.map(goods=>goods.receipt)]);
                    ids.push(string(receipt.id));
                    taken.add(string(receipt.id));
                    // A pacing tick has no canonical event (12.1 is closed at twenty-four kinds); its receipt carries it.
                    if (event)
                        events.push({ ...event, receipt: receipt.id });
                    for (const goods of carried) {
                        receipts.push(goods.receipt);ids.push(string(goods.receipt.id));taken.add(string(goods.receipt.id));
                        if (goods.event) events.push({ ...goods.event, receipt: goods.receipt.id });
                    }
                    if (receipt.kind === 'move' && number(receipt.minutes) > 0) {
                        events.push({ type: 'time-advanced', data: { minutes: receipt.minutes, why: 'travel', clock: clone(staged.clock) }, receipt: receipt.id });
                    }
                }
                catch (error) {
                    if (!(error instanceof RpcError))
                        throw error;
                    // Keep going. Throwing here told the Keeper about one bad effect per round trip, so a
                    // batch with two mistakes in it cost two rounds -- and every innocent effect beside them
                    // was rolled back each time. Nothing commits after a refusal either way; the rest of the
                    // pass exists only to find the other problems worth reporting in the same breath.
                    refused.push({ index, error });
                }
            }
            // §11.5.5 (SL-59): a person named nowhere refuses only its own line, in a batch that is only about naming
            // persons. `unknown_entity` on an `npc`/`person` effect names nobody but itself -- no other effect's landing
            // depends on this one existing -- so it alone is isolable, the same shape §32.12.3 already gives an admission
            // line the reviewer never reads. This is narrower than "every refusal is isolable": a `time` effect beside a
            // refused `npc` pin (`tests/kernel/test_apply.py::test_reserved_and_unknown_effect_kinds`) is not a batch about
            // persons, and landing the clock while the pin stays refused would silently advance play past a refusal the
            // Keeper has not seen -- so the whole batch's kind, not only the refused lines', decides. A batch entirely of
            // isolable refusals still refuses (there is nothing to land alone), and one non-isolable refusal beside an
            // isolable one still refuses the whole batch.
            const isolable = (entry: { index: number; error: RpcError }): boolean => entry.error.code === 'unknown_entity'
                && entry.error.details?.field !== 'npc.to'
                && isJsonObject(effects[entry.index]) && ['npc', 'person'].includes(string((effects[entry.index] as Row).kind));
            const allPersonEffects = effects.every(effect => isJsonObject(effect) && ['npc', 'person'].includes(string((effect as Row).kind)));
            // A proven memory reference has no write authority in the note ledger. Report that
            // one foreign bookkeeping effect separately; never suppress an unknown note or a dependency.
            const wrongNoteOwner = refused.length === 1 && refused[0].error.details?.reason === 'note_reference_owner'
                && refused[0].error.details?.owner === 'memory'
                && params._fulfillments === undefined && effects.filter(effect=>isJsonObject(effect)&&effect.kind==='note').length === 1
                && isJsonObject(effects[refused[0].index]) && (effects[refused[0].index] as Row).kind === 'note'
                && (effects[refused[0].index] as Row).intent_ref == null;
            const succeeded = receipts.length > 0 || [...effectReceipts.values()].some(items=>items.some(receipt=>receipt.unchanged===true));
            const isolatedRefusals = params.event === undefined && refused.length && succeeded
                && (allPersonEffects && refused.every(isolable) || wrongNoteOwner) ? refused : [];
            if ((!refused.length || isolatedRefusals.length) && receipts.some(receipt => receipt.kind === 'move' && !receipt.renamed) && contributions.asset) {
                for (const item of await presentArrivalMaps(context, contributions.asset)) {
                    receipts.push(item.receipt);
                    ids.push(string(item.receipt.id));
                    taken.add(string(item.receipt.id));
                    events.push({ type: 'map-revealed', data: row(item.event.data), receipt: string(item.receipt.id) });
                    if (item.view) mapViews.push({...item.view,receipt:item.receipt.id,label:item.receipt.label});
                }
            }
            if (refused.length && !isolatedRefusals.length) {
                const [first] = refused;
                // The first refusal stays exactly what it was -- code, message, fix, index -- because that is
                // what the Keeper reads and what a refusal is counted by. The rest ride along, and say plainly
                // that they may be refusals only because the first effect never landed.
                throw new RpcError(first.error.code, first.error.message, {
                    fix: first.error.fix, codeDetail: first.error.codeDetail,
                    details: { index: first.index, ...first.error.details,
                        ...(refused.every(({error})=>error.code==='invalid_params')?{transaction_state:'uncommitted'}:{}), ...(refused.length > 1 ? {
                        refused: refused.map(({ index, error }) => ({ index, code: error.code, message: error.message,
                            ...(error.fix ? { fix: error.fix } : {}) })),
                        refused_note: 'every effect this batch refused; those after the first may be refused only because it did not land',
                    } : {}) },
                });
            }
            if (truth(staged.ending) && (row(staged.ending).scope ?? 'campaign') === 'campaign' && (stagedWorldline||truth(turn.worldline)))
                throw new RpcError('invalid_params', 'a campaign ending cannot share a turn with a worldline transition');
            if(params.event!==undefined){
                const snapshot=new CampaignSnapshot(kernel,campaign.id);
                snapshot.meta=await campaign.readCampaign();snapshot.turn=turn;
                const receipt=stageEvent(params.event,{graph,world:staged,party:await effectCampaign.party() as Row[],meta:snapshot.meta,
                    campaign:campaign.id,turn:number(turn.turn),id:context.mint(`${started.callId}-event`),receipts,
                    prior:array(turn.receipts),records:await snapshot.files('turns'),sources:array(params._event_sources),notLanded:eventNotLanded});
                receipts.push(receipt);ids.push(receipt.id);
                events.push({type:'semantic-event',data:{name:receipt.event.name,event:receipt.event.ref},receipt:receipt.id});
            }
            fulfillment?.attach(effectReceipts,staged);
            const recovery = contributions.resources ? await contributions.resources.recovery(context, restMinutes) : { receipts: [], events: [], recovered: [] };
            receipts.push(...recovery.receipts);
            ids.push(...recovery.receipts.map(value => string(value.id)));
            events.push(...recovery.events);
            const days = contributions.resources ? await contributions.resources.dayBoundary(context, number(row(transaction.world.clock).minutes)) : null;
            // §107.1: a map is orientation, never a door. The move has landed; the scene's map is read in the
            // background and delivered on the first turn after it is published (table.player_input).
            let arrivalMap: Row | null = null;
            if (contributions.queueArrivalMap && receipts.some(receipt => receipt.kind === 'move' && !receipt.renamed)) {
                const arrived = graph.scene(string(staged.active_scene));
                if (graph.handle(arrived) !== graph.handle(graph.scene(string(transaction.world.active_scene)))) {
                    try { arrivalMap = await contributions.queueArrivalMap(graph, arrived); }
                    catch (error) {
                        if (!(error instanceof RpcError)) throw error;
                        await appendJsonl(join(campaign.directory, 'telemetry.jsonl'), { at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), lane: 'reading', event: 'map-unavailable', turn: number(turn.turn), scene: graph.handle(arrived), detail: error.message });
                    }
                    if (arrivalMap && ['queued', 'reading'].includes(string(arrivalMap.state)))
                        staged.map_arrivals_pending = [...new Set([...array(staged.map_arrivals_pending).filter(value => typeof value === 'string'), graph.handle(arrived)])];
                }
            }
            // §257.15: a legacy scene without exhibits is read for them in the background; a failure to queue never stops the move.
            if (contributions.queueSceneExhibits && receipts.some(receipt => receipt.kind === 'move' && !receipt.renamed)) {
                const arrived = graph.scene(string(staged.active_scene));
                if (graph.handle(arrived) !== graph.handle(graph.scene(string(transaction.world.active_scene)))) {
                    try { await contributions.queueSceneExhibits(graph, arrived); }
                    catch (error) {
                        if (!(error instanceof RpcError)) throw error;
                        await appendJsonl(join(campaign.directory, 'telemetry.jsonl'), { at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), lane: 'reading', event: 'exhibits-unavailable', turn: number(turn.turn), scene: graph.handle(arrived), detail: error.message });
                    }
                }
            }
            // §22.4.7: the scenes this batch entered on their index text; the party's place passes the gate while its record is read.
            const landedHere = indexLanded.filter(entry => receipts.some(receipt => receipt.kind === 'move' && !receipt.renamed
                && graph.handle(graph.scene(string(receipt.to))) === entry.focus));
            for (const receipt of receipts) if (receipt.kind === 'move' && !receipt.renamed
                && landedHere.some(entry => entry.focus === graph.handle(graph.scene(string(receipt.to))))) receipt.material = 'index';
            if (landedHere.length)
                staged.index_scenes = [...new Set([...array(staged.index_scenes).filter(value => typeof value === 'string'), ...landedHere.map(entry => entry.focus)])];
            await commitInventorySheets(context,stagedSheets);
            // §158.5: the rows this batch landed close, and so do the rows the ledger now agrees with, whoever landed them.
            // §142.5: a person who spent their own turn of the fight on this batch's hold or intention passes it, once the
            // whole batch has landed -- a refused batch passes nothing. The writer already checked it is their turn.
            // §143.3 (spec D9): a weapon a person in the running fight drew is in their hands there too.
            await armDrawn(context, receipts);
            const passedTurns: Row[] = [];
            for (const receipt of receipts)
                if (receipt.kind === 'npc' && isJsonObject(receipt.passes_turn)) {
                    let passed = passedTurns.find(value => value.passed === receipt.handle);
                    if (!passed) {
                        passed = await passNpcTurn(await context.settlement(), string(receipt.handle));
                        passedTurns.push(passed);
                    }
                    receipt.passes_turn = { ...receipt.passes_turn, turn_of: passed.turn_of ?? null };
                }
            // §129.4: a definition that replaced a placeholder changed what instances already on a sheet read.
            if(effects.some(effect=>isJsonObject(effect)&&['object','usage'].includes(string(effect.kind)))||receipts.some(receipt=>receipt.replaced_placeholder===true))
                await contributions.mods!.projectInventory(effectCampaign as CampaignWriter,staged);
            const variations = await initializeNpcVariations(kernel, graph, staged, turn, [...array(turn.receipts), ...receipts], true, campaign.id);
            receipts.push(...variations);
            ensureNpcReferences(withTablePeople(module,staged).graph,staged);
            await buffered.commit();
            await campaign.writeWorld(staged);
            await settleOwed(kernel, campaign.id, graph, staged, receipts, nowIso(), await campaign.party());
            for(const note of stagedNotes)await appendJsonl(join(campaign.directory,'notes.jsonl'),note);
            for(const ruling of stagedRulings)await appendJsonl(join(campaign.directory,'rulings.jsonl'),ruling);
            // Contract §134.12: crossing an unsettled stated obligation's guard is information on the receipt
            // and the result, never a refusal (owner ruling Q5). The guards are the scene the batch started in.
            const guards = openGuards(graph, staged, activeScene(graph, transaction.world));
            let crossed: string | null = null;
            for (const receipt of receipts) {
                const [map, name, kinds] = receipt.kind === 'clue' ? [guards.clues, receipt.clue, ['clue']] : receipt.kind === 'move' && !receipt.renamed ? [guards.exits, receipt.to, ['scene']]
                    : receipt.kind === 'person' && receipt.is_investigator !== true ? [guards.people, receipt.who, ['npc']] : receipt.kind === 'npc' ? [guards.people, receipt.handle, ['npc']] : [null, null, []];
                const node = map && map.size && typeof name === 'string' ? graph.find(name, kinds) : null, guard = node ? map!.get(string(node.node_id)) : undefined;
                if (guard) {
                    receipt.obligation_open = guard;
                    crossed ??= guard;
                }
            }
            const material = module.material(graph.scene(staged.active_scene).node_id);
            const ordinaryReceipts = receipts.filter(receipt => !isNpcVariationRoll(receipt));
            for(const receipt of receipts)if(receipt.kind==='event')receipt.event.effects=ordinaryReceipts.filter(item=>item!==receipt).map(item=>item.id);
            const result: Row = { receipts: ids, markers: markersOf({ ...turn, receipts: [...array(turn.receipts).filter(receipt=>!isNpcVariationRoll(receipt)), ...ordinaryReceipts] }, ordinaryReceipts), world: { active_scene: staged.active_scene, clock: staged.clock }, material_ready: material === 'ready', material };
            const owedSettlements=receipts.filter(receipt=>typeof receipt.owed==='string');
            if(owedSettlements.length)result._owed_settlements=owedSettlements.map(({id,owed,told_turn})=>({id,owed,told_turn}));
            // These are execution results, including no-op assignments, not copies of proposals.
            result.outcomes=[...effectReceipts].flatMap(([index,landed])=>operationOutcomes(landed,graph,staged).map(outcome=>({index,...outcome})));
            if(params.event!==undefined)result.outcome=graph.shownIds(eventOutcome([...array(turn.receipts),...receipts]));
            const pendingNames = receipts.filter(receipt => receipt.kind === 'person' && typeof receipt.deferred_name === 'string');
            if (pendingNames.length) result.names_pending_delivery = pendingNames.map(receipt => ({
                who: receipt.name, name: receipt.deferred_name, ...(receipt.deferred_address != null ? { address: receipt.deferred_address } : {}) }));
            const paidCash=receipts.filter(receipt=>receipt.kind==='cash'&&receipt.settlement!=='quote');
            if(paidCash.length)result._cash_settlements=paidCash;
            const cashQuotes=receipts.filter(receipt=>receipt.kind==='cash'&&receipt.settlement==='quote');
            if(cashQuotes.length)result.cash_quotes=cashQuotes.map(receipt=>({quote:receipt.quote,purchase_amount:receipt.purchase_amount,items:receipt.items,currency:receipt.currency,category:receipt.category,with:receipt.with_label,purpose:receipt.why}));
            // §11.5.5 (SL-59): the lines this batch could not land alone, beside the ones that did (line-level, §32.12.3's shape).
            if (isolatedRefusals.length) result.not_landed = isolatedRefusals.map(({ index, error }) => ({ index, code: error.code, message: error.message,
                ...(error.fix ? { fix: error.fix } : {}), ...(error.details ? { details: error.details } : {}) }));
            if(eventNotLanded.length)result.not_landed=[...array(result.not_landed),...eventNotLanded.map(error=>({code:error.code,message:error.message,
                ...(error.fix?{fix:error.fix}:{}),...(error.details?{details:error.details}:{})}))];
            if (receipts.some(receipt => receipt.kind === 'move' && receipt.renamed) && !receipts.some(receipt => receipt.kind === 'move' && !receipt.renamed))
                result.location_note = `A rename changed only a display label. The actual scene remains ${graph.displayName(graph.scene(staged.active_scene))}. No arrival at a different place occurred. For an ordinary new player-chosen destination, apply move with establish:{summary} and via. Never narrate a different place as reached by a rename.`;
            if (receipts.some(receipt => receipt.kind === 'move' && !receipt.renamed)) {
                const snapshot = new CampaignSnapshot(kernel, campaign.id);
                snapshot.meta = await campaign.readCampaign();
                snapshot.world = staged;
                snapshot.turn = { ...turn, state: 'acting', receipts: [...array(turn.receipts), ...receipts] };
                await snapshot.preload();
                Object.assign(result, await sceneView(snapshot, module));
                result.deepen_queued = contributions.queueAdjacentReading ? await contributions.queueAdjacentReading(graph, graph.scene(staged.active_scene)) : [];
                // The background map job rides the host's existing wake for queued source work.
                if (arrivalMap && truth(arrivalMap.job_id) && !array(result.deepen_queued).includes(arrivalMap.job_id))
                    result.deepen_queued = [...array(result.deepen_queued), arrivalMap.job_id];
            }
            if (landedHere.length)
                result.scene_text = landedHere.map(entry => ({ scene: entry.focus, pages: entry.pages }));
            if (personText.length)
                result.person_text = personText;
            if (crossed)
                result.obligation_open = crossed;
            // §198.1: a walk_on on someone this table already has was read as their arrival; the Keeper is told so, by the word
            // this table calls them, once per batch.
            const walkedOn = [...effectReceipts].flatMap(([index, landed]) => landed.filter(receipt => isJsonObject(receipt.walk_on_read)).map(receipt =>
                ({ index, name: string(row(effects[index]).name), person: string(row(receipt.walk_on_read).person), read_as: string(row(receipt.walk_on_read).read_as) })));
            if (walkedOn.length) {
                result.walk_on_read = walkedOn;
                result.walk_on_note = walkedOn.map(entry => `${entry.person} is someone this table already has, so walk_on was read as `
                    + (entry.read_as === 'arrival' ? 'their arrival' : 'naming them')).join('; ')
                    + '. walk_on brings in someone this table does not have yet; leave it out for anyone it already has.';
            }
            // §218.3: a journey no road has timed moved the clock by nothing; the Keeper is told which, once per batch.
            const untimed = receipts.filter(receipt => receipt.kind === 'move' && string(row(receipt.travel).basis) === 'unknown');
            if (untimed.length)
                result.travel_note = `No road has a length yet for the journey to ${untimed.map(receipt => repr(receipt.to_label || receipt.to)).join(', ')}, so the clock did not move for it. `
                    + 'On a move along a way no road times, give travel_minutes or travel_band (adjacent, local_travel, long_travel); the road then keeps that length.';
            if (passedTurns.length)
                result.turn_passed = passedTurns;
            if (recovery.recovered.length)
                result.recovered = recovery.recovered;
            if (days)
                result.day_ended = days;
            if(attachments.length){
                result.attachments=attachments.filter(truth);result.attachment=result.attachments[0]??null;
                const missing=array(result.attachments).filter(value=>!truth(value.available)).map(value=>string(value.handout));
                if(missing.length)result.note=`No card exists for ${missing.join(', ')}: the receipt landed, and the player has nothing to look at. Say what the document holds in your narration rather than handing it over.`;
            }
            if(mapViews.length)result.map_views=mapViews;
            if(already.length){result.already_discovered=already;if(!receipts.length)result.replayed=true;}
            if(stagedWorldline){turn.worldline=stagedWorldline;result.worldline={operation:stagedWorldline.operation,line:stagedWorldline.line,mode:stagedWorldline.mode??null,loop:number(stagedWorldline.loop),when:"after this turn's publication commits"};}
            if (beforeTaskRevision !== undefined) {
                const meta = await campaign.readCampaign(), worldline = string(meta.active_worldline || 'main');
                result._task_advance = { campaign: campaign.id, turn: number(turn.turn), worldline,
                    loop: number(row(row(meta.worldlines)[worldline]).loop), operationId: started.callId, receiptIds: ids,
                    before: beforeTaskRevision, after: worldRevision(staged, await campaign.party() as Row[], [...array(turn.receipts), ...receipts], turn.pending_choice),
                    task_before: beforeTaskCore, task_after: taskWorldRevision(staged, await campaign.party() as Row[], [...array(turn.receipts), ...receipts], turn.pending_choice) };
            }
            // §198.3: a batch of opening seats leaves the opening owed.
            const keepOpening = number(turn.turn) === 0 && turn.state === 'awaiting_player' && effects.every(effect => isJsonObject(effect)
                && (openingSeatShape(effect) || openingInformationShape(effect) || effect.kind === 'clock'));
            await transaction.commitResolve({ callId: started.callId, params: callParams, result, receipts, events, ...(keepOpening ? { keepOpening } : {}) });
            return result;
        } };
}
