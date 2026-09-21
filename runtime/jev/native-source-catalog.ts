/** Exact native-text candidates. The source domain, not this catalog, assigns consultation authority. */
import { createHash } from 'node:crypto';
import { ContractError, isPlainRecord, type ScopeBinding, type SourceRef } from './value-contracts.ts';
import { issueSourceRef, splitSourceText, type SourceSnapshot } from './source-ref.ts';
import type { SourceTextSnapshot } from '../../extensions/module/source.ts';

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
}
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function fail(): never { throw new ContractError('invalid_native_source_snapshot'); }
export function nativeSourceCatalog(scope: ScopeBinding, bundle: NativeTextBundle, expectedSha256: string): NativeSourceCatalog {
  if (!isPlainRecord(bundle) || Object.keys(bundle).some(key => !['file_sha256', 'extraction_version', 'page_count', 'snapshots', 'errors'].includes(key))
    || !sha(expectedSha256) || bundle.file_sha256 !== expectedSha256 || !Number.isSafeInteger(bundle.page_count) || bundle.page_count < 1
    || typeof bundle.extraction_version !== 'string' || !bundle.extraction_version || !Array.isArray(bundle.snapshots) || !Array.isArray(bundle.errors)) fail();
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
    const snapshot: SourceSnapshot = { scope: structuredClone(scope), resource: `pdf:${bundle.file_sha256}:page:${value.page}:native:${bundle.extraction_version}`,
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
    coverage: { textPages, emptyPages, errorPages, omittedPages: Array.from({length: bundle.page_count}, (_, index) => index + 1).filter(page => !seen.has(page)) } };
}
