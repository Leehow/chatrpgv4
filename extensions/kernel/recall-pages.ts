/** Host-owned source bindings for public recall continuations; no opaque cursor reaches the Keeper. */
import {KernelError} from './client.ts';
type Params = Record<string, unknown>;
const FILTERS = new Set(['what', 'query', 'turns', 'role', 'about', 'kinds', 'include_superseded', 'limit', 'types', 'diff', 'line', 'lines', 'read', 'detail', 'page']);
function stable(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, stable(v)]));
    return value;
}
function key(params: Params): string {
    return JSON.stringify(stable(Object.fromEntries(Object.entries(params).filter(([name]) => FILTERS.has(name)))));
}
function object(value: unknown): Params {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Params : {};
}
function firstPage(params: Params): Params {
    const result = Object.fromEntries(Object.entries(params).filter(([name]) => FILTERS.has(name) && !['read', 'page', 'detail'].includes(name)));
    if (params.read) result.read = {turn: object(params.read).turn, role: object(params.read).role};
    else if (object(params.detail).section || object(params.page).section) result.page = {section: object(params.detail).section ?? object(params.page).section, offset: 0};
    return result;
}
export class RecallPages {
    private readonly issued = new Map<string, string>();
    prepare(params: Params): Params {
        const request = {...params};
        delete request._snapshot;
        const snapshot = this.issued.get(key(request));
        if (snapshot) return {...request, _snapshot: snapshot};
        if (request.detail != null || Number(object(request.page).offset ?? 0) > 0 || Number(object(request.read).offset ?? 0) > 0)
            throw new KernelError({code: 'invalid_params', message: 'This recall continuation has no retained source binding',
                fix: 'Use details.refresh to start at the first recall page again, then use its new read/next reference.',
                details: {reason: 'recall_page_stale', refresh: firstPage(request)}});
        return request;
    }
    accept(result: Params): Params {
        const {_snapshot: snapshot, ...visible} = result;
        if (typeof snapshot !== 'string') return visible;
        const visit = (value: unknown, depth = 0): void => {
            if (!value || typeof value !== 'object' || depth > 12) return;
            if (Array.isArray(value)) {for (const entry of value) visit(entry, depth + 1); return;}
            for (const [name, entry] of Object.entries(value)) {
                const ref = object(entry);
                if ((name === 'next' || name === 'read') && ['transcript', 'memory', 'history'].includes(String(ref.what))) {
                    const identity = key(ref);
                    this.issued.delete(identity);
                    this.issued.set(identity, snapshot);
                    while (this.issued.size > 256) this.issued.delete(this.issued.keys().next().value!);
                }
                visit(entry, depth + 1);
            }
        };
        visit(visible);
        return visible;
    }
    forget(params: Params): void { this.issued.delete(key(params)); }
    diagnostic(error: unknown): unknown {
        if (!(error instanceof KernelError)) return error;
        const body = {code: error.code, message: error.message, fix: error.fix, details: error.details};
        if (Buffer.byteLength(JSON.stringify(body), 'utf8') <= 8192) return error;
        return new KernelError({code: error.code, message: 'Recall returned an oversized diagnostic; no page was delivered',
            fix: 'Begin at the first page with fewer names or a narrower turn range.',
            details: {reason: 'recall_budget', truncated: true}});
    }
}
