/**
 * SL-13: replay fixtures from a live gate's campaign (a `.coc` home the play driver wrote, e.g. a worktree's), one per
 * turn, sharing one workspace tarball. The source is only read: the campaign, its sidecar repository, the module and
 * the Mod packages are copied into a scratch stage, the stage's copy is set to the last recorded commit (the live work
 * tree carries later background-lane writes and untracked job files), and the stage is tarred.
 *
 *   node experiments/single-loop-routing/gate-fixture.mjs --home <dir containing .coc> --campaign <id> --playtest <run dir>
 *     --turns 1,2,3 --name gate3
 *
 * Writes fixtures/<name>/workspace.tar.gz and fixtures/<name>-t<N>/{turn.json,baseline.json} (turn.json names the shared
 * tarball). baseline.json is the recorded Keeper of that turn, read from the play driver's RPC event log: every assistant
 * message's tool calls in order, whether each model-origin tool call was taken (`tool_execution_end`), the turn's §32
 * admission rows from the campaign telemetry, and the receipts of the turn record. A clerk (policy-origin) write the live
 * run made is put at the head of the first recorded Keeper message sent after it and marked `clerk_live: true`: the replayed Keeper does it
 * only when the replay's own clerk did not (the replay drops a recorded call the run already carried out), so a run whose
 * clerk misses it still reaches the live state, with the extra model step counted.
 */
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {FIXTURES, removeTree} from './fixture.mjs';

const argv = process.argv.slice(2), arg = (name, fallback) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
const home = resolve(arg('--home', '.')), campaign = arg('--campaign'), playtest = resolve(arg('--playtest'));
const turns = String(arg('--turns', '1')).split(',').map(Number), name = arg('--name', campaign);
if (!campaign || !playtest) throw new Error('--campaign and --playtest are required');
const coc = join(home, '.coc'), repo = join(coc, 'repos', `${campaign}.git`);
const git = (...args) => {
  const run = spawnSync('git', ['--git-dir', repo, ...args], {encoding: 'utf8', maxBuffer: 64 << 20});
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout;
};
/**
 * The commit whose subject is `turn <n>:` (the kernel's turn commit), by the sidecar repository's own log. A turn the
 * kernel did not commit on its own (gate #4's turn 1 landed inside turn 2's commit) is the oldest commit whose tree holds
 * its record: the state before it is then the previous turn's commit, and its record is read from where it first appears.
 */
const log = git('log', '--format=%h %s').split('\n').filter(Boolean).map(line => ({sha: line.slice(0, line.indexOf(' ')), subject: line.slice(line.indexOf(' ') + 1)}));
const holds = (sha, turn) => spawnSync('git', ['--git-dir', repo, 'cat-file', '-e', `${sha}:turns/${String(turn).padStart(4, '0')}.json`]).status === 0;
const commitOf = turn => log.find(entry => entry.subject.startsWith(`turn ${turn}:`))?.sha ?? [...log].reverse().find(entry => holds(entry.sha, turn))?.sha;
const campaignRecord = JSON.parse(readFileSync(join(coc, 'campaigns', campaign, 'campaign.json'), 'utf8'));
const module = campaignRecord.module ?? campaignRecord.module_id;
if (!module) throw new Error('campaign.json names no module');

// The shared workspace: a scratch copy, positioned at the last recorded turn, then tarred.
const last = commitOf(Math.max(...turns));
const stage = mkdtempSync(join(tmpdir(), 'single-loop-gate-fixture-'));
try {
  for (const [root, entry] of [['campaigns', campaign], ['repos', `${campaign}.git`], ['modules', module], ['mods', 'packages']])
    cpSync(join(coc, root, entry), join(stage, '.coc', root, entry), {recursive: true});
  const copy = ['--git-dir', join(stage, '.coc/repos', `${campaign}.git`), '--work-tree', join(stage, '.coc/campaigns', campaign)];
  for (const args of [['reset', '--hard', last], ['clean', '-fdq']]) {
    const run = spawnSync('git', [...copy, ...args], {encoding: 'utf8'});
    if (run.status !== 0) throw new Error(`stage git ${args.join(' ')}: ${run.stderr}`);
  }
  const assets = join(stage, '.coc/modules', module, 'assets');
  if (existsSync(assets)) removeTree(assets);
  mkdirSync(join(FIXTURES, name), {recursive: true});
  const tar = spawnSync('tar', ['-czf', join(FIXTURES, name, 'workspace.tar.gz'), '-C', stage, '.coc'], {encoding: 'utf8'});
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
} finally { removeTree(stage); }

const events = readFileSync(join(playtest, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const telemetry = readFileSync(join(coc, 'campaigns', campaign, 'telemetry.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const textOf = message => (message?.content ?? []).map(block => block.text ?? '').join('');

for (const turn of turns) {
  const record = JSON.parse(git('show', `${commitOf(turn)}:turns/${String(turn).padStart(4, '0')}.json`));
  const input = record.player_text;
  const start = events.findIndex(event => event.type === 'message_end' && event.message?.role === 'user' && textOf(event.message) === input);
  if (start < 0) throw new Error(`turn ${turn}: the player input is not in the event log`);
  const end = events.findIndex((event, index) => index > start && event.type === 'agent_settled');
  const slice = events.slice(start, end < 0 ? undefined : end + 1);
  const results = new Map(slice.filter(event => event.type === 'tool_execution_end').map(event => [event.toolCallId, event]));
  const providerCalls = telemetry.filter(row => row.lane === 'provider-call' && row.turn === turn);
  const calls = slice.filter(event => event.type === 'message_end' && event.message?.role === 'assistant').map((event, index) => ({
    at: new Date(event.message.timestamp).toISOString(), provider_ms: providerCalls[index]?.ms ?? null, stop_reason: event.message.stopReason, model: event.message.model ?? null,
    usage: {input: event.message.usage?.input ?? null, output: event.message.usage?.output ?? null, cache_read: event.message.usage?.cacheRead ?? null},
    tool_calls: (event.message.content ?? []).filter(block => block.type === 'toolCall').map(block => ({name: block.name, arguments: block.arguments, id: block.id}))}));
  // The clerk's writes of the live run (policy origin), from the campaign telemetry's tool rows, in their order. Each is
  // put into the first recorded Keeper message that the live run sent after it (the replayed Keeper does it only when the
  // replay's own clerk did not): gate #3's turn-3 move came before the Keeper's first message, gate #4's turn-1 move after
  // it (the Keeper's clue unlocked that exit), and a move put before the clue it waited on replays a different turn.
  const clerk = telemetry.filter(row => row.turn === turn && row.origin === 'policy' && row.tool && row.call_id && row.ok !== false)
    .map(row => ({row, basis: row.basis ?? null})).filter(({basis}) => basis?.read === 'table.apply.options' && basis.row?.effect?.kind === 'move')
    .map(({row, basis}) => ({at: Date.parse(row.started_at ?? ''), item: {name: 'apply', arguments: {effects: [{kind: 'move', to: basis.row.effect.to}]}, id: `clerk-live:${row.call_id}`, clerk_live: true}}));
  for (const {at, item} of [...clerk].reverse()) {
    if (!calls.length) break;
    const after = calls.findIndex(call => Number.isFinite(at) && Date.parse(call.at) > at);
    calls[after < 0 ? calls.length - 1 : after].tool_calls.unshift(item);
  }
  // The model-origin tool rows, in message order, with whether each was taken (a clerk write is marked, and was).
  const tools = calls.flatMap(call => call.tool_calls.map(toolCall => toolCall.clerk_live ? {tool: toolCall.name, call_id: toolCall.id, ok: true, clerk_live: true}
    : {tool: toolCall.name, call_id: toolCall.id, ok: results.get(toolCall.id)?.isError !== true,
      // SL-24: why the live host refused it, from the refusal's closed `details.reason` (a review that ran out of time is
      // the host's failure, not the Keeper's choice, and a replay can put the same call to today's admission).
      ...(results.get(toolCall.id)?.isError === true && results.get(toolCall.id)?.result?.details?.coc_error?.details?.reason
        ? {host_refusal: results.get(toolCall.id).result.details.coc_error.details.reason} : {})}));
  const admissions = telemetry.filter(row => row.lane === 'admission' && row.turn === turn).map(row => ({verb: row.verb, verdict: row.verdict ?? null, ms: row.ms ?? null, origin: row.origin ?? 'model'}));
  // The live rows: what the live kernel took (a refused call is no row), in the shape `matchBaseline` compares.
  const actions = [];
  for (const call of calls) for (const tool of call.tool_calls) {
    const refused = results.get(tool.id)?.isError === true;
    const timedOut = refused && results.get(tool.id)?.result?.details?.coc_error?.details?.reason === 'review_timeout';
    if (!tool.clerk_live && refused && !timedOut) continue;
    // SL-24: a call the live host refused only because its review ran out of time is an expected row, marked, so a replay
    // shows whether today's admission lands it.
    if (timedOut && tool.name === 'apply') { for (const effect of tool.arguments.effects ?? []) actions.push({verb: 'apply', kind: effect.kind,
      target: effect.to ?? effect.who ?? effect.clue ?? effect.name ?? null, live_refused: 'review_timeout'}); continue; }
    if (tool.name === 'apply') for (const effect of tool.arguments.effects ?? []) actions.push({verb: 'apply', kind: effect.kind, target: effect.to ?? effect.who ?? effect.clue ?? effect.name ?? null,
      ...(tool.clerk_live ? {clerk_live: true} : {}), ...(effect.minutes ?? effect.travel_minutes ? {minutes: effect.minutes ?? effect.travel_minutes} : {})});
    else if (tool.name === 'resolve') { const action = tool.arguments.action ?? {}; actions.push({verb: 'resolve', ...(action.decision ? {decision: action.decision} : {}),
      ...(action.skill ? {skill: action.skill} : {}), target: action.target ?? null, intent: action.intent ?? null, modifiers: action.modifiers ?? null}); }
    else actions.push({verb: tool.name});
  }
  if (calls.at(-1)?.stop_reason === 'stop' && !calls.at(-1).tool_calls.length) actions.push({verb: 'narrate', implicit: true});
  const commitBefore = commitOf(turn - 1), commitAfter = commitOf(turn);
  const baseline = {source: {events: `${playtest}/events.jsonl`, record: `.coc/repos/${campaign}.git ${commitAfter}:turns/${String(turn).padStart(4, '0')}.json`,
    note: 'Recorded Keeper of the live gate; a live clerk write heads the first recorded message sent after it, marked clerk_live.'},
  keeper_model: calls[0]?.model ?? null, player_text_recorded: input, llm_calls: calls.length, llm_ms_total: calls.reduce((sum, call) => sum + (call.provider_ms ?? 0), 0),
  calls, tools, admissions, actions,
  receipts: record.receipts.map(receipt => ({id: receipt.id, kind: receipt.kind, ...(receipt.kind === 'move' ? {to: receipt.to} : {}),
    ...(receipt.kind === 'roll' ? {decision: receipt.decision ?? null, skill: receipt.skill ?? null, npc: receipt.npc ?? null, level: receipt.level ?? null} : {}),
    ...(receipt.kind === 'person' ? {who: receipt.who} : {}), ...(receipt.kind === 'clue' ? {clue: receipt.clue} : {}), ...(receipt.kind === 'handout' ? {handout: receipt.handout} : {})}))};
  const dir = join(FIXTURES, `${name}-t${turn}`);
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, 'turn.json'), JSON.stringify({campaign, module, turn, commit_before: commitBefore, commit_after: commitAfter, player_input: input,
    tarball: `../${name}/workspace.tar.gz`, source: {campaign: `${coc}/campaigns/${campaign}`, playtest}}, null, 1) + '\n');
  writeFileSync(join(dir, 'baseline.json'), JSON.stringify(baseline, null, 1) + '\n');
  console.log(JSON.stringify({turn, commit_before: commitBefore, commit_after: commitAfter, llm_calls: calls.length, tools: tools.map(tool => `${tool.tool}${tool.ok ? '' : '!'}${tool.clerk_live ? '(clerk)' : ''}`), admissions: admissions.length}));
}
