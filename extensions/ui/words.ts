/**
 * The words this product's own chrome says to a player, read from data rather than written here.
 *
 * Contract §23 (2026-09-09): every player-visible caption travels the campaign's play language by
 * mechanism, and the tag set is open. `content/ui/<source>/extension.json` holds the authored
 * captions the extensions notify with; any other tag reaches its own through a shipped seed or
 * through the projection the lane cached under the home. Nothing in this directory names a tag,
 * keeps a two-column table, or guesses a language from the text it is about to print: an extension
 * says which tag the campaign carries and asks for a key.
 *
 * A caption with values in it is a template in the data (`"turn {turn}"`), filled by `fill` here --
 * one filler for every surface, so a new language is a projection and never a file to write. A key
 * no projection carries renders as the key itself: an identifier and a visible gap, never a word
 * from another language.
 */
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { resourceRootFrom } from "../../runtime/deployment.mjs";
import { resolveUiWords, resolveUiWordsSync, type UiWords } from "../../runtime/ui-words.ts";

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
 * The workspace root `.coc/` sits under, and with it `.coc/ui-words/`: the same resolution
 * `extensions/lanes/host.ts` makes for every other campaign file (`PI_COC_HOME`, otherwise the
 * working directory). It is read here rather than handed down from a session because a caption may
 * be painted inside a bus event that carries no context at all; a home holding no cache simply
 * leaves the authored words standing until the lane has written one.
 */
export function extensionHome(override?: string): string {
	if (override) return override;
	const raw = process.env.PI_COC_HOME?.trim();
	if (!raw) return process.cwd();
	const expanded = raw === "~" ? homedir() : raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
	return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
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
	/** Whether they are written in it. False is the authored words standing in until the lane lands. */
	readonly projected: boolean;
	/** The caption for `key`, or the key itself when no surface declares it. */
	word(key: string): string;
	/** The caption for `key` with its `{placeholders}` filled. */
	line(key: string, values?: Record<string, unknown>): string;
	/**
	 * A caption from another surface's vocabulary, or the key itself.
	 *
	 * A word belongs to one surface and is asked for from wherever it is needed: the condition names
	 * are the delivery card's (`mechanics`), and the host's out-of-fiction state line (§42.6) has to
	 * say one of them in the play language. Copying those names onto this surface would be a second
	 * place every new condition has to be translated, and the two copies drift the first time only
	 * one is projected. The renderers already read across surfaces this way (`pipicoc/panel.js` draws
	 * the sheet from `sheet` and its item chrome from `paper`); this is that, for an extension.
	 *
	 * The caption inventory is scanned from `.word(...)` / `.line(...)` call sites, so a key asked
	 * for here is deliberately outside it: it is owned and guarded by the surface it lives on.
	 */
	wordOn(surface: string, key: string): string;
}

function surface(loaded: UiWords): ExtensionWords {
	const words = loaded.words[SURFACE] ?? {};
	const word = (key: string) => words[key] ?? key;
	return {
		tag: loaded.tag, projected: loaded.projected, word,
		line: (key, values) => fill(word(key), values),
		wordOn: (name, key) => loaded.words[name]?.[key] ?? key,
	};
}

/** The captions for one tag; a value of no tag shape at all reads as the tag the data defaults to. */
export async function extensionWords(tag: unknown, contentRoot?: string, home?: string): Promise<ExtensionWords> {
	return surface(await resolveUiWords({ contentRoot: extensionContentRoot(contentRoot), home: extensionHome(home), tag }));
}

export interface ExtensionSurface {
	/** The campaign's play language, exactly as the answer that carried it named it; anything else reads as the default. */
	speak(tag: unknown): void;
	/**
	 * Forget what is held for `tag`, because the projection lane has just written it.
	 *
	 * The host puts `coc:ui-words {tag}` on the bus when a background projection lands. A surface
	 * that had already settled on the authored words would otherwise go on saying them for the rest
	 * of the session, on a table whose panels have all switched over.
	 */
	refresh(tag: unknown): void;
	/** This extension's captions, read once per tag and re-read when the campaign's language changes. */
	words(): Promise<ExtensionWords>;
	/**
	 * The same captions without yielding, for a line painted inside a bus event: a status line that
	 * waited for a file read used to land after the turn it described. A content root that cannot be
	 * read answers with the keys themselves, and the next call reads again.
	 */
	wordsNow(): ExtensionWords;
}

/**
 * One extension's handle on the surface. The files are read once per tag and held in the extension's
 * own closure rather than in a module-level cache, so two sessions in one process (the test harness,
 * a host that opens a second table) never inherit each other's language.
 *
 * Only a projected answer is held. The authored words are a stand-in, and holding them would pin an
 * extension to them for the whole session -- a caption is small, and reading it again is what lets
 * the cache take over the moment the lane has written it, even if the bus event was missed.
 */
export function extensionSurface(contentRoot?: string, home?: string): ExtensionSurface {
	let requested: unknown;
	let pending: Promise<ExtensionWords> | undefined;
	let settled: ExtensionWords | undefined;
	return {
		speak(tag: unknown): void {
			if (tag === requested) return;
			requested = tag;
			pending = undefined;
			settled = undefined;
		},
		refresh(tag: unknown): void {
			// The event names the tag that landed; a surface speaking a different one keeps what it holds.
			if (settled && settled.tag !== tag) return;
			pending = undefined;
			settled = undefined;
		},
		wordsNow(): ExtensionWords {
			if (settled) return settled;
			try {
				const loaded = surface(resolveUiWordsSync({ contentRoot: extensionContentRoot(contentRoot), home: extensionHome(home), tag: requested }));
				return loaded.projected ? (settled = loaded) : loaded;
			}
			catch { return { tag: typeof requested === "string" ? requested : "", projected: false, word: (key) => key, line: (key, values) => fill(key, values), wordOn: (_surface, key) => key }; }
		},
		words(): Promise<ExtensionWords> {
			return (pending ??= extensionWords(requested, contentRoot, home).then((loaded) => {
				if (!loaded.projected) pending = undefined;
				return loaded;
			}, (error) => {
				// A content root that could not be read is not cached as an answer: the next line tries again.
				pending = undefined;
				throw error;
			}));
		},
	};
}
