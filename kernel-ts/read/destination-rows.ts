/**
 * What a `table.apply.options` move row says about where it goes (contract §135.30.4).
 *
 * A move row carried the exit's handle and one display name, so a place the book never named read as its
 * file name ("previous-tenants"), and a reader of the row -- Jev, asked which listed place the player's words
 * go to -- could not tell the Roxbury Sanitarium from it. And an exit whose unlock was unmet said only
 * `clue_discovered: corbitt-diaries`, so the Keeper, told nothing else, narrated a missing staircase for
 * four turns while the book's way down waited in a cupboard on the same floor.
 *
 * Everything here is authored graph data or world state read by id: the place's other authored names, its
 * prose, its where-words, who the world puts there, what assets it holds; and for an unmet unlock, the
 * clue's own words and the scenes and affordance cues the book gives for it. Nothing is worded or inferred.
 */
import { ModuleGraph, recordOf, destinationNames } from "./module-graph.js";
import { npcsPresent, personLabel, sceneLabel } from "./capsule.js";
import { array, row, string, normalize, type Row } from "./values.js";

const words = (value: unknown): string[] => array(value).filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
const unique = (values: string[]): string[] => [...new Set(values)];

/**
 * The scene's own summary: its record's prose, else the node's `summary` unless that is only the node's `name`
 * again (a graph builder that had no summary copied the name in; repeating it says nothing new).
 */
function authoredSummary(graph: ModuleGraph, scene: Row): string {
    const prose = graph.prose(scene);
    if (prose.trim())
        return prose;
    const summary = string(scene.summary || "");
    return summary.trim() && normalize(summary) !== normalize(string(scene.name || "")) ? summary : "";
}

/**
 * `destination` of a move row: the place's other authored names (less the label the row already shows), its
 * summary, where-words, the people the world places there by this table's name for them, and its assets by
 * name (handouts, objects; not the media of the place). Each key only when it has content.
 */
export function destinationView(graph: ModuleGraph, world: Row, scene: Row, shown: string): Row {
    const names = unique(destinationNames(scene).map(string)).filter(name => normalize(name) !== normalize(shown));
    const summary = authoredSummary(graph, scene);
    const where = unique(words(recordOf(scene).location_tags));
    const people = unique(npcsPresent(graph, world, scene).map(node => personLabel(world, graph.handle(node), graph.displayName(node))));
    // An `asset` node is a map or picture of the place (the Keeper's media), not a thing in it: the node kind says so.
    const things = unique(graph.sceneAssets(scene).filter(asset => asset.kind !== "asset").map(asset => string(asset.name)).filter(Boolean));
    return {
        ...(names.length ? { names } : {}),
        ...(summary ? { summary } : {}),
        ...(where.length ? { where } : {}),
        ...(people.length ? { people } : {}),
        ...(things.length ? { things } : {})
    };
}

/** The affordance cues of a scene that grant a clue (the authored `clue_id` / `grants_clue_ids`), in order. */
function grantingCues(scene: Row, clueId: string): string[] {
    return array(recordOf(scene).affordances).map(row)
        .filter(aff => aff.clue_id === clueId || array(aff.grants_clue_ids).includes(clueId))
        .map(aff => string(aff.cue || "")).filter(Boolean);
}

/**
 * What an unmet unlock names, from its typed keys: for `clue_discovered`, the clue's handle, its own words and
 * every scene the book puts it in with the cues that grant it there; for `flag_set`, the flag. Empty for any
 * other shape: the condition string the row already carries is then all the kernel knows.
 */
export function unlockGuard(graph: ModuleGraph, world: Row, when: unknown): Row {
    const condition = row(when);
    if (condition.kind === "clue_discovered") {
        const node = graph.find(string(condition.clue_id || ""), ["clue"]);
        if (!node)
            return {};
        const found = graph.kind("scene").filter(scene => graph.sceneClueIds(scene).includes(node.node_id)).map(scene => {
            const cues = grantingCues(scene, node.node_id);
            return {
                scene: graph.handle(scene),
                display_name: sceneLabel(graph, world, scene),
                ...(cues.length ? { cues } : {})
            };
        });
        return { clue: { clue: graph.handle(node), says: string(node.summary || node.name || ""), ...(found.length ? { found_at: found } : {}) } };
    }
    if (condition.kind === "flag_set" && typeof condition.flag_id === "string" && condition.flag_id)
        return { flag: condition.flag_id };
    return {};
}

/**
 * §135.30.6 (SL-40): a held exit is a pacing condition, not a wall. The row is an exit the scene has, so the place and
 * the way to it from here exist; `unlock_when` says what must happen before the party takes it now. `from` is the
 * scene the party is in (the exit's own end) and `from_place` the table's label for it. Structure only.
 */
export function guardedWay(graph: ModuleGraph, world: Row, scene: Row): Row {
    return { exists: { place: true, entrance: true, from: graph.handle(scene), from_place: sceneLabel(graph, world, scene) } };
}
