/**
 * Contract §137: `context.style.v1`, a package contributes the capsule's craft lines.
 *
 * The base text graph carries no craft line (§137.6). A package that requires this capability names one
 * package JSON file in `contributes.style`: a few English lines per axis, per directive (a full and a brief
 * form), a closed beat table naming which directives each Director beat carries, and the floor lines that
 * ride every turn. The kernel never judges the prose; it checks the shape and measures, when the catalog
 * loads and never during a turn, both projections the capsule can send, with the capsule's own
 * serialization. A package whose projection would not fit is refused as a version, so `truncated` can
 * never name `style` for a package that loaded (the silent trim of 2026-09-15 cannot come back).
 * At most one enabled package provides the section.
 */
import { join } from "node:path";
import type { KernelContext } from "../context.js";
import { RpcError } from "../errors.js";
import { parsePythonJson } from "../json.js";
import { DirectorGraph, TextGraph } from "./content.js";
import { jsonSize } from "./capsule.js";
import { array, row, string, repr, type Row } from "./values.js";

export const STYLE_CAPABILITY = "context.style.v1";
/** The `style` section's budgets (contract §13.1): the brief form of a later turn, and the full form of the first
 *  turn a process opens (every directive's full line). `SLICE3_BUDGETS.style` and the full-turn cap read these. */
export const STYLE_BUDGET = Object.freeze({ brief: 1536, full: 2048 });
const LINE_BYTES = 240, MAX_AXES = 6, MAX_FLOOR = 4, MAX_BEAT_DIRECTIVES = 4;
const DIRECTIVE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const FIELDS = ["axes", "beats", "directives", "floor", "schema_version"];
/** The play language is open (§23), so the load-time measure reserves a tag of RFC 5646 §4.4.1's length, the
 *  one every implementation must accept, beside the longest register the text graph declares. */
const LANGUAGE_RESERVE = "x".repeat(35);

/** A validated contribution: axes and floor in file order, directives in file order, the beat table. */
export type StyleLines = {
    readonly axes: readonly string[];
    readonly directives: ReadonlyMap<string, { readonly full: string; readonly brief: string }>;
    readonly beats: Readonly<Record<string, readonly string[]>>;
    readonly floor: readonly string[];
};

const label = (manifest: Row): string => `${string(manifest.id ?? "?")} ${string(manifest.version ?? "?")}`;
const invalid = (manifest: Row, message: string, details: Row = {}): never => {
    throw new RpcError("invalid_params", `${label(manifest)}: ${message}`, {
        details: { mod: string(manifest.id ?? "?"), version: string(manifest.version ?? "?"), field: "contributes.style", ...details },
    });
};
const plain = (value: unknown): value is Row => value != null && typeof value === "object" && !Array.isArray(value);
const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

export const providesStyle = (mod: Row | null | undefined): boolean => row(row(mod).contributes).style != null;

/** The pairing and the path, checked with the rest of the manifest (the same rule as §28.7's vocabulary):
 *  contributing without the capability, or the capability without a contribution, is a manifest that does not
 *  mean what it says. The file's content is checked where the catalog loads (`validateStyleContribution`). */
export function validateStyleDeclaration(manifest: Row, files: ReadonlyMap<string, unknown>): void {
    const path = row(manifest.contributes).style, required = array(manifest.requires).includes(STYLE_CAPABILITY);
    if (path == null) {
        if (required)
            invalid(manifest, `a package requiring ${STYLE_CAPABILITY} must contribute style`);
        return;
    }
    if (!required)
        invalid(manifest, `a package contributing style must require ${STYLE_CAPABILITY}`);
    if (typeof path !== "string" || !path.endsWith(".json") || !files.has(path))
        invalid(manifest, "contributes.style must name a package JSON file");
    if (!array(manifest.package_files).includes(path))
        invalid(manifest, "package_files must include contributes.style");
}

function line(manifest: Row, where: string, value: unknown): string {
    if (typeof value !== "string" || !value.trim())
        return invalid(manifest, `${where} must be a non-empty line`);
    if (byteLength(value) > LINE_BYTES)
        invalid(manifest, `${where} is ${byteLength(value)} bytes; a style line is at most ${LINE_BYTES}`);
    return value;
}

/** The file's shape against the beats the Director graph declares. Pure: the catalog and the tests call it alike. */
export function parseStyle(manifest: Row, raw: unknown, beats: readonly string[]): StyleLines {
    if (!plain(raw))
        return invalid(manifest, "style.json must be a JSON object");
    const unknown = Object.keys(raw).filter(key => !FIELDS.includes(key)), missing = FIELDS.filter(key => !Object.hasOwn(raw, key));
    if (unknown.length || missing.length)
        invalid(manifest, `style.json holds exactly ${FIELDS.join(", ")}`, { unknown, missing });
    if (raw.schema_version !== 1)
        invalid(manifest, "style.json schema_version must be 1");
    if (!Array.isArray(raw.axes) || raw.axes.length > MAX_AXES)
        invalid(manifest, `style.json axes must be a list of 0 to ${MAX_AXES} lines`);
    if (!Array.isArray(raw.floor) || raw.floor.length > MAX_FLOOR)
        invalid(manifest, `style.json floor must be a list of 0 to ${MAX_FLOOR} lines`);
    const axes = raw.axes.map((value: unknown, index: number) => line(manifest, `axes[${index}]`, value)),
        floor = raw.floor.map((value: unknown, index: number) => line(manifest, `floor[${index}]`, value));
    if (!plain(raw.directives))
        invalid(manifest, "style.json directives must be an object of {full, brief} keyed by directive id");
    const directives = new Map<string, { full: string; brief: string }>();
    for (const [id, entry] of Object.entries(raw.directives as Row)) {
        if (!DIRECTIVE_ID.test(id))
            invalid(manifest, `directive id ${repr(id)} must match ${DIRECTIVE_ID.source}`, { directive: id });
        if (!plain(entry) || Object.keys(entry).sort().join(",") !== "brief,full")
            invalid(manifest, `directive ${id} must carry exactly full and brief`, { directive: id });
        directives.set(id, { full: line(manifest, `directives.${id}.full`, entry.full), brief: line(manifest, `directives.${id}.brief`, entry.brief) });
    }
    if (!plain(raw.beats))
        invalid(manifest, "style.json beats must be an object of directive-id lists keyed by Director beat");
    const table = raw.beats as Row, problems: string[] = [];
    for (const beat of beats) {
        const ids = table[beat];
        if (!Array.isArray(ids)) {
            problems.push(`beat ${beat} has no directive list`);
            continue;
        }
        if (ids.length > MAX_BEAT_DIRECTIVES)
            problems.push(`beat ${beat} lists ${ids.length} directives (max ${MAX_BEAT_DIRECTIVES})`);
        if (new Set(ids).size !== ids.length)
            problems.push(`beat ${beat} names a directive twice`);
        const unknownIds = ids.filter(id => typeof id !== "string" || !directives.has(id));
        if (unknownIds.length)
            problems.push(`beat ${beat} names directives the package does not define: [${unknownIds.map(id => repr(id)).join(", ")}]`);
    }
    const extra = Object.keys(table).filter(beat => !beats.includes(beat));
    if (extra.length)
        problems.push(`beat table names beats the Director lacks: [${extra.map(beat => repr(beat)).join(", ")}]`);
    if (problems.length)
        invalid(manifest, `style.json beats disagree with the Director graph: ${problems.join("; ")}`, { problems });
    return { axes, directives, beats: Object.fromEntries(beats.map(beat => [beat, (table[beat] as string[]).slice()])), floor };
}

/** The section exactly as the capsule sends it: `{language, register}` from the text graph's face, then the
 *  provider's lines -- every directive's full line on the first turn a process opens, the beat's brief lines after. */
function project(base: Row, lines: StyleLines, beat: string, full: boolean): Row {
    const ids = full ? [...lines.directives.keys()] : array(lines.beats[beat]).map(string);
    return {
        ...base,
        axes: [...lines.axes],
        directives: ids.map(id => ({ id, line: full ? lines.directives.get(id)!.full : lines.directives.get(id)!.brief })),
        floor: [...lines.floor],
    };
}

/** Both projections measured with the capsule's own serialization; a version that overflows either is refused,
 *  naming each beat and the bytes over. Returns the sizes the check computed. */
export function measureStyle(manifest: Row, lines: StyleLines, beats: readonly string[], register: string): { full: number; brief: Record<string, number> } {
    const base = { language: LANGUAGE_RESERVE, register },
        full = jsonSize(project(base, lines, "", true)),
        brief = Object.fromEntries(beats.map(beat => [beat, jsonSize(project(base, lines, beat, false))])),
        over = Object.entries(brief).filter(([, size]) => size > STYLE_BUDGET.brief);
    const reserve = `measured with a ${LANGUAGE_RESERVE.length}-character language tag and register ${repr(register)}`;
    if (over.length)
        invalid(manifest, `style brief form overflows its ${STYLE_BUDGET.brief}-byte budget for ${over.map(([beat, size]) => `beat ${beat} (${size} bytes, ${size - STYLE_BUDGET.brief} over)`).join(", ")}; ${reserve}`,
            { budget: STYLE_BUDGET.brief, over: Object.fromEntries(over.map(([beat, size]) => [beat, size - STYLE_BUDGET.brief])) });
    if (full > STYLE_BUDGET.full)
        invalid(manifest, `style full form (every directive's full line) is ${full} bytes, ${full - STYLE_BUDGET.full} over its ${STYLE_BUDGET.full}-byte budget; ${reserve}`,
            { budget: STYLE_BUDGET.full, over: full - STYLE_BUDGET.full });
    return { full, brief };
}

function readStyleFile(manifest: Row, files: ReadonlyMap<string, unknown>): unknown {
    const bytes = files.get(string(row(manifest.contributes).style));
    try {
        return parsePythonJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes as Uint8Array));
    }
    catch {
        return invalid(manifest, "contributes.style must be valid UTF-8 JSON");
    }
}

/** Parsed lines per package digest (a version's bytes are frozen, §26) and the verdict per content snapshot:
 *  the Director's beats and the text graph's registers are read through the same cached reader every content file
 *  uses, so a catalog read on the path of every player input re-validates only when a package or that content changes. */
const parsed = new Map<string, StyleLines>();
function remember(digest: string, lines: StyleLines): StyleLines {
    parsed.delete(digest);
    if (parsed.size >= 16)
        parsed.delete(parsed.keys().next().value!);
    parsed.set(digest, lines);
    return lines;
}
const verdicts = new WeakMap<object, WeakMap<object, Map<string, RpcError | null>>>();

async function contentKeys(context: KernelContext): Promise<[object, object] | null> {
    try {
        const director = await context.snapshots.readJson(join(context.content, "director", "director-graph.json")),
            text = await context.snapshots.readJson(join(context.content, "craft", "text-graph.json"));
        return plain(director) && plain(text) ? [director, text] : null;
    }
    catch {
        return null; // DirectorGraph.load / TextGraph.load below report the unreadable file as they always do.
    }
}

/** Contract §137.2: the catalog's check of one package version (`readModCatalog`, `mods.install`). Throws the
 *  refusal as `invalid_params`; the catalog records it as that version's own `unavailable` reason (§41.2). */
export async function validateStyleContribution(context: KernelContext, manifest: Row, files: ReadonlyMap<string, unknown>, digest: string): Promise<void> {
    if (!providesStyle(manifest))
        return;
    const keys = await contentKeys(context);
    const cache = keys ? (verdicts.get(keys[0]) ?? verdicts.set(keys[0], new WeakMap()).get(keys[0])!) : null,
        known = keys ? (cache!.get(keys[1]) ?? cache!.set(keys[1], new Map()).get(keys[1])!) : null;
    if (known?.has(digest)) {
        const refusal = known.get(digest);
        if (refusal)
            throw refusal;
        return;
    }
    try {
        const beats = (await DirectorGraph.load(context)).beats,
            registers = (await TextGraph.load(context)).registers,
            register = registers.reduce((longest, name) => name.length > longest.length ? name : longest, "");
        const lines = parseStyle(manifest, readStyleFile(manifest, files), beats);
        measureStyle(manifest, lines, beats, register);
        remember(digest, lines);
        known?.set(digest, null);
    }
    catch (error) {
        if (error instanceof RpcError && error.code === "invalid_params")
            known?.set(digest, error);
        throw error;
    }
}

/** The lines of an enabled provider, from its catalog entry (`files`, `digest`), validated when the catalog loaded. */
function linesOf(mod: Row, beats: readonly string[]): StyleLines {
    const digest = string(mod.digest);
    return parsed.get(digest) ?? remember(digest, parseStyle(mod, readStyleFile(mod, mod.files as ReadonlyMap<string, unknown>), beats));
}

/** The enabled style provider, if any. `activeMods` already refused a world with two. */
export function styleProvider(active: readonly Row[]): Row | undefined {
    return active.find(mod => providesStyle(mod));
}

/** Contract §137.3: `capsule.style`. Without a provider it is only the language and register every table has;
 *  a campaign whose narration-craft lock predates this capability keeps the lines it was played with (§137.9). */
export function styleSection(craft: TextGraph, language: string, register: string, provider: Row | undefined,
    beats: readonly string[], beat: string, full: boolean, legacy?: StyleLines): Row {
    const base = craft.style(language, register);
    return provider ? project(base, linesOf(provider, beats), beat, full) : legacy ? project(base, legacy, beat, full) : base;
}

/** Contract §137.9: the frozen base table of the narration-craft 1.x era (`content/craft/legacy-style.json`).
 *  Kernel content, not a package: its lines are fixed and its beat table is the Director's. A line whose
 *  `language` is not `all` applies only to that play language, as the old text graph's axes did. */
const LEGACY_STYLE = "legacy-style.json";
const legacyCache = new WeakMap<object, Map<string, StyleLines>>();
export async function legacyStyle(context: KernelContext, language: string): Promise<StyleLines | undefined> {
    let raw: unknown;
    try {
        raw = await context.snapshots.readJson(join(context.content, "craft", LEGACY_STYLE));
    }
    catch {
        return undefined; // a content tree without the legacy table gives legacy locks what any table without a provider gets
    }
    if (!plain(raw) || raw.contract_id !== "coc.legacy-style.v1")
        return undefined;
    const known = legacyCache.get(raw) ?? legacyCache.set(raw, new Map()).get(raw)!;
    const cached = known.get(language);
    if (cached)
        return cached;
    const directives = new Map<string, { full: string; brief: string }>(
        Object.entries(row(raw.directives)).map(([id, line]) => [id, { full: string(line), brief: string(line) }]));
    const lines: StyleLines = {
        axes: array(raw.axes).map(row).filter(axis => ["all", language].includes(string(axis.language || "all"))).map(axis => string(axis.line)),
        directives,
        beats: Object.fromEntries(Object.entries(row(raw.beats)).map(([beat, ids]) => [beat, array(ids).map(string).filter(id => directives.has(id))])),
        floor: array(raw.floor).map(string),
    };
    known.set(language, lines);
    return lines;
}

/** The legacy table applies to a table whose enabled narration-craft contributes no style: a lock frozen before
 *  context.style.v1 (§26 keeps its bytes; it never had the lines because the base carried them). */
export const legacyStyleLock = (active: readonly Row[], provider: Row | undefined): boolean =>
    !provider && active.some(mod => mod.id === "narration-craft" && !providesStyle(mod));

/** Contract §137.4: the single-provider rule's refusal. `existing` is the provider already enabled. */
export function secondProvider(candidate: Row, existing: Row): RpcError {
    return new RpcError("invalid_params",
        `${label(candidate)} contributes style (${STYLE_CAPABILITY}), but ${label(existing)} already provides it; only one style provider can be enabled at a time -- disable ${string(existing.id)} first`,
        { details: { mod: string(candidate.id), version: string(candidate.version), provider: { mod: string(existing.id), version: string(existing.version) } } });
}
