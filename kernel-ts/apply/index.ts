/** The existing staged apply batch, with named domain contributions. */
import type { KernelContext } from '../context.js';
import type { HandlerGroup } from '../handlers.js';
import type { CampaignWritePort, DomainEvent, TurnTransaction } from '../transactions.js';
import { RpcError } from '../errors.js';
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
import { npcPatient } from '../healing/patient.js';
import { markersOf } from '../resolve/projection.js';
import { createWriteRuntime } from '../write/index.js';
import { nowIso } from '../write/store.js';
import { advanceClock, stageClock } from './clock.js';
import { stageMove } from './move.js';
import {appendJsonl} from '../fileio.js';
import {join} from 'node:path';
import {stageFlag,stageNote,stageRuling,stageThreat} from './bookkeeping.js';
import {stageClue,stageNpc,stageHandout} from './entities.js';
import {stagePerson} from './person.js';
import {presentArrivalMaps,revealMap} from '../read/maps.js';
import {stageItem,stageCash,commitInventorySheets} from './inventory.js';
import type {createWorldlineRuntime} from '../worldline/index.js';
import type {createModRuntime} from '../mods/index.js';
import type {CampaignWriter} from '../write/store.js';
import {prepareFulfillments, type FulfillmentSelection} from '../memory/fulfillment-receipt.js';
import {activeScene, openGuards} from '../read/obligations.js';
import {bindStated, stampBasis, type StatedEffect} from './stated.js';
const KINDS = ['ability', 'adaptation', 'cash', 'clock', 'clue', 'damage', 'define', 'dossier', 'ending', 'flag', 'fork', 'handout', 'item', 'map', 'merge', 'move', 'note', 'npc', 'object', 'person', 'ruling', 'switch', 'threat', 'time', 'usage'];
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
    /** §22.4.7: `gate` names the move destinations and the scenes entered on their index text; returns the moves landed on it. */
    readonly requireMaterial?: (graph: ModuleGraph, names: any[], gate?: {moves?: Map<unknown, {effect: number; land: boolean}>; entered?: ReadonlySet<string>})
        => Promise<Array<{name: string; focus: string; pages: number[]}> | void>;
    /** §107.1: queue the arrived scene's map reading in the background; never refuses the move. */
    readonly queueArrivalMap?: (graph: ModuleGraph, scene: Row) => Promise<Row>;
    readonly materialReady?: (moduleId: string, name: string) => Promise<boolean>;
    readonly queueAdjacentReading?: (graph: ModuleGraph, scene: Row) => Promise<string[]>;
    readonly asset?: (moduleId:string,name:string)=>Promise<Row|null>;
    readonly weaponCatalog?: (graph:ModuleGraph)=>Promise<Map<string,Row>>;
}
function atIndex(error: RpcError, index: number): RpcError {
    return new RpcError(error.code, error.message, { fix: error.fix, codeDetail: error.codeDetail, details: { index, ...error.details } });
}
export function createApplyHandlers(kernel: KernelContext, writer: ReturnType<typeof createWriteRuntime>, contributions: ApplyContributions = {}): HandlerGroup {
    const tables = new RuleTables(kernel);
    return { 'table.apply': async (params) => {
            const transaction = await writer.transaction(params, { repairLegacyTrail: false, preload: false }), { campaign, turn } = transaction;
            const effects = params.effects;
            const callParams = Array.isArray(effects) ? { ...params, effects: effects.map(effect => isJsonObject(effect) ? Object.fromEntries(entries(effect).filter(([key]) => !key.startsWith('_'))) : effect) } : params;
            const opening = Array.isArray(effects) && effects.length > 0 && effects.every(effect => isJsonObject(effect) && ['define', 'object', 'ability', 'usage', 'clock'].includes(string(effect.kind)));
            const started = await transaction.beginWrite('table.apply', callParams, { allowOpening: opening });
            if (started.kind === 'replay')
                return started.result;
            if (params._task_read_set !== undefined && typeof params._task_read_set !== 'boolean')
                throw new RpcError('invalid_params', '_task_read_set must be boolean');
            const beforeTaskRevision = params._task_read_set === true
                ? worldRevision(transaction.world, await campaign.party() as Row[], turn.receipts, turn.pending_choice) : undefined;
            const beforeTaskCore = params._task_read_set === true
                ? taskWorldRevision(transaction.world, await campaign.party() as Row[], turn.receipts, turn.pending_choice) : undefined;
            if (!Array.isArray(effects) || !effects.length)
                throw new RpcError('invalid_params', 'params.effects must be a non-empty list');
            if (effects.some(effect => isJsonObject(effect) && effect.kind === 'usage') && effects.some(effect => !isJsonObject(effect) || !['define','object','usage'].includes(string(effect.kind))))
                throw new RpcError('invalid_params','A usage preparation batch contains only define, object and usage; apply other actions separately');
            if (effects.some(effect => isJsonObject(effect) && effect.kind === 'adaptation') && effects.length !== 1)
                throw new RpcError('invalid_params', 'Accept an adaptation alone; ordinary effects belong to later calls');
            const available = (kind: string) => kind === 'adaptation' ? !!contributions.adaptation : ['clock','clue','npc','item','cash','flag','note','person','ruling','threat'].includes(kind) || (['define','object','ability','dossier','usage'].includes(kind)?!!contributions.mods:['fork','switch','merge'].includes(kind)?!!contributions.worldlines:['handout','map'].includes(kind)?!!contributions.asset:['time', 'damage', 'move'].includes(kind) ? !!contributions.resources : kind === 'ending' ? !!contributions.ending : false);
            // A partial backend refuses unimplemented batches before any domain draws or writes.
            for (const [index, effect] of effects.entries())
                if (isJsonObject(effect) && typeof effect.kind === 'string' && KINDS.includes(effect.kind) && !available(effect.kind))
                    throw atIndex(new RpcError('not_implemented', `effect kind ${repr(effect.kind)} has no implementation in this TypeScript kernel yet`), index);
            const module = await loadCampaignModule(kernel, string((await campaign.readCampaign()).module_id), transaction.world, campaign.id), graph = module.graph;
            const fulfillment = params._fulfillments === undefined ? undefined : await prepareFulfillments({
                kernel, campaign, world:transaction.world, turn, graph, effects:effects as Row[], bindings:params._fulfillments as unknown as FulfillmentSelection[]});
            const authored: Row = { move: 'to', clue: 'clue', npc: 'name', handout: 'name', map: 'name' };
            const kinds: Record<string, string[]> = { move: ['scene'], clue: ['clue'], npc: ['npc'], handout: ['handout', 'asset'], map: ['handout', 'asset'] };
            const names = effects.filter(isJsonObject).filter(effect => Object.hasOwn(authored, string(effect.kind))).map(effect => {
                const name = effect[authored[string(effect.kind)]];
                if (typeof name !== 'string') return name;
                const node = ['handout','map'].includes(string(effect.kind)) ? graph.find(name, ['handout']) ?? graph.find(name, ['asset']) : graph.find(name, kinds[string(effect.kind)]);
                return node?.node_id ?? name;
            });
            if (playsFromReading(module.meta) && (!contributions.requireMaterial || !contributions.materialReady))
                throw new RpcError('not_implemented', 'The source material contribution is not implemented in the TypeScript apply runtime');
            // §22.4.7 (SL-47): a move into a scene not yet read may land on its index text when the host asks (`_land_on_index`).
            const moves = new Map<unknown, {effect: number; land: boolean}>();
            for (const [index, effect] of effects.entries()) if (isJsonObject(effect) && effect.kind === 'move' && typeof effect.to === 'string') {
                const node = graph.find(effect.to, ['scene']);
                moves.set(node?.node_id ?? effect.to, { effect: index, land: effect._land_on_index === true });
            }
            const entered = new Set(array(transaction.world.index_scenes).filter((value): value is string => typeof value === 'string'));
            let indexLanded: Array<{name: string; focus: string; pages: number[]}> = [];
            if (contributions.requireMaterial)
                indexLanded = (await contributions.requireMaterial(graph, names, { moves, entered })) ?? [];
            else if (playsFromReading(module.meta))
                throw new RpcError('not_implemented', 'The source material gate is not implemented in the TypeScript apply runtime');
            if (!Object.hasOwn(transaction.world, 'scene_trail')) {
                const repaired = await writer.transaction(params, { preload: false });
                Object.assign(transaction.world, repaired.world);
            }
            const staged: Row = clone(transaction.world), taken = new Set(array(turn.receipts).map(value => string(value.id)));
            const receipts: Row[] = [], events: DomainEvent[] = [], ids: string[] = [];
            const effectReceipts = new Map<number, Row[]>();
            const stagedSheets=new Map<string,Row>(),stagedNotes:Row[]=[],stagedRulings:Row[]=[],attachments:Row[]=[],mapViews:Row[]=[],already:string[]=[];
            const context: ApplyContext = { kernel, transaction, campaign, world: staged, turn, graph, module, callId: started.callId, ordinal: started.ordinal,
                staged: () => receipts,
                mint(base) { let id = base, next = 2; while (taken.has(id))
                    id = `${base}-${next++}`; taken.add(id); return id; },
                async settlement(subject) {
                    const snapshot = new CampaignSnapshot(kernel, campaign.id);
                    snapshot.meta = await campaign.readCampaign();
                    snapshot.world = staged;
                    snapshot.turn = turn;
                    snapshot.party = await campaign.party() as Row[];
                    // An effect can be about someone who is not at the table (contract §66). The
                    // rules engines read a row, never a party membership, so the NPC's own numbers
                    // become the subject and an investigator stands in as the actor -- exactly the
                    // arrangement `resolveActor` already makes when an NPC acts inside a session.
                    // Before this, `selectActor` refused every name but a party member's, which is
                    // why a settled check about an NPC had nowhere to put its result.
                    const patient = typeof subject === 'string' && snapshot.party.length ? npcPatient(graph, staged, subject) : null;
                    const sheet = patient ? snapshot.party[0] : selectActor(snapshot.party, subject);
                    return new SettleContext(kernel, { ...transaction, world: staged }, snapshot, module, tables, await CheckArithmetic.create(tables), await RuleObservations.load(kernel), started.callId, started.ordinal, sheet, patient ?? sheet, {});
                }
            };
            let timeEffects = 0, restMinutes = 0;
            const refused: { index: number; error: RpcError }[] = [];
            let stagedWorldline:Row|null=null;
            for (const [index, given] of effects.entries()) {
                try {
                    if (!isJsonObject(given) || typeof given.kind !== 'string')
                        throw new RpcError('invalid_params', 'each effect needs a string kind');
                    const kind = given.kind;
                    if (!KINDS.includes(kind))
                        unsupported('kind', kind, KINDS, `unknown effect kind ${repr(kind)}`);
                    // Contract §136.22: `stated` takes the amount from the book; without it the amount is the Keeper's.
                    const bound: StatedEffect = bindStated(context, given), effect = bound.effect, amounts = ['damage', 'time', 'threat', 'flag', 'cash'].includes(kind);
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
                    let receipt: Row, event: DomainEvent;
                    if (kind === 'adaptation') {
                        if (!contributions.adaptation) throw new RpcError('not_implemented', 'Adaptation acceptance is unavailable');
                        ({receipt, event} = await contributions.adaptation(context, effect) as {receipt: Row; event: DomainEvent});
                    }
                    else if (kind === 'move') {
                        const moved = stageMove(context, effect);
                        receipt = moved.receipt;
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
                        const clue=await stageClue(context,effect);receipt=clue.receipt;
                        if(!clue.event){already.push(receipt.clue);ids.push(receipt.id);continue;}event=clue.event;
                    }
                    else if(kind==='npc')({receipt,event}=await stageNpc(context,effect) as {receipt:Row;event:DomainEvent});
                    else if(kind==='handout'){
                        ({receipt,event}=await stageHandout(context,effect,module.asset ? (_id, name) => module.asset!(name) : contributions.asset!) as {receipt:Row;event:DomainEvent});attachments.push(receipt.attachment);
                    }
                    else if(kind==='map'){
                        const mapped=await revealMap(context,effect,contributions.asset!);receipt=mapped.receipt;event=mapped.event as DomainEvent;mapViews.push({...mapped.view,receipt:receipt.id,label:receipt.label});
                    }
                    else if(kind==='item')({receipt,event}=await stageItem(context,effect,stagedSheets,()=>{
                        if(!contributions.weaponCatalog)throw new RpcError('not_implemented','The weapon catalog contribution is unavailable');return contributions.weaponCatalog(graph);
                    }) as {receipt:Row;event:DomainEvent});
                    else if(kind==='cash')({receipt,event}=await stageCash(context,effect,stagedSheets) as {receipt:Row;event:DomainEvent});
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
                        const [before, after] = advanceClock(staged, minutes as number | bigint), clock = staged.clock;
                        const why = typeof effect.why === 'string' ? effect.why : null;
                        timeEffects++;
                        restMinutes += number(minutes);
                        receipt = { id: `time:t${turn.turn}-c${started.ordinal}` + (timeEffects > 1 ? `-${timeEffects}` : ''), kind: 'time', call_id: started.callId, minutes, why, clock_before: before, clock_after: after, at: nowIso() };
                        event = { type: 'time-advanced', data: { minutes, why, clock: clone(clock) } };
                    }
                    if (amounts)
                        stampBasis(receipt, bound);
                    receipts.push(receipt);
                    effectReceipts.set(index,[receipt]);
                    ids.push(string(receipt.id));
                    taken.add(string(receipt.id));
                    // A pacing tick has no canonical event (12.1 is closed at twenty-four kinds); its receipt carries it.
                    if (event)
                        events.push({ ...event, receipt: receipt.id });
                    if (kind === 'move' && number(receipt.minutes) > 0)
                        events.push({ type: 'time-advanced', data: { minutes: receipt.minutes, why: 'travel', clock: clone(staged.clock) }, receipt: receipt.id });
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
            if (!refused.length && receipts.some(receipt => receipt.kind === 'move' && !receipt.renamed) && contributions.asset) {
                for (const item of await presentArrivalMaps(context, contributions.asset)) {
                    receipts.push(item.receipt);
                    ids.push(string(item.receipt.id));
                    taken.add(string(item.receipt.id));
                    events.push({ type: 'map-revealed', data: row(item.event.data), receipt: string(item.receipt.id) });
                    mapViews.push({...item.view,receipt:item.receipt.id,label:item.receipt.label});
                }
            }
            if (refused.length) {
                const [first] = refused;
                // The first refusal stays exactly what it was -- code, message, fix, index -- because that is
                // what the Keeper reads and what a refusal is counted by. The rest ride along, and say plainly
                // that they may be refusals only because the first effect never landed.
                throw new RpcError(first.error.code, first.error.message, {
                    fix: first.error.fix, codeDetail: first.error.codeDetail,
                    details: { index: first.index, ...first.error.details, ...(refused.length > 1 ? {
                        refused: refused.map(({ index, error }) => ({ index, code: error.code, message: error.message,
                            ...(error.fix ? { fix: error.fix } : {}) })),
                        refused_note: 'every effect this batch refused; those after the first may be refused only because it did not land',
                    } : {}) },
                });
            }
            if (truth(staged.ending) && (row(staged.ending).scope ?? 'campaign') === 'campaign' && (stagedWorldline||truth(turn.worldline)))
                throw new RpcError('invalid_params', 'a campaign ending cannot share a turn with a worldline transition');
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
            // §22.4.7: the scenes this batch entered on their index text; the party's place passes the gate while its record is read.
            const landedHere = indexLanded.filter(entry => receipts.some(receipt => receipt.kind === 'move' && !receipt.renamed
                && graph.handle(graph.scene(string(receipt.to))) === entry.focus));
            for (const receipt of receipts) if (receipt.kind === 'move' && !receipt.renamed
                && landedHere.some(entry => entry.focus === graph.handle(graph.scene(string(receipt.to))))) receipt.material = 'index';
            if (landedHere.length)
                staged.index_scenes = [...new Set([...array(staged.index_scenes).filter(value => typeof value === 'string'), ...landedHere.map(entry => entry.focus)])];
            await commitInventorySheets(context,stagedSheets);
            await campaign.writeWorld(staged);
            // §129.4: a definition that replaced a placeholder changed what instances already on a sheet read.
            if(effects.some(effect=>isJsonObject(effect)&&['object','usage'].includes(string(effect.kind)))||receipts.some(receipt=>receipt.replaced_placeholder===true))
                await contributions.mods!.projectInventory(campaign as CampaignWriter,staged);
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
            const result: Row = { receipts: ids, markers: markersOf({ ...turn, receipts: [...array(turn.receipts), ...receipts] }, receipts), world: { active_scene: staged.active_scene, clock: staged.clock }, material_ready: material === 'ready', material };
            if (receipts.some(receipt => receipt.kind === 'move' && receipt.renamed) && !receipts.some(receipt => receipt.kind === 'move' && !receipt.renamed))
                result.location_note = `A rename changed only a display label. The actual scene remains ${graph.displayName(graph.scene(staged.active_scene))}. No arrival at a different place occurred. A player-chosen new destination needs lookup kind adaptation, prepare; accept the ready proposal, then apply move. Never narrate a different place as reached by a rename.`;
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
            if (crossed)
                result.obligation_open = crossed;
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
            if(stagedWorldline){turn.worldline=stagedWorldline;result.worldline={operation:stagedWorldline.operation,line:stagedWorldline.line,mode:stagedWorldline.mode??null,loop:number(stagedWorldline.loop),when:"after this turn's narrate commits"};}
            if (beforeTaskRevision !== undefined) {
                const meta = await campaign.readCampaign(), worldline = string(meta.active_worldline || 'main');
                result._task_advance = { campaign: campaign.id, turn: number(turn.turn), worldline,
                    loop: number(row(row(meta.worldlines)[worldline]).loop), operationId: started.callId, receiptIds: ids,
                    before: beforeTaskRevision, after: worldRevision(staged, await campaign.party() as Row[], [...array(turn.receipts), ...receipts], turn.pending_choice),
                    task_before: beforeTaskCore, task_after: taskWorldRevision(staged, await campaign.party() as Row[], [...array(turn.receipts), ...receipts], turn.pending_choice) };
            }
            await transaction.commitResolve({ callId: started.callId, params: callParams, result, receipts, events });
            return result;
        } };
}
