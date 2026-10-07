/**
 * Contract §185.12: the reading boundary speaks the book's identifiers.
 *
 * The reading layer (`reading.ts`) names what it reads by the book's own identifiers: it matches a focus against node ids,
 * the book's slugs, names and aliases; its own read-aheads ask by the slug (`handle()` of the library's graph, which no
 * campaign map touches); and a reading's identity (`readingKey`) and the shared library's metadata keep the focus as it was
 * asked. A name-free campaign's handles (§185.4) are none of those, and they differ between campaigns. So a campaign handle
 * crossing into the reading layer becomes the node's book handle (`bookHandle`, the slug a legacy campaign would have sent),
 * and one reading of a node keeps one identity whichever campaign or read-ahead asked; a book identifier coming back out (a
 * read the host echoes, a landing, a settled focus) becomes the campaign's current handle. A legacy campaign crosses
 * unchanged: its handles are the book's.
 *
 * Only this campaign's exact handles cross translated inward: a name, a page range or an index section is the reader's word.
 */
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import type { JsonObject } from '../json.js';
import { loadCampaignModule } from '../read/campaign.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { campaignNodeHandles } from '../read/node-handles.js';
import { row, type Row } from '../read/values.js';

/** The keys whose values are foci: translated on the way in (params) and on the way out (results, refusals). */
const FOCUS_KEYS: ReadonlySet<string> = new Set(['focus', 'scene', 'start_scene']);
const CAMPAIGN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class ReadingBoundary {
    constructor(readonly graph: ModuleGraph) {}
    /**
     * What the reading layer is told for a handle only this campaign has -- a book node's current or interim handle: its book
     * handle. The book's own identifiers (a node id, a slug) and anything else pass as they are; the reader reads those.
     */
    inward<T>(value: T): T | string {
        if (typeof value !== 'string' || !value) return value;
        const nodes = [...this.graph.nodes.values()].filter(node => this.graph.isBookNode(node) && (this.graph.handle(node) === value || this.graph.interimHandle(node) === value));
        return nodes.length === 1 ? this.graph.bookHandle(nodes[0]) : value;
    }
    /** What the campaign is told for a book node's book handle or node id: its current handle. Anything else as it is. */
    outward<T>(value: T): T | string {
        if (typeof value !== 'string' || !value) return value;
        const nodes = [...this.graph.nodes.values()].filter(node => this.graph.isBookNode(node) && (node.node_id === value || this.graph.bookHandle(node) === value));
        return nodes.length === 1 ? this.graph.handle(nodes[0]) : value;
    }
    /** A request's focus keys, inward; a new object. */
    params(params: Row): Row {
        const out: Row = { ...params };
        for (const key of FOCUS_KEYS) if (typeof out[key] === 'string') out[key] = this.inward(out[key]);
        return out;
    }
    /** A result's focus keys at any depth, outward; a new value. */
    result<T>(value: T): T {
        if (Array.isArray(value)) return value.map(item => this.result(item)) as T;
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value as Row).map(([key, item]) =>
            [key, FOCUS_KEYS.has(key) && typeof item === 'string' ? this.outward(item) : this.result(item)])) as T;
    }
    /** A refusal whose details name a focus, with the focus outward; anything else as it is. */
    error(error: unknown): unknown {
        if (!(error instanceof RpcError) || !error.details) return error;
        const details = this.result(error.details) as JsonObject;
        if (JSON.stringify(details) === JSON.stringify(error.details)) return error;
        return new RpcError(error.code, error.message, { fix: error.fix, details, codeDetail: error.codeDetail, retryable: error.retryable, next: error.next });
    }
    /** `action` with its result, or its refusal, translated outward. */
    async out<T>(action: () => Promise<T>): Promise<T> {
        try { return this.result(await action()); }
        catch (error) { throw this.error(error); }
    }
}

/** The boundary a campaign graph crosses with, or null for a legacy one. */
export const graphBoundary = (graph: ModuleGraph): ReadingBoundary | null => graph.nameFree ? new ReadingBoundary(graph) : null;

/** The boundary of a campaign named by id, from its saved world; null for none, a legacy campaign, or a book with no graph yet. */
export async function campaignBoundary(context: KernelContext, campaign: unknown, moduleId: string): Promise<ReadingBoundary | null> {
    if (typeof campaign !== 'string' || !CAMPAIGN_ID.test(campaign) || !await campaignNodeHandles(context, campaign)) return null;
    const path = join(context.campaignsRoot, campaign, 'world.json');
    const world = await context.snapshots.isFile(path) ? row(await context.snapshots.readJson(path)) : {};
    try { return graphBoundary((await loadCampaignModule(context, moduleId, world, campaign)).graph); }
    catch { return null; }
}

/** The focus the reading layer keeps for a node a campaign graph names: its book handle in a name-free campaign, else its handle. */
export const readingFocus = (graph: ModuleGraph, node: Row): string => graph.nameFree && graph.isBookNode(node) ? graph.bookHandle(node) : graph.handle(node);
