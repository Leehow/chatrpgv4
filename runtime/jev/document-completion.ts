/** Canonical evidence for an already selected writing operation; never selection authority. */
import {createHash} from 'node:crypto';

export const writingDigest = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
export type WritingOwner = {kind: string; id: string};
export type WritingOperation = 'append' | 'write' | 'requested_edit';
export interface CanonicalWritingResult {
  instance: string; root_owner: WritingOwner; direct_owner: WritingOwner;
  operation: WritingOperation; before_version: string; after_version: string;
  before_digest: string; after_digest: string; changed: boolean; suffix_digest?: string;
  request?: {id: string; turn: number; worldline: string | null; actor: string; instance: string; content_digest: string};
}
export interface WritingMatch {
  campaign: string; worldline: string; turn: number; playerText: string; epoch: object;
  call: string; occurrence: number; name: string; actor: string; beforeVersion: string; beforeText: string;
  operation: WritingOperation; selectedText: string; authority: 'admission' | 'bound_append' | 'issued_request';
  identity: {instance: string; root_owner: WritingOwner; direct_owner: WritingOwner};
}
export interface WritingCompletion {
  match: WritingMatch; receipt: string; result: CanonicalWritingResult;
  outcome: 'committed' | 'unchanged';
}
const owner = (value: unknown): value is WritingOwner => !!value && typeof value === 'object'
  && typeof (value as WritingOwner).kind === 'string' && typeof (value as WritingOwner).id === 'string';
export function canonicalWritingResult(value: unknown): CanonicalWritingResult | undefined {
  if (!value || typeof value !== 'object') return;
  const r = value as CanonicalWritingResult;
  if (!['append','write','requested_edit'].includes(r.operation) || !r.instance || !owner(r.root_owner)
    || !owner(r.direct_owner) || r.root_owner.kind !== 'investigator' || typeof r.changed !== 'boolean'
    || ![r.before_version,r.after_version,r.before_digest,r.after_digest].every(s => typeof s === 'string' && !!s)) return;
  return r;
}
/** Before version binds canonical instance/root custody; the kernel also verifies the actual direct from/to. */
export function matchWritingResult(match: WritingMatch, receipt: Record<string, unknown>, after: {name: string; actor: string; text: string; version: string;
  _writing_identity: WritingMatch['identity']},
  current: Pick<WritingMatch,'campaign'|'worldline'|'turn'|'playerText'|'epoch'>): WritingCompletion | undefined {
  if (match.campaign !== current.campaign || match.worldline !== current.worldline || match.turn !== current.turn
    || match.playerText !== current.playerText || match.epoch !== current.epoch || receipt.call_id !== match.call
    || receipt.name !== match.name || typeof receipt.id !== 'string' || receipt.partial === true || receipt.unknown === true) return;
  const r = canonicalWritingResult(receipt.writing_result);
  const sameIdentity=(value:WritingMatch['identity']|undefined)=>!!value&&value.instance===match.identity.instance
    &&value.root_owner.kind===match.identity.root_owner.kind&&value.root_owner.id===match.identity.root_owner.id
    &&value.direct_owner.kind===match.identity.direct_owner.kind&&value.direct_owner.id===match.identity.direct_owner.id;
  if (!r || r.operation !== match.operation || r.before_version !== match.beforeVersion
    ||!sameIdentity(r)||!sameIdentity(after._writing_identity)
    || r.before_digest !== writingDigest(match.beforeText) || after.name !== match.name || after.actor !== match.actor
    || after.version !== r.after_version || writingDigest(after.text) !== r.after_digest) return;
  const expected = match.operation === 'append' ? match.beforeText + match.selectedText : match.selectedText;
  if (after.text !== expected || r.changed !== (match.beforeText !== expected)) return;
  if (match.operation === 'append' && r.suffix_digest !== writingDigest(match.selectedText)) return;
  if (match.operation === 'requested_edit' && (!r.request || r.request.turn > match.turn
    ||match.authority==='issued_request'&&r.request.turn!==match.turn
    || r.request.worldline !== match.worldline || r.request.actor !== r.root_owner.id || r.request.instance !== r.instance
    || r.request.content_digest !== writingDigest(match.selectedText))) return;
  return {match, receipt: receipt.id, result: r, outcome: r.changed ? 'committed' : 'unchanged'};
}
/** Readback/witness is a separate outcome. This only closes the same physical addition's refusal. */
export function completesRefusedAddition(completion: WritingCompletion, basis: {campaign: string; worldline: string; turn: number;
  playerText: string; name?: string; text?: string; carrier?: {name: string; version: string}; catalog: Array<{name: string; version: string}>}): boolean {
  const m = completion.match;
  if (m.campaign !== basis.campaign || m.worldline !== basis.worldline || m.turn !== basis.turn || m.playerText !== basis.playerText
    || m.operation === 'requested_edit') return false;
  const target = basis.catalog.find(d => d.name === m.name && d.version === m.beforeVersion);
  if (!target) return false;
  if (m.operation === 'append' && m.authority === 'bound_append') return true;
  if(m.authority!=='admission')return false;
  const addition=m.operation==='append'?m.selectedText:m.selectedText.startsWith(m.beforeText)?m.selectedText.slice(m.beforeText.length):undefined;
  if(addition===undefined)return false;
  const originalTarget=basis.carrier??basis.catalog.find(d=>d.name===basis.name);
  if(originalTarget?.name===m.name&&originalTarget.version===m.beforeVersion&&addition===basis.text)return true;
  const literals=writingLiterals(m.playerText);
  const literal=literals.find(s=>addition===s.text||addition.replace(/^[ \t\r\n]*/u,'')===s.text);
  if(!literal)return false;
  const namesOnly=literals.reduceRight((s,p)=>s.slice(0,p.start)+s.slice(p.end),m.playerText);
  const norm=(s:string)=>s.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
  return norm(namesOnly).includes(norm(m.name)) || basis.catalog.length===1
    ||basis.carrier?.name===m.name&&basis.carrier.version===m.beforeVersion;
}
/** Closed quotation syntax only. Existing admission owns whether these bytes were selected writing. */
export function writingLiterals(text:string):Array<{start:number;end:number;text:string}>{
  const pairs:Record<string,string>={'"':'"',"'":"'",'\u201c':'\u201d','\u2018':'\u2019','\u00ab':'\u00bb','\u2039':'\u203a','\u300c':'\u300d','\u300e':'\u300f'},spans:Array<{start:number;end:number;text:string}>=[];
  const escaped=(at:number)=>{let n=0;while(at>0&&text[--at]==='\\')n++;return n%2===1;};
  const boundary=(c:string|undefined,marks:string)=>c===undefined||/\s/u.test(c)||marks.includes(c);
  for(let i=0;i<text.length;i++){
    const open=text[i],close=pairs[open];if(!close||escaped(i))continue;
    const apostrophe=open==="'"||open==='\u2018';if(apostrophe&&!boundary(text[i-1],'([{,:;!?\u2014\u2013-'))continue;
    let end=i+1;while(end<text.length&&(text[end]!==close||escaped(end)||apostrophe&&!boundary(text[end+1],')]}.,:;!?\u2014\u2013-')))end++;
    if(end===text.length)continue;if(end>i+1)spans.push({start:i,end:end+1,text:text.slice(i+1,end)});if(spans.length>32)return [];
    i=end;
  }return spans;
}
