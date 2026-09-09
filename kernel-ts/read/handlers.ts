/** Static read RPC group. Turn transitions remain the transaction slice's responsibility. */
import { join } from "node:path";
import type { KernelContext } from "../context.js";
import type { HandlerGroup, KernelResult } from "../handlers.js";
import { RpcError } from "../errors.js";
import { CampaignSnapshot, loadModule, replayTrail, type LoadedModule } from "./campaign.js";
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
const LOOKUP_KINDS = ["catalog", "module", "rule", "secret"];
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
export async function playerGlossary(context: KernelContext, language: string): Promise<Row> {
    if (!language || language === "en")
        return {};
    const result: Row = {},
        root = join(context.content, "rulesets", "coc7", "rules-json"),
        label = (entry: Row) => {
        const value = row(entry.localized_labels)[language];
        return typeof value === "string" && value.trim() ? value.trim() : null;
    };
    let characteristics: Row = {},
        skills: Row = {};
    try {
        characteristics = row(row(await context.snapshots.readJson(join(root, "characteristic-dice.json"))).characteristics);
    }
    catch { /* Missing display data contributes no invented label. */
    }
    for (const [key, entry] of entries(characteristics)) {
        const abbr = key.toUpperCase(),
            word = label(row(entry));
        if (["STR", "DEX", "INT", "POW", "CON", "APP", "SIZ", "EDU", "LUCK"].includes(abbr) && word) {
            result[abbr] = word;
            if (typeof entry.name === "string" && entry.name.trim() && entry.name.trim() !== abbr)
                result[entry.name.trim()] = word;
        }
    }
    try {
        skills = row(row(await context.snapshots.readJson(join(root, "skills.json"))).skills);
    }
    catch { /* This matches the existing read-only glossary fallback. */
    }
    for (const [name, entry] of entries(skills)) {
        const word = label(row(entry));
        if (word)
            result[name] = word;
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
    const module = await loadModule(context, string(campaign.meta.module_id));
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
        language = string(initial.meta.play_language || "zh-Hans");
    if (initial.meta.status === "setting_up")
        return {
            play_language: language,
            state: "setting_up",
            investigators: (await initial.files("party")).map(investigatorView),
            clues: { discovered: [] },
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
            const { campaign, module } = await readCampaign(context, params, false, true, contributions),
                { graph } = module,
                { world } = campaign,
                kind = params.kind;
            if (typeof kind !== "string" || !LOOKUP_KINDS.includes(kind))
                unsupported("kind", kind, LOOKUP_KINDS, `unknown lookup kind ${repr(kind)}`);
            await requireNoTransition(campaign, contributions);
            if (kind === "module") {
                const query = required(params, "query");
                return {
                    query,
                    entities: graph.search(query).map(node => graph.entityView(node))
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
                    }))
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
