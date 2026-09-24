/**
 * SL-13 follow-up: the reads a fixture's first run step makes, with no model and no Jev. Materializes the fixture,
 * positions it before the turn, reads `table.capsule`, `table.status`, `table.apply.options` and `table.resolve.options`
 * from the emitted kernel, and prints the candidates the builder issues, the compile's feature rows, and whether the
 * compile reaches any candidate (§135.30). Read-only instrument: the workspace is a disposable copy.
 *
 *   node experiments/single-loop-routing/probe-reads.mjs --fixture gate4-t1 [--out file.json]
 */
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {materialize, readFixture, removeTree} from './fixture.mjs';
import {startKernel} from './kernel.mjs';
import {buildCandidates} from '../../runtime/jev/candidates.ts';
import {compileRows} from '../../runtime/jev/compile-rows.ts';
import {askedFamilies, compileReaches, predicateOf} from '../../runtime/jev/route-compile.ts';

const argv = process.argv.slice(2), arg = name => argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
const name = arg('--fixture') ?? 'gate4-t1';
const {turn} = readFixture(name), workspace = materialize(name), campaign = turn.campaign;
try {
  const reset = spawnSync('git', ['--git-dir', join(workspace, '.coc/repos', `${campaign}.git`), '--work-tree', join(workspace, '.coc/campaigns', campaign), 'reset', '--hard', turn.commit_before], {encoding: 'utf8'});
  if (reset.status !== 0) throw new Error(reset.stderr);
  const kernel = startKernel({workspace});
  try {
    const opened = await kernel.call('table.player_input', {campaign, text: turn.player_input}).catch(error => ({error: String(error.message)}));
    if (opened?.error) throw new Error(opened.error);
    const read = method => kernel.call(method, {campaign}).catch(error => ({error: String(error.message)}));
    const [capsule, status, applyOptions, resolveOptions] = [await read('table.capsule'), await read('table.status'), await read('table.apply.options'), await read('table.resolve.options')];
    const candidates = buildCandidates({capsule, applyOptions, resolveOptions}, turn.player_input);
    const rows = compileRows({capsule, applyOptions, resolveOptions});
    const moves = (applyOptions.candidates ?? []).filter(row => row?.effect?.kind === 'move')
      .map(row => ({to: row.effect.to, unlock_when: row.description?.unlock_when ?? null, guarded_by: row.guarded_by ?? null}));
    const out = {fixture: name, scene: capsule?.where?.scene ?? null, candidates: candidates.map(value => value.key),
      reachable: candidates.filter(value => predicateOf(value, rows)).map(value => value.key), asked: askedFamilies(rows),
      compile_reaches: compileReaches(candidates, rows), move_rows: moves, errors: Object.fromEntries(Object.entries({capsule, status, applyOptions, resolveOptions}).filter(([, value]) => value?.error).map(([key, value]) => [key, value.error])),
      rows: Object.fromEntries(Object.entries(rows).map(([family, list]) => [family, argv.includes('--describe') ? list : list.map(row => row.id)])),
      ...(argv.includes('--describe') ? {present: capsule?.present ?? null, obligations: applyOptions.obligations ?? null, apply_rows: applyOptions.candidates ?? null, assets: capsule?.where?.assets ?? null} : {})};
    const text = JSON.stringify(out, null, 1);
    if (arg('--out')) writeFileSync(arg('--out'), text + '\n');
    console.log(text);
  } finally { await kernel.close(); }
} finally { removeTree(workspace); }
