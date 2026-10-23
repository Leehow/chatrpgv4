// Sandbox probe for §258 ticket 00: does a "told before" callback stop the sole author repeating a person's line?
// Replays recorded decision-mode author packets (.coc/expression-writes/<id>/task.json) twice per arm:
//   A "recorded": the packet and the current author instruction, unchanged.
//   B "callback": claims the listener already heard become {kind:"callback", gist, times, last_turn}; a promise
//     whose promisor is not the speaker becomes attributed hearsay; people[].told_you lists the person's earlier
//     lines; the "history cannot cancel it" sentence is replaced by the callback rule.
// Counts, per run, same-speaker say spans sharing a run of >= 12 letters/digits with an earlier line (the
// repeatedLines rule) and any line sharing >= 12 with any earlier line in recent_public. Author craft sections were not
// recorded with the packets, so both arms run without them. Reads only; writes under OUT.
//   PI_COC_TEST_MODEL=minimax-cn/MiniMax-M3.1-Flash-Preview AGENT_HOME=<pi agent dir> \
//     node experiments/npc-mind/callback-probe.mjs <expression-writes dir> <out> [runs=2] [task ids...]
// PROBE_DRY=1 writes both arms' inputs without calling a model.
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {homedir} from 'node:os';
import {createRuntime} from '../../runtime/host.ts';
import {DECISION_AUTHOR_INSTRUCTION, expressionAuthorProfile} from '../../runtime/isolated-expression.ts';

const root = resolve(import.meta.dirname, '../..');
const [writesArg, outArg, runsArg = '2', ...only] = process.argv.slice(2);
if (!writesArg || !outArg) { console.error('usage: callback-probe.mjs <expression-writes dir> <out> [runs] [task ids...]'); process.exit(2); }
if (process.env.PROBE_DRY !== '1' && process.env.PI_COC_TEST_MODEL !== 'minimax-cn/MiniMax-M3.1-Flash-Preview') { console.error('set PI_COC_TEST_MODEL to the MiniMax test profile'); process.exit(2); }
const writes = resolve(writesArg), out = resolve(outArg), runs = Number(runsArg);
const agentHome = process.env.AGENT_HOME || join(homedir(), 'Library/Application Support/Pipi/pipicoc/pi-coc/agent');

const OLD_RULE = 'Every current selected response must still be rendered, including a repeated answer when the player asks again; history cannot cancel it.';
const NEW_RULE = 'Every current selected response must still be perceptible. A claim of kind callback was already told to its recipients: the person refers back to it briefly in new words (a short reminder, not a restatement), and at times >= 2 shows that they are being asked again, in their own register (terser, impatient, or asking why). A claim of kind hearsay is what someone else said: the speaker attributes it to them. people[].told_you is what that person already said to the investigators: never restate it unless it is a selected claim, and never reuse a sentence from recent_public.';
if (!DECISION_AUTHOR_INSTRUCTION.includes(OLD_RULE)) { console.error('the author instruction no longer contains the rule this probe replaces'); process.exit(2); }

const norm = text => [...String(text ?? '').normalize('NFKC').toLowerCase()].filter(ch => /[\p{L}\p{N}]/u.test(ch)).join('');
function sharedRun(a, b) { // longest common substring length over normalized text
  const x = norm(a), y = norm(b); let best = 0; const prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) { let diag = 0; for (let j = 1; j <= y.length; j++) { const keep = prev[j]; prev[j] = x[i - 1] === y[j - 1] ? diag + 1 : 0; if (prev[j] > best) best = prev[j]; diag = keep; } }
  return best;
}
// recent_public rows: {turn, keeper: "Display Name: “line”\n..."}; returns [{turn, speaker, line}]
const earlierLines = decision => (decision.recent_public ?? []).flatMap(row => String(row.keeper ?? '').split('\n').map(text => {
  const at = text.indexOf(': '); return at > 0 ? {turn: row.turn, speaker: text.slice(0, at).trim(), line: text.slice(at + 2).trim()} : null;
}).filter(Boolean));
const claimText = claim => claim?.value?.statement ?? claim?.exhibit?.surface ?? claim?.value?.surface?.text ?? (claim?.kind === 'proposed_claim' ? JSON.stringify(claim.value) : undefined);

function callbackArm(packet) {
  const decision = structuredClone(packet.decision_context);
  const lines = earlierLines(decision), nameOf = new Map((decision.people ?? []).map(p => [p.ref, p.display_name ?? p.name]));
  const realName = new Map((decision.people ?? []).map(p => [p.ref, p.name]));
  for (const response of decision.responses ?? []) {
    response.claims = (response.claims ?? []).map(claim => {
      if (claim.kind === 'existing_account_response') return {kind: 'callback', gist: 'what this person already answered', times: (claim.value?.prior_turns ?? []).length || 1, last_turn: Math.max(...(claim.value?.prior_turns ?? [0]))};
      const text = claimText(claim); if (!text) return claim;
      const heard = lines.filter(row => sharedRun(row.line, text) >= 6);
      const promisor = claim.value?.kind === 'promise' ? claim.value.subject : undefined;
      if (promisor && realName.get(response.actor) !== promisor && nameOf.get(response.actor) !== promisor)
        return {kind: 'hearsay', said_by: promisor, gist: claim.value.statement, ...(heard.length ? {times: heard.length, last_turn: Math.max(...heard.map(r => r.turn))} : {}),
          authority: 'Something another person said; the speaker attributes it, it is not their own promise.'};
      if (!heard.length) return claim;
      return {kind: 'callback', gist: text, times: heard.length, last_turn: Math.max(...heard.map(r => r.turn)),
        authority: 'Already told to these recipients; refer back briefly in new words.'};
    });
  }
  for (const person of decision.people ?? []) {
    const own = [...new Set(lines.filter(row => row.speaker === person.display_name).map(row => row.line))].slice(-6);
    if (own.length) person.told_you = own;
  }
  return {...packet, decision_context: decision};
}

function repeats(text, decision) {
  const spans = [...String(text).matchAll(/\{\{say:(npc_\d+)\}\}([\s\S]*?)\{\{\/say\}\}/g)].map(m => ({ref: m[1], line: m[2]}));
  const nameOf = new Map((decision.people ?? []).map(p => [p.ref, p.display_name]));
  const lines = earlierLines(decision);
  const same = spans.filter(span => lines.some(row => row.speaker === nameOf.get(span.ref) && sharedRun(row.line, span.line) >= 12)).length;
  const any = spans.filter(span => lines.some(row => sharedRun(row.line, span.line) >= 12)).length;
  return {spans: spans.length, same_speaker_repeats: same, any_repeats: any};
}

const runtime = process.env.PROBE_DRY === '1' ? undefined : createRuntime({owner: 'preparation', home: join(out, 'home')}, {agentHome, resourceRoot: root, contentRoot: join(root, 'content'), layout: 'source'});
const profile = expressionAuthorProfile();
const ids = only.length ? only : (await readdir(writes));
const rows = [];
await mkdir(join(out, 'author'), {recursive: true});
for (const id of ids) {
  let packet; // either <id>/task.json (an expression-writes folder) or a flat copy <id>.json
  try { packet = JSON.parse(await readFile(id.endsWith('.json') ? join(writes, id) : join(writes, id, 'task.json'), 'utf8')); } catch { continue; }
  if (!packet.decision_context || !(packet.decision_context.recent_public ?? []).length) continue;
  for (const arm of ['recorded', 'callback']) for (let run = 1; run <= runs; run++) {
    const input = arm === 'recorded' ? packet : callbackArm(packet);
    const rule = arm === 'recorded' ? OLD_RULE : NEW_RULE;
    const systemPrompt = DECISION_AUTHOR_INSTRUCTION.replace(OLD_RULE, rule).replace('using the final artifact transport', 'using the direct text transport')
      + ' Direct text transport: the complete input is above. Return only ordinary story text. No JSON, public framing, file artifact, tool call or acknowledgment is needed.';
    if (process.env.PROBE_DRY === '1') { await writeFile(join(out, 'author', `${id}-${arm}.input.json`), JSON.stringify(input, null, 1)); break; }
    const cwd = join(out, 'work', `${id}-${arm}-${run}`); await mkdir(cwd, {recursive: true});
    let text = '', error; const began = Date.now();
    try {
      const outcome = await runtime.runTask({kind: 'reader', request: {cwd, brief: JSON.stringify(input), systemPrompt, ...profile, pinnedModel: true, tools: '',
        finalOutput: true, finalText: true, maxRequests: 1, timeoutMs: 120000, eventLog: join(cwd, 'events.jsonl'), onEvent: event => {
          const update = event.assistantMessageEvent; if (event.type === 'message_update' && update?.type === 'text_delta') text += String(update.delta ?? '');
        }}});
      if (!text && typeof outcome?.text === 'string') text = outcome.text;
    } catch (caught) { error = String(caught?.message ?? caught); }
    const score = repeats(text, input.decision_context);
    await writeFile(join(out, 'author', `${id}-${arm}-${run}.json`), JSON.stringify({id, arm, run, input, text, error, ms: Date.now() - began, score}, null, 1));
    rows.push({id, arm, run, ms: Date.now() - began, chars: [...text].length, ...score, error});
    console.log(JSON.stringify(rows.at(-1)));
  }
}
const total = arm => rows.filter(r => r.arm === arm).reduce((acc, r) => ({runs: acc.runs + 1, same: acc.same + r.same_speaker_repeats, any: acc.any + r.any_repeats, errors: acc.errors + (r.error ? 1 : 0)}), {runs: 0, same: 0, any: 0, errors: 0});
await writeFile(join(out, 'summary.json'), JSON.stringify({model: profile.model, rows, totals: {recorded: total('recorded'), callback: total('callback')}}, null, 1));
console.log(JSON.stringify({recorded: total('recorded'), callback: total('callback')}));
