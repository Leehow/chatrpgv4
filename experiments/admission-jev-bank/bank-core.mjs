// Offline reconstruction of retained admission reviews (contract §32.10). Reads evidence, never
// writes it. A case is one lane verdict row paired with the exact tool arguments that produced it,
// re-projected through the product's own admissionRequest, plus the player-visible context the
// lane read, rebuilt from committed turn records. What cannot be rebuilt is named in `notes`.
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {admissionRequest, keyDigest} from '../../extensions/kernel/admission.ts';

const KEEPER_WINDOW = 4;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' && value.trim() ? value.trim() : undefined;
export function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; } }
export function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').flatMap(line => { try { return line.trim() ? [JSON.parse(line)] : []; } catch { return []; } });
}
export const turnRecord = (dir, turn) => readJson(join(dir, 'turns', `${String(turn).padStart(4, '0')}.json`));

/** A verdict-bearing review row: a live verdict or a review that could not decide. Skips and reuses are not reviews. */
export function isReviewRow(row) {
  return row?.lane === 'admission' && !row.skipped && !row.reused && (typeof row.verdict === 'string' || row.ok === false);
}

/** The lane's view of this turn, rebuilt from committed records (§32.3). */
export function turnContext(dir, turn) {
  const record = object(turnRecord(dir, turn)), capsule = object(record.capsule), notes = [];
  const where = object(capsule.where), sheet = object(object(capsule.known).investigator);
  const campaign = object(readJson(join(dir, 'campaign.json')));
  const investigators = text(sheet.name) ? [{name: sheet.name, ...(text(sheet.occupation) ? {occupation: sheet.occupation} : {})}] : [];
  if (!investigators.length) notes.push('investigator_unknown');
  const delivered = [];
  for (let prior = Math.max(0, turn - KEEPER_WINDOW); prior < turn; prior++) {
    const row = object(turnRecord(dir, prior));
    const keeper = text(row.rendered_text) ?? text(row.text);
    if (keeper) delivered.push({turn: prior, player: text(row.player_text) ?? null, keeper});
  }
  if (!delivered.length && turn > 0) notes.push('no_prior_delivery_record');
  notes.push('setup_prologue_omitted');
  return {
    playerText: text(record.player_text),
    investigators,
    scene: text(where.display_name) ?? text(where.scene),
    sceneHandle: text(where.scene),
    present: Array.isArray(capsule.present) ? capsule.present.flatMap(row => text(object(row).name) ? [object(row).name] : []) : [],
    delivered,
    playLanguage: text(campaign.play_language),
    notes,
  };
}

/** `noteLanded` in extensions/kernel/index.ts, applied to a retained successful result. */
export function landedLine(tool, result) {
  const value = object(typeof result === 'string' ? (() => { try { return JSON.parse(result); } catch { return {}; } })() : result);
  if (tool === 'resolve') { const kind = text(object(value.outcome).kind); return `resolve settled${kind ? ` (${kind})` : ''}`; }
  const receipts = Array.isArray(value.receipts) ? value.receipts.map(String) : [];
  return `apply landed: ${receipts.length ? receipts.join(', ') : 'receipts'}`;
}

/**
 * One turn's tool calls in order (`{name, args, ok, result, row?}`) and its review rows. A row
 * already attached by adjacency (session sources) is exact; otherwise rows pair by the
 * product's own key digest, then by order when the unmatched counts per verb agree.
 */
export function pairTurn(tools, rows, scope) {
  const proposals = tools.map(tool => ['resolve', 'apply'].includes(tool.name) ? admissionRequest(tool.name, object(tool.args), scope) : null);
  const used = new Set(), pairs = new Map();
  tools.forEach((tool, index) => { if (tool.row) { pairs.set(index, {row: tool.row, pairing: 'adjacent'}); } });
  proposals.forEach((proposal, index) => {
    if (!proposal || pairs.has(index)) return;
    const digest = keyDigest(proposal.key);
    const hit = rows.findIndex((row, at) => !used.has(at) && row.verb === proposal.tool && row.key === digest);
    if (hit >= 0) { used.add(hit); pairs.set(index, {row: rows[hit], pairing: 'digest'}); }
  });
  for (const verb of ['resolve', 'apply']) {
    const open = proposals.flatMap((proposal, index) => proposal?.tool === verb && !pairs.has(index) ? [index] : []);
    const left = rows.flatMap((row, at) => !used.has(at) && row.verb === verb && !tools.some(tool => tool.row === row) ? [at] : []);
    if (open.length && open.length === left.length) open.forEach((index, n) => { used.add(left[n]); pairs.set(index, {row: rows[left[n]], pairing: 'order'}); });
  }
  return {proposals, pairs};
}

/** Cases for one turn, accumulating what the lane saw as already settled and already refused. */
export function turnCases({source, campaign, dir, turn, tools, rows, playerText}) {
  const context = turnContext(dir, turn);
  const scope = {party: context.investigators.map(row => row.name),
    ...(context.sceneHandle || context.scene ? {scene: {...(context.sceneHandle ? {handle: context.sceneHandle} : {}), ...(context.scene ? {label: context.scene} : {})}} : {})};
  const {proposals, pairs} = pairTurn(tools, rows, scope);
  const landed = [], refused = [], cases = [];
  tools.forEach((tool, index) => {
    const proposal = proposals[index], paired = pairs.get(index);
    if (proposal && paired) {
      const {row, pairing} = paired;
      const recorded = Array.isArray(row.proposed) && row.proposed.every(line => typeof line === 'string') ? row.proposed : undefined;
      const lines = recorded ?? proposal.lines;
      const notes = [...context.notes];
      if (!recorded && lines.some(line => line.startsWith('apply move:'))) notes.push('registered_destination_omitted');
      notes.push('answered_options_unknown');
      const player = text(playerText) ?? context.playerText;
      if (player) cases.push({
        id: `${campaign}:${turn}:${index}`, source, campaign, turn, verb: proposal.tool, pairing,
        key_match: row.key === keyDigest(proposal.key), lines_from: recorded ? 'telemetry' : 'reprojected',
        kinds: proposal.kinds ?? [],
        lane: row.ok === false ? {verdict: null, reason: row.reason ?? 'unknown', model: row.model ?? null, ms: row.ms ?? null}
          : {verdict: row.verdict, model: row.model ?? null, ms: row.ms ?? null, ...(row.grounds ? {grounds: row.grounds} : {}), ...(row.missing ? {missing: row.missing} : {})},
        input: {campaign, turn, tool: proposal.tool, proposal: lines, playerText: player,
          investigators: context.investigators, ...(context.scene ? {scene: context.scene} : {}), present: context.present,
          delivered: context.delivered, landed: [...landed], refused: [...refused]},
        play_language: context.playLanguage ?? null, notes,
      });
      if (row.ok !== false && ['not_authorized', 'uncertain'].includes(row.verdict))
        refused.push(`${lines.join(' | ')} -> ${row.verdict}${row.missing ? `: ${row.missing}` : ''}`);
    }
    if (['resolve', 'apply'].includes(tool.name) && tool.ok) landed.push(landedLine(tool.name, tool.result));
  });
  return cases;
}

/** A driver playtest run (`tests/play/driver.py`): turn files carry the tool arguments in order. */
export function playtestTurns(runDir) {
  return readdirSync(runDir).filter(name => /^turn-\d+\.json$/.test(name)).flatMap(name => {
    const value = object(readJson(join(runDir, name)));
    if (!Number.isSafeInteger(value.turn) || !Array.isArray(value.tools)) return [];
    return [{turn: value.turn, playerText: value.player_text, tools: value.tools.map(tool => ({name: tool.name, args: tool.args,
      ok: tool.is_error === false, result: tool.result_text}))}];
  });
}

/**
 * A Pi session JSONL: an assistant tool call, the admission telemetry entry its review wrote, then
 * its tool result, in that order. Adjacency pairs them exactly; turns come from the rows.
 */
export function sessionTurns(path) {
  const turns = new Map(), pending = new Map();
  let open = [], lastTurn;
  const turnOf = number => { if (!turns.has(number)) turns.set(number, {turn: number, tools: [], rows: []}); return turns.get(number); };
  for (const entry of readJsonl(path)) {
    if (entry.type === 'custom' && entry.customType === 'coc-telemetry') {
      const row = object(entry.data);
      if (Number.isSafeInteger(row.turn)) lastTurn = row.turn;
      if (isReviewRow(row)) {
        const tool = open.find(call => call.name === row.verb && !call.row);
        if (tool) { tool.row = row; tool.turn = row.turn; }
        turnOf(row.turn).rows.push(row);
      }
      continue;
    }
    if (entry.type !== 'message') continue;
    const message = object(entry.message);
    if (message.role === 'assistant') {
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block?.type !== 'toolCall') continue;
        const call = {id: block.id, name: block.name, args: block.arguments, ok: false};
        pending.set(block.id, call); open.push(call);
      }
    } else if (message.role === 'toolResult') {
      const call = pending.get(message.toolCallId);
      if (!call) continue;
      call.ok = message.isError === false;
      call.result = (Array.isArray(message.content) ? message.content : []).filter(block => block?.type === 'text').map(block => block.text).join('');
      open = open.filter(value => value !== call);
      const turn = call.turn ?? lastTurn;
      if (Number.isSafeInteger(turn)) turnOf(turn).tools.push(call);
    }
  }
  return [...turns.values()];
}
