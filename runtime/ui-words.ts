/**
 * The words the product's own chrome shows a player, as data keyed by play language.
 *
 * `content/languages.json` is the closed set of play languages and the default tag; every
 * `content/ui/<tag>/<surface>.json` holds one surface's captions (`sheet`, `mechanics`,
 * `choices`, `mods`, `paper`, `preparation`, `onboarding`, `errors`, `extension`...). Renderer
 * modules are loaded from a data: URL and cannot import a sibling, and the kernel writes English
 * by contract, so the host reads these files and hands each answer its `ui` block; no renderer,
 * host or extension keeps a per-language table in code (contract §23, 2026-09-09).
 *
 * A tag without a directory reads as the default language; a key one language lacks falls back
 * to the default language's word, so a half-translated language still shows a word rather than
 * nothing. The guard test pins every language to the default's key set, so that fallback is a
 * safety net, not a way of shipping a language.
 */
import { readdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface PlayLanguage { autonym: string; script?: string }
export interface PlayLanguages { default: string; languages: Record<string, PlayLanguage> }
export interface UiWords { tag: string; words: Record<string, Record<string, string>> }

const LANGUAGES = "languages.json";
const UI = "ui";

function parseLanguages(raw: any): PlayLanguages {
	const languages: Record<string, PlayLanguage> = {};
	for (const [tag, row] of Object.entries(raw?.languages ?? {})) {
		if (!row || typeof row !== "object") continue;
		const { autonym, script } = row as Record<string, unknown>;
		languages[tag] = { autonym: typeof autonym === "string" ? autonym : tag, ...(typeof script === "string" && script ? { script } : {}) };
	}
	const fallback = typeof raw?.default === "string" && languages[raw.default] ? raw.default : Object.keys(languages)[0];
	if (!fallback) throw new Error("content/languages.json declares no play language");
	return { default: fallback, languages };
}

export async function loadPlayLanguages(contentRoot: string): Promise<PlayLanguages> {
	return parseLanguages(JSON.parse(await readFile(join(contentRoot, LANGUAGES), "utf8")));
}

/** The same declaration read without yielding: for a caller inside an event handler that must not fall behind the bus. */
export function loadPlayLanguagesSync(contentRoot: string): PlayLanguages {
	return parseLanguages(JSON.parse(readFileSync(join(contentRoot, LANGUAGES), "utf8")));
}

/** The tag itself when it is a play language, else the default: a caller never invents a tag. */
export async function playLanguageTag(contentRoot: string, tag: unknown): Promise<string> {
	const known = await loadPlayLanguages(contentRoot);
	return typeof tag === "string" && known.languages[tag] ? tag : known.default;
}

function parseSurface(tag: string, name: string, text: string): Record<string, string> {
	let raw: unknown;
	try { raw = JSON.parse(text); }
	catch (error) { throw new Error(`content/ui/${tag}/${name} is not a JSON object: ${error instanceof Error ? error.message : String(error)}`); }
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`content/ui/${tag}/${name} is not a JSON object`);
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

function readSurfacesSync(contentRoot: string, tag: string): Record<string, Record<string, string>> {
	const folder = join(contentRoot, UI, tag);
	let names: string[];
	try { names = readdirSync(folder).filter(name => name.endsWith(".json")).sort(); }
	catch { return {}; }
	const words: Record<string, Record<string, string>> = {};
	for (const name of names) words[name.slice(0, -5)] = parseSurface(tag, name, readFileSync(join(folder, name), "utf8"));
	return words;
}

function mergeSurfaces(known: PlayLanguages, tag: unknown, base: Record<string, Record<string, string>>, own: Record<string, Record<string, string>>): UiWords {
	const wanted = typeof tag === "string" && known.languages[tag] ? tag : known.default;
	const words: Record<string, Record<string, string>> = {};
	for (const surface of new Set([...Object.keys(base), ...Object.keys(own)]))
		words[surface] = { ...(base[surface] ?? {}), ...(own[surface] ?? {}) };
	return { tag: wanted, words };
}

/** Every surface's words for `tag`, each key filled from the default language when `tag` lacks it. */
export async function loadUiWords(contentRoot: string, tag: unknown): Promise<UiWords> {
	const known = await loadPlayLanguages(contentRoot);
	const wanted = typeof tag === "string" && known.languages[tag] ? tag : known.default;
	const base = await readSurfaces(contentRoot, known.default);
	return mergeSurfaces(known, wanted, base, wanted === known.default ? base : await readSurfaces(contentRoot, wanted));
}

/**
 * The same words read without yielding. An extension that paints a status line inside a bus event
 * cannot wait for a file: by the time a read resolves the turn may be over and the line lost. The
 * files are small and read once per tag; a host that can wait uses `loadUiWords`.
 */
export function loadUiWordsSync(contentRoot: string, tag: unknown): UiWords {
	const known = loadPlayLanguagesSync(contentRoot);
	const wanted = typeof tag === "string" && known.languages[tag] ? tag : known.default;
	const base = readSurfacesSync(contentRoot, known.default);
	return mergeSurfaces(known, wanted, base, wanted === known.default ? base : readSurfacesSync(contentRoot, wanted));
}
