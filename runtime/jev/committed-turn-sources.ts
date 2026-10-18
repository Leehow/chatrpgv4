/** Exact committed-turn source catalog. No I/O, semantic classification, or publication authority. */
import { createHash } from 'node:crypto';
import { ContractError, isPlainRecord, type ScopeBinding, type SourceRef } from './value-contracts.ts';
import { issueSourceRef, splitSourceText, type SourceSnapshot } from './source-ref.ts';

export const TURN_SOURCE_SEGMENT_UTF16_LIMIT = 800;

export interface CommittedTurnSourceInput {
  scope: ScopeBinding;
  turn: number;
  commit: string;
  playerText: string;
  keeperText: string;
  layout?: 'paragraph-v1';
}
export interface TurnSourceSegment {
  alias: string;
  role: 'player' | 'keeper';
  text: string;
  ref: SourceRef;
  attribution?: {kind: 'player' | 'keeper_narration' | 'speech' | 'mixed' | 'unknown'; speaker?: {name: string; kind: 'npc' | 'investigator' | 'label'}};
}
export interface CommittedTurnCatalog {
  turn: number;
  commit: string;
  snapshots: SourceSnapshot[];
  segments: TurnSourceSegment[];
  coverage: { complete: true; emptyRoles: Array<'player' | 'keeper'> };
}

const INPUT_KEYS = ['scope', 'turn', 'commit', 'playerText', 'keeperText', 'layout'];
const SCOPE_KEYS = ['owner', 'campaign', 'worldline', 'loop', 'audience'];

function invalid(): never { throw new ContractError('invalid_committed_turn_source'); }
function validScope(value: unknown): value is ScopeBinding {
  return isPlainRecord(value) && Object.keys(value).every(key => SCOPE_KEYS.includes(key))
    && typeof value.owner === 'string' && value.owner.length > 0
    && typeof value.campaign === 'string' && value.campaign.length > 0
    && typeof value.worldline === 'string' && value.worldline.length > 0
    && Number.isSafeInteger(value.loop) && Number(value.loop) >= 0
    && value.audience === 'keeper';
}
function digest(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex'); }
function paragraphSpans(text: string): Array<{start: number; end: number}> {
  const boundaries = [...text.matchAll(/\r?\n[ \t]*\r?\n/g)].map(match => match.index! + match[0].length);
  const rows: Array<{start: number; end: number}> = []; let start = 0;
  while (start < text.length) {
    const limit = Math.min(text.length, start + TURN_SOURCE_SEGMENT_UTF16_LIMIT);
    let end = boundaries.find(boundary => boundary > start && boundary <= limit) ?? limit;
    if (end === limit && end < text.length) {
      const line = text.lastIndexOf('\n', end - 1);
      if (line >= start) end = line + 1;
    }
    if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff
      && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
    rows.push({start, end}); start = end;
  }
  return rows;
}
function roleCatalog(scope: ScopeBinding, turn: number, role: 'player' | 'keeper', text: string, layout?: 'paragraph-v1'): {
  snapshot: SourceSnapshot;
  segments: TurnSourceSegment[];
} {
  const snapshot: SourceSnapshot = { scope: structuredClone(scope), resource: `turn:${turn}:${role}`,
    revision: digest(text), sourceType: 'turn', text };
  const segments: TurnSourceSegment[] = [];
  for (const [ordinal, {start, end}] of (layout ? paragraphSpans(text) : splitSourceText(text, TURN_SOURCE_SEGMENT_UTF16_LIMIT)).entries()) {
    const ref = issueSourceRef(snapshot, { kind: 'utf16', start, end });
    segments.push({ alias: `${role}:${ordinal}`, role, text: text.slice(start, end), ref });
  }
  return { snapshot, segments };
}

export function committedTurnCatalog(input: CommittedTurnSourceInput): CommittedTurnCatalog {
  if (!isPlainRecord(input) || Object.keys(input).some(key => !INPUT_KEYS.includes(key))
    || Object.keys(input).length !== (Object.hasOwn(input, 'layout') ? INPUT_KEYS.length : INPUT_KEYS.length - 1)
    || Object.hasOwn(input, 'layout') && input.layout !== 'paragraph-v1' || !validScope(input.scope)
    || !Number.isSafeInteger(input.turn) || input.turn < 0
    || typeof input.commit !== 'string' || !input.commit || input.commit.trim() !== input.commit
    || typeof input.playerText !== 'string' || typeof input.keeperText !== 'string') invalid();
  const scope = structuredClone(input.scope), player = roleCatalog(scope, input.turn, 'player', input.playerText, input.layout),
    keeper = roleCatalog(scope, input.turn, 'keeper', input.keeperText, input.layout);
  const emptyRoles: Array<'player' | 'keeper'> = [];
  if (!input.playerText.length) emptyRoles.push('player');
  if (!input.keeperText.length) emptyRoles.push('keeper');
  return { turn: input.turn, commit: input.commit, snapshots: [player.snapshot, keeper.snapshot],
    segments: [...player.segments, ...keeper.segments], coverage: { complete: true, emptyRoles } };
}
