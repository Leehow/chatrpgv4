/** The existing staged apply batch, with named domain contributions. */
import type { KernelContext } from '../context.js';
import type { HandlerGroup } from '../handlers.js';
import type { CampaignWritePort, DomainEvent, TurnTransaction } from '../transactions.js';
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { CampaignSnapshot, loadModule, type LoadedModule } from '../read/campaign.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { actor as selectActor, sceneView, unsupported } from '../read/handlers.js';
import { array, clone, entries, integer, number, repr, row, string, truth, type Row } from '../read/values.js';
import { RuleTables } from '../rules/tables.js';
import { RuleObservations } from '../read/rule-facts.js';
import { CheckArithmetic } from '../resolve/arithmetic.js';
import { SettleContext } from '../resolve/context.js';
import { markersOf } from '../resolve/projection.js';
import { createWriteRuntime } from '../write/index.js';
import { nowIso } from '../write/store.js';
import { advanceClock } from './clock.js';
import { stageMove } from './move.js';
import {appendJsonl} from '../fileio.js';
import {join} from 'node:path';
import {stageFlag,stageNote,stageRuling} from './bookkeeping.js';
import {stageClue,stageNpc,stageHandout} from './entities.js';
import {stageItem,stageCash,commitInventorySheets} from './inventory.js';
import type {createWorldlineRuntime} from '../worldline/index.js';
import type {createModRuntime} from '../mods/index.js';
import type {CampaignWriter} from '../write/store.js';
const KINDS = ['ability', 'cash', 'clue', 'damage', 'define', 'ending', 'flag', 'fork', 'handout', 'item', 'merge', 'move', 'note', 'npc', 'object', 'ruling', 'switch', 'time'];
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
    readonly worldlines?: ReturnType<typeof createWorldlineRuntime>;
    readonly mods?: ReturnType<ReturnType<typeof createModRuntime>['apply']>;
    readonly resources?: ApplyResources;
    readonly ending?: (context: ApplyContext, effect: Row) => Promise<{
        receipt: Row;
        event: DomainEvent;
    }>;
    readonly requireMaterial?: (graph: ModuleGraph, names: any[]) => Promise<void>;
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
            const opening = Array.isArray(effects) && effects.length > 0 && effects.every(effect => isJsonObject(effect) && ['define', 'object', 'ability'].includes(string(effect.kind)));
            const started = await transaction.beginWrite('table.apply', callParams, { allowOpening: opening });
            if (started.kind === 'replay')
                return started.result;
            if (!Array.isArray(effects) || !effects.length)
                throw new RpcError('invalid_params', 'params.effects must be a non-empty list');
            const available = (kind: string) => ['clue','npc','item','cash','flag','note','ruling'].includes(kind) || (['define','object','ability'].includes(kind)?!!contributions.mods:['fork','switch','merge'].includes(kind)?!!contributions.worldlines:kind==='handout'?!!contributions.asset:['time', 'damage', 'move'].includes(kind) ? !!contributions.resources : kind === 'ending' ? !!contributions.ending : false);
            // A partial backend refuses unimplemented batches before any domain draws or writes.
            for (const [index, effect] of effects.entries())
                if (isJsonObject(effect) && typeof effect.kind === 'string' && KINDS.includes(effect.kind) && !available(effect.kind))
                    throw atIndex(new RpcError('not_implemented', `effect kind ${repr(effect.kind)} has no implementation in this TypeScript kernel yet`), index);
            const module = await loadModule(kernel, string((await campaign.readCampaign()).module_id)), graph = module.graph;
            const authored: Row = { move: 'to', clue: 'clue', npc: 'name', handout: 'name' };
            const names = effects.filter(isJsonObject).filter(effect => Object.hasOwn(authored, string(effect.kind))).map(effect => effect[authored[string(effect.kind)]]);
            if (truth(module.meta.reading_version) && (!contributions.requireMaterial || !contributions.materialReady))
                throw new RpcError('not_implemented', 'The source material contribution is not implemented in the TypeScript apply runtime');
            if (contributions.requireMaterial)
                await contributions.requireMaterial(graph, names);
            else if (truth(module.meta.reading_version))
                throw new RpcError('not_implemented', 'The source material gate is not implemented in the TypeScript apply runtime');
            if (!Object.hasOwn(transaction.world, 'scene_trail')) {
                const repaired = await writer.transaction(params, { preload: false });
                Object.assign(transaction.world, repaired.world);
            }
            const staged: Row = clone(transaction.world), taken = new Set(array(turn.receipts).map(value => string(value.id)));
            const receipts: Row[] = [], events: DomainEvent[] = [], ids: string[] = [];
            const stagedSheets=new Map<string,Row>(),stagedNotes:Row[]=[],stagedRulings:Row[]=[],attachments:Row[]=[],already:string[]=[];
            const context: ApplyContext = { kernel, transaction, campaign, world: staged, turn, graph, module, callId: started.callId, ordinal: started.ordinal,
                mint(base) { let id = base, next = 2; while (taken.has(id))
                    id = `${base}-${next++}`; taken.add(id); return id; },
                async settlement(subject) {
                    const snapshot = new CampaignSnapshot(kernel, campaign.id);
                    snapshot.meta = await campaign.readCampaign();
                    snapshot.world = staged;
                    snapshot.turn = turn;
                    snapshot.party = await campaign.party() as Row[];
                    const sheet = selectActor(snapshot.party, subject);
                    return new SettleContext(kernel, { ...transaction, world: staged }, snapshot, module, tables, await CheckArithmetic.create(tables), await RuleObservations.load(kernel), started.callId, started.ordinal, sheet, sheet, {});
                }
            };
            let timeEffects = 0, restMinutes = 0;
            let stagedWorldline:Row|null=null;
            for (const [index, effect] of effects.entries()) {
                try {
                    if (!isJsonObject(effect) || typeof effect.kind !== 'string')
                        throw new RpcError('invalid_params', 'each effect needs a string kind');
                    const kind = effect.kind;
                    if (!KINDS.includes(kind))
                        unsupported('kind', kind, KINDS, `unknown effect kind ${repr(kind)}`);
                    if(['fork','switch','merge'].includes(kind)){
                        const moved=await contributions.worldlines!.stage(campaign,graph,staged,effect,turn,index,effects.length,context.mint,started.callId);
                        receipts.push(moved.receipt);ids.push(moved.receipt.id);taken.add(moved.receipt.id);stagedWorldline=moved.plan;continue;
                    }
                    if (kind === 'damage') {
                        const result = await contributions.resources!.damage(context, effect);
                        receipts.push(...result.receipts);
                        ids.push(...result.receipts.map(value => string(value.id)));
                        events.push({ ...result.event, receipt: result.receipts.at(-1)?.id });
                        continue;
                    }
                    let receipt: Row, event: DomainEvent;
                    if (kind === 'move') {
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
                    else if (kind === 'ending')
                        ({ receipt, event } = await contributions.ending!(context, effect));
                    else if(kind==='clue'){
                        const clue=await stageClue(context,effect);receipt=clue.receipt;
                        if(!clue.event){already.push(receipt.clue);ids.push(receipt.id);continue;}event=clue.event;
                    }
                    else if(kind==='npc')({receipt,event}=await stageNpc(context,effect) as {receipt:Row;event:DomainEvent});
                    else if(kind==='handout'){
                        ({receipt,event}=await stageHandout(context,effect,contributions.asset!) as {receipt:Row;event:DomainEvent});attachments.push(receipt.attachment);
                    }
                    else if(kind==='item')({receipt,event}=await stageItem(context,effect,stagedSheets,()=>{
                        if(!contributions.weaponCatalog)throw new RpcError('not_implemented','The weapon catalog contribution is unavailable');return contributions.weaponCatalog(graph);
                    }) as {receipt:Row;event:DomainEvent});
                    else if(kind==='cash')({receipt,event}=await stageCash(context,effect,stagedSheets) as {receipt:Row;event:DomainEvent});
                    else if(kind==='flag')({receipt,event}=stageFlag(context,effect) as {receipt:Row;event:DomainEvent});
                    else if(kind==='note')({receipt,event}=await stageNote(context,effect,stagedNotes) as {receipt:Row;event:DomainEvent});
                    else if(kind==='ruling')({receipt,event}=await stageRuling(context,effect,stagedRulings) as {receipt:Row;event:DomainEvent});
                    else if(['define','object','ability'].includes(kind))({receipt,event}=await contributions.mods!.stage(context,effect,stagedSheets));
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
                    receipts.push(receipt);
                    ids.push(string(receipt.id));
                    taken.add(string(receipt.id));
                    events.push({ ...event, receipt: receipt.id });
                    if (kind === 'move' && number(receipt.minutes) > 0)
                        events.push({ type: 'time-advanced', data: { minutes: receipt.minutes, why: 'travel', clock: clone(staged.clock) }, receipt: receipt.id });
                }
                catch (error) {
                    if (error instanceof RpcError)
                        throw atIndex(error, index);
                    throw error;
                }
            }
            if (truth(staged.ending) && (row(staged.ending).scope ?? 'campaign') === 'campaign' && (stagedWorldline||truth(turn.worldline)))
                throw new RpcError('invalid_params', 'a campaign ending cannot share a turn with a worldline transition');
            const recovery = contributions.resources ? await contributions.resources.recovery(context, restMinutes) : { receipts: [], events: [], recovered: [] };
            receipts.push(...recovery.receipts);
            ids.push(...recovery.receipts.map(value => string(value.id)));
            events.push(...recovery.events);
            const days = contributions.resources ? await contributions.resources.dayBoundary(context, number(row(transaction.world.clock).minutes)) : null;
            await commitInventorySheets(context,stagedSheets);
            await campaign.writeWorld(staged);
            if(effects.some(effect=>isJsonObject(effect)&&effect.kind==='object'))await contributions.mods!.projectInventory(campaign as CampaignWriter,staged);
            for(const note of stagedNotes)await appendJsonl(join(campaign.directory,'notes.jsonl'),note);
            for(const ruling of stagedRulings)await appendJsonl(join(campaign.directory,'rulings.jsonl'),ruling);
            const material = truth(module.meta.reading_version) ? await contributions.materialReady!(graph.moduleId, graph.handle(graph.scene(staged.active_scene))) ? 'ready' : 'missing' : 'ready';
            const result: Row = { receipts: ids, markers: markersOf({ ...turn, receipts: [...array(turn.receipts), ...receipts] }, receipts), world: { active_scene: staged.active_scene, clock: staged.clock }, material_ready: material === 'ready', material };
            if (receipts.some(receipt => receipt.kind === 'move' && !receipt.renamed)) {
                const snapshot = new CampaignSnapshot(kernel, campaign.id);
                snapshot.meta = await campaign.readCampaign();
                snapshot.world = staged;
                snapshot.turn = { ...turn, state: 'acting', receipts: [...array(turn.receipts), ...receipts] };
                await snapshot.preload();
                Object.assign(result, await sceneView(snapshot, module));
                result.deepen_queued = contributions.queueAdjacentReading ? await contributions.queueAdjacentReading(graph, graph.scene(staged.active_scene)) : [];
            }
            if (recovery.recovered.length)
                result.recovered = recovery.recovered;
            if (days)
                result.day_ended = days;
            if(attachments.length){result.attachments=attachments.filter(truth);result.attachment=result.attachments[0]??null;}
            if(already.length){result.already_discovered=already;if(!receipts.length)result.replayed=true;}
            if(stagedWorldline){turn.worldline=stagedWorldline;result.worldline={operation:stagedWorldline.operation,line:stagedWorldline.line,mode:stagedWorldline.mode??null,loop:number(stagedWorldline.loop),when:"after this turn's narrate commits"};}
            await transaction.commitResolve({ callId: started.callId, params: callParams, result, receipts, events });
            return result;
        } };
}
