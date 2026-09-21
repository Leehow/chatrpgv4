/** Pure attribution recovery for already-repaired committed say markers. No source or publication authority. */
import { isPlainRecord } from './value-contracts.ts';

export type CommittedSpeaker =
  | { npc: string; name: string }
  | { investigator: string; name: string }
  | { label: string };

export interface CommittedSpeechRow { who: CommittedSpeaker; text: string }
export interface CommittedSpeechSpan { start: number; end: number; who: CommittedSpeaker }
export type CommittedSpeechSpanResult =
  | { status: 'verified'; spans: CommittedSpeechSpan[] }
  | { status: 'unavailable'; spans: []; reason: string };

const INPUT_KEYS = ['markedText', 'renderedText', 'speech'];
const SAY_TOKEN = /\{\{say:([^}\n]*)\}\}|\{\{\/say\}\}/g;
const MECHANIC_TOKEN = /\{\{([a-z0-9][a-z0-9:_-]*)\}\}/g;
const SAY_NAME_UTF16_LIMIT = 60;

const unavailable = (reason: string): CommittedSpeechSpanResult => ({ status: 'unavailable', spans: [], reason });
function dense(value: unknown): value is unknown[] {
  return Array.isArray(value) && Object.keys(value).length === value.length;
}
function ownOnly(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function speaker(value: unknown): value is CommittedSpeaker {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === 'label') return nonempty(value.label);
  if (keys.length !== 2 || !keys.includes('name') || !nonempty(value.name)) return false;
  return keys.includes('npc') && nonempty(value.npc) || keys.includes('investigator') && nonempty(value.investigator);
}
function speechRow(value: unknown): value is CommittedSpeechRow {
  return isPlainRecord(value) && ownOnly(value, ['who', 'text']) && speaker(value.who)
    && nonempty(value.text) && value.text === value.text.trim();
}
function trimmedBody(value: string): { text: string; start: number; end: number } {
  const withoutLeading = value.trimStart(), start = value.length - withoutLeading.length;
  const text = withoutLeading.trimEnd();
  return { text, start, end: start + text.length };
}

/**
 * Derive rendered UTF-16 spans from repaired say markers and the canonical speech rows retained by
 * the kernel. Any disagreement returns unavailable; equal text is never used to search for a span.
 */
export function deriveCommittedSpeechSpans(input: {
  markedText: string;
  renderedText: string;
  speech: CommittedSpeechRow[];
}): CommittedSpeechSpanResult {
  if (!isPlainRecord(input) || !ownOnly(input, INPUT_KEYS) || typeof input.markedText !== 'string'
    || typeof input.renderedText !== 'string' || !dense(input.speech) || !input.speech.every(speechRow))
    return unavailable('invalid_input');

  const removed = new Uint8Array(input.markedText.length), owners = new Int32Array(input.markedText.length);
  owners.fill(-1);
  let active: { row: number; bodyStart: number } | undefined, count = 0, match: RegExpExecArray | null;
  SAY_TOKEN.lastIndex = 0;
  while ((match = SAY_TOKEN.exec(input.markedText)) !== null) {
    removed.fill(1, match.index, match.index + match[0].length);
    if (match[1] !== undefined) {
      const name = match[1];
      if (active || !name || name !== name.trim() || name.length > SAY_NAME_UTF16_LIMIT) {
        SAY_TOKEN.lastIndex = 0; return unavailable('malformed_say_tokens');
      }
      active = { row: count, bodyStart: match.index + match[0].length };
      continue;
    }
    if (!active || active.row >= input.speech.length) { SAY_TOKEN.lastIndex = 0; return unavailable('speech_count_mismatch'); }
    const body = input.markedText.slice(active.bodyStart, match.index), trimmed = trimmedBody(body);
    if (trimmed.text !== input.speech[active.row].text) { SAY_TOKEN.lastIndex = 0; return unavailable('speech_text_mismatch'); }
    owners.fill(active.row, active.bodyStart + trimmed.start, active.bodyStart + trimmed.end);
    count++; active = undefined;
  }
  SAY_TOKEN.lastIndex = 0;
  if (active) return unavailable('malformed_say_tokens');
  for (let index = 0; index < input.markedText.length; index++)
    if (!removed[index] && (input.markedText.startsWith('{{say', index) || input.markedText.startsWith('{{/say', index)))
      return unavailable('malformed_say_tokens');
  if (count !== input.speech.length) return unavailable('speech_count_mismatch');

  MECHANIC_TOKEN.lastIndex = 0;
  while ((match = MECHANIC_TOKEN.exec(input.markedText)) !== null)
    removed.fill(1, match.index, match.index + match[0].length);
  MECHANIC_TOKEN.lastIndex = 0;

  const units: string[] = [], unitOwners: number[] = [];
  for (let index = 0; index < input.markedText.length; index++) if (!removed[index]) {
    units.push(input.markedText[index]);
    unitOwners.push(owners[index]);
  }
  const collapsed: string[] = [], collapsedOwners: number[] = [];
  for (let index = 0; index < units.length;) {
    if (units[index] !== ' ' && units[index] !== '\t') {
      collapsed.push(units[index]); collapsedOwners.push(unitOwners[index]); index++; continue;
    }
    let end = index + 1;
    while (end < units.length && (units[end] === ' ' || units[end] === '\t')) end++;
    if (end - index === 1) {
      collapsed.push(units[index]); collapsedOwners.push(unitOwners[index]);
    } else {
      const firstOwner = unitOwners[index];
      collapsed.push(' ');
      collapsedOwners.push(firstOwner >= 0 && unitOwners.slice(index, end).every(owner => owner === firstOwner) ? firstOwner : -1);
    }
    index = end;
  }

  const collapsedText = collapsed.join(''), withoutLeading = collapsedText.trimStart(), leading = collapsedText.length - withoutLeading.length,
    rendered = withoutLeading.trimEnd(), renderedOwners = collapsedOwners.slice(leading, leading + rendered.length);
  if (rendered !== input.renderedText) return unavailable('rendered_text_mismatch');

  const spans: CommittedSpeechSpan[] = [];
  for (let row = 0; row < input.speech.length; row++) {
    const start = renderedOwners.indexOf(row), end = renderedOwners.lastIndexOf(row) + 1;
    if (start < 0 || end <= start || renderedOwners.slice(start, end).some(owner => owner !== row))
      return unavailable('speech_span_unavailable');
    spans.push({ start, end, who: structuredClone(input.speech[row].who) });
  }
  return { status: 'verified', spans };
}
