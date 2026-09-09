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
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface PlayLanguage { autonym: string; script?: string }
export interface PlayLanguages { default: string; languages: Record<string, PlayLanguage> }
export interface UiWords { tag: string; words: Record<string, Record<string, string>> }

const LANGUAGES = "languages.json";
const UI = "ui";

export async function loadPlayLanguages(contentRoot: string): Promise<PlayLanguages> {
	const raw = JSON.parse(await readFile(join(contentRoot, LANGUAGES), "utf8"));
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

/** The tag itself when it is a play language, else the default: a caller never invents a tag. */
export async function playLanguageTag(contentRoot: string, tag: unknown): Promise<string> {
	const known = await loadPlayLanguages(contentRoot);
	return typeof tag === "string" && known.languages[tag] ? tag : known.default;
}

async function readSurfaces(contentRoot: string, tag: string): Promise<Record<string, Record<string, string>>> {
	const folder = join(contentRoot, UI, tag);
	let names: string[];
	try { names = (await readdir(folder)).filter(name => name.endsWith(".json")).sort(); }
	catch { return {}; }
	const words: Record<string, Record<string, string>> = {};
	for (const name of names) {
		const surface = name.slice(0, -5);
		let raw: unknown;
		try { raw = JSON.parse(await readFile(join(folder, name), "utf8")); }
		catch (error) { throw new Error(`content/ui/${tag}/${name} is not a JSON object: ${error instanceof Error ? error.message : String(error)}`); }
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`content/ui/${tag}/${name} is not a JSON object`);
		words[surface] = Object.fromEntries(Object.entries(raw as Record<string, unknown>)
			.filter((entry): entry is [string, string] => typeof entry[1] === "string"));
	}
	return words;
}

/** Every surface's words for `tag`, each key filled from the default language when `tag` lacks it. */
export async function loadUiWords(contentRoot: string, tag: unknown): Promise<UiWords> {
	const known = await loadPlayLanguages(contentRoot);
	const wanted = typeof tag === "string" && known.languages[tag] ? tag : known.default;
	const base = await readSurfaces(contentRoot, known.default);
	const own = wanted === known.default ? base : await readSurfaces(contentRoot, wanted);
	const words: Record<string, Record<string, string>> = {};
	for (const surface of new Set([...Object.keys(base), ...Object.keys(own)]))
		words[surface] = { ...(base[surface] ?? {}), ...(own[surface] ?? {}) };
	return { tag: wanted, words };
}
