/**
 * KIC-03 deterministic workspace selector (contract §19.2). Consumes one `table.workspace.read`
 * snapshot and produces the transport-only `coc-workspace` message for the current binding —
 * or a precise omission reason. No I/O, no clock, no randomness: the same snapshot, binding and
 * budget always select the same message.
 *
 * The manifest is reference-only. What is projected is where verified material lives — a source
 * locator or a committed record turn — never a body, a hash, a cache path or a claimed truth.
 * The message says so; the current capsule, the player's words and a fresh lookup stay superior.
 */
import {customMessage, object, sizeOf, WORKSPACE_TYPE, type ContextBinding, type Row} from '../context-policy.ts';
import type {WorkpadView} from './workpad-store.ts';

/** The KIC ceiling. The package's own budget is clamped to this, never raised above it. */
export const WORKSPACE_CEILING_BYTES = 24 * 1024;
export type WorkspaceMode = 'off' | 'shadow' | 'on';

const ORDERED_AUTHORITIES = ['module_source', 'campaign_adaptation', 'table_record'] as const;
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const complete = (value: unknown): boolean => value === 'complete'
    || (value !== null && typeof value === 'object' && (value as Row).status === 'complete');
const nonNegative = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

/**
 * The mode is the package's own scalar setting, read from the capsule the host already holds.
 * No package, no settings or any unknown value is `off`: nothing is read, nothing is injected.
 */
export function workspaceModeOf(capsule: Row | undefined): WorkspaceMode {
    const instructions = Array.isArray(object(object(capsule).mods).instructions)
        ? object(object(capsule).mods).instructions as readonly unknown[] : [];
    for (const entry of instructions) {
        const row = object(entry);
        if (row.mod !== 'keeper-context') continue;
        const mode = object(row.settings).mode;
        return mode === 'shadow' || mode === 'on' ? mode : 'off';
    }
    return 'off';
}

/** The package's byte budget for one workspace message, clamped into [0, KIC ceiling]. */
export function workspaceBudgetOf(capsule: Row | undefined): number {
    const instructions = Array.isArray(object(object(capsule).mods).instructions)
        ? object(object(capsule).mods).instructions as readonly unknown[] : [];
    for (const entry of instructions) {
        const row = object(entry);
        if (row.mod !== 'keeper-context') continue;
        const requested = object(row.settings).workspace_bytes;
        if (!Number.isSafeInteger(requested) || requested < 0) return WORKSPACE_CEILING_BYTES;
        return Math.min(requested, WORKSPACE_CEILING_BYTES);
    }
    return WORKSPACE_CEILING_BYTES;
}

export type WorkspaceSelection =
    | {status: 'selected'; message: Row; counts: {
        packed: {static: number; records: number}; filtered: {static: number; records: number};
        omitted: {static: {manifest: number; budget: number}; records: {manifest: number; budget: number}};
        workpad: {packed: number; omitted: number};
        truncated: boolean}}
    | {status: 'omitted'; reason: string};

const byText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

const WORKPAD_NOTE = 'Your own working notes from earlier successful deliveries. They are advisory and never facts, receipts, obligations or authority; an entry marked needs_recheck was written under a state that has since moved, so re-verify it against the current snapshot before you rely on it.';

/**
 * The Keeper's own items, marked by the binding they were published under: the same state stamp
 * is `current`, anything else is `stale` and says so. Current entries lead, stale follow, and
 * within each group the order is by publish turn then item name — deterministic per store view.
 */
function workpadEntries(view: WorkpadView, stateStamp: unknown): Row[] {
    const stamp = typeof stateStamp === 'string' ? stateStamp : '';
    return view.entries.map(entry => ({id: entry.id, kind: entry.kind, status: entry.status, text: entry.text,
            evidence: [...entry.evidence], turn: entry.turn,
            ...(entry.stateStamp === stamp ? {validity: 'current'} : {validity: 'stale', needs_recheck: true})}))
        .sort((left, right) => (left.validity === right.validity ? 0 : left.validity === 'current' ? -1 : 1)
            || left.turn - right.turn || byText(left.id, right.id));
}

/**
 * One admissible reference reduces to names only: locator, kind, record turn, authority and
 * coverage. Anything else the manifest carries — ids, identity digests, source revisions, scopes
 * — stays host-side; none of it is model-facing (contract §19.2).
 */
function projected(ref: Row, kind: string): Row {
    return {locator: ref.locator, kind, ...(kind === 'record' ? {turn: ref.turn} : {}),
        authority: ref.authority, coverage: 'complete'};
}

/**
 * Hard-filter and pack the snapshot manifest for one binding. A snapshot that is not `valid`, a
 * binding that does not match the prepared context, unchecked authority, a missing state stamp or
 * an envelope that cannot fit its own floor omits the whole message (fail-open); individual
 * references that fail scope, authority or coverage are filtered with counts, never packed.
 */
export function selectWorkspace(input: {snapshot: unknown; binding: ContextBinding; budget: number; workpad?: WorkpadView; rankedLocators?: readonly string[]}): WorkspaceSelection {
    const snapshot = object(input.snapshot);
    if (snapshot.status !== 'valid') return {status: 'omitted', reason: 'snapshot_not_valid'};
    const binding = object(snapshot.binding);
    if (binding.campaign !== input.binding.campaign || binding.worldline !== input.binding.worldline
        || binding.loop !== input.binding.loop || binding.turn !== input.binding.turn
        || binding.source_revision !== input.binding.source_revision) return {status: 'omitted', reason: 'binding_mismatch'};
    if (object(snapshot.authority).checked !== true) return {status: 'omitted', reason: 'authority_unchecked'};
    if (!isText(binding.stateStamp)) return {status: 'omitted', reason: 'state_unverified'};
    const budget = Math.min(Math.max(0, input.budget), WORKSPACE_CEILING_BYTES);
    const coverage = object(snapshot.coverage), manifest = object(snapshot.manifest), candidates = object(snapshot.candidates);
    const staticRefs = Array.isArray(candidates.static) ? candidates.static : manifest.static;
    const recordRefs = Array.isArray(candidates.records) ? candidates.records : manifest.records;
    const staticManifest = nonNegative(object(coverage.static).omitted), recordsManifest = nonNegative(object(coverage.records).omitted);
    let workpadFocus = isText(input.workpad?.focus) ? input.workpad!.focus! : undefined;
    const workpadFocusOriginal = workpadFocus;
    let workpadAll = input.workpad ? workpadEntries(input.workpad, binding.stateStamp) : [];
    const workpadTotal = workpadAll.length;
    const workpadSection = (entries: Row[]): Row => ({...(workpadFocus ? {focus: workpadFocus} : {}), entries,
        ...(entries.length ? {note: WORKPAD_NOTE} : {}),
        ...(workpadAll.length - entries.length > 0 ? {omitted: workpadAll.length - entries.length} : {})});
    const envelope = (evidence: Row[], omitted: Row, filtered: Row, workpad?: Row): Row => ({
        kind: 'coc_workspace', advisory: true, worldline: binding.worldline, loop: binding.loop, turn: binding.turn,
        note: 'Host-selected evidence index for this binding. Advisory locations, not the material: each entry names a verified module source or a committed record; it is not body text and never replaces the current capsule, the player\'s words or a fresh lookup. Read the source or recall the record before you rely on it.',
        evidence, truncated: false, omitted, filtered, ...(workpad ? {workpad} : {})});
    const zero = {static: {manifest: 0, budget: 0}, records: {manifest: 0, budget: 0}};
    // The metadata floor: the message must be able to say what it is and what it omits, or it says nothing.
    if (sizeOf(customMessage(WORKSPACE_TYPE, envelope([], zero, {static: 0, records: 0}))) > budget)
        return {status: 'omitted', reason: 'metadata_floor'};
    let filteredStatic = 0, filteredRecords = 0;
    const admissible: Array<{ref: Row; kind: string; section: 'static' | 'records'}> = [];
    const admit = (refs: readonly unknown[], kind: (ref: Row) => string, section: 'static' | 'records', allowed: readonly string[]): void => {
        for (const value of Array.isArray(refs) ? refs : []) {
            const ref = object(value);
            const ok = isText(ref.locator) && allowed.includes(ref.authority) && complete(ref.coverage)
                && object(ref.scope).campaign === binding.campaign && object(ref.scope).worldline === binding.worldline
                && object(ref.scope).loop === binding.loop
                && (section !== 'records' || Number.isSafeInteger(ref.turn));
            if (!ok) {if (section === 'static') filteredStatic++; else filteredRecords++; continue;}
            admissible.push({ref, kind: kind(ref), section});
        }
    };
    admit(staticRefs, ref => isText(ref.kind) ? ref.kind : 'module', 'static', ['module_source', 'campaign_adaptation']);
    admit(recordRefs, () => 'record', 'records', ['table_record']);
    // Stable source order is the fallback; a validated rerank order is only a preference inside
    // this already-authorized set and never changes scope/authority/coverage.
    const ranked = new Map((input.rankedLocators ?? []).map((locator, index) => [locator, index]));
    const rank = (candidate: {ref: Row; kind: string}): number => ORDERED_AUTHORITIES.indexOf(candidate.ref.authority);
    const preference = (candidate: {ref: Row; kind: string}): number => ranked.has(candidate.ref.locator) ? ranked.get(candidate.ref.locator)! : Number.MAX_SAFE_INTEGER;
    admissible.sort((left, right) => preference(left) - preference(right) || rank(left) - rank(right)
        || (left.kind === 'record' && right.kind === 'record' ? (left.ref.turn as number) - (right.ref.turn as number) : 0)
        || byText(left.ref.locator, right.ref.locator));
    // Omission digits during packing assume every reference still ahead ends up omitted, so each
    // measured attempt is an upper bound of the final message: the final digits can only shrink.
    const suffix = (which: 'static' | 'records'): number[] => {
        const counts = new Array<number>(admissible.length + 1).fill(0);
        for (let index = admissible.length - 1; index >= 0; index--) counts[index] = counts[index + 1] + (admissible[index].section === which ? 1 : 0);
        return counts;
    };
    const suffixStatic = suffix('static'), suffixRecords = suffix('records');
    const seen = new Set<string>(), packed: Row[] = [];
    let packedStatic = 0, packedRecords = 0, budgetStatic = 0, budgetRecords = 0;
    for (let index = 0; index < admissible.length; index++) {
        const candidate = admissible[index];
        if (seen.has(candidate.ref.locator)) continue;
        const attempt = customMessage(WORKSPACE_TYPE, envelope([...packed, projected(candidate.ref, candidate.kind)],
            {static: {manifest: staticManifest, budget: budgetStatic + suffixStatic[index + 1]},
                records: {manifest: recordsManifest, budget: budgetRecords + suffixRecords[index + 1]}},
            {static: filteredStatic, records: filteredRecords}));
        if (sizeOf(attempt) > budget) {if (candidate.section === 'static') budgetStatic++; else budgetRecords++; continue;}
        seen.add(candidate.ref.locator);
        packed.push(projected(candidate.ref, candidate.kind));
        if (candidate.section === 'static') packedStatic++; else packedRecords++;
    }
    const counts = {
        packed: {static: packedStatic, records: packedRecords},
        filtered: {static: filteredStatic, records: filteredRecords},
        omitted: {static: {manifest: staticManifest, budget: budgetStatic}, records: {manifest: recordsManifest, budget: budgetRecords}},
        workpad: {packed: 0, omitted: 0},
        truncated: manifest.truncated === true || staticManifest + recordsManifest + budgetStatic + budgetRecords > 0};
    // Workpad items join after the evidence entries (contract §7 projection order). Each add is
    // measured against the whole message while carrying the pessimistic omission digit, so the
    // final section is never larger than its last successful measurement; the budget skips an
    // item before it ever cuts packed evidence, and whatever is skipped is counted.
    let workpadPacked: Row[] = [];
    const section = (): Row | undefined => workpadPacked.length || workpadFocus !== undefined ? workpadSection(workpadPacked) : undefined;
    if (section() && sizeOf(customMessage(WORKSPACE_TYPE,
        {...envelope(packed, counts.omitted, counts.filtered, workpadSection([])), truncated: counts.truncated})) > budget) {
        // Not even the focus line fits: the workpad is omitted whole and counted, evidence stands.
        workpadAll = []; workpadFocus = undefined;
    }
    for (const entry of workpadAll) {
        workpadPacked.push(entry);
        if (sizeOf(customMessage(WORKSPACE_TYPE,
            {...envelope(packed, counts.omitted, counts.filtered, section()), truncated: counts.truncated})) <= budget) continue;
        workpadPacked.pop();
    }
    counts.workpad = {packed: workpadPacked.length,
        omitted: workpadTotal - workpadPacked.length + (workpadFocusOriginal !== undefined && workpadFocus === undefined ? 1 : 0)};
    const message = customMessage(WORKSPACE_TYPE, {...envelope(packed, counts.omitted, counts.filtered, section()), truncated: counts.truncated});
    return {status: 'selected', message, counts};
}
