/** Contract §204.4: a committed table place gains the book's exact excerpts through the existing source reader. */
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const PAGES_MAX = 4;
const EXCERPT_CHARS = 1200;
const READER_MS = 120_000;

export interface PlaceBindingDeps {
  campaign: string;
  turn: number;
  moduleId?: string;
  receipts: readonly unknown[];
  reference?: (moduleId: string, params: Row, signal: AbortSignal) => Promise<Row | undefined>;
  call: (method: string, params: Row) => Promise<unknown>;
  record: (row: Row) => unknown;
}

/** One exact source result; neither a generated answer nor an unverified extract is a book binding. */
export function bindingExcerpts(value: unknown): {pages: number[]; excerpt: string} | undefined {
  const answer = object(object(value).source_answer);
  if (answer.authority !== 'original-source-excerpts' || answer.status !== 'excerpts') return;
  const rows = (Array.isArray(answer.excerpts) ? answer.excerpts : []).map(object)
    .filter(row => Number.isSafeInteger(row.page) && Number(row.page) > 0 && text(row.text));
  const pages = [...new Set(rows.map(row => Number(row.page)))].slice(0, PAGES_MAX);
  if (!pages.length) return;
  const excerpt = rows.filter(row => pages.includes(Number(row.page))).map(row => String(row.text)).join('\n\n');
  return {pages, excerpt: Array.from(excerpt).slice(0, EXCERPT_CHARS).join('')};
}

/** Per-session ownership: repeated/idempotent receipt delivery never repeats a reference task. */
export class PlaceBindings {
  private readonly started = new Set<string>();
  start(deps: PlaceBindingDeps): void {
    // table.apply returns receipt names. Their settled bodies come from the private receipt projection, never the proposal.
    const names = deps.receipts.filter((value): value is string => typeof value === 'string');
    if (names.length) { void this.canonical(deps, new Set(names)); return; }
    for (const receipt of deps.receipts.map(object)) {
      const place = text(receipt.to);
      if (receipt.kind !== 'move' || receipt.established !== 'table' || !place) continue;
      const key = JSON.stringify([deps.campaign, place]);
      if (this.started.has(key)) continue;
      this.started.add(key);
      void this.bind(deps, place, text(receipt.to_label) || place);
    }
  }
  private async canonical(deps: PlaceBindingDeps, names: ReadonlySet<string>): Promise<void> {
    try {
      const status = object(await deps.call('table.status', {campaign: deps.campaign, projection: 'receipts', expected_turn: deps.turn}));
      const receipts = (Array.isArray(status.receipts) ? status.receipts : []).map(object).filter(receipt => names.has(text(receipt.id)));
      this.start({...deps, receipts});
    } catch (error) {
      try { await deps.record({lane: 'place-binding', turn: deps.turn, outcome: 'unavailable', reason: 'receipts_unavailable',
        detail: error instanceof Error ? error.message.slice(0, 160) : 'receipt_projection_failed'}); }
      catch { /* telemetry cannot affect a committed move */ }
    }
  }
  private async bind(deps: PlaceBindingDeps, place: string, label: string): Promise<void> {
    const began = Date.now();
    const note = async (fields: Row) => {
      try { await deps.record({lane: 'place-binding', turn: deps.turn, place, ...fields, ms: Date.now() - began}); }
      catch { /* telemetry cannot affect a committed move */ }
    };
    if (!deps.moduleId || !deps.reference) { await note({outcome: 'unavailable', reason: 'no_source_reader'}); return; }
    try {
      const view = object(await deps.call('table.lookup', {campaign: deps.campaign, kind: 'module', query: place, expected_kind: 'scene'}));
      const entities = (Array.isArray(view.entities) ? view.entities : []).map(object);
      const entity = entities.find(row => row.name === place) ?? (entities.length === 1 ? entities[0] : undefined);
      const summary = text(entity?.summary);
      const result = await deps.reference(deps.moduleId, {campaign: deps.campaign, purpose: 'answer', focus: label,
        question: `Where does the book describe this place, and who and what is there? The table established it as: ${summary || label}`},
        AbortSignal.timeout(READER_MS));
      const excerpts = bindingExcerpts(result);
      if (!excerpts) { await note({outcome: 'unbound', reason: 'no_original_excerpts'}); return; }
      const bound = object(await deps.call('table.place.bind', {campaign: deps.campaign, place, ...excerpts}));
      await note({outcome: bound.bound === true ? 'bound' : 'unbound', pages: excerpts.pages,
        ...(typeof bound.reason === 'string' ? {reason: bound.reason} : {})});
    } catch (error) {
      await note({outcome: 'unavailable', reason: error instanceof Error ? error.message.slice(0, 160) : 'source_read_failed'});
    }
  }
}
