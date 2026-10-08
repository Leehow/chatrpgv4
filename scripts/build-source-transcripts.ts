/**
 * Offline release preparation (contract §191.8): page transcripts for a shipped PDF, made by the same
 * `TranscriptService` a table runs, then copied into `content/source-transcripts/<file_sha256>/` as read-only seeds.
 *
 * Usage: node scripts/build-source-transcripts.ts --pdf FILE --model PROVIDER/ID [--thinking low] [--context-window N]
 *          [--pages A-B,C] [--home EVIDENCE_HOME] [--agent-home DIR] [--out DIR]
 * The evidence home keeps every layout child's work directory; nothing is written into the repository except the
 * copied records under --out (default `content/source-transcripts`).
 */
import {createHash} from 'node:crypto';
import {copyFile, mkdir, readdir, readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TranscriptService} from '../extensions/module/transcript-service.ts';
import {composeRuntimeContext, createRuntime} from '../runtime/host.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const pdfArg = flag('--pdf'), model = flag('--model');
if (!pdfArg || !model) throw new Error('Usage: node scripts/build-source-transcripts.ts --pdf FILE --model PROVIDER/ID [--thinking low] '
	+ '[--context-window N] [--pages A-B,C] [--home EVIDENCE_HOME] [--agent-home DIR] [--out DIR]');
const pdf = resolve(pdfArg);
const thinking = flag('--thinking') ?? 'low';
const contextWindow = Number(flag('--context-window') ?? 0) || undefined;
const home = resolve(flag('--home') ?? join(root, '.tmp', 'source-transcripts-home'));
const out = resolve(flag('--out') ?? join(root, 'content', 'source-transcripts'));
const agentHome = flag('--agent-home') ? resolve(flag('--agent-home')!) : join(root, '.pi', 'coc-agent');

const bytes = await readFile(pdf);
const sha = createHash('sha256').update(bytes).digest('hex');
const host = {resourceRoot: root, contentRoot: join(root, 'content'), agentHome};
const binding = {owner: 'preparation' as const, home};
const context = composeRuntimeContext(binding, host);
const runtime = createRuntime(binding, {...host, ...context});
const outcomes: Record<string, number[]> = {};
const service = new TranscriptService({
	runtime,
	model: () => ({id: model, vision: true, thinking, ...(contextWindow ? {contextWindow} : {})}),
	record: row => {
		if (row.event === 'page') (outcomes[String(row.outcome)] ??= []).push(Number(row.page));
		process.stdout.write(JSON.stringify(row) + '\n');
	},
});
try {
	const info = (await runtime.sourceLines({pdf, pages: [1], expected_file_sha256: sha})) as {page_count: number};
	// `--pages` is a comma list of pages and ranges (`3,7-9`); absent, the whole file.
	const spec = flag('--pages') ?? `1-${info.page_count}`;
	const pages = [...new Set(spec.split(',').flatMap(part => {
		const [a, b] = part.split('-').map(Number), last = b || a;
		if (!Number.isSafeInteger(a) || !Number.isSafeInteger(last) || a < 1 || last > info.page_count || a > last)
			throw new Error(`--pages must lie within 1-${info.page_count}`);
		return Array.from({length: last - a + 1}, (_, index) => a + index);
	}))].sort((x, y) => x - y);
	const result = await service.ensure({pdf, file_sha256: sha, pages, priority: 'foreground'});
	process.stdout.write(JSON.stringify({ensure: result}) + '\n');
	await service.idle();
	const stored = join(home, '.coc', 'source-transcripts', sha);
	const target = join(out, sha);
	await mkdir(target, {recursive: true});
	const names = (await readdir(stored).catch(() => [] as string[])).filter(name => /^page-\d{4}\.json$/.test(name)).sort();
	const wanted = new Set(pages.map(page => `page-${String(page).padStart(4, '0')}.json`));
	let copied = 0;
	for (const name of names) if (wanted.has(name)) { await copyFile(join(stored, name), join(target, name)); copied++; }
	process.stdout.write(JSON.stringify({file_sha256: sha, pages: pages.length, copied, outcomes, target}) + '\n');
	if (copied !== pages.length) process.exitCode = 1;
} finally {
	await service.close();
	await runtime.close();
}
