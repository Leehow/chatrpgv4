/**
 * SL-19: a fixture variant whose only difference from its source is world state set before the turn -- what a Keeper
 * write on an earlier turn would have left in `world.json` (a pinned archetype profile, a Keeper-written tactic). The
 * source fixture is only read: its tarball is extracted to a scratch workspace, positioned at `commit_before`, the
 * patch is merged into the campaign's `world.json` (one level deep: `{npc_defense: {<handle>: {...}}}` sets that one
 * entry), committed in the campaign's own sidecar repository as one commit on top of `commit_before`, and the workspace
 * is tarred. turn.json's `commit_before` names the new commit; `commit_after` and baseline.json are the source's.
 *
 *   node experiments/single-loop-routing/world-variant.mjs --from gate6-t3 --name gate6-t3-card --patch patch.json --note "..."
 *
 * Writes fixtures/<name>/{workspace.tar.gz,turn.json,baseline.json,variant.json}.
 */
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {FIXTURES, materialize, readFixture, removeTree} from './fixture.mjs';

const argv = process.argv.slice(2), arg = name => argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
const from = arg('--from'), name = arg('--name'), patchFile = arg('--patch'), note = arg('--note') ?? '';
if (!from || !name || !patchFile) throw new Error('--from, --name and --patch are required');
const source = readFixture(from), patch = JSON.parse(readFileSync(patchFile, 'utf8'));
const campaign = source.turn.campaign, workspace = materialize(from);
const sha = path => spawnSync('shasum', ['-a', '256', path], {encoding: 'utf8'}).stdout.split(' ')[0];
try {
  const git = (...args) => {
    const run = spawnSync('git', ['--git-dir', join(workspace, '.coc/repos', `${campaign}.git`), '--work-tree', join(workspace, '.coc/campaigns', campaign),
      '-c', 'user.name=fixture', '-c', 'user.email=fixture@localhost', ...args], {encoding: 'utf8'});
    if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
    return run.stdout.trim();
  };
  git('reset', '--hard', source.turn.commit_before);
  const path = join(workspace, '.coc/campaigns', campaign, 'world.json'), world = JSON.parse(readFileSync(path, 'utf8'));
  for (const [key, value] of Object.entries(patch))
    world[key] = value && typeof value === 'object' && !Array.isArray(value) ? {...(world[key] ?? {}), ...value} : value;
  writeFileSync(path, JSON.stringify(world, null, 2) + '\n');
  git('add', 'world.json');
  git('commit', '-q', '-m', `fixture variant ${name}: ${note}`);
  const commit = git('rev-parse', '--short', 'HEAD');
  const dir = join(FIXTURES, name);
  mkdirSync(dir, {recursive: true});
  const tar = spawnSync('tar', ['-czf', join(dir, 'workspace.tar.gz'), '-C', workspace, '.coc'], {encoding: 'utf8'});
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
  const {tarball: _shared, ...turn} = source.turn;
  writeFileSync(join(dir, 'turn.json'), JSON.stringify({...turn, commit_before: commit, variant_of: {fixture: from, commit_before: source.turn.commit_before}}, null, 1) + '\n');
  copyFileSync(join(source.dir, 'baseline.json'), join(dir, 'baseline.json'));
  writeFileSync(join(dir, 'variant.json'), JSON.stringify({derived_from: from, source_tarball_sha256: sha(source.tarball), change: 'world.json patched before the turn and committed on top of commit_before',
    note, patch, commit_before: commit}, null, 1) + '\n');
  console.log(JSON.stringify({fixture: name, commit_before: commit, patched: Object.keys(patch)}));
} finally { removeTree(workspace); }
