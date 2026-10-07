/**
 * Contract §151.2.2: a review that refused specific records, and missed nothing, is repaired record by record.
 *
 * Blood05 pages 19-20 (2026-09-28): the independent review refused 3 of 29 claims -- relations the page does not state --
 * and listed nothing missing. The job paid a full re-author (156 s, longer than the first author) and the repaired draft
 * came back with other records changed too, so every unit was reviewed again. The records the review accepted are
 * evidence already paid for; a repair that touches them is not a repair of what was refused.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { candidateDigest, gateRefusal, readReviewPlan, recordRoot, REVIEW_PLAN_FILE, type ReviewPlan } from "./reader-review.ts";

type Row = Record<string, any>;

/** What the targeted author is told, in the system language (§151.2.2). */
export const TARGETED_REPAIR_ASK = "This reading repairs a reviewed candidate record by record. draft.json is that candidate. task.repair.refused lists "
	+ "every path the independent review refused, with its verdict, the reviewer's reason and the pages it cited; task.repair.pages are the original "
	+ "pages of those records, supplied as images with their native text (use pdf for a closer view). Change only the refused records: correct each "
	+ "one to what its page states, and delete a relation the page does not state. Every other node and claim must stay byte-identical: the host "
	+ "compares them and refuses any other change. A corrected node keeps its node_id. If you delete a refused node, also delete the claims whose "
	+ "subject or object it was, and drop its id from ready_nodes and node_refs. If a deletion moves later records, renumber the critical pointers "
	+ "so each still names the same record. Add no record beyond one replacement per refused record, and leave coverage, source_needs, "
	+ "dependencies and interaction_scene as they are.";

/**
 * What the append author is told (§187.6.1): the review missed material on pages this job already reads, so the repair
 * adds what is missing and touches nothing that was reviewed.
 */
export const APPEND_REPAIR_ASK = "This reading repairs a reviewed candidate by adding what the review found missing. draft.json is that candidate, and "
	+ "every node and claim in it was reviewed and accepted. task.repair.missing lists what the independent review found missing, each with the "
	+ "original pages it named and the reviewer's reason; task.repair.pages are those pages, supplied as images with their native text (use pdf for "
	+ "a closer view). Add the nodes and claims the pages state for each missing item, citing those pages. Do not change or remove any "
	+ "existing node or claim: the host compares every one of them byte for byte and refuses any change. You may add the new "
	+ "nodes' ids to ready_nodes and node_refs and the new records' pointers to critical, and keep the existing entries of all three. Do not invent "
	+ "material a page does not state; if a missing item cannot be answered from these pages, retain it in source_needs.";

/** One missing item of an append repair: the review's item as written, and the pages it names. */
export interface MissingItem { item: unknown; pages: number[] }
/** One refused path, as the brief carries it. */
export interface RefusedPath { path: string; root: string; verdict: string; reason: string; source_refs: Row[] }
export type RepairDecision =
	| { kind: "targeted"; refused: RefusedPath[]; roots: string[]; pages: number[] }
	/** §187.6.1: every `missing` item names pages inside the job's pages and nothing was refused. */
	| { kind: "append"; missing: MissingItem[]; pages: number[] }
	| { kind: "full"; reason: "no_review" | "missing" | "no_refusal" | "not_a_record" | "targeted_refused" | "append_refused" };

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

/**
 * The review and plan a previous round wrote for exactly this candidate, from the first of `dirs` that has them. The plan
 * binds both: its candidate digest must be this candidate's and its review digest the review file's, so a review.json
 * anyone else wrote, or one of an earlier candidate, never steers a repair.
 */
export async function reviewOfCandidate(dirs: string[], candidate: Row): Promise<{ dir: string; review: Row; plan: ReviewPlan; plan_sha256: string } | undefined> {
	const wanted = candidateDigest(candidate);
	for (const dir of dirs) {
		try {
			const text = await readFile(join(dir, REVIEW_PLAN_FILE), "utf8"), plan = readReviewPlan(text);
			if (!plan || plan.candidate_sha256 !== wanted) continue;
			const bytes = await readFile(join(dir, "review.json"));
			if (sha(bytes) !== plan.review_sha256) continue;
			// §186.4: the plan's own digest names it in a carried coverage row's `carried_from`.
			return { dir, review: JSON.parse(bytes.toString()), plan, plan_sha256: sha(text) };
		} catch { /* no review of this candidate here */ }
	}
	return undefined;
}

/**
 * Targeted when the review is complete, lists no `missing` item (omissions need reading), and every path the publication
 * gate would refuse lies in a node or claim of the candidate. "Would refuse" is the gate's own rule (`checkReview`): not
 * `supported`, and not a contest -- an advisory finding under module-logic-v1, a classification field otherwise.
 * The pages are those the refused records cite, plus a source unit's assigned pages, which the checker requires every
 * read of the unit to view.
 */
export function repairDecision(candidate: Row, review: Row, task: Row): RepairDecision {
	if (!Array.isArray(review?.checked) || !Array.isArray(review?.missing)) return { kind: "full", reason: "no_review" };
	const refuses = gateRefusal(task);
	// §187.6.1: a review that both refuses and misses is a full round; one that only misses, on this job's own pages, appends.
	if (review.missing.length) {
		const refusing = review.checked.some((row: Row) => (Array.isArray(row?.paths) ? row.paths : [row?.path]).some((path: string) => refuses(row, path)));
		return refusing ? { kind: "full", reason: "missing" } : appendDecision(review.missing, task);
	}
	const refused: RefusedPath[] = [];
	for (const row of review.checked) {
		for (const path of Array.isArray(row?.paths) ? row.paths : [row?.path]) {
			if (!refuses(row, path)) continue;
			const record = recordRoot(path);
			if (!record || !candidate?.[record.collection]?.[record.index]) return { kind: "full", reason: "not_a_record" };
			refused.push({ path, root: record.root, verdict: String(row?.verdict ?? ""), reason: String(row?.reason ?? ""),
				source_refs: Array.isArray(row?.source_refs) ? row.source_refs : [] });
		}
	}
	if (!refused.length) return { kind: "full", reason: "no_refusal" };
	const roots = [...new Set(refused.map(entry => entry.root))];
	const pages = new Set<number>();
	for (const root of roots) {
		const record = recordRoot(root)!, value = candidate[record.collection][record.index];
		for (const ref of [...(value?.source_refs ?? []), ...(value?.properties?.image_sources ?? [])])
			if (Number.isSafeInteger(ref?.page) && ref.page > 0) pages.add(ref.page);
	}
	if (task?.source_unit) for (const page of Array.isArray(task.pages) ? task.pages : []) if (Number.isSafeInteger(page) && page > 0) pages.add(page);
	return { kind: "targeted", refused, roots, pages: [...pages].sort((a, b) => a - b) };
}

const pageList = (value: unknown): number[] => Array.isArray(value) ? value.filter((page): page is number => Number.isSafeInteger(page) && page > 0) : [];
/** The pages a missing item names: the `source_refs` the review protocol cites with. An item without one names none. */
export function missingPages(item: unknown): number[] {
	const refs = item && typeof item === "object" && Array.isArray((item as Row).source_refs) ? (item as Row).source_refs : [];
	return [...new Set(pageList(refs.map((ref: Row) => ref?.page)))].sort((a, b) => a - b);
}

/**
 * §187.6.1: the job's pages are the task's assigned `pages`. Every missing item must name at least one page and every page
 * it names must be one of them; otherwise the omission is a reading, not a repair, and the round is full. The repair's
 * pages are the named pages plus, for a source unit, its assigned pages (the checker requires every read of a unit to view them).
 */
function appendDecision(missing: unknown[], task: Row): RepairDecision {
	const jobPages = new Set(pageList(task?.pages));
	if (!jobPages.size) return { kind: "full", reason: "missing" };
	const items: MissingItem[] = [];
	for (const item of missing) {
		const pages = missingPages(item);
		if (!pages.length || pages.some(page => !jobPages.has(page))) return { kind: "full", reason: "missing" };
		items.push({ item, pages });
	}
	const pages = new Set(items.flatMap(entry => entry.pages));
	if (task?.source_unit) for (const page of jobPages) pages.add(page);
	return { kind: "append", missing: items, pages: [...pages].sort((a, b) => a - b) };
}

function canonical(value: any): string {
	if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
	if (value && typeof value === "object") return "{" + Object.keys(value).filter(key => value[key] !== undefined).sort()
		.map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
	return JSON.stringify(value) ?? "undefined";
}

/**
 * The host's check after a targeted repair (§151.2.2): every record the review did not refuse is still in the draft,
 * byte-identical (compared as canonical JSON, wherever it now sits), except a claim whose subject or object was a
 * refused node the repair removed. Beyond that the repair may add at most one replacement per refused record of the same
 * collection, and a replacement node carries a refused node's id. `ready_nodes` and `node_refs` lose exactly the removed
 * nodes' ids; `critical` names the same pointers of the kept records at their new positions (pointers into refused or
 * replacement records are the repair's own); every other shard field is unchanged. `paths` names what changed: an
 * accepted record by its position in the candidate, a record the repair added by its position in the repair.
 */
export function checkTargetedRepair(candidate: Row, repaired: Row, roots: string[]): { ok: true } | { ok: false; paths: string[] } {
	const refused = new Set(roots), changed: string[] = [];
	const list = (draft: Row, key: string): Row[] => Array.isArray(draft?.[key]) ? draft[key] : [];
	const refusedNodeIds = new Set(list(candidate, "nodes").filter((_, index) => refused.has(`/nodes/${index}`)).map(node => node?.node_id));
	const repairedIds = new Set(list(repaired, "nodes").map(node => node?.node_id));
	const removed = new Set([...refusedNodeIds].filter(id => !repairedIds.has(id)));
	const moved = new Map<string, string>(), replacements = new Set<string>();
	for (const collection of ["nodes", "claims"]) {
		const before = list(candidate, collection), after = list(repaired, collection);
		const free = new Map<string, number[]>();
		after.forEach((row, index) => { const key = canonical(row); free.set(key, [...(free.get(key) ?? []), index]); });
		const matched = new Set<number>();
		for (const [index, row] of before.entries()) {
			if (refused.has(`/${collection}/${index}`)) continue;
			const at = free.get(canonical(row))?.shift();
			if (at !== undefined) { matched.add(at); moved.set(`/${collection}/${index}`, `/${collection}/${at}`); continue; }
			const orphaned = collection === "claims" && [row?.subject_id, row?.object?.node_id].some(id => removed.has(id));
			if (!orphaned) changed.push(`/${collection}/${index}`);
		}
		const added = after.map((_, index) => index).filter(index => !matched.has(index));
		const allowance = [...refused].filter(root => root.startsWith(`/${collection}/`)).length;
		for (const [position, index] of added.entries()) {
			const root = `/${collection}/${index}`;
			if (position >= allowance || collection === "nodes" && !refusedNodeIds.has(after[index]?.node_id)) changed.push(root);
			replacements.add(root);
		}
	}
	for (const key of ["ready_nodes", "node_refs"]) {
		if (candidate?.[key] === undefined && repaired?.[key] === undefined) continue;
		const expected = list(candidate, key).filter(id => !removed.has(id));
		if (canonical(expected) !== canonical(repaired?.[key])) changed.push(`/${key}`);
	}
	const kept = (pointer: unknown): string | null => {
		const record = recordRoot(pointer);
		if (!record) return typeof pointer === "string" ? pointer : null;
		if (refused.has(record.root)) return null;
		const to = moved.get(record.root);
		return to === undefined ? null : to + record.rest;
	};
	const expected = new Set(list(candidate, "critical").map(kept).filter((pointer): pointer is string => pointer !== null));
	const actual = new Set(list(repaired, "critical").filter(pointer => { const record = recordRoot(pointer); return !(record && replacements.has(record.root)); }));
	if (expected.size !== actual.size || [...expected].some(pointer => !actual.has(pointer))) changed.push("/critical");
	for (const key of new Set([...Object.keys(candidate ?? {}), ...Object.keys(repaired ?? {})]))
		if (!["nodes", "claims", "ready_nodes", "node_refs", "critical"].includes(key) && canonical(candidate?.[key]) !== canonical(repaired?.[key])) changed.push(`/${key}`);
	return changed.length ? { ok: false, paths: [...new Set(changed)] } : { ok: true };
}

/**
 * The host's check after an append repair (§187.6.1): every node and claim of the reviewed candidate is still present
 * byte-identical (canonical JSON, any position) and none was removed; `ready_nodes` and `node_refs` keep every entry
 * they had; `critical` keeps every pointer of the kept records at their new positions. New records, their ids and
 * pointers, and the other shard fields (coverage, source_needs, dependencies, interaction_scene) are the append's own,
 * judged by the review of the new records and the coverage unit. `paths` names the candidate's records or fields that
 * did not survive.
 */
export function checkAppendRepair(candidate: Row, repaired: Row): { ok: true } | { ok: false; reason: "append_changed_existing"; paths: string[] } {
	const changed: string[] = [], moved = new Map<string, string>();
	const list = (draft: Row, key: string): any[] => Array.isArray(draft?.[key]) ? draft[key] : [];
	for (const collection of ["nodes", "claims"]) {
		const free = new Map<string, number[]>();
		list(repaired, collection).forEach((row, index) => { const key = canonical(row); free.set(key, [...(free.get(key) ?? []), index]); });
		for (const [index, row] of list(candidate, collection).entries()) {
			const at = free.get(canonical(row))?.shift();
			if (at === undefined) changed.push(`/${collection}/${index}`);
			else moved.set(`/${collection}/${index}`, `/${collection}/${at}`);
		}
	}
	for (const key of ["ready_nodes", "node_refs"]) {
		const now = new Set(list(repaired, key).map(entry => canonical(entry)));
		if (list(candidate, key).some(entry => !now.has(canonical(entry)))) changed.push(`/${key}`);
	}
	const critical = new Set(list(repaired, "critical"));
	for (const pointer of list(candidate, "critical")) {
		const record = recordRoot(pointer);
		const expected = record ? (moved.has(record.root) ? moved.get(record.root)! + record.rest : undefined) : pointer;
		if (expected !== undefined && !critical.has(expected)) { changed.push("/critical"); break; }
	}
	return changed.length ? { ok: false, reason: "append_changed_existing", paths: [...new Set(changed)] } : { ok: true };
}

/**
 * §187.6.1: after an accepted append, a fact unit whose records are all records the bound review already judged -- the same
 * records, byte-identical, owing the same pointers -- keeps that review's rows for them; only the new records' units and
 * the coverage unit run. The previous plan must have recorded each unit's share of `review.json` and its viewed pages
 * (§186.4's plan fields), the unit's rows must be ones the publication gate accepts, and the rows move to the records'
 * current positions with `carried_from`. `undefined` when any of that does not hold: the unit then runs as before.
 */
export function appendUnitCarry(previous: { plan: ReviewPlan; plan_sha256: string; review: Row }, now: { draft: Row; task: Row; paths: string[] }):
	{ review: Row; pages: number[]; carried_from: { round: number; plan_digest: string } } | undefined {
	const { plan, review } = previous;
	const roots: string[] = [];
	for (const path of now.paths) { const record = recordRoot(path); if (!record) return undefined; if (!roots.includes(record.root)) roots.push(record.root); }
	if (!roots.length || !Array.isArray(review?.checked) || !Number.isSafeInteger(plan?.round)) return undefined;
	const counted = plan.units.every(unit => Number.isSafeInteger(unit.checked) && Number(unit.checked) >= 0);
	if (!counted || plan.units.reduce((sum, unit) => sum + unit.checked!, 0) !== review.checked.length) return undefined;
	const value = (draft: Row, root: string) => { const record = recordRoot(root)!; return draft?.[record.collection]?.[record.index]; };
	const digests = roots.map(root => sha(canonical(value(now.draft, root) ?? null)));
	let at = 0;
	for (const unit of plan.units) {
		const rows: Row[] = review.checked.slice(at, at += unit.checked!);
		if (unit.roots.length !== roots.length || unit.records.some((record, index) => record !== digests[index])) continue;
		if (unit.roots.some((root, index) => recordRoot(root)?.collection !== recordRoot(roots[index])?.collection)) continue;
		const move = (path: unknown): string | undefined => {
			if (typeof path !== "string") return undefined;
			const index = unit.roots.findIndex(root => path === root || path.startsWith(root + "/"));
			return index < 0 ? undefined : roots[index] + path.slice(unit.roots[index].length);
		};
		// §187.8.1: a first-round unit may have carried the coverage pointers beside its records; the append carries its records only.
		const owed = unit.paths.filter(path => typeof path === "string" && recordRoot(path)).map(move);
		if (owed.some(path => path === undefined) || canonical([...new Set(owed)].sort()) !== canonical([...new Set(now.paths)].sort())) continue;
		if (!Array.isArray(unit.pages) || unit.pages.some(page => !Number.isSafeInteger(page) || page < 1)) return undefined;
		const refuses = gateRefusal(now.task);
		const carried_from = { round: Number(plan.round), plan_digest: previous.plan_sha256 };
		const checked: Row[] = [];
		for (const row of rows) {
			const listed = Array.isArray(row?.paths), paths = (listed ? row.paths : [row?.path]) as unknown[];
			if (paths.some(path => typeof path === "string" && refuses(row, path))) return undefined;
			const kept = paths.map(move).filter((path): path is string => path !== undefined);
			if (kept.length) checked.push({ ...row, ...(listed ? { paths: kept } : { path: kept[0] }), carried_from });
		}
		return { review: { checked, missing: [] }, pages: [...unit.pages], carried_from };
	}
	return undefined;
}
