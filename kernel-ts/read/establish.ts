/**
 * Contract §203: arriving somewhere puts the investigator in it.
 *
 * Run 3 of TR-F2 (The Haunting, 2026-10-08) delivered a median of 140 characters on its arrival turns, the same as any
 * other turn: the newsroom was two sentences of typewriters and index cards. No Haunting scene carries words §168.5 counts as a
 * description, so first sight had nothing to carry, and the prose package's first-visit lines rode every request without
 * ever being told "this is the turn". This module is the base's interface for that turn and nothing more:
 *
 * - a package that requires `context.establish.v1` contributes `establish.json`, the rows an establishing reply owes
 *   (what they say is the package's; the kernel checks the shape);
 * - a place is established once a delivered world turn closed while the duty was owed there (the delivery record's
 *   `establish`); the duty is owed while the party stands in a place that is not;
 * - `mods.establish` is the turn item the capsule, the step note and the look result carry.
 *
 * Nothing here reads prose. Whether a draft establishes the place is the review lane's question (§203.6), which a package
 * requiring `audit.establish.v1` words in `contributes.establish_review`.
 */
import { RpcError } from "../errors.js";
import { parsePythonJson } from "../json.js";
import { sceneLabel } from "./capsule.js";
import type { ModuleGraph } from "./module-graph.js";
import { array, number, row, string, type Row } from "./values.js";

export const ESTABLISH_CAPABILITY = "context.establish.v1";
export const ESTABLISH_REVIEW_CAPABILITY = "audit.establish.v1";
/** The rows a package may say an establishing reply owes, and the bytes of one line. */
export const ESTABLISH_OWES_MIN = 2, ESTABLISH_OWES_MAX = 8, ESTABLISH_LINE_BYTES = 240;
const OWE_KEY = /^[a-z][a-z0-9_]{0,31}$/;
export const ESTABLISH_WHY = ["opening", "arrival", "look"] as const;

/**
 * §203.3: said only on a capsule (or a note) that carries the item. The interface is the kernel's; how to establish a
 * place is the prose package's.
 */
export const HEAD_ESTABLISH = " mods.establish means the investigator has just come into a place new to them, or is looking it over: this reply " +
    "establishes it, along the eye's path and before the turn's business, as mods.establish.owes and the prose package's " +
    "Establishing a place say. Only a turn that carries it does this; every other turn keeps its economy.";

export type EstablishOwe = { key: string; line: string };
export type EstablishProvider = { mod: string; version: string; owes: EstablishOwe[] };

const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const label = (manifest: Row): string => `${string(manifest.id ?? "?")} ${string(manifest.version ?? "?")}`;
function refuse(manifest: Row, field: string, message: string, details: Row = {}): never {
    throw new RpcError("invalid_params", `${label(manifest)}: ${message}`, {
        details: { mod: string(manifest.id ?? "?"), version: string(manifest.version ?? "?"), field, ...details },
    });
}

/** The rows of `establish.json`, checked. Pure: the manifest check and the provider read share it. */
export function parseEstablish(manifest: Row, raw: unknown): EstablishOwe[] {
    const field = "contributes.establish";
    if (raw == null || typeof raw !== "object" || Array.isArray(raw))
        return refuse(manifest, field, "establish.json must be a JSON object");
    const value = raw as Row, unknown = Object.keys(value).filter(key => !["schema_version", "owes"].includes(key));
    if (unknown.length || value.schema_version !== 1)
        refuse(manifest, field, "establish.json holds exactly schema_version 1 and owes", { unknown });
    const owes = value.owes;
    if (!Array.isArray(owes) || owes.length < ESTABLISH_OWES_MIN || owes.length > ESTABLISH_OWES_MAX)
        refuse(manifest, field, `establish.json owes must list ${ESTABLISH_OWES_MIN} to ${ESTABLISH_OWES_MAX} rows`);
    const seen = new Set<string>();
    return (owes as unknown[]).map((entry, index) => {
        if (entry == null || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join(",") !== "key,line")
            return refuse(manifest, field, `owes[${index}] must be {key, line}`, { index });
        const { key, line } = entry as Row;
        if (typeof key !== "string" || !OWE_KEY.test(key) || seen.has(key))
            refuse(manifest, field, `owes[${index}].key must be a distinct id matching ${OWE_KEY.source}`, { index });
        if (typeof line !== "string" || !line.trim() || Buffer.byteLength(line, "utf8") > ESTABLISH_LINE_BYTES)
            refuse(manifest, field, `owes[${index}].line must be a non-empty line of at most ${ESTABLISH_LINE_BYTES} bytes`, { index });
        seen.add(key as string);
        return { key: key as string, line: line as string };
    });
}

function file(manifest: Row, files: ReadonlyMap<string, Uint8Array | unknown>, field: string, path: unknown, extension: string): string {
    if (typeof path !== "string" || !path.endsWith(extension) || !files.has(path))
        refuse(manifest, field, `${field} must name a package ${extension === ".json" ? "JSON" : "Markdown"} file`);
    if (array(manifest.package_files).length && !array(manifest.package_files).includes(path))
        refuse(manifest, field, `package_files must include ${field}`);
    return path as string;
}

/**
 * Checked with the rest of the manifest (`manifestFrom`): each contribution and its capability are declared together,
 * and the files say what they must. A build that predates the capabilities marks the package incompatible (§28.9)
 * before this runs.
 */
export function validateEstablishDeclaration(manifest: Row, files: ReadonlyMap<string, Uint8Array>): void {
    const contributes = row(manifest.contributes), requires = array(manifest.requires);
    const pairs: Array<[string, string, string]> = [["establish", ESTABLISH_CAPABILITY, ".json"], ["establish_review", ESTABLISH_REVIEW_CAPABILITY, ".md"]];
    for (const [name, capability, extension] of pairs) {
        const field = `contributes.${name}`, path = contributes[name], required = requires.includes(capability);
        if (path == null) {
            if (required) refuse(manifest, field, `a package requiring ${capability} must contribute ${name}`);
            continue;
        }
        if (!required) refuse(manifest, field, `a package contributing ${name} must require ${capability}`);
        const at = file(manifest, files, field, path, extension), bytes = files.get(at) as Uint8Array;
        let text = "";
        try { text = decode(bytes); }
        catch { refuse(manifest, field, `${field} must be UTF-8`); }
        if (extension === ".md") {
            if (!text.trim()) refuse(manifest, field, `${field} must name non-empty Markdown`);
            continue;
        }
        let parsed: unknown;
        try { parsed = parsePythonJson(text); }
        catch { return refuse(manifest, field, "establish.json must be JSON"); }
        parseEstablish(manifest, parsed);
    }
}

/** The first active package in the effective order that contributes `establish`, with its rows. */
export function establishProvider(active: readonly Row[]): EstablishProvider | null {
    for (const mod of active) {
        const path = row(mod.contributes).establish, files = mod.files instanceof Map ? mod.files as ReadonlyMap<string, Uint8Array> : undefined;
        if (typeof path !== "string" || !files?.has(path) || !array(mod.requires).includes(ESTABLISH_CAPABILITY)) continue;
        try {
            return { mod: string(mod.id), version: string(mod.version), owes: parseEstablish(mod, parsePythonJson(decode(files.get(path)!))) };
        }
        catch { continue; }
    }
    return null;
}

export type EstablishReviewOwner = { mod: string; version: string; instruction: string };
/** §203.6: every active package that contributes `establish_review`, with its text; the caller decides what one or several mean. */
export function establishReviewOwners(active: readonly Row[]): EstablishReviewOwner[] {
    const owners: EstablishReviewOwner[] = [];
    for (const mod of active) {
        const path = row(mod.contributes).establish_review, files = mod.files instanceof Map ? mod.files as ReadonlyMap<string, Uint8Array> : undefined;
        if (typeof path !== "string" || !files?.has(path) || !array(mod.requires).includes(ESTABLISH_REVIEW_CAPABILITY)) continue;
        let text = "";
        try { text = decode(files.get(path)!).trim(); }
        catch { text = ""; }
        if (text) owners.push({ mod: string(mod.id), version: string(mod.version), instruction: text });
    }
    return owners;
}

/** §203.2: the places a delivered world turn established, read from the records of the current line. */
export function establishedScenes(records: readonly Row[]): Set<string> {
    const scenes = new Set<string>();
    for (const record of records) {
        const scene = row(record.establish).scene;
        if (typeof scene === "string" && scene && ["narrate", "ask"].includes(string(record.closed_by)) && record.interaction_scope == null)
            scenes.add(scene);
    }
    return scenes;
}

/**
 * §203.2: the party came into `scene` since the last delivered turn -- a move landing there among the open turn's receipts,
 * or among those of a turn that closed without a world delivery (stranded, or answered out of the fiction) after the last
 * one that delivered. A relabel of the
 * place the party already stands in is no arrival. A campaign that adopts a provider mid-play therefore owes nothing for
 * the place it stands in until it moves; a place passed through and never established is owed when the party comes back.
 */
export function enteredSinceDelivery(records: readonly Row[], receipts: readonly Row[], scene: string): boolean {
    const entered = (rows: readonly Row[]) => rows.some(receipt => receipt.kind === "move" && receipt.to === scene && receipt.renamed !== true && receipt.from !== receipt.to);
    if (entered(receipts)) return true;
    for (const record of [...records].sort((a, b) => number(b.turn) - number(a.turn))) {
        // A reference answer (§99's out-of-fiction scope) told the player nothing of the world: scan past it like a stranding.
        if (["narrate", "ask"].includes(string(record.closed_by)) && record.interaction_scope == null) return false;
        if (entered(array(record.receipts))) return true;
    }
    return false;
}

/**
 * §203.2–§203.3: the turn item, or null when nothing is owed. Owed when the place is not established and the party came
 * into it since the last delivery, or on the opening (turn 0); `look` is the Keeper's own look at the place, which owes an
 * establishing reply wherever the party stands.
 */
export function establishItem(graph: ModuleGraph, world: Row, scene: Row, provider: EstablishProvider | null,
    records: readonly Row[], options: { opening: boolean; look?: boolean; receipts?: readonly Row[] }): Row | null {
    if (!provider) return null;
    const handle = graph.handle(scene);
    const arrived = !establishedScenes(records).has(handle) && (options.opening || enteredSinceDelivery(records, options.receipts ?? [], handle));
    if (!arrived && !options.look) return null;
    const why: string[] = arrived ? [options.opening ? "opening" : "arrival"] : [];
    if (options.look) why.push("look");
    return {
        place: { id: handle, name: sceneLabel(graph, world, scene) },
        why,
        owes: provider.owes.map(owe => ({ ...owe })),
        package: { mod: provider.mod, version: provider.version },
    };
}

/**
 * §203.2: what a delivery record keeps, when the delivery closed a world turn on which the duty was owed (or the Keeper
 * looked the place over), with the host's verdict when it sent one. Null when nothing was owed.
 */
export function establishRecord(item: Row | null, review: unknown): Row | null {
    if (!item) return null;
    const verdict = row(review), kept: Row = {};
    for (const key of ["status", "steered", "look"]) if (verdict[key] !== undefined && ["string", "boolean"].includes(typeof verdict[key])) kept[key] = verdict[key];
    if (Array.isArray(verdict.missing)) kept.missing = verdict.missing.filter((value: unknown) => typeof value === "string").slice(0, 8);
    return { scene: string(row(item.place).id), why: [...array(item.why).map(string)], ...(Object.keys(kept).length ? { review: kept } : {}) };
}

/** The open turn's number, for `opening`. */
export const isOpening = (turn: Row): boolean => number(turn.turn) === 0;
