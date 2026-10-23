/**
 * Contract §262.5: the sectioned skeleton. The book's blocks are partitioned at bookmark pages into sections of at most
 * about 12K tokens; one bounded reader per section writes names, cross references, conditional events and Keeper truth
 * with block ids; the host merges them into `skeleton.json`. The skeleton is reader input only (§262.3 cross references):
 * never graph material, and a name it lacks is unknown, never absent.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { HostRuntime } from "../../runtime/host.ts";
import { readerInput, type ReaderRequest } from "./reader.ts";
import { sourceBlocksFor } from "./lean-read.ts";
import { roughTokens, type SourceBlocksPage } from "./source-blocks.ts";

type Row = Record<string, any>;
export const SKELETON_BOUNDS = { sectionTokens: 12000, requests: 4 } as const;
/** The merged skeleton's shape; a kept skeleton of another version is merged again from its kept section answers. */
export const SKELETON_VERSION = 3;
const LISTS = ["cross_references", "conditional_events", "keeper_truth"] as const;

export type SkeletonSection = { name: string; first: number; last: number };

/** Name normalisation for matching (case, spacing and the middle-dot family); not a judgement of what a name means. */
export const normalName = (name: string): string => name.normalize("NFKC").toLowerCase().replace(/[\s\u00b7\u30fb\u2027\u2022.]/g, "");

/** Bookmarks flattened to their start pages, two levels deep. */
function starts(bookmarks: unknown, depth = 0): Array<{ name: string; page: number }> {
	if (!Array.isArray(bookmarks) || depth > 1) return [];
	return bookmarks.flatMap((row: Row) => [...(typeof row?.name === "string" && Number.isSafeInteger(row.page) ? [{ name: row.name.trim(), page: row.page as number }] : []),
		...starts(row?.children, depth + 1)]);
}

/** §262.5: sections from bookmark starts over the book's pages, each split at a page boundary to stay under the token bound. */
export function skeletonSections(pageCount: number, bookmarks: unknown, tokensOfPage: (page: number) => number): SkeletonSection[] {
	const marks = [...new Map(starts(bookmarks).filter(mark => mark.page >= 1 && mark.page <= pageCount).sort((a, b) => a.page - b.page)
		.map(mark => [mark.page, mark] as const)).values()];
	if (!marks.length || marks[0].page > 1) marks.unshift({ name: "Front", page: 1 });
	const out: SkeletonSection[] = [];
	// Neighbouring bookmarks share one section while it stays under the bound; a call's fixed prompt is paid once.
	const tokens = (first: number, last: number) => { let sum = 0; for (let page = first; page <= last; page++) sum += tokensOfPage(page); return sum; };
	const merged: Array<{ name: string; page: number }> = [];
	marks.forEach((mark, i) => {
		const end = (marks[i + 1]?.page ?? pageCount + 1) - 1, open = merged.at(-1);
		if (open && tokens(open.page, end) <= SKELETON_BOUNDS.sectionTokens) return;
		merged.push(mark);
	});
	marks.splice(0, marks.length, ...merged);
	marks.forEach((mark, i) => {
		const end = (marks[i + 1]?.page ?? pageCount + 1) - 1;
		let first = mark.page, spent = 0;
		for (let page = mark.page; page <= end; page++) {
			const cost = tokensOfPage(page);
			if (spent && spent + cost > SKELETON_BOUNDS.sectionTokens) { out.push({ name: mark.name, first, last: page - 1 }); first = page; spent = 0; }
			spent += cost;
		}
		if (first <= end) out.push({ name: mark.name, first, last: end });
	});
	return out;
}

/** One section's answer, keeping only block ids the section was given. */
export function sectionAnswer(answer: unknown, ids: Set<string>): Row {
	const keep = (blocks: unknown) => Array.isArray(blocks) ? blocks.filter((id): id is string => typeof id === "string" && ids.has(id)) : [];
	const names = (value: unknown) => Array.isArray(value) ? value.filter((name): name is string => typeof name === "string" && !!name.trim()).map(name => name.trim()).slice(0, 12) : [];
	const row = (answer ?? {}) as Row;
	return {
		...(typeof row.language === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(row.language.trim()) ? { language: row.language.trim() } : {}),
		mentions: (Array.isArray(row.mentions) ? row.mentions : []).flatMap((mention: Row) => typeof mention?.name === "string" && mention.name.trim()
			? [{ name: mention.name.trim(), aliases: names(mention.aliases), kind: typeof mention.kind === "string" ? mention.kind : "other", blocks: keep(mention.blocks),
				...(typeof mention.english === "string" && mention.english.trim() ? { english: mention.english.trim().slice(0, 200) } : {}) }] : []),
		...Object.fromEntries(LISTS.map(list => [list, (Array.isArray(row[list]) ? row[list] : []).flatMap((entry: Row) => {
			const blocks = keep(entry?.blocks), text = String(entry?.hint ?? entry?.summary ?? "").trim().slice(0, 300);
			return blocks.length && names(entry?.names).length ? [{ names: names(entry.names), summary: text, blocks }] : [];
		})])) };
}

/**
 * §262.5: a section's mentions also cite the section's blocks that print one of their names (normalised spelling, no
 * judgement of meaning), so a name whose block ids the reader miswrote still points at the pages that print it.
 */
export function groundMentions(answer: Row, blocks: Array<{ id: string; text: string }>, limit = 12): Row {
	const keyed = blocks.map(block => ({ id: block.id, key: normalName(block.text) }));
	for (const mention of answer.mentions ?? []) {
		const names = [mention.name, ...(mention.aliases ?? [])].map(normalName).filter((name: string) => [...name].length >= 2);
		const printed = keyed.filter(block => names.some((name: string) => block.key.includes(name))).map(block => block.id);
		mention.blocks = [...new Set([...mention.blocks, ...printed])].slice(0, limit);
	}
	return answer;
}

/**
 * §262.5: merge the sections' answers. Names are matched by normalised spelling and aliases; every row keeps its blocks
 * and pages; a cross reference whose names match no mention keeps `resolved: false`.
 */
export function mergeSkeleton(sections: Array<{ section: SkeletonSection; status: "indexed" | "failed"; answer?: Row; usage?: Row }>, pageOf: (id: string) => number,
	imageOnly: number[], blockText: (id: string) => string | undefined = () => undefined): Row {
	const entities: Row[] = [], byName = new Map<string, Row>();
	for (const { answer } of sections) for (const mention of answer?.mentions ?? []) {
		const keys = [mention.name, ...mention.aliases].map(normalName).filter(Boolean);
		let entity = keys.map(key => byName.get(key)).find(Boolean);
		if (!entity) { entity = { name: mention.name, aliases: [], kinds: [], blocks: [], english: [] }; entities.push(entity); }
		if (mention.english && !entity.english.includes(mention.english)) entity.english.push(mention.english);
		for (const name of [mention.name, ...mention.aliases]) if (name !== entity.name && !entity.aliases.includes(name)) entity.aliases.push(name);
		if (!entity.kinds.includes(mention.kind)) entity.kinds.push(mention.kind);
		for (const id of mention.blocks) if (!entity.blocks.includes(id)) entity.blocks.push(id);
		for (const key of keys) byName.set(key, entity);
	}
	for (const entity of entities) entity.pages = [...new Set<number>(entity.blocks.map(pageOf))].sort((a, b) => a - b);
	const rows = Object.fromEntries(LISTS.map(list => [list, sections.flatMap(({ answer }) => (answer?.[list] ?? []).map((entry: Row) => ({
		...entry, pages: [...new Set<number>(entry.blocks.map(pageOf))].sort((a, b) => a - b),
		text: entry.blocks.map(blockText).filter(Boolean).join("\n").slice(0, 900),
		resolved: entry.names.some((name: string) => byName.has(normalName(name))) })))]));
	// The book's language: the tag most sections answered (a shape-checked tag the readers wrote, not a detection).
	const tags = new Map<string, number>();
	for (const { answer } of sections) if (answer?.language) tags.set(answer.language, (tags.get(answer.language) ?? 0) + 1);
	const language = [...tags].sort((a, b) => b[1] - a[1])[0]?.[0];
	return { version: SKELETON_VERSION, ...(language ? { language } : {}), entities, ...rows, image_only: imageOnly,
		sections: sections.map(({ section, status, usage }) => ({ ...section, status, ...(usage ? { usage } : {}) })) };
}

/**
 * §262.3: the skeleton rows a lean reading of these pages receives: rows citing other pages that name an entity whose own
 * blocks are on these pages, with their blocks' text.
 */
export function crossReferencesFor(skeleton: Row, pages: number[]): Row[] {
	const here = new Set(pages), names = new Set<string>();
	for (const entity of skeleton?.entities ?? []) if ((entity.pages ?? []).some((page: number) => here.has(page)))
		for (const name of [entity.name, ...(entity.aliases ?? [])]) names.add(normalName(name));
	if (!names.size) return [];
	const out: Row[] = [];
	for (const list of LISTS) for (const row of skeleton?.[list] ?? []) {
		if ((row.pages ?? []).every((page: number) => here.has(page))) continue;
		if (!(row.names ?? []).some((name: string) => names.has(normalName(name)))) continue;
		out.push({ kind: list, names: row.names, summary: row.summary, pages: row.pages, ...(row.text ? { text: row.text } : {}) });
	}
	// Keeper truth and conditions first: they are what a scene-local reading cannot see.
	const rank = (row: Row) => row.kind === "keeper_truth" ? 0 : row.kind === "conditional_events" ? 1 : 2;
	return out.sort((a, b) => rank(a) - rank(b));
}

/** §262.5: where a document's skeleton lives: the owner's home, by the document's hash, shared by the library and its forks. */
export const skeletonPath = (home: string, sha: string): string => join(home, "source-skeletons", `${sha}.json`);

/** §262.3: the cross references of a claimed lean job, from its document's skeleton. */
export async function leanCrossReferences(job: Row, home: string): Promise<Row[]> {
	const skeleton = JSON.parse(await readFile(skeletonPath(home, job.source.file_sha256), "utf8"));
	return crossReferencesFor(skeleton, Array.isArray(job.pages) ? job.pages : []);
}

export interface SkeletonContext {
	runtime: Pick<HostRuntime, "runTask" | "sourceBlocks" | "sourceInfo" | "contentRoot">;
	moduleId: string;
	/** The owner's home (`skeletonPath`) and the bound document's page cache directory. */
	home: string;
	cache: string;
	source: { path: string; file_sha256: string; page_count: number };
	model: { id: string; thinking?: string };
	signal: AbortSignal;
	record: (row: Row) => void;
	shared?: Partial<ReaderRequest>;
	/** Whether another section may start (the reading cap, a stopped host). */
	mayContinue?: () => boolean;
}

/** §262.5: build the skeleton once; an existing complete skeleton for this document is kept. */
export async function buildSkeleton(context: SkeletonContext): Promise<Row> {
	const { runtime, source, signal, cache } = context;
	const file = skeletonPath(context.home, source.file_sha256);
	await mkdir(join(context.home, "source-skeletons"), { recursive: true });
	try {
		const existing = JSON.parse(await readFile(file, "utf8"));
		if (existing.version === SKELETON_VERSION && existing.source_sha256 === source.file_sha256 && (existing.sections ?? []).every((row: Row) => row.status === "indexed")) return existing;
	} catch { /* none yet */ }
	const pages = Array.from({ length: source.page_count }, (_, i) => i + 1);
	const blocks = await sourceBlocksFor(runtime, { path: source.path, file_sha256: source.file_sha256 }, pages, cache, signal);
	const info = await runtime.sourceInfo({ pdf: source.path, cache: join(cache, "pages") }, signal);
	const sections = skeletonSections(source.page_count, info.bookmarks, page => (blocks.get(page)?.blocks ?? []).reduce((sum, block) => sum + roughTokens(block.text), 0));
	const pageOfBlock = new Map<string, number>(), textOfBlock = new Map<string, string>();
	for (const [page, row] of blocks) for (const block of row.blocks) { pageOfBlock.set(block.id, page); textOfBlock.set(block.id, block.text); }
	const results: Array<{ section: SkeletonSection; status: "indexed" | "failed"; answer?: Row; usage?: Row }> = [];
	const systemPrompt = await readFile(join(runtime.contentRoot, "setup", "lean-skeleton.md"), "utf8");
	const promptSha = createHash("sha256").update(systemPrompt).digest("hex").slice(0, 16);
	for (const [index, section] of sections.entries()) {
		if (signal.aborted || context.mayContinue?.() === false) { results.push({ section, status: "failed" }); continue; }
		const sectionBlocks = pages.filter(page => page >= section.first && page <= section.last)
			.flatMap(page => blocks.get(page)?.blocks ?? []).map(block => ({ id: block.id, page: block.page, text: block.text, ...(block.continues ? { continues: block.continues } : {}) }));
		if (!sectionBlocks.length) { results.push({ section, status: "indexed", answer: { mentions: [], cross_references: [], conditional_events: [], keeper_truth: [] } }); continue; }
		const dir = join(context.home, "source-skeletons", `${source.file_sha256}-work`, `section-${index + 1}`);
		await mkdir(dir, { recursive: true });
		// The instructions' digest is part of the task, so a changed prompt reads the section again.
		const task = { section, prompt: promptSha, blocks: sectionBlocks }, taskText = JSON.stringify(task) + "\n";
		// A section answered for this exact task by an earlier host is kept.
		try {
			if (await readFile(join(dir, "task.json"), "utf8") === taskText) {
				const kept = groundMentions(sectionAnswer(JSON.parse(await readFile(join(dir, "skeleton.json"), "utf8")), new Set(sectionBlocks.map(block => block.id))), sectionBlocks);
				results.push({ section, status: "indexed", answer: kept });
				continue;
			}
		} catch { /* not answered yet */ }
		await writeFile(join(dir, "task.json"), taskText);
		const run = await runtime.runTask({ kind: "reader", request: { ...context.shared, cwd: dir, model: context.model.id, thinking: context.model.thinking,
			systemPrompt, tools: "read,write",
			maxRequests: SKELETON_BOUNDS.requests, eventLog: join(dir, "events.jsonl"),
			brief: `${readerInput({ task })} Write skeleton.json as instructed.` } as ReaderRequest }, signal);
		context.record({ lane: "reading", phase: "skeleton", module_id: context.moduleId, section: section.name, first: section.first, last: section.last,
			ms: run.ms, ok: run.ok, ...(run.usage ? { usage: run.usage } : {}) });
		try {
			const answer = groundMentions(sectionAnswer(JSON.parse(await readFile(join(dir, "skeleton.json"), "utf8")), new Set(sectionBlocks.map(block => block.id))), sectionBlocks);
			results.push({ section, status: "indexed", answer, ...(run.usage ? { usage: run.usage } : {}) });
		} catch { results.push({ section, status: "failed", ...(run.usage ? { usage: run.usage } : {}) }); }
	}
	const merged: Row = { ...mergeSkeleton(results, id => pageOfBlock.get(id) ?? 0, [...blocks].filter(([, row]) => row.image_only).map(([page]) => page), id => textOfBlock.get(id)),
		source_sha256: source.file_sha256 };
	const temp = `${file}.${process.pid}.tmp`;
	await writeFile(temp, JSON.stringify(merged));
	await rename(temp, file);
	context.record({ lane: "reading", event: "skeleton_built", module_id: context.moduleId, sections: sections.length,
		failed: results.filter(row => row.status === "failed").length, entities: merged.entities.length });
	return merged;
}

/** §262.6: the request bound of a source answer's reader under lean reading. */
export const LEAN_ANSWER_REQUESTS = 10;
/** §262.6: what a lean source answer is told about the skeleton digest and when to stop. */
export const LEAN_ANSWER_ASK = "task.skeleton_digest maps where the book discusses people, places and events (navigation only, not evidence). Open the pages it lists for what you are asked first. When those pages and at most two searches do not show it, answer that the book does not say it; do not keep searching page after page.";

/**
 * §262.6: the skeleton as a source answer's map of the book: every Keeper-truth, condition and cross-reference line
 * with its names and pages (no book text), Keeper truth first, under about 5K tokens.
 */
export async function skeletonDigest(home: string, sha: string): Promise<Row | undefined> {
	const skeleton = JSON.parse(await readFile(skeletonPath(home, sha), "utf8"));
	const rows: Row[] = [];
	let spent = 0;
	for (const list of ["keeper_truth", "conditional_events", "cross_references"] as const) for (const row of skeleton[list] ?? []) {
		const line = { kind: list, names: row.names, summary: row.summary, pages: row.pages };
		const cost = Math.ceil(Buffer.byteLength(JSON.stringify(line)) / 3);
		if (spent + cost > 5000) break;
		spent += cost; rows.push(line);
	}
	const people = (skeleton.entities ?? []).slice(0, 200).map((entity: Row) => ({ name: entity.name, pages: entity.pages }));
	return rows.length || people.length ? { note: "Where the book discusses these people and events (navigation only, not evidence): open the listed pages first, search only for what it does not place.", rows, entities: people } : undefined;
}

/** §262.7: the skeleton's entities as navigation index rows: name, aliases and their pages as 0-based ranges. */
export function skeletonIndexRows(skeleton: Row): Row[] {
	// §262.10: each image-only page is a row of its own, so an arrival can find the map pages beside its scene.
	const images = (skeleton?.image_only ?? []).filter((page: unknown) => Number.isSafeInteger(page) && Number(page) >= 1)
		.map((page: number) => ({ name: `Image-only page ${page}`, entities: [], pages: [[page - 1, page - 1]], image_only: true }));
	return [...entityIndexRows(skeleton), ...images];
}
function entityIndexRows(skeleton: Row): Row[] {
	return (skeleton?.entities ?? []).flatMap((entity: Row) => {
		// The pages carrying most of the entity's blocks come first: a page that only names it in passing weighs one block.
		const weight = new Map<number, number>();
		for (const id of entity.blocks ?? []) { const page = Number(/^b(\d+)-/.exec(String(id))?.[1]); if (Number.isSafeInteger(page) && page >= 1) weight.set(page, (weight.get(page) ?? 0) + 1); }
		// A page carrying at least half as many of its blocks as its fullest page; a passing mention elsewhere is left out.
		const heaviest = Math.max(0, ...weight.values()), floor = Math.max(1, Math.ceil(heaviest / 2));
		const ranked = (entity.pages ?? []).filter((page: unknown) => Number.isSafeInteger(page) && Number(page) >= 1 && (weight.get(Number(page)) ?? 0) >= floor)
			.sort((a: number, b: number) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0) || a - b).slice(0, 3);
		const pages: number[] = [...new Set<number>(ranked)].sort((a, b) => a - b);
		const ranges: number[][] = [];
		for (const page of pages) { const last = ranges.at(-1); if (last && page - 1 === last[1] + 1) last[1] = page - 1; else ranges.push([page - 1, page - 1]); }
		return ranges.length && typeof entity.name === "string" ? [{ name: entity.name, entities: entity.aliases ?? [], pages: ranges.slice(0, 6) }] : [];
	});
}

/** §262.8: whether two BCP-47 tags share their primary language subtag (a comparison of tag shapes, not a detection). */
export const samePrimaryLanguage = (left: unknown, right: unknown): boolean => typeof left === "string" && typeof right === "string"
	&& !!left && left.split("-")[0]!.toLowerCase() === right.split("-")[0]!.toLowerCase();

/**
 * §262.8: a cast range's draft from the skeleton: every person or creature entity with pages in the range, its printed forms
 * that a cited page's text prints (normalised spelling), the same forms as the play language (only when the book is in the
 * play language), and its English forms as notes. The kernel's own check (`cast.submit`) still judges every row.
 */
export function castDraftFromSkeleton(skeleton: Row, range: { first: number; last: number }, pageText: (page: number) => string): Row {
	const people: Row[] = [];
	for (const entity of skeleton?.entities ?? []) {
		if (!(entity.kinds ?? []).some((kind: string) => kind === "npc" || kind === "creature")) continue;
		const pages: number[] = (entity.pages ?? []).filter((page: number) => page >= range.first && page <= range.last);
		if (!pages.length) continue;
		const texts = pages.map(page => normalName(pageText(page)));
		const book = [entity.name, ...(entity.aliases ?? [])].filter((name: string) => { const key = normalName(name); return [...key].length >= 2 && texts.some(text => text.includes(key)); });
		if (!book.length) continue;
		const cited = pages.filter((page, i) => book.some((name: string) => texts[i]!.includes(normalName(name))));
		const notes = (entity.english ?? []).filter((name: string) => [...normalName(name)].length >= 2);
		people.push({ book: [...new Set(book)].slice(0, 6), play: [...new Set(book)].slice(0, 6), notes: notes.length ? notes.slice(0, 4) : [...new Set(book)].slice(0, 2), pages: cited });
	}
	return { people: people.slice(0, 200) };
}

/**
 * §262.9: the pages a lean source answer slices for the Keeper: every skeleton entity whose name or alias the focus or the
 * question prints (normalised spelling) gives its index pages, then the skeleton rows that name one of them give theirs.
 * Name matching only; what the Keeper asked is never classified.
 */
export function answerPages(skeleton: Row, asked: string, limit = 4): number[] {
	const key = normalName(asked), out: number[] = [];
	const add = (page: unknown) => { if (Number.isSafeInteger(page) && Number(page) >= 1 && !out.includes(Number(page)) && out.length < limit) out.push(Number(page)); };
	const named = (skeleton?.entities ?? []).filter((entity: Row) => [entity.name, ...(entity.aliases ?? [])]
		.some((name: unknown) => typeof name === "string" && [...normalName(name)].length >= 2 && key.includes(normalName(name))));
	for (const row of skeletonIndexRows({ entities: named })) for (const [first, last] of row.pages) for (let page = first; page <= last; page++) add(page + 1);
	const names = new Set(named.flatMap((entity: Row) => [entity.name, ...(entity.aliases ?? [])].map((name: string) => normalName(name))));
	for (const list of LISTS) for (const row of skeleton?.[list] ?? [])
		if ((row.names ?? []).some((name: string) => names.has(normalName(name)))) for (const page of row.pages ?? []) add(page);
	return out;
}
