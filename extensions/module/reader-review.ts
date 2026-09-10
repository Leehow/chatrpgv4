/** Independent source reviews share a candidate, never a mutable output or context. */
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readerInput, type ReaderRequest, type ReaderOutcome } from "./reader.ts";

type Row = Record<string, any>;
function numeric(value: any, path: string): string[] {
	if (typeof value === "number") return [path];
	if (Array.isArray(value)) return value.flatMap((v, i) => numeric(v, `${path}/${i}`));
	if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) =>
		numeric(v, `${path}/${k.replaceAll("~", "~0").replaceAll("/", "~1")}`));
	return [];
}

export function reviewUnits(draft: Row): string[][] {
	const groups = new Map<string, Set<string>>();
	for (const collection of ["nodes", "claims"]) for (const [i, row] of (draft[collection] ?? []).entries()) {
		const path = `/${collection}/${i}`;
		groups.set(path, new Set([path, ...(collection === "nodes" ? numeric(Object.fromEntries(
			Object.entries(row.properties ?? {}).filter(([k]) => k !== "image_sources")), path + "/properties") : [])]));
	}
	for (const path of draft.critical ?? []) {
		const parent = [...groups.keys()].find(p => path === p || path.startsWith(p + "/"));
		if (parent) groups.get(parent)!.add(path);
		else groups.set(path, new Set([path]));
	}
	const batches: {pages: string; paths: string[]; records: number; bytes: number}[] = [];
	for (const [root, pointers] of groups) {
		const [, collection, ordinal] = root.split('/');
		const record = draft[collection]?.[Number(ordinal)];
		const pages = [...new Set<number>((record?.source_refs ?? []).map((ref: Row) => ref.page)
			.filter((page: any) => Number.isInteger(page) && page > 0))].sort((a,b) => a-b).join(',');
		const bytes = Buffer.byteLength(JSON.stringify(record ?? null));
		const previous = pages && batches.find(batch => batch.pages === pages && batch.records < 8
			&& batch.bytes + bytes <= 24_000 && batch.paths.length + pointers.size <= 256);
		if (previous) { previous.paths.push(...pointers); previous.records++; previous.bytes += bytes; }
		else batches.push({pages, paths:[...pointers], records:1, bytes});
	}
	return batches.map(batch => batch.paths);
}

/** Transport completeness; semantic rejection is preserved for the publication gate. */
export function checkReviewEvidence(review: Row, paths: string[], pages: Set<number>) {
	if (!Array.isArray(review?.checked) || !Array.isArray(review?.missing)) throw new Error("invalid source review");
	const checked = new Set<string>();
	for (const row of review.checked) {
		if (!Array.isArray(row?.source_refs) || !row.source_refs.length || row.source_refs.some((ref: Row) => !pages.has(ref.page)))
			throw new Error("review cites a page not supplied to this reviewer");
		for (const path of row.paths ?? [row.path]) checked.add(path);
	}
	if (paths.some(path => !checked.has(path))) throw new Error("review omitted assigned fields");
}

const reviewProtocol = 'source-review-groups-v3';
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function canonical(value: any): string {
	if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
	if (value && typeof value === 'object') return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort()
		.map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
	return JSON.stringify(value);
}
function approved(review: Row, guidance: boolean): boolean {
	return review.missing.length === 0 && review.checked.every((item: Row) => item.verdict === 'supported')
		&& (!guidance || (review.guidance?.approved === true && review.guidance?.issues?.length === 0));
}
async function cachedReview(file: string, key: string, paths: string[], guidance: boolean): Promise<{review: Row; pages:number[]; evidence:string} | undefined> {
	try {
		const entry = JSON.parse(await readFile(file,'utf8'));
		if (entry.key !== key || entry.protocol !== reviewProtocol || typeof entry.evidence_path !== 'string') return;
		const bytes = await readFile(entry.review_path), images = await readFile(entry.images_path), proof = await readFile(entry.evidence_path);
		if (digest(bytes) !== entry.review_sha256 || digest(images) !== entry.images_sha256 || digest(proof) !== entry.evidence_sha256) return;
		const review = JSON.parse(bytes.toString()), pages = JSON.parse(proof.toString()).pages;
		if (!Array.isArray(pages) || pages.some((page: any) => !Number.isInteger(page) || page < 1)) return;
		checkReviewEvidence(review, paths, new Set(pages));
		if (approved(review, guidance)) return {review, pages, evidence:entry.review_path};
	} catch { /* A missing or modified original proof is a cache miss. */ }
}
async function retainReview(file: string, key: string, reviewPath: string, imagesPath: string, pages: Set<number>) {
	await mkdir(join(file,'..'),{recursive:true});
	const evidencePath = join(reviewPath,'..','observed-pages.json');
	await writeFile(evidencePath,JSON.stringify({pages:[...pages]})+'\n');
	const entry = {protocol:reviewProtocol, key, review_path:reviewPath, images_path:imagesPath, evidence_path:evidencePath, evidence_sha256:digest(await readFile(evidencePath)),
		review_sha256:digest(await readFile(reviewPath)), images_sha256:digest(await readFile(imagesPath)), pages:[...pages]};
	const temporary = file + '.' + randomUUID() + '.tmp';
	await writeFile(temporary,JSON.stringify(entry)+'\n'); await rename(temporary,file);
}

export async function reviewCandidate(options: {
	cwd: string; task: Row; draft: Row; instructions: string; round: number;
	model: { id: string; thinking?: string }; source: { pdf: string; cache: string; file_sha256?: string }; signal: AbortSignal;
	cacheRoot?: string; reviewVersion?: string;
	run: (request: ReaderRequest) => Promise<ReaderOutcome>;
	record(row: Row): void; progress(row: Row): void;
}): Promise<number[]> {
	const guidanceBytes = options.task.purpose === "guidance" ? await readFile(join(options.cwd, "guidance.json"), "utf8") : undefined;
	const candidateBytes = guidanceBytes ? await readFile(join(options.cwd,"draft.json")) : Buffer.from(JSON.stringify(options.draft));
	const {commands: _commands, ...semanticTask} = options.task;
	const identity = options.cacheRoot && options.source.file_sha256 ? canonical({protocol:reviewProtocol,
		version:options.reviewVersion, source:options.source.file_sha256, draft:options.draft,
		guidance:guidanceBytes, task:semanticTask, model:options.model}) : undefined;
	const units = guidanceBytes ? [reviewUnits(options.draft).flat()] : reviewUnits(options.draft), results: Row[] = [], observed = new Set<number>();
	let next = 0, completed = 0, active = 0;
	const failures: string[] = [];
	const capacity = Math.min(40, units.length);
	await Promise.allSettled(Array.from({ length: capacity }, async () => {
		while (next < units.length && !options.signal.aborted) {
			const index = next++, paths = units[index];
			const key = identity ? digest(identity + canonical(paths)) : undefined;
			const cacheFile = key ? join(options.cacheRoot!,key+'.json') : undefined;
			const cached = cacheFile ? await cachedReview(cacheFile,key!,paths,!!guidanceBytes) : undefined;
			if (cached) {
				results[index] = cached.review; for (const page of cached.pages) observed.add(page); completed++;
				options.record({lane:'reading',phase:'verify',unit:index+1,ms:0,ok:true,reused:true,evidence:cached.evidence,pages:[...cached.pages].sort((a,b)=>a-b)});
				options.progress({stage:'verify',reviewed:completed,review_total:units.length,activeReaders:active});
				continue;
			}
			for (let attempt = 1; attempt <= 2 && !options.signal.aborted; attempt++) {
			const unitRoot = join(options.cwd, `verify-${options.round}`, `unit-${index + 1}`);
			await mkdir(unitRoot, {recursive:true});
			const cwd = await mkdtemp(join(unitRoot, `attempt-${attempt}-`));
			await writeFile(join(cwd, "draft.json"), JSON.stringify(options.draft) + "\n");
			if (guidanceBytes) await writeFile(join(cwd, "guidance.json"), guidanceBytes);
			await writeFile(join(cwd, "task.json"), JSON.stringify({ ...options.task, required_review: paths }) + "\n");
			const imageCalls = new Map<string, Row[]>(), pages = new Set<number>();
			const eventLog = join(cwd, "events.jsonl");
			active++;
			options.record({ lane: "reading", event: "review_concurrency", unit: index + 1, attempt, active, capacity });
			try {
				const run = await options.run({ cwd, model: options.model.id, thinking: options.model.thinking,
					...(guidanceBytes?{imageHistory:4}:{}),
					submission:!!guidanceBytes || options.task.purpose === "opening",
					systemPrompt: options.instructions, source: options.source, signal: options.signal, eventLog,
					brief: (guidanceBytes ? readerInput({task:{...options.task,required_review:paths}, draft:options.draft, guidance:JSON.parse(guidanceBytes)}) : readerInput({task:{...options.task,required_review:paths},draft:options.draft})) + " Independently review only task.required_review against original images using pdf. Keep the full graph as context. Produce checked paths, verdict, source_refs and reason, plus missing (only necessary current material). Never edit the draft. " + (guidanceBytes ? "Also review guidance.json under the Independent review instructions and include guidance:{approved,issues} in the same review. Never modify guidance.json. Pass this small review object directly to submit_reading as your sole final tool call; a separate write followed by submit would waste another model request. " : options.task.purpose === "opening" ? "Pass the review to submit_reading as your sole final tool call; no separate final prose is needed. " : "Write review.json. ") + "Finish this unit and stop.",
					onEvent(event) {
						if (event.type === "tool_execution_end" && !event.isError && event.result?.details?.kind === "source_pages")
							imageCalls.set(event.toolCallId, event.result.details.observations);
					},
				});
				if (!run.ok) throw new Error(run.error || (run.timedOut ? "source reviewer timed out" : run.stderr || "source reviewer failed"));
				const included = (await readFile(eventLog + ".images.jsonl", "utf8")).trim().split("\n")
					.filter(Boolean).flatMap(line => JSON.parse(line).included ?? []);
				for (const id of included) for (const row of imageCalls.get(id) ?? []) pages.add(row.page);
				if (JSON.stringify(JSON.parse(await readFile(join(cwd, "draft.json"), "utf8"))) !== JSON.stringify(options.draft))
					throw new Error("reviewer modified its candidate copy");
				const review = JSON.parse(await readFile(join(cwd, "review.json"), "utf8"));
				if (guidanceBytes && await readFile(join(cwd, "guidance.json"), "utf8") !== guidanceBytes) throw new Error("reviewer modified guidance");
				checkReviewEvidence(review, paths, pages);
				results[index] = review;
				if (cacheFile && approved(review,!!guidanceBytes)) {
					try { await retainReview(cacheFile,key!,join(cwd,'review.json'),eventLog+'.images.jsonl',pages); }
					catch (error) { options.record({lane:'reading',event:'review_cache_unavailable',unit:index+1,detail:String(error)}); }
				}
				for (const page of pages) observed.add(page);
				// `unit` restarts every round; `attempt` and the owning job's `round` (added by the caller) make the row unique, and `pages` says which physical pages this reviewer viewed (#65).
				options.record({ lane: "reading", phase: "verify", unit: index + 1, attempt, ms: run.ms, ok: true, image_reads: pages.size, pages: [...pages].sort((a, b) => a - b) });
				break;
			} catch (failure) {
				if (attempt === 1 && !options.signal.aborted) {
					await writeFile(join(cwd, "failure.json"), JSON.stringify({error: String(failure)}) + "\n");
					continue;
				}
				failures.push(`Review unit ${index + 1}: ${String(failure)}`);
				results[index] = { checked: [], missing: [failures[failures.length - 1]] };
			} finally {
				active--;
			}
			}
			completed++;
			options.progress({ stage: "verify", reviewed: completed, review_total: units.length, activeReaders: active });
		}
	}));
	if (options.signal.aborted) throw new Error("Source review cancelled");
	if (failures.length) {
		await writeFile(join(options.cwd, `verify-${options.round}`, "failures.json"), JSON.stringify(failures) + "\n");
		throw new Error(failures.join("; "));
	}
	if (results.filter(Boolean).length !== units.length) throw new Error("Source review did not complete every unit");
	if(guidanceBytes && (!(await readFile(join(options.cwd,"draft.json"))).equals(candidateBytes)||await readFile(join(options.cwd,"guidance.json"),"utf8")!==guidanceBytes))throw new Error("Source pair changed during review");
	await writeFile(join(options.cwd, "review.json"), JSON.stringify({
		checked: results.flatMap(r => r.checked), missing: results.flatMap(r => r.missing),
		...(guidanceBytes ? {guidance: {...results[0].guidance,
			draft_sha256: createHash("sha256").update(candidateBytes).digest("hex"),
			guidance_sha256: createHash("sha256").update(guidanceBytes).digest("hex")}} : {}),
	}) + "\n");
	return [...observed];
}
