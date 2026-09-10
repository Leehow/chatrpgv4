/**
 * The projection lane for the product's own captions (contract §23, 2026-09-09).
 *
 * `content/ui/<source>/` is the only authored set of words. Every other tag gets those words
 * rewritten by a tool-enabled presenter run, exactly as a character card's text is: two rounds
 * against a checker the run can execute itself, what validated accepted, the remainder asked once
 * more. The answer is cached per tag under the home -- `.coc/ui-words/<tag>-<digest>.json` -- so
 * every campaign in that home pays for a tag once, and an edited caption or an edited instruction
 * changes the digest and starts a clean projection rather than serving the old wording.
 *
 * Two tags never reach the model: the authored tag itself, which is the source, and a tag the
 * product ships a seed for, whose seed is already the cache.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runtimeEntryUrl } from "../../runtime/deployment.mjs";
import {
	PLAY_LANGUAGE_TAG, loadPlayLanguages, resolveUiWords, uiWordsCachePath, uiWordsDigest,
	type UiWordsCache,
} from "../../runtime/ui-words.ts";
import { coded } from "../ui/errors.ts";
import { extensionContentRoot } from "../ui/words.ts";
import type { ReaderRequest, ReaderOutcome } from "./reader.ts";

/** The lane's instruction, beside the card's own in the same content bundle. */
const INSTRUCTION = "setup/ui-presentation.md";

/** One place a caption appears: the surface file it lives in, the key it is filed under, and the authored words. */
export interface UiCaption {
	surface: string;
	key: string;
	text: string;
}

export interface UiWordsProjection {
	play_language: string;
	digest: string;
	texts: Record<string, Record<string, string>>;
}

export interface UiPresentationOptions {
	home: string;
	contentRoot?: string;
	play_language: string;
	model?: string;
	thinking?: string;
	signal?: AbortSignal;
	runner?: (request: ReaderRequest) => Promise<ReaderOutcome>;
}

/**
 * Every authored caption as a row, in a stable order.
 *
 * Rows rather than a flat `surface.key` map because a key may itself contain a dot (`item.name` on
 * the sheet), and a flat key would be ambiguous to split back apart on the way home.
 */
export function uiCaptions(words: Record<string, Record<string, string>>): UiCaption[] {
	const rows: UiCaption[] = [];
	for (const surface of Object.keys(words).sort())
		for (const key of Object.keys(words[surface] ?? {}).sort()) {
			const text = words[surface][key];
			if (typeof text === "string" && text.trim()) rows.push({ surface, key, text });
		}
	return rows;
}

/** The distinct source strings a set of rows asks for: one caption written twice is one question. */
export function uiSourceTexts(captions: readonly UiCaption[]): string[] {
	return [...new Set(captions.map(row => row.text))].sort();
}

/**
 * The checker the run executes: every asked string answered with a non-empty string, nothing else.
 *
 * All-or-nothing on purpose, because that is what the run must repair before it finishes. The
 * pipeline itself keeps what validated (`acceptedUiTexts`) so one dropped caption costs a word and
 * not the whole round.
 */
function validCaption(source: string, value: unknown): value is string {
	if (typeof value !== "string" || !value.trim()) return false;
	const placeholders = (text: string) => JSON.stringify((text.match(/\{[^{}]+\}/g) ?? []).sort());
	return placeholders(source) === placeholders(value);
}

export function validateUiPresentation(value: unknown, texts: readonly string[]): Record<string, string> {
	const map = (value as { texts?: unknown })?.texts as Record<string, unknown> | undefined;
	if (!map || typeof map !== "object" || Array.isArray(map)
		|| Object.keys(map).length !== texts.length
		|| texts.some(text => !validCaption(text, map[text])))
		throw coded("preparation_failed", "Incomplete UI word projection");
	return Object.fromEntries(texts.map(text => [text, map[text] as string]));
}

/** What this round got right, whatever it got wrong: a near miss costs one more question, not the tag. */
export function acceptedUiTexts(value: unknown, wanted: readonly string[]): Record<string, string> {
	const map = (value as { texts?: unknown })?.texts as Record<string, unknown> | undefined;
	if (!map || typeof map !== "object" || Array.isArray(map)) return {};
	return Object.fromEntries(wanted
		.filter(text => validCaption(text, map[text]))
		.map(text => [text, map[text] as string]));
}

/** The rows put back into `{surface: {key: word}}`, dropping a caption the projection never answered. */
export function assembleUiWords(captions: readonly UiCaption[], projected: Record<string, string>): Record<string, Record<string, string>> {
	const words: Record<string, Record<string, string>> = {};
	for (const row of captions) {
		const word = projected[row.text];
		if (typeof word !== "string" || !word.trim()) continue;
		(words[row.surface] ??= {})[row.key] = word;
	}
	return words;
}

async function writeCache(path: string, cache: UiWordsCache): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `${randomUUID()}.tmp`);
	await writeFile(temporary, JSON.stringify(cache, null, 2));
	await rename(temporary, path);
}

/**
 * The captions for one play language, projecting them first if nothing has.
 *
 * Answers the cache when one is current, and otherwise runs the presenter and writes one. The host
 * calls this in the background: the panel already has the authored words and redraws when this
 * lands (contract §23).
 */
export async function prepareUiWords(options: UiPresentationOptions): Promise<UiWordsProjection> {
	const contentRoot = extensionContentRoot(options.contentRoot);
	const tag = options.play_language;
	if (typeof tag !== "string" || !PLAY_LANGUAGE_TAG.test(tag) || typeof options.home !== "string" || !options.home)
		throw coded("invalid_params", "Invalid UI word projection request");
	const known = await loadPlayLanguages(contentRoot);
	const digest = await uiWordsDigest(contentRoot, known);
	// The authored tag is the source, and a shipped seed is already this tag's cache: neither
	// writes a file, and neither asks the model. `resolveUiWords` settles which of the two it is.
	const resolved = await resolveUiWords({ contentRoot, home: options.home, tag });
	if (resolved.projected) return { play_language: resolved.tag, digest, texts: resolved.words };

	const authored = await resolveUiWords({ contentRoot, tag: known.source });
	const captions = uiCaptions(authored.words);
	if (!captions.length) throw coded("preparation_failed", "This build ships no captions to project");
	const prompt = join(contentRoot, INSTRUCTION);
	// Read once before any model round: a build whose instruction is missing must fail here, not
	// after two runs that were told nothing.
	await readFile(prompt, "utf8");
	const runner = options.runner;
	if (!runner) throw coded("preparation_failed", "UI word projection requires its owner runtime");

	const attempt = join(options.home, ".coc/ui-words/attempts", randomUUID());
	await mkdir(attempt, { recursive: true });
	await writeFile(join(attempt, "check.mjs"),
		`import {readFileSync} from 'node:fs';\n` +
		`import {validateUiPresentation} from ${JSON.stringify(runtimeEntryUrl("uiPresentation", import.meta.url))};\n` +
		`try {const packet=JSON.parse(readFileSync('texts.json','utf8'));` +
		`validateUiPresentation(JSON.parse(readFileSync('presentation.json','utf8')),packet.texts);` +
		`console.log('Presentation valid');}` +
		`catch(error){console.error(error.message);process.exitCode=1;}\n`);

	let missing = uiSourceTexts(captions);
	const projected: Record<string, string> = {};
	for (let round = 1; round <= 2 && missing.length; round++) {
		await writeFile(join(attempt, "texts.json"), JSON.stringify({
			play_language: tag,
			captions: captions.filter(row => missing.includes(row.text)),
			texts: missing,
		}, null, 2));
		const outcome = await runner({
			cwd: attempt, systemPrompt: prompt, model: options.model, thinking: options.thinking,
			signal: options.signal, eventLog: join(attempt, `events-${round}.jsonl`), timeoutMs: 120000,
			brief: "Read texts.json and write the projected captions to presentation.json. Its \"texts\" object answers exactly the strings texts.json lists, keyed by the source string itself. The file must contain exactly one JSON object, without Markdown or trailing text. Run node check.mjs and correct any error before finishing."
				+ (round > 1 ? " Read findings.json and supply exactly the strings it still names; the captions already accepted are not asked again." : ""),
		});
		if (!outcome.ok || options.signal?.aborted)
			throw coded(options.signal?.aborted ? "presentation_timeout" : "preparation_failed", "The UI words could not be projected");
		let value: unknown;
		try { value = JSON.parse(await readFile(join(attempt, "presentation.json"), "utf8")); }
		catch (error) {
			await writeFile(join(attempt, "findings.json"), JSON.stringify({ error: String(error), texts: missing }, null, 2));
			continue;
		}
		Object.assign(projected, acceptedUiTexts(value, missing));
		missing = missing.filter(text => !projected[text]);
		if (missing.length)
			await writeFile(join(attempt, "findings.json"), JSON.stringify({
				error: "these source strings were not answered with a non-empty string", texts: missing,
			}, null, 2));
	}
	if (missing.length)
		throw coded("preparation_failed", `Incomplete UI word projection: ${missing.length} caption${missing.length === 1 ? "" : "s"} were not projected`);

	const cache: UiWordsCache = { play_language: tag, digest, texts: assembleUiWords(captions, projected) };
	await writeCache(uiWordsCachePath(options.home, tag, digest), cache);
	return cache;
}
