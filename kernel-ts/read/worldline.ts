/** Worldline/echo/memory projections consume saved data and the foundation Git reader. */
import { isJsonObject, parsePythonJson, compareUnicode } from "../json.js";
import { CampaignSnapshot } from "./campaign.js";
import { ModuleGraph, recordOf } from "./module-graph.js";
import { EntityIndex, kindRank, fromOtherLines } from "./memory.js";
import { array, row, truth, string, number, sorted, type Row } from "./values.js";
export const activeName = (meta: Row): string => typeof meta.active_worldline === "string" && meta.active_worldline ? meta.active_worldline : "main";
export const activeLine = (meta: Row): Row => row(meta.worldlines)[activeName(meta)] ?? {
    name: activeName(meta),
    kind: "main",
    loop: 0,
    status: "active",
    last_turn: null
};
export function remembersAcrossLoops(graph: ModuleGraph, node: Row): boolean {
    return recordOf(node).remembers_across_loops === true || row(node.properties).remembers_across_loops === true || (graph.out.get(node.node_id) ?? []).some(rel => rel.relation_kind === "knows" && row(rel.properties).across_loops === true);
}
function here(graph: ModuleGraph, scene: Row, id: string): boolean {
    return id === scene.node_id || [...(graph.out.get(scene.node_id) ?? []), ...(graph.incoming.get(scene.node_id) ?? [])].some(rel => ["contains", "occurs-at", "present-in", "located-in", "discoverable-at"].includes(rel.relation_kind) && [rel.from_node_id, rel.to_node_id].includes(id));
}
export function loopAvailable(graph: ModuleGraph, scene: Row): boolean {
    return array(graph.raw.relations).some(rel => rel.relation_kind === "resets-to" && here(graph, scene, string(rel.from_node_id)));
}
function loopAnchor(graph: ModuleGraph, scene: Row): Row | null {
    const relations = array(graph.raw.relations).filter(rel => rel.relation_kind === "resets-to").sort((a, b) => compareUnicode(string(a.from_node_id), string(b.from_node_id)) || compareUnicode(string(a.to_node_id), string(b.to_node_id)));
    const chosen = relations.find(rel => here(graph, scene, string(rel.from_node_id))) ?? relations[0];
    return chosen ? graph.nodes.get(string(chosen.to_node_id)) ?? null : null;
}
export async function worldlineSection(campaign: CampaignSnapshot, graph: ModuleGraph, world: Row, scene: Row, present: Row[]): Promise<Row> {
    const current = activeLine(campaign.meta),
        lines = row(campaign.meta.worldlines),
        loop = number(current.loop),
        stored = campaign.saved("worldlines/anchor.json"),
        anchor = truth(stored?.world) ? stored : null;
    let anchorView: Row | null = anchor ? {
        scene: anchor.scene ?? null,
        since_turn: anchor.turn ?? null
    } : null;
    if (!anchor) {
        const found = loopAnchor(graph, scene);
        if (found) {
            const handle = graph.handle(found);
            let since: number | null = null;
            if (string(campaign.meta.opening_scene || "") === handle)
                since = await campaign.context.git.rootCommit(campaign.id) ? 0 : null;
            else {
                const record = [...campaign.records].sort((a, b) => number(a.turn) - number(b.turn)).find(record => string(row(row(record.world).scene).name || "") === handle && truth(record.commit));
                if (record)
                    since = number(record.turn);
            }
            anchorView = {
                scene: handle,
                since_turn: since
            };
        }
    }
    const rawEchoes = campaign.jsonFiles.get("save/worldlines/echoes.json"),
        echoes = (Array.isArray(rawEchoes) ? rawEchoes : array(row(rawEchoes).echoes)).filter(echo => string(echo.scene || "") === graph.handle(scene) && !array(world.discovered_echoes).map(string).includes(string(echo.id))).sort((a, b) => compareUnicode(string(a.line), string(b.line)) || number(a.turn) - number(b.turn) || compareUnicode(string(a.id), string(b.id)));
    const previous = loop <= 0 ? [] : (campaign.logs.get("memory/candidates.jsonl") ?? []).filter(value => number(value.loop) === loop - 1 && value.superseded_by == null).sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || number(b.valid_from_turn) - number(a.valid_from_turn) || compareUnicode(string(a.id), string(b.id))).slice(0, 4).map(value => ({
        statement: value.statement ?? null,
        turn: value.valid_from_turn ?? null
    }));
    const persisted = sorted(new Set(array(graph.raw.relations).filter(rel => rel.relation_kind === "persists-across-loop").map(rel => string(rel.from_node_id)))).filter(id => graph.nodes.has(id)).map(id => graph.displayName(graph.nodes.get(id)!));
    return {
        line: current.name ?? null,
        kind: current.kind ?? null,
        loop,
        anchor: anchorView,
        persisted,
        remembers: present.filter(n => remembersAcrossLoops(graph, n)).map(n => graph.displayName(n)),
        echoes_here: echoes.length,
        echoes: echoes.slice(0, 3).map(echo => ({
            id: echo.id,
            summary: echo.summary ?? null
        })),
        previous_loop: previous,
        lines: sorted(Object.keys(lines)).slice(0, 8).map(name => ({
            name,
            kind: lines[name].kind ?? null,
            loop: number(lines[name].loop),
            last_turn: lines[name].last_turn ?? null,
            status: lines[name].status ?? null
        })),
        loop_available: loopAvailable(graph, scene)
    };
}
export async function crossLineReader(campaign: CampaignSnapshot, graph: ModuleGraph, world: Row, present: Row[]): Promise<(node: Row) => Row[]> {
    if (!present.some(node => remembersAcrossLoops(graph, node)))
        return () => [];
    const byId = new Map<string, Row>(),
        active = activeName(campaign.meta),
        lines = row(campaign.meta.worldlines);
    for (const name of sorted(Object.keys(lines))) {
        if (name === active)
            continue;
        const text = await campaign.context.git.lineBlob(campaign.id, name, "memory/candidates.jsonl");
        for (const line of (text || "").split(/\r?\n/)) {
            if (!line.trim())
                continue;
            try {
                const value = parsePythonJson(line);
                if (isJsonObject(value) && !byId.has(string(value.id)))
                    byId.set(string(value.id), value);
            }
            catch { /* A malformed row in another line was not a candidate. */
            }
        }
    }
    for (const value of campaign.logs.get("memory/candidates.jsonl") ?? [])
        byId.set(string(value.id), value);
    const rows = sorted(byId.keys()).map(id => byId.get(id)!),
        index = new EntityIndex(graph, campaign.party, row(world.scene_labels)),
        loop = number(activeLine(campaign.meta).loop);
    return node => remembersAcrossLoops(graph, node) ? fromOtherLines(rows, index, graph.displayName(node), active, loop, 3) : [];
}
export const loopObligation = (section: Row): Row[] => truth(section.loop_available) ? [{
        kind: "loop",
        name: string(row(section.anchor).scene || "loop"),
        who: "keeper",
        state: `loop ${string(section.loop ?? 0)}`,
        cue: "This module's loop can be rewound from here."
    }] : [];
export const worldlineSignals = (section: Row): Row => ({
    loop_count: number(section.loop),
    echoes_here: number(section.echoes_here),
    loop_available: truth(section.loop_available)
});
