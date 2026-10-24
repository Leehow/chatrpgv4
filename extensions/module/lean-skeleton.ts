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
import { roughTokens, SOURCE_LAYOUT_VERSION, type SourceBlocksPage } from "./source-blocks.ts";
import { blockPage, refFromQuote, refKey, type SourceRef } from "./source-refs.ts";

type Row = Record<string, any>;
export const SKELETON_BOUNDS = { sectionTokens: 6000, requests: 1, concurrency: 4 } as const;
/** The merged skeleton's shape; a kept skeleton of another version is merged again from its kept section answers. */
export const SKELETON_VERSION = 4;
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
				evidence: (Array.isArray(mention.evidence) ? mention.evidence : []).flatMap((item: Row) => typeof item?.block === "string" && ids.has(item.block)
					? [{ block: item.block, use: EVIDENCE_USES.includes(item.use) ? item.use : "mention" }] : []),
				...(typeof mention.english === "string" && mention.english.trim() ? { english: mention.english.trim().slice(0, 200) } : {}) }] : []),
		...Object.fromEntries(LISTS.map(list => [list, (Array.isArray(row[list]) ? row[list] : []).flatMap((entry: Row) => {
			const blocks = keep(entry?.blocks), text = String(entry?.hint ?? entry?.summary ?? "").trim().slice(0, 300);
			return blocks.length && names(entry?.names).length ? [{ names: names(entry.names), summary: text, blocks }] : [];
		})])),
		...pointerLists(row, ids, names) };
}

/** §263.3: the closed words of the pointer index. */
export const EVIDENCE_USES = ["appearance", "description", "motivation", "plan", "condition", "clue", "handout", "read_aloud", "mention"] as const;
export const RELEASE_KINDS = ["read_aloud", "handout", "appearance", "description"] as const;
export const PROTECTED_RISKS = ["identity", "plan", "hidden_cause", "ending", "other"] as const;

/** §263.3: a section answer's protected facts, release candidates and continuations, keeping only this section's blocks. */
function pointerLists(row: Row, ids: Set<string>, names: (value: unknown) => string[]): Row {
	const line = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";
	const protectedFacts = (Array.isArray(row.protected_facts) ? row.protected_facts : []).flatMap((fact: Row) => {
		const blocks = Array.isArray(fact?.blocks) ? fact.blocks.filter((id: unknown): id is string => typeof id === "string" && ids.has(id)) : [];
		const summary = line(fact?.summary, 300);
		if (!blocks.length || !summary) return [];
		const risk = PROTECTED_RISKS.includes(fact.risk) ? fact.risk : "other", reveal = line(fact?.reveal, 200);
		return [{ names: names(fact.names), risk, summary, blocks, ...(reveal ? { reveal } : {}) }];
	});
	const releaseCandidates = (Array.isArray(row.release_candidates) ? row.release_candidates : []).flatMap((candidate: Row) =>
		typeof candidate?.block === "string" && ids.has(candidate.block) && RELEASE_KINDS.includes(candidate.kind) && line(candidate.name, 120)
			? [{ name: line(candidate.name, 120), kind: candidate.kind, block: candidate.block, ...(line(candidate.quote, 4000) ? { quote: line(candidate.quote, 4000) } : {}) }] : []);
	const continuations = (Array.isArray(row.continuations) ? row.continuations : []).flatMap((pair: unknown) =>
		Array.isArray(pair) && pair.length === 2 && pair.every(id => typeof id === "string" && ids.has(id)) && pair[0] !== pair[1] ? [[pair[0], pair[1]]] : []);
	return { protected_facts: protectedFacts, release_candidates: releaseCandidates, continuations };
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
export function mergeSkeleton(sections: Array<{ section: SkeletonSection; status: "indexed" | "failed"; answer?: Row; usage?: Row; blocked_pages?: number[] }>, pageOf: (id: string) => number,
	imageOnly: number[], blockText: (id: string) => string | undefined = () => undefined, doc = ""): Row {
	const entities: Row[] = [], byName = new Map<string, Row>();
	for (const { answer } of sections) for (const mention of answer?.mentions ?? []) {
		const keys = [mention.name, ...mention.aliases].map(normalName).filter(Boolean);
		let entity = keys.map(key => byName.get(key)).find(Boolean);
		if (!entity) { entity = { name: mention.name, aliases: [], kinds: [], blocks: [], english: [], evidence: [] }; entities.push(entity); }
		for (const item of mention.evidence ?? []) if (!entity.evidence.some((row: Row) => row.block === item.block)) entity.evidence.push(item);
		if (mention.english && !entity.english.includes(mention.english)) entity.english.push(mention.english);
		for (const name of [mention.name, ...mention.aliases]) if (name !== entity.name && !entity.aliases.includes(name)) entity.aliases.push(name);
		if (!entity.kinds.includes(mention.kind)) entity.kinds.push(mention.kind);
		for (const id of mention.blocks) if (!entity.blocks.includes(id)) entity.blocks.push(id);
		for (const key of keys) byName.set(key, entity);
	}
	// §263.2: a block that carries on another block's text belongs to the entities the first block belongs to.
	for (const { answer } of sections) for (const [from, to] of answer?.continuations ?? []) for (const entity of entities) {
		if (!entity.blocks.includes(from) || entity.blocks.includes(to)) continue;
		entity.blocks.push(to);
		const use = entity.evidence.find((row: Row) => row.block === from)?.use ?? "mention";
		entity.evidence.push({ block: to, use, continued_from: from });
	}
	for (const entity of entities) entity.pages = [...new Set<number>(entity.blocks.map(pageOf))].sort((a, b) => a - b);
	const pointers = mergePointers(sections, entities, byName, pageOf, blockText, doc);
	const rows = Object.fromEntries(LISTS.map(list => [list, sections.flatMap(({ answer }) => (answer?.[list] ?? []).map((entry: Row) => ({
		...entry, pages: [...new Set<number>(entry.blocks.map(pageOf))].sort((a, b) => a - b),
		text: entry.blocks.map(blockText).filter(Boolean).join("\n").slice(0, 900),
		resolved: entry.names.some((name: string) => byName.has(normalName(name))) })))]));
	// The book's language: the tag most sections answered (a shape-checked tag the readers wrote, not a detection).
	const tags = new Map<string, number>();
	for (const { answer } of sections) if (answer?.language) tags.set(answer.language, (tags.get(answer.language) ?? 0) + 1);
	const language = [...tags].sort((a, b) => b[1] - a[1])[0]?.[0];
	return { version: SKELETON_VERSION, ...(language ? { language } : {}), entities, ...rows, ...pointers, image_only: imageOnly,
		complete: sections.length > 0 && sections.every(row => row.status === "indexed"),
		// §263.3: pages no call would read (a provider refusal page by page); their names decide which releases wait (§263.4).
		blocked_pages: [...new Set(sections.flatMap(row => (row as Row).blocked_pages ?? []))].sort((a, b) => a - b),
		sections: sections.map(({ section, status, usage, answer, blocked_pages }) => ({ ...section, status, ...(usage ? { usage } : {}), ...(blocked_pages?.length ? { blocked_pages } : {}),
			...(status === "indexed" ? { coverage: { cited: new Set([...(answer?.mentions ?? []).flatMap((m: Row) => m.blocks), ...(answer?.protected_facts ?? []).flatMap((f: Row) => f.blocks)]).size } } : {}) })) };
}

/** §263.3: protected facts with stable ids and pages; release candidates as refs the host can slice. */
function mergePointers(sections: Array<{ answer?: Row }>, entities: Row[], byName: Map<string, Row>, pageOf: (id: string) => number,
	blockText: (id: string) => string | undefined, doc: string): Row {
	const facts = new Map<string, Row>();
	for (const { answer } of sections) for (const fact of answer?.protected_facts ?? []) {
		const id = `pf-${createHash("sha256").update(JSON.stringify([fact.summary, fact.blocks])).digest("hex").slice(0, 12)}`;
		if (!facts.has(id)) facts.set(id, { id, ...fact, pages: [...new Set<number>(fact.blocks.map(pageOf))].sort((a, b) => a - b) });
	}
	const candidates = new Map<string, Row>();
	for (const { answer } of sections) for (const candidate of answer?.release_candidates ?? []) {
		const text = blockText(candidate.block);
		if (text === undefined) continue;
		const ref: SourceRef | undefined = refFromQuote(doc, SOURCE_LAYOUT_VERSION, { id: candidate.block, text }, candidate.quote);
		if (!ref) continue;
		const entity = byName.get(normalName(candidate.name))?.name ?? candidate.name;
		const key = refKey(ref);
		if (!candidates.has(key)) candidates.set(key, { key, ref, entity, kind: candidate.kind, page: blockPage(candidate.block), ...(candidate.quote ? { quoted: true } : {}) });
	}
	void entities;
	return { protected_facts: [...facts.values()], release_candidates: [...candidates.values()] };
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
	// §263.7: protected facts naming an entity of these pages travel with the Keeper truth they are.
	for (const fact of skeleton?.protected_facts ?? []) {
		if ((fact.pages ?? []).every((page: number) => here.has(page))) continue;
		if (!(fact.names ?? []).some((name: string) => names.has(normalName(name)))) continue;
		out.push({ kind: "keeper_truth", names: fact.names, summary: fact.summary, pages: fact.pages, protected: true });
	}
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
	const results: Array<{ section: SkeletonSection; status: "indexed" | "failed"; answer?: Row; usage?: Row; blocked_pages?: number[] }> = new Array(sections.length);
	const systemPrompt = await readFile(join(runtime.contentRoot, "setup", "lean-skeleton.md"), "utf8");
	const promptSha = createHash("sha256").update(systemPrompt).digest("hex").slice(0, 16);
	const one = async (index: number, section: SkeletonSection) => {
		if (signal.aborted || context.mayContinue?.() === false) { results[index] = { section, status: "failed" }; return; }
		const sectionBlocks = pages.filter(page => page >= section.first && page <= section.last)
			.flatMap(page => blocks.get(page)?.blocks ?? []).map(block => ({ id: block.id, page: block.page, text: block.text, ...(block.continues ? { continues: block.continues } : {}) }));
		if (!sectionBlocks.length) { results[index] = { section, status: "indexed", answer: { mentions: [], cross_references: [], conditional_events: [], keeper_truth: [], protected_facts: [], release_candidates: [], continuations: [] } }; return; }
		const dir = join(context.home, "source-skeletons", `${source.file_sha256}-work`, `section-${index + 1}`);
		await mkdir(dir, { recursive: true });
		const ids = new Set(sectionBlocks.map(block => block.id));
		// The instructions' digest is part of the task, so a changed prompt reads the section again.
		const task = { section, prompt: promptSha, blocks: sectionBlocks }, taskText = JSON.stringify(task) + "\n";
		// A section answered for this exact task by an earlier host is kept.
		try {
			if (await readFile(join(dir, "task.json"), "utf8") === taskText) {
				results[index] = { section, status: "indexed", answer: groundMentions(sectionAnswer(JSON.parse(await readFile(join(dir, "skeleton.json"), "utf8")), ids), sectionBlocks) };
				return;
			}
		} catch { /* not answered yet */ }
		await writeFile(join(dir, "task.json"), taskText);
		// §263.3: one call; the answer is pointers, closed words and short lines (Agents.md single-call criterion).
		// Short local ids in the call (k1, k2, ...): the answer repeats ids many times, so their length is most of its cost.
		const short = new Map(sectionBlocks.map((block, i) => [block.id, `k${i + 1}`])), long = new Map([...short].map(([id, key]) => [key, id]));
		const shown = (list: Row[]) => list.map(block => ({ ...block, id: short.get(block.id), ...(block.continues ? { continues: short.get(block.continues) ?? block.continues } : {}) }));
		const call = await singleCall(runtime, { cwd: dir, model: context.model, systemPrompt, signal, shared: context.shared,
			brief: `Section: ${JSON.stringify(section)}\nBlocks:\n${JSON.stringify(shown(sectionBlocks))}\n\nAnswer with the JSON object now.` });
		if (call.json) call.json = longIds(call.json, long);
		context.record({ lane: "reading", phase: "skeleton", module_id: context.moduleId, section: section.name, first: section.first, last: section.last,
			ms: call.outcome.ms, ok: call.outcome.ok, ...(call.outcome.usage ? { usage: call.outcome.usage } : {}), ...(call.outcome.refusal ? { refusal: call.outcome.refusal } : {}) });
		let parsed = call.json;
		let usage = call.outcome.usage;
		// §263.3: an answer that did not fit one reply is asked once more as two halves of the section's blocks.
		if (!parsed && sectionBlocks.length > 1) {
			const halves = [sectionBlocks.slice(0, Math.ceil(sectionBlocks.length / 2)), sectionBlocks.slice(Math.ceil(sectionBlocks.length / 2))];
			const parts: Row[] = [];
			for (const [i, half] of halves.entries()) {
				const sub = join(dir, `half-${i + 1}`);
				await mkdir(sub, { recursive: true });
				const again = await singleCall(runtime, { cwd: sub, model: context.model, systemPrompt, signal, shared: context.shared,
					brief: `Section: ${JSON.stringify(section)}\nBlocks:\n${JSON.stringify(shown(half))}\n\nAnswer with the JSON object now.` });
				if (again.json) again.json = longIds(again.json, long);
				context.record({ lane: "reading", phase: "skeleton", module_id: context.moduleId, section: section.name, half: i + 1, ms: again.outcome.ms, ok: again.outcome.ok,
					...(again.outcome.usage ? { usage: again.outcome.usage } : {}) });
				if (again.json) parts.push(again.json);
			}
			if (parts.length === 2) parsed = Object.fromEntries(["mentions", "cross_references", "conditional_events", "keeper_truth", "protected_facts", "release_candidates", "continuations"]
				.map(key => [key, parts.flatMap(part => Array.isArray(part[key]) ? part[key] : [])]).concat([["language", parts[0]!.language]]));
			usage = undefined;
		}
		// §263.3: still nothing: page by page, so a provider refusal of one page (a content filter) blocks only that page.
		let blockedPages: number[] | undefined;
		if (!parsed && section.last > section.first) {
			const parts: Row[] = [];
			blockedPages = [];
			for (let page = section.first; page <= section.last; page++) {
				const own = sectionBlocks.filter(block => block.page === page);
				if (!own.length) continue;
				const sub = join(dir, `page-${page}`);
				await mkdir(sub, { recursive: true });
				const again = await singleCall(runtime, { cwd: sub, model: context.model, systemPrompt, signal, shared: context.shared,
					brief: `Section: ${JSON.stringify(section)}\nBlocks:\n${JSON.stringify(shown(own))}\n\nAnswer with the JSON object now.` });
				context.record({ lane: "reading", phase: "skeleton", module_id: context.moduleId, section: section.name, page, ms: again.outcome.ms, ok: again.outcome.ok,
					...(again.outcome.usage ? { usage: again.outcome.usage } : {}) });
				if (again.json) parts.push(longIds(again.json, long)); else blockedPages.push(page);
			}
			if (parts.length) parsed = Object.fromEntries(["mentions", "cross_references", "conditional_events", "keeper_truth", "protected_facts", "release_candidates", "continuations"]
				.map(key => [key, parts.flatMap(part => Array.isArray(part[key]) ? part[key] : [])]).concat([["language", parts[0]!.language]]));
		}
		if (!parsed) { results[index] = { section, status: "failed", ...(usage ? { usage } : {}) }; return; }
		await writeFile(join(dir, "skeleton.json"), JSON.stringify(parsed));
		results[index] = { section, status: "indexed", answer: groundMentions(sectionAnswer(parsed, ids), sectionBlocks), ...(usage ? { usage } : {}),
			...(blockedPages?.length ? { blocked_pages: blockedPages } : {}) };
	};
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(SKELETON_BOUNDS.concurrency, sections.length) }, async () => {
		while (next < sections.length) { const index = next++; await one(index, sections[index]!); }
	}));
	const merged: Row = { ...mergeSkeleton(results, id => pageOfBlock.get(id) ?? 0, [...blocks].filter(([, row]) => row.image_only).map(([page]) => page), id => textOfBlock.get(id), source.file_sha256),
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
/** §262.10: the request bound of an arrival's map reading under lean reading (its vision review is unchanged). */
export const LEAN_MAP_REQUESTS = 14;
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
export function castDraftFromSkeleton(skeleton: Row, range: { first: number; last: number }, pageText: (page: number) => string, playOf?: (name: string) => string[] | undefined): Row {
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
		const play = playOf ? [...new Set(book.flatMap((name: string) => playOf(name) ?? []))] : [...new Set(book)];
		if (!play.length) continue;
		people.push({ book: [...new Set(book)].slice(0, 6), play: play.slice(0, 6), notes: notes.length ? notes.slice(0, 4) : [...new Set(book)].slice(0, 2), pages: cited });
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

/** The first JSON object in a model's reply text. */
export function replyJson(text: string): Row | undefined {
	const start = text.indexOf("{"), end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	try { const value = JSON.parse(text.slice(start, end + 1)); return value && typeof value === "object" && !Array.isArray(value) ? value : undefined; }
	catch { return undefined; }
}

/**
 * §263: one tool-free provider call through the host's task runner (the handout reading's shape): the whole input in the
 * brief, the reply text captured from the child's final assistant message.
 */
export async function singleCall(runtime: Pick<HostRuntime, "runTask">, options: { cwd: string; model: { id: string; thinking?: string }; systemPrompt: string;
	brief: string; signal: AbortSignal; shared?: Partial<ReaderRequest>; timeoutMs?: number }): Promise<{ outcome: import("./reader.ts").ReaderOutcome; text: string; json?: Row }> {
	let text = "";
	const textOf = (message: Row) => (Array.isArray(message?.content) ? message.content : []).filter((part: Row) => part?.type === "text").map((part: Row) => String(part.text ?? "")).join("");
	// §263.13: a pointer call writes ids and short lines; its reasoning level is its own (`PI_COC_POINTER_THINKING`, default low).
	const thinking = process.env.PI_COC_POINTER_THINKING || "low";
	const outcome = await runtime.runTask({ kind: "reader", request: { ...options.shared, cwd: options.cwd, model: options.model.id, thinking,
		systemPrompt: options.systemPrompt, tools: "", maxRequests: 1, timeoutMs: options.timeoutMs ?? 300000, eventLog: join(options.cwd, "events.jsonl"), brief: options.brief,
		onEvent: (event: Row) => { if (event.type === "message_end" && event.message?.role === "assistant") { const value = textOf(event.message); if (value) text = value; } } } as ReaderRequest }, options.signal);
	await writeFile(join(options.cwd, "reply.txt"), text).catch(() => undefined);
	const json = replyJson(text);
	return { outcome, text, ...(json ? { json } : {}) };
}

/** §263: what the cast name call is told; its answer is names only. */
const CAST_NAMES_PROMPT = "You give the names of people in a tabletop roleplaying scenario as a table playing in another language would write them. Answer with one JSON object and nothing else: {\"names\":[{\"book\":\"the name exactly as given\",\"play\":[\"how the play language writes it\"]}]}. Transliterate personal names the way that language conventionally writes foreign names; translate a descriptive epithet. One entry per given name, no others.";

/**
 * §262.8 amended by §263: a book in another language than the table's gets its people's play-language forms from one
 * tool-free call over the names alone (no page text), instead of the cast reader.
 */
export async function castPlayNames(runtime: Pick<HostRuntime, "runTask">, names: string[], playLanguage: string, options: { cwd: string; model: { id: string; thinking?: string }; signal: AbortSignal; shared?: Partial<ReaderRequest> }): Promise<{ map: Map<string, string[]>; usage?: Row }> {
	await mkdir(options.cwd, { recursive: true });
	const call = await singleCall(runtime, { ...options, systemPrompt: CAST_NAMES_PROMPT, brief: `Play language: ${playLanguage}\nNames:\n${JSON.stringify(names)}\n\nAnswer with the JSON object now.`, timeoutMs: 180000 });
	const map = new Map<string, string[]>();
	for (const row of Array.isArray(call.json?.names) ? call.json!.names : []) {
		if (typeof row?.book !== "string" || !names.includes(row.book)) continue;
		const play = (Array.isArray(row.play) ? row.play : []).filter((name: unknown): name is string => typeof name === "string" && !!name.trim()).map((name: string) => name.trim().slice(0, 80)).slice(0, 4);
		if (play.length) map.set(row.book, play);
	}
	return { map, ...(call.outcome.usage ? { usage: call.outcome.usage } : {}) };
}

/** §263.3: a section answer's local block ids (`k<n>`) back to the book's block ids; other strings are left as written. */
export function longIds(answer: Row, long: Map<string, string>): Row {
	const map = (value: unknown): unknown => typeof value === "string" ? long.get(value) ?? value : Array.isArray(value) ? value.map(map) : value;
	const out: Row = { ...answer };
	for (const key of ["mentions", "cross_references", "conditional_events", "keeper_truth", "protected_facts", "release_candidates"]) if (Array.isArray(out[key]))
		out[key] = out[key].map((row: Row) => !row || typeof row !== "object" ? row : { ...row, ...(row.blocks ? { blocks: map(row.blocks) } : {}), ...(row.block ? { block: map(row.block) } : {}),
			...(Array.isArray(row.evidence) ? { evidence: row.evidence.map((item: Row) => item && typeof item === "object" ? { ...item, block: map(item.block) } : item) } : {}) });
	if (Array.isArray(out.continuations)) out.continuations = out.continuations.map(map);
	return out;
}
