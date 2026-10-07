/**
 * Contract §191.5: the independent identity reviewer's question about two published nodes that one name or one cast row
 * joins. A tool-enabled Pi reader opens both nodes' pages of each pair with the `pdf` tool and answers `same` (one thing in
 * the book) or `different` (two things that share a name); the host checks that it opened a page of every side that has
 * pages before the answers go to the kernel. Nothing here decides sameness: the kernel's trigger only raised the question.
 */
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {readerInput,type ReaderOutcome,type ReaderRequest} from './reader.ts';
import {successfulImageDeliveries} from './reader-image-delivery.ts';
import {IdentityReviewUnavailable} from './visual-identity-review.ts';
import {NODE_IDENTITY_PROTOCOL,nodeIdentityVerdicts} from '../../kernel-ts/modules/node-identity-shape.ts';

type Row = Record<string, any>;
class TransportFailure extends Error {
	constructor(detail: string) { super(detail); this.name = 'TransportFailure'; }
}
/** How many times the reviewer may be lost to the transport, and the waits between those attempts (as §152.4's reviewer). */
const TRANSPORT_RETRIES = 3;
const TRANSPORT_BACKOFF_MS = [2_000, 6_000, 18_000];

function pause(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise(done => {
		if (signal.aborted || ms <= 0) return done();
		const timer = setTimeout(finish, ms);
		function finish() { clearTimeout(timer); signal.removeEventListener('abort', finish); done(); }
		signal.addEventListener('abort', finish, {once: true});
	});
}
const sidePages = (side: Row): number[] => Array.isArray(side?.pages) ? side.pages.filter((page: unknown) => Number.isSafeInteger(page) && Number(page) >= 1) : [];

/**
 * Ask the reviewer about `pairs` (the claim's `node_identity.pairs`) and return the checked answer file the kernel takes as
 * `node_identity_path` (`node-identity.json` in `cwd`, inside the job's attempt) with the physical pages the reviewer opened,
 * delivered on the provider's own record. The reviewer must open a page of each side that has pages and answer every pair
 * once; a slip gets one repair with its reason, a lost transport up to three quiet retries. Anything left unanswered throws
 * `IdentityReviewUnavailable`.
 */
export async function reviewNodeIdentity(options: {
	cwd: string; pairs: Row[]; instructions: string; model: {id: string; thinking?: string};
	source: {pdf: string; cache: string; file_sha256?: string}; signal: AbortSignal;
	run(request: ReaderRequest): Promise<ReaderOutcome>; record(row: Row): void;
	/** Test seam: the waits between transport retries. */
	transportBackoffMs?: number[];
}): Promise<{path: string; pages: number[]}> {
	await mkdir(options.cwd, {recursive: true});
	const backoff = options.transportBackoffMs ?? TRANSPORT_BACKOFF_MS;
	let previousFailure: string | undefined, semanticRetried = false, transportRetries = 0;
	for (let attempt = 1; !options.signal.aborted; attempt++) {
		const cwd = await mkdtemp(join(options.cwd, `attempt-${attempt}-`)), eventLog = join(cwd, 'events.jsonl');
		const task = {protocol: NODE_IDENTITY_PROTOCOL, pairs: options.pairs};
		await writeFile(join(cwd, 'task.json'), JSON.stringify(task, null, 2) + '\n');
		if (previousFailure) await writeFile(join(cwd, 'failure.json'), JSON.stringify({error: previousFailure}) + '\n');
		const viewed = new Map<string, number[]>();
		let retryAfter: number | undefined;
		try {
			const run = await options.run({cwd, model: options.model.id, thinking: options.model.thinking, systemPrompt: options.instructions,
				source: options.source, signal: options.signal, eventLog, submission: false,
				brief: `${readerInput({task})} For every pair in task.pairs, open the pages of both nodes with the pdf tool, answer every pair in identity.json as your instructions say, and stop.`
					+ (previousFailure ? ' Your previous attempt was rejected; failure.json holds the reason.' : ''),
				onEvent(event) {
					if (event.type === 'tool_execution_end' && !event.isError && event.result?.details?.kind === 'source_pages')
						viewed.set(event.toolCallId, (event.result.details.observations ?? []).map((row: Row) => row.page).filter(Number.isSafeInteger));
				}});
			if (!run.ok && !run.timedOut && !options.signal.aborted) throw new TransportFailure(run.error || run.stderr || 'identity reviewer failed');
			if (!run.ok) throw new Error(run.error || (run.timedOut ? 'identity reviewer timed out' : run.stderr || 'identity reviewer failed'));
			// A run that delivered no image at all leaves no delivery log: it opened no page.
			const delivered = await successfulImageDeliveries(eventLog + '.images.jsonl', {file_sha256: options.source.file_sha256 ?? '', cache: options.source.cache})
				.catch(() => ({toolCallIds: new Set<string>(), hostPages: [] as {page: number}[]}));
			const pages = new Set<number>(delivered.hostPages.map(row => row.page));
			for (const [id, seen] of viewed) if (delivered.toolCallIds.has(id)) for (const page of seen) pages.add(page);
			for (const pair of options.pairs)
				for (const side of [pair.a, pair.b]) {
					const own = sidePages(side);
					if (own.length && !own.some(page => pages.has(page)))
						throw new Error(`Open a page of ${String(side.node_id)} (physical pages ${own.join(', ')}) with the pdf tool before answering pair ${String(pair.key)}`);
				}
			let answer: unknown;
			try { answer = JSON.parse(await readFile(join(cwd, 'identity.json'), 'utf8')); }
			catch { throw new Error('Write identity.json with one verdict per pair'); }
			const verdicts = nodeIdentityVerdicts(answer, options.pairs, {complete: true});
			const read = [...pages].sort((a, b) => a - b);
			const path = join(options.cwd, 'node-identity.json');
			await writeFile(path, JSON.stringify({protocol: NODE_IDENTITY_PROTOCOL, verdicts, read_pages: read}, null, 2) + '\n');
			options.record({lane: 'reading', event: 'node_identity', attempt, ms: run.ms, pairs: options.pairs.length, pages: read,
				same: verdicts.filter(verdict => verdict.verdict === 'same').length, different: verdicts.filter(verdict => verdict.verdict === 'different').length});
			return {path, pages: read};
		} catch (failure) {
			// A cancelled reading was not left unanswered by its reviewer: it is stopped, not failed.
			if (options.signal.aborted) throw new Error('Node identity review cancelled');
			const detail = String(failure instanceof Error ? failure.message : failure).slice(0, 500);
			if (failure instanceof TransportFailure && transportRetries < TRANSPORT_RETRIES) {
				retryAfter = backoff[Math.min(transportRetries, backoff.length - 1)] ?? 0;
				transportRetries++;
				options.record({lane: 'reading', event: 'node_identity_transport_retry', attempt, wait_ms: retryAfter, detail});
			} else if (!(failure instanceof TransportFailure) && !semanticRetried) {
				semanticRetried = true;
				previousFailure = detail;
				options.record({lane: 'reading', event: 'node_identity_retry', attempt, detail});
			} else {
				options.record({lane: 'reading', event: 'node_identity', attempt, ok: false, reason: failure instanceof TransportFailure ? 'transport' : 'review', detail});
				throw new IdentityReviewUnavailable(`the node identity review could not answer: ${detail}`);
			}
		}
		if (retryAfter !== undefined) await pause(retryAfter, options.signal);
	}
	throw new Error('Node identity review cancelled');
}
