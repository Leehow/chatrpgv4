/**
 * Contract §152.4: the independent visual reviewer's same-print question. Both crops of each colliding pair are drawn side
 * by side (each map's own regions boxed and numbered), a tool-enabled Pi reviewer reads every preview and answers same
 * print or different prints, and the host checks that it read them before the verdicts go to the kernel. Nothing here
 * decides sameness; geometry only raised the question.
 */
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {sourceAsset,validateBox} from './source.ts';
import {assetAliases} from './map-publication.ts';
import {readerInput,type ReaderOutcome,type ReaderRequest} from './reader.ts';
import {successfulImageDeliveries} from './reader-image-delivery.ts';
import {IDENTITY_PROTOCOL,identityVerdicts} from '../../kernel-ts/modules/visual-identity-shape.ts';

type Row = Record<string, any>;
/** The reviewer could not answer; the job is held and asked again (§152.4), never published as a new node. */
export class IdentityReviewUnavailable extends Error {
	constructor(detail: string) { super(detail); this.name = 'IdentityReviewUnavailable'; }
}
class TransportFailure extends Error {
	constructor(detail: string) { super(detail); this.name = 'TransportFailure'; }
}
/** How many times the reviewer may be lost to the transport, and the waits between those attempts (as `reader-review`). */
const TRANSPORT_RETRIES = 3;
const TRANSPORT_BACKOFF_MS = [2_000, 6_000, 18_000];
/** The largest a side of a preview is drawn, in pixels. */
const SIDE_WIDTH = 1100, SIDE_HEIGHT = 1400;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/**
 * A pair's two sides in the order the preview draws them: A is the published (or earlier) node, B the drafted (or later)
 * one. `correspondence` says whether the reviewer may match regions: only between two published maps.
 */
export function pairSides(pair: Row): {a: Row; b: Row; correspondence: boolean} {
	const published = !!pair.earlier && !!pair.later;
	const a = published ? pair.earlier : pair.published, b = published ? pair.later : pair.drafted;
	if (!a || !b) throw new Error('an identity pair names both of its nodes');
	const regions = (side: Row) => Array.isArray(side.map_regions) && side.map_regions.length > 0;
	return {a, b, correspondence: published && regions(a) && regions(b)};
}
/** The regions of a side drawn on its own crop: those whose source asset is that node. */
function ownRegions(side: Row): Row[] {
	return (Array.isArray(side.map_regions) ? side.map_regions : []).filter((region: Row) => typeof region?.source_asset === 'string'
		&& assetAliases(String(side.node_id)).includes(region.source_asset));
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise(done => {
		if (signal.aborted || ms <= 0) return done();
		const timer = setTimeout(finish, ms);
		function finish() { clearTimeout(timer); signal.removeEventListener('abort', finish); done(); }
		signal.addEventListener('abort', finish, {once: true});
	});
}
/**
 * One preview per pair: crop A on the left and crop B on the right, each scaled into its side, with the regions each map
 * draws on its own crop boxed and numbered (`A1`, `B1`, ...) and listed below by `region_id`. Private to the attempt.
 */
export async function identityPreviews(input: {pairs: Row[]; cwd: string; source: {pdf: string; cache: string}}): Promise<Row[]> {
	const out: Row[] = [];
	for (const [index, pair] of input.pairs.entries()) {
		const {a, b, correspondence} = pairSides(pair), ordinal = index + 1, sides: Row[] = [];
		for (const [letter, side] of [['A', a], ['B', b]] as const) {
			if (!Array.isArray(side.image_sources) || !side.image_sources.length) throw new Error('an identity preview needs both crops');
			const crop = join(input.cwd, `identity-${ordinal}-${letter.toLowerCase()}.png`);
			await sourceAsset(input.source.pdf, input.source.cache, side.image_sources, crop);
			const raster = await loadImage(crop), scale = Math.min(1, SIDE_WIDTH / raster.width, SIDE_HEIGHT / raster.height);
			sides.push({letter, side, raster, width: Math.max(1, Math.round(raster.width * scale)), height: Math.max(1, Math.round(raster.height * scale)),
				regions: ownRegions(side).map((region, n) => ({marker: `${letter}${n + 1}`, region_id: region.region_id, name: region.name, box: validateBox(region.source_box)}))});
		}
		const gap = 40, header = 36, legend = Math.max(...sides.map(side => side.regions.length)) * 26 + 20;
		const width = sides[0].width + gap + sides[1].width, height = header + Math.max(sides[0].height, sides[1].height) + legend;
		const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
		ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
		ctx.font = 'bold 22px sans-serif'; ctx.lineWidth = 3;
		let x = 0;
		for (const side of sides) {
			ctx.fillStyle = '#111111'; ctx.fillText(side.letter, x + 6, 26);
			ctx.drawImage(side.raster, x, header, side.width, side.height);
			ctx.strokeStyle = '#1d4ed8'; ctx.strokeRect(x + 1, header + 1, side.width - 2, side.height - 2);
			ctx.font = 'bold 16px sans-serif';
			for (const [n, region] of side.regions.entries()) {
				const [x0, y0, x1, y1] = region.box;
				ctx.strokeStyle = '#dc2626'; ctx.strokeRect(x + x0 * side.width, header + y0 * side.height, (x1 - x0) * side.width, (y1 - y0) * side.height);
				ctx.fillStyle = '#ffffff'; ctx.fillRect(x + x0 * side.width, header + y0 * side.height, 38, 20);
				ctx.fillStyle = '#b91c1c'; ctx.fillText(region.marker, x + x0 * side.width + 3, header + y0 * side.height + 16);
				ctx.fillText(`${region.marker}: ${String(region.region_id)}`.slice(0, 60), x + 6, header + Math.max(sides[0].height, sides[1].height) + 22 + n * 26, side.width - 12);
			}
			ctx.font = 'bold 22px sans-serif';
			x += side.width + gap;
		}
		const file = `identity-${ordinal}.png`, bytes = canvas.toBuffer('image/png');
		await writeFile(join(input.cwd, file), bytes);
		const view = (side: Row) => ({node_id: side.side.node_id, node_kind: side.side.node_kind, name: side.side.name ?? null, image_sources: side.side.image_sources,
			regions: side.regions.map((region: Row) => ({marker: region.marker, region_id: region.region_id, name: region.name}))});
		out.push({key: pair.key, page: pair.page, file, path: join(input.cwd, file), image_sha256: digest(bytes), correspondence, a: view(sides[0]), b: view(sides[1])});
	}
	return out;
}
/**
 * Ask the reviewer about `pairs` and return the path of the checked verdict file the kernel takes as
 * `identity_review_path` (`identity-review.json` in `cwd`, which must lie inside the job's attempt). The reviewer must
 * read every preview (delivery is checked on the provider's own record) and answer every pair once; a slip gets one
 * repair with its reason, a lost transport up to three quiet retries. Anything left unanswered throws
 * `IdentityReviewUnavailable`.
 */
export async function reviewVisualIdentity(options: {
	cwd: string; pairs: Row[]; instructions: string; model: {id: string; thinking?: string};
	source: {pdf: string; cache: string; file_sha256?: string}; signal: AbortSignal;
	run(request: ReaderRequest): Promise<ReaderOutcome>; record(row: Row): void;
	/** Test seam: the waits between transport retries. */
	transportBackoffMs?: number[];
}): Promise<string> {
	await mkdir(options.cwd, {recursive: true});
	const backoff = options.transportBackoffMs ?? TRANSPORT_BACKOFF_MS;
	let previousFailure: string | undefined, semanticRetried = false, transportRetries = 0;
	for (let attempt = 1; !options.signal.aborted; attempt++) {
		const cwd = await mkdtemp(join(options.cwd, `attempt-${attempt}-`)), eventLog = join(cwd, 'events.jsonl');
		// The previews live in this attempt's own directory: the reviewer is a confined reader, and a
		// preview beside the attempt instead of inside it is a file it may not open (2026-09-29, the
		// installed App's first identity review read nothing and was held). The verdict records each
		// preview relative to `options.cwd`, where the kernel resolves it next to identity-review.json.
		const previews = (await identityPreviews({pairs: options.pairs, cwd, source: options.source}))
			.map(preview => ({...preview, file: relative(options.cwd, preview.path)}));
		const task = {protocol: IDENTITY_PROTOCOL,
			pairs: previews.map(preview => ({key: preview.key, page: preview.page, preview: relative(cwd, preview.path), correspondence: preview.correspondence, a: preview.a, b: preview.b}))};
		await writeFile(join(cwd, 'task.json'), JSON.stringify(task, null, 2) + '\n');
		if (previousFailure) await writeFile(join(cwd, 'failure.json'), JSON.stringify({error: previousFailure}) + '\n');
		const reads = new Map<string, string>(), images = new Set<string>();
		let retryAfter: number | undefined;
		try {
			const run = await options.run({cwd, model: options.model.id, thinking: options.model.thinking, systemPrompt: options.instructions,
				source: options.source, signal: options.signal, eventLog, submission: false,
				brief: `${readerInput({task})} Read every preview in task.pairs with the read tool, answer every pair in identity.json as your instructions say, and stop.`
					+ (previousFailure ? ' Your previous attempt was rejected; failure.json holds the reason.' : ''),
				onEvent(event) {
					if (event.type === 'tool_execution_start' && event.toolName === 'read' && typeof event.args?.path === 'string')
						reads.set(event.toolCallId, resolve(cwd, event.args.path));
					if (event.type === 'tool_execution_end' && !event.isError && event.result?.content?.some((block: Row) => block.type === 'image') && reads.has(event.toolCallId))
						images.add(event.toolCallId);
				}});
			if (!run.ok && !run.timedOut && !options.signal.aborted) throw new TransportFailure(run.error || run.stderr || 'identity reviewer failed');
			if (!run.ok) throw new Error(run.error || (run.timedOut ? 'identity reviewer timed out' : run.stderr || 'identity reviewer failed'));
			const delivered = await successfulImageDeliveries(eventLog + '.images.jsonl', {file_sha256: options.source.file_sha256 ?? '', cache: options.source.cache});
			for (const preview of previews) {
				if (![...images].some(id => delivered.toolCallIds.has(id) && reads.get(id) === preview.path))
					throw new Error(`Read the side-by-side preview with the read tool before answering: ${preview.path}`);
				if (digest(await readFile(preview.path)) !== preview.image_sha256) throw new Error('The reviewer modified a private identity preview');
			}
			let answer: unknown;
			try { answer = JSON.parse(await readFile(join(cwd, 'identity.json'), 'utf8')); }
			catch { throw new Error('Write identity.json with one verdict per pair'); }
			const verdicts = identityVerdicts(answer, options.pairs, {complete: true});
			const byKey = new Map(previews.map(preview => [preview.key, preview]));
			const checked = {protocol: IDENTITY_PROTOCOL, verdicts: verdicts.map(verdict => ({...verdict,
				preview: {file: byKey.get(verdict.key)!.file, image_sha256: byKey.get(verdict.key)!.image_sha256}}))};
			const path = join(options.cwd, 'identity-review.json');
			await writeFile(path, JSON.stringify(checked, null, 2) + '\n');
			options.record({lane: 'reading', event: 'visual_identity', attempt, ms: run.ms, pairs: previews.length,
				same: verdicts.filter(verdict => verdict.verdict === 'same').length, different: verdicts.filter(verdict => verdict.verdict === 'different').length});
			return path;
		} catch (failure) {
			// A cancelled reading was not left unanswered by its reviewer: it is not held, it is stopped.
			if (options.signal.aborted) throw new Error('Visual identity review cancelled');
			const detail = String(failure instanceof Error ? failure.message : failure).slice(0, 500);
			if (failure instanceof TransportFailure && !options.signal.aborted && transportRetries < TRANSPORT_RETRIES) {
				retryAfter = backoff[Math.min(transportRetries, backoff.length - 1)] ?? 0;
				transportRetries++;
				options.record({lane: 'reading', event: 'identity_transport_retry', attempt, wait_ms: retryAfter, detail});
			} else if (!(failure instanceof TransportFailure) && !semanticRetried && !options.signal.aborted) {
				semanticRetried = true;
				previousFailure = detail;
				options.record({lane: 'reading', event: 'identity_retry', attempt, detail});
			} else {
				options.record({lane: 'reading', event: 'visual_identity', attempt, ok: false, reason: failure instanceof TransportFailure ? 'transport' : 'review', detail});
				throw new IdentityReviewUnavailable(`the visual identity review could not answer: ${detail}`);
			}
		}
		if (retryAfter !== undefined) await pause(retryAfter, options.signal);
	}
	throw new Error('Visual identity review cancelled');
}
