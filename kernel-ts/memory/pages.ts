/** Bounded recall transport. Original records remain outside these disposable views. */
import {RpcError} from '../errors.js';
import {isJsonObject, pythonJsonDumps, sha256Text} from '../json.js';
import type {CampaignWriter} from '../write/store.js';
import {integer, number, row, string, type Row} from '../read/values.js';

export const RECALL_BYTES = 12 * 1024;
export const RECALL_ROWS = 20;
export const RECALL_CHARS = 4096;
export const RECALL_SECTIONS = ['cards', 'timeline', 'events', 'diff', 'hits'];
const FILTERS = ['what', 'turns', 'role', 'about', 'kinds', 'include_superseded', 'limit', 'types', 'diff', 'line', 'lines'];
export const recallJson = (value: any): string => pythonJsonDumps(value, {compact: true});
export const recallBytes = (value: any): number => Buffer.byteLength(recallJson(value), 'utf8');

export function position(value: any, fallback: number, name: string, positive = false): number {
    if (value == null) return fallback;
    if (!integer(value) || !Number.isSafeInteger(number(value)) || number(value) < (positive ? 1 : 0))
        throw new RpcError('invalid_params', `${name} must be a ${positive ? 'positive' : 'nonnegative'} safe integer`);
    return number(value);
}
export function validateRecallRequest(params: Row): void {
    if (params.query !== undefined && (params.what !== 'memory' || typeof params.query !== 'string' || !params.query.trim()
        || params.query.length > 2048 || params.read != null || params.detail != null || number(row(params.page).offset) > 0))
        throw new RpcError('invalid_params', 'A semantic memory query cannot be combined with direct read/detail or an unissued listing offset');
    const {_snapshot: _binding, campaign: _campaign, ...visible} = params;
    if (recallBytes(visible) > 4096)
        throw new RpcError('invalid_params', 'Recall request metadata is too large', {
            fix: 'Use fewer names or a narrower query before requesting a page.', details: {reason: 'recall_budget'},
        });
}
export function publicRecall(params: Row): Row {
    return Object.fromEntries(FILTERS.filter(key => params[key] !== undefined).map(key => [key, params[key]]));
}
function refreshRecall(params: Row): Row {
    const result = publicRecall(params);
    if (integer(params.read?.turn) && typeof params.read?.role === 'string') result.read = {turn: params.read.turn, role: params.read.role};
    else if (params.detail?.section || params.page?.section) result.page = {section: params.detail?.section ?? params.page.section, offset: 0};
    return result;
}
function closed(value: any, keys: string[], name: string): Row {
    if (value == null) return {};
    if (!isJsonObject(value) || Object.keys(value).some(key => !keys.includes(key)))
        throw new RpcError('invalid_params', `${name} contains an unsupported field`);
    return value;
}
export function pageOptions(params: Row, section: string): {section: string; offset: number; limit: number} {
    const page = closed(params.page, ['section', 'offset', 'limit'], 'page');
    const chosen = page.section ?? section;
    if (!RECALL_SECTIONS.includes(chosen)) throw new RpcError('invalid_params', 'page.section is not a recall section');
    return {section: chosen, offset: position(page.offset, 0, 'page.offset'),
        limit: Math.min(RECALL_ROWS, position(page.limit, RECALL_ROWS, 'page.limit', true))};
}
export function detailOptions(params: Row): Row | null {
    if (params.detail == null) return null;
    const detail = closed(params.detail, ['section', 'index', 'offset', 'limit'], 'detail');
    if (!RECALL_SECTIONS.includes(detail.section) || detail.index == null)
        throw new RpcError('invalid_params', 'detail requires section and index from a recall card');
    return {section: detail.section, index: position(detail.index, 0, 'detail.index'),
        offset: position(detail.offset, 0, 'detail.offset'), limit: position(detail.limit, RECALL_CHARS, 'detail.limit', true)};
}
export async function recallSnapshot(campaign: CampaignWriter, params: Row, source: unknown): Promise<string> {
    const meta = await campaign.readCampaign(), line = string(meta.active_worldline ?? 'main');
    const snapshot = sha256Text(recallJson([1, campaign.id, line, number(row(row(meta.worldlines)[line]).loop), meta.module_id ?? null, source]));
    const continued = params.detail != null || position(row(params.page).offset, 0, 'page.offset') > 0
        || position(row(params.read).offset, 0, 'read.offset') > 0;
    if (params._snapshot != null ? params._snapshot !== snapshot : continued)
        throw new RpcError('invalid_params', 'This recall page no longer has a current source binding', {
            fix: 'Use details.refresh to start at the first page again; use its new read/next reference.',
            details: {reason: 'recall_page_stale', refresh: refreshRecall(params)},
        });
    return snapshot;
}
export function boundedResult(result: Row): Row {
    if (recallBytes(result) > RECALL_BYTES)
        throw new RpcError('invalid_params', 'Recall filters or metadata exceed the response budget', {
            fix: 'Use fewer names or a narrower turn range and begin at the first page.', details: {reason: 'recall_budget'},
        });
    return result;
}
/** Measure the complete serialized envelope, not just its selected text field. */
export function textPage(text: string, offset: number, requested: number, base: Row, next: (offset: number) => Row): Row {
    const points = Array.from(text), total = points.length;
    if (offset > total) throw new RpcError('invalid_params', 'The requested text offset is beyond the original');
    const end = Math.min(total - offset, requested, RECALL_CHARS);
    const make = (count: number): Row => ({...base, text: points.slice(offset, offset + count).join(''),
        total_chars: total, range: {offset, end: offset + count}, truncated: offset > 0 || offset + count < total,
        ...(offset + count < total ? {next: next(offset + count)} : {})});
    let low = 0, high = end;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (recallBytes(make(middle)) <= RECALL_BYTES) low = middle;
        else high = middle - 1;
    }
    if (low === 0 && offset < total) boundedResult(make(1));
    return boundedResult(make(low));
}
/** One stable ordered section per page; oversized rows become explicit detail locators. */
export function rowsPage(rows: Row[], params: Row, section: string, base: Row, field = section): Row {
    const page = pageOptions(params, section);
    if (page.section !== section) throw new RpcError('invalid_params', `This recall mode requires section ${section}`);
    if (page.offset > rows.length) throw new RpcError('invalid_params', 'The requested page is beyond this section');
    const query = publicRecall(params), selected: Row[] = [];
    const make = (): Row => {
        const end = page.offset + selected.length;
        return {...base, [field]: selected, page: {section, offset: page.offset, count: selected.length, total: rows.length},
            truncated: page.offset > 0 || end < rows.length,
            ...(end < rows.length ? {next: {...query, page: {section, offset: end, limit: page.limit}}} : {})};
    };
    for (let index = page.offset; index < rows.length && selected.length < page.limit; index++) {
        selected.push(rows[index]);
        if (recallBytes(make()) <= RECALL_BYTES) continue;
        selected.pop();
        if (selected.length) break;
        const identity: Row = {};
        for (const key of ['type', 'turn', 'kind']) {
            const value = rows[index][key];
            if (typeof value === 'string') identity[key] = Array.from(value).slice(0, 80).join('');
            else if (integer(value) && Number.isSafeInteger(number(value))) identity[key] = number(value);
        }
        selected.push({...identity, index, truncated: true, representation: 'detail_reference',
            total_chars: Array.from(recallJson(rows[index])).length,
            read: {...query, detail: {section, index, offset: 0, limit: RECALL_CHARS}}});
        boundedResult(make());
    }
    return boundedResult(make());
}
export function rowDetail(rows: Row[], params: Row, section: string, base: Row): Row | null {
    const detail = detailOptions(params);
    if (!detail) return null;
    if (detail.section !== section || detail.index >= rows.length)
        throw new RpcError('invalid_params', 'The requested detail is not in this recall section');
    const query = publicRecall(params);
    return textPage(recallJson(rows[detail.index]), detail.offset, detail.limit,
        {...base, representation: 'record_json', detail: {section, index: detail.index}, verification_scope: 'record_integrity_only'},
        offset => ({...query, detail: {...detail, offset}}));
}
