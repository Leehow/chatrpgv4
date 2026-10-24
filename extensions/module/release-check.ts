/**
 * Contract §263.4: the release check. The pointer index proposes words players may perceive; a separate tool-free call
 * judges each against the book's protected facts; the host keeps the verdicts as certificates. Nothing here judges
 * meaning: the host only gathers candidates, finds facts by names and pages, and records what the checker said.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HostRuntime } from "../../runtime/host.ts";
import type { ReaderRequest } from "./reader.ts";
import { normalName, singleCall } from "./lean-skeleton.ts";
import { blockPage, refKey, sliceRef, type BlockText, type SourceRef } from "./source-refs.ts";
import { roughTokens, SOURCE_LAYOUT_VERSION } from "./source-blocks.ts";

type Row = Record<string, any>;
export const RELEASE_VERSION = 1;
export const RELEASE_BOUNDS = { candidates: 12, evidenceTokens: 6000, concurrency: 3 } as const;
export type ReleaseStatus = "approved" | "candidate" | "restricted";

export const releasePath = (home: string, sha: string): string => join(home, "source-skeletons", `${sha}-release.json`);

/** §263.4: the digest of every protected fact; a changed set re-checks the rows that relied on facts. */
export const factsVersion = (skeleton: Row): string => createHash("sha256")
	.update(JSON.stringify((skeleton?.protected_facts ?? []).map((fact: Row) => [fact.id, fact.summary]))).digest("hex").slice(0, 16);

/** §263.4: the static release of one verdict. */
export function releaseStatus(verdict: string | undefined, kind: string, complete: boolean, omitted: boolean): ReleaseStatus {
	if (verdict !== "safe") return "restricted";
	if (kind === "read_aloud" || kind === "handout") return omitted ? "candidate" : "approved";
	return complete && !omitted ? "approved" : "candidate";
}

/**
 * §263.4: the protected facts relevant to a candidate, found without judging meaning: facts naming the candidate's entity
 * or an entity whose name the candidate's text prints, facts on its page or the next one either side, then the rest of
 * its section's facts.
 */
export function relevantFacts(skeleton: Row, candidate: Row, text: string, sectionOf: (page: number) => number): Row[] {
	const printed = normalName(text), entityKey = normalName(candidate.entity ?? "");
	const named = new Set<string>([entityKey]);
	for (const entity of skeleton?.entities ?? []) {
		const forms = [entity.name, ...(entity.aliases ?? [])].map((name: string) => normalName(String(name))).filter(name => [...name].length >= 2);
		if (forms.some(form => printed.includes(form) || form === entityKey)) for (const form of forms) named.add(form);
	}
	const facts: Row[] = skeleton?.protected_facts ?? [];
	const rank = (fact: Row) => (fact.names ?? []).some((name: string) => named.has(normalName(name))) ? 0
		: (fact.pages ?? []).some((page: number) => Math.abs(page - candidate.page) <= 1) ? 1
			: (fact.pages ?? []).some((page: number) => sectionOf(page) === sectionOf(candidate.page)) ? 2 : 3;
	return facts.map(fact => ({ fact, rank: rank(fact) })).filter(row => row.rank < 3).sort((a, b) => a.rank - b.rank).map(row => row.fact);
}

export interface ReleaseContext {
	runtime: Pick<HostRuntime, "runTask" | "contentRoot">;
	moduleId: string;
	home: string;
	sha: string;
	skeleton: Row;
	blocks: Map<string, BlockText>;
	/** Pages read first (the opening's). */
	firstPages?: number[];
	model: { id: string; thinking?: string };
	signal: AbortSignal;
	record: (row: Row) => void;
	shared?: Partial<ReaderRequest>;
	mayContinue?: () => boolean;
}

/** §263.4: the context of a candidate for the checker: its block and the blocks either side, in reading order. */
function contextOf(ref: SourceRef, order: string[], blocks: Map<string, BlockText>): string {
	const at = order.indexOf(ref.spans[0]!.block);
	return order.slice(Math.max(0, at - 1), at + 2).map(id => blocks.get(id)?.text ?? "").join("\n").slice(0, 3000);
}

/** §263.4: check every release candidate not yet certified for this facts version and prompt; returns the release file. */
export async function checkReleases(context: ReleaseContext): Promise<Row> {
	const { skeleton, blocks, sha } = context;
	const file = releasePath(context.home, sha);
	const prompt = await readFile(join(context.runtime.contentRoot, "setup", "release-check.md"), "utf8");
	const promptSha = createHash("sha256").update(prompt).digest("hex").slice(0, 16), version = factsVersion(skeleton);
	let kept: Row = {};
	try { kept = JSON.parse(await readFile(file, "utf8")); } catch { /* none yet */ }
	const revoked = new Set<string>(Array.isArray(kept.revoked) ? kept.revoked : []);
	const previous = new Map<string, Row>((kept.version === RELEASE_VERSION && kept.prompt === promptSha ? kept.rows ?? [] : []).map((row: Row) => [row.key, row]));
	const complete = skeleton?.complete === true;
	const order = [...blocks.keys()];
	const sections: Row[] = skeleton?.sections ?? [];
	const sectionOf = (page: number) => sections.findIndex(section => page >= section.first && page <= section.last);
	const first = new Set(context.firstPages ?? []);
	const candidates: Row[] = (skeleton?.release_candidates ?? []).filter((row: Row) => sliceRef(row.ref, sha, SOURCE_LAYOUT_VERSION, blocks) !== undefined);
	const rows = new Map<string, Row>();
	const todo: Row[] = [];
	for (const candidate of candidates) {
		const old = previous.get(candidate.key);
		// A verdict that relied on no facts stays valid while its facts version is unchanged; a kept verdict is re-derived for completeness.
		if (old && old.facts_version === version) { rows.set(candidate.key, { ...old, status: revoked.has(old.key) ? "restricted" : releaseStatus(old.verdict, old.kind, complete, old.facts_omitted === true) }); continue; }
		todo.push(candidate);
	}
	todo.sort((a, b) => Number(!first.has(a.page)) - Number(!first.has(b.page)) || a.page - b.page);
	// Batches group one entity's candidates, at most 12 and about 6K tokens of evidence each.
	const batches: Row[][] = [];
	const byEntity = new Map<string, Row[]>();
	for (const candidate of todo) { const list = byEntity.get(candidate.entity) ?? []; list.push(candidate); byEntity.set(candidate.entity, list); }
	for (const list of byEntity.values()) for (let i = 0; i < list.length; i += RELEASE_BOUNDS.candidates) batches.push(list.slice(i, i + RELEASE_BOUNDS.candidates));
	const dirRoot = join(context.home, "source-skeletons", `${sha}-release-work`);
	await mkdir(dirRoot, { recursive: true });
	const one = async (index: number, batch: Row[]) => {
		if (context.signal.aborted || context.mayContinue?.() === false) return;
		const facts = new Map<string, Row>(), items: Row[] = [];
		let spent = 0, omitted = false;
		for (const [i, candidate] of batch.entries()) {
			const text = sliceRef(candidate.ref, sha, SOURCE_LAYOUT_VERSION, blocks)!;
			const item = { id: `c${i + 1}`, kind: candidate.kind, entity: candidate.entity, text, context: contextOf(candidate.ref, order, blocks) };
			spent += roughTokens(item.text) + roughTokens(item.context);
			items.push(item);
			for (const fact of relevantFacts(skeleton, candidate, text, sectionOf)) {
				if (facts.has(fact.id)) continue;
				const cost = roughTokens(fact.summary) + 10;
				if (spent + cost > RELEASE_BOUNDS.evidenceTokens) { omitted = true; break; }
				facts.set(fact.id, { id: fact.id, summary: fact.summary, ...(fact.reveal ? { reveal: fact.reveal } : {}) });
				spent += cost;
			}
		}
		const dir = join(dirRoot, `batch-${index + 1}-${Date.now()}`);
		await mkdir(dir, { recursive: true });
		const input = { candidates: items, protected_facts: [...facts.values()], facts_omitted: omitted };
		await writeFile(join(dir, "task.json"), JSON.stringify(input));
		const call = await singleCall(context.runtime, { cwd: dir, model: context.model, systemPrompt: prompt, signal: context.signal, shared: context.shared,
			brief: `${JSON.stringify(input)}\n\nAnswer with the JSON object now.`, timeoutMs: 180000 });
		const verdicts = new Map<string, Row>((Array.isArray(call.json?.verdicts) ? call.json!.verdicts : []).filter((row: Row) => typeof row?.id === "string").map((row: Row) => [row.id, row]));
		let approved = 0, candidate = 0, restricted = 0;
		for (const [i, row] of batch.entries()) {
			const answer = verdicts.get(`c${i + 1}`);
			const verdict = ["safe", "unsafe", "uncertain"].includes(answer?.verdict) ? answer!.verdict : undefined;
			const status = revoked.has(row.key) ? "restricted" : releaseStatus(verdict, row.kind, complete, omitted);
			if (status === "approved") approved++; else if (status === "candidate") candidate++; else restricted++;
			rows.set(row.key, { key: row.key, ref: row.ref, entity: row.entity, kind: row.kind, page: row.page, verdict: verdict ?? null,
				reason: typeof answer?.reason === "string" ? answer.reason.slice(0, 300) : call.json ? "no verdict" : "checker failed",
				facts: Array.isArray(answer?.facts) ? answer!.facts.filter((id: unknown) => typeof id === "string" && facts.has(id as string)) : [],
				facts_version: version, facts_omitted: omitted, status });
		}
		context.record({ lane: "reading", event: "release_check", module_id: context.moduleId, batch: index + 1, candidates: batch.length,
			approved, candidate, restricted, ms: call.outcome.ms, ok: call.outcome.ok, ...(call.outcome.usage ? { usage: call.outcome.usage } : {}) });
	};
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(RELEASE_BOUNDS.concurrency, batches.length) }, async () => {
		while (next < batches.length) { const index = next++; await one(index, batches[index]!); }
	}));
	const out = { version: RELEASE_VERSION, prompt: promptSha, facts_version: version, complete, revoked: [...revoked],
		rows: [...rows.values()].sort((a, b) => a.page - b.page) };
	const temp = `${file}.${process.pid}.tmp`;
	await writeFile(temp, JSON.stringify(out));
	await rename(temp, file);
	return out;
}

/** §263.5: the approved release rows of a book, sliced now; a ref that no longer slices is skipped. */
export function approvedPassages(release: Row, sha: string, blocks: Map<string, BlockText>): Row[] {
	const revoked = new Set<string>(Array.isArray(release?.revoked) ? release.revoked : []);
	return (release?.rows ?? []).flatMap((row: Row) => {
		if (row.status !== "approved" || revoked.has(row.key)) return [];
		const text = sliceRef(row.ref, sha, SOURCE_LAYOUT_VERSION, blocks);
		return text ? [{ key: row.key, entity: row.entity, kind: row.kind, page: row.page ?? blockPage(row.ref.spans[0].block), text }] : [];
	});
}

export { refKey };

/** The pages an `opening_pages` text carries (`[Original physical page N]` headings). */
const openingPages = (value: unknown): Set<number> => new Set([...String((value as Row)?.text ?? "").matchAll(/\[Original physical page ([0-9]+)\]/g)].map(match => Number(match[1])));

/**
 * §263.5: which approved passages this turn may hand the author. Name matching only (normalised spelling of the table's
 * display names against the entity's printed forms); the opening's own pages count as the scene the party stands in.
 */
export function passagesInScope(passages: Row[], capsule: Row): Row[] {
	const keys = (...values: unknown[]) => values.filter((value): value is string => typeof value === "string" && !!value.trim()).map(normalName).filter(key => [...key].length >= 2);
	const scene = new Set(keys(capsule?.where?.display_name, capsule?.where?.scene, capsule?.where?.name));
	const people = new Set((Array.isArray(capsule?.present) ? capsule.present : []).flatMap((person: Row) => keys(person?.display_name, person?.name, ...(Array.isArray(person?.aliases) ? person.aliases : []))));
	const held = new Set([...(Array.isArray(capsule?.own?.documents) ? capsule.own.documents : []), ...(Array.isArray(capsule?.inventory) ? capsule.inventory : []), ...(Array.isArray(capsule?.handouts) ? capsule.handouts : [])]
		.flatMap((item: Row) => keys(item?.name, item?.display_name, item?.title)));
	const opening = openingPages(capsule?.opening_pages);
	const named = (row: Row, set: Set<string>) => (row.forms ?? [normalName(row.entity)]).some((form: string) => set.has(form));
	return passages.filter(row => {
		if (row.kind === "appearance") return named(row, people);
		if (row.kind === "handout") return named(row, held);
		return named(row, scene) || opening.has(row.page);
	});
}

/** §263.5: each passage with its entity's printed forms (normalised), from the skeleton. */
export function withForms(passages: Row[], skeleton: Row): Row[] {
	const forms = new Map<string, string[]>();
	for (const entity of skeleton?.entities ?? []) {
		const list = [entity.name, ...(entity.aliases ?? [])].map((name: string) => normalName(String(name))).filter(key => [...key].length >= 2);
		for (const key of list) forms.set(key, list);
	}
	return passages.map(row => ({ ...row, forms: forms.get(normalName(row.entity)) ?? [normalName(row.entity)] }));
}
