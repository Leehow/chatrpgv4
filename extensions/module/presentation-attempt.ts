/** Shared file-attempt mechanics; the owner runner executes and callers decide what to keep. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReaderRequest, ReaderOutcome } from "./reader.ts";

export type PresentationDecision = { done: true } | { done: false; findings: unknown };

export interface PresentationAttemptOptions {
	providerBudget?: ReaderRequest["providerBudget"];
	attempt: string;
	checkSource: string;
	outputFile: string;
	/** Optional raw output snapshot, retained even when JSON parsing fails. */
	outputArtifact?: (round: number) => string;
	/** Record the owner's outcome before failure/cancellation is evaluated. */
	recordOutcome?: (outcome: ReaderOutcome, round: number) => Promise<void>;
	systemPrompt: string;
	model?: string;
	thinking?: string;
	signal?: AbortSignal;
	runner: (request: ReaderRequest) => Promise<ReaderOutcome>;
	/** Write this round's packet and return its brief. */
	prepareRound: (round: number) => Promise<string>;
	/** Validate/accept output; any partial state or persistence belongs to the caller. */
	accept: (value: unknown, round: number) => PresentationDecision | Promise<PresentationDecision>;
	invalidOutput: (error: unknown, round: number) => unknown;
	failure: (outcome: ReaderOutcome, aborted: boolean) => Error;
}

/** Keep every attempt artifact, including final findings when both rounds are exhausted. */
export async function runPresentationAttempt(options: PresentationAttemptOptions): Promise<void> {
	const { attempt } = options;
	await mkdir(attempt, { recursive: true });
	await writeFile(join(attempt, "check.mjs"), options.checkSource);
	for (let round = 1; round <= 2; round++) {
		const brief = await options.prepareRound(round);
		const outcome = await options.runner({
			...(options.providerBudget ? {providerBudget: options.providerBudget} : {}), cwd: attempt, systemPrompt: options.systemPrompt, model: options.model, thinking: options.thinking,
			signal: options.signal, eventLog: join(attempt, `events-${round}.jsonl`), timeoutMs: 120000, brief,
		});
		if (options.recordOutcome) await options.recordOutcome(outcome, round);
		if (!outcome.ok || options.signal?.aborted)
			throw options.failure(outcome, options.signal?.aborted ?? false);
		let value: unknown;
		try {
			const bytes = await readFile(join(attempt, options.outputFile), "utf8");
			if (options.outputArtifact) await writeFile(join(attempt, options.outputArtifact(round)), bytes);
			value = JSON.parse(bytes);
		}
		catch (error) {
			await writeFile(join(attempt, "findings.json"), JSON.stringify(options.invalidOutput(error, round), null, 2));
			continue;
		}
		const decision = await options.accept(value, round);
		if (decision.done) return;
		await writeFile(join(attempt, "findings.json"), JSON.stringify(decision.findings, null, 2));
	}
}
