/**
 * Replay evaluation (R1): pick paired cases from retained live runs and export their C0 checkpoints.
 *
 *   node tests/replay/select-cases.ts --homes <h1,h2,...> --runs '<regex on campaign id>' --out <dir> [--per 1] [--salt r1]
 *
 * A case is one kernel turn of one source campaign. Its action class is read from structure only -- the tools the
 * source Keeper called on that turn -- never from the player's or the Keeper's text:
 *   check      a `resolve` was called (a roll the rules run)
 *   act        a Mod or `apply` effect, no roll
 *   consult    only reads (`look`, `lookup`, `recall`) before the delivery
 *   talk       the delivery alone
 *   unsettled  the source turn did not settle normally
 * Selection is stratified by book (the campaign id's prefix) and class, ordered by a salted digest so it is
 * reproducible and not hand-picked. Cases whose C0 cannot be cut (no commit awaiting that line) are skipped.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitBefore, exportCheckpoint, type Row } from './checkpoint.ts';

const readJson = (path: string) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
export function actionClass(tools: string[], settle: string) {
  if (settle !== 'settled') return 'unsettled';
  if (tools.includes('resolve')) return 'check';
  if (tools.some(t => ['mod', 'apply'].includes(t))) return 'act';
  if (tools.some(t => ['look', 'lookup', 'recall'].includes(t))) return 'consult';
  return 'talk';
}

/** Every played turn of the matching campaigns under these homes, with its kernel turn number. */
export function inventory(homes: string[], pattern: RegExp) {
  const rows: Row[] = [];
  for (const home of homes) {
    const root = join(home, '.coc', 'playtests');
    if (!existsSync(root)) continue;
    for (const run of readdirSync(root).sort()) {
      const daemon = readJson(join(root, run, 'daemon.json'));
      if (!daemon?.campaign || !pattern.test(daemon.campaign) || run.includes('-setup-')) continue;
      const campaign = daemon.campaign, turnsDir = join(home, '.coc', 'campaigns', campaign, 'turns');
      if (!existsSync(turnsDir)) continue;
      const byText = new Map<string, number>();
      for (const f of readdirSync(turnsDir)) { const r = readJson(join(turnsDir, f)); if (typeof r?.player_text === 'string' && typeof r.turn === 'number') byText.set(r.player_text, r.turn); }
      for (const f of readdirSync(join(root, run)).filter(f => /^turn-\d+\.json$/.test(f))) {
        const t = readJson(join(root, run, f)); if (!t) continue;
        const kernelTurn = byText.get(t.player_text);
        if (kernelTurn === undefined) continue;
        const tools = (t.tools ?? []).map((x: Row) => x.name).filter((n: string) => n !== 'output');
        rows.push({ home, run, campaign, book: campaign.split('-')[0], config: campaign.split('-').slice(2).join('-'), model: daemon.model_requested, driver_turn: t.turn, kernel_turn: kernelTurn, tools, settle: t.settle_class, wall_seconds: t.wall_seconds, class: actionClass(tools, t.settle_class) });
      }
    }
  }
  return rows;
}

function args(argv: string[]) { const a: Row = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i]; return a; }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = args(process.argv.slice(2)), homes = String(a.homes).split(',').map(h => resolve(h)), out = resolve(a.out), per = Number(a.per ?? 1), salt = a.salt ?? 'r1';
  const rows = inventory(homes, new RegExp(a.runs));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'inventory.json'), JSON.stringify(rows, null, 2) + '\n');
  const key = (r: Row) => createHash('sha256').update(salt + '|' + r.campaign + '|' + r.kernel_turn).digest('hex');
  const chosen: Row[] = [];
  for (const book of [...new Set(rows.map(r => r.book))].sort())
    for (const cls of ['check', 'act', 'consult', 'talk', 'unsettled']) {
      const pool = rows.filter(r => r.book === book && r.class === cls && r.kernel_turn >= 2).sort((x, y) => key(x).localeCompare(key(y)));
      let taken = 0;
      for (const r of pool) {
        if (taken >= per) break;
        try { commitBefore(join(r.home, '.coc', 'repos', r.campaign + '.git'), r.kernel_turn); } catch { continue; }
        const dir = join(out, `${r.campaign}-t${String(r.kernel_turn).padStart(4, '0')}`);
        try { const m = existsSync(dir) ? readJson(join(dir, 'manifest.json')) : exportCheckpoint({ home: r.home, campaign: r.campaign, turn: r.kernel_turn, out: dir }); chosen.push({ ...r, checkpoint: dir, grade: m.grade }); taken++; }
        catch (error) { console.error(`skip ${r.campaign} t${r.kernel_turn}: ${error instanceof Error ? error.message : error}`); }
      }
    }
  writeFileSync(join(out, 'cases.json'), JSON.stringify({ salt, homes, pattern: a.runs, created_at: new Date().toISOString(), counts: Object.fromEntries(['check', 'act', 'consult', 'talk', 'unsettled'].map(c => [c, rows.filter(r => r.class === c).length])), cases: chosen }, null, 2) + '\n');
  console.log(JSON.stringify({ inventory: rows.length, chosen: chosen.map(c => `${c.campaign} t${c.kernel_turn} ${c.class} ${c.model}`) }, null, 1));
}
