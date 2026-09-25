/**
 * SL-52 stage 3: a replay fixture re-created on a FRESH campaign from the current starter (a campaign is a compile snapshot:
 * a changed starter graph never reaches the old campaign). The source fixture gives the turn to replay (turn 1 only: the
 * player's first input after the opening), the recorded Keeper (`baseline.json`, copied) and the opening's record, which is
 * replayed on the new campaign through the emitted kernel's own RPC: the opening's Mod contact rolls (`table.resolve` with the
 * recorded decision and person), its people (`table.apply person` with the recorded name, label and why) and its narration.
 * Receipts of other kinds (a Mod object definition queued for generation) are skipped and listed in turn.json.
 *
 *   node experiments/single-loop-routing/fresh-fixture.mjs --from longgate6-t1 --name longgate6fresh --campaign longgate6fresh
 *
 * Writes fixtures/<name>/workspace.tar.gz and fixtures/<name>-t1/{turn.json,baseline.json}. The source fixture is only read.
 */
import {copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {FIXTURES, readFixture, removeTree} from './fixture.mjs';

const argv = process.argv.slice(2), arg = name => argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
const from = arg('--from'), name = arg('--name'), campaign = arg('--campaign') ?? name;
if (!from || !name) throw new Error('--from and --name are required');
const REPO = resolve(import.meta.dirname, '../..');
const source = readFixture(from), turn = source.turn;
if (turn.turn !== 1) throw new Error('only turn 1 (after the opening) can be re-created on a fresh campaign');
const old = mkdtempSync(join(tmpdir(), 'fresh-fixture-src-')), fresh = mkdtempSync(join(tmpdir(), 'fresh-fixture-'));
const git = (dir, ...args) => {
  const run = spawnSync('git', ['--git-dir', dir, ...args], {encoding: 'utf8', maxBuffer: 64 << 20});
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout;
};
try {
  if (spawnSync('tar', ['-xzf', source.tarball, '-C', old]).status !== 0) throw new Error('tar -x failed');
  const oldCoc = join(old, '.coc'), meta = JSON.parse(readFileSync(join(oldCoc, 'campaigns', turn.campaign, 'campaign.json'), 'utf8'));
  const opening = JSON.parse(git(join(oldCoc, 'repos', `${turn.campaign}.git`), 'show', `${turn.commit_before}:turns/0000.json`));
  const steps = [['campaign.create', {id: campaign, module: turn.module, pregen: meta.investigators[0], play_language: meta.play_language, title: `${campaign} (fresh from the current starter)`}],
    ['table.open', {campaign}]];
  const skipped = [];
  for (const receipt of opening.receipts) {
    const call = opening.calls?.[receipt.call_id]?.result;
    if (receipt.kind === 'roll' && typeof call?.decision === 'string' && call.family === 'mod')
      steps.push(['table.resolve', {campaign, call_id: receipt.call_id, action: {decision: call.decision, intent: 'social', goal: 'first impression', method: 'meeting',
        target: call.outcome?.target_npc}}]);
    else if (receipt.kind === 'person')
      steps.push(['table.apply', {campaign, call_id: receipt.call_id, effects: [{kind: 'person', who: receipt.name, name: receipt.label, ...(receipt.why ? {why: receipt.why} : {})}]}]);
    else skipped.push({id: receipt.id, kind: receipt.kind});
  }
  const last = Object.keys(opening.calls ?? {}).length + 1;
  steps.push(['table.narrate', {campaign, call_id: `t0-c${last}`, text: opening.text}]);
  const run = spawnSync(process.execPath, [join(REPO, 'build/kernel/rpc.mjs'), '--workspace', fresh, '--content', join(REPO, 'content')],
    {cwd: REPO, input: steps.map(([method, params], index) => JSON.stringify({id: String(index), method, params})).join('\n') + '\n', encoding: 'utf8'});
  const frames = run.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)).filter(frame => !frame.progress);
  for (const frame of frames) if (!frame.ok) throw new Error(`step ${steps[Number(frame.id)][0]} failed: ${JSON.stringify(frame.error)}`);
  const coc = join(fresh, '.coc'), repo = join(coc, 'repos', `${campaign}.git`), before = git(repo, 'rev-parse', '--short', 'HEAD').trim();
  const created = JSON.parse(readFileSync(join(coc, 'campaigns', campaign, 'campaign.json'), 'utf8'));
  const stage = mkdtempSync(join(tmpdir(), 'fresh-fixture-stage-'));
  try {
    for (const [root, entry] of [['campaigns', campaign], ['repos', `${campaign}.git`], ['modules', turn.module], ['mods', 'packages']])
      cpSync(join(coc, root, entry), join(stage, '.coc', root, entry), {recursive: true});
    const assets = join(stage, '.coc/modules', turn.module, 'assets');
    if (existsSync(assets)) removeTree(assets);
    mkdirSync(join(FIXTURES, name), {recursive: true});
    if (spawnSync('tar', ['-czf', join(FIXTURES, name, 'workspace.tar.gz'), '-C', stage, '.coc']).status !== 0) throw new Error('tar -c failed');
  } finally { removeTree(stage); }
  const dir = join(FIXTURES, `${name}-t1`);
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, 'turn.json'), JSON.stringify({campaign, module: turn.module, turn: 1, commit_before: before, player_input: turn.player_input,
    tarball: `../${name}/workspace.tar.gz`, source: {fixture: from, campaign: turn.campaign, commit_before: turn.commit_before},
    fresh: {module_digest: created.module_digest, module_generation: created.module_generation, opening_steps: steps.slice(2).map(([method, params]) => method === 'table.narrate' ? [method, {call_id: params.call_id}] : [method, params]),
      skipped}}, null, 1) + '\n');
  copyFileSync(join(source.dir, 'baseline.json'), join(dir, 'baseline.json'));
  console.log(JSON.stringify({fixture: `${name}-t1`, campaign, commit_before: before, module_digest: created.module_digest, skipped}));
} finally { removeTree(old); removeTree(fresh); }
