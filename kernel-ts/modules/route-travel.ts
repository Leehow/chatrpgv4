/**
 * Contract §138.9 (BR-05 of docs/specs/band-then-roll.md): the minutes of a road are data on the module graph.
 *
 * A `route-to` relation between two scenes may carry `properties.travel_minutes`; a move that names no minutes of its
 * own takes them (§5 `move`, "omitted means the value on the graph edge"), and the capsule's `exits[].travel_minutes`
 * projects them. The build fills the roads that lack them once, from a band the host named: the `default` of a travel
 * row of `time-costs` (never a roll -- the same road is the same length every time), or 0 for two parts of one place.
 * The road records whose number it is in `properties.travel`: `{basis: "banded", band, confidence}` for a band, and
 * `{basis: "stated"}` for the other direction of a road whose one direction already carries the book's minutes (the
 * same road is the same length both ways).
 *
 * This file is the one writer of those two properties. The kernel's publication (`module.read.finish` with `travel`)
 * and the host's starter regeneration (`scripts/fill-starter-travel.ts`) both call it, so it has no imports and both
 * load it. A relation that already carries minutes -- the book's, or an earlier fill's -- is never touched.
 */

type Row = Record<string, any>;

/** The registry key of the road's minutes (`kernel-ts/rules/bands.ts`). */
export const ROUTE_TRAVEL_FIELD = "route-to.travel_minutes";
/** The band table a road's minutes come from. */
export const ROUTE_TRAVEL_TABLE = Object.freeze({ table: "time-costs", block: "categories" });
/**
 * The rows of that table a road may take (§138.2: the per-turn time question never offers them; a road's time is the
 * edge's). Row handles of a closed rules table, named by the registry the way it names the table itself.
 */
export const ROUTE_TRAVEL_ROWS: readonly string[] = Object.freeze(["local_travel", "long_travel"]);
/** The question's exit, not a row: the two scenes are parts of one building or one place -- no road, no clock. */
export const TRAVEL_ADJACENT = "adjacent";
/** The two properties the fill writes on a road, and the only ones the publication carries across a re-assembly. */
export const TRAVEL_PROPERTIES: readonly string[] = Object.freeze(["travel_minutes", "travel"]);

/** A travel row as the fill reads it: the table's own `[min, max]` and the `default` a road takes. */
export interface TravelRow { readonly handle: string; readonly min?: number; readonly max?: number; readonly default?: number }
/** One band the host named for one road, by the two scene node ids (order free: a road is the same both ways). */
export interface TravelEntry { from: string; to: string; band: string; confidence: unknown }
export interface TravelFilled { relation_id: string; from: string; to: string; travel_minutes: number; basis: "banded" | "stated"; band?: string }
export interface TravelSkipped { from: string | null; to: string | null; band: string | null; reason: string }

const plain = (value: unknown): value is Row => value != null && typeof value === "object" && !Array.isArray(value);
/** A JSON number as the kernel parses it (a Python float arrives boxed) or as the host holds it. */
const numeric = (value: unknown): number => typeof value === "number" ? value
    : plain(value) && typeof value.value === "number" && typeof value.valueOf === "function" ? Number(value.valueOf()) : NaN;
const wholeMinutes = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const pairKey = (a: string, b: string): string => JSON.stringify(a < b ? [a, b] : [b, a]);

/** Whether this relation is a road whose minutes the fill may write: a `route-to` that carries none yet. */
export function unfilledRoad(relation: unknown): boolean {
    return plain(relation) && relation.relation_kind === "route-to"
        && !Object.hasOwn(plain(relation.properties) ? relation.properties : {}, "travel_minutes");
}

/**
 * The travel rows of a parsed `time-costs.json`, in the registry's order. A row that is missing or states no whole
 * `min`, `max` and `default` with `min <= default <= max` throws: a road never takes a number the table did not state.
 */
export function travelRowsOf(table: unknown): TravelRow[] {
    const block = plain(table) && plain(table[ROUTE_TRAVEL_TABLE.block]) ? table[ROUTE_TRAVEL_TABLE.block] : null;
    if (!block)
        throw new Error(`${ROUTE_TRAVEL_TABLE.table}.json has no ${ROUTE_TRAVEL_TABLE.block} block`);
    return ROUTE_TRAVEL_ROWS.map(handle => {
        const row = block[handle];
        if (!plain(row) || !wholeMinutes(row.min) || !wholeMinutes(row.max) || !wholeMinutes(row.default)
            || row.min > row.default || row.default > row.max)
            throw new Error(`${ROUTE_TRAVEL_TABLE.table}.${ROUTE_TRAVEL_TABLE.block}.${handle} is not a travel row with min <= default <= max`);
        return { handle, min: row.min, max: row.max, default: row.default };
    });
}

/**
 * Keep a road's filled minutes when the publication re-assembles its relations from claims: the relation that the
 * same claim made before, joining the same two nodes, carries its `travel_minutes` and `travel` into the new one.
 */
export function preserveTravel(previous: unknown, relation: Row): Row {
    if (!plain(previous) || relation.relation_kind !== "route-to" || previous.relation_kind !== "route-to"
        || previous.from_node_id !== relation.from_node_id || previous.to_node_id !== relation.to_node_id)
        return relation;
    const before = plain(previous.properties) ? previous.properties : {};
    if (!Object.hasOwn(before, "travel_minutes"))
        return relation;
    const kept = Object.fromEntries(TRAVEL_PROPERTIES.filter(key => Object.hasOwn(before, key)).map(key => [key, before[key]]));
    return { ...relation, properties: { ...(plain(relation.properties) ? relation.properties : {}), ...kept } };
}

/**
 * The other direction of a timed road: a `route-to` without minutes between two scenes that another `route-to` of the
 * same pair already times takes those minutes, with that relation's provenance (`{basis: "stated"}` when it has none,
 * i.e. the book's own number). Timed relations of one pair that disagree give nothing to copy. In place.
 */
export function sameRoad(graph: Row): TravelFilled[] {
    const scenes = new Set((Array.isArray(graph.nodes) ? graph.nodes : [])
        .filter((node: unknown) => plain(node) && node.node_kind === "scene" && typeof node.node_id === "string").map((node: Row) => node.node_id));
    const pairs = new Map<string, Row[]>();
    for (const relation of (Array.isArray(graph.relations) ? graph.relations : []).filter(plain))
        if (relation.relation_kind === "route-to" && relation.from_node_id !== relation.to_node_id
            && scenes.has(relation.from_node_id) && scenes.has(relation.to_node_id))
            pairs.set(pairKey(relation.from_node_id, relation.to_node_id), [...(pairs.get(pairKey(relation.from_node_id, relation.to_node_id)) ?? []), relation]);
    const filled: TravelFilled[] = [];
    for (const relations of pairs.values()) {
        const timed = relations.filter(relation => !unfilledRoad(relation)), open = relations.filter(unfilledRoad);
        const minutes = new Set(timed.map(relation => relation.properties.travel_minutes));
        if (!timed.length || !open.length || minutes.size !== 1 || !wholeMinutes([...minutes][0]))
            continue;
        const source = timed[0].properties, travel = plain(source.travel) ? { ...source.travel } : { basis: "stated" };
        for (const relation of open) {
            relation.properties = { ...(plain(relation.properties) ? relation.properties : {}), travel_minutes: source.travel_minutes, travel };
            filled.push({ relation_id: String(relation.relation_id), from: relation.from_node_id, to: relation.to_node_id,
                travel_minutes: source.travel_minutes, basis: travel.basis === "banded" ? "banded" : "stated",
                ...(typeof travel.band === "string" ? { band: travel.band } : {}) });
        }
    }
    return filled;
}

/**
 * Write the named bands onto the roads that lack minutes, in place. Each entry names two scene nodes and a band: a
 * travel row (its `default` becomes the minutes) or `adjacent` (0). Every `route-to` relation between the two, in
 * either direction, that carries no minutes yet gains `travel_minutes` and `travel: {basis: "banded", band,
 * confidence}`; a relation with minutes is never touched. An entry that does not fit is skipped with its reason and
 * writes nothing, so a malformed answer never fails the publication that carries it.
 */
export function applyTravelFill(graph: Row, entries: unknown, rows: readonly TravelRow[]): { filled: TravelFilled[]; skipped: TravelSkipped[] } {
    const filled: TravelFilled[] = [], skipped: TravelSkipped[] = [];
    if (entries === undefined)
        return { filled, skipped };
    if (!Array.isArray(entries))
        return { filled, skipped: [{ from: null, to: null, band: null, reason: "not_a_list" }] };
    const scenes = new Set((Array.isArray(graph.nodes) ? graph.nodes : [])
        .filter((node: unknown) => plain(node) && node.node_kind === "scene" && typeof node.node_id === "string").map((node: Row) => node.node_id));
    const relations: Row[] = (Array.isArray(graph.relations) ? graph.relations : []).filter(plain);
    // A road already timed one way is timed the other before any band is read: its number is the book's or an
    // earlier fill's, and a band for the same road would give the two directions two lengths.
    filled.push(...sameRoad(graph));
    for (const entry of entries) {
        const shaped = plain(entry) && Object.keys(entry).every(key => ["from", "to", "band", "confidence"].includes(key))
            && typeof entry.from === "string" && typeof entry.to === "string" && typeof entry.band === "string";
        const from = shaped ? entry.from : null, to = shaped ? entry.to : null, band = shaped ? entry.band : null;
        const skip = (reason: string) => { skipped.push({ from, to, band, reason }); };
        if (!shaped) { skip("entry_shape"); continue; }
        const confidence = numeric(entry.confidence);
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) { skip("confidence"); continue; }
        if (from === to || !scenes.has(from) || !scenes.has(to)) { skip("not_two_scenes"); continue; }
        const row = rows.find(item => item.handle === band);
        const minutes = band === TRAVEL_ADJACENT ? 0 : row?.default;
        if (!wholeMinutes(minutes)) { skip(row ? "row_without_default" : "band_unknown"); continue; }
        const roads = relations.filter(relation => unfilledRoad(relation)
            && (relation.from_node_id === from && relation.to_node_id === to || relation.from_node_id === to && relation.to_node_id === from));
        if (!roads.length) { skip("no_unfilled_road"); continue; }
        for (const relation of roads) {
            relation.properties = { ...(plain(relation.properties) ? relation.properties : {}),
                travel_minutes: minutes, travel: { basis: "banded", band, confidence: entry.confidence } };
            filled.push({ relation_id: String(relation.relation_id), from: relation.from_node_id, to: relation.to_node_id, travel_minutes: minutes, basis: "banded", band: band! });
        }
    }
    return { filled, skipped };
}
