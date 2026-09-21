/** Exact host-owned selections; no searching, normalization, authority promotion, or I/O policy. */
import { ContractError, type Json, type ScopeBinding, type SourceRef } from './value-contracts.ts';

export interface SourceSnapshot {
  scope: ScopeBinding;
  resource: string;
  revision: string;
  sourceType: SourceRef['sourceType'];
  text?: string;
  record?: Json;
  allowedFields?: readonly (readonly string[])[];
}
export interface SourceAccess {
  scope: ScopeBinding;
  mode: 'active' | 'historical';
  /** Resolve only an owned resource, never a model-provided filesystem path. */
  read(resource: string, revision: string): SourceSnapshot | undefined;
  currentRevision(resource: string): string | undefined;
}
export type SourceValue = string | number | boolean | null;

function fail(code: string): never { throw new ContractError(code); }
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === null || prototype === Object.prototype) && Reflect.ownKeys(value).every(key =>
    typeof key === 'string' && Object.getOwnPropertyDescriptor(value, key)?.enumerable
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'));
}
function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
function scopeValid(value: unknown): value is ScopeBinding {
  return plain(value) && only(value, ['owner', 'campaign', 'worldline', 'loop', 'audience'])
    && typeof value.owner === 'string' && value.owner.length > 0
    && ['keeper', 'player', 'system'].includes(value.audience as string)
    && ['campaign', 'worldline'].every(key => value[key] === undefined || typeof value[key] === 'string' && value[key].length > 0)
    && (value.loop === undefined || Number.isSafeInteger(value.loop) && Number(value.loop) >= 0);
}
/** Absence is an exact scope component, never a wildcard or a privilege downgrade. */
function sameScope(left: ScopeBinding, right: ScopeBinding): boolean {
  return scopeValid(left) && scopeValid(right) && left.owner === right.owner && left.campaign === right.campaign
    && left.worldline === right.worldline && left.loop === right.loop && left.audience === right.audience;
}
function range(text: string, start: number, end: number): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > text.length)
    fail('invalid_source_range');
  for (const offset of [start, end]) {
    const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) fail('split_surrogate');
  }
}
function pathValid(path: unknown): path is string[] {
  return Array.isArray(path) && path.length > 0 && path.every(segment => typeof segment === 'string'
    && segment.length > 0 && !['__proto__', 'prototype', 'constructor'].includes(segment));
}

function selectedValue(snapshot: SourceSnapshot, selector: SourceRef['selector']): SourceValue {
  if (!plain(selector)) fail('invalid_source_selector');
  if (selector.kind === 'utf16') {
    if (!only(selector, ['kind', 'start', 'end']) || typeof snapshot.text !== 'string') fail('invalid_source_selector');
    range(snapshot.text, selector.start, selector.end);
    return snapshot.text.slice(selector.start, selector.end);
  }
  if (selector.kind !== 'field' || !only(selector, ['kind', 'path']) || !pathValid(selector.path)) fail('invalid_source_selector');
  if (!snapshot.allowedFields?.some(path => path.length === selector.path.length && path.every((segment, i) => segment === selector.path[i])))
    fail('source_field_not_allowed');
  let value: unknown = snapshot.record;
  for (const segment of selector.path) {
    if (Array.isArray(value)) {
      // Closed syntax validation, not semantic classification.
      if (!/^(0|[1-9][0-9]*)$/.test(segment) || Number(segment) >= value.length) fail('source_field_missing');
    } else if (!plain(value)) fail('source_field_missing');
    const descriptor = Object.getOwnPropertyDescriptor(value, segment);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('source_field_missing');
    value = descriptor.value;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  return fail('source_field_not_scalar');
}

export function assertSourceRef(value: unknown): asserts value is SourceRef {
  if (!plain(value) || !only(value, ['version', 'scope', 'resource', 'revision', 'sourceType', 'selector'])
    || value.version !== 1 || !scopeValid(value.scope)
    || typeof value.resource !== 'string' || !value.resource || typeof value.revision !== 'string' || !value.revision
    || !['turn', 'native_text', 'graph', 'record', 'draft'].includes(value.sourceType as string)) fail('invalid_source_ref');
  const selector = value.selector;
  if (!plain(selector)) fail('invalid_source_selector');
  if (selector.kind === 'utf16') {
    if (!only(selector, ['kind', 'start', 'end'])) fail('invalid_source_selector');
    if (!Number.isSafeInteger(selector.start) || !Number.isSafeInteger(selector.end)
      || Number(selector.start) < 0 || Number(selector.end) < Number(selector.start)) fail('invalid_source_range');
  } else if (selector.kind !== 'field' || !only(selector, ['kind', 'path']) || !pathValid(selector.path)) fail('invalid_source_selector');
}

/** Issue from a trusted immutable snapshot and host-calculated coordinates. */
export function issueSourceRef(snapshot: SourceSnapshot, selector: SourceRef['selector']): SourceRef {
  const ref: SourceRef = { version: 1, scope: structuredClone(snapshot.scope), resource: snapshot.resource,
    revision: snapshot.revision, sourceType: snapshot.sourceType, selector: structuredClone(selector) };
  assertSourceRef(ref);
  selectedValue(snapshot, ref.selector);
  return ref;
}

export function resolveSourceRef(ref: SourceRef, access: SourceAccess): SourceValue {
  assertSourceRef(ref);
  if (!sameScope(ref.scope, access.scope)) fail('source_scope_mismatch');
  if (access.mode !== 'active' && access.mode !== 'historical') fail('invalid_source_read_mode');
  if (access.mode === 'active' && access.currentRevision(ref.resource) !== ref.revision) fail('stale_source_ref');
  const snapshot = access.read(ref.resource, ref.revision);
  if (!snapshot) fail('source_revision_unavailable');
  if (snapshot.resource !== ref.resource || snapshot.revision !== ref.revision || snapshot.sourceType !== ref.sourceType
    || !sameScope(snapshot.scope, ref.scope)) fail('source_snapshot_mismatch');
  const value = selectedValue(snapshot, ref.selector);
  // The access implementation may consult mutable stores. Validate again after materialization.
  if (access.mode === 'active' && access.currentRevision(ref.resource) !== ref.revision) fail('stale_source_ref');
  return value;
}

/** Legacy recall offsets count Unicode code points, unlike JavaScript's UTF-16 string indexes. */
export function codePointRangeToUtf16(text: string, start: number, end: number): { start: number; end: number } {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) fail('invalid_code_point_range');
  let index = 0, offset = 0, from: number | undefined, to: number | undefined;
  for (const point of text) {
    if (index === start) from = offset;
    if (index === end) { to = offset; break; }
    offset += point.length;
    index++;
  }
  if (index === start) from ??= offset;
  if (index === end) to ??= offset;
  if (from === undefined || to === undefined) fail('invalid_code_point_range');
  return { start: from, end: to };
}

/** Per-request catalog. The model chooses an ordinal; only the host can recover the coordinates. */
export function sourceRefCatalog(refs: readonly SourceRef[], access: SourceAccess) {
  const pinned = refs.map(ref => structuredClone(ref));
  const candidates = pinned.map((ref, ordinal) => ({ ordinal, value: resolveSourceRef(ref, access) }));
  return {
    candidates,
    select(ordinal: number): { ref: SourceRef; value: SourceValue } {
      if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= pinned.length) fail('unknown_source_ordinal');
      const ref = structuredClone(pinned[ordinal]);
      return { ref, value: resolveSourceRef(ref, access) };
    },
  };
}

/** Closed syntax segmentation shared by committed turns and native source pages. */
const SENTENCE_BOUNDARIES = new Set(['.', '!', '?', '\u3002', '\uff01', '\uff1f']);
const CLOSING_PUNCTUATION = new Set(['"', "'", '”', '’', '»', '\uff09', ')', ']', '\u3011', '}']);
const HORIZONTAL_WHITESPACE = new Set([' ', '\t', '\v', '\f']);

function high(value: number): boolean { return value >= 0xd800 && value <= 0xdbff; }
function low(value: number): boolean { return value >= 0xdc00 && value <= 0xdfff; }
function digit(value: string | undefined): boolean { return value !== undefined && value >= '0' && value <= '9'; }

function sentenceEnd(text: string, punctuation: number, limit: number): number | undefined {
  if (text[punctuation] === '.' && digit(text[punctuation - 1]) && digit(text[punctuation + 1])) return undefined;
  let end = punctuation + 1;
  while (end < text.length && SENTENCE_BOUNDARIES.has(text[end])) end++;
  while (end < text.length && CLOSING_PUNCTUATION.has(text[end])) end++;
  while (end < text.length && HORIZONTAL_WHITESPACE.has(text[end])) end++;
  while (end < text.length && (text[end] === '\r' || text[end] === '\n')) {
    if (text[end] === '\r' && text[end + 1] === '\n') end += 2;
    else end++;
  }
  return end <= limit ? end : undefined;
}

function boundedSourceEnd(text: string, start: number, maximum: number): number {
  let limit = Math.min(text.length, start + maximum);
  if (limit < text.length && high(text.charCodeAt(limit - 1)) && low(text.charCodeAt(limit))) limit--;
  if (limit < text.length && text[limit - 1] === '\r' && text[limit] === '\n') limit--;
  for (let index = start; index < limit; index++) {
    if (text[index] === '\n') return index + 1;
    if (text[index] === '\r') {
      const end = text[index + 1] === '\n' ? index + 2 : index + 1;
      if (end <= limit) return end;
    }
    if (SENTENCE_BOUNDARIES.has(text[index])) {
      const end = sentenceEnd(text, index, limit);
      if (end !== undefined && end > start) return end;
    }
  }
  return limit;
}


export function splitSourceText(text: string, maximum = 800): Array<{start: number; end: number}> {
  if (typeof text !== 'string' || !Number.isSafeInteger(maximum) || maximum < 2 || maximum > 8192) fail('invalid_source_segment_limit');
  const slices: Array<{start: number; end: number}> = [];
  for (let start = 0; start < text.length;) {
    const end = boundedSourceEnd(text, start, maximum);
    range(text, start, end);
    if (end <= start) fail('invalid_source_range');
    slices.push({start, end}); start = end;
  }
  return slices;
}
