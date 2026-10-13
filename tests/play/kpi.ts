import {round} from './numeric.ts';
/** Native acceptance metrics over retained telemetry; never synthesizes gameplay. */
export type Row = Record<string, any>;
/** Contract §31.2: count capsule offers and turns that took them. */
export function offers(rows: Row[]): Row {
    const kinds: Record<string, Row> = {};
    let turns = 0;
    for (const row of rows) {
        if (row.lane !== 'offers')
            continue;
        turns++;
        const taken = new Set((row.taken ?? []).map(String));
        for (const name of row.offered ?? []) {
            const kind = String(name).split(':', 1)[0], counts = kinds[kind] ??= { offered: 0, taken: 0 };
            counts.offered++;
            counts.taken += taken.has(String(name)) ? 1 : 0;
        }
    }
    return turns ? { turns_with_offers: turns, by_kind: Object.fromEntries(Object.keys(kinds).sort().map(kind => [kind, { ...kinds[kind], never_taken: kinds[kind].taken === 0 }])) } : {};
}
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const sorted = (value: Row) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: number[]) => sum(a) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const count = (a: any[]) => { const out: Row = {}; for (const x of a)
    out[String(x)] = (out[String(x)] ?? 0) + 1; return sorted(out); };
export const WRITE_TOOLS = new Set(['resolve', 'apply', 'ask', 'narrate']), READ_TOOLS = new Set(['look', 'lookup', 'recall']), HARNESS_TOOLS = new Set(['table.player_input']);
export const DEFAULT_WORKSPACE = '.coc', BASELINE_CAMPAIGN = 'haunting-s0', BASELINE_TURNS = [13, 25];
export const telemetry_path = (workspace: string, campaign: string) => join(workspace, 'campaigns', campaign, 'telemetry.jsonl');
export function load_rows(path: any): Row[] { if (!existsSync(String(path)))
    throw Error('no telemetry.jsonl at ' + path); return readFileSync(String(path), 'utf8').split(/\r?\n/).filter(x => x.trim()).map(x => JSON.parse(x)); }
export function is_tool_call(row: Row) { return !!row.tool && !HARNESS_TOOLS.has(row.tool) && !Object.hasOwn(row, 'event') && !Object.hasOwn(row, 'lane'); }
export function group_by_turn(rows: Row[]): Row { const result: Row = {}; for (const row of rows)
    if (is_tool_call(row) && row.turn != null)
        (result[Number(row.turn)] ??= []).push(row); return result; }
export function turn_metrics(calls: Row[]) { let reads_before_write = 0, reached_write = false; for (const call of calls) {
    if (WRITE_TOOLS.has(call.tool) && call.ok === true) {
        reached_write = true;
        break;
    }
    if (READ_TOOLS.has(call.tool))
        reads_before_write++;
} return { reads_before_write, reached_write, total_calls: calls.length, kernel_errors: calls.filter(c => c.ok === false).length, reached_rules_layer: calls.some(c => c.tool === 'resolve' && c.ok === true) }; }
export const normalize = (name: string) => String(name).normalize('NFKC').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
function turnRecords(workspace: string, campaign: string): Row[] { const dir = join(workspace, 'campaigns', campaign, 'turns'); if (!existsSync(dir))
    return []; const rows:Row[] = []; for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    try {
        rows.push(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    }
    catch { }
} return rows; }
export function present_names(workspace: string, campaign: string): Row { const result: Row = {}; for (const r of turnRecords(workspace, campaign)) {
    if (!Number.isInteger(r.turn) || !r.capsule || typeof r.capsule !== 'object')
        continue;
    const names = new Set((r.capsule.present ?? []).filter((e: Row) => e && typeof e.name === 'string').map((e: Row) => normalize(e.name)));
    if (names.size)
        result[r.turn] = names;
} return result; }
export const redundant_npc_reads = (calls: Row[], here: Set<string>) => calls.filter(c => ['look', 'lookup'].includes(c.tool) && typeof c.about === 'string' && here.has(normalize(c.about))).length;
export function compute(rows: Row[], turns: number[] | null = null, present: Row | null = null): Row { const grouped = group_by_turn(rows), out: Row = {}; for (const t of Object.keys(grouped).map(Number).sort((a, b) => a - b))
    if (!turns || (t >= turns[0] && t <= turns[1]))
        out[t] = turn_metrics(grouped[t]); for (const [turn, here] of Object.entries(present ?? {}))
    if (out[turn])
        Object.assign(out[turn], { npcs_present: (here as Set<string>).size, redundant_npc_reads: redundant_npc_reads(grouped[turn], here as Set<string>), reads_carry_about: grouped[turn].some((c: Row) => ['look', 'lookup'].includes(c.tool) && typeof c.about === 'string') }); return out; }
export function admission(rows: Row[]): Row { const verdicts: Row = {}, unavailable: Row = {}, reviewers: Row = {}; let reviewed = 0, reused = 0, skipped = 0; const ms: number[] = []; const timing = (a: number[]) => ({ total: sum(a), max: a.length ? Math.max(...a) : 0, mean: a.length ? round(mean(a)) : 0 }); for (const row of rows) {
    if (row.lane !== 'admission')
        continue;
    if (row.skipped) {
        skipped++;
        continue;
    }
    if (!row.reused && typeof row.reviewer === 'string') {
        const e = reviewers[row.reviewer] ??= { reviews: 0, unavailable: 0, ms: [], fallbacks: {} };
        e.reviews++;
        if (row.ok === false)
            e.unavailable++;
        if (typeof row.ms === 'number')
            e.ms.push(Math.trunc(row.ms));
        if (typeof row.jev_fallback === 'string')
            e.fallbacks[row.jev_fallback] = (e.fallbacks[row.jev_fallback] ?? 0) + 1;
    }
    if (row.ok === false) {
        const reason = String(row.reason ?? 'unknown');
        unavailable[reason] = (unavailable[reason] ?? 0) + 1;
        continue;
    }
    const verdict = String(row.verdict ?? 'unknown');
    verdicts[verdict] = (verdicts[verdict] ?? 0) + 1;
    if (row.reused)
        reused++;
    else {
        reviewed++;
        if (typeof row.ms === 'number')
            ms.push(Math.trunc(row.ms));
    }
} if (!(reviewed || reused || skipped || Object.keys(unavailable).length))
    return {}; return { reviews: reviewed, reused, skipped, verdicts: sorted(verdicts), unavailable: sorted(unavailable), review_ms: timing(ms), ...(Object.keys(reviewers).length ? { by_reviewer: Object.fromEntries(Object.keys(reviewers).sort().map(name => [name, { reviews: reviewers[name].reviews, unavailable: reviewers[name].unavailable, fallbacks: sorted(reviewers[name].fallbacks), ms: timing(reviewers[name].ms) }])) } : {}) }; }
export function lanes(rows: Row[]): Row { const stats: Row = {}; for (const r of rows) {
    if (typeof r.lane !== 'string' || !Object.hasOwn(r, 'ok'))
        continue;
    const e = stats[r.lane] ??= { rows: 0, failed: 0, worst_streak: 0, _streak: 0, reasons: {} };
    e.rows++;
    if (r.ok === false) {
        e.failed++;
        e._streak++;
        e.worst_streak = Math.max(e.worst_streak, e._streak);
        const why = String(r.reason || 'unstated');
        e.reasons[why] = (e.reasons[why] ?? 0) + 1;
    }
    else
        e._streak = 0;
} for (const e of Object.values(stats)) {
    delete (e as Row)._streak;
    if (!(e as Row).failed)
        delete (e as Row).reasons;
} return sorted(stats); }
export function basis(rows: Row[], workspace: string, campaign: string): Row { const calls = new Set<string>(), clerk_bands: Row = {}, kinds: Row = {}, pins: Row = {}; for (const r of rows) {
    if (r.lane !== 'run' || r.event !== 'bind')
        continue;
    if (r.clerk === 'band_recovery' && r.status === 'succeeded')
        for (const key of ['call_id', 'refused_call_id'])
            if (typeof r[key] === 'string' && r[key])
                calls.add(r[key]);
    if (['declared_time', 'stated_hazard'].includes(r.clerk)) {
        const c = clerk_bands[r.clerk === 'declared_time' ? 'time' : 'damage'] ??= { landed: 0, refused: 0, keeper: 0 };
        c[r.outcome === 'keeper' ? 'keeper' : r.status === 'succeeded' ? 'landed' : 'refused']++;
    }
} for (const record of turnRecords(workspace, campaign))
    for (const r of record.receipts ?? []) {
        if (!r || typeof r !== 'object' || Array.isArray(r))
            continue;
        if (typeof r.kind === 'string' && typeof r.basis === 'string') {
            const c = kinds[r.kind] ??= {};
            c[r.basis] = (c[r.basis] ?? 0) + 1;
        }
        const pin = r.kind === 'npc' && (r.profile || r.archetype) ? 'archetype' : r.kind === 'item' && r.weapon ? 'weapon' : null;
        if (pin)
            (pins[pin] ??= { keeper: 0, banded: 0 })[calls.has(String(r.call_id || '')) ? 'banded' : 'keeper']++;
    } return Object.keys(kinds).length || Object.keys(pins).length || Object.keys(clerk_bands).length ? { by_kind: Object.fromEntries(Object.entries(sorted(kinds)).map(([k, v]) => [k, sorted(v)])), ...(Object.keys(pins).length ? { pins } : {}), ...(Object.keys(clerk_bands).length ? { clerk_bands } : {}) } : {}; }
export function summarize(per_turn: Row): Row { const a = Object.values(per_turn) as Row[]; if (!a.length)
    return { turns: 0 }; let reads = a.map(r => r.reads_before_write); const out: Row = { turns: a.length, reads_before_write_median: median(reads), reads_before_write_mean: round(mean(reads), 3), reads_before_write_max: Math.max(...reads), total_calls_median: median(a.map(r => r.total_calls)), kernel_errors_total: sum(a.map(r => r.kernel_errors)), reached_rules_layer_turns: a.filter(r => r.reached_rules_layer).length, reached_write_turns: a.filter(r => r.reached_write).length }; const npc = a.filter(r => r.npcs_present); if (npc.length) {
    out.turns_with_npcs = npc.length;
    if (npc.some(r => r.reads_carry_about)) {
        reads = npc.map(r => r.redundant_npc_reads);
        out.redundant_npc_reads_median = median(reads);
        out.redundant_npc_reads_total = sum(reads);
    }
    else
        out.redundant_npc_reads_median = 'unmeasurable (telemetry has no `about` column)';
} return out; }
export function skills(rows: Row[], turns: number[] | null = null, campaign: string | null = null): Row {
    const ledger = rows.filter(r => r.lane === 'skills');
    if (!ledger.length)
        return {};
    const identity = (r: Row) => { const owner = r.campaign_id || r.campaign || campaign; return owner && Number.isInteger(r.turn) && typeof r.run_id === 'string' && r.run_id.trim() ? JSON.stringify([owner, r.turn, r.run_id]) : null; };
    const identities = count(ledger.map(identity)), evidence = new Map<string, Row[]>();
    for (const row of rows) {
        const k = identity(row);
        if (k)
            (evidence.get(k) ?? (evidence.set(k, []), evidence.get(k)!)).push(row);
    }
    const rate = (n: number, d: number) => d ? round(n / d, 3) : null;
    const distribution = (values: number[]) => ({ samples: values.length, counts: count(values), min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null, median: values.length ? median(values) : null, mean: values.length ? round(mean(values), 3) : null });
    const timestamp = (v: any) => typeof v === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
    const modelIdentity = (r: Row): [
        string,
        any
    ] => { const name = (v: any) => typeof v === 'string' && !!v.trim(); if (!Object.hasOwn(r, 'provider_models') && !Object.hasOwn(r, 'mixed_provider_model'))
        return name(r.provider) && name(r.model) ? ['single', [r.provider, r.model]] : ['unavailable', null]; const models = r.provider_models, mixed = r.mixed_provider_model; if (!Array.isArray(models) || !models.length || typeof mixed !== 'boolean')
        return ['unavailable', null]; const pairs:any[][] = []; for (const m of models) {
        if (!m || typeof m !== 'object' || !name(m.provider) || !name(m.model) || !Number.isInteger(m.rounds) || m.rounds <= 0)
            return ['unavailable', null];
        pairs.push([m.provider, m.model]);
    } if (new Set(pairs.map(p => JSON.stringify(p))).size !== pairs.length || mixed !== (pairs.length > 1))
        return ['unavailable', null]; if (Object.hasOwn(r, 'provider_rounds') && (!Number.isInteger(r.provider_rounds) || r.provider_rounds !== sum(models.map(m => m.rounds))))
        return ['unavailable', null]; if (mixed)
        return r.provider == null && r.model == null ? ['mixed', null] : ['unavailable', null]; return name(r.provider) && name(r.model) && r.provider === pairs[0][0] && r.model === pairs[0][1] ? ['single', pairs[0]] : ['unavailable', null]; };
    function summarizeRuns(provider: any, model: any, enabled: any, runs: Row[]): Row {
        const offered = count(runs.flatMap(r => r.offered || [])), selected = runs.filter(r => typeof r.selected === 'string' && r.selected), offered_runs = runs.filter(r => r.offered?.length).length, delivery_known = selected.filter(r => typeof r.delivered === 'boolean'), fallback_known = selected.filter(r => typeof r.fallback === 'boolean'), refusal_known = runs.filter(r => Array.isArray(r.refusal_classes));
        const sequences: Row = {};
        for (const r of runs)
            if (Array.isArray(r.tool_names)) {
                const k = JSON.stringify(r.tool_names);
                sequences[k] = (sequences[k] ?? 0) + 1;
            }
        const wall_ms: number[] = [], reviews: Row[] = [];
        let admission_runs = 0;
        for (const run of runs) {
            const key = identity(run);
            if (!key || identities[key] !== 1)
                continue;
            const joined = evidence.get(key)!, review_rows = joined.filter(r => r.lane === 'admission');
            if (review_rows.length) {
                admission_runs++;
                reviews.push(...review_rows);
            }
            const starts = joined.filter(r => r.tool === 'table.player_input' && r.ok === true), ends = joined.filter(r => is_tool_call(r) && ['ask', 'narrate'].includes(r.tool) && r.ok === true);
            if (starts.length === 1 && ends.length === 1 && run.delivered === true) {
                const start = timestamp(starts[0].started_at), end = timestamp(ends[0].started_at), duration = ends[0].ms;
                if (start != null && end != null && typeof duration === 'number' && duration >= 0) {
                    const elapsed = round(end - start + duration);
                    if (elapsed >= 0)
                        wall_ms.push(elapsed);
                }
            }
        }
        const delivered = delivery_known.filter(r => r.delivered).length, fallback = fallback_known.filter(r => r.fallback).length, refused = refusal_known.filter(r => r.refusal_classes.length).length;
        return { provider, model, enabled, rows: runs.length, runs: runs.length, offered_runs, offered, selected_runs: selected.length, selected: count(selected.map(r => r.selected)), invalid_selections: runs.filter(r => r.invalid_selection != null).length, selection_rate: rate(selected.length, offered_runs), delivered_after_selection: { runs: delivered, observed: delivery_known.length, rate: rate(delivered, delivery_known.length) }, fallback_after_selection: { runs: fallback, observed: fallback_known.length, rate: rate(fallback, fallback_known.length) }, refusals: { runs: refused, observed: refusal_known.length, rate: rate(refused, refusal_known.length), classes: count(refusal_known.flatMap(r => r.refusal_classes)) }, provider_rounds: distribution(runs.filter(r => Number.isInteger(r.provider_rounds) && r.provider_rounds >= 0).map(r => r.provider_rounds)), tool_sequences: Object.keys(sequences).sort().map(k => ({ tool_names: JSON.parse(k), runs: sequences[k] })), tool_sequences_unavailable: runs.length - sum(Object.values(sequences)), wall_ms: { source: 'table.player_input.started_at to delivery RPC completion', status: wall_ms.length ? 'available' : 'unavailable', unavailable_runs: runs.length - wall_ms.length, ...distribution(wall_ms) }, admission: { status: admission_runs ? 'available' : 'unavailable', joined_runs: admission_runs, unavailable_runs: runs.length - admission_runs, summary: admission(reviews) } };
    }
    const groups = new Map<string, Row[]>(), mixed_runs: Row[] = [], unavailable_identity_runs: Row[] = [];
    for (const row of ledger) {
        if (turns && (!Number.isInteger(row.turn) || row.turn < turns[0] || row.turn > turns[1]))
            continue;
        const enabled = typeof row.enabled === 'boolean' ? row.enabled : null, [status, pair] = modelIdentity(row);
        if (status === 'single') {
            const key = JSON.stringify([...pair, enabled]);
            (groups.get(key) ?? (groups.set(key, []), groups.get(key)!)).push(row);
            continue;
        }
        const entry = { ...summarizeRuns(null, null, enabled, [row]), campaign: row.campaign_id || row.campaign || campaign, turn: row.turn ?? null, run_id: row.run_id ?? null, provider_models: row.provider_models ?? null, mixed_provider_model: row.mixed_provider_model ?? null, identity_status: status, comparison_eligible: false };
        (status === 'mixed' || row.mixed_provider_model === true ? mixed_runs : unavailable_identity_runs).push(entry);
    }
    const strata:Row[] = [];
    for (const key of [...groups.keys()].sort()) {
        const [provider, model, enabled] = JSON.parse(key), runs = groups.get(key)!, observed = runs.flatMap(r => r.provider_models ?? []);
        strata.push({ ...summarizeRuns(provider, model, enabled, runs), comparison_eligible: enabled != null, provider_models: [{ provider, model, rounds: observed.length ? sum(observed.map(e => e.rounds)) : null }], provider_models_unavailable_runs: runs.filter(r => !Object.hasOwn(r, 'provider_models')).length });
    }
    const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
    const order = (a: Row, b: Row) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b)));
    return { rows: sum(strata.map(s => s.rows)) + mixed_runs.length + unavailable_identity_runs.length, strata, mixed_runs: mixed_runs.sort(order), unavailable_identity_runs: unavailable_identity_runs.sort(order) };
}
const pythonText = (v: any): string => v === true ? 'True' : v === false ? 'False' : v === null ? 'None' : typeof v === 'object' ? JSON.stringify(v) : String(v);
export function format_report(per_turn: Row, summary: Row, { title }: {
    title: string;
}): string { const lines = ['=== ' + title + ' ===']; for (const turn of Object.keys(per_turn).map(Number).sort((a, b) => a - b)) {
    const m = per_turn[turn];
    lines.push(`turn ${String(turn).padStart(3)}: reads_before_write=${String(m.reads_before_write).padEnd(3)} total_calls=${String(m.total_calls).padEnd(3)} kernel_errors=${String(m.kernel_errors).padEnd(2)} reached_rules_layer=${pythonText(m.reached_rules_layer).padEnd(5)} reached_write=${pythonText(m.reached_write)}`);
} lines.push('---'); for (const [k, v] of Object.entries(summary))
    lines.push(k + ': ' + (k === 'skills' ? JSON.stringify(v) : pythonText(v))); return lines.join('\n'); }
export function parse_turns(spec: string): number[] { if (!spec.includes('-'))
    throw Error("--turns must look like 'A-B'"); const [lo, hi] = spec.split('-', 2); if (!/^[+-]?\d+$/.test(lo) || !/^[+-]?\d+$/.test(hi))
    throw Error('invalid turn range'); return [Number(lo), Number(hi)]; }
export function main(argv = process.argv.slice(2)): number { try {
    const options: Row = { workspace: DEFAULT_WORKSPACE };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--baseline')
            options.baseline = true;
        else if (['--campaign', '--turns', '--workspace'].includes(arg))
            options[arg.slice(2)] = argv[++i];
        else
            throw Error('unrecognized argument ' + arg);
    }
    if (!options.baseline && !options.campaign) {
        console.error('--campaign is required unless --baseline is given');
        return 2;
    }
    const campaign = options.baseline ? BASELINE_CAMPAIGN : options.campaign, turns = options.baseline ? BASELINE_TURNS : options.turns ? parse_turns(options.turns) : null, title = options.baseline ? `baseline: ${BASELINE_CAMPAIGN} turns ${BASELINE_TURNS[0]}-${BASELINE_TURNS[1]}` : options.turns ? `${campaign} turns ${options.turns}` : campaign, rows = load_rows(telemetry_path(options.workspace, campaign)), per_turn = compute(rows, turns, present_names(options.workspace, campaign)), summary = summarize(per_turn);
    for (const [key, value] of Object.entries({ offers: offers(rows), admission: admission(rows), skills: skills(rows, turns, campaign), lanes: lanes(rows), basis: basis(rows, options.workspace, campaign) }))
        if (Object.keys(value).length)
            summary[key] = value;
    console.log(format_report(per_turn, summary, { title }));
    return 0;
}
catch (error) {
    console.error(String(error));
    return 1;
} }
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
    process.exitCode = main();
