import { SINGLE_PASS_NARRATION } from '../runtime/narration-policy.ts';
/** Static campaign and turn handlers. Other domains contribute through named seams. */
import { mkdir, readFile, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import type { HandlerGroup, ProgressReporter } from '../handlers.js';
import type { TurnTransaction } from '../transactions.js';
import { RpcError, internalError } from '../errors.js';
import { sha256Text,isJsonObject } from '../json.js';
import { appendJsonl, fileSize, truncateFile, writeJsonAtomic } from '../fileio.js';
import { CampaignSnapshot, loadModule, loadCampaignModule, replayTrail, type LoadedModule } from '../read/campaign.js';
import { scopedModuleRoot } from '../modules/campaign-scope.js';
import { ModuleGraph, recordOf } from '../read/module-graph.js';
import { DirectorGraph, TextGraph, Ontology } from '../read/content.js';
import { RuleObservations } from '../read/rule-facts.js';
import { buildCapsule } from '../read/assemble.js';
import { contextBinding } from '../read/context.js';
import { mechanics } from '../read/mechanics.js';
import { SessionView } from '../read/session-view.js';
import { standingStates } from '../read/standing.js';
import { authoredMapWords, presentPublishedArrivalMaps } from '../read/maps.js';
import { clockSection, sceneLabel, untoldBlock, untoldRosterNames } from '../read/capsule.js';
import { SHARED_FIX, candidatesOf, joinedWritten, sharedNames, sharedNotice } from './shared-untold.js';
import { tableSnapshot, playerGlossary, unsupported, type ReadContributions } from '../read/handlers.js';
import { playLanguages, playLanguageOf, declaredPlayLanguage } from '../read/languages.js';
import { modContext, kernelGaps, readModCatalog } from '../read/mods.js';
import { array, entries, values, row, clone, number, string, truth, repr, chars, words, equal, integer, normalize, type Row } from '../read/values.js';
import { readingFocus } from '../read/table-entities.js';
import { CampaignWriter, freshTurn, nowIso, required, missingContribution, createTurnTransaction, rememberCall, turnStateError, parseCallId } from './store.js';
import { checked, commit, CommitFailed, head } from './history.js';
import { registerStarter } from './source.js';
import { playsFromReading } from '../modules/bound-source.js';
import { validateDifficulty } from '../setup/difficulty.js';
import { resolveStartScene } from '../modules/visual.js';
import { loadModuleContract, validSourceLanguage } from '../modules/contract.js';
import { defaultModPlan, preflightCampaign as validateContributions, rebuildNpcLedger, updateNpcLedger, stanceTable, writeEpisode } from './contributions.js';
import { asciiSlug, facts, publicContext, directorAdoption, offerLedger } from './text.js';
import { obligationByHandle, obligationState } from '../read/obligations.js';
import { statedHandleOf } from '../read/stated.js';
import { deliveryText, deliveryRecord, keeperReads, refusedMoves } from './delivery.js';
import { markupInProse, describeMarkup, bareWrapper, unwrap, MARKUP_STEER } from './markup.js';
import { timeGap, timeReading, timeRefusal, timeWarning } from '../read/time-reading.js';
import { speakerResolver, repeatedLine, repeatedLines } from './speech.js';
import { foldPersonWords, untoldWholeNames } from '../read/person-words.js';
import { protectedNames, tellGuard } from '../read/cast.js';
import { foldNodeHandles, handleScheme, handlesDirectory, nodeHandleMap, readHandles, rewriteCampaignFiles, rewriteHandles, type HandleMove } from '../read/node-handles.js';
import { prepareNameHistory, type NameHistory } from '../journal/name-history.js';
import { presenceRolls, type PresenceRolled } from '../mods/presence.js';
import { CheckArithmetic } from '../resolve/arithmetic.js';
import { RuleTables } from '../rules/tables.js';
import { modResolveEvents } from '../resolve/projection.js';
import { inProse, placeKey, prosePlaces, replacePlaces, untoldNamesSaid, withNames, type ProsePlace } from './names.js';
import type { SpeakerResolver } from './speech-pass.js';
import { readableTurn, rebuildTurn, syncCheckpoint, resumeView, checkpointFromRecord, writeCheckpoint } from './continuation.js';
import {activeName} from '../read/worldline.js';
import {eventOf} from '../worldline/index.js';
import type {createWorldlineRuntime} from '../worldline/index.js';
import { owedIntents } from '../npc/owed.js';
import { namedRepeats, speakerThreads } from '../npc/threads.js';
import {quotationDrafts,quotationScope,pendingQuotation,quotationRecords,discloseCashRequests} from '../runtime/quotes.js';
import {selectDocumentRequest,finishDocumentRequestTurn} from '../mods/document-requests.js';
import {bindPriceText,priceRows} from '../../shared/cash-prose.js';
export { createTurnTransaction } from './store.js';
export { CampaignWriter } from './store.js';
export { writeEpisode } from './contributions.js';
const lineSeed = (campaign: string, name: string) => sha256Text(`${campaign}:${name}:`).slice(0, 16);
const mainLine = (campaign: string): Row => ({
    name: 'main',
    kind: 'main',
    loop: 0,
    forked_from: null,
    seed: lineSeed(campaign, 'main'),
    status: 'active',
    last_turn: null,
    last_commit: null,
    created_at: nowIso()
});
/** The seed a turn's dice start from: the active line's seed and the turn. */
export function turnSeed(meta: Row, turn: number): string {
    const line = row(row(meta.worldlines)[meta.active_worldline || 'main']);
    return `${string(line.seed || lineSeed(string(meta.id || ''), meta.active_worldline || 'main'))}:${turn}`;
}
function seedTurn(context: KernelContext, meta: Row, turn: number): void {
    if (context.seedLocked)
        return;
    context.rng.seed(turnSeed(meta, turn));
}
/**
 * §178.3: the presence checks owed at a turn's start (`table.player_input`) or before the opening (`table.open`), on the
 * turn's seeded stream, recorded in `world`. The caller writes the world and the turn; `taken` keeps the ids distinct.
 */
async function meetAtTurnStart(context: KernelContext, campaign: CampaignWriter, graph: ModuleGraph, world: Row, party: Row[], turn: number,
    callId: string, taken: Set<string>, meta: Row): Promise<PresenceRolled> {
    const met = await presenceRolls({ kernel: context, graph, world, party, turn, callId, directory: campaign.directory, seed: turnSeed(meta, turn),
        arithmetic: await CheckArithmetic.create(new RuleTables(context)),
        mint(base: string) { let id = base, n = 2; while (taken.has(id)) id = `${base}-${n++}`; taken.add(id); return id; } });
    if (met.skipped.length)
        await campaign.telemetry({ lane: 'presence', event: 'skipped', turn, call: callId, skipped: met.skipped });
    return met;
}
/** The events a presence roll writes: the same as a resolved Mod check's (§178.3). */
const presenceEvents = (receipt: Row) => modResolveEvents({}, { decision: receipt.decision, family: 'mod', outcome: { kind: 'check' } }, [receipt]);
function startScene(graph: ModuleGraph): Row {
    const starts = graph.kind('scene').filter(scene => recordOf(scene).is_start === true);
    if (starts.length === 1)
        return starts[0];
    throw new RpcError('campaign_not_ready', `module ${graph.moduleId} declares ${starts.length} start scenes`, {
        fix: starts.length ? `module.opening.choose {module_id: ${repr(graph.moduleId)}, scene: <one of details.candidates>}` : 'the book declares no opening scene; read the section that holds it',
        details: {
            field: 'start_scene',
            candidates: (starts.length ? starts : graph.kind('scene')).slice(0, 20).map(scene => ({
                scene: graph.handle(scene),
                name: graph.displayName(scene)
            }))
        },
    });
}
function initialWorld(graph: ModuleGraph, chosen: string | null, deferSourcePresence=false): [
    Row,
    string
] {
    const start = chosen ? graph.scene(chosen) : startScene(graph), handle = graph.handle(start), presence: Row = {};
    // A book puts many people in more than one scene, and someone can only stand in one of them, so
    // the first scene to claim a name keeps them. The start scene goes first, because it is the one
    // scene the table is certainly in: leaving it to graph order let the opening be played to an
    // empty room. Masks lists Larkin, de Mendoza and Elias in Start: Lima, but Hotel España and the
    // Museo come earlier in the graph and took all three, so the opening dinner the prologue
    // describes had nobody in it -- `look` answered `present: []`, a first impression had no target,
    // and the opening turn cannot stage anyone because it may not change state.
    // Original-context graphs may contain conditional or later appearances. Their ordinary
    // source-presence candidates must evaluate applicability before creating campaign presence.
    for (const scene of deferSourcePresence?[]:[start, ...graph.kind('scene')])
        for (const id of graph.sceneNpcIds(scene)) {
            const npc = graph.handle(graph.nodes.get(id)!);
            if (!Object.hasOwn(presence, npc))
                presence[npc] = graph.handle(scene);
        }
    return [{
            active_scene: handle,
            visited_scenes: [handle],
            scene_trail: [],
            scene_labels: {},
            discovered_clues: [],
            map_knowledge: {},
            map_labels: {},
            flags: {},
            clock: {
                minutes: 0
            },
            npc_presence: presence
        }, handle];
}
export interface WriteContributions {
    worldlines?: ReturnType<typeof createWorldlineRuntime>;
    libraryWriteBack?(campaign: CampaignWriter, record: Row): Promise<void>;
    openingReady?(moduleId: string, focus?: string, campaign?: string): Promise<boolean>;
    sourceGraphPath?(moduleId: string, campaign?: string): Promise<string>;
    queueAdjacentReading?(graph: ModuleGraph, scene: Row): Promise<string[]>;
    requestReading?(params: Row): Promise<Row>;
    queueAheadReading?(params: Row): Promise<Row>;
    /** §107.1: the module asset reader the late first-arrival card composes its layers from. */
    asset?(moduleId: string, name: string): Promise<Row | null>;
    mods?: {
        /** `playLanguage`: the campaign's declared tag, or null (contract §153.2). */
        initializeWorld(world: Row, playLanguage?: string | null): Promise<boolean>;
        initializeCampaign(campaign: CampaignWriter, world: Row, options?: {pending?: boolean}): Promise<void>;
        validateWorld(world: Row): Promise<void>;
    };
}

/**
 * The `speech[]` rows (text order) whose say token the host wrote, not the Keeper (§128.3): a delivery
 * parameter only the host sets. Anything that is not a distinct in-range ordinal is ignored -- a hint,
 * like the token itself, never a reason to refuse.
 */
function hostAttributed(params: Row, speech: unknown): Set<number> {
    const count = array(speech).length, value = params.host_attributed;
    return new Set(Array.isArray(value) ? value.filter(index => integer(index) && number(index) >= 0 && number(index) < count).map(index => number(index)) : []);
}
/** §145.3: the kernel's telemetry row for a time gap, refused or delivered. */
function timeRow(gap: Row, turn: Row, callId: string, params: Row): Row {
    return { lane: 'delivery', turn: number(turn.turn), reason: 'time_unrecorded', call_id: callId, implicit: truth(params.implicit),
        cut: gap.cut, landed: gap.landed_minutes, floor: gap.floor, ends_at: gap.ends_at ?? null, day_part: gap.day_part };
}
/**
 * §113 D: a person does not repeat. A line the Keeper wrapped is refused before any audit, naming the
 * line and the turn it was said. A line the host wrapped (§128.3) is never refused: its repeats are
 * returned, and the delivery carries them as findings instead.
 */
/** §103.5: who is untold at this delivery, for the say token's `shown` (write/speech.ts). Table-established people never are. */
/**
 * §177.11 (owner ruling 2026-10-04): a narrate or ask whose own words say the printed name of someone the investigator has
 * not been told about is refused once a turn for those names, naming the words found (the Keeper wrote them); the name reaches
 * the prose through that person's `{{name:}}` token, when the fiction has it said. The same names a second time are
 * delivered with each replaced by the word this table calls that person, with a finding: never the name, and never a turn
 * stranded by a draft the Keeper could not repair (the host resends a refused implicit draft once, like §143.11's gates).
 */
/** §177.15: the places of `text` where it writes an untold person's printed name, outside its markers. */
async function untoldPlaces(snapshot: CampaignSnapshot, graph: ModuleGraph, text: string, speakers: SpeakerResolver): Promise<{ said: string[]; places: ProsePlace[]; guarded: string[]; journal: Row; records: NameHistory }> {
    const journal = row(await snapshot.optional('npc-journal.json'));
    const records = prepareNameHistory(await snapshot.turnRecords(), tellGuard(graph, snapshot.world, journal));
    // §188.1: the places of a name the investigator's side owns are skipped, from the list the request's rename skips
    // (`table.untold`'s `protected`): a delivery naming the investigator in full is not held for a name inside it.
    const guarded = protectedNames(graph, snapshot.world, journal, records);
    const said = untoldNamesSaid(text, speakers, graph, untoldWholeNames(graph, journal, records), guarded);
    return { said, places: said.length ? prosePlaces(text, said, guarded) : [], guarded, journal, records };
}
/** §177.15: a refusal shows a place by the words around it with the name blanked, so the request's rename has nothing to rewrite. */
function blankedPlace(text: string, place: ProsePlace, refused: readonly ProsePlace[]): string {
    // Every refused place inside the window is blanked, not only this one: on the final package's copy (2026-10-04) two
    // places within 24 characters left the other name verbatim in the refusal, which the request then renamed.
    const from = Math.max(0, place.start - 24), to = Math.min(text.length, place.end + 24);
    const inside = refused.filter(other => other.start < to && other.end > from).sort((a, b) => a.start - b.start);
    let out = '', at = from;
    for (const other of inside) {
        const start = Math.max(other.start, from), end = Math.min(other.end, to);
        if (start < at) continue;
        out += text.slice(at, start) + '\u25a2'.repeat([...text.slice(start, end)].length);
        at = end;
    }
    return (out + text.slice(at, to)).replace(/\s+/gu, ' ').trim();
}
/** §177.15: `untold_cleared` as the host sends it, the keys of the places it judged to be part of another word. */
function clearedPlaces(value: unknown): Set<string> {
    if (value === undefined) return new Set();
    if (!Array.isArray(value) || value.some(entry => typeof row(entry).name !== 'string' || !Number.isSafeInteger(row(entry).nth)))
        throw new RpcError('invalid_params', 'untold_cleared is a list of {name, nth}', { details: { field: 'untold_cleared' } });
    return new Set(value.map(entry => placeKey({ name: string(row(entry).name), nth: number(row(entry).nth) })));
}
async function untoldNamesGate(snapshot: CampaignSnapshot, campaign: CampaignWriter, turn: Row, graph: ModuleGraph, text: string,
    speakers: SpeakerResolver, callId: string, implicit: boolean, cleared: ReadonlySet<string> = new Set()): Promise<{ text: string; replaced: string[]; told?: string }> {
    const { said, places, guarded, journal, records } = await untoldPlaces(snapshot, graph, text, speakers);
    // §188.8: the roster as its builder gives it, each owner's word apart: a name several untold people share is never one
    // person's, and the joined word the request shows it by (§177.4) is nobody's name.
    const roster = untoldRosterNames(graph, snapshot.world, journal, records), shared = sharedNames(roster);
    const joined = joinedWritten(text, roster).map(entry => candidatesOf(graph, snapshot.world, journal, entry));
    if (!said.length && !joined.length) return { text, replaced: [] };
    // §177.15: a place the host judged to be part of another word is not the name (Dallas, written in Chinese, holds the station
    // owner's printed nickname). A name said only where no place stands (inside an unresolved token) is gated as before.
    const open = places.filter(place => !cleared.has(placeKey(place)));
    // A name said only where no prose stands (inside an unresolved name token) is gated as before; one inside a longer name's
    // place goes with that place.
    const left = [...new Set([...open.map(place => place.name), ...said.filter(name => !inProse(text, name, guarded))])];
    // What the told check reads (`told_text`): a cleared place blanked, so Dallas never tells the station owner's name.
    const blank = (place: ProsePlace) => cleared.has(placeKey(place)) ? '\u25a2'.repeat([...place.name].length) : undefined;
    if (!left.length && !joined.length) {
        await campaign.telemetry({ lane: 'delivery', turn: number(turn.turn), ok: true, reason: 'untold_name', outcome: 'cleared', call_id: callId, implicit,
            cleared: places.length }).catch(() => undefined);
        return { text, replaced: [], told: replacePlaces(text, places, blank) };
    }
    const key = [...left].sort().join('\n'), first = left.length > 0 && string(row(turn.untold_gate).words) !== key;
    const sharedLeft = left.flatMap(name => shared.has(name) ? [candidatesOf(graph, snapshot.world, journal, shared.get(name)!)] : []);
    // §188.8: a shared name or a joined word is held every time, never replaced: no single word stands for a name two people share.
    if (first || sharedLeft.length || joined.length) {
        if (first) await campaign.writeTurn({ ...turn, untold_gate: { words: key, call_id: callId } });
        await campaign.telemetry({ lane: 'delivery', turn: number(turn.turn), ok: false, reason: 'untold_name', outcome: 'refused', call_id: callId, implicit,
            words: left.length, cleared: places.length - open.length, ...(sharedLeft.length ? { shared: sharedLeft.length } : {}), ...(joined.length ? { joined: joined.length } : {}) }).catch(() => undefined);
        // §177.15: the refusal never quotes the name. Table 27 (turn 8): it quoted one, the request's rename turned it into the
        // station owner's word, and the Keeper was told it had written words it never wrote.
        const excerpts = open.slice(0, 3).map(place => blankedPlace(text, place, open));
        const named = left.length ? `the text says ${open.length || left.length} time(s) a name the book gives someone the investigator has not been told about`
            + (excerpts.length ? `, where \u25a2 stands: ${excerpts.map(excerpt => `"${excerpt}"`).join('; ')}` : '') : '';
        const notice = sharedNotice(sharedLeft, joined);
        throw new RpcError('invalid_params', [named, notice].filter(Boolean).join('; '), {
            fix: notice ? SHARED_FIX : 'where the fiction has that person\'s name said, write their say_name from present[] there instead; otherwise call them by the word present[] shows, and give a newcomer a word that carries nobody\'s name. Change only those words and deliver again',
            details: { reason: 'untold_name', field: 'text', places: open.length, excerpts, ...(sharedLeft.length ? { shared: sharedLeft } : {}), ...(joined.length ? { joined } : {}) },
        });
    }
    const replacements = new Map(roster.flatMap(entry => left.includes(entry.name) && entry.shown.length === 1 ? [[entry.name, entry.shown[0]!] as [string, string]] : []));
    await campaign.telemetry({ lane: 'delivery', turn: number(turn.turn), ok: true, reason: 'untold_name', outcome: 'replaced', call_id: callId, implicit,
        words: left.length, cleared: places.length - open.length }).catch(() => undefined);
    const replaced = replacePlaces(text, open, place => replacements.get(place.name));
    return { text: replaced, replaced: left, ...(open.length < places.length ? { told: replacePlaces(text, places, place => blank(place) ?? replacements.get(place.name)) } : {}) };
}
async function untoldAt(snapshot: CampaignSnapshot, graph: ModuleGraph): Promise<(node: Row) => boolean> {
    const journal = row(await snapshot.optional('npc-journal.json'));
    const records = prepareNameHistory(await snapshot.turnRecords(), tellGuard(graph, snapshot.world, journal));
    return node => !graph.isTablePerson(node) && untoldBlock(graph, snapshot.world, journal, node, records) !== null;
}
async function refuseRepeatedLine(snapshot: CampaignSnapshot, campaign: CampaignWriter, speech: unknown,
    host: ReadonlySet<number> = new Set()): Promise<Row[]> {
    const lines = array(speech);
    if (!lines.length) return [];
    const records = snapshot.records.length ? snapshot.records : await campaign.records();
    if (SINGLE_PASS_NARRATION) return repeatedLines(lines, records, 12);
    const repeat = repeatedLine(lines, records, 12, index => !host.has(index));
    if (!repeat) return host.size ? repeatedLines(lines, records, 12, index => host.has(index)) : [];
    throw new RpcError('needs', `${string(repeat.name)} already said this at this table (turn ${string(repeat.earlier_turn)}): ${string(repeat.line)}`, {
        fix: 'Say it again in fresh words: the person keeps the same position unless the fiction moved it. Rewrite only that line and deliver again; everything else stands.',
        details: { reason: 'repeated_line', ...repeat },
    });
}
/**
 * §143.24: what one person's repeated purpose is called in the refusal and the finding -- worded by the row's status and
 * turns, the row's own line quoted (never a reading of the prose).
 */
function repeatedPurpose(repeat: Row): string {
    const name = string(repeat.name), line = chars(string(repeat.intent), 200);
    const where = repeat.status === 'abandoned' ? `and gave it up on turn ${string(repeat.turn)}` : 'and it has no result';
    return `${name} already set out on turn ${string(repeat.since_turn)} to "${line}" ${where}, and this delivery has ${name} say it again`;
}
function purposeFix(repeats: Row[]): string {
    const names = [...new Set(repeats.map(repeat => string(repeat.name)))].join(', ');
    return `Render what ${names} does this turn instead, and do not have them say it again in any words. Rewrite only those lines and deliver again; `
        + 'everything else stands. What the table had them do this turn, if anything, is on the card (history.intents, by: table) and in this turn\'s receipts.';
}
export function createWriteRuntime(context: KernelContext, contributions: WriteContributions = {}): {
    handlers: HandlerGroup;
    read: ReadContributions;
    campaign(params: Row, options?: {
        requireTurn?: boolean;
        requireWorld?: boolean;
    }): Promise<CampaignWriter>;
    startSetupWorld(campaign: CampaignWriter, meta: Row): Promise<boolean>;
    setupOpeningReady(moduleId: string, focus?: string, campaign?: string): Promise<boolean>;
    requestReading(params: Row): Promise<Row>;
    queueAheadReading(params: Row): Promise<Row>;
    sourceGraphPath(moduleId: string, campaign?: string): Promise<string>;
    transaction(params: Row, options?: {
        repairLegacyTrail?: boolean;
        preload?: boolean;
    }): Promise<TurnTransaction>;
} {
    const resumes = new Map<string, Row>(), firstStyleTurn = new Map<string, number>();
    const writer = (id: string) => new CampaignWriter(context, id);
    const preflightCampaign = (meta: Row, world: Row, turn: Row, party: Row[]) => validateContributions(meta, world, turn, party, { libraryWriteBack: !!contributions.libraryWriteBack, modManagement: !!contributions.mods,worldlines:!!contributions.worldlines });
    async function validateMods(world: Row): Promise<void> {
        if(contributions.mods)await contributions.mods.validateWorld(world);
        else await defaultModPlan(context,world);
    }
    async function initializeNewWorld(world: Row, playLanguage: string): Promise<Row> {
        if(contributions.mods){await contributions.mods.initializeWorld(world,playLanguage);return world;}
        const plan=await defaultModPlan(context,world,playLanguage);await plan.install();return plan.world;
    }
    /**
     * §185.6: a name-free campaign's fold before its world is first written (`campaign.create`, or setup once the opening is
     * ready): whatever the book's `handles.json` already holds, so a book other campaigns have named starts named. `state`
     * carries `node_handles` in and out; the module is built with the folded map.
     */
    async function firstFold(moduleId: string, campaignId: string, state: Row): Promise<{ module: LoadedModule; moves: HandleMove[] }> {
        const loaded = await loadModule(context, moduleId, campaignId, nodeHandleMap(state));
        const stored = await readHandles(context, await handlesDirectory(context, campaignId, moduleId));
        const moves = foldNodeHandles(loaded.graph, state, stored);
        return { module: moves.length ? await loadModule(context, moduleId, campaignId, nodeHandleMap(state)) : loaded, moves };
    }
    /**
     * §185.6: fold the book's handles into a name-free campaign's world at a safe moment (`table.open`, `table.player_input`).
     * The interim handles the fold replaced are rewritten in `held` (what the caller keeps in memory and writes itself, the
     * world first) and in the campaign's state files (§185.6.1). Returns the module reloaded with the new map when the world
     * changed (the caller writes it), else null.
     */
    async function foldHandles(campaign: CampaignWriter, snapshot: CampaignSnapshot, module: LoadedModule, held: Row[] = []): Promise<LoadedModule | null> {
        if (!module.graph.nameFree) return null;
        const moduleId = string(snapshot.meta.module_id);
        const stored = await readHandles(context, await handlesDirectory(context, snapshot.id, moduleId));
        const moves = foldNodeHandles(module.graph, snapshot.world, stored);
        if (!moves.length) return null;
        const files = await rewriteFolded(campaign, moves, [snapshot.world, snapshot.meta, snapshot.turn, ...snapshot.party, ...held]);
        for (const [path, value] of files) if (snapshot.jsonFiles.has(path)) snapshot.jsonFiles.set(path, value);
        return loadCampaignModule(context, moduleId, snapshot.world, snapshot.id);
    }
    /**
     * §185.6.1: after a fold, each moved node's interim handle becomes its final handle in the campaign's mutable state: the
     * objects in `held`, and every state file on disk but `world.json`, which the caller writes from memory. The campaign's
     * lock is held: every writer of these files is a campaign method. Returns the files rewritten.
     */
    async function rewriteFolded(campaign: CampaignWriter, moves: HandleMove[], held: Row[]): Promise<Map<string, Row>> {
        const map = new Map(moves.map(move => [move.from, move.to]));
        for (const value of held) rewriteHandles(value, map);
        const files = await rewriteCampaignFiles(campaign.directory, map, new Set(['world.json']));
        await campaign.telemetry({ lane: 'handles', event: 'folded', mapped: moves.length, files: [...files.keys()] });
        return files;
    }
    async function openCampaign(params: Row, options: {
        requireTurn?: boolean;
        requireWorld?: boolean;
    } = {}): Promise<CampaignWriter> {
        const id = params.campaign;
        if (typeof id !== 'string' || !id)
            throw new RpcError('invalid_params', 'params.campaign is required');
        const value = writer(id);
        if (!await context.snapshots.pathExists(value.path('campaign.json')))
            throw new RpcError('campaign_not_found', `no campaign ${repr(id)}`, {
                fix: 'call campaign.list, or campaign.create',
                details: { campaigns: await context.snapshots.sortedChildNames(context.campaignsRoot, path => context.snapshots.pathExists(join(path, 'campaign.json'))) }
            });
        for (const name of [...(options.requireWorld !== false ? ['world.json'] : []), ...(options.requireTurn !== false ? ['turn.json'] : [])])
            if (!await context.snapshots.pathExists(value.path(name)))
                throw new RpcError('campaign_not_ready', `campaign ${repr(id)} is missing ${name}`);
        return value;
    }
    /** Read-only reconciliation of one host operation; no transaction, repair, or RNG. */
    async function callStatus(params: Row): Promise<Row> {
        const campaign = await openCampaign(params);
        const [callTurn, ordinal] = parseCallId(params.call_id);
        if (!Number.isSafeInteger(callTurn) || !Number.isSafeInteger(ordinal) || !isJsonObject(params.request)
            || params.request.campaign !== params.campaign || params.request.call_id !== params.call_id)
            throw new RpcError('invalid_params', 'request must be the exact campaign and call_id-bound kernel request');
        const meta = await campaign.readCampaign(), turn = await campaign.readTurn();
        const worldline = string(meta.active_worldline || 'main'), loop = number(row(row(meta.worldlines)[worldline]).loop);
        if (params.scope !== undefined && (!isJsonObject(params.scope)
            || Object.keys(params.scope).some(key => !['worldline', 'loop'].includes(key))
            || params.scope.worldline !== worldline || params.scope.loop !== loop))
            throw new RpcError('turn_state', 'The operation belongs to a different active worldline or loop', { details: { reason: 'operation_scope_stale' } });
        const result = await campaign.replay(turn, string(params.call_id), params.request);
        return { status: result ? 'settled' : 'absent', call_id: params.call_id, call_turn: callTurn,
            active_turn: turn.turn, scope: { worldline, loop }, ...(result ? { result } : {}) };
    }
    async function startSetupWorld(value: CampaignWriter, meta: Row): Promise<boolean> {
        if (await context.snapshots.pathExists(value.path('world.json')) && truth(meta.opening_scene))
            return false;
        const id = string(meta.module_id);
        const root = await scopedModuleRoot(context, value.id, id) ?? join(context.stateRoot, 'modules'), directory = join(root, id);
        const moduleMeta = await context.snapshots.pathExists(join(directory, 'module.json'))
            ? row(await context.snapshots.readJson(join(directory, 'module.json'))) : {};
        const graphPath = await sourceGraphPath(id, value.id);
        if (!await context.snapshots.pathExists(graphPath))
            return false;
        if (playsFromReading(moduleMeta)) {
            if (!await setupOpeningReady(id, meta.opening_scene || '', value.id))
                return false;
        }
        // §185.6: a name-free campaign's world is first written here when the opening was not ready at creation.
        const nameFree = handleScheme(meta) === 'name-free';
        const handles: Row = { node_handles: nameFree && await context.snapshots.pathExists(value.path('world.json')) ? row((await value.readWorld()).node_handles) : {} };
        const folded = nameFree ? await firstFold(id, value.id, handles) : { module: await loadModule(context, id, value.id, null), moves: [] };
        const module = folded.module;
        // §185.6.1: what setup stored under an interim handle (the epithet lane's words) takes the final one; meta is written below.
        if (folded.moves.length) await rewriteFolded(value, folded.moves, [meta]);
        const [world, opening] = initialWorld(module.graph, meta.opening_scene || null,!!moduleMeta.source_reference);
        if (nameFree) world.node_handles = handles.node_handles;
        await value.writeWorld(world);
        meta.opening_scene = opening;
        meta.module_digest = module.graph.digest;
        meta.module_generation = module.generation;
        await value.writeCampaign(meta);
        return true;
    }
    async function setupOpeningReady(moduleId: string, focus?: string, campaign?: string): Promise<boolean> {
        const ready = contributions.openingReady;
        return ready ? ready(moduleId, focus, campaign) : missingContribution('visual source opening');
    }
    async function queueAheadReading(params: Row): Promise<Row> {
        const ahead = contributions.queueAheadReading;
        return ahead ? ahead(params) : { queued: [] };
    }
    async function requestReading(params: Row): Promise<Row> {
        const request = contributions.requestReading;
        return request ? request(params) : missingContribution('visual source reading');
    }
    async function sourceGraphPath(moduleId: string, campaign?: string): Promise<string> {
        if (contributions.sourceGraphPath) return contributions.sourceGraphPath(moduleId, campaign);
        const root = campaign === undefined ? join(context.stateRoot, 'modules')
            : (await scopedModuleRoot(context, campaign, moduleId) ?? join(context.stateRoot, 'modules'));
        return join(root, moduleId, 'module-graph.json');
    }
    async function repairLegacyTrail(snapshot: CampaignSnapshot): Promise<void> {
        if (Object.hasOwn(snapshot.world, 'scene_trail'))
            return;
        preflightCampaign(snapshot.meta, snapshot.world, snapshot.turn, snapshot.party.length ? snapshot.party : await snapshot.files('party'));
        const world = {
            ...clone(snapshot.world),
            scene_trail: replayTrail(await snapshot.replayEvents())
        };
        await writer(snapshot.id).writeWorld(world);
        snapshot.world = world;
        snapshot.jsonFiles.set('world.json', world);
    }
    async function touchActing(snapshot: CampaignSnapshot): Promise<void> {
        if (snapshot.turn.state !== 'open')
            return;
        preflightCampaign(snapshot.meta, snapshot.world, snapshot.turn, snapshot.party.length ? snapshot.party : await snapshot.files('party'));
        const turn = {
            ...clone(snapshot.turn),
            state: 'acting'
        };
        await writer(snapshot.id).writeTurn(turn);
        snapshot.turn = turn;
        snapshot.jsonFiles.set('turn.json', turn);
    }
    async function capsule(snapshot: CampaignSnapshot, module: LoadedModule, options: {
        consume?: boolean;
        resume?: Row;
        rehydrate?: boolean;
    } = {}): Promise<Row> {
        const first = firstStyleTurn.get(snapshot.id), full = first == null || first === number(snapshot.turn.turn),
            forceFull = full || options.rehydrate === true;
        if (options.consume && first == null)
            firstStyleTurn.set(snapshot.id, number(snapshot.turn.turn));
        return buildCapsule(snapshot, module, {
            styleFull: forceFull,
            moduleBrief: forceFull,
            ...(options.resume ? {
                resume: options.resume
            } : {})
        });
    }
    const read: ReadContributions = {
        repairLegacyTrail,
        touchActing,
        capsule
    };
    async function recoverySnapshot(params: Row): Promise<CampaignSnapshot> {
        const id = params.campaign;
        if (typeof id !== 'string' || !id)
            throw new RpcError('invalid_params', 'params.campaign is required');
        const snapshot = new CampaignSnapshot(context, id), campaign = writer(id);
        if (!await context.snapshots.pathExists(campaign.path('campaign.json')))
            throw new RpcError('campaign_not_found', `no campaign ${repr(id)}`, {
                fix: 'call campaign.list, or campaign.create',
                details: {
                    campaigns: await context.snapshots.sortedChildNames(context.campaignsRoot, path => context.snapshots.pathExists(join(path, 'campaign.json')))
                },
            });
        if (!await context.snapshots.pathExists(campaign.path('world.json')))
            throw new RpcError('campaign_not_ready', `campaign ${repr(id)} is missing world.json`);
        snapshot.meta = await campaign.readCampaign();
        snapshot.world = await campaign.readWorld();
        snapshot.turn = await readableTurn(campaign) ?? {};
        snapshot.jsonFiles.set('campaign.json', snapshot.meta);
        snapshot.jsonFiles.set('world.json', snapshot.world);
        snapshot.jsonFiles.set('turn.json', snapshot.turn);
        return snapshot;
    }
    /**
     * Contract §141: narrate finalizes a turn in several file writes and then one commit. A kernel killed anywhere in
     * that window (a loaded machine's SIGTERM-to-SIGKILL grace ran out mid-shutdown) left the files saying the turn was
     * delivered, and the next `table.open` served the undelivered narrate as delivered. The rollback a failed commit
     * already does needs values only narrate had in memory, so narrate writes them here, outside the campaign's own
     * repository (`commit` stages everything inside it), before its first write, and removes them as soon as the commit
     * returns or the rollback is done.
     */
    const narrateJournalPath = (campaign: string) => join(context.stateRoot, 'narrate-journal', `${campaign}.json`);
    async function clearNarrateJournal(campaign: string): Promise<void> {
        await rm(narrateJournalPath(campaign), { force: true });
    }
    /**
     * Undo narrate's finalizing writes, exactly as a failed commit does. The NPC ledger is one of them (§141.1):
     * `foldNpcTurn` appends each interaction and adds each stance delta, so a resent narrate folded the same turn a
     * second time when the ledger was left as the rolled-back narrate had written it.
     */
    async function rollBackNarrate(campaign: CampaignWriter, journal: Row): Promise<void> {
        // §103.8: the table's words an introduction changed go back to what they were.
        if (Object.hasOwn(journal, 'person_labels')) {
            const world = await campaign.readWorld();
            await campaign.writeWorld({ ...world, person_labels: row(journal.person_labels) });
        }
        if (Object.hasOwn(journal, 'npc_ledger')) {
            if (journal.npc_ledger === null) await rm(campaign.path('npc-ledger.json'), { force: true });
            else await campaign.write('npc-ledger.json', row(journal.npc_ledger));
        }
        await campaign.writeCampaign(row(journal.prior_meta));
        await campaign.writeTurn(row(journal.before));
        await truncateFile(campaign.path('transcript.jsonl'), number(journal.transcript_size));
        await truncateFile(campaign.path('events.jsonl'), number(journal.events_size));
        if (!journal.had_record)
            await unlink(campaign.path(campaign.recordName(number(journal.turn)))).catch(error => {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw error;
            });
    }
    /**
     * A journal left behind means narrate never finished. If the campaign's last commit is this turn's, the commit
     * landed and only its hash was not stamped on the record; otherwise nothing was committed and the writes are undone,
     * so the turn is still open and owes its narrate. Runs under the campaign lock, before anything reads the turn.
     */
    async function recoverInterruptedNarrate(campaignId: string): Promise<void> {
        let journal: Row;
        try { journal = row(JSON.parse(await readFile(narrateJournalPath(campaignId), 'utf8'))); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
        }
        const campaign = writer(campaignId), n = number(journal.turn), callId = string(journal.call_id);
        const last = await head(context, campaignId);
        if (last.sha && last.turn === n) {
            const record = await campaign.readTurnRecord(n);
            if (record && !record.commit) {
                record.commit = last.sha;
                const call = row(row(record.calls)[callId]);
                if (isJsonObject(call.result)) call.result.commit = last.sha;
                await campaign.writeTurnRecord(record);
            }
            await campaign.telemetry({ lane: 'kernel', step: 'narrate-recovery', turn: n, outcome: 'completed', commit: last.sha });
        } else {
            await rollBackNarrate(campaign, journal);
            await campaign.telemetry({ lane: 'kernel', step: 'narrate-recovery', turn: n, outcome: 'rolled_back' });
        }
        await clearNarrateJournal(campaignId);
    }
    async function load(params: Row, { allowReady = false, requireTurn = true, repairLegacyTrail: repair = true, preload = true }: {
        allowReady?: boolean;
        requireTurn?: boolean;
        repairLegacyTrail?: boolean;
        preload?: boolean | 'names';
    } = {}): Promise<{
        campaign: CampaignWriter;
        snapshot: CampaignSnapshot;
        module: LoadedModule;
    }> {
        if (typeof params.campaign === 'string') await recoverInterruptedNarrate(params.campaign);
        const snapshot = requireTurn ? await CampaignSnapshot.open(context, params.campaign) : await recoverySnapshot(params);
        snapshot.meta = clone(snapshot.meta);
        snapshot.world = clone(snapshot.world);
        snapshot.turn = clone(snapshot.turn);
        if(preload === true)snapshot.party = await snapshot.files('party');
        const status = string(snapshot.meta.status), statuses = allowReady ? ['ready_for_table', 'active', 'completed'] : ['active', 'completed'];
        if (!statuses.includes(status)) {
            const steps = status === 'setting_up' ? row(await context.snapshots.readJson(join(context.content, 'setup', 'steps.json'))) : {};
            throw new RpcError('campaign_not_ready', `campaign ${repr(snapshot.id)} is ${repr(status)}`, {
                ...(steps.table_open_fix ? {
                    fix: string(steps.table_open_fix).replaceAll('{campaign}', snapshot.id)
                } : {}),
                details: {
                    status
                },
            });
        }
        const module = await loadCampaignModule(context, string(snapshot.meta.module_id), snapshot.world, snapshot.id);
        if (repair)
            await repairLegacyTrail(snapshot);
        if(preload)await snapshot.preload(preload === 'names' ? 'names' : 'all');
        return {
            campaign: writer(snapshot.id),
            snapshot,
            module
        };
    }
    async function initializeMods(campaign: CampaignWriter, snapshot: CampaignSnapshot, pending = false): Promise<void> {
        if(contributions.mods){
            await contributions.mods.initializeCampaign(campaign,snapshot.world,{pending});
            snapshot.meta=await campaign.readCampaign();snapshot.party=await campaign.party();
            snapshot.jsonFiles.set('campaign.json',snapshot.meta);snapshot.jsonFiles.set('world.json',snapshot.world);
            for(const sheet of snapshot.party)snapshot.jsonFiles.set(join('party',`${sheet.id}.json`),sheet);
            return;
        }
        const staged = snapshot.meta.mods_pending;
        let base = snapshot.world, changed = !Object.hasOwn(base, 'mods') && staged && typeof staged === 'object' && !Array.isArray(staged);
        if (changed)
            base = {
                ...base,
                mods: clone(staged)
            };
        const plan = await defaultModPlan(context, base, declaredPlayLanguage(snapshot.meta));
        await plan.install();
        if (changed || plan.changed) {
            await campaign.writeWorld(plan.world);
            snapshot.world = plan.world;
            snapshot.jsonFiles.set('world.json', plan.world);
        }
        if (staged != null) {
            delete snapshot.meta.mods_pending;
            await campaign.writeCampaign(snapshot.meta);
            snapshot.jsonFiles.set('campaign.json', snapshot.meta);
        }
    }
    async function validateOntology(): Promise<void> {
        const director = await DirectorGraph.load(context), craft = await TextGraph.load(context), ontology = await Ontology.load(context), rules = await RuleObservations.load(context);
        const bad = await ontology.validate([...rules.nodes.keys()], director, craft, async (id) => {
            try {
                return [...(await loadModule(context, id)).graph.nodes.keys()];
            }
            catch (error) {
                if (error instanceof RpcError)
                    return null;
                throw error;
            }
        });
        if (bad.length)
            throw new RpcError('campaign_not_ready', `the system ontology has ${bad.length} bad reference(s); the table cannot open`, {
                fix: 'repair content/ontology/system-ontology.json so every reference resolves in its graph',
                details: {
                    ontology: bad
                },
            });
    }
    async function ensureMain(campaign: CampaignWriter, meta: Row): Promise<void> {
        const selected = await context.git.run(campaign.id, ['symbolic-ref', '--quiet', 'HEAD']);
        const on = selected.code === 0 && selected.stdout.trim().startsWith('refs/heads/wl/') ? selected.stdout.trim().slice('refs/heads/wl/'.length) : null;
        if (on && on !== 'main')
            missingContribution('worldline checkout');
        if (!on) {
            const head = await context.git.run(campaign.id, ['rev-parse', '--short', 'HEAD']);
            const main = await context.git.run(campaign.id, ['rev-parse', '--short', '--verify', 'refs/heads/wl/main^{commit}']);
            if (head.code === 0 && main.code !== 0)
                checked(await context.git.run(campaign.id, ['branch', 'wl/main', head.stdout.trim()]), 'branch');
            checked(await context.git.run(campaign.id, ['symbolic-ref', 'HEAD', 'refs/heads/wl/main']), 'symbolic-ref');
        }
        const lines = clone(row(meta.worldlines));
        let changed = false;
        if (!Object.hasOwn(lines, 'main')) {
            lines.main = mainLine(campaign.id);
            changed = true;
        }
        if (lines.main.status !== 'merged' && lines.main.status !== 'active') {
            lines.main.status = 'active';
            changed = true;
        }
        if (meta.active_worldline !== 'main') {
            meta.active_worldline = 'main';
            changed = true;
        }
        if (!equal(meta.worldlines, lines)) {
            meta.worldlines = lines;
            changed = true;
        }
        if (changed)
            await campaign.writeCampaign(meta);
    }
    async function create(params: Row): Promise<Row> {
        const id = params.id;
        if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id))
            throw new RpcError('invalid_params', 'campaign id must be a short slug', {
                fix: "use letters, digits, '.', '_' or '-' (max 64 chars)"
            });
        // Existence is `campaign.json`, the same marker campaign.list, guardCampaign and
        // campaign.read use. The directory alone is not a campaign: reading/table/memory telemetry
        // mkdirs `<campaigns>/<id>/telemetry.jsonl` for the session's bound id, and setup prepares
        // a fresh PDF (which records reading telemetry) before it creates the campaign (#88).
        if (await context.snapshots.pathExists(join(context.campaignsRoot, id, 'campaign.json')))
            throw new RpcError('invalid_params', `campaign ${repr(id)} already exists`, {
                fix: 'pick another id or open the existing campaign'
            });
        const known = await playLanguages(context);
        const moduleId = required(params, 'module')!, pregen = required(params, 'pregen', true), language = required(params, 'play_language', true) || known.default;
        // The play language is open (contract section 23): any tag-shaped value is accepted as it is,
        // and `details.suggested` is what a picker offers first, never the accepted set.
        if (!validSourceLanguage(language))
            throw new RpcError('invalid_params', `play_language ${repr(language)} is not a language tag`, {
                fix: 'name the play language as a BCP-47 language tag such as pt-BR; any tag is accepted, and details.suggested lists the ones a picker offers first',
                details: { field: 'play_language', value: language, suggested: [...known.suggested] },
            });
        // The Director graph must be usable before a campaign exists (contract §13.3); the text graph names the registers.
        await DirectorGraph.load(context);
        const craft = await TextGraph.load(context), register = required(params, 'register', true) || 'purist';
        const registers = craft.registers;
        if (!registers.includes(register))
            unsupported('register', register, registers);
        // Creation difficulty (contract §33): host configuration snapshot into the campaign, validated here,
        // read by chargen on every build; absent means the rulebook standard.
        const difficulty = params.difficulty ?? null;
        if (difficulty != null)
            validateDifficulty(difficulty);
        const starters = await context.snapshots.sortedChildNames(join(context.content, 'starters'), path => context.snapshots.pathExists(join(path, 'module-graph.json')));
        const starter = starters.includes(moduleId), metadata = join(context.stateRoot, 'modules', moduleId, 'module.json');
        if (!starter && !await context.snapshots.pathExists(metadata))
            throw new RpcError('invalid_params', `unknown module ${repr(moduleId)}`, {
                fix: `one of ${repr(starters)}, or a module registered with module.source.bind`
            });
        const existing = await context.snapshots.pathExists(metadata) ? row(await context.snapshots.readJson(metadata)) : {};
        if (playsFromReading(existing) && !contributions.openingReady)
            missingContribution('visual source creation');
        if(!contributions.mods)await defaultModPlan(context, {}, language);
        if (starter) await registerStarter(context, moduleId);
        const root = await scopedModuleRoot(context, id, moduleId) ?? join(context.stateRoot, 'modules');
        const moduleMeta = clone(row(await context.snapshots.readJson(join(root, moduleId, 'module.json'))));
        if (!starter && pregen != null)
            throw new RpcError('invalid_params', 'pregens exist only for starters', {
                fix: 'create the investigator with setup.investigator'
            });
        // §185.1: a new campaign on a book the PDF reader built is name-free; an authored starter is legacy. Fixed here, once.
        const nameFree = !starter && playsFromReading(moduleMeta), handles: Row = { node_handles: {} };
        const loaded = starter || await context.snapshots.pathExists(await sourceGraphPath(moduleId, id))
            ? nameFree ? (await firstFold(moduleId, id, handles)).module : await loadModule(context, moduleId, id, null) : null, graph = loaded?.graph;
        const title = required(params, 'title', true) || (graph ? graph.title() : string(moduleMeta.title || moduleId));
        let sheet: Row | null = null;
        if (pregen != null) {
            const path = join(context.content, 'starters', moduleId, 'pregens', pregen, 'character.json');
            if (!await context.snapshots.pathExists(path)) {
                const choices = await context.snapshots.sortedChildNames(join(context.content, 'starters', moduleId, 'pregens'), () => Promise.resolve(true));
                unsupported('pregen', pregen, choices, `unknown pregen ${repr(pregen)}`);
            }
            sheet = clone(row(await context.snapshots.readJson(path)));
            sheet.id = sheet.id || pregen;
            sheet.current_hp = row(sheet.derived).HP ?? null;
            sheet.current_san = row(sheet.derived).SAN ?? null;
            sheet.current_mp = row(sheet.derived).MP ?? null;
            sheet.current_luck = row(sheet.characteristics).LUCK ?? null;
            preflightCampaign({}, {}, {}, [sheet]);
        }
        let chosen = required(params, 'start_scene', true);
        const guidance = required(params, 'guidance_key', true);
        if (guidance) {
            const accepted = row(moduleMeta.character_guidance)[guidance];
            if (!accepted || accepted.play_language !== language)
                throw new RpcError('invalid_params', 'the requested character guidance has not been accepted');
            if (chosen && graph && graph.handle(graph.scene(chosen)) !== graph.handle(graph.scene(accepted.scene)))
                throw new RpcError('invalid_params', 'the selected scene does not match the accepted guidance');
            chosen = accepted.scene;
        }
        if (chosen) {
            if (!graph || resolveStartScene(graph.raw, chosen, await loadModuleContract(context)) == null)
                throw new RpcError('invalid_params', 'start_scene must name an authored opening');
        }
        const playable = graph && (!playsFromReading(moduleMeta) || await setupOpeningReady(moduleId, chosen || '', id));
        const [world, start] = playable ? initialWorld(graph!, chosen,!!moduleMeta.source_reference) : [null, chosen && graph ? graph.handle(graph.scene(chosen)) : null];
        if (world && nameFree) world.node_handles = handles.node_handles;
        const modConfiguration = await initializeNewWorld(world || {}, language);
        const meta: Row = {
            id,
            title,
            module_id: moduleId,
            module_digest: graph?.digest ?? null,
            module_generation: number(moduleMeta.generation || loaded?.generation),
            play_language: language,
            register,
            handles: nameFree ? 'name-free' : 'legacy',
            ...(difficulty != null ? {difficulty: clone(difficulty)} : {}),
            status: sheet ? 'active' : 'setting_up',
            created_at: nowIso(),
            opening_scene: start,
            ...(guidance ? {
                guidance_key: guidance
            } : {}),
            ...(world == null ? { mods_pending: modConfiguration.mods } : {}),
            investigators: sheet ? [sheet.id] : [],
            active_worldline: 'main',
            worldlines: {
                main: mainLine(id)
            }
        };
        const campaign = writer(id);
        await mkdir(context.campaignsRoot, {
            recursive: true
        });
        // Idempotent: a telemetry-only directory (or a crashed earlier attempt) may already exist.
        await mkdir(campaign.directory, {
            recursive: true
        });
        try {
            await mkdir(campaign.path('party'), { recursive: true });
            await mkdir(campaign.path('turns'), { recursive: true });
            if (sheet)
                await campaign.writeSheet(sheet);
            if (world != null)
                await campaign.writeWorld(modConfiguration);
            await campaign.writeCampaign(meta);
            await campaign.writeTurn(freshTurn(0));
            checked(await context.git.init(id), 'init');
            checked(await context.git.run(id, ['symbolic-ref', 'HEAD', 'refs/heads/wl/main']), 'symbolic-ref');
            await commit(context, id, `campaign ${id}: created`);
        }
        catch (error) {
            if (!(error instanceof CommitFailed))
                throw error;
            await rm(campaign.directory, {
                recursive: true,
                force: true
            });
            await rm(join(context.stateRoot, 'repos', `${id}.git`), {
                recursive: true,
                force: true
            });
            throw new RpcError('commit_failed', `could not initialize the campaign repository: ${error.message}`);
        }
        return {
            campaign: meta
        };
    }
    async function open(params: Row): Promise<Row> {
        if(contributions.worldlines){const value=await openCampaign(params,{requireTurn:false});await contributions.worldlines.open(value,await value.readCampaign());}
        const initial = await recoverySnapshot(params), campaign = writer(initial.id);
        const meta = clone(initial.meta), initialParty = await initial.files('party');
        preflightCampaign(meta, initial.world, {}, initialParty);
        if(!contributions.mods)await defaultModPlan(context, initial.world);
        const root = await scopedModuleRoot(context, initial.id, string(meta.module_id)) ?? join(context.stateRoot, 'modules');
        const metadata = join(root, string(meta.module_id), 'module.json');
        const moduleReading = await context.snapshots.pathExists(metadata) && playsFromReading(row(await context.snapshots.readJson(metadata)));
        if (moduleReading && !contributions.queueAdjacentReading)
            missingContribution('visual source opening and reading queue');
        if(!contributions.worldlines)await ensureMain(campaign, meta);
        const loaded = await load(params, { allowReady: true, requireTurn: false }), snapshot = loaded.snapshot;
        let module = loaded.module;
        await initializeMods(campaign, snapshot);
        await validateOntology();
        // §185.6: a name-free campaign takes the book's handles at the table's opening, before anything here reads a handle;
        // never while a turn is open, which read its world already.
        if (!['open', 'acting'].includes(string(snapshot.turn.state))) {
            const refolded = await foldHandles(campaign, snapshot, module);
            if (refolded) {
                module = refolded;
                await campaign.writeWorld(snapshot.world);
                snapshot.jsonFiles.set('world.json', snapshot.world);
            }
        }
        if (snapshot.meta.status === 'ready_for_table') {
            snapshot.meta.status = 'active';
            snapshot.meta.activated_at = nowIso();
            await campaign.writeCampaign(snapshot.meta);
        }
        // Re-entry repairs pre-gate openings too; setup.complete is not called for an existing table.
        // Source maintenance is optional and must never revoke an already playable campaign.
        if (moduleReading && !module.graph.materialOverride) {
            try {
                await queueAheadReading({ module_id: module.graph.moduleId, campaign: campaign.id, focus: readingFocus(module.graph, snapshot.world) });
            } catch (error) {
                await appendJsonl(campaign.path('telemetry.jsonl'), { lane: 'reading', event: 'read-ahead-unavailable', detail: error instanceof Error ? error.message : String(error) });
            }
        }
        if (contributions.queueAdjacentReading)
            await contributions.queueAdjacentReading(module.graph, module.graph.scene(snapshot.world.active_scene));
        if (!await context.snapshots.pathExists(campaign.path('npc-ledger.json')))
            await rebuildNpcLedger(campaign, module.graph);
        const [checkpoint, checkpointRebuilt] = await syncCheckpoint(campaign, tableSnapshot(snapshot, module.graph), activeName(snapshot.meta));
        let turn = await readableTurn(campaign), rebuilt = checkpointRebuilt;
        if (!turn) {
            turn = await rebuildTurn(campaign, checkpoint);
            if (!turn)
                throw new RpcError('campaign_not_ready', `campaign ${repr(campaign.id)} has no turn.json and no checkpoint to rebuild it from`);
            rebuilt = true;
        }
        // §176.1: the same fold at the table's opening, so the opening already calls people by their words. Only when no turn
        // is open: a turn in flight read its world already.
        if (!['open', 'acting'].includes(turn.state) && await foldPersonWords(campaign, module.graph, snapshot.world,
            row(await snapshot.optional('npc-journal.json')), snapshot.records.length ? snapshot.records : await snapshot.files('turns')))
            await campaign.writeWorld(snapshot.world);
        const ordinals = Object.keys(row(turn.calls)).flatMap(key => { const part = key.split('-c').at(-1)!; return key.includes('-c') && /^\d+$/.test(part) ? [Number(part)] : []; });
        const pending = ['open', 'acting'].includes(turn.state) ? {
            player_text: turn.player_text ?? null,
            // §185.7: the host's recovery message hands these receipts to the Keeper whole; a receipt stores its person by
            // node id (`npc`), which every internal reader compares, so the view -- not the record -- shows the handle.
            receipts: module.graph.shownIds(array(turn.receipts)),
            owed: ['narrate'],
            since: turn.opened_at ?? null,
            last_call_ordinal: Math.max(0, ...ordinals)
        } : null;
        const opening = number(turn.turn) === 0 && turn.state === 'awaiting_player', resume = opening ? null : resumeView(checkpoint, rebuilt);
        seedTurn(context, snapshot.meta, number(turn.turn));
        // §178.3: before the opening is written, the start scene's people meet the party.
        if (opening) {
            const met = await meetAtTurnStart(context, campaign, module.graph, snapshot.world, array(snapshot.party).length ? snapshot.party : initialParty, 0, 't0-open',
                new Set(array(turn.receipts).map(receipt => string(receipt.id))), snapshot.meta);
            if (met.changed) await campaign.writeWorld(snapshot.world);
            if (met.receipts.length) {
                turn.receipts = [...array(turn.receipts), ...met.receipts];
                await campaign.writeTurn(turn);
                for (const receipt of met.receipts)
                    for (const event of presenceEvents(receipt))
                        await campaign.appendEvent(0, event);
            }
        }
        if (resume)
            resumes.set(campaign.id, resume);
        else
            resumes.delete(campaign.id);
        const scene = module.graph.scene(snapshot.world.active_scene), line = row(row(snapshot.meta.worldlines)[activeName(snapshot.meta)]);
        const mapWords = authoredMapWords(module.graph);
        // Contract §28.9: the kernel is a build artifact and `mods/` is read live from the same
        // disk, so opening a table is the one moment where the two can be compared before a verb
        // fails. A package this build cannot read is disabled, not fatal -- and the host says so
        // once, out of fiction, to whoever can rebuild the kernel.
        const modGaps = kernelGaps(await readModCatalog(context));
        const quoteTurns=quotationRecords(snapshot.records,snapshot.meta).map(record=>number(record.turn));
        return {
            campaign: snapshot.meta,
            ...(quoteTurns.length?{quote_turns:quoteTurns}:{}),
            turn: {
                number: turn.turn,
                state: turn.state
            },
            investigators: snapshot.party.map(sheet => ({
                id: sheet.id ?? null,
                name: sheet.name ?? null,
                occupation: sheet.occupation ?? null,
                occupation_stated: sheet.occupation_stated ?? null,
                hp: sheet.current_hp ?? null,
                san: sheet.current_san ?? null,
                mp: sheet.current_mp ?? null,
                luck: sheet.current_luck ?? null
            })),
            scene: {
                name: module.graph.handle(scene),
                display_name: sceneLabel(module.graph, snapshot.world, scene)
            },
            pending_turn: pending,
            session: new SessionView(snapshot, module.graph, snapshot.party, snapshot.world).activeSession(),
            opening_needed: opening,
            ...(modGaps.length ? { mods_unreadable: modGaps } : {}),
            mod_context: await modContext(context, module.graph, snapshot.world, snapshot.party, snapshot.records, {
                memory: snapshot.logs.get('memory/candidates.jsonl') ?? [], story: snapshot.logs.get('memory/story.jsonl') ?? [],
                worldline: activeName(snapshot.meta), loop: number(line.loop)
            }),
            setup_prologue: opening ? row(row(snapshot.meta.setup).handoff).prologue ?? null : null,
            module_reading: moduleReading,
            // Contract §39.2: the module's own map captions, so the host's presentation lane can put
            // them in the campaign's play_language before the first arrival mints a card out of them.
            // Omitted entirely by a module that publishes no player map.
            ...(mapWords.length ? { authored_map_words: mapWords } : {}),
            resume,
            worldline: {
                name: activeName(snapshot.meta),
                kind: line.kind ?? null,
                loop: number(line.loop)
            }
        };
    }
    /**
     * Contract §38.2's stranded close, on its own. One writer, used by `table.release` and by the
     * `release: "stranded"` form of `table.player_input`, so the record a released turn leaves behind
     * cannot depend on which of the two closed it.
     */
    async function strandTurn(campaign: CampaignWriter, snapshot: CampaignSnapshot, module: LoadedModule): Promise<number> {
        const turn = snapshot.turn, next = number(turn.turn);
        await campaign.writeTurnRecord({
            turn: next,
            player_text: turn.player_text ?? null,
            receipts: array(turn.receipts),
            text: null,
            rendered_text: null,
            calls: turn.calls || {},
            commit: null,
            closed_by: 'stranded',
            opened_at: turn.opened_at ?? null,
            closed_at: nowIso(),
            pending_choice: null,
            capsule: turn.capsule ?? null,
            world: tableSnapshot(snapshot, module.graph),
            worldline: turn.worldline ?? null
        });
        await campaign.appendEvent(next, {
            type: 'turn-stranded',
            data: {
                receipts: array(turn.receipts).map(receipt => string(row(receipt).id))
            }
        });
        await campaign.telemetry({ lane: 'turn', event: 'stranded', turn: next, receipts: array(turn.receipts).length });
        await finishDocumentRequestTurn(campaign,next);
        return next + 1;
    }
    /**
     * Contract §73. The host declared this turn stranded; that declaration is completed here and now,
     * with no player utterance attached to it.
     *
     * §38 put the close inside `table.player_input`, so a turn the host had already given up on stayed
     * `acting` on disk until the player said something else. Retained live evidence (H-SIDE t4
     * `game-1c0faba5`, turn 86, 2026-09-17): the host wrote its §50 card at 00:21, and `turns/0086.json`
     * was written at 00:56 — the moment the player typed again, 43 minutes and one fruitless server
     * restart later. The four receipts were intact both times; only the trigger was missing.
     *
     * Nothing here narrates, commits or judges: it writes the same record §38.2 describes and leaves the
     * table `awaiting_player` on the next turn, which is exactly where a delivered turn leaves it.
     */
    async function release(params: Row): Promise<Row> {
        // No `preflightCampaign` and no mod initialization: this closes a turn, it does not open one, and a
        // campaign whose contributions would be refused is exactly the one that must not stay `acting`.
        const { campaign, snapshot, module } = await load(params);
        const turn = snapshot.turn;
        if (params.release !== 'stranded')
            throw new RpcError('invalid_params', 'release must be "stranded"', {
                fix: 'pass release: "stranded" to close a turn the Keeper left undelivered',
                details: { release: params.release ?? null }
            });
        if (!['open', 'acting'].includes(string(turn.state)))
            throw new RpcError('invalid_params', `a turn that is ${repr(turn.state)} is not stranded`, {
                fix: 'release only a turn the Keeper opened and left undelivered',
                details: { turn: number(turn.turn), state: turn.state ?? null }
            });
        const next = await strandTurn(campaign, snapshot, module);
        seedTurn(context, snapshot.meta, next);
        await campaign.writeTurn(freshTurn(next));
        return { turn: next, state: 'awaiting_player', released: number(turn.turn) };
    }
    async function playerInput(params: Row): Promise<Row> {
        const loaded = await load(params), { campaign, snapshot } = loaded;
        let module = loaded.module;
        preflightCampaign(snapshot.meta, snapshot.world, snapshot.turn, snapshot.party);
        await initializeMods(campaign, snapshot, true);
        const turn = snapshot.turn, text = required(params, 'text')!;
        // Contract §38: a turn the Keeper's run left undelivered is stranded, and the host — never prose,
        // never a verdict — may release it so the player can act again. Nothing is narrated or committed.
        const release = params.release;
        if (release !== undefined && release !== 'stranded')
            throw new RpcError('invalid_params', 'release must be "stranded"', {
                fix: 'omit release, or pass release: "stranded" to close a turn the Keeper left undelivered',
                details: { release: release ?? null }
            });
        const stranded = release === 'stranded';
        if (stranded && !['open', 'acting'].includes(turn.state))
            throw new RpcError('invalid_params', `a turn that is ${repr(turn.state)} is not stranded`, {
                fix: 'release only a turn the Keeper opened and left undelivered',
                details: { turn: turn.turn, state: turn.state }
            });
        if (!stranded && !['awaiting_player', 'asked'].includes(turn.state))
            throw turnStateError(turn, 'table.player_input', 'finish the current turn with narrate or ask first');
        let next = number(turn.turn), pending = null;
        // §73 closes a stranded turn the moment the host declares it, so this path is the fallback for the
        // case that made it necessary: a kernel that could not be reached then. It writes the same record.
        if (stranded) next = await strandTurn(campaign, snapshot, module);
        else if (turn.state === 'asked') {
            next++;
            pending = turn.pending_choice ?? null;
        }
        else if (next === 0) {
            await campaign.writeTurnRecord({
                turn: 0,
                player_text: null,
                receipts: [],
                text: null,
                rendered_text: null,
                calls: turn.calls || {},
                commit: null,
                closed_by: 'implicit',
                opened_at: turn.opened_at ?? null,
                closed_at: nowIso(),
                pending_choice: null,
                world: tableSnapshot(snapshot, module.graph)
            });
            next = 1;
        }
        const cursor = freshTurn(next, 'open', pending);
        cursor.player_text = text;
        await selectDocumentRequest(campaign,snapshot.world,text,next);
        // §185.6: the book's handles reach a name-free campaign here too, before anything of this turn reads a handle.
        const refolded = await foldHandles(campaign, snapshot, module, [cursor]);
        if (refolded) module = refolded;
        // §107.1: a map published after the table arrived is presented on this, the first turn after it.
        const awaited = JSON.stringify(array(snapshot.world.map_arrivals_pending)), minted = new Set<string>();
        const lateMaps = contributions.asset ? await presentPublishedArrivalMaps({
            graph: module.graph, world: snapshot.world, turn: cursor, callId: `t${next}-input`,
            mint(base: string) { let id = base, n = 2; while (minted.has(id)) id = `${base}-${n++}`; minted.add(id); return id; }
        }, (id, name) => contributions.asset!(id, name), focus => {
            // §185.12: the reading layer settled a name-free campaign's map under the scene's book handle.
            const scene = module.graph.nameFree ? module.graph.nodeOfHandle(focus) : null, keys = [focus, ...(scene ? [module.graph.bookHandle(scene)] : [])];
            return array(row(module.meta.reading).materials).some(material => material.material === 'map' && material.status === 'unusable'
                && keys.some(key => normalize(string(material.focus ?? '')) === normalize(key)));
        }) : [];
        // §176.1: the epithet lane's words, and the journal's labels for anyone still without one, reach the world here, before
        // this turn's capsule is built: never while a turn is open, which a lane write would stale.
        const folded = await foldPersonWords(campaign, module.graph, snapshot.world, row(await snapshot.optional('npc-journal.json')),
            snapshot.records.length ? snapshot.records : await snapshot.files('turns'));
        // §178.3: anyone present the party has no first impression of meets them now: after the fold (the card's word for
        // them), before the capsule.
        const met = await meetAtTurnStart(context, campaign, module.graph, snapshot.world, snapshot.party, next, `t${next}-input`, minted, snapshot.meta);
        seedTurn(context, snapshot.meta, next);
        if (refolded || folded || met.changed || lateMaps.length || JSON.stringify(array(snapshot.world.map_arrivals_pending)) !== awaited) await campaign.writeWorld(snapshot.world);
        cursor.receipts = [...array(cursor.receipts), ...lateMaps.map(item => item.receipt), ...met.receipts];
        await campaign.writeTurn(cursor);
        await campaign.appendTranscript(next, 'player', text);
        await campaign.appendEvent(next, {
            type: 'turn-started',
            data: {
                pending_choice: pending?.name ?? null
            }
        });
        await campaign.appendEvent(next, {
            type: 'player-declared',
            data: {
                text
            }
        });
        for (const item of lateMaps)
            await campaign.appendEvent(next, { type: 'map-revealed', data: row(item.event.data), receipt: string(item.receipt.id) });
        for (const receipt of met.receipts)
            for (const event of presenceEvents(receipt))
                await campaign.appendEvent(next, event);
        snapshot.turn = cursor;
        snapshot.jsonFiles.set('turn.json', cursor);
        snapshot.records = await campaign.records();
        const resume = resumes.get(campaign.id);
        resumes.delete(campaign.id);
        const view = await capsule(snapshot, module, {
            consume: true,
            resume
        });
        const reentry = row(row(view.mods).thread).reentry;
        if (truth(reentry)) await campaign.telemetry({lane: 'story', event: 'reentry_projected', turn: next,
            assessed_turn: row(reentry).assessed_turn, status: row(reentry).status, thread: row(row(reentry).thread).name});
        // §29.2: a table.branch sets `pending_branch` on campaign.json; the first player_input
        // after it carries the one-time `branched` section and clears the flag.
        const branched = snapshot.meta.pending_branch;
        if (isJsonObject(branched)) {
            view.branched = {
                name: string(branched.name),
                from_line: string(branched.from_line),
                from_turn: number(branched.from_turn)
            };
            const fresh = await campaign.readCampaign();
            delete fresh.pending_branch;
            await campaign.writeCampaign(fresh);
        }
        if (snapshot.meta.status === 'completed') {
            view.head = 'This campaign remains completed until an allowed chapter correction commits. Only late accounting or an explicitly allowed legacy chapter correction is writable: read the source conclusion/rewards, then resolve explicit development:end-session or a pending development:settle-ending with intent montage; ask/narrate may return control or deliver accounting. Adventure effects must wait for an allowed chapter correction to commit. ' + view.head;
            if (!Object.hasOwn(row(snapshot.meta.ending), 'scope'))
                view.head = 'This legacy ending has no scope. If it ended only a chapter, correct it with a single apply ending scope:chapter and narrate after its accounting is complete. This preserves the original ending and rewards, and then permits the same campaign to continue. ' + view.head;
        }
        else if (row(snapshot.world.ending).scope === 'chapter' && !truth(snapshot.world.ending.continued))
            view.head = 'The previous chapter is already accounted for; the campaign is still active. Continue via the next authored scene without awarding that chapter again. ' + view.head;
        cursor.capsule = view;
        await campaign.writeTurn(cursor);
        return {
            turn: next,
            state: 'open',
            capsule: view,
            // §107.1: host-only, consumed by the host's map hop before anything reaches the Keeper (§39.2).
            // §39.4: only a first picture carries a view; an update on a map already pictured has none.
            ...(lateMaps.some(item => item.view) ? { map_views: lateMaps.filter(item => item.view).map(item => ({ ...item.view, receipt: item.receipt.id, label: item.receipt.label })) } : {}),
            _context: await contextBinding(snapshot, module, view)
        };
    }
    async function adoption(campaign: CampaignWriter, module: LoadedModule, turn: Row, snapshot: Row, closedBy: string, world: Row = {}): Promise<Row | null> {
        const value = directorAdoption(module.graph, turn, snapshot, closedBy);
        if (value)
            await campaign.telemetry({
                lane: 'director',
                turn: number(turn.turn),
                closed_by: closedBy,
                ...value
            });
        // §134.14: an obligation offer is taken when the world the turn closed on has it settled or waived.
        const offers = offerLedger(turn, handle => {
            const node = obligationByHandle(module.graph, handle);
            return node !== null && ['settled', 'waived'].includes(obligationState(module.graph, world, node));
        }, name => statedHandleOf(module.graph, name));
        if (offers)
            await campaign.telemetry({
                lane: 'offers',
                turn: number(turn.turn),
                closed_by: closedBy,
                ...offers
            });
        return value;
    }
    async function ask(params: Row): Promise<Row> {
        // §135.31: the turn's Keeper reads ride on the delivery for its record; they are not part of the call's digest.
        // §190.3: nor are the moves admission refused this turn.
        const { keeper_reads: readsIn, refused_moves: refusedIn, ...delivered } = params, reads = keeperReads(readsIn), admissionRefusedMoves = refusedMoves(refusedIn);
        params = delivered;
        const { campaign, snapshot, module } = await load(params), turn = snapshot.turn;
        const started = await createTurnTransaction(campaign, snapshot.world, turn).beginWrite('table.ask', params, {
            allowOpening: true
        });
        if (started.kind === 'replay')
            return started.result;
        preflightCampaign(snapshot.meta, snapshot.world, turn, snapshot.party);
        await validateMods(snapshot.world);
        const kind = params.kind ?? 'story';
        if (!['story', 'mechanics'].includes(kind))
            throw new RpcError('invalid_params', 'kind must be story or mechanics');
        const prompt = required(params, 'prompt', kind !== 'story');
        if (kind === 'mechanics' && prompt)
            throw new RpcError('invalid_params', 'mechanics choices use identifiers, not a question');
        const options = params.options;
        if (!Array.isArray(options) || !options.length || options.some(option => typeof option !== 'string' || !option.trim()))
            throw new RpcError('invalid_params', 'params.options must be a non-empty list of strings');
        // `none` is the player's own "no defence" (contract §11.5, §11.11 "none is legal everywhere"; §11.5.2): the
        // kernel offers it in `pending_defense.options`, so the choice that hands it to the player takes it too.
        if (kind === 'mechanics' && options.some(option => !['push', 'spend_luck', 'accept', 'dodge', 'fight_back', 'none', 'flee'].includes(option)))
            throw new RpcError('invalid_params', 'unknown mechanics choice option');
        const binds = required(params, 'binds', true), text = required(params, 'text', true), ending = row(snapshot.world.ending);
        if (truth(ending) && ((ending.scope || 'campaign') === 'campaign' && snapshot.meta.status !== 'completed' || ending.scope === 'chapter' && snapshot.meta.status === 'completed'))
            throw new RpcError('invalid_params', 'a campaign ending must be delivered with narrate, not ask');
        if(truth(turn.worldline))throw new RpcError('invalid_params','a turn that forks or switches the worldline cannot be closed by ask',{fix:"close this turn with narrate; ask on the new line's first turn",details:{worldline:row(turn.worldline).operation??null}});
        const receipts = [...array(turn.receipts)];
        const askSpeakers = speakerResolver(module.graph, snapshot.world, snapshot.party, await untoldAt(snapshot, module.graph));
        const askPrices=bindPriceText(text??'',priceRows(receipts,params.quotes));
        // §103.8: a name the fiction says is the book's, put in here; the Keeper never held it.
        const gated = text ? await untoldNamesGate(snapshot, campaign, turn, module.graph, askPrices.text, askSpeakers, started.callId, false, clearedPlaces(params.untold_cleared)) : null;
        const asked = gated ? withNames(gated.text, askSpeakers, module.graph) : null;
        const { placed, ...delivery } = deliveryText(asked ? asked.text : text, receipts, askSpeakers);
        await refuseRepeatedLine(snapshot, campaign, delivery.speech);
        const language = await playLanguageOf(context, snapshot.meta);
        await stanceTable(context);
        const n = number(turn.turn), pending = {
            name: `ask-${asciiSlug(binds || '') || kind}-t${n}`,
            prompt,
            options: [...options],
            binds,
            kind
        };
        const rendered = delivery.rendered_text, projected = mechanics(receipts, placed, await snapshot.handoutTexts(receipts), snapshot.world), labels = await playerGlossary(context, language);
        const quoteDrafts=quotationDrafts(params.quotes,n,snapshot.meta,snapshot.party);
        discloseCashRequests(quoteDrafts,params._cash_requests,{world:snapshot.world,graph:module.graph},snapshot.party);
        projected.push(...quoteDrafts.map(pendingQuotation));
        const standing = standingStates(snapshot.party, receipts);
        const result: Row = {
            pending_choice: pending,
            ...(asked?.unresolved.length ? { unresolved_names: asked.unresolved } : {}),
            interaction: {
                ...pending,
                play_language: language
            },
            ...delivery,
            mechanics: projected,
            player_clock: clockSection(module.graph, snapshot.world),
            ...(standing.length ? { standing } : {}),
            labels,
            turn: n,
            state: 'asked'
        };
        turn.pending_choice = pending;
        turn.state = 'asked';
        rememberCall(turn, started.callId, params, result);
        const world = tableSnapshot(snapshot, module.graph), record = {
            ...deliveryRecord(turn, text, receipts, result, world),
            closed_by: 'ask',
            ...(quoteDrafts.length?{quote_drafts:quoteDrafts,quote_scope:quotationScope(snapshot.meta)}:{}),
            ...(askPrices.bound.length||askPrices.unresolved.length?{price_template:text,price_bindings:askPrices.bound,unresolved_prices:askPrices.unresolved}:{}),
            closed_how: 'explicit',
            director_adoption: await adoption(campaign, module, turn, world, 'ask', snapshot.world),
            ...(reads.length ? { reads } : {}),
            ...(admissionRefusedMoves.length ? { refused_moves: admissionRefusedMoves } : {})
        };
        await campaign.writeTurnRecord(record);
        await updateNpcLedger(campaign, module.graph, record);
        await campaign.writeTurn(turn);
        await campaign.appendTranscript(n, 'keeper', rendered);
        await campaign.appendEvent(n, {
            type: 'choice-asked',
            data: {
                name: pending.name,
                prompt,
                options: [...options],
                binds
            }
        }, started.callId);
        return result;
    }
    /**
     * §177.15, read-only: where `text` writes an untold person's printed name, as the delivery gate would find it, each with the
     * words around it. The host asks whether each place is the name or part of another word and sends `untold_cleared`.
     */
    async function untoldSpans(params: Row): Promise<Row> {
        const text = params.text;
        if (typeof text !== 'string') throw new RpcError('invalid_params', 'params.text must be a string', { details: { field: 'text' } });
        const { snapshot, module } = await load(params, { allowReady: true, preload: 'names' });
        const speakers = speakerResolver(module.graph, snapshot.world, snapshot.party, await untoldAt(snapshot, module.graph));
        const { places } = await untoldPlaces(snapshot, module.graph, text, speakers);
        return { spans: places.map(place => ({ name: place.name, nth: place.nth, start: place.start, end: place.end })) };
    }
    async function narrate(params: Row, report?: ProgressReporter): Promise<Row> {
        // §135.31: the turn's Keeper reads ride on the delivery for its record; they are not part of the call's digest.
        // §145.2: nor is the host's reading of a time skip. §190.3: nor are the moves admission refused this turn.
        const { keeper_reads: readsIn, time_reading: timeIn, refused_moves: refusedIn, ...delivered } = params, reads = keeperReads(readsIn),
            reading = timeReading(timeIn), admissionRefusedMoves = refusedMoves(refusedIn);
        params = delivered;
        const interactionScope = params._interaction_scope;
        if (interactionScope !== undefined && !['reference', 'uncertain'].includes(interactionScope))
            throw new RpcError('invalid_params', 'The host interaction scope is reference or uncertain');
        const reference = interactionScope !== undefined;
        const { campaign, snapshot, module } = await load(params), turn = snapshot.turn;
        const started = await createTurnTransaction(campaign, snapshot.world, turn).beginWrite('table.narrate', params, {
            allowOpening: true
        });
        if (started.kind === 'replay')
            return started.result;
        // Progress stages follow the contract §5 closed enum; each fires once at the real boundary.
        report?.('load');
        preflightCampaign(snapshot.meta, snapshot.world, turn, snapshot.party);
        await validateMods(snapshot.world);
        const untold = await untoldAt(snapshot, module.graph);
        const receipts = [...array(turn.receipts)], speakers = speakerResolver(module.graph, snapshot.world, snapshot.party, untold);
        const priceTemplate=required(params,'text')!;
        const priceBinding=bindPriceText(priceTemplate,priceRows(receipts,params.quotes));
        // `let`: §143.17 may take a bare wrapper off the text on the turn's second delivery and render it again.
        // §103.8: a name the fiction says is the book's, put in here; the Keeper never held it.
        const gated = await untoldNamesGate(snapshot, campaign, turn, module.graph, priceBinding.text, speakers, started.callId, truth(params.implicit),
            clearedPlaces(params.untold_cleared));
        const naming = withNames(gated.text, speakers, module.graph);
        let text = naming.text;
        // §103.8: someone untold is named in this delivery, so from now on the table calls them by the book's name -- the sync
        // the Keeper's own `apply person` used to make at an introduction, which it can no longer make without the name.
        const introduced = reference ? [] : naming.named.map(handle => module.graph.find(handle, ['npc'])).filter((node): node is Row => !!node && untold(node));
        let { placed, ...delivery } = deliveryText(text, receipts, speakers), rendered = delivery.rendered_text;
        // §177.15: the delivery as the told check reads it, the cleared places blanked (`told_text` on the record).
        const toldText = gated.told === undefined ? undefined : string(deliveryText(withNames(gated.told, speakers, module.graph).text, receipts, speakers).rendered_text);
        if (reference) delivery.speech = [];
        const hostRepeats = reference ? [] : await refuseRepeatedLine(snapshot, campaign, delivery.speech, hostAttributed(params, delivery.speech));
        // Contract §143.24 (ticket 25): the host asked Jev §143.14's purpose question of the lines the Keeper gives a person
        // against that person's rows never carried out, and names what it read (`purpose_repeats`, host-only). Only a row
        // that is that speaker's thread in this delivery counts. Refused once per turn; a later delivery this turn goes out,
        // with a finding. Checked after §113 D and before §142.7: the prose's lines first, then what its receipts owe.
        const purposeRepeats = !reference && Array.isArray(params.purpose_repeats) && params.purpose_repeats.length
            ? namedRepeats(params.purpose_repeats, speakerThreads(module.graph, snapshot, row(await snapshot.optional('npc-ledger.json')),
                await stanceTable(context), array(delivery.speech), hostAttributed(params, delivery.speech))) : [];
        if (!SINGLE_PASS_NARRATION && purposeRepeats.length && !truth(turn.purpose_gate)) {
            await campaign.writeTurn({ ...turn, purpose_gate: { call_id: started.callId } });
            await campaign.telemetry({ lane: 'delivery', turn: number(turn.turn), ok: false, reason: 'purpose_repeated', outcome: 'refused',
                call_id: started.callId, implicit: truth(params.implicit), people: purposeRepeats.length }).catch(() => undefined);
            throw new RpcError('needs', purposeRepeats.map(repeatedPurpose).join('; '), {
                fix: purposeFix(purposeRepeats),
                details: { reason: 'purpose_repeated', repeats: purposeRepeats.map(repeat => ({ ...repeat, lines: array(repeat.lines).slice(0, 4).map(line => chars(string(line), 120)) })) },
            });
        }
        // Contract §142.7: someone present set out to do something on an earlier turn and nothing of this turn reports how
        // it went. Refused once per set of owed intentions; the same set a second time is delivered, with a finding.
        const owed = reference ? [] : owedIntents(module.graph, snapshot.world, row(await snapshot.optional('npc-ledger.json')), turn);
        const owedKey = owed.map(item => string(item.ref)).sort().join(' ');
        if (!SINGLE_PASS_NARRATION && owed.length && string(row(turn.intent_gate).refs) !== owedKey) {
            await campaign.writeTurn({ ...turn, intent_gate: { refs: owedKey } });
            throw new RpcError('needs', `${owed.map(item => `${string(item.who)} set out on turn ${string(item.since_turn)} to ${string(item.intent)}`).join('; ')} -- and it has no result yet`, {
                fix: 'What a person set out to do gets a result by their next turn: report it before delivering -- a roll or an effect with intent_ref, or apply npc with intent_ref and outcome done, failed or abandoned (abandoned when they drop it for something else). Then deliver again; the prose stands.',
                details: { reason: 'intent_result_owed', owed },
            });
        }
        // Contract §143.10: player-facing prose carries no markup. A syntax check over the rendered text (the host's own
        // tokens already stripped), refused once per turn; a later delivery this turn that still carries it is delivered,
        // with a finding. Checked after §142.7, so a turn pays at most one refusal of each kind.
        const markup = reference ? null : markupInProse(typeof rendered === 'string' ? rendered : '');
        if (!SINGLE_PASS_NARRATION && markup && !truth(turn.markup_gate)) {
            await campaign.writeTurn({ ...turn, markup_gate: { call_id: started.callId } });
            await campaign.telemetry({ lane: 'delivery', turn: number(turn.turn), ok: false, reason: 'markup_in_prose', outcome: 'refused',
                call_id: started.callId, implicit: truth(params.implicit), tags: markup.tags.length, lines: markup.lines.length }).catch(() => undefined);
            throw new RpcError('needs', `${MARKUP_STEER} (found: ${describeMarkup(markup)})`, {
                fix: 'Deliver the same turn again as plain prose: drop the tags, and write each list or heading line as sentences of the paragraph it belongs to. Keep the say tokens and mechanics markers where they stand and every settled fact; nothing else needs to change.',
                details: { reason: 'markup_in_prose', tags: markup.tags, lines: markup.lines },
            });
        }
        // Contract §143.17: the gate is spent, so this delivery goes out. When all the markup is a bare wrapper -- a frame
        // at the text's very start or end, never a tag inside the prose or a list or heading line -- it comes off the
        // Keeper's text before rendering. Kept only when the new render is exactly the old one unwrapped and carries no
        // markup; anything else is delivered as written, as before.
        let stripped = false;
        const wrapper = markup && typeof rendered === 'string' ? bareWrapper(rendered) : null;
        if (wrapper) {
            const bare = unwrap(text, wrapper), again = deliveryText(bare, receipts, speakers);
            if (bare && typeof again.rendered_text === 'string' && again.rendered_text === unwrap(rendered, wrapper) && !markupInProse(again.rendered_text)) {
                ({ placed, ...delivery } = again);
                text = bare;
                rendered = delivery.rendered_text;
                stripped = true;
            }
        }
        // Contract §145.3: the host read a time skip in this delivery; the kernel holds it against its own clock. Refused
        // once a turn when the host can hand the refusal back; otherwise delivered, with a finding §145.4 keeps raising.
        const gap = reference ? null : timeGap(reading, receipts, clockSection(module.graph, snapshot.world));
        if (!SINGLE_PASS_NARRATION && gap && reading!.refusable && !truth(turn.time_gate)) {
            await campaign.writeTurn({ ...turn, time_gate: { call_id: started.callId } });
            await campaign.telemetry({ ...timeRow(gap, turn, started.callId, params), ok: false, outcome: 'refused' }).catch(() => undefined);
            throw timeRefusal(gap);
        }
        const language = await playLanguageOf(context, snapshot.meta);
        // Nothing is read out of the prose. Figures travel as the mechanics projection and the
        // frontend draws them (2026-09-09 user decision, contract section 16.3); whether the words
        // are in the play language is the verifier lane's finding, not a refusal (section 23).
        await stanceTable(context);
        report?.('validate');
        const projected = mechanics(receipts, placed, await snapshot.handoutTexts(receipts), snapshot.world), n = number(turn.turn), receipt = `turn:${n}`, world = tableSnapshot(snapshot, module.graph);
        const quoteDrafts=reference?[]:quotationDrafts(params.quotes,n,snapshot.meta,snapshot.party);
        if(!reference)discloseCashRequests(quoteDrafts,params._cash_requests,{world:snapshot.world,graph:module.graph},snapshot.party);
        projected.push(...quoteDrafts.map(pendingQuotation));
        if(quoteDrafts.length && !delivery.marked_text)delivery.marked_text=text;
        // The public record the verifier reads beside the Keeper-only list (contract §32.6): the two deliveries before this one.
        const earlier = (await Promise.all([number(turn.turn) - 1, number(turn.turn) - 2].filter(t => t >= 0).map(t => campaign.readTurnRecord(t))))
            .flatMap(r => r && r.interaction_scope !== 'reference' && r.interaction_scope !== 'uncertain' ? [r] : []);
        const factLists = reference ? undefined : facts(module.graph, snapshot.world, snapshot.party, receipts, world, turn.player_text,
            publicContext(snapshot.party, row(row(snapshot.meta.setup).handoff).prologue, earlier)), labels = await playerGlossary(context, language);
        report?.('project');
        const standing = standingStates(snapshot.party, receipts);
        const result: Row = {
            ...delivery,
            mechanics: projected,
            player_clock: clockSection(module.graph, snapshot.world),
            ...(standing.length ? { standing } : {}),
            labels,
            turn: n,
            receipt,
            commit: null,
            ...(reference ? {interaction_scope: interactionScope} : {facts: factLists, extraction: {
                job_id: `extract:${campaign.id}:t${n}`
            }}),
            ...(naming.unresolved.length ? { unresolved_names: naming.unresolved } : {}),
            ...(hostRepeats.length ? { repeated_lines: {
                lines: hostRepeats.map(repeat => ({ name: repeat.name, line: repeat.line, earlier_turn: repeat.earlier_turn })),
                note: 'the host wrapped these lines (§128.3) and they repeat what the same person already said; delivered, not refused, and recorded as a finding for the next turn'
            } } : {})
        };
        const before = clone(turn), transcriptSize = await fileSize(campaign.path('transcript.jsonl')), eventsSize = await fileSize(campaign.path('events.jsonl'));
        const recordPath = campaign.path(campaign.recordName(n)), hadRecord = await context.snapshots.pathExists(recordPath);
        // §141: what a rollback needs, on disk before the first write below.
        const rolledBack = clone(before);
        if (rolledBack.state === 'open')
            rolledBack.state = 'acting';
        const ledgerPath = campaign.path('npc-ledger.json');
        const priorLedger = await context.snapshots.pathExists(ledgerPath) ? await campaign.read('npc-ledger.json') : null;
        await writeJsonAtomic(narrateJournalPath(campaign.id), { turn: n, call_id: started.callId, before: rolledBack,
            prior_meta: await campaign.readCampaign(), npc_ledger: priorLedger, transcript_size: transcriptSize, events_size: eventsSize,
            had_record: hadRecord, ...(introduced.length ? { person_labels: row(snapshot.world.person_labels) } : {}), at: nowIso() });
        rememberCall(turn, started.callId, params, result);
        const record: Row = {
            ...deliveryRecord(turn, text, receipts, result, world),
            ...(quoteDrafts.length?{quote_drafts:quoteDrafts,quote_scope:quotationScope(snapshot.meta)}:{}),
            ...(priceBinding.bound.length||priceBinding.unresolved.length?{price_template:priceTemplate,price_bindings:priceBinding.bound,unresolved_prices:priceBinding.unresolved}:{}),
            ...(delivery.marked_text ? { marked_text: delivery.marked_text } : {}),
            ...(toldText !== undefined ? { told_text: toldText } : {}),
            closed_by: 'narrate',
            closed_how: truth(params.implicit) ? 'implicit' : 'explicit',
            ...(reference ? {interaction_scope: interactionScope} : {facts: factLists}),
            director_adoption: await adoption(campaign, module, turn, world, 'narrate', snapshot.world),
            worldline: turn.worldline ?? null,
            ...(reads.length ? { reads } : {}),
            // §190.3: the moves admission refused this turn; a refused move the delivery then told is still owed (§190.2).
            ...(admissionRefusedMoves.length ? { refused_moves: admissionRefusedMoves } : {}),
            // §128.3: a repeat inside a line the host wrapped is a finding on the delivery, the same
            // `warnings` rows the verifier's `unmarked_speech` lands in, never a refusal.
            // §145.3: so is a time skip the books do not hold, on a delivery that went out anyway.
            ...(hostRepeats.length || purposeRepeats.length || owed.length || markup || gap ? { warnings: [...hostRepeats.map(repeat => ({ lane: 'speech', kind: 'repeated_line',
                quote: chars(string(repeat.line), 120),
                why: chars(`${string(repeat.name)} already said this at turn ${string(repeat.earlier_turn)}; the host wrapped the line, so it was delivered, not refused`, 200),
                fix: 'Already delivered: do not rewrite it. Next time the same point comes back, say it in fresh words; the position need not move.',
                at: nowIso() })),
                // §143.24: delivered after one refusal this turn with a person still saying again what they set out to do and
                // never carried out -- a finding for the next turn, never a second refusal.
                ...purposeRepeats.map(repeat => ({ lane: 'speech', kind: 'purpose_repeated', quote: chars(string(array(repeat.lines)[0] ?? ''), 120),
                    why: chars(`${repeatedPurpose(repeat)}; delivered after one refusal this turn`, 200),
                    fix: `Already delivered: do not rewrite it. From now on render what ${string(repeat.name)} does, and do not have them say "${chars(string(repeat.intent), 80)}" again in other words.`,
                    ref: repeat.ref, at: nowIso() })),
                // §142.7: delivered on the second try with the result still owed -- a finding for the next turn, not a third refusal.
                ...owed.map(item => ({ lane: 'intents', kind: 'intent_result_owed', quote: null,
                    why: chars(`${string(item.who)} set out on turn ${string(item.since_turn)} to ${string(item.intent)}, and this delivery reported no result`, 200),
                    fix: 'Settle it this turn: a roll or effect with its intent_ref, or apply npc with intent_ref and outcome done, failed or abandoned.',
                    ref: item.ref, npc: item.npc, at: nowIso() })),
                // §143.10: delivered on the second try with markup still in it -- a finding for the next turn, not a second refusal.
                // §143.17: a bare wrapper was taken off first; the row stays and says so.
                ...(markup ? [{ lane: 'delivery', kind: 'markup_in_prose', quote: chars(markup.tags[0] ?? markup.lines[0] ?? '', 120),
                    why: chars(stripped
                        ? `the delivery still carried markup after one refusal this turn (${describeMarkup(markup)}), a bare wrapper around the prose, so the kernel took it off and delivered the rest`
                        : `the delivery still carried markup after one refusal this turn (${describeMarkup(markup)}), so it went out as written`, 200),
                    fix: stripped
                        ? `Already delivered without it: do not rewrite it. ${MARKUP_STEER}: no tags around the text or inside it.`
                        : `Already delivered: do not rewrite it. ${MARKUP_STEER}: no tags, no list or heading lines.`,
                    ...(stripped ? { stripped: true } : {}),
                    at: nowIso() }] : []), ...(gap ? [timeWarning(gap, nowIso())] : [])] } : {})
        };
        await campaign.writeTurnRecord(record);
        if (!reference) await updateNpcLedger(campaign, module.graph, record);
        if (introduced.length) {
            const current = await campaign.readWorld(), labels: Row = { ...row(current.person_labels) };
            for (const node of introduced) {
                const handle = module.graph.handle(node);
                labels[handle] = { ...row(labels[handle]), name: module.graph.displayName(node) };
            }
            await campaign.writeWorld({ ...current, person_labels: labels });
        }
        await campaign.appendTranscript(n, 'keeper', rendered);
        await campaign.appendEvent(n, {
            type: 'turn-finalized',
            data: {
                receipts: receipts.map(r => r.id)
            },
            receipt
        }, started.callId);
        await campaign.writeTurn(freshTurn(n + 1));
        const priorMeta = await campaign.readCampaign();
        if (truth(snapshot.world.ending))
            await campaign.writeCampaign({
                ...priorMeta,
                status: snapshot.world.ending.scope === 'chapter' ? 'active' : 'completed',
                ending: snapshot.world.ending
            });
        report?.('write');
        let sha: string;
        try {
            // The subject is chrome a player reads (timeline node titles); the marked text is
            // for consumers that mount components, so the caption is minted from the rendered one.
            sha = await commit(context, campaign.id, `turn ${n}: ${chars(words(rendered), 60)}`);
        }
        catch (error) {
            if (!(error instanceof CommitFailed))
                throw error;
            await rollBackNarrate(campaign, { turn: n, before: rolledBack, prior_meta: priorMeta, npc_ledger: priorLedger,
                ...(introduced.length ? { person_labels: row(snapshot.world.person_labels) } : {}),
                transcript_size: transcriptSize, events_size: eventsSize, had_record: hadRecord });
            await clearNarrateJournal(campaign.id);
            // Contract §38.11: the Git verb, its exit code and what it printed reach the host as
            // fields, so a repeated failure can be escalated by cause instead of by sentence.
            throw new RpcError('commit_failed', `git commit failed; the turn stays open: ${error.message}`, {
                fix: 'retry narrate with the same text',
                details: {
                    turn: n,
                    ...(error.git ? { git: { step: error.git.step, code: error.git.code, output: error.git.output } } : {})
                }
            });
        }
        // §141: the commit landed; clear the journal before any post step can add another commit.
        await clearNarrateJournal(campaign.id);
        // A failed commit throws above, so this frame only ever announces a real commit.
        report?.('commit');
        record.commit = sha;
        record.calls[started.callId].result.commit = sha;
        await campaign.writeTurnRecord(record);
        // §143.24: a delivery that went out after its refusal with a purpose still repeated, counted beside its refusal.
        if (purposeRepeats.length) await campaign.telemetry({ lane: 'delivery', turn: n, ok: true, reason: 'purpose_repeated', outcome: 'delivered',
            call_id: started.callId, implicit: truth(params.implicit), people: purposeRepeats.length }).catch(() => undefined);
        // §143.10: the markup this delivery went out with is counted on the same lane as its refusal; §143.17: `stripped`
        // when it was a bare wrapper the kernel took off (the counts are what was found).
        if (markup) await campaign.telemetry({ lane: 'delivery', turn: n, ok: true, reason: 'markup_in_prose', outcome: 'delivered',
            call_id: started.callId, implicit: truth(params.implicit), tags: markup.tags.length, lines: markup.lines.length,
            ...(stripped ? { stripped: true } : {}) }).catch(() => undefined);
        if (gap)
            await campaign.telemetry({ ...timeRow(gap, turn, started.callId, params), ok: true, outcome: 'delivered' }).catch(() => undefined);
        const postStep=async(step:string,action:()=>Promise<unknown>)=>{try{await action();}catch(error){await campaign.telemetry({lane:'kernel',step,turn:n,ok:false,error:internalError(error).message});}};
        const moves=isJsonObject(record.worldline)&&truth(record.worldline.operation);
        let checkpointRecord=record,checkpointWorld=world,moved:Row|null=null;
        const checkpoint=async()=>writeCheckpoint(campaign,checkpointFromRecord(campaign.id,checkpointRecord,checkpointWorld,activeName(await campaign.readCampaign())));
        if(!moves)await postStep('checkpoint',checkpoint);
        if(contributions.libraryWriteBack)await postStep('library',()=>contributions.libraryWriteBack!(campaign,record));
        await postStep('episode',()=>writeEpisode(campaign,record));
        await postStep('document-requests',()=>finishDocumentRequestTurn(campaign,number(turn.turn)));
        if(moves){
            const plan=record.worldline;
            try{
                if(!contributions.worldlines)missingContribution('worldline transition');
                moved=await contributions.worldlines!.transition(campaign,module.graph,plan,n);
            }catch(error){await campaign.telemetry({lane:'worldline',turn:n,ok:false,operation:plan.operation??null,line:plan.line??null,error:internalError(error).message});}
            if(moved){
                const landed=number((await campaign.readTurn()).turn)||n+1;
                await campaign.appendEvent(landed,{...eventOf(plan),receipt:string(plan.receipt||'')});
                await campaign.telemetry({lane:'worldline',turn:n,ok:true,...moved});
                const meta=await campaign.readCampaign();seedTurn(context,meta,landed);
                const current=new CampaignSnapshot(context,campaign.id);current.meta=meta;current.world=await campaign.readWorld();current.turn=await campaign.readTurn();await current.preload();
                checkpointRecord={...record,world:null};checkpointWorld=tableSnapshot(current,module.graph);
            }
            await postStep('checkpoint',checkpoint);
        }
        report?.('poststep');
        return {...result,commit:sha,...(moved?{worldline:moved}:{})};
    }
    return {
        read,
        campaign:openCampaign,
        startSetupWorld,
        setupOpeningReady,
        requestReading,
        queueAheadReading,
        sourceGraphPath,
        handlers: Object.freeze({
            'campaign.create': create,
            'table.open': open,
            'table.player_input': playerInput,
            'table.release': release,
            'table.call_status': callStatus,
            'table.ask': ask,
            'table.narrate': narrate,
            'table.untold_spans': untoldSpans
        }),
        async transaction(params, options = {}) { const { campaign, snapshot } = await load(params, options); return createTurnTransaction(campaign, snapshot.world, snapshot.turn); }
    };
}
