/**
 * Contract §187.4: the reading window (§182.3) the module brief orders its rosters by -- the window of the active scene,
 * or, for a scene the table minted, of the book place it stands for (`bookAnchor`, §187.2.1). The same chapters and
 * anchor rule the read-ahead uses; null for a book with no pages (a starter) or one short enough to be read whole, whose
 * brief keeps the graph's order.
 */
import type { KernelContext } from '../context.js';
import { anchorPage, indexChapters, outlineChapters, readingBudget, readingWindow } from '../modules/chapters.js';
import type { LoadedModule } from './campaign.js';
import { RpcError } from '../errors.js';
import { bookAnchor } from './table-entities.js';
import { array, integer, number, row, string, truth, type Row } from './values.js';

export type BriefWindow = { first: number; last: number; chapters: string[] };

/** The 1-based pages a node's `source_refs` cite. */
export function citedPages(node: Row | null | undefined): number[] {
    return array(node?.source_refs).filter(ref => integer(row(ref).pdf_index)).map(ref => number(ref.pdf_index) + 1);
}

export async function briefWindow(context: KernelContext, module: LoadedModule, world: Row): Promise<BriefWindow | null> {
    const meta = module.meta, pageCount = number(meta.page_count);
    if (!integer(meta.page_count) || pageCount < 1) return null;
    const budget = await readingBudget(context);
    if (pageCount <= budget.wholeBookMaxPages) return null;
    const graph = module.graph, scene = graph.find(string(world.active_scene), ['scene']);
    // §204.4: a minted place bound to the book's mention cites the book's pages itself, and the window is anchored there.
    const anchorNode = scene ? (citedPages(scene).length ? scene : bookAnchor(graph, scene)) : null;
    let start: Row | null = null;
    try { start = graph.startScene(); } catch (error) { if (!(error instanceof RpcError)) throw error; }
    const inBook = (pages: number[]) => pages.filter(page => page >= 1 && page <= pageCount);
    const anchor = anchorPage(inBook(citedPages(anchorNode))) ?? anchorPage(inBook(citedPages(start))) ?? 1;
    const outline = outlineChapters(row(meta.source_document).outline, pageCount);
    const chapters = outline.length || !truth(row(meta.reading).index_complete) ? outline : indexChapters(module.sections, pageCount);
    const window = readingWindow(pageCount, chapters, anchor, budget.fallbackWindowPages);
    return { first: window.first, last: window.last, chapters: window.chapters };
}
