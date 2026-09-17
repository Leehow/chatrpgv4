/** Static campaign and turn handlers. Other domains contribute through named seams. */
import { mkdir, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import type { HandlerGroup, ProgressReporter } from '../handlers.js';
import type { TurnTransaction } from '../transactions.js';
import { RpcError, internalError } from '../errors.js';
import { sha256Text,isJsonObject } from '../json.js';
import { fileSize, truncateFile } from '../fileio.js';
import { CampaignSnapshot, loadModule, loadCampaignModule, replayTrail, type LoadedModule } from '../read/campaign.js';
import { scopedModuleRoot } from '../modules/campaign-scope.js';
import { ModuleGraph, recordOf } from '../read/module-graph.js';
import { DirectorGraph, TextGraph, Ontology } from '../read/content.js';
import { RuleObservations } from '../read/rule-facts.js';
import { buildCapsule } from '../read/assemble.js';
import { contextBinding } from '../read/context.js';
import { mechanics } from '../read/mechanics.js';
import { standingStates } from '../read/standing.js';
import { authoredMapWords } from '../read/maps.js';
import { sceneLabel } from '../read/capsule.js';
import { tableSnapshot, playerGlossary, unsupported, type ReadContributions } from '../read/handlers.js';
import { playLanguages, playLanguageOf } from '../read/languages.js';
import { modContext, kernelGaps, readModCatalog } from '../read/mods.js';
import { array, entries, values, row, clone, number, string, truth, repr, chars, words, equal, type Row } from '../read/values.js';
import { CampaignWriter, freshTurn, nowIso, required, missingContribution, createTurnTransaction, rememberCall, turnStateError } from './store.js';
import { checked, commit, CommitFailed } from './history.js';
import { registerStarter } from './source.js';
import { validateDifficulty } from '../setup/difficulty.js';
import { resolveStartScene } from '../modules/visual.js';
import { loadModuleContract, validSourceLanguage } from '../modules/contract.js';
import { defaultModPlan, preflightCampaign as validateContributions, rebuildNpcLedger, updateNpcLedger, stanceTable, writeEpisode } from './contributions.js';
import { asciiSlug, facts, publicContext, directorAdoption, offerLedger } from './text.js';
import { deliveryText, deliveryRecord } from './delivery.js';
import { speakerResolver } from './speech.js';
import { readableTurn, rebuildTurn, syncCheckpoint, resumeView, checkpointFromRecord, writeCheckpoint } from './continuation.js';
import {activeName} from '../read/worldline.js';
import {eventOf} from '../worldline/index.js';
import type {createWorldlineRuntime} from '../worldline/index.js';
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
function seedTurn(context: KernelContext, meta: Row, turn: number): void {
    if (context.seedLocked)
        return;
    const line = row(row(meta.worldlines)[meta.active_worldline || 'main']);
    context.rng.seed(`${string(line.seed || lineSeed(string(meta.id || ''), meta.active_worldline || 'main'))}:${turn}`);
}
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
function initialWorld(graph: ModuleGraph, chosen: string | null): [
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
    for (const scene of [start, ...graph.kind('scene')])
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
    mods?: {
        initializeWorld(world: Row): Promise<boolean>;
        initializeCampaign(campaign: CampaignWriter, world: Row, options?: {pending?: boolean}): Promise<void>;
        validateWorld(world: Row): Promise<void>;
    };
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
    async function initializeNewWorld(world: Row): Promise<Row> {
        if(contributions.mods){await contributions.mods.initializeWorld(world);return world;}
        const plan=await defaultModPlan(context,world);await plan.install();return plan.world;
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
        if (moduleMeta.reading_version) {
            if (!await setupOpeningReady(id, meta.opening_scene || '', value.id))
                return false;
        }
        const module = await loadModule(context, id, value.id), [world, opening] = initialWorld(module.graph, meta.opening_scene || null);
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
    async function load(params: Row, { allowReady = false, requireTurn = true, repairLegacyTrail: repair = true, preload = true }: {
        allowReady?: boolean;
        requireTurn?: boolean;
        repairLegacyTrail?: boolean;
        preload?: boolean;
    } = {}): Promise<{
        campaign: CampaignWriter;
        snapshot: CampaignSnapshot;
        module: LoadedModule;
    }> {
        const snapshot = requireTurn ? await CampaignSnapshot.open(context, params.campaign) : await recoverySnapshot(params);
        snapshot.meta = clone(snapshot.meta);
        snapshot.world = clone(snapshot.world);
        snapshot.turn = clone(snapshot.turn);
        if(preload)snapshot.party = await snapshot.files('party');
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
        if(preload)await snapshot.preload();
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
        const plan = await defaultModPlan(context, base);
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
        const director = await DirectorGraph.load(context), craft = await TextGraph.load(context, director.beats), ontology = await Ontology.load(context), rules = await RuleObservations.load(context);
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
        const director = await DirectorGraph.load(context), craft = await TextGraph.load(context, director.beats), register = required(params, 'register', true) || 'purist';
        const registers = [...craft.nodes.values()].filter(node => node.node_kind === 'play-register').sort((a, b) => number(a.properties.ordinal) - number(b.properties.ordinal)).map(node => node.properties.legacy_key);
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
        if (existing.reading_version && !contributions.openingReady)
            missingContribution('visual source creation');
        if(!contributions.mods)await defaultModPlan(context, {});
        if (starter) await registerStarter(context, moduleId);
        const root = await scopedModuleRoot(context, id, moduleId) ?? join(context.stateRoot, 'modules');
        const moduleMeta = clone(row(await context.snapshots.readJson(join(root, moduleId, 'module.json'))));
        if (!starter && pregen != null)
            throw new RpcError('invalid_params', 'pregens exist only for starters', {
                fix: 'create the investigator with setup.investigator'
            });
        const loaded = starter || await context.snapshots.pathExists(await sourceGraphPath(moduleId, id)) ? await loadModule(context, moduleId, id) : null, graph = loaded?.graph;
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
        const playable = graph && (!moduleMeta.reading_version || await setupOpeningReady(moduleId, chosen || '', id));
        const [world, start] = playable ? initialWorld(graph!, chosen) : [null, chosen && graph ? graph.handle(graph.scene(chosen)) : null], modConfiguration = await initializeNewWorld(world || {});
        const meta: Row = {
            id,
            title,
            module_id: moduleId,
            module_digest: graph?.digest ?? null,
            module_generation: number(moduleMeta.generation || loaded?.generation),
            play_language: language,
            register,
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
        const moduleReading = await context.snapshots.pathExists(metadata) && truth(row(await context.snapshots.readJson(metadata)).reading_version);
        if (moduleReading && !contributions.queueAdjacentReading)
            missingContribution('visual source opening and reading queue');
        if(!contributions.worldlines)await ensureMain(campaign, meta);
        const loaded = await load(params, { allowReady: true, requireTurn: false }), snapshot = loaded.snapshot, module = loaded.module;
        await initializeMods(campaign, snapshot);
        await validateOntology();
        if (snapshot.meta.status === 'ready_for_table') {
            snapshot.meta.status = 'active';
            snapshot.meta.activated_at = nowIso();
            await campaign.writeCampaign(snapshot.meta);
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
        const ordinals = Object.keys(row(turn.calls)).flatMap(key => { const part = key.split('-c').at(-1)!; return key.includes('-c') && /^\d+$/.test(part) ? [Number(part)] : []; });
        const pending = ['open', 'acting'].includes(turn.state) ? {
            player_text: turn.player_text ?? null,
            receipts: array(turn.receipts),
            owed: ['narrate'],
            since: turn.opened_at ?? null,
            last_call_ordinal: Math.max(0, ...ordinals)
        } : null;
        const opening = number(turn.turn) === 0 && turn.state === 'awaiting_player', resume = opening ? null : resumeView(checkpoint, rebuilt);
        seedTurn(context, snapshot.meta, number(turn.turn));
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
        return {
            campaign: snapshot.meta,
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
            opening_needed: opening,
            ...(modGaps.length ? { mods_unreadable: modGaps } : {}),
            mod_context: await modContext(context, module.graph, snapshot.world, snapshot.party, snapshot.records, true, {
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
        const { campaign, snapshot, module } = await load(params);
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
        seedTurn(context, snapshot.meta, next);
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
            _context: await contextBinding(snapshot, module, view)
        };
    }
    async function adoption(campaign: CampaignWriter, module: LoadedModule, turn: Row, snapshot: Row, closedBy: string): Promise<Row | null> {
        const value = directorAdoption(module.graph, turn, snapshot, closedBy);
        if (value)
            await campaign.telemetry({
                lane: 'director',
                turn: number(turn.turn),
                closed_by: closedBy,
                ...value
            });
        const offers = offerLedger(turn);
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
        if (kind === 'mechanics' && options.some(option => !['push', 'spend_luck', 'accept', 'dodge', 'fight_back', 'flee'].includes(option)))
            throw new RpcError('invalid_params', 'unknown mechanics choice option');
        const binds = required(params, 'binds', true), text = required(params, 'text', true), ending = row(snapshot.world.ending);
        if (truth(ending) && ((ending.scope || 'campaign') === 'campaign' && snapshot.meta.status !== 'completed' || ending.scope === 'chapter' && snapshot.meta.status === 'completed'))
            throw new RpcError('invalid_params', 'a campaign ending must be delivered with narrate, not ask');
        if(truth(turn.worldline))throw new RpcError('invalid_params','a turn that forks or switches the worldline cannot be closed by ask',{fix:"close this turn with narrate; ask on the new line's first turn",details:{worldline:row(turn.worldline).operation??null}});
        const receipts = [...array(turn.receipts)];
        const { placed, ...delivery } = deliveryText(text, receipts, speakerResolver(module.graph, snapshot.world, snapshot.party));
        const language = await playLanguageOf(context, snapshot.meta);
        await stanceTable(context);
        const n = number(turn.turn), pending = {
            name: `ask-${asciiSlug(binds || '') || kind}-t${n}`,
            prompt,
            options: [...options],
            binds,
            kind
        };
        const rendered = delivery.rendered_text, projected = mechanics(receipts, placed, await snapshot.handoutTexts(receipts)), labels = await playerGlossary(context, language);
        const standing = standingStates(snapshot.party, receipts);
        const result: Row = {
            pending_choice: pending,
            interaction: {
                ...pending,
                play_language: language
            },
            ...delivery,
            mechanics: projected,
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
            closed_how: 'explicit',
            director_adoption: await adoption(campaign, module, turn, world, 'ask')
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
    async function narrate(params: Row, report?: ProgressReporter): Promise<Row> {
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
        const text = required(params, 'text')!, receipts = [...array(turn.receipts)];
        const { placed, ...delivery } = deliveryText(text, receipts, speakerResolver(module.graph, snapshot.world, snapshot.party)), rendered = delivery.rendered_text;
        const language = await playLanguageOf(context, snapshot.meta);
        // Nothing is read out of the prose. Figures travel as the mechanics projection and the
        // frontend draws them (2026-09-09 user decision, contract section 16.3); whether the words
        // are in the play language is the verifier lane's finding, not a refusal (section 23).
        await stanceTable(context);
        report?.('validate');
        const projected = mechanics(receipts, placed, await snapshot.handoutTexts(receipts)), n = number(turn.turn), receipt = `turn:${n}`, world = tableSnapshot(snapshot, module.graph);
        // The public record the verifier reads beside the Keeper-only list (contract §32.6): the two deliveries before this one.
        const earlier = (await Promise.all([number(turn.turn) - 1, number(turn.turn) - 2].filter(t => t >= 0).map(t => campaign.readTurnRecord(t)))).flatMap(r => r ? [r] : []);
        const factLists = facts(module.graph, snapshot.world, snapshot.party, receipts, world, turn.player_text,
            publicContext(snapshot.party, row(row(snapshot.meta.setup).handoff).prologue, earlier)), labels = await playerGlossary(context, language);
        report?.('project');
        const standing = standingStates(snapshot.party, receipts);
        const result: Row = {
            ...delivery,
            mechanics: projected,
            ...(standing.length ? { standing } : {}),
            labels,
            turn: n,
            receipt,
            commit: null,
            facts: factLists,
            extraction: {
                job_id: `extract:${campaign.id}:t${n}`
            }
        };
        const before = clone(turn), transcriptSize = await fileSize(campaign.path('transcript.jsonl')), eventsSize = await fileSize(campaign.path('events.jsonl'));
        const recordPath = campaign.path(campaign.recordName(n)), hadRecord = await context.snapshots.pathExists(recordPath);
        rememberCall(turn, started.callId, params, result);
        const record: Row = {
            ...deliveryRecord(turn, text, receipts, result, world),
            ...(delivery.marked_text ? { marked_text: delivery.marked_text } : {}),
            closed_by: 'narrate',
            closed_how: truth(params.implicit) ? 'implicit' : 'explicit',
            facts: factLists,
            director_adoption: await adoption(campaign, module, turn, world, 'narrate'),
            worldline: turn.worldline ?? null
        };
        await campaign.writeTurnRecord(record);
        await updateNpcLedger(campaign, module.graph, record);
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
            await campaign.writeCampaign(priorMeta);
            if (before.state === 'open')
                before.state = 'acting';
            await campaign.writeTurn(before);
            await truncateFile(campaign.path('transcript.jsonl'), transcriptSize);
            await truncateFile(campaign.path('events.jsonl'), eventsSize);
            if (!hadRecord)
                await unlink(recordPath).catch(error => {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                        throw error;
                });
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
        // A failed commit throws above, so this frame only ever announces a real commit.
        report?.('commit');
        record.commit = sha;
        record.calls[started.callId].result.commit = sha;
        await campaign.writeTurnRecord(record);
        const postStep=async(step:string,action:()=>Promise<unknown>)=>{try{await action();}catch(error){await campaign.telemetry({lane:'kernel',step,turn:n,ok:false,error:internalError(error).message});}};
        const moves=isJsonObject(record.worldline)&&truth(record.worldline.operation);
        let checkpointRecord=record,checkpointWorld=world,moved:Row|null=null;
        const checkpoint=async()=>writeCheckpoint(campaign,checkpointFromRecord(campaign.id,checkpointRecord,checkpointWorld,activeName(await campaign.readCampaign())));
        if(!moves)await postStep('checkpoint',checkpoint);
        if(contributions.libraryWriteBack)await postStep('library',()=>contributions.libraryWriteBack!(campaign,record));
        await postStep('episode',()=>writeEpisode(campaign,record));
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
        sourceGraphPath,
        handlers: Object.freeze({
            'campaign.create': create,
            'table.open': open,
            'table.player_input': playerInput,
            'table.release': release,
            'table.ask': ask,
            'table.narrate': narrate
        }),
        async transaction(params, options = {}) { const { campaign, snapshot } = await load(params, options); return createTurnTransaction(campaign, snapshot.world, snapshot.turn); }
    };
}
