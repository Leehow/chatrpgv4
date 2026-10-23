/**
 * Contract §262.3–§262.4: the lean detail reading. One bounded reader child over its pages' layout blocks, then a host
 * review: deterministic checks, one bounded verifier child per batch of high-risk records, pruning of what the verifier
 * does not support, and host review rows for the rest. The existing gate (`module.read.finish`) publishes.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { HostRuntime } from "../../runtime/host.ts";
import { readerInput, readingCacheId, type ReaderOutcome, type ReaderRequest } from "./reader.ts";
import { successfulImageDeliveries } from "./reader-image-delivery.ts";
import { roughTokens, type SourceBlock, type SourceBlocksPage } from "./source-blocks.ts";

type Row = Record<string, any>;

/** The bounds of the first lean experiment (spec "Budgets"). */
export const LEAN_BOUNDS = { readerRequests: 10, sourceTokens: 12000, crossTokens: 3000, verifyRequests: 3, verifyBatch: 12, verifyTokens: 6000 } as const;
/** Claim predicates whose error changes play (knowledge, rules, where a clue is found, beliefs and lies): a closed contract list. */
export const RISK_PREDICATES = new Set(["knows", "believes", "asserts", "hides", "uses-rule", "discoverable-at", "triggers", "enables", "threatens", "reveals"]);
/** Node kinds whose prose carries conditions, attributions or secrets: a closed contract list. */
export const RISK_NODE_KINDS = new Set(["npc", "creature", "rule", "secret", "event", "threat", "clock", "requirement"]);

/** Whether a claimed job reads lean (§262.3): a plain detail reading under `PI_COC_LEAN_READING=1`. */
export function leanEligible(job: Row, env: NodeJS.ProcessEnv = process.env): boolean {
	return env.PI_COC_LEAN_READING === "1" && job.purpose === "detail" && !job.visual_scan && !job.visual_asset && !job.map_scope
		&& !job.visual_identity && !job.node_identity && job.material !== "map";
}

const pagesOf = (refs: unknown): number[] => Array.isArray(refs)
	? [...new Set(refs.map((ref: Row) => Number(ref?.page)).filter(page => Number.isSafeInteger(page) && page > 0))] : [];
const squash = (text: string) => text.replace(/\s+/g, "");

/** §262.2: the pages' blocks, from the document's block cache, asking the source worker only for pages it lacks. */
export async function sourceBlocksFor(runtime: Pick<HostRuntime, "sourceBlocks">, source: { path: string; file_sha256: string }, pages: number[],
	cache: string, signal?: AbortSignal): Promise<Map<number, SourceBlocksPage>> {
	const wanted = [...new Set(pages)].filter(page => Number.isSafeInteger(page) && page > 0).sort((a, b) => a - b);
	const file = join(cache, `blocks-${source.file_sha256}.json`);
	let stored: { layout_version?: string; pages: Record<string, SourceBlocksPage> } = { pages: {} };
	try { stored = JSON.parse(await readFile(file, "utf8")); } catch { /* first use of this document */ }
	const missing = wanted.filter(page => !stored.pages?.[page]);
	for (let at = 0; at < missing.length; at += 32) {
		const answer = await runtime.sourceBlocks({ pdf: source.path, pages: missing.slice(at, at + 32), expected_file_sha256: source.file_sha256 }, signal);
		if (stored.layout_version && stored.layout_version !== answer.layout_version) stored = { pages: {} };
		stored.layout_version = answer.layout_version;
		for (const page of answer.pages) stored.pages[page.page] = page;
	}
	if (missing.length) {
		await mkdir(cache, { recursive: true });
		const temp = `${file}.${process.pid}.tmp`;
		await writeFile(temp, JSON.stringify(stored));
		await rename(temp, file);
	}
	return new Map(wanted.flatMap(page => stored.pages[page] ? [[page, stored.pages[page]] as const] : []));
}

const blockRow = (block: SourceBlock) => ({ id: block.id, page: block.page, text: block.text, ...(block.continues ? { continues: block.continues } : {}) });

/**
 * §262.3: the inlined input of a lean reading: the task without its published dumps, the roster, the pages' blocks up to
 * the source bound (later pages are named in `more_pages`), and the cross references up to theirs.
 */
export function leanInput(task: Row, blocks: Map<number, SourceBlocksPage>, crossReferences: Row[] = []): Row {
	const { known_nodes, known_claims, roster: _roster, commands: _commands, index: _index, ...rest } = task;
	const roster = (Array.isArray(known_nodes) ? known_nodes : []).map((node: Row) => ({ node_id: node.node_id, node_kind: node.node_kind, name: node.name,
		...(Array.isArray(node.aliases) && node.aliases.length ? { aliases: node.aliases } : {}) }));
	const source_blocks: Row[] = [], more_pages: number[] = [], image_pages: number[] = [];
	let spent = 0;
	for (const [page, row] of [...blocks].sort((a, b) => a[0] - b[0])) {
		if (row.image_only) { image_pages.push(page); continue; }
		const cost = row.blocks.reduce((sum, block) => sum + roughTokens(block.text), 0);
		if (spent && spent + cost > LEAN_BOUNDS.sourceTokens) { more_pages.push(page); continue; }
		spent += cost;
		source_blocks.push(...row.blocks.map(blockRow));
	}
	const cross: Row[] = [];
	let crossSpent = 0;
	for (const reference of crossReferences) {
		const cost = roughTokens(JSON.stringify(reference));
		if (crossSpent + cost > LEAN_BOUNDS.crossTokens) break;
		crossSpent += cost;
		cross.push(reference);
	}
	return { ...rest, roster, known_claims: Array.isArray(known_claims) ? known_claims.length : 0, source_blocks,
		...(more_pages.length ? { more_pages } : {}), ...(image_pages.length ? { image_pages } : {}), ...(cross.length ? { cross_references: cross } : {}) };
}

/** One high-risk record for the verifier: its draft path, the record and the pages it cites. */
export type RiskCandidate = { ref: string; path: string; kind: "claim" | "exhibit" | "node"; record: Row; pages: number[] };

/** §262.4: the draft's high-risk records (closed predicate and kind lists; every exhibit). */
export function highRiskCandidates(draft: Row): RiskCandidate[] {
	const out: RiskCandidate[] = [];
	const push = (path: string, kind: RiskCandidate["kind"], record: Row) => out.push({ ref: `c${out.length + 1}`, path, kind, record, pages: pagesOf(record.source_refs) });
	(draft.claims ?? []).forEach((claim: Row, i: number) => {
		if (RISK_PREDICATES.has(String(claim?.predicate)) || claim?.validity) push(`/claims/${i}`, "claim", claim);
	});
	(draft.exhibits ?? []).forEach((exhibit: Row, i: number) => push(`/exhibits/${i}`, "exhibit", exhibit));
	(draft.nodes ?? []).forEach((node: Row, i: number) => {
		if (RISK_NODE_KINDS.has(String(node?.node_kind))) push(`/nodes/${i}`, "node", node);
	});
	return out;
}

/** §262.4 step 1: the host's own checks. A verbatim exhibit whose surface is not in its pages' blocks is refused. */
export function hostRefusals(draft: Row, blocks: Map<number, SourceBlocksPage>, readPages: Set<number>): Array<{ path: string; reason: string }> {
	const refused: Array<{ path: string; reason: string }> = [];
	const text = (pages: number[]) => squash(pages.flatMap(page => blocks.get(page)?.blocks.map(block => block.text) ?? []).join(""));
	(draft.exhibits ?? []).forEach((exhibit: Row, i: number) => {
		const pages = pagesOf(exhibit?.source_refs);
		if (pages.some(page => !readPages.has(page))) refused.push({ path: `/exhibits/${i}`, reason: "cites a page the reader did not read" });
		else if (exhibit?.surface?.verbatim === true && typeof exhibit.surface.text === "string" && pages.length
			&& pages.every(page => blocks.get(page) && !blocks.get(page)!.image_only) && !text(pages).includes(squash(exhibit.surface.text)))
			refused.push({ path: `/exhibits/${i}`, reason: "verbatim surface text is not in the cited pages' text" });
	});
	(draft.claims ?? []).forEach((claim: Row, i: number) => {
		if (pagesOf(claim?.source_refs).some(page => !readPages.has(page))) refused.push({ path: `/claims/${i}`, reason: "cites a page the reader did not read" });
	});
	return refused;
}

/**
 * §262.4 step 2–3: remove refused records. A whole claim or exhibit goes; a node loses the named properties (its root
 * goes, with every claim, exhibit and list entry naming it, when the verdict names no field). Returns the removed node ids.
 */
export function pruneDraft(draft: Row, refusals: Array<{ path: string; fields?: string[] }>): string[] {
	const drop = { claims: new Set<number>(), exhibits: new Set<number>(), nodes: new Set<number>() };
	for (const refusal of refusals) {
		const match = /^\/(claims|exhibits|nodes)\/(\d+)$/.exec(refusal.path);
		if (!match) continue;
		const [, kind, index] = match, at = Number(index);
		if (kind === "nodes" && refusal.fields?.length) {
			const node = draft.nodes?.[at];
			for (const field of refusal.fields) {
				if (field === "summary") continue;
				if (node?.properties && Object.hasOwn(node.properties, field)) delete node.properties[field];
			}
			continue;
		}
		drop[kind as keyof typeof drop].add(at);
	}
	const removedNodes = [...drop.nodes].map(at => String(draft.nodes?.[at]?.node_id)).filter(Boolean);
	const gone = new Set(removedNodes);
	const names = (value: unknown): boolean => typeof value === "string" ? gone.has(value)
		: Array.isArray(value) ? value.some(names) : !!value && typeof value === "object" && Object.values(value).some(names);
	if (Array.isArray(draft.nodes)) draft.nodes = draft.nodes.filter((_: Row, i: number) => !drop.nodes.has(i));
	if (Array.isArray(draft.claims)) draft.claims = draft.claims.filter((claim: Row, i: number) => !drop.claims.has(i)
		&& !gone.has(claim?.subject_id) && !names(claim?.object));
	if (Array.isArray(draft.exhibits)) draft.exhibits = draft.exhibits.filter((exhibit: Row, i: number) => !drop.exhibits.has(i)
		&& !gone.has(exhibit?.carrier) && !(Array.isArray(exhibit?.owners) && exhibit.owners.some((owner: unknown) => gone.has(String(owner)))));
	for (const key of ["ready_nodes", "critical", "node_refs"]) if (Array.isArray(draft[key])) draft[key] = draft[key].filter((entry: unknown) => !names(entry));
	if (Array.isArray(draft.dependencies)) draft.dependencies = draft.dependencies.filter((entry: unknown) => !names(entry));
	return removedNodes;
}

/** The verifier's verdict rows, validated: every ref once, a closed verdict. */
export function readVerdicts(answer: unknown, candidates: RiskCandidate[]): Map<string, { verdict: string; reason: string; fields: string[] }> {
	const rows = Array.isArray((answer as Row)?.verdicts) ? (answer as Row).verdicts : [];
	const refs = new Set(candidates.map(candidate => candidate.ref)), out = new Map<string, { verdict: string; reason: string; fields: string[] }>();
	for (const row of rows) {
		if (!refs.has(row?.ref) || out.has(row.ref) || !["supported", "unsupported", "uncertain"].includes(row?.verdict)) continue;
		out.set(row.ref, { verdict: row.verdict, reason: String(row.reason ?? "").slice(0, 500),
			fields: Array.isArray(row.fields) ? row.fields.filter((field: unknown): field is string => typeof field === "string") : [] });
	}
	return out;
}

/** A verifier batch's blocks: every block of the cited pages, under the batch bound. */
function batchBlocks(batch: RiskCandidate[], blocks: Map<number, SourceBlocksPage>): Row[] {
	const pages = [...new Set(batch.flatMap(candidate => candidate.pages))].sort((a, b) => a - b), out: Row[] = [];
	let spent = 0;
	for (const page of pages) for (const block of blocks.get(page)?.blocks ?? []) {
		const cost = roughTokens(block.text);
		if (spent + cost > LEAN_BOUNDS.verifyTokens * 2) return out;
		spent += cost; out.push(blockRow(block));
	}
	return out;
}

export interface LeanContext {
	runtime: Pick<HostRuntime, "runTask" | "check" | "sourceBlocks" | "contentRoot">;
	job: Row;
	cwd: string;
	cache: string;
	model: { id: string; thinking?: string };
	signal: AbortSignal;
	record: (row: Row) => void;
	/** The child request fields every reader of this job shares (budget, lease, priority, activity). */
	shared: Partial<ReaderRequest>;
	/** Skeleton rows from other sections that name an entity of this job's pages (§262.5). */
	crossReferences?: Row[];
}

/** What a lean reading leaves for publication: the pruned draft and the host-written review. */
export interface LeanResult { draftPath: string; reviewPath: string; readPages: number[]; pruned: Array<{ path: string; reason: string }> }

/** Run a lean detail reading to a publishable draft and review; throws with the check's message when it cannot. */
export async function runLeanDetail(context: LeanContext): Promise<LeanResult> {
	const { runtime, job, cwd, cache, model, signal, record } = context;
	const task: Row = JSON.parse(await readFile(join(cwd, "task.json"), "utf8"));
	const pages: number[] = (Array.isArray(job.pages) ? job.pages : []).filter((page: unknown) => Number.isSafeInteger(page) && Number(page) > 0);
	const blocks = await sourceBlocksFor(runtime, { path: job.source.path, file_sha256: job.source.file_sha256 }, pages, cache, signal);
	const input = leanInput(task, blocks, context.crossReferences ?? []);
	await writeFile(join(cwd, "lean-input.json"), JSON.stringify(input) + "\n");
	const eventLog = join(cwd, "lean-read.jsonl");
	const viewedCalls = new Map<string, number[]>();
	const run: ReaderOutcome = await runtime.runTask({ kind: "reader", request: { ...context.shared, cwd, model: model.id, thinking: model.thinking,
		maxRequests: LEAN_BOUNDS.readerRequests, submission: true, eventLog, cacheId: readingCacheId(job.module_id, job.job_id, 1),
		source: { pdf: job.source.path, cache: join(cache, "pages"), file_sha256: job.source.file_sha256 },
		prompt: { phase: "read", purpose: "detail", lean: true, ...(typeof job.material === "string" ? { material: job.material } : {}) },
		brief: `${readerInput({ lean_input: input })} Your phase is read. Follow the lean reading bounds: view the pages with one pdf call, write draft.json once, then submit_reading as your sole final tool call; repair only what a refusal names.`,
		onEvent(event: Row) {
			context.shared.onEvent?.(event as any);
			if (event.type === "tool_execution_end" && !event.isError && event.result?.details?.kind === "source_pages")
				viewedCalls.set(event.toolCallId, (event.result.details.observations ?? []).filter((row: Row) => !row.box || JSON.stringify(row.box) === "[0,0,1,1]")
					.map((row: Row) => row.page).filter(Number.isSafeInteger));
		} } as ReaderRequest }, signal);
	record({ lane: "reading", phase: "lean-read", module_id: job.module_id, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "",
		model: model.id, thinking: model.thinking, ms: run.ms, ok: run.ok, ...(run.usage ? { usage: run.usage } : {}),
		inlined_blocks: input.source_blocks.length, cross_references: input.cross_references?.length ?? 0, ...(run.refusal ? { refusal: run.refusal.reason } : {}) });
	// A budget refusal stops the reading; a run that ended otherwise (its request bound, a dropped stream) leaves its draft to the host's check.
	if (!run.ok && run.refusal) throw new Error(`the lean reader's provider refused (${run.refusal.reason}: ${run.refusal.code})`);
	const viewed = new Set<number>();
	try {
		const delivered = await successfulImageDeliveries(eventLog + ".images.jsonl", { file_sha256: job.source.file_sha256, cache: join(cache, "pages") });
		for (const id of delivered.toolCallIds) for (const page of viewedCalls.get(id) ?? []) viewed.add(page);
		for (const row of delivered.hostPages) viewed.add(row.page);
	} catch { /* no image was delivered */ }
	// The host's check decides, whether or not the child's last submission passed.
	const checked = await runtime.check({ kind: "source-draft", packet: join(cwd, "task.json"), draft: join(cwd, "draft.json") }, signal);
	if (!checked.ok) throw new Error(`lean reading did not produce a checked draft: ${JSON.stringify(checked.error ?? checked).slice(0, 2000)}`);
	const unviewed = (Array.isArray(checked.required_view_pages) ? checked.required_view_pages : []).filter((page: number) => !viewed.has(page));
	if (unviewed.length) throw new Error(`lean reading cites pages it did not view: ${unviewed.join(", ")}`);
	const readPages = new Set<number>([...viewed]);
	const draft: Row = JSON.parse(await readFile(join(cwd, "draft.json"), "utf8"));
	const pruned: Array<{ path: string; reason: string; fields?: string[] }> = [...hostRefusals(draft, blocks, readPages)];
	// §262.4 step 2: the verifier sees only records the host did not already refuse.
	const refusedPaths = new Set(pruned.map(row => row.path));
	const candidates = highRiskCandidates(draft).filter(candidate => !refusedPaths.has(candidate.path));
	const cited = await sourceBlocksFor(runtime, { path: job.source.path, file_sha256: job.source.file_sha256 },
		candidates.flatMap(candidate => candidate.pages), cache, signal);
	for (let at = 0, batch = 1; at < candidates.length; at += LEAN_BOUNDS.verifyBatch, batch++) {
		const slice = candidates.slice(at, at + LEAN_BOUNDS.verifyBatch);
		const dir = join(cwd, `lean-verify-${batch}`);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "task.json"), JSON.stringify({ candidates: slice.map(({ ref, kind, record: row, pages: cites }) => ({ ref, kind, record: row, pages: cites })),
			blocks: batchBlocks(slice, cited) }) + "\n");
		const verify = await runtime.runTask({ kind: "reader", request: { ...context.shared, cwd: dir, model: model.id, thinking: model.thinking,
			systemPrompt: await readFile(join(runtime.contentRoot, "setup", "lean-verify.md"), "utf8"), tools: "read,write",
			maxRequests: LEAN_BOUNDS.verifyRequests, eventLog: join(dir, "events.jsonl"),
			brief: "Read task.json, then write verdicts.json as instructed." } as ReaderRequest }, signal);
		record({ lane: "reading", phase: "lean-verify", module_id: job.module_id, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "", batch,
			candidates: slice.length, model: model.id, ms: verify.ms, ok: verify.ok, ...(verify.usage ? { usage: verify.usage } : {}) });
		let verdicts = new Map<string, { verdict: string; reason: string; fields: string[] }>();
		try { verdicts = readVerdicts(JSON.parse(await readFile(join(dir, "verdicts.json"), "utf8")), slice); } catch { /* an unanswered batch is uncertain */ }
		for (const candidate of slice) {
			const verdict = verdicts.get(candidate.ref) ?? { verdict: "uncertain", reason: "the verifier gave no verdict", fields: [] };
			if (verdict.verdict === "supported" && !(candidate.kind === "node" && verdict.fields.length)) continue;
			// A node the verifier faults field by field keeps its root and loses the fields; with no field named it is uncertain as a whole.
			pruned.push({ path: candidate.path, reason: `${verdict.verdict}: ${verdict.reason}`, ...(candidate.kind === "node" ? { fields: verdict.fields } : {}) });
		}
	}
	const focusNodes = new Set((Array.isArray(task.known_nodes) ? task.known_nodes : []).map((node: Row) => node.node_id));
	// A node pruned whole is kept when the verifier named no field and the node is already published: its fields stay as read.
	const effective = pruned.filter(row => !(row.path.startsWith("/nodes/") && !row.fields?.length && focusNodes.has(draft.nodes?.[Number(row.path.split("/")[2])]?.node_id)));
	const removed = pruneDraft(draft, effective);
	if (typeof job.focus === "string" && (draft.nodes ?? []).length === 0) throw new Error(`lean review removed every node of ${job.focus}`);
	await writeFile(join(cwd, "draft.json"), JSON.stringify(draft) + "\n");
	const rechecked = await runtime.check({ kind: "source-draft", packet: join(cwd, "task.json"), draft: join(cwd, "draft.json") }, signal);
	if (!rechecked.ok) throw new Error(`lean review left a draft the check refuses: ${JSON.stringify(rechecked.error ?? rechecked).slice(0, 2000)}`);
	const required: string[] = Array.isArray(rechecked.required_review) ? rechecked.required_review : [];
	const sorted = [...readPages].sort((a, b) => a - b), fallback = sorted.length ? [{ page: sorted[0] }] : [];
	const refsOf = (path: string): Row[] => {
		const match = /^\/(nodes|claims|exhibits)\/(\d+)/.exec(path);
		const cites = match ? pagesOf(draft[match[1]]?.[Number(match[2])]?.source_refs).filter(page => readPages.has(page)) : [];
		return cites.length ? cites.map(page => ({ page })) : fallback;
	};
	const verifiedRoots = new Set(candidates.map(candidate => candidate.path));
	const review = { checked: required.map(path => ({ paths: [path], verdict: "supported", source_refs: refsOf(path),
		reviewer: verifiedRoots.has((/^\/(nodes|claims|exhibits)\/\d+/.exec(path) ?? [path])[0]) ? "lean-verifier" : "lean-host",
		reason: "Lean review (contract 262.4): host checks passed and no verifier refusal remains for this record." })), missing: [] };
	await writeFile(join(cwd, "review.json"), JSON.stringify(review) + "\n");
	await writeFile(join(cwd, "observations.json"), JSON.stringify({ file_sha256: job.source.file_sha256, read_pages: sorted, full_pages: sorted, review_pages: sorted }) + "\n");
	await writeFile(join(cwd, "lean-review.json"), JSON.stringify({ pruned: effective, removed_nodes: removed, candidates: candidates.length }) + "\n");
	record({ lane: "reading", event: "lean_review", module_id: job.module_id, job_id: job.job_id, focus: job.focus ?? "", candidates: candidates.length,
		pruned: effective.length, removed_nodes: removed.length });
	return { draftPath: join(cwd, "draft.json"), reviewPath: join(cwd, "review.json"), readPages: sorted, pruned: effective };
}

