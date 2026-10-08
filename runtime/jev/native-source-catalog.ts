/**
 * Exact native-text candidates. The source domain, not this catalog, assigns consultation authority.
 *
 * §191.7: a catalog is of one layer. The native layer reads §22.1's native text (resource
 * `pdf:<sha>:page:<n>:native:<extraction_version>`); the transcript layer reads a page transcript's exact layer, a
 * permutation of the same native lines (resource `pdf:<sha>:page:<n>:transcript:transcript-v1`), with the same strict
 * validation: its `text_sha256` and its revision over the transcript version. `mergeSourceCatalogs` joins one catalog per
 * layer into the catalog a consultation reads; each unit's resource keeps its layer.
 *
 * §196: a transcript page read with its paragraphs has one unit per paragraph (split only past `PARAGRAPH_UNIT_CAP`), each
 * with its section; a paragraph broken by a page break is linked to its other half when the catalog holds both pages. A
 * page without paragraphs -- native text, or a record whose blocks could not be recovered -- keeps today's slices.
 */
import { createHash } from 'node:crypto';
import { ContractError, isPlainRecord, type ScopeBinding, type SourceRef } from './value-contracts.ts';
import { issueSourceRef, splitSourceText, type SourceSnapshot } from './source-ref.ts';
import type { SourceTextSnapshot } from '../../extensions/module/source.ts';
import { TRANSCRIPT_VERSION } from '../../extensions/module/page-transcript.ts';
import type { TranscriptParagraph } from '../../extensions/module/source-page-text.ts';
import { paragraphSlices } from '../../extensions/module/transcript-paragraphs.ts';

export type SourceCatalogLayer = 'native' | 'transcript';

/** A page's text as a catalog reads it; a transcript page may carry its paragraphs (§196). */
export type CatalogTextSnapshot = SourceTextSnapshot & { paragraphs?: TranscriptParagraph[] };
export interface NativeTextBundle {
  file_sha256: string;
  extraction_version: string;
  page_count: number;
  snapshots: CatalogTextSnapshot[];
  errors: Array<{page: number; code: 'native_extraction_unavailable'}>;
}
/** §196.3: the page a broken paragraph runs on to (or comes from), and that page's unit when the catalog holds it. */
export interface UnitLink { page: number; alias?: string }
export interface NativeSourceUnit {
  alias: string;
  page: number;
  pdfLabel: string | null;
  text: string;
  ref: SourceRef;
  /** §196.2: a transcript paragraph's heading path (the page's headings over the path carried into its top). */
  section?: string[];
  /** §196.3: this unit's paragraph runs on to the next page's first unit. */
  continues?: UnitLink;
  /** §196.3: this unit continues the previous page's last body unit. */
  continuedFrom?: UnitLink;
}
export interface NativeSourceCatalog {
  fileSha256: string;
  extractionVersion: string;
  pageCount: number;
  snapshots: SourceSnapshot[];
  units: NativeSourceUnit[];
  coverage: { textPages: number[]; emptyPages: number[]; errorPages: number[]; omittedPages: number[] };
  /** §191.7: the layers this catalog reads, each with its extraction version. */
  layers?: Partial<Record<SourceCatalogLayer, string>>;
}
/** The layer a catalog snapshot or ref reads, from the resource this module mints. */
export function sourceLayerOf(resource: string): SourceCatalogLayer {
  return resource.split(':')[4] === 'transcript' ? 'transcript' : 'native';
}
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function fail(): never { throw new ContractError('invalid_native_source_snapshot'); }
const PARAGRAPH_KEYS = ['start', 'end', 'kind', 'section', 'continues', 'continued_from'];
/** §196: ordered, disjoint, non-empty stretches of the page's own text, each with a heading path; one forward and one back link at most. */
function validParagraphs(value: unknown, text: string): value is TranscriptParagraph[] {
  if (!Array.isArray(value)) return false;
  let cursor = 0, forward = 0, backward = 0;
  for (const row of value) {
    if (!isPlainRecord(row) || Object.keys(row).some(key => !PARAGRAPH_KEYS.includes(key)) || !Number.isSafeInteger(row.start) || !Number.isSafeInteger(row.end)
      || Number(row.start) < cursor || Number(row.end) <= Number(row.start) || Number(row.end) > text.length || typeof row.kind !== 'string'
      || !Array.isArray(row.section) || row.section.some(heading => typeof heading !== 'string')
      || row.continues !== undefined && row.continues !== true || row.continued_from !== undefined && row.continued_from !== true) return false;
    cursor = Number(row.end);
    if (row.continues) forward++;
    if (row.continued_from) backward++;
  }
  return forward <= 1 && backward <= 1;
}
export function nativeSourceCatalog(scope: ScopeBinding, bundle: NativeTextBundle, expectedSha256: string, layer: SourceCatalogLayer = 'native'): NativeSourceCatalog {
  if (!isPlainRecord(bundle) || Object.keys(bundle).some(key => !['file_sha256', 'extraction_version', 'page_count', 'snapshots', 'errors'].includes(key))
    || !sha(expectedSha256) || bundle.file_sha256 !== expectedSha256 || !Number.isSafeInteger(bundle.page_count) || bundle.page_count < 1
    || typeof bundle.extraction_version !== 'string' || !bundle.extraction_version || !Array.isArray(bundle.snapshots) || !Array.isArray(bundle.errors)
    || (layer === 'transcript') !== (bundle.extraction_version === TRANSCRIPT_VERSION) || layer === 'transcript' && bundle.errors.length) fail();
  const seen = new Set<number>(), snapshots: SourceSnapshot[] = [], units: NativeSourceUnit[] = [];
  const textPages: number[] = [], emptyPages: number[] = [], errorPages: number[] = [];
  const page = (value: number) => {
    if (!Number.isSafeInteger(value) || value < 1 || value > bundle.page_count || seen.has(value)) fail();
    seen.add(value);
  };
  for (const value of bundle.snapshots) {
    if (!isPlainRecord(value) || Object.keys(value).some(key => !['page', 'pdf_label', 'text', 'text_sha256', 'revision', 'availability', 'paragraphs'].includes(key))
      || typeof value.text !== 'string' || value.pdf_label !== null && typeof value.pdf_label !== 'string'
      || value.text_sha256 !== hash(value.text) || value.revision !== hash(JSON.stringify([bundle.extraction_version, bundle.file_sha256, value.page, value.text_sha256]))
      || value.availability !== (value.text.length ? 'text' : 'empty')
      || value.paragraphs !== undefined && (layer !== 'transcript' || !validParagraphs(value.paragraphs, value.text))) fail();
    page(value.page);
    const snapshot: SourceSnapshot = { scope: structuredClone(scope), resource: `pdf:${bundle.file_sha256}:page:${value.page}:${layer}:${bundle.extraction_version}`,
      revision: value.revision, sourceType: 'native_text', text: value.text };
    // Validate even an empty page's binding; it emits no evidence unit.
    issueSourceRef(snapshot, { kind: 'utf16', start: 0, end: 0 });
    snapshots.push(snapshot);
    (value.text.length ? textPages : emptyPages).push(value.page);
    const unit = (ordinal: number, slice: {start: number; end: number}, extra: Partial<NativeSourceUnit> = {}): NativeSourceUnit => ({
      alias: `page:${value.page}:span:${ordinal}`, page: value.page, pdfLabel: value.pdf_label, text: value.text.slice(slice.start, slice.end),
      ref: issueSourceRef(snapshot, {kind: 'utf16', ...slice}), ...extra});
    if (!value.paragraphs) { for (const [ordinal, slice] of splitSourceText(value.text).entries()) units.push(unit(ordinal, slice)); continue; }
    let ordinal = 0;
    for (const paragraph of value.paragraphs) {
      const slices = paragraphSlices(value.text, paragraph.start, paragraph.end);
      for (const [index, slice] of slices.entries()) units.push(unit(ordinal++, slice, {section: [...paragraph.section],
        ...(paragraph.continues && index === slices.length - 1 ? {continues: {page: value.page + 1}} : {}),
        ...(paragraph.continued_from && index === 0 ? {continuedFrom: {page: value.page - 1}} : {})}));
    }
  }
  // §196.3: a broken paragraph's two halves, when both pages are here.
  for (const before of units) {
    if (!before.continues) continue;
    const after = units.find(candidate => candidate.page === before.continues!.page && candidate.continuedFrom);
    if (after) { before.continues.alias = after.alias; after.continuedFrom!.alias = before.alias; }
  }
  for (const error of bundle.errors) {
    if (!isPlainRecord(error) || Object.keys(error).length !== 2 || error.code !== 'native_extraction_unavailable') fail();
    page(error.page); errorPages.push(error.page);
  }
  return { fileSha256: bundle.file_sha256, extractionVersion: bundle.extraction_version, pageCount: bundle.page_count, snapshots, units,
    coverage: { textPages, emptyPages, errorPages, omittedPages: Array.from({length: bundle.page_count}, (_, index) => index + 1).filter(page => !seen.has(page)) },
    layers: { [layer]: bundle.extraction_version } };
}

/**
 * §191.7: one consultation catalog from one catalog per layer of the same file (a page is in at most one), in `order`'s page
 * order. Its `extractionVersion` is the native layer's when it has one; `layers` names each layer's version.
 */
export function mergeSourceCatalogs(catalogs: NativeSourceCatalog[], order: readonly number[]): NativeSourceCatalog {
  if (!catalogs.length) fail();
  if (catalogs.length === 1) return catalogs[0];
  const [first] = catalogs, layers: Partial<Record<SourceCatalogLayer, string>> = {}, seen = new Set<number>();
  for (const catalog of catalogs) {
    if (catalog.fileSha256 !== first.fileSha256 || catalog.pageCount !== first.pageCount) fail();
    for (const [layer, version] of Object.entries(catalog.layers ?? {}) as Array<[SourceCatalogLayer, string]>) { if (layers[layer]) fail(); layers[layer] = version; }
    for (const page of [...catalog.coverage.textPages, ...catalog.coverage.emptyPages, ...catalog.coverage.errorPages]) { if (seen.has(page)) fail(); seen.add(page); }
  }
  const rank = (page: number) => { const at = order.indexOf(page); return at < 0 ? order.length + page : at; };
  const pageOf = (snapshot: SourceSnapshot) => Number(snapshot.resource.split(':')[3]);
  const byOrder = (a: number, b: number) => rank(a) - rank(b);
  return { fileSha256: first.fileSha256, extractionVersion: layers.native ?? first.extractionVersion, pageCount: first.pageCount,
    snapshots: catalogs.flatMap(catalog => catalog.snapshots).sort((a, b) => byOrder(pageOf(a), pageOf(b))),
    units: catalogs.flatMap(catalog => catalog.units).sort((a, b) => byOrder(a.page, b.page)),
    coverage: { textPages: catalogs.flatMap(catalog => catalog.coverage.textPages).sort(byOrder),
      emptyPages: catalogs.flatMap(catalog => catalog.coverage.emptyPages).sort(byOrder),
      errorPages: catalogs.flatMap(catalog => catalog.coverage.errorPages).sort(byOrder),
      omittedPages: Array.from({length: first.pageCount}, (_, index) => index + 1).filter(page => !seen.has(page)) },
    layers };
}

/** §191.7's `sourcePageText` answer, as far as a catalog reads it. */
export interface LayeredPageText {
  file_sha256: string;
  page_count?: number;
  native_extraction_version?: string;
  pages: Array<{page: number; pdf_label: string | null; layer: SourceCatalogLayer; extraction_version: string; text: string; text_sha256: string; revision: string;
    paragraphs?: TranscriptParagraph[]}>;
  errors: Array<{page: number; code: 'native_extraction_unavailable'}>;
}

/**
 * §191.7: a `sourcePageText` answer as one bundle per layer it holds -- native rows and extraction errors in the native
 * bundle, transcript rows in the transcript bundle -- for `nativeSourceCatalog` to validate strictly. A file other than
 * `expectedSha256`, or a page count other than `pageCount`, is a stale source.
 */
export function layeredBundles(read: LayeredPageText, expectedSha256: string, pageCount: number): {native?: NativeTextBundle; transcript?: NativeTextBundle} {
  if (!isPlainRecord(read) || read.file_sha256 !== expectedSha256 || !Array.isArray(read.pages) || !Array.isArray(read.errors)
    || read.page_count !== undefined && read.page_count !== pageCount) throw new ContractError('source_material_stale');
  const snapshot = (row: LayeredPageText['pages'][number]): CatalogTextSnapshot => ({page: row.page, pdf_label: row.pdf_label ?? null, text: row.text,
    text_sha256: row.text_sha256, revision: row.revision, availability: row.text.length ? 'text' : 'empty',
    ...(row.layer === 'transcript' && row.paragraphs ? {paragraphs: row.paragraphs} : {})});
  const native = read.pages.filter(row => row.layer === 'native'), transcript = read.pages.filter(row => row.layer === 'transcript');
  const out: {native?: NativeTextBundle; transcript?: NativeTextBundle} = {};
  if (native.length || read.errors.length) {
    const version = read.native_extraction_version ?? native[0]?.extraction_version;
    if (!version || native.some(row => row.extraction_version !== version)) fail();
    out.native = {file_sha256: expectedSha256, extraction_version: version, page_count: pageCount, snapshots: native.map(snapshot), errors: [...read.errors]};
  }
  if (transcript.length) {
    if (transcript.some(row => row.extraction_version !== TRANSCRIPT_VERSION)) fail();
    out.transcript = {file_sha256: expectedSha256, extraction_version: TRANSCRIPT_VERSION, page_count: pageCount, snapshots: transcript.map(snapshot), errors: []};
  }
  return out;
}

/** One catalog per layer of a layered read, merged in `order`'s page order (a single layer is its own catalog). */
export function layeredSourceCatalog(scope: ScopeBinding, bundles: {native?: NativeTextBundle; transcript?: NativeTextBundle}, expectedSha256: string,
  order: readonly number[]): NativeSourceCatalog {
  const catalogs = [...(bundles.native ? [nativeSourceCatalog(scope, bundles.native, expectedSha256)] : []),
    ...(bundles.transcript ? [nativeSourceCatalog(scope, bundles.transcript, expectedSha256, 'transcript')] : [])];
  return mergeSourceCatalogs(catalogs, order);
}
