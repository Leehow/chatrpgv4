/**
 * The projection lane for a module's authored map words (contract §23 and §39.2).
 *
 * `apply map` carries labels the Keeper wrote in the campaign's `play_language`, so nothing here
 * touches those cards. The first-arrival card of §39.2 has no Keeper in its path at all: the kernel
 * mints it when a real `apply move` lands on a depicted scene, and every word on it -- the map's
 * title, each region's name, each level's name -- is the module's own, in whatever language the
 * module was written in. Retained live evidence (campaign `game-5779d0fd`, turn 2, a table whose
 * `play_language` is `zh-Hans`): one title, nine region labels and three level labels reached the
 * player in English while every other mechanics row that turn was in the play language.
 *
 * This is the same second leg §23 gives the product's own captions: a presenter run rewrites the
 * authored words, a checker the run can execute itself decides whether it answered, and the answer
 * is cached per tag under the home so a module pays for a tag once. Nothing here reads a table
 * keyed by a language, compares a tag, or guesses which language a label is already in -- the
 * presenter selects `keep` when a string is already in `play_language`, and the host restores it,
 * because deciding that is a semantic question and belongs to the model.
 *
 * The cache is a dictionary rather than a whole-card artifact, and grows: two maps in one module
 * share their level names, and a card that arrives later asks only for the strings no run has
 * answered yet.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resourceRootFrom, runtimeEntryUrl } from "../../runtime/deployment.mjs";
import {
	acceptPresentationReferences, issuePresentationReferences, selectPresentationReferences,
	type PresentationCatalog, type PresentationSource, validatePresentationReferenceShape,
} from "../../runtime/jev/presentation-references.ts";
import { PLAY_LANGUAGE_TAG } from "../../runtime/ui-words.ts";
import { coded } from "../ui/errors.ts";
import { reasoned, readerFailureReason } from "./reader.ts";
import type { ReaderRequest, ReaderOutcome } from "./reader.ts";
import { runPresentationAttempt } from "./presentation-attempt.ts";

/** The lane's instruction, read from the resource root so a packaged run finds the same file. */
const INSTRUCTION = "extensions/module/map-presentation.md";
/** Where a projected tag is cached, under the campaign home rather than in the read-only bundle. */
const CACHE = ".coc/map-words";
/**
 * The two values a map card's `words` takes, as the kernel mints them (`kernel-ts/read/maps.ts`).
 *
 * They cross the RPC boundary as literals, so they are declared on both sides and pinned together
 * by `tests/extension/map-words.test.mjs`: the two ends of a seam agreeing on different spellings
 * is how this repository has lost a field before.
 */
export const AUTHORED_MAP_WORDS = "source", KEEPER_MAP_WORDS = "play_language";

/** A floor-plan caption. Anything longer is a sentence, which this lane is not for. */
const MAX_TEXT = 200;
/** One card's worth of captions at a time; a module larger than this asks over several runs. */
export const MAX_TEXTS = 120;

export interface MapWordsOptions {
	home: string;
	resourceRoot?: string;
	play_language: string;
	model?: string;
	thinking?: string;
	signal?: AbortSignal;
	runner?: (request: ReaderRequest) => Promise<ReaderOutcome>;
}

/** What the lane writes: the tag it projected, the instruction it projected under, and source word to projected word. */
export interface MapWordsCache {
	play_language: string;
	digest: string;
	texts: Record<string, string>;
}

/** The shape this lane reads off a prepared card; the renderer's own type is a superset of it. */
export interface MapCardWords {
	name?: string;
	label?: string;
	words?: string;
	regions?: Array<{ label?: string; level?: string } & Record<string, unknown>>;
	levels?: string[];
}

function instructionPath(resourceRoot?: string): string {
	return join(resourceRoot ?? resourceRootFrom(import.meta.url), INSTRUCTION);
}

/** A caption worth asking about: a non-empty string short enough to be a label. */
function caption(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEXT;
}

/**
 * Every authored word one prepared card would print, distinct and in a stable order.
 *
 * Region ids are deliberately not here. They are machine handles the Keeper names regions by, they
 * are never drawn, and asking a model to rewrite one would break the only key the card and
 * `world.map_knowledge` agree on.
 */
export function mapCardTexts(card: MapCardWords): string[] {
	const texts = [card.label, card.name];
	for (const region of card.regions ?? []) {
		texts.push(region?.label);
		texts.push(region?.level);
	}
	for (const level of card.levels ?? []) texts.push(level);
	return [...new Set(texts.filter(caption))].sort();
}

/**
 * The card with its authored words replaced, and whether every one of them was answered.
 *
 * A card is only ever wholly projected or wholly authored. Half a floor plan in the player's
 * language and half in the author's reads as a rendering fault rather than as a pending lane, and
 * the pair `{label, level}` on one region is what a player matches against the picture.
 */
export function projectMapCard<T extends MapCardWords>(card: T, words: Record<string, string>): { card: T; projected: boolean } {
	const texts = mapCardTexts(card);
	if (!texts.length || !texts.every(text => caption(words[text]))) return { card, projected: false };
	const word = (value: unknown): any => (caption(value) && caption(words[value]) ? words[value] : value);
	return {
		card: {
			...card,
			...(card.label === undefined ? {} : { label: word(card.label) }),
			...(card.name === undefined ? {} : { name: word(card.name) }),
			...(card.regions === undefined ? {} : { regions: card.regions.map(region => ({ ...region, ...(region?.label === undefined ? {} : { label: word(region.label) }), ...(region?.level === undefined ? {} : { level: word(region.level) }) })) }),
			...(card.levels === undefined ? {} : { levels: card.levels.map(level => word(level)) }),
		},
		projected: true,
	};
}

/**
 * The checker the run executes: every asked string answered with a non-empty caption, nothing else.
 *
 * All-or-nothing, because that is what the run must repair before it finishes. `prepareMapWords`
 * keeps what validated, so one dropped label costs one more question rather than the whole round.
 */
export function validateMapPresentation(value: unknown, sources: readonly PresentationSource[]): void {
	try {
		validatePresentationReferenceShape(value, sources);
		const rows = (value as {texts:Array<Record<string,unknown>>}).texts;
		if (rows.some(row => row.action === 'translate' && !caption(row.text))) throw new Error('Invalid caption');
	} catch { throw coded("preparation_failed", "Incomplete map word projection"); }
}

/** What this round got right, whatever it got wrong. */
export function acceptedMapTexts(value: unknown, catalog: PresentationCatalog): Record<string, string> {
	return Object.fromEntries(Object.entries(acceptPresentationReferences(value, catalog).texts).filter(([,text]) => caption(text)));
}

async function digestOf(resourceRoot?: string): Promise<string> {
	// The instruction is the whole digest: edit what the presenter was told and every cached word
	// is stale, exactly as an edited caption invalidates a cached UI tag.
	return createHash("sha256").update(await readFile(instructionPath(resourceRoot), "utf8")).digest("hex");
}

/**
 * What a cached projection was made from: the presenter's whole instruction.
 *
 * It is the file name, so an edited instruction is never read back and quietly disagreed with --
 * the same rule the UI words cache follows.
 */
export async function mapWordsDigest(resourceRoot?: string): Promise<string> {
	return digestOf(resourceRoot);
}

/** Where the lane caches one tag. The tag is settled by shape before it reaches here, so it names a file safely. */
export function mapWordsCachePath(home: string, tag: string, digest: string): string {
	return join(home, CACHE, `${tag}-${digest}.json`);
}

function parseCache(raw: unknown, tag: string, digest: string): Record<string, string> {
	const saved = raw as MapWordsCache | undefined;
	if (!saved || typeof saved !== "object" || saved.play_language !== tag || saved.digest !== digest) return {};
	if (!saved.texts || typeof saved.texts !== "object" || Array.isArray(saved.texts)) return {};
	return Object.fromEntries(Object.entries(saved.texts as Record<string, unknown>)
		.filter((entry): entry is [string, string] => caption(entry[1])));
}

/**
 * The words already projected for one tag: a plain file read, so a turn can ask without waiting on
 * a model. A missing, stale or half-written cache answers `{}` -- which reads as "nothing projected
 * yet", never as an error that could take a delivery down with it.
 */
export async function readMapWords(options: { home: string; play_language: string; resourceRoot?: string }): Promise<Record<string, string>> {
	const tag = options.play_language;
	if (typeof tag !== "string" || !PLAY_LANGUAGE_TAG.test(tag) || typeof options.home !== "string" || !options.home) return {};
	try {
		const digest = await digestOf(options.resourceRoot);
		return parseCache(JSON.parse(await readFile(mapWordsCachePath(options.home, tag, digest), "utf8")), tag, digest);
	}
	catch { return {}; }
}

async function writeCache(path: string, cache: MapWordsCache): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `${randomUUID()}.tmp`);
	await writeFile(temporary, JSON.stringify(cache, null, 2));
	await rename(temporary, path);
}

/**
 * Project every asked string that has none yet, and merge the answers into the tag's cache.
 *
 * Returns the whole dictionary for the tag, the words it already held included, so a caller can use
 * the result without reading the file again. Asking for nothing new is free and never starts a run:
 * that is what makes it safe to call this on every arrival and once when the table opens.
 */
export async function prepareMapWords(options: MapWordsOptions, wanted: readonly string[]): Promise<Record<string, string>> {
	const tag = options.play_language;
	if (typeof tag !== "string" || !PLAY_LANGUAGE_TAG.test(tag) || typeof options.home !== "string" || !options.home)
		throw coded("invalid_params", "Invalid map word projection request");
	const digest = await digestOf(options.resourceRoot);
	const path = mapWordsCachePath(options.home, tag, digest);
	const held = await readMapWords(options);
	let missing = [...new Set(wanted.filter(caption))].filter(text => !caption(held[text])).sort().slice(0, MAX_TEXTS);
	if (!missing.length) return held;
	const runner = options.runner;
	if (!runner) throw coded("preparation_failed", "Map word projection requires its owner runtime");
	const prompt = instructionPath(options.resourceRoot);

	const attempt = join(options.home, `${CACHE}/attempts`, randomUUID());
	const checkSource =
		`import {readFileSync} from 'node:fs';\n` +
		`import {validateMapPresentation} from ${JSON.stringify(runtimeEntryUrl("mapPresentation", import.meta.url))};\n` +
		`try {const packet=JSON.parse(readFileSync('texts.json','utf8'));` +
		`validateMapPresentation(JSON.parse(readFileSync('presentation.json','utf8')),packet.sources);` +
		`console.log('Presentation valid');}` +
		`catch(error){console.error(error.message);process.exitCode=1;}\n`;

	const projected: Record<string, string> = {};
	const catalog = issuePresentationReferences(missing);
	await runPresentationAttempt({
		attempt, checkSource, outputFile: "presentation.json", systemPrompt: prompt, runner,
		model: options.model, thinking: options.thinking, signal: options.signal,
		prepareRound: async round => {
			const current = selectPresentationReferences(catalog, missing);
			await writeFile(join(attempt, "texts.json"), JSON.stringify({ protocol:current.protocol, play_language: tag, sources: current.sources }, null, 2));
			return "Read texts.json and write one presentation-reference-v1 keep or translate operation for every issued source alias to presentation.json. Keep selects the source without copying it; translate contains only newly generated target-language text. Never use source strings as output keys or unchanged values. The file must contain exactly one JSON object, without Markdown or trailing text. Run node check.mjs and correct any error before finishing."
				+ (round > 1 ? " Read findings.json and supply exactly the source aliases it still names; accepted words are not asked again." : "");
		},
		failure: (outcome, aborted) => coded(aborted ? "presentation_timeout" : "preparation_failed",
			reasoned("The map words could not be projected", aborted ? undefined : readerFailureReason(outcome))),
		invalidOutput: error => ({ error: String(error), sources: selectPresentationReferences(catalog, missing).sources.map(source => source.alias) }),
		accept: value => {
			Object.assign(projected, acceptedMapTexts(value, selectPresentationReferences(catalog, missing)));
			missing = missing.filter(text => !projected[text]);
			return missing.length ? { done: false, findings: {
				error: "these source aliases were not answered with a valid keep or short translation",
				sources: selectPresentationReferences(catalog, missing).sources.map(source => source.alias),
			} } : { done: true };
		},
	});
	// A word that survived two rounds unanswered is not retried here. What is kept is what validated:
	// a card whose labels are all in hand is projected, and one still missing a label stays authored
	// and says so, rather than going out half in each language.
	const merged = { ...(await readMapWords(options)), ...held, ...projected };
	if (Object.keys(projected).length) await writeCache(path, { play_language: tag, digest, texts: merged });
	if (missing.length)
		throw coded("preparation_failed", `Incomplete map word projection: ${missing.length} label${missing.length === 1 ? "" : "s"} were not projected`);
	return merged;
}
