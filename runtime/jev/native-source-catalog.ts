/**
 * Exact native-text candidates. The source domain, not this catalog, assigns consultation authority.
 *
 * §191.7: a catalog is of one layer. The native layer reads §22.1's native text (resource
 * `pdf:<sha>:page:<n>:native:<extraction_version>`); the transcript layer reads a page transcript's exact layer, a
 * permutation of the same native lines (resource `pdf:<sha>:page:<n>:transcript:transcript-v1`), with the same strict
 * validation: its `text_sha256` and its revision over the transcript version. `mergeSourceCatalogs` joins one catalog per
 * layer into the catalog a consultation reads; each unit's resource keeps its layer.
 */
import { createHash } from 'node:crypto';
import { ContractError, isPlainRecord, type ScopeBinding, type SourceRef } from './value-contracts.ts';
import { issueSourceRef, splitSourceText, type SourceSnapshot } from './source-ref.ts';
import type { SourceTextSnapshot } from '../../extensions/module/source.ts';
import { TRANSCRIPT_VERSION } from '../../extensions/module/page-transcript.ts';

export type SourceCatalogLayer = 'native' | 'transcript';

export interface NativeTextBundle {
  file_sha256: string;
  extraction_version: string;
  page_count: number;
  snapshots: SourceTextSnapshot[];
  errors: Array<{page: number; code: 'native_extraction_unavailable'}>;
}
export interface NativeSourceUnit { alias: string; page: number; pdfLabel: string | null; text: string; ref: SourceRef }
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
    if (!isPlainRecord(value) || Object.keys(value).some(key => !['page', 'pdf_label', 'text', 'text_sha256', 'revision', 'availability'].includes(key))
      || typeof value.text !== 'string' || value.pdf_label !== null && typeof value.pdf_label !== 'string'
      || value.text_sha256 !== hash(value.text) || value.revision !== hash(JSON.stringify([bundle.extraction_version, bundle.file_sha256, value.page, value.text_sha256]))
      || value.availability !== (value.text.length ? 'text' : 'empty')) fail();
    page(value.page);
    const snapshot: SourceSnapshot = { scope: structuredClone(scope), resource: `pdf:${bundle.file_sha256}:page:${value.page}:${layer}:${bundle.extraction_version}`,
      revision: value.revision, sourceType: 'native_text', text: value.text };
    // Validate even an empty page's binding; it emits no evidence unit.
    issueSourceRef(snapshot, { kind: 'utf16', start: 0, end: 0 });
    snapshots.push(snapshot);
    (value.text.length ? textPages : emptyPages).push(value.page);
    for (const [ordinal, slice] of splitSourceText(value.text).entries()) units.push({ alias: `page:${value.page}:span:${ordinal}`, page: value.page,
      pdfLabel: value.pdf_label, text: value.text.slice(slice.start, slice.end), ref: issueSourceRef(snapshot, {kind: 'utf16', ...slice}) });
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
  pages: Array<{page: number; pdf_label: string | null; layer: SourceCatalogLayer; extraction_version: string; text: string; text_sha256: string; revision: string}>;
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
  const snapshot = (row: LayeredPageText['pages'][number]): SourceTextSnapshot => ({page: row.page, pdf_label: row.pdf_label ?? null, text: row.text,
    text_sha256: row.text_sha256, revision: row.revision, availability: row.text.length ? 'text' : 'empty'});
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
