import {round} from './numeric.ts';
/** Count retained band-shadow rows; unit fixtures never establish live acceptance. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
type Row = Record<string, any>;
export const LANE = 'band-shadow', GATES = [.5, .6, .7, .8], KINDS = ['time', 'damage'], DEFAULT_WORKSPACE = '.coc';
export const telemetry_path = (workspace: string, campaign: string) => join(workspace, 'campaigns', campaign, 'telemetry.jsonl');
const rounded = (v: number) => round(v,3);
export const _rate = (part: number, whole: number) => whole ? rounded(part / whole) : null;
export const _confidence = (r: Row) => typeof r.confidence === 'number' ? r.confidence : 0;
const counts = (a: string[]) => { const out: Row = {}; for (const x of a)
    out[x] = (out[x] ?? 0) + 1; return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))); };
export function load_rows(paths: any[]): Row[] { const out:Row[] = []; for (const path of paths) {
    for (const line of readFileSync(String(path), 'utf8').split(/\r?\n/)) {
        if (!line.trim())
            continue;
        const r = JSON.parse(line);
        if (r && typeof r === 'object' && !Array.isArray(r) && r.lane === LANE)
            out.push(r);
    }
} return out; }
export function summarize_kind(rows: Row[]): Row {
    const unasked = rows.filter(r => !Object.hasOwn(r, 'jev_calls')), asked = rows.filter(r => Object.hasOwn(r, 'jev_calls')), answered = asked.filter(r => r.distribution && typeof r.distribution === 'object' && !Array.isArray(r.distribution)), failed = asked.filter(r => !answered.includes(r)), banded = answered.filter(r => r.band != null), hits = banded.filter(r => r.inside === true), gates: Row = {};
    for (const gate of GATES) {
        const above = banded.filter(r => _confidence(r) >= gate);
        gates[gate.toFixed(1)] = { at_or_above: above.length, rate: _rate(above.length, answered.length), hit_rate: _rate(above.filter(r => r.inside === true).length, above.length) };
    }
    const spent = asked.filter(r => (Number.isInteger(r.jev_calls) || r.jev_calls === true) && r.jev_calls > 0 && (typeof r.ms === 'number' || typeof r.ms === 'boolean')), seconds = spent.reduce((n, r) => n + Number(r.ms), 0) / 1000, tables = [...new Set(rows.filter(r => r.table).map(r => String(r.table)))].sort(), bands = counts(banded.map(r => String(r.band)));
    return { table: tables.length === 1 ? tables[0] : tables.length ? tables : null, rows: rows.length, unasked: counts(unasked.map(r => String(r.skipped || r.reason || 'unstated'))), failed: counts(failed.map(r => String(r.reason || 'unstated'))), answered: answered.length, banded: banded.length, unknown: answered.length - banded.length, hits: hits.length, hit_rate: _rate(hits.length, banded.length), gates, jev_seconds: { calls: spent.length, mean: spent.length ? rounded(seconds / spent.length) : null, total: rounded(seconds) }, bands: Object.fromEntries(Object.entries(bands).sort(([a, x], [b, y]) => y - x || a.localeCompare(b))) };
}
export function report(rows: Row[]): Row { const groups: Row = {}; for (const r of rows)
    (groups[String(r.kind ?? 'None')] ??= []).push(r); const order = [...KINDS.filter(k => Object.hasOwn(groups, k)), ...Object.keys(groups).filter(k => !KINDS.includes(k)).sort()]; return Object.fromEntries(order.map(k => [k, summarize_kind(groups[k])])); }
const pyjson = (v: any) => JSON.stringify(v).replace(/([,:])/g, '$1 ');
export function format_report(result: Row, { title }: {
    title: string;
}) { const lines = ['=== band shadow: ' + title + ' ===']; if (!Object.keys(result).length)
    return lines.concat('no band-shadow rows').join('\n'); for (const [kind, e] of Object.entries(result)) {
    lines.push(`--- ${kind} (${e.table}) ---`, `rows: ${e.rows}  answered: ${e.answered}  banded: ${e.banded}  unknown: ${e.unknown}`);
    if (Object.keys(e.unasked).length)
        lines.push('unasked: ' + pyjson(e.unasked));
    if (Object.keys(e.failed).length)
        lines.push('failed: ' + pyjson(e.failed));
    lines.push(`hit rate (Keeper's number inside the argmax band): ${e.hits}/${e.banded} = ${e.hit_rate}`);
    for (const [gate, r] of Object.entries(e.gates) as [
        string,
        Row
    ][])
        lines.push(`gate ${gate}: at or above ${r.at_or_above} (rate ${r.rate} of answered), hit rate ${r.hit_rate}`);
    lines.push(`jev seconds: ${e.jev_seconds.calls} calls, mean ${e.jev_seconds.mean}, total ${e.jev_seconds.total}`, 'bands: ' + pyjson(e.bands));
} return lines.join('\n'); }
export function main(argv = process.argv.slice(2)): number { const options: Row = { workspace: DEFAULT_WORKSPACE, campaign: [], paths: [] }; for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--all', '--json'].includes(a))
        options[a.slice(2)] = true;
    else if (a === '--workspace')
        options.workspace = argv[++i];
    else if (a === '--campaign')
        options.campaign.push(argv[++i]);
    else
        options.paths.push(a);
} const paths = [...options.paths, ...options.campaign.map((c: string) => telemetry_path(options.workspace, c))]; if (options.all) {
    const dir = join(options.workspace, 'campaigns');
    if (existsSync(dir))
        for (const c of readdirSync(dir).sort()) {
            const p = join(dir, c, 'telemetry.jsonl');
            if (existsSync(p))
                paths.push(p);
        }
} if (!paths.length)
    throw Error('give telemetry files, --campaign, or --all'); const result = report(load_rows(paths)); console.log(options.json ? JSON.stringify({ sources: paths, kinds: result }, null, 2) : format_report(result, { title: options.campaign.length && !options.paths.length && !options.all ? options.campaign.join(', ') : paths.length + ' file(s)' })); return 0; }
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    try {
        process.exitCode = main();
    }
    catch (error) {
        console.error(String(error));
        process.exitCode = 1;
    }
}
