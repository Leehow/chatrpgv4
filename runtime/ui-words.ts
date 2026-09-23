/**
 * The words the product's own chrome shows a player: one authored source, projected per tag.
 *
 * Contract §23 (2026-09-09, the open-language ruling): the play language is whatever the player
 * names. `play_language` is any BCP-47-shaped tag; nothing here validates membership, keeps a table
 * keyed by a tag, or guesses a language from the text it is about to print. `content/languages.json`
 * declares only which tag the authored captions are written in (`source`), which tag a session that
 * carries none falls back to (`default`), and which tags a picker offers first (`suggested`).
 *
 * `content/ui/<source>/<surface>.json` is the one hand-written set of captions. For any other tag
 * the words resolve in this order:
 *
 *  1. a shipped seed `content/ui/<tag>/` -- an optional cache the product ships in the same shape,
 *     so a common tag pays no model call;
 *  2. the home cache `<home>/.coc/ui-words/<tag>-<digest>.json`, written by the projection lane
 *     (`extensions/module/ui-presentation.ts`). `digest` covers the authored surfaces and the
 *     lane's instruction, so an edited caption or an edited instruction re-projects rather than
 *     serving text the old wording produced;
 *  3. otherwise the authored words, answered at once with `projected: false` -- the host shows them
 *     immediately and starts one background projection for the tag.
 *
 * A key a seed or a cache lacks falls back to the authored word, so a half-projected tag still
 * shows a word rather than an identifier. That is a safety net, not a way of shipping a language.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const LANGUAGES = "languages.json";
const UI = "ui";
/** The lane's instruction, read into the digest so editing it invalidates every cached tag. */
const INSTRUCTION = "setup/ui-presentation.md";
/** Where a projected tag is cached, under the campaign home rather than in the read-only bundle. */
const CACHE = ".coc/ui-words";

/**
 * The shape a play language tag has: two or three lowercase letters and any number of subtags.
 * The only thing anything in this product asks about a tag -- never which tags exist, never which
 * script one is written in. It is exported once so no caller writes the pattern a second time.
 */
export const PLAY_LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export interface PlayLanguages {
	/** The tag the authored captions are written in: `content/ui/<source>/` is the only hand-written set. */
	source: string;
	/** The tag a host or kernel falls back to when a session carries none. */
	default: string;
	/** The tags a picker offers first. A picker accepts free text as well; this is not a set. */
	suggested: string[];
}

/** One tag's captions, and where they came from. Every `ui` block a renderer draws from is one of these. */
export interface UiWords {
	/** The tag asked for, settled by shape: the words may still be the authored ones (`projected: false`). */
	tag: string;
	words: Record<string, Record<string, string>>;
	/** Whether `words` are written in `tag`. False means the authored words, standing in until the lane answers. */
	projected: boolean;
	/** Which of the three orders answered: a shipped seed, the home cache, or the authored source. */
	source: "seed" | "cache" | "default";
}

export interface UiWordsRequest {
	contentRoot: string;
	/** The campaign home the projection lane caches into; without one only a seed can answer. */
	home?: string;
	tag?: unknown;
}

function contractError(message: string): Error {
	return new Error(`content/${LANGUAGES} does not satisfy coc.play-languages.v2: ${message}`);
}

function shaped(value: unknown): value is string {
	return typeof value === "string" && PLAY_LANGUAGE_TAG.test(value);
}

function parseLanguages(raw: any): PlayLanguages {
	if (raw && typeof raw === "object" && raw.languages !== undefined) {
		// The v1 registry. Reading it as v2 would silently answer with no suggestions and an
		// unknown source, so it is named rather than tolerated (contract §23 supersedes it).
		throw contractError("it still declares a `languages` registry; v2 keeps only `source`, `default` and `suggested`");
	}
	if (!shaped(raw?.source)) throw contractError("`source`, the tag the authored captions are written in, is missing or not a tag");
	if (!shaped(raw?.default)) throw contractError("`default`, the tag a session with no language falls back to, is missing or not a tag");
	const suggested = Array.isArray(raw?.suggested) ? raw.suggested.filter(shaped) : [];
	return { source: raw.source, default: raw.default, suggested };
}

export async function loadPlayLanguages(contentRoot: string): Promise<PlayLanguages> {
	return parseLanguages(JSON.parse(await readFile(join(contentRoot, LANGUAGES), "utf8")));
}

/** The same declaration read without yielding: for a caller inside an event handler that must not fall behind the bus. */
export function loadPlayLanguagesSync(contentRoot: string): PlayLanguages {
	return parseLanguages(JSON.parse(readFileSync(join(contentRoot, LANGUAGES), "utf8")));
}

/** A tag of the right shape is itself; anything else -- absent, malformed, not a string -- is the default. */
function settleTag(known: PlayLanguages, tag: unknown): string {
	return shaped(tag) ? tag : known.default;
}

/**
 * The tag a caller should record and project in. No membership test: an open set has none, and a
 * host that invented a tag here would put a campaign on disk in a language nobody chose.
 */
export async function playLanguageTag(contentRoot: string, tag: unknown): Promise<string> {
	return settleTag(await loadPlayLanguages(contentRoot), tag);
}

/** The same settlement without yielding. */
export function playLanguageTagSync(contentRoot: string, tag: unknown): string {
	return settleTag(loadPlayLanguagesSync(contentRoot), tag);
}

function parseSurface(tag: string, name: string, text: string): Record<string, string> {
	let raw: unknown;
	try { raw = JSON.parse(text); }
	catch (error) { throw new Error(`content/${UI}/${tag}/${name} is not a JSON object: ${error instanceof Error ? error.message : String(error)}`); }
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`content/${UI}/${tag}/${name} is not a JSON object`);
	return Object.fromEntries(Object.entries(raw as Record<string, unknown>)
		.filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

async function readSurfaces(contentRoot: string, tag: string): Promise<Record<string, Record<string, string>>> {
	const folder = join(contentRoot, UI, tag);
	let names: string[];
	try { names = (await readdir(folder)).filter(name => name.endsWith(".json")).sort(); }
	catch { return {}; }
	const words: Record<string, Record<string, string>> = {};
	for (const name of names) words[name.slice(0, -5)] = parseSurface(tag, name, await readFile(join(folder, name), "utf8"));
	return words;
}

/**
 * The words a build ships for `tag` (`content/ui/<tag>/`), complete or not: what that tag's players
 * already read. The presenter lane is shown them so a re-projection keeps them (contract §23.2).
 */
export function shippedUiWords(contentRoot: string, tag: string): Promise<Record<string, Record<string, string>>> {
	return readSurfaces(contentRoot, tag);
}

function readSurfacesSync(contentRoot: string, tag: string): Record<string, Record<string, string>> {
	const folder = join(contentRoot, UI, tag);
	let names: string[];
	try { names = readdirSync(folder).filter(name => name.endsWith(".json")).sort(); }
	catch { return {}; }
	const words: Record<string, Record<string, string>> = {};
	for (const name of names) words[name.slice(0, -5)] = parseSurface(tag, name, readFileSync(join(folder, name), "utf8"));
	return words;
}

/** Raw bytes of the authored surfaces, in name order, and the lane's instruction: everything the digest covers. */
async function digestSources(contentRoot: string, known: PlayLanguages): Promise<Array<[string, string]>> {
	const folder = join(contentRoot, UI, known.source);
	let names: string[];
	try { names = (await readdir(folder)).filter(name => name.endsWith(".json")).sort(); }
	catch { names = []; }
	const rows: Array<[string, string]> = [];
	for (const name of names) rows.push([name, await readFile(join(folder, name), "utf8")]);
	rows.push([INSTRUCTION, await readFile(join(contentRoot, INSTRUCTION), "utf8").catch(() => "")]);
	return rows;
}

function digestSourcesSync(contentRoot: string, known: PlayLanguages): Array<[string, string]> {
	const folder = join(contentRoot, UI, known.source);
	let names: string[];
	try { names = readdirSync(folder).filter(name => name.endsWith(".json")).sort(); }
	catch { names = []; }
	const rows: Array<[string, string]> = names.map(name => [name, readFileSync(join(folder, name), "utf8")]);
	let instruction = "";
	try { instruction = readFileSync(join(contentRoot, INSTRUCTION), "utf8"); } catch { /* a build without it cannot project, but can still read */ }
	rows.push([INSTRUCTION, instruction]);
	return rows;
}

function hashSources(rows: Array<[string, string]>): string {
	const hash = createHash("sha256");
	for (const [name, text] of rows) hash.update(name).update("\0").update(text).update("\0");
	return hash.digest("hex");
}

/**
 * What a cached projection was made from: every authored caption, plus the lane's instruction.
 *
 * Edit one caption and every cached tag is stale, because a projection is a function of the whole
 * authored set and of the words that asked for it. It is the file name, so a stale cache is never
 * read rather than being read and quietly disagreed with.
 */
export async function uiWordsDigest(contentRoot: string, known?: PlayLanguages): Promise<string> {
	return hashSources(await digestSources(contentRoot, known ?? await loadPlayLanguages(contentRoot)));
}

/** The same digest without yielding. */
export function uiWordsDigestSync(contentRoot: string, known?: PlayLanguages): string {
	return hashSources(digestSourcesSync(contentRoot, known ?? loadPlayLanguagesSync(contentRoot)));
}

/** Where the lane caches one tag. The tag is settled by shape before it reaches here, so it names a file safely. */
export function uiWordsCachePath(home: string, tag: string, digest: string): string {
	return join(home, CACHE, `${tag}-${digest}.json`);
}

/** What the lane writes: the tag it projected, what it projected from, and the words by surface. */
export interface UiWordsCache {
	play_language: string;
	digest: string;
	texts: Record<string, Record<string, string>>;
}

function parseCache(raw: unknown, tag: string, digest: string): Record<string, Record<string, string>> | undefined {
	const saved = raw as UiWordsCache | undefined;
	if (!saved || typeof saved !== "object" || saved.play_language !== tag || saved.digest !== digest) return undefined;
	if (!saved.texts || typeof saved.texts !== "object" || Array.isArray(saved.texts)) return undefined;
	const words: Record<string, Record<string, string>> = {};
	for (const [surface, table] of Object.entries(saved.texts)) {
		if (!table || typeof table !== "object" || Array.isArray(table)) continue;
		words[surface] = Object.fromEntries(Object.entries(table as Record<string, unknown>)
			.filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0));
	}
	return words;
}

function merge(base: Record<string, Record<string, string>>, own: Record<string, Record<string, string>>): Record<string, Record<string, string>> {
	const words: Record<string, Record<string, string>> = {};
	for (const surface of new Set([...Object.keys(base), ...Object.keys(own)]))
		words[surface] = { ...(base[surface] ?? {}), ...(own[surface] ?? {}) };
	return words;
}

/** A directory that exists but holds no caption is not a seed; it answers nothing and the lane still runs. */
function completeWords(base: Record<string, Record<string, string>>, words: Record<string, Record<string, string>>): boolean {
	return Object.entries(base).every(([surface, captions]) => Object.keys(captions).every(key => typeof words[surface]?.[key] === "string" && words[surface][key].trim().length > 0));
}
function carriesWords(words: Record<string, Record<string, string>>): boolean {
	return Object.values(words).some(surface => Object.keys(surface).length > 0);
}

/**
 * The captions for one tag, and whether they are in it.
 *
 * A `projected: false` answer is a complete answer -- the authored words, drawn at once -- and a
 * signal to the host that this tag has no projection yet. The host answers the panel with it and
 * starts one background lane run per tag; the words change under the panel when it lands.
 */
export async function resolveUiWords(request: UiWordsRequest): Promise<UiWords> {
	const { contentRoot, home } = request;
	const known = await loadPlayLanguages(contentRoot);
	const tag = settleTag(known, request.tag);
	const base = await readSurfaces(contentRoot, known.source);
	// The authored tag is its own projection: there is nothing to project it from.
	if (tag === known.source) return { tag, words: base, projected: true, source: "seed" };
	const seed = await readSurfaces(contentRoot, tag);
	if (completeWords(base, seed)) return { tag, words: merge(base, seed), projected: true, source: "seed" };
	if (home) {
		const digest = await uiWordsDigest(contentRoot, known);
		// The read and the parse fail the same way: no cache for this tag yet, or one the lane has
		// not finished writing. A half-written file must not take the answer down with it.
		const cached = await readFile(uiWordsCachePath(home, tag, digest), "utf8")
			.then(text => parseCache(JSON.parse(text), tag, digest))
			.catch(() => undefined);
		if (cached && carriesWords(cached)) {
			const own = merge(cached, seed);
			return { tag, words: merge(base, own), projected: completeWords(base, own), source: "cache" };
		}
	}
	return { tag, words: merge(base, seed), projected: false, source: carriesWords(seed) ? "seed" : "default" };
}

/**
 * The same resolution without yielding. An extension that paints a status line inside a bus event
 * cannot wait for a file: by the time a read resolves the turn may be over and the line lost.
 */
export function resolveUiWordsSync(request: UiWordsRequest): UiWords {
	const { contentRoot, home } = request;
	const known = loadPlayLanguagesSync(contentRoot);
	const tag = settleTag(known, request.tag);
	const base = readSurfacesSync(contentRoot, known.source);
	if (tag === known.source) return { tag, words: base, projected: true, source: "seed" };
	const seed = readSurfacesSync(contentRoot, tag);
	if (completeWords(base, seed)) return { tag, words: merge(base, seed), projected: true, source: "seed" };
	if (home) {
		const digest = uiWordsDigestSync(contentRoot, known);
		let cached: Record<string, Record<string, string>> | undefined;
		try { cached = parseCache(JSON.parse(readFileSync(uiWordsCachePath(home, tag, digest), "utf8")), tag, digest); }
		catch { /* no cache for this tag yet, or one the lane has not finished writing */ }
		if (cached && carriesWords(cached)) {
			const own = merge(cached, seed);
			return { tag, words: merge(base, own), projected: completeWords(base, own), source: "cache" };
		}
	}
	return { tag, words: merge(base, seed), projected: false, source: carriesWords(seed) ? "seed" : "default" };
}
