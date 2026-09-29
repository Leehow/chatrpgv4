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
import { candidateDigest, readReviewPlan, recordRoot, REVIEW_PLAN_FILE, type ReviewPlan } from "./reader-review.ts";
import { REVIEW_VERDICTS, classificationMatcher } from "../../kernel-ts/modules/review-verdicts.ts";
import { advisoryModuleFinding, moduleLogicReview } from "../../kernel-ts/modules/module-review-policy.ts";

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

/** One refused path, as the brief carries it. */
export interface RefusedPath { path: string; root: string; verdict: string; reason: string; source_refs: Row[] }
export type RepairDecision =
	| { kind: "targeted"; refused: RefusedPath[]; roots: string[]; pages: number[] }
	| { kind: "full"; reason: "no_review" | "missing" | "no_refusal" | "not_a_record" | "targeted_refused" };

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

/**
 * The review and plan a previous round wrote for exactly this candidate, from the first of `dirs` that has them. The plan
 * binds both: its candidate digest must be this candidate's and its review digest the review file's, so a review.json
 * anyone else wrote, or one of an earlier candidate, never steers a repair.
 */
export async function reviewOfCandidate(dirs: string[], candidate: Row): Promise<{ dir: string; review: Row; plan: ReviewPlan } | undefined> {
	const wanted = candidateDigest(candidate);
	for (const dir of dirs) {
		try {
			const plan = readReviewPlan(await readFile(join(dir, REVIEW_PLAN_FILE), "utf8"));
			if (!plan || plan.candidate_sha256 !== wanted) continue;
			const bytes = await readFile(join(dir, "review.json"));
			if (sha(bytes) !== plan.review_sha256) continue;
			return { dir, review: JSON.parse(bytes.toString()), plan };
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
	if (review.missing.length) return { kind: "full", reason: "missing" };
	const logic = moduleLogicReview(task), classifies = classificationMatcher(task?.vocabulary?.classification_fields?.node);
	const refused: RefusedPath[] = [];
	for (const row of review.checked) {
		for (const path of Array.isArray(row?.paths) ? row.paths : [row?.path]) {
			if (row?.verdict === "supported") continue;
			if (REVIEW_VERDICTS.includes(row?.verdict) && (logic ? advisoryModuleFinding(row) : classifies(path))) continue;
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
