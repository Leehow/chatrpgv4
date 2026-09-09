/** An operation's immutable saved inputs, loaded through the foundation read capability. */
import { join, relative, resolve, sep } from "node:path";
import { realpath, readFile } from "node:fs/promises";
import type { KernelContext } from "../context.js";
import { RpcError } from "../errors.js";
import { sha256File } from "../fileio.js";
import { parsePythonJson } from "../json.js";
import { ModuleGraph } from "./module-graph.js";
import { array, row, clone, normalize, stripPrefix, number, repr, type Row } from "./values.js";
export class CampaignSnapshot {
    readonly dir: string;
    readonly jsonFiles = new Map<string, any>();
    readonly logs = new Map<string, Row[]>();
    readonly textFiles = new Map<string, string>();
    meta: Row = {};
    world: Row = {};
    turn: Row = {};
    party: Row[] = [];
    records: Row[] = [];
    constructor(readonly context: KernelContext, readonly id: string) {
        this.dir = join(context.campaignsRoot, id);
    }
    async optional(path: string): Promise<any> {
        if (this.jsonFiles.has(path))
            return this.jsonFiles.get(path);
        const value = await this.context.snapshots.pathExists(join(this.dir, path)) ? await this.context.snapshots.readJson(join(this.dir, path)) : null;
        this.jsonFiles.set(path, value);
        return value;
    }
    async log(path: string): Promise<Row[]> {
        if (!this.logs.has(path))
            this.logs.set(path, (await this.context.snapshots.readJsonl(join(this.dir, path))).map(row));
        return this.logs.get(path)!;
    }
    async files(directory: string): Promise<Row[]> {
        const names = await this.context.snapshots.sortedChildNames(join(this.dir, directory), path => this.context.snapshots.isFile(path));
        return Promise.all(names.filter(name => name.endsWith(".json")).map(async (name) => row(await this.optional(join(directory, name)))));
    }
    saved(path: string): Row | null {
        const value = this.jsonFiles.get(join("save", path));
        return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    }
    healing(id: string): Row {
        return this.saved(join("healing-state", `${id}.json`)) ?? {};
    }
    sanity(id: string): Row | null {
        return this.saved(join("sanity-state", `${id}.json`));
    }
    async preload(mode: "all" | "view" | "people" = "all"): Promise<void> {
        this.party = await this.files("party");
        if (mode === "all")
            this.records = await this.files("turns");
        const saves = mode === "people" ? [] : ["combat.json", "chase.json"];
        for (const sheet of this.party) {
            saves.push(`sanity-state/${sheet.id}.json`);
            if (mode === "all")
                saves.push(`healing-state/${sheet.id}.json`, `sanity-gain-pending/${sheet.id}.json`);
        }
        if (mode !== "people")
            await Promise.all(saves.map(path => this.optional(join("save", path))));
        if (mode === "view")
            return;
        for (const path of ["npc-ledger.json", ...(mode === "all" ? ["save/worldlines/anchor.json", "save/worldlines/echoes.json"] : [])]) {
            try {
                await this.optional(path);
            }
            catch {
                this.jsonFiles.set(path, null);
            }
        }
        await Promise.all(["memory/candidates.jsonl", ...(mode === "all" ? ["notes.jsonl", "rulings.jsonl"] : [])].map(path => this.log(path)));
    }
    async replayEvents(): Promise<Row[]> {
        let text: string;
        try {
            text = await readFile(join(this.dir, "events.jsonl"), "utf8");
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return [];
            throw error;
        }
        const events: Row[] = [];
        for (const line of text.split(/\r?\n/)) {
            try {
                events.push(row(parsePythonJson(line)));
            }
            catch { /* Legacy trail replay skips malformed event rows. */
            }
        }
        return events;
    }
    static async open(context: KernelContext, id: any, requireWorld = true, requireTurn = true): Promise<CampaignSnapshot> {
        if (typeof id !== "string" || !id)
            throw new RpcError("invalid_params", "params.campaign is required");
        const snapshot = new CampaignSnapshot(context, id);
        if (!await context.snapshots.pathExists(join(snapshot.dir, "campaign.json")))
            throw new RpcError("campaign_not_found", `no campaign ${repr(id)}`, {
                fix: "call campaign.list, or campaign.create",
                details: { campaigns: await context.snapshots.sortedChildNames(context.campaignsRoot, path => context.snapshots.pathExists(join(path, "campaign.json"))) }
            });
        snapshot.meta = row(await snapshot.optional("campaign.json"));
        for (const file of [...(requireWorld ? ["world.json"] : []), ...(requireTurn ? ["turn.json"] : [])])
            if (!await context.snapshots.pathExists(join(snapshot.dir, file)))
                throw new RpcError("campaign_not_ready", `campaign ${repr(id)} is missing ${file}`);
        snapshot.world = row(await snapshot.optional("world.json"));
        snapshot.turn = row(await snapshot.optional("turn.json"));
        return snapshot;
    }
    async handoutTexts(receipts: Row[]): Promise<Map<string, string>> {
        const texts = new Map<string, string>();
        for (const receipt of receipts) {
            const attachment = row(receipt.attachment);
            if (receipt.kind !== "handout" || typeof attachment.path !== "string" || !attachment.path || typeof attachment.media_type !== "string" || !attachment.media_type.startsWith("text/"))
                continue;
            try {
                texts.set(attachment.path, new TextDecoder("utf-8", { fatal: true }).decode(await readFile(attachment.path)));
            }
            catch (error) {
                if (error instanceof TypeError)
                    throw error;
            }
        }
        return texts;
    }
}
export interface LoadedModule {
    graph: ModuleGraph;
    meta: Row;
    generation: number;
    path: string;
    material(name: string): string;
}
export async function loadModule(context: KernelContext, id: string): Promise<LoadedModule> {
    const moduleRoot = join(context.stateRoot, "modules", id),
        metadataPath = join(moduleRoot, "module.json");
    const meta = await context.snapshots.pathExists(metadataPath) ? row(await context.snapshots.readJson(metadataPath)) : {};
    const generation = number(meta.generation),
        registered = Object.keys(meta).length > 0;
    let path = join(context.content, "starters", id, "module-graph.json");
    if (registered && generation) {
        path = join(moduleRoot, "module-graph.json");
        if (typeof meta.graph_file === "string") {
            path = resolve(moduleRoot, meta.graph_file);
            const base = await realpath(moduleRoot),
                actual = await realpath(path).catch(() => path),
                inside = relative(base, actual);
            if (inside === ".." || inside.startsWith(".." + sep) || resolve(base, inside) !== actual)
                throw new Error("graph_file escapes the module store");
        }
    }
    if (!await context.snapshots.pathExists(path)) {
        const choices = await context.snapshots.sortedChildNames(join(context.content, "starters"), child => context.snapshots.pathExists(join(child, "module-graph.json")));
        throw new RpcError("invalid_params", `unknown module ${repr(id)}`, {
            fix: `use one of details.options: ${choices.join(", ")}`,
            details: {
                field: "module",
                options: choices
            }
        });
    }
    const raw = row(await context.snapshots.readJson(path)),
        contract = row(await context.snapshots.readJson(join(context.content, "modules", "module-graph-contract-v3.json")));
    const graph = new ModuleGraph(id, raw, await sha256File(path), row(contract.actor_dossier));
    const material = (name: string) => {
        if (!registered || !meta.reading_version)
            return "ready";
        const key = normalize(name),
            matches = array(raw.nodes).filter(n => [n.node_id, stripPrefix(n.node_id, n.node_kind), n.name || "", ...array(n.aliases)].some(v => normalize(v) === key)).map(n => n.node_id);
        const ready = new Set(array(row(meta.reading).materials).flatMap(m => array(m.node_ids)));
        return matches.length > 0 && matches.every(id => ready.has(id)) ? "ready" : "missing";
    };
    return {
        graph,
        meta,
        generation,
        path,
        material
    };
}
export function replayTrail(events: Row[]): string[] {
    const trail: string[] = [];
    for (const event of events) {
        if (event.type !== "scene-moved")
            continue;
        const data = row(event.data),
            source = String(data.from ?? "None"),
            destination = String(data.to ?? "None");
        if (trail.includes(destination))
            trail.splice(trail.indexOf(destination));
        else
            trail.push(source);
    }
    return trail;
}
