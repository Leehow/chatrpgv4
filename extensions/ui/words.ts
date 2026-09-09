/**
 * The words this product's own chrome says to a player, read from data rather than written here.
 *
 * Contract §23 (2026-09-09): every player-visible caption travels the campaign's play language by
 * mechanism. `content/languages.json` is the closed set of tags and the default; each
 * `content/ui/<tag>/extension.json` holds the captions the extensions notify with. Nothing in this
 * directory names a tag, keeps a two-column table, or guesses a language from the text it is about
 * to print: an extension says which tag the campaign carries and asks for a key.
 *
 * A caption with values in it is a template in the data (`"turn {turn}"`), filled by `fill` here --
 * one filler for every surface, so adding a language is adding a file. A key no language declares
 * renders as the key itself: an identifier and a visible gap, never a word from another language.
 */
import { join, resolve } from "node:path";
import { resourceRootFrom } from "../../runtime/deployment.mjs";
import { loadUiWords, type UiWords } from "../../runtime/ui-words.ts";

/** The surface these captions live on; every other surface belongs to a renderer. */
const SURFACE = "extension";

/**
 * Where `content/` sits, resolved exactly as `runtime/host.ts` resolves it for the kernel:
 * `PI_COC_CONTENT_ROOT` when a host has relocated the bundle, otherwise `content/` beside the
 * resource root. The language declaration and the caption files belong to the content bundle, so a
 * relocated bundle must carry `languages.json` and `ui/<tag>/` as it carries `starters/`.
 */
export function extensionContentRoot(override?: string): string {
	const relocated = process.env.PI_COC_CONTENT_ROOT?.trim();
	return override ?? (relocated ? resolve(relocated) : join(resourceRootFrom(import.meta.url), "content"));
}

/**
 * `{name}` placeholders filled from one map. A value that is absent leaves its placeholder standing,
 * because a hole named in the output reads as the data gap it is, and a silently dropped one does not.
 */
export function fill(template: string, values: Record<string, unknown> = {}): string {
	return template.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, key: string) => {
		const value = values[key];
		return value === undefined || value === null ? placeholder : String(value);
	});
}

export interface ExtensionWords {
	/** The play language these captions were read for. */
	readonly tag: string;
	/** The caption for `key`, or the key itself when no shipped language declares it. */
	word(key: string): string;
	/** The caption for `key` with its `{placeholders}` filled. */
	line(key: string, values?: Record<string, unknown>): string;
}

function surface(loaded: UiWords): ExtensionWords {
	const words = loaded.words[SURFACE] ?? {};
	const word = (key: string) => words[key] ?? key;
	return { tag: loaded.tag, word, line: (key, values) => fill(word(key), values) };
}

/** The captions for one tag; an unknown or absent tag reads as the language `content/languages.json` defaults to. */
export async function extensionWords(tag: unknown, contentRoot?: string): Promise<ExtensionWords> {
	return surface(await loadUiWords(extensionContentRoot(contentRoot), tag));
}

export interface ExtensionSurface {
	/** The campaign's play language, exactly as the answer that carried it named it; anything else reads as the default. */
	speak(tag: unknown): void;
	/** This extension's captions, read once per tag and re-read when the campaign's language changes. */
	words(): Promise<ExtensionWords>;
}

/**
 * One extension's handle on the surface. The files are read once per tag and held in the extension's
 * own closure rather than in a module-level cache, so two sessions in one process (the test harness,
 * a host that opens a second table) never inherit each other's language.
 */
export function extensionSurface(contentRoot?: string): ExtensionSurface {
	let requested: unknown;
	let pending: Promise<ExtensionWords> | undefined;
	return {
		speak(tag: unknown): void {
			if (tag === requested) return;
			requested = tag;
			pending = undefined;
		},
		words(): Promise<ExtensionWords> {
			return (pending ??= extensionWords(requested, contentRoot).catch((error) => {
				// A content root that could not be read is not cached as an answer: the next line tries again.
				pending = undefined;
				throw error;
			}));
		},
	};
}
