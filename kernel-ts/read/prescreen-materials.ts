/** Host-only v2 material catalog helpers. Keys navigate one bound response; they are not provenance. */
import {createHash} from 'node:crypto';
import type {Row} from './values.js';
import {array, integer, number, row, string} from './values.js';
import {pythonJsonDumps} from '../json.js';

export const MATERIAL_VIEW_VERSION = 2;
export const materialDigest = (value: unknown): string => createHash('sha256').update(pythonJsonDumps(value as any)).digest('hex');

export function materialKey(kind: string, identity: unknown): string {
    return `${kind}:${materialDigest(identity)}`;
}

export function boundedMaterialBody(value: unknown, read: Row, limit = 16 * 1024): {body?: string; coverage: Row; read: Row} {
    const body = pythonJsonDumps(value as any), bytes = Buffer.byteLength(body, 'utf8');
    if (bytes <= limit) return {body, coverage: {status: 'complete', bytes}, read};
    let excerpt = '';
    for (const char of body) {
        if (Buffer.byteLength(excerpt + char, 'utf8') > limit) break;
        excerpt += char;
    }
    return {body: excerpt, coverage: {status: 'partial', bytes, range: {from: 0, to: Array.from(excerpt).length},
        omitted: ['material_remainder']}, read};
}

/** A source-owned unit is delivered whole or left as an explicit read; it is never string-truncated into a false complete unit. */
export function completeMaterialBody(value: unknown, read: Row, coverage: Row = {}, limit = 4096): {body?: string; coverage: Row; read: Row} {
    const body = pythonJsonDumps(value as any), bytes = Buffer.byteLength(body, 'utf8');
    if (bytes <= limit) return {body, coverage: {...coverage, status: coverage.status ?? 'complete', bytes}, read};
    const omitted = [...new Set([...(Array.isArray(coverage.omitted) ? coverage.omitted : []), 'unit_body_too_large'])];
    return {coverage: {...coverage, status: 'partial', bytes, omitted,
        unknown: [...new Set([...(Array.isArray(coverage.unknown) ? coverage.unknown : []), 'unit_materialization'])]}, read};
}

export function coverageByFamily(candidates: readonly Row[], inspected: Readonly<Record<string, number>> = {},
    unavailable: Readonly<Record<string, number>> = {}): Row {
    const families = new Set([...Object.keys(inspected), ...Object.keys(unavailable), ...candidates.map(value => string(value.kind))]);
    return Object.fromEntries([...families].sort().map(family => {
        const emitted = candidates.filter(value => value.kind === family).length, seen = inspected[family] ?? emitted;
        return [family, {inspected: seen, emitted, omitted: Math.max(0, seen - emitted), unavailable: unavailable[family] ?? 0,
            status: unavailable[family] && !emitted ? 'unavailable' : emitted < seen ? 'partial' : 'complete'}];
    }));
}

export function materialPage(candidates: readonly Row[], cursorValue: unknown, limitValue: unknown): Row {
    const cursor = integer(cursorValue) && number(cursorValue) >= 0 ? number(cursorValue) : 0;
    const limit = integer(limitValue) && number(limitValue) > 0 ? Math.min(128, number(limitValue)) : 64;
    const page = candidates.slice(cursor, cursor + limit);
    return {candidates: page, next: cursor + page.length < candidates.length ? cursor + page.length : null};
}

/** Deterministic family rotation prevents one wide material family from consuming the whole first page. */
export function interleaveMaterials(groups: readonly (readonly Row[])[]): Row[] {
    const result: Row[] = [];
    for (let index = 0; groups.some(group => index < group.length); index++)
        for (const group of groups) if (group[index]) result.push(group[index]);
    return result;
}

/** Keep a small coherent source front per entity before paging deeper into any one entity. */
export function coherentGraphMaterials(groups:readonly (readonly Row[])[]):Row[] {
    const fronts:Row[]=[],tails:Row[][]=[];
    for(const group of groups){
        const selected=new Set<Row>();
        for(const kind of ['identity','authored','relations']){
            const unit=group.find(candidate=>string(row(row(candidate.coverage).unit).kind).split(':')[0]===kind);
            if(unit){fronts.push(unit);selected.add(unit);}
        }
        tails.push(group.filter(candidate=>!selected.has(candidate)));
    }
    return [...fronts,...interleaveMaterials(tails)];
}

export function semanticGraphValue(value: unknown, names: ReadonlyMap<string, string>): unknown {
    if (Array.isArray(value)) return value.map(item => semanticGraphValue(item, names));
    if (!value || typeof value !== 'object') return typeof value === 'string' && names.has(value) ? names.get(value)! : value;
    const source = row(value), result: Row = {};
    for (const [key, item] of Object.entries(source)) {
        if (['asset_ref', 'image_ref', 'runtime_projection', 'source_refs'].includes(key)) continue;
        result[key] = semanticGraphValue(item, names);
    }
    return result;
}

export function sourceRefsOf(value: Row): Row[] {
    return array(value.source_refs).map(ref => row(structuredClone(ref)));
}
