#!/usr/bin/env node
/**
 * Contract §186.6 (RC-06 of docs/specs/reading-cost-tickets.md): freeze the claim-check calibration splits before any
 * Jev call of the redesign, and write the judge packets of the held-out strict negatives.
 *
 * Splits (fixed by §186.6):
 * - tuning = the 2026-09-29 calibration corpus (`records.jsonl` + `native/`, the rows' retained verify rounds for the raw
 *   candidates) plus the App home's verify rounds whose `claim-support.json` was written before the cut;
 * - held-out = the App home's verify rounds whose `claim-support.json` was written at or after the cut.
 *
 * A round carries the exact candidate of that verify round (a unit attempt's `draft.json`, chosen as the one whose
 * records re-render to the statements the shipped v1 check recorded), the records the v1 check asked (root, paths,
 * cited pages), the vision label of each record, the cited pages' native text and digests, and the part of the unit
 * task the check reads (`known_nodes` a claim names, `vocabulary.classification_fields`). No Jev distribution is copied:
 * the split files hold inputs and vision labels only.
 *
 * Labels per record instance, from the vision verdict words on its paths: `strict_negative` when any word is
 * `unsupported`, `contradicted` or `unclear`; `contested_only` when the other words are all `contested`; `supported`
 * when every word is `supported`; `unreviewed` when no vision row named its paths (kept for batching, never scored).
 *
 * Deduplication: (1) App evidence files that are byte-identical (the library's `work/merged/` copies of campaign rounds)
 * are one file, the campaign copy kept; (2) within a split, record instances with the same unique key are one unique
 * record: key = sha256 of canonical JSON [source sha256, the record's judged content, cited pages, the cited pages' text
 * digests], judged content being a node's kind, name, aliases, summary and properties, or a claim's subject and object
 * (name, kind, aliases of the node, or the literal object), predicate, truth status, validity and the asserting and
 * knowing nodes. A unique record is `strict_negative` if any instance is, else `contested_only` if any instance is, else
 * `supported` if any instance is. Uniques shared between the splits are reported, not removed (the split is by time).
 *
 * Usage: node tests/play/jev-claim-splits.mjs [--out .tmp/rc06] [--corpus <dir>] [--app <.coc dir>] [--cut <ISO>] [--packets]
 *        node tests/play/jev-claim-splits.mjs --from-split .tmp/rc06/heldout.json --packet-dir <name> (--keys <keys.json> | --label <label>)
 * The retained homes are only read.
 */
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceText, sourceTextVersion} from '../../extensions/module/source.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STRICT = new Set(['unsupported', 'contradicted', 'unclear']);

function args(argv) {
  const out = {out: join(REPO, '.tmp', 'rc06'), corpus: '/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2/.pi/jev-claim-calibration-20260929',
    app: join(homedir(), 'Library/Application Support/Pipi/pipicoc/pi-coc/.coc'), cut: '2026-10-04T00:00:00Z', packets: false};
  // Packets from a frozen split (no rebuild): --from-split <split.json> --packet-dir <name> (--keys <keys.json> | --label <label>).
  for (let i = 0; i < argv.length; i++) if (['--from-split', '--packet-dir', '--keys', '--label'].includes(argv[i])) {
    out[{'--from-split': 'fromSplit', '--packet-dir': 'packetDir', '--keys': 'keys', '--label': 'label'}[argv[i]]] = argv[i + 1];
    argv = [...argv.slice(0, i), ...argv.slice(i + 2)];
    i--;
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--out') out.out = resolve(argv[++i]);
    else if (flag === '--corpus') out.corpus = resolve(argv[++i]);
    else if (flag === '--app') out.app = resolve(argv[++i]);
    else if (flag === '--cut') out.cut = argv[++i];
    else if (flag === '--packets') out.packets = true;
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!Number.isFinite(Date.parse(out.cut))) throw new Error('--cut is not a date');
  return out;
}

const sha = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** JSON with object keys sorted, so equal values have equal text. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const list = dir => { try { return readdirSync(dir); } catch { return []; } };

function recordOf(draft, root) {
  const match = /^\/(claims|nodes)\/(0|[1-9][0-9]*)$/.exec(root);
  const record = match && plain(draft) && Array.isArray(draft[match[1]]) ? draft[match[1]][Number(match[2])] : undefined;
  return plain(record) ? record : undefined;
}
function nodeById(id, draft, task) {
  if (typeof id !== 'string') return undefined;
  return [...(Array.isArray(draft.nodes) ? draft.nodes : []), ...(Array.isArray(task?.known_nodes) ? task.known_nodes : [])]
    .find(node => plain(node) && node.node_id === id);
}

/** The shipped v1 statement (`runtime/jev/source-claim-support.ts` at 27322b50b), frozen here to match a round's candidate. */
function v1Statement(draft, root, task) {
  const record = recordOf(draft, root);
  if (!record) return null;
  const named = id => {
    const node = nodeById(id, draft, task);
    if (!node) return typeof id === 'string' ? {id} : null;
    return {name: typeof node.name === 'string' && node.name ? node.name : String(node.node_id), ...(typeof node.node_kind === 'string' ? {kind: node.node_kind} : {})};
  };
  const names = ids => Array.isArray(ids) && ids.length ? ids.map(named) : undefined;
  if (root.startsWith('/claims/')) {
    const object = plain(record.object) && Object.hasOwn(record.object, 'node_id') ? named(record.object.node_id) : (record.object ?? null);
    const assertedBy = names(record.asserted_by_ids), knownBy = names(record.known_by_ids);
    return {subject: named(record.subject_id), relation: typeof record.predicate === 'string' ? record.predicate : null, object,
      ...(typeof record.truth_status === 'string' ? {truth_status: record.truth_status} : {}),
      ...(record.validity !== undefined && record.validity !== null ? {condition: record.validity} : {}),
      ...(assertedBy ? {asserted_by: assertedBy} : {}), ...(knownBy ? {known_by: knownBy} : {})};
  }
  return {kind: typeof record.node_kind === 'string' ? record.node_kind : null, name: typeof record.name === 'string' ? record.name : null,
    ...(Array.isArray(record.aliases) && record.aliases.length ? {aliases: record.aliases} : {}),
    ...(typeof record.summary === 'string' && record.summary ? {summary: record.summary} : {}),
    ...(plain(record.properties) && Object.keys(record.properties).length ? {properties: record.properties} : {})};
}

/** A node as a claim names it, for the judged content: kind, name and aliases, or its id when nothing has it. */
function reference(id, draft, task) {
  const node = nodeById(id, draft, task);
  if (!node) return {id: typeof id === 'string' ? id : null};
  return {kind: node.node_kind ?? null, name: node.name ?? null, aliases: Array.isArray(node.aliases) ? node.aliases : []};
}
/** What a judge or the check reads of a record (see the header): independent of any statement rendering. */
function judgedContent(draft, root, task) {
  const record = recordOf(draft, root);
  if (root.startsWith('/claims/')) {
    const refs = ids => Array.isArray(ids) ? ids.map(id => reference(id, draft, task)) : [];
    return {claim: true, subject: reference(record.subject_id, draft, task), predicate: record.predicate ?? null,
      object: plain(record.object) && Object.hasOwn(record.object, 'node_id') ? reference(record.object.node_id, draft, task) : (record.object ?? null),
      truth_status: record.truth_status ?? null, validity: record.validity ?? null, asserted_by: refs(record.asserted_by_ids), known_by: refs(record.known_by_ids)};
  }
  return {node: true, kind: record.node_kind ?? null, name: record.name ?? null, aliases: Array.isArray(record.aliases) ? record.aliases : [],
    summary: record.summary ?? null, properties: plain(record.properties) ? record.properties : {}};
}
/** The node ids a record names anywhere: every string leaf equal to the id of a node the draft or the task knows. */
function referencedIds(record, draft, task) {
  const ids = new Set();
  const walk = value => {
    if (typeof value === 'string') { if (nodeById(value, draft, task)) ids.add(value); }
    else if (Array.isArray(value)) value.forEach(walk);
    else if (plain(value)) for (const [key, child] of Object.entries(value)) if (key !== 'node_id') walk(child);
  };
  walk(record);
  return [...ids].sort();
}
/** The task part the check reads: the known nodes the round's records name, and the declared classification fields. */
function reducedTask(task, draft, roots) {
  const ids = new Set();
  for (const root of roots) for (const id of referencedIds(recordOf(draft, root), draft, task)) ids.add(id);
  const draftIds = new Set((Array.isArray(draft.nodes) ? draft.nodes : []).map(node => node?.node_id));
  const known = (Array.isArray(task?.known_nodes) ? task.known_nodes : []).filter(node => plain(node) && ids.has(node.node_id) && !draftIds.has(node.node_id));
  const declared = task?.vocabulary?.classification_fields?.node ?? task?.classification_fields?.node;
  return {known_nodes: known, ...(Array.isArray(declared) ? {vocabulary: {classification_fields: {node: declared}}} : {})};
}
function labelOf(words) {
  if (!words.length) return 'unreviewed';
  if (words.some(word => STRICT.has(word))) return 'strict_negative';
  if (words.every(word => word === 'supported')) return 'supported';
  if (words.every(word => word === 'supported' || word === 'contested')) return 'contested_only';
  return 'other';
}

/** A verify round's retained candidates: each distinct unit draft with the unit task beside it, then the attempt's own. */
function candidatesOf(verifyDir) {
  const found = [], seen = new Set();
  const add = (draftPath, taskPath) => {
    if (!existsSync(draftPath) || !existsSync(taskPath)) return;
    let draft;
    try { draft = readJson(draftPath); } catch { return; }
    const text = canonical(draft);
    if (seen.has(text)) return;
    seen.add(text);
    found.push({draftPath, taskPath, draft});
  };
  for (const unit of list(verifyDir).filter(name => /^unit-\d+$/.test(name)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))))
    for (const attempt of list(join(verifyDir, unit)).filter(name => name.startsWith('attempt-')).sort())
      add(join(verifyDir, unit, attempt, 'draft.json'), join(verifyDir, unit, attempt, 'task.json'));
  if (/\/attempt-[^/]+\/verify-\d+$/.test(verifyDir)) add(join(dirname(verifyDir), 'draft.json'), join(dirname(verifyDir), 'task.json'));
  return found;
}
/** The candidate whose records re-render to the recorded v1 statements, with its task; undefined when none does. */
function matchCandidate(verifyDir, records) {
  for (const candidate of candidatesOf(verifyDir)) {
    let task;
    try { task = readJson(candidate.taskPath); } catch { continue; }
    if (records.every(record => recordOf(candidate.draft, record.root) && canonical(v1Statement(candidate.draft, record.root, task)) === canonical(record.statement)))
      return {...candidate, task};
  }
  return undefined;
}

function fileEntry(path) { return {path, sha256: sha(readFileSync(path))}; }

/**
 * The native text of one corpus source, as the 2026-09-29 tool read it: the module's `native-navigation-v2.json` at this
 * extraction version, the corpus's own `native/<sha>.json`, else `sourceText` on the module's PDF (the same extraction).
 * Every page is checked against its digest; the files read are recorded.
 */
class CorpusText {
  constructor(corpus) { this.corpus = corpus; this.sources = new Map(); this.disagreements = 0; }
  source(sha256) {
    let source = this.sources.get(sha256);
    if (!source) this.sources.set(sha256, source = {pages: new Map(), navigation: new Set()});
    return source;
  }
  add(source, rows, file) {
    for (const row of rows) {
      if (typeof row.text !== 'string') continue;
      const digest = sha(Buffer.from(row.text, 'utf8')), known = source.pages.get(row.page);
      if (!known) source.pages.set(row.page, {text: row.text, text_sha256: digest, file});
      else if (known.text_sha256 !== digest) this.disagreements++;
    }
  }
  async pages(moduleDir, sha256, wanted) {
    const source = this.source(sha256);
    if (!source.navigation.has(moduleDir)) {
      source.navigation.add(moduleDir);
      const nav = join(moduleDir, 'cache', 'native-navigation-v2.json');
      if (existsSync(nav)) {
        const saved = readJson(nav);
        if (saved.file_sha256 === sha256 && saved.extraction_version === sourceTextVersion) this.add(source, saved.pages, fileEntry(nav));
      }
      const own = join(this.corpus, 'native', `${sha256}.json`);
      if (existsSync(own)) this.add(source, readJson(own).pages, fileEntry(own));
      try {
        const meta = readJson(join(moduleDir, 'module.json')), path = meta.source_document?.path;
        if (!source.pdf && typeof path === 'string' && existsSync(resolve(moduleDir, path))) {
          const entry = fileEntry(resolve(moduleDir, path));
          if (entry.sha256 === sha256) source.pdf = entry;
        }
      } catch { /* a module without metadata contributes no PDF */ }
    }
    const missing = wanted.filter(page => !source.pages.has(page));
    for (let first = 0; first < missing.length; first += 32) {
      if (!source.pdf) return undefined;
      const bundle = await sourceText(source.pdf.path, {pages: missing.slice(first, first + 32), expected_file_sha256: sha256});
      if (bundle.extraction_version !== sourceTextVersion) return undefined;
      this.add(source, bundle.snapshots, source.pdf);
    }
    return wanted.every(page => source.pages.has(page)) ? source.pages : undefined;
  }
}

/** The 2026-09-29 corpus: its rows grouped by retained round, each matched to the round's candidate. */
async function corpusRounds(corpus, excluded) {
  const rows = readFileSync(join(corpus, 'records.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const byRound = new Map();
  for (const row of rows) (byRound.get(row.round) ?? byRound.set(row.round, []).get(row.round)).push(row);
  const texts = new CorpusText(corpus);
  const rounds = [];
  for (const [roundDir, group] of [...byRound].sort(([a], [b]) => a.localeCompare(b))) {
    const skip = reason => { excluded[reason] = (excluded[reason] ?? 0) + group.length; };
    if (!existsSync(roundDir)) { skip('corpus_candidate_not_retained'); continue; }
    const roots = new Map();
    let conflict = false;
    for (const row of group) {
      const seen = roots.get(row.root);
      if (seen && canonical([seen.statement, seen.pages, seen.label]) !== canonical([row.statement, row.pages, row.label])) conflict = true;
      roots.set(row.root, row);
    }
    if (conflict) { skip('corpus_conflicting_rows'); continue; }
    const records = [...roots.values()];
    const match = matchCandidate(roundDir, records);
    if (!match) { skip('corpus_no_matching_candidate'); continue; }
    const source = records[0].source, cited = [...new Set(records.flatMap(record => record.pages))].sort((a, b) => a - b);
    if (records.some(record => record.source !== source)) { skip('corpus_mixed_sources'); continue; }
    const text = await texts.pages(roundDir.slice(0, roundDir.lastIndexOf('/work/')), source, cited);
    if (!text) { skip('corpus_no_native_text'); continue; }
    const pages = {}, textFiles = new Map();
    for (const page of cited) {
      const row = text.get(page);
      pages[page] = {text: row.text, text_sha256: row.text_sha256};
      textFiles.set(row.file.path, row.file);
    }
    rounds.push({id: `corpus:${roundDir}`, origin: 'corpus-20260929', split: 'tuning', round_dir: roundDir, source_sha256: source, extraction_version: sourceTextVersion,
      files: [fileEntry(join(corpus, 'records.jsonl')), ...textFiles.values(), fileEntry(match.draftPath), fileEntry(match.taskPath)],
      draft: match.draft, task: reducedTask(match.task, match.draft, records.map(record => record.root)), pages,
      records: records.map(record => ({root: record.root, paths: record.paths, pages: record.pages, words: record.words ?? [],
        label: record.label === 'negative' ? 'strict_negative' : record.label === 'contested' ? 'contested_only' : record.label}))});
  }
  return {rounds, textDisagreements: texts.disagreements};
}

/** The App home's evidence files: campaign verify rounds and the library's merged copies (byte-identical ones dropped). */
function appEvidence(coc) {
  const files = [];
  for (const game of list(join(coc, 'module-campaigns')).sort())
    for (const book of list(join(coc, 'module-campaigns', game, 'modules')).sort()) {
      const work = join(coc, 'module-campaigns', game, 'modules', book, 'work');
      for (const read of list(work).filter(name => /^read-\d+$/.test(name)).sort())
        for (const attempt of list(join(work, read)).filter(name => name.startsWith('attempt-')).sort())
          for (const verify of list(join(work, read, attempt)).filter(name => /^verify-\d+$/.test(name)).sort())
            if (existsSync(join(work, read, attempt, verify, 'claim-support.json')))
              files.push({file: join(work, read, attempt, verify, 'claim-support.json'), module: join(coc, 'module-campaigns', game, 'modules', book)});
    }
  for (const book of list(join(coc, 'modules')).sort())
    for (const game of list(join(coc, 'modules', book, 'work', 'merged')).sort())
      for (const read of list(join(coc, 'modules', book, 'work', 'merged', game)).filter(name => /^read-\d+$/.test(name)).sort())
        for (const verify of list(join(coc, 'modules', book, 'work', 'merged', game, read)).filter(name => /^verify-\d+$/.test(name)).sort()) {
          const file = join(coc, 'modules', book, 'work', 'merged', game, read, verify, 'claim-support.json');
          if (existsSync(file)) files.push({file, module: join(coc, 'modules', book), merged: true});
        }
  const kept = [], seen = new Map();
  let copies = 0;
  for (const entry of files) {
    const digest = sha(readFileSync(entry.file));
    if (seen.has(digest)) { copies++; continue; }
    seen.set(digest, entry.file);
    kept.push({...entry, sha256: digest, mtime: statSync(entry.file).mtimeMs});
  }
  return {kept, copies, total: files.length};
}

function appRounds(coc, cut, excluded) {
  const {kept, copies, total} = appEvidence(coc);
  const rounds = [], pdfDigests = new Map();
  for (const entry of kept) {
    const evidence = readJson(entry.file), verifyDir = dirname(entry.file);
    const skip = reason => { excluded[reason] = (excluded[reason] ?? 0) + (Array.isArray(evidence.records) ? evidence.records.length : 0); };
    if (evidence.protocol !== 'source-claim-support-v1' || !Array.isArray(evidence.records) || !Array.isArray(evidence.pages)) { skip('app_not_evidence'); continue; }
    if (!evidence.records.length) continue;
    const match = matchCandidate(verifyDir, evidence.records);
    if (!match) { skip('app_no_matching_candidate'); continue; }
    const pages = {};
    let bad = false;
    for (const page of evidence.pages) {
      if (typeof page.text !== 'string' || sha(Buffer.from(page.text, 'utf8')) !== page.text_sha256) { bad = true; break; }
      pages[page.page] = {text: page.text, text_sha256: page.text_sha256};
    }
    if (bad || evidence.records.some(record => record.pages.some(page => !pages[page]))) { skip('app_page_digest_mismatch'); continue; }
    // The bound source: the module's own source.pdf, only when its bytes are the evidence's source digest.
    const pdfPath = join(entry.module, 'source.pdf');
    if (!pdfDigests.has(pdfPath)) pdfDigests.set(pdfPath, existsSync(pdfPath) ? sha(readFileSync(pdfPath)) : null);
    const pdf = pdfDigests.get(pdfPath) === evidence.source_sha256 ? pdfPath : null;
    rounds.push({id: `app:${relative(coc, verifyDir)}`, origin: 'app-home', split: entry.mtime < cut ? 'tuning' : 'heldout',
      round_dir: verifyDir, evidence_time: new Date(entry.mtime).toISOString(), source_sha256: evidence.source_sha256, extraction_version: evidence.extraction_version,
      pdf,
      files: [{path: entry.file, sha256: entry.sha256}, fileEntry(match.draftPath), fileEntry(match.taskPath)],
      draft: match.draft, task: reducedTask(match.task, match.draft, evidence.records.map(record => record.root)), pages,
      records: evidence.records.map(record => ({root: record.root, paths: record.paths, pages: record.pages, words: record.vision_verdicts ?? [],
        label: labelOf(record.vision_verdicts ?? [])}))});
  }
  return {rounds, files: {total, byte_identical_copies: copies, kept: kept.length}};
}

function keyed(round) {
  for (const record of round.records) {
    const digests = record.pages.map(page => round.pages[page]?.text_sha256 ?? null);
    record.key = sha(canonical([round.source_sha256, judgedContent(round.draft, record.root, round.task), record.pages, digests]));
  }
}
const RANK = {strict_negative: 3, contested_only: 2, supported: 1};
function uniques(rounds) {
  const map = new Map();
  for (const round of rounds) for (const record of round.records) {
    if (!RANK[record.label]) continue;
    const entry = map.get(record.key) ?? {key: record.key, label: record.label, instances: []};
    if (RANK[record.label] > RANK[entry.label]) entry.label = record.label;
    entry.instances.push({round: round.id, root: record.root});
    map.set(record.key, entry);
  }
  return [...map.values()];
}
function counts(rounds) {
  const instances = {}, unique = {};
  for (const round of rounds) for (const record of round.records) instances[record.label] = (instances[record.label] ?? 0) + 1;
  for (const entry of uniques(rounds)) unique[entry.label] = (unique[entry.label] ?? 0) + 1;
  return {rounds: rounds.length, instances, unique};
}

// ---- judge packets ----------------------------------------------------------------------------------------------------

const show = value => typeof value === 'string' ? value : JSON.stringify(value);
function leafLines(value, prefix, lines) {
  if (Array.isArray(value)) { if (!value.length) lines.push(`  ${prefix}: (empty list)`); value.forEach((child, index) => leafLines(child, `${prefix}[${index}]`, lines)); }
  else if (plain(value)) { if (!Object.keys(value).length) lines.push(`  ${prefix}: (empty)`); for (const [key, child] of Object.entries(value)) leafLines(child, prefix ? `${prefix}.${key}` : key, lines); }
  else lines.push(`  ${prefix}: ${show(value)}`);
}
function nodeLabel(id, draft, task) {
  const node = nodeById(id, draft, task);
  if (!node) return `(unknown node ${id})`;
  const aliases = Array.isArray(node.aliases) && node.aliases.length ? `; also called ${node.aliases.map(show).join(', ')}` : '';
  return `${show(node.name)} (${show(node.node_kind)}${aliases})`;
}
/** The record in plain English-labelled fields: what the claim check asks the pages to state. No score, no verdict. */
function statementText(round, record) {
  const raw = recordOf(round.draft, record.root), lines = [];
  if (record.root.startsWith('/claims/')) {
    lines.push('Record type: relation between two things (claim)');
    lines.push(`Subject: ${nodeLabel(raw.subject_id, round.draft, round.task)}`);
    lines.push(`Relation: ${show(raw.predicate ?? null)}`);
    lines.push(`Object: ${plain(raw.object) && Object.hasOwn(raw.object, 'node_id') ? nodeLabel(raw.object.node_id, round.draft, round.task) : show(raw.object ?? null)}`);
    if (raw.truth_status !== undefined) lines.push(`Truth status: ${show(raw.truth_status)}`);
    if (raw.validity !== undefined && raw.validity !== null) lines.push(`Condition: ${show(raw.validity)}`);
    if (Array.isArray(raw.asserted_by_ids) && raw.asserted_by_ids.length) lines.push(`Asserted by: ${raw.asserted_by_ids.map(id => nodeLabel(id, round.draft, round.task)).join('; ')}`);
    if (Array.isArray(raw.known_by_ids) && raw.known_by_ids.length) lines.push(`Known by: ${raw.known_by_ids.map(id => nodeLabel(id, round.draft, round.task)).join('; ')}`);
  } else {
    lines.push('Record type: thing in the book (node)');
    lines.push(`Kind: ${show(raw.node_kind ?? null)}`);
    lines.push(`Name: ${show(raw.name ?? null)}`);
    if (Array.isArray(raw.aliases) && raw.aliases.length) lines.push(`Also called: ${raw.aliases.map(show).join('; ')}`);
    if (typeof raw.summary === 'string' && raw.summary) lines.push(`Summary: ${raw.summary}`);
    if (plain(raw.properties) && Object.keys(raw.properties).length) { lines.push('Properties (label: value):'); leafLines(raw.properties, '', lines); }
  }
  lines.push(`Cited pages (physical page numbers of the PDF, first page = 1): ${record.pages.join(', ')}`);
  const shown = record.root.startsWith('/claims/') ? ['subject_id', 'predicate', 'object', 'truth_status', 'validity', 'asserted_by_ids', 'known_by_ids', 'source_refs']
    : ['node_kind', 'name', 'aliases', 'summary', 'properties', 'source_refs'];
  const rest = Object.keys(raw).filter(key => !shown.includes(key));
  if (rest.length) lines.push(`Other fields of the record (in record.json, not rendered here): ${rest.join(', ')}`);
  return lines.join('\n') + '\n';
}
/** Judge packets for `entries` (unique records with their instances) under `<out>/judge/<name>/`, numbered from 1. */
function writePackets(out, name, rounds, entries) {
  const dir = join(out, 'judge', name);
  rmSync(dir, {recursive: true, force: true});
  mkdirSync(dir, {recursive: true});
  const byId = new Map(rounds.map(round => [round.id, round]));
  const negatives = entries
    .map(entry => ({...entry, instances: entry.instances.sort((a, b) => a.round.localeCompare(b.round) || a.root.localeCompare(b.root))}))
    .sort((a, b) => a.instances[0].round.localeCompare(b.instances[0].round) || a.instances[0].root.localeCompare(b.instances[0].root, 'en', {numeric: true}));
  const index = [];
  negatives.forEach((entry, at) => {
    const n = String(at + 1), packet = join(dir, n), first = entry.instances[0], round = byId.get(first.round);
    const record = round.records.find(item => item.root === first.root), raw = recordOf(round.draft, record.root);
    mkdirSync(join(packet, 'pages'), {recursive: true});
    const references = Object.fromEntries(referencedIds(raw, round.draft, round.task).map(id => {
      const node = nodeById(id, round.draft, round.task);
      return [id, {name: node.name ?? null, kind: node.node_kind ?? null, aliases: Array.isArray(node.aliases) ? node.aliases : []}];
    }));
    writeFileSync(join(packet, 'record.json'), JSON.stringify({packet: Number(n), source_sha256: round.source_sha256, pdf: round.pdf, pages: record.pages,
      root: record.root, record: raw, references, instances: entry.instances}, null, 2) + '\n');
    writeFileSync(join(packet, 'statement.txt'), statementText(round, record));
    for (const page of record.pages) {
      writeFileSync(join(packet, `native-${page}.txt`), round.pages[page].text);
      if (!round.pdf) throw new Error(`no bound source.pdf for ${round.id}`);
      const run = spawnSync('pdftoppm', ['-r', '110', '-png', '-f', String(page), '-l', String(page), '-singlefile', round.pdf, join(packet, 'pages', String(page))], {encoding: 'utf8'});
      if (run.status !== 0) throw new Error(`pdftoppm failed for ${round.pdf} page ${page}: ${run.stderr}`);
    }
    index.push({packet: Number(n), dir: relative(out, packet), source_sha256: round.source_sha256, pdf: round.pdf, pages: record.pages, root: record.root, instances: entry.instances});
  });
  writeFileSync(join(dir, 'index.json'), JSON.stringify({contract: '186.6', question: 'Do these pages state this record?',
    note: 'Each packet holds the record (record.json, raw, with the names of the nodes it references), the record rendered in English-labelled fields (statement.txt), the cited original pages rendered from the bound source.pdf at 110 dpi (pages/<page>.png, physical 1-based) and their native text (native-<page>.txt). No Jev score and no vision verdict is included.',
    packets: index}, null, 2) + '\n');
  return index.length;
}

/**
 * Judge packets from an already frozen split, without rebuilding it: the split's digest must be the manifest's, and the
 * records are the uniques named by `keys` (a JSON array) or carrying `label`.
 */
function packetsFromSplit(options) {
  const path = resolve(options.fromSplit), text = readFileSync(path, 'utf8');
  const manifest = readJson(join(dirname(path), 'manifest.json'));
  if (manifest.split_files?.[path.split('/').pop()] !== sha(text)) throw new Error('the split file is not the one the manifest froze');
  if (!options.packetDir || options.packetDir === 'heldout-neg' || options.packetDir.includes('/')) throw new Error('name a new --packet-dir');
  const rounds = JSON.parse(text).rounds, wanted = options.keys ? new Set(readJson(resolve(options.keys))) : undefined;
  const entries = uniques(rounds).filter(entry => wanted ? wanted.has(entry.key) : entry.label === options.label);
  if (wanted && entries.length !== wanted.size) throw new Error('a key is not a unique record of this split');
  process.stdout.write(JSON.stringify({packets: writePackets(dirname(path), options.packetDir, rounds, entries), dir: join(dirname(path), 'judge', options.packetDir)}) + '\n');
}

async function main() {
  const options = args(process.argv.slice(2)), cut = Date.parse(options.cut), excluded = {};
  if (options.fromSplit) return packetsFromSplit(options);
  const {rounds: corpus, textDisagreements} = await corpusRounds(options.corpus, excluded);
  const app = appRounds(options.app, cut, excluded);
  const rounds = [...corpus, ...app.rounds];
  for (const round of rounds) keyed(round);
  const splits = {tuning: rounds.filter(round => round.split === 'tuning'), heldout: rounds.filter(round => round.split === 'heldout')};
  mkdirSync(options.out, {recursive: true});
  const written = {};
  for (const [name, members] of Object.entries(splits)) {
    const text = JSON.stringify({contract: '186.6', split: name, cut: options.cut, rounds: members}) + '\n';
    writeFileSync(join(options.out, `${name}.json`), text);
    written[`${name}.json`] = sha(text);
  }
  const tuningKeys = new Set(uniques(splits.tuning).map(entry => entry.key));
  const shared = uniques(splits.heldout).filter(entry => tuningKeys.has(entry.key));
  const manifest = {contract: '186.6', cut: options.cut, corpus: options.corpus, app: options.app,
    app_files: app.files, excluded_instances: excluded, corpus_native_text_disagreements: textDisagreements, split_files: written,
    heldout_uniques_also_in_tuning: shared.length,
    splits: Object.fromEntries(Object.entries(splits).map(([name, members]) => [name, {counts: counts(members),
      by_origin: Object.fromEntries(['corpus-20260929', 'app-home'].map(origin => [origin, counts(members.filter(round => round.origin === origin))])),
      rounds: members.map(round => ({id: round.id, ...(round.evidence_time ? {evidence_time: round.evidence_time} : {}), source_sha256: round.source_sha256,
        files: round.files, records: round.records.map(record => [record.root, record.label, record.key])}))}]))};
  const text = JSON.stringify(manifest, null, 1) + '\n';
  writeFileSync(join(options.out, 'manifest.json'), text);
  const summary = {manifest: join(options.out, 'manifest.json'), manifest_sha256: sha(text), split_files: written, app_files: app.files, excluded_instances: excluded,
    heldout_uniques_also_in_tuning: shared.length, counts: Object.fromEntries(Object.entries(manifest.splits).map(([name, value]) => [name, {all: value.counts, ...value.by_origin}]))};
  if (options.packets) summary.judge_packets = writePackets(options.out, 'heldout-neg', splits.heldout, uniques(splits.heldout).filter(entry => entry.label === 'strict_negative'));
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

await main();
