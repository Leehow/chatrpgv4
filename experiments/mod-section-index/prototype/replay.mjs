/**
 * The prototype over real turns: for each held-out turn, a sandbox copy of its campaign is reset to the commit of the
 * turn before, the kernel opens the table and takes the player's words, and the capsule it hands back is what the
 * selector reads. Output: one row per turn with the selection, the capsule's gate facts and the bytes, scored later
 * by score.py against the judges' rule labels.
 *
 *   node experiments/mod-section-index/prototype/replay.mjs --sample <sample.json> --homes <dir> --out <rows.jsonl> [--limit N]
 */
import {readFileSync, appendFileSync, writeFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {KernelClient} from '../../../extensions/kernel/client.ts';
import {ROOT} from '../sections.mjs';
import {select} from './select.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((v, i, a) => v.startsWith('--') ? [v.slice(2), a[i + 1]] : []).filter(Boolean));
const sample = JSON.parse(readFileSync(args.sample, 'utf8')).slice(0, Number(args.limit ?? 0) || Infinity);
const RPC = join(ROOT, 'build/kernel/rpc.mjs'), CONTENT = join(ROOT, 'content');
const byCampaign = new Map();
for (const row of sample) byCampaign.set(row.campaign, [...(byCampaign.get(row.campaign) ?? []), row]);
writeFileSync(args.out, '');
const env = {...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};

function resetTo(home, campaign, turn) {
  const gitDir = join(home, '.coc/repos', `${campaign}.git`), work = join(home, '.coc/campaigns', campaign);
  if (!existsSync(gitDir)) throw new Error('no repository');
  // `reset --hard` moves the branch with HEAD, so a later turn's commit would vanish from `git log`; the original tip is
  // kept under its own ref the first time this sandbox is touched, and every lookup reads from there.
  try { execFileSync('git', ['--git-dir', gitDir, 'rev-parse', '--verify', '-q', 'refs/replay/tip'], {env, stdio: 'pipe'}); }
  catch { execFileSync('git', ['--git-dir', gitDir, 'update-ref', 'refs/replay/tip', 'HEAD'], {env}); }
  const log = execFileSync('git', ['--git-dir', gitDir, 'log', '--format=%H %s', 'refs/replay/tip'], {encoding: 'utf8', env});
  const line = log.split('\n').find(l => l.slice(41).startsWith(`turn ${turn}:`) || l.slice(41) === `turn ${turn}`);
  if (!line) throw new Error(`no commit for turn ${turn}`);
  execFileSync('git', ['--git-dir', gitDir, '--work-tree', work, 'reset', '-q', '--hard', line.slice(0, 40)], {env});
  execFileSync('git', ['--git-dir', gitDir, '--work-tree', work, 'clean', '-q', '-fd'], {env});
}

let done = 0, failed = 0;
for (const [campaign, rows] of byCampaign) {
  const home = join(args.homes, campaign.slice(0, 13));
  try {
    if (!existsSync(home)) execFileSync('zsh', [join(ROOT, 'experiments/mod-section-index/prototype/sandbox.sh'), campaign, home], {stdio: 'pipe'});
  } catch (error) { for (const row of rows) { failed++; appendFileSync(args.out, JSON.stringify({sid: row.sid, error: `sandbox: ${String(error).slice(0, 160)}`}) + '\n'); } continue; }
  for (const row of rows) {
    const began = Date.now();
    let kernel;
    try {
      resetTo(home, campaign, row.turn - 1);
      kernel = new KernelClient({command: [process.execPath, RPC, '--workspace', home, '--content', CONTENT], cwd: ROOT, env, inheritEnv: false, timeoutMs: 60000});
      const call = (method, params = {}) => kernel.call(method, {campaign, ...params});
      await call('table.open');
      const opened = await call('table.player_input', {text: row.player});
      const capsule = opened.capsule ?? (await call('table.capsule'));
      const settings = {stall_turns: capsule?.mods?.active?.['keeper-pacing']?.settings?.stall_turns ?? 2};
      const picked = await select({capsule, player: row.player, settings});
      appendFileSync(args.out, JSON.stringify({sid: row.sid, campaign, turn: row.turn, capsule_turn: capsule?.turn?.number, present: (capsule?.present ?? []).map(p => p?.name),
        ...picked, wall_ms: Date.now() - began}) + '\n');
      done++;
    } catch (error) {
      failed++; appendFileSync(args.out, JSON.stringify({sid: row.sid, campaign, turn: row.turn, error: String(error).slice(0, 240)}) + '\n');
    } finally { try { kernel?.close(); } catch { /* closed */ } }
  }
}
console.log(JSON.stringify({campaigns: byCampaign.size, turns: sample.length, done, failed}));
