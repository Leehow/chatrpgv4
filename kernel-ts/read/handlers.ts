/** Static read RPC group. Turn transitions remain the transaction slice's responsibility. */
import { join } from "node:path";
import type { KernelContext } from "../context.js";
import type { HandlerGroup, KernelResult } from "../handlers.js";
import { RpcError } from "../errors.js";
import { continuityView } from "./continuity.js";
import { isJsonObject } from "../json.js";
import { playLanguageOf } from "./languages.js";
import { CampaignSnapshot, loadModule, loadCampaignModule, replayTrail, type LoadedModule } from "./campaign.js";
import { ModuleGraph, recordOf } from "./module-graph.js";
import { SessionView } from "./session-view.js";
import { RuleObservations } from "./rule-facts.js";
import { buildCapsule } from "./assemble.js";
import { clockSection, sceneLabel, clueLabel, npcsPresent, cluesHere, whereSection, presentSection, npcView, investigatorView, fittedModuleSection } from "./capsule.js";
import { crossLineReader } from "./worldline.js";
import { mechanics } from "./mechanics.js";
import { publicSheet, objectLook } from "./mods.js";
import { array, row, entries, number, truth, string, repr, normalize, clone, sorted, type Row } from "./values.js";
const LOOK_FOCUS = ["clues", "investigator", "npc", "object", "scene", "session", "time"];
const LOOKUP_KINDS = ["catalog", "module", "rule", "secret", "continuity"];
export type RuleLookup = (campaign: CampaignSnapshot, module: LoadedModule, params: Row) => Promise<KernelResult>;
export interface ReadContributions {
    repairLegacyTrail?(campaign: CampaignSnapshot): Promise<void>;
    touchActing?(campaign: CampaignSnapshot): Promise<void>;
    capsule?(campaign: CampaignSnapshot, module: LoadedModule): Promise<KernelResult>;
    lookupRules?: RuleLookup;
}
export function unsupported(field: string, value: any, options: string[], message?: string): never {
    throw new RpcError("invalid_params", message ?? `unsupported ${field} ${repr(value)}`, {
        fix: `use one of details.options: ${options.join(", ")}`,
        details: {
            field,
            options
        }
    });
}
function required(params: Row, key: string): string {
    if (typeof params[key] !== "string" || !params[key].trim())
        throw new RpcError("invalid_params", `params.${key} must be a non-empty string`);
    return params[key];
}
const unfinished = (message: string): never => {
    throw new RpcError("not_implemented", message);
};
/**
 * The player's glossary: the union of every `localized_labels` row in the rules data for
 * `language`, whatever file or nesting the row sits in, keyed as the panel looks a term up --
 * the row's own key, its `name` and its `abbreviation` (contract §23). No file list, no key
 * whitelist, no tag shortcut: a language whose canonical words are the keys simply has no rows.
 * The first row to claim a key keeps it, in file-name order and then document order, so two
 * files naming one key cannot flicker. Unreadable display data contributes no invented label.
 */
export function playerGlossary(context: KernelContext, language: string): Promise<Row> {
    if (typeof language !== "string" || !language.trim())
        return Promise.resolve({});
    let byLanguage = glossaries.get(context);
    if (!byLanguage)
        glossaries.set(context, byLanguage = new Map());
    let pending = byLanguage.get(language);
    if (!pending) {
        pending = readGlossary(context, language);
        byLanguage.set(language, pending);
        void pending.catch(() => byLanguage!.delete(language));
    }
    return pending.then(clone);
}
/** Rules data is immutable while a kernel runs, so one read per context and language serves every view. */
const glossaries = new WeakMap<KernelContext, Map<string, Promise<Row>>>();
async function readGlossary(context: KernelContext, language: string): Promise<Row> {
    const result: Row = {};
    const root = join(context.content, "rulesets", "coc7", "rules-json"),
        claim = (key: unknown, word: string) => {
            if (typeof key === "string" && key.trim() && !Object.hasOwn(result, key.trim()))
                result[key.trim()] = word;
        },
        visit = (value: unknown, key: string | null): void => {
            if (Array.isArray(value)) {
                for (const item of value)
                    visit(item, null);
                return;
            }
            if (!isJsonObject(value))
                return;
            const word = row(value.localized_labels)[language];
            if (typeof word === "string" && word.trim()) {
                claim(key, word.trim());
                claim(value.name, word.trim());
                claim(value.abbreviation, word.trim());
            }
            for (const [child, inner] of entries(value))
                if (child !== "localized_labels")
                    visit(inner, child);
        };
    const names = await context.snapshots.sortedChildNames(root, async path => path.endsWith(".json") && await context.snapshots.isFile(path));
    for (const name of names) {
        let document: unknown;
        try {
            document = await context.snapshots.readJson(join(root, name));
        }
        catch {
            continue;
        }
        visit(document, null);
    }
    return result;
}
export function actor(party: Row[], name?: any): Row {
    if (name == null) {
        if (party.length === 1)
            return party[0];
        throw new RpcError("needs_choice", "several investigators at the table; name the actor", { details: { candidates: party.map(sheet => sheet.name ?? null) } });
    }
    if (typeof name !== "string")
        throw new RpcError("invalid_params", "actor must be a string");
    const found = party.find(sheet => [normalize(sheet.id), normalize(sheet.name)].includes(normalize(name)));
    if (found)
        return found;
    throw new RpcError("unknown_entity", `no investigator ${repr(name)} at the table`, { details: {
            query: name,
            candidates: party.map(sheet => ({
                name: sheet.name ?? null,
                kind: "investigator",
                display_name: sheet.id ?? null
            }))
        } });
}
export function tableSnapshot(campaign: CampaignSnapshot, graph: ModuleGraph): Row {
    const scene = graph.scene(campaign.world.active_scene),
        view = new SessionView(campaign, graph, campaign.party, campaign.world),
        session = view.activeSession();
    return {
        scene: {
            name: graph.handle(scene),
            display_name: sceneLabel(graph, campaign.world, scene)
        },
        clock: { minutes: number(row(campaign.world.clock).minutes) },
        present: npcsPresent(graph, campaign.world, scene).map(node => graph.displayName(node)),
        investigators: campaign.party.map(sheet => ({
            id: sheet.id ?? null,
            name: sheet.name ?? null,
            hp: sheet.current_hp ?? null,
            san: sheet.current_san ?? null,
            mp: sheet.current_mp ?? null,
            luck: sheet.current_luck ?? null
        })),
        session: session ? {
            kind: session.kind ?? null,
            status: session.status ?? null,
            round: session.round ?? null
        } : null,
        pending_choice: view.pendingChoice()
    };
}
export async function readCampaign(context: KernelContext, params: Row, frontend = false, minimal = false, contributions: ReadContributions = {}): Promise<{
    campaign: CampaignSnapshot;
    module: LoadedModule;
}> {
    const campaign = await CampaignSnapshot.open(context, params.campaign),
        statuses = frontend ? ["active", "ready_for_table", "completed"] : ["active", "completed"],
        status = string(campaign.meta.status);
    if (!statuses.includes(status)) {
        let fix: string | undefined;
        if (status === "setting_up") {
            const steps = row(await context.snapshots.readJson(join(context.content, "setup", "steps.json")));
            fix = string(steps.table_open_fix).replaceAll("{campaign}", campaign.id);
        }
        throw new RpcError("campaign_not_ready", `campaign ${repr(campaign.id)} is ${repr(status)}`, {
            ...(fix ? { fix } : {}),
            details: { status }
        });
    }
    const module = await loadCampaignModule(context, string(campaign.meta.module_id), campaign.world);
    if (!minimal)
        await campaign.preload(frontend ? "view" : "all");
    if (!Object.hasOwn(campaign.world, "scene_trail")) {
        if (!frontend) {
            const repair = contributions.repairLegacyTrail;
            if (!repair)
                return unfinished("Reading this legacy snapshot requires scene-trail persistence; the transaction slice is not implemented");
            await repair(campaign);
            if (!Object.hasOwn(campaign.world, "scene_trail"))
                throw new RpcError("internal", "Legacy trail repair did not refresh the operation snapshot");
        } else {
            campaign.world = {
                ...campaign.world,
                scene_trail: replayTrail(await campaign.replayEvents())
            };
        }
    }
    return {
        campaign,
        module
    };
}
async function requireNoTransition(campaign: CampaignSnapshot, contributions: ReadContributions) {
    if (contributions.touchActing)
        await contributions.touchActing(campaign);
    if (campaign.turn.state === "open")
        unfinished("This read requires the open-to-acting transition; the transaction slice is not implemented");
}
async function present(campaign: CampaignSnapshot, module: LoadedModule): Promise<Row[]> {
    const { graph } = module,
        scene = graph.scene(campaign.world.active_scene);
    return presentSection(graph, campaign.world, scene, row(campaign.jsonFiles.get("npc-ledger.json")), campaign.logs.get("memory/candidates.jsonl") ?? []);
}
/** The player's NPC notebook: newest-seen first, at most six exchanges each, newest first. The journal never
 *  stores death; `dead_since_turn` is merged from the ledger, the sole truth, at projection time. */
async function npcJournalSection(campaign: CampaignSnapshot): Promise<Row[]> {
    let stored: Row = {}, ledger: Row = {};
    try {
        stored = row(await campaign.optional("npc-journal.json"));
    }
    catch { /* A derived cache that cannot be read projects as empty, never as a broken sheet. */ }
    try {
        ledger = row(await campaign.optional("npc-ledger.json"));
    }
    catch { /* Death simply does not project when the ledger cannot be read. */ }
    return Object.entries(row(stored.entries)).map(([id, value]) => {
        const entry = row(value), dead = row(row(ledger[id]).dead);
        return {
            name: string(entry.name),
            description: string(entry.description),
            seen_count: number(entry.seen_count),
            last_seen_turn: number(entry.last_seen_turn),
            ...(truth(dead) ? { dead_since_turn: number(dead.turn) } : {}),
            exchanges: array(entry.exchanges).slice(-6).reverse().map(exchange => ({
                turn: number(exchange.turn),
                scene: string(exchange.scene),
                summary: string(exchange.summary)
            }))
        };
    }).sort((left, right) => number(right.last_seen_turn) - number(left.last_seen_turn));
}
export async function sceneView(campaign: CampaignSnapshot, module: LoadedModule): Promise<Row> {
    const { graph, material } = module,
        where = whereSection(graph, campaign.world, graph.scene(campaign.world.active_scene), material),
        rules = await RuleObservations.load(campaign.context);
    where.situations = await rules.situations(campaign, graph, campaign.world, campaign.turn);
    where.session = new SessionView(campaign, graph, campaign.party, campaign.world).activeSession();
    return {
        where,
        present: await present(campaign, module),
        ...(number(campaign.turn.turn) === 0 ? { module: fittedModuleSection(graph)[0] } : {})
    };
}
export async function tableView(context: KernelContext, params: Row): Promise<Row> {
    const initial = await CampaignSnapshot.open(context, params.campaign, false, false),
        language = await playLanguageOf(context, initial.meta);
    if (initial.meta.status === "setting_up")
        return {
            play_language: language,
            state: "setting_up",
            investigators: (await initial.files("party")).map(investigatorView),
            clues: { discovered: [] },
            npcs: { journal: [] },
            labels: await playerGlossary(context, language)
        };
    const { campaign, module } = await readCampaign(context, params, true),
        { graph } = module,
        snapshot = tableSnapshot(campaign, graph),
        { world, turn } = campaign;
    const discovered = array(world.discovered_clues).map(handle => {
        const label = clueLabel(graph, world, handle),
            node = graph.find(handle, ["clue"]),
            summary = typeof node?.summary === "string" ? node.summary.trim() : null;
        return {
            clue: handle,
            label,
            ...(summary && summary !== label ? { summary } : {})
        };
    });
    return {
        ...snapshot,
        clock: clockSection(graph, world),
        pending_choice: truth(turn.pending_choice) ? turn.pending_choice : snapshot.pending_choice,
        play_language: language,
        turn: turn.turn,
        state: turn.state,
        investigators: campaign.party.map(sheet => publicSheet(world, investigatorView(sheet))),
        clues: { discovered },
        npcs: { journal: await npcJournalSection(campaign) },
        labels: await playerGlossary(context, language)
    };
}
export function readHandlers(context: KernelContext, contributions: ReadContributions = {}): HandlerGroup {
    return Object.freeze({
        "table.view": async (params) => tableView(context, params),
        "table.status": async (params) => {
            const { campaign } = await readCampaign(context, params, false, true, contributions),
                { turn } = campaign,
                receipts = array(turn.receipts);
            return {
                turn: turn.turn,
                state: turn.state,
                receipts,
                mechanics: mechanics(receipts, {}, await campaign.handoutTexts(receipts)),
                pending_choice: turn.pending_choice ?? null
            };
        },
        "table.capsule": async (params) => {
            const { campaign, module } = await readCampaign(context, params, false, false, contributions);
            return contributions.capsule ? contributions.capsule(campaign, module) : buildCapsule(campaign, module);
        },
        "table.look": async (params) => {
            const { campaign, module } = await readCampaign(context, params, false, true, contributions),
                { graph } = module,
                { world } = campaign,
                focus = params.focus || "scene";
            if (typeof focus !== "string" || !LOOK_FOCUS.includes(focus))
                unsupported("focus", focus, LOOK_FOCUS, `unknown focus ${repr(focus)}`);
            await requireNoTransition(campaign, contributions);
            const scene = graph.scene(world.active_scene);
            if (focus === "object")
                return objectLook(world, params.name);
            if (focus === "scene") {
                await campaign.preload();
                return sceneView(campaign, module);
            }
            if (focus === "npc") {
                if (params.name == null) {
                    await campaign.preload("people");
                    return { present: await present(campaign, module) };
                }
                let ledger: Row = {};
                try {
                    ledger = row(await campaign.optional("npc-ledger.json"));
                }
                catch { /* Existing NPC views tolerate a missing or unreadable ledger. */
                }
                return npcView(graph, world, graph.npc(required(params, "name")), ledger);
            }
            if (focus === "investigator") {
                campaign.party = await campaign.files("party");
                return investigatorView(actor(campaign.party, params.name));
            }
            if (focus === "clues")
                return {
                    discovered_clues: [...array(world.discovered_clues)],
                    clues_here: cluesHere(graph, world, scene)
                };
            if (focus === "session") {
                await campaign.preload("view");
                const view = new SessionView(campaign, graph, campaign.party, world);
                return {
                    session: view.activeSession(),
                    pending_choice: view.pendingChoice()
                };
            }
            return { clock: truth(world.clock) ? world.clock : { minutes: 0 } };
        },
        "table.lookup": async (params): Promise<KernelResult> => {
            const { campaign, module: activeModule } = await readCampaign(context, params, false, true, contributions),
                module = params.canonical_source === true ? await loadModule(context, campaign.meta.module_id) : activeModule,
                { graph } = module,
                { world } = campaign,
                kind = params.kind;
            if (typeof kind !== "string" || !LOOKUP_KINDS.includes(kind))
                unsupported("kind", kind, LOOKUP_KINDS, `unknown lookup kind ${repr(kind)}`);
            await requireNoTransition(campaign, contributions);
            if (kind === 'continuity') {
                await campaign.preload();
                return continuityView(graph, world, campaign.records, await campaign.log('memory/candidates.jsonl'), params);
            }
            if (kind === "module") {
                const query = required(params, "query");
                const expected = params.expected_kind;
                const expectedKinds = ['scene', 'npc', 'clue', 'object', 'handout'];
                if (expected != null && (typeof expected !== 'string' || !expectedKinds.includes(expected)))
                    unsupported('expected_kind', expected, expectedKinds, 'unknown expected module entity kind');
                const entities = graph.search(query, expected ? 64 : 8).filter(node => !expected || node.node_kind === expected).slice(0, 8).map(node => graph.entityView(node));
                const scene = !entities.length && typeof world.active_scene === 'string' ? graph.find(world.active_scene, ['scene']) : null;
                const sourceNodes = array(row(scene?.campaign_origin).sources).map(id => graph.nodes.get(id)).filter((node): node is Row => node !== undefined);
                const missingScene = !entities.length && expected === 'scene';
                return {
                    query,
                    ...(expected ? {expected_kind: expected} : {}),
                    entities,
                    ...(!entities.length ? {
                        status: 'not_found',
                        note: missingScene
                            ? 'This explicitly requested destination scene is absent. Prepare and review it before movement or arrival narration.'
                            : 'No graph entity matched. Do not open graph adaptation for a physical object or a compatible first-appearance supporting person. Use define/object/item for physical state; ordinary scenery and a one-off person may remain narration. If the player actually chose a missing destination, repeat this lookup with expected_kind scene.',
                        ...(missingScene ? {preparation: {tool: 'lookup', kind: 'adaptation', action: 'prepare', purpose: 'new_destination', name: query.slice(0, 120),
                            anchors: (sourceNodes.length ? sourceNodes : scene ? [scene] : []).slice(0, 4).map(node => node.name),
                            request: 'Describe the player-chosen destination and its limited connection to the existing campaign. Preserve source causes and all established facts; no automatic clue, NPC appearance, danger or movement.'}} : {})
                    } : {})
                };
            }
            if (kind === "rule" || kind === "catalog") {
                const lookup = contributions.lookupRules;
                if (!lookup)
                    return unfinished(`table.lookup kind=${kind} is not implemented in the TypeScript kernel`);
                return lookup(campaign, module, params);
            }
            const scope = params.scope || "scene";
            if (scope !== "scene" && scope !== "module")
                unsupported("scope", scope, ["scene", "module"]);
            const secrets = graph.kind("secret").map(node => ({
                name: graph.handle(node),
                summary: graph.summary(node)
            }));
            if (scope === "module")
                return {
                    scope,
                    module_secrets: secrets,
                    conclusions: graph.kind("conclusion").map(node => ({
                        name: graph.handle(node),
                        summary: graph.summary(node),
                        importance: recordOf(node).importance ?? null,
                        minimum_routes: recordOf(node).minimum_routes ?? null
                    })),
                    // What the book awards for reaching an ending, and what it asks for first. The
                    // authors write this on the scene that ends, with a rule_ref into the ruleset;
                    // nothing read it until now, so the Keeper -- told to read the source rewards
                    // before settling -- had to guess one (contract §32.9). An empty list is the
                    // answer that this module declares none, and an undeclared reward is omitted.
                    endings: graph.kind("scene").flatMap(node => {
                        const contract = row(recordOf(node).conclusion_contract);
                        if (!truth(contract))
                            return [];
                        return [{
                            scene: graph.handle(node),
                            conclusion: contract.conclusion_id ?? null,
                            sanity_reward: row(contract.sanity_reward).die ?? null,
                            rule: row(contract.sanity_reward).rule_ref ?? null,
                            requires: contract.requires_combat_outcome ?? null,
                            ends_session: contract.session_ending === true
                        }];
                    })
                };
            await campaign.preload("people");
            const scene = graph.scene(world.active_scene),
                where = whereSection(graph, world, scene),
                nodes = npcsPresent(graph, world, scene),
                across = await crossLineReader(campaign, graph, world, nodes);
            return {
                scope,
                scene: {
                    name: where.scene,
                    display_name: where.display_name,
                    dramatic_question: where.dramatic_question,
                    pressure_moves: where.pressure_moves,
                    keeper_notes: where.keeper_notes
                },
                undiscovered_clues: cluesHere(graph, world, scene).filter(c => !c.discovered),
                npc_secrets: nodes.map(node => {
                    const elsewhere = across(node);
                    return {
                        name: graph.displayName(node),
                        secret: recordOf(node).secret ?? null,
                        agenda: recordOf(node).agenda ?? null,
                        ...(elsewhere.length ? { from_other_lines: elsewhere } : {})
                    };
                }),
                module_secrets: secrets
            };
        },
    } satisfies HandlerGroup);
}
