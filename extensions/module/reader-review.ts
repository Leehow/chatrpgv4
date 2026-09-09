/** Independent source reviews share a candidate, never a mutable output or context. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
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
	return [...groups.values()].map(paths => [...paths]);
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

export async function reviewCandidate(options: {
	cwd: string; task: Row; draft: Row; instructions: string; round: number;
	model: { id: string; thinking?: string }; source: { pdf: string; cache: string }; signal: AbortSignal;
	run: (request: ReaderRequest) => Promise<ReaderOutcome>;
	record(row: Row): void; progress(row: Row): void;
}): Promise<number[]> {
	const guidanceBytes = options.task.purpose === "guidance" ? await readFile(join(options.cwd, "guidance.json"), "utf8") : undefined;
	const candidateBytes = guidanceBytes ? await readFile(join(options.cwd,"draft.json")) : Buffer.from(JSON.stringify(options.draft));
	const units = guidanceBytes ? [reviewUnits(options.draft).flat()] : reviewUnits(options.draft), results: Row[] = [], observed = new Set<number>();
	let next = 0, completed = 0, active = 0;
	const failures: string[] = [];
	const capacity = Math.min(40, units.length);
	await Promise.allSettled(Array.from({ length: capacity }, async () => {
		while (next < units.length && !options.signal.aborted) {
			const index = next++, paths = units[index];
			for (let attempt = 1; attempt <= 2 && !options.signal.aborted; attempt++) {
			const cwd = join(options.cwd, `verify-${options.round}`, `unit-${index + 1}`, `attempt-${attempt}`);
			await mkdir(cwd, { recursive: true });
			await writeFile(join(cwd, "draft.json"), JSON.stringify(options.draft) + "\n");
			if (guidanceBytes) await writeFile(join(cwd, "guidance.json"), guidanceBytes);
			await writeFile(join(cwd, "task.json"), JSON.stringify({ ...options.task, required_review: paths }) + "\n");
			const imageCalls = new Map<string, Row[]>(), pages = new Set<number>();
			const eventLog = join(cwd, "events.jsonl");
			active++;
			options.record({ lane: "reading", event: "review_concurrency", active, capacity });
			try {
				const run = await options.run({ cwd, model: options.model.id, thinking: options.model.thinking,
					...(guidanceBytes?{imageHistory:4,submission:true}:{}),
					systemPrompt: options.instructions, source: options.source, signal: options.signal, eventLog,
					brief: (guidanceBytes ? readerInput({task:{...options.task,required_review:paths}, draft:options.draft, guidance:JSON.parse(guidanceBytes)}) : "Read task.json and draft.json.") + " Independently review only task.required_review against original images using pdf. Keep the full graph as context. Produce checked paths, verdict, source_refs and reason, plus missing (only necessary current material). Never edit the draft. " + (guidanceBytes ? "Also review guidance.json under the Independent review instructions and include guidance:{approved,issues} in the same review. Never modify guidance.json. Pass this small review object directly to submit_reading as your sole final tool call; a separate write followed by submit would waste another model request. " : "Write review.json. ") + "Finish this unit and stop.",
					onEvent(event) {
						if (event.type === "message_end" && event.message?.errorMessage) throw new Error(event.message.errorMessage);
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
				for (const page of pages) observed.add(page);
				options.record({ lane: "reading", phase: "verify", unit: index + 1, ms: run.ms, ok: true, image_reads: pages.size });
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
