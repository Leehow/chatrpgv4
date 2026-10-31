/**
 * Replay evaluation (R1): a C0 checkpoint -- the authoritative state of one campaign just before a player line enters
 * the turn's preprocessing -- exported as an immutable seed home, and verified.
 *
 *   node tests/replay/checkpoint.ts export --home <workspace> --campaign <id> --turn <N> --out <dir> [--live]
 *   node tests/replay/checkpoint.ts verify <dir>
 *
 * Layout of a checkpoint (nothing the model may read sits outside `home/`, and nothing that is not starting state
 * sits inside it):
 *   manifest.json   what this is: source, boundary, git commit, grade, gaps, every component's digest
 *   input.json      the player's line for turn N, kept apart from the home and injected by the runner
 *   home/.coc/...   the seed home: campaign, its sidecar repository, module, caches, as of C0
 *
 * Two capture modes:
 *   historic (default)  The campaign directory is rebuilt from the sidecar commit whose `turn.json` reads
 *                       `{turn: N, state: awaiting_player}`, and the repository is cut back to that commit with
 *                       later objects pruned. Stores outside git are taken only if their files were last written at
 *                       or before that commit; later files are left out and listed as gaps. Grade B at best: the
 *                       writes background jobs made after that commit and before line N arrived are not on record.
 *   --live              The workspace is at rest (no process holds it) and its turn is N: the files are taken as they
 *                       are, uncommitted background writes included.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, cpSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Row = Record<string, any>;
export const FORMAT = 'pi-coc-replay-checkpoint/1';
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const validId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);

export function sha256File(path: string) {
  const hash = createHash('sha256'), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW), buffer = Buffer.allocUnsafe(256 * 1024);
  try { let n; while ((n = readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, n)); } finally { closeSync(fd); }
  return hash.digest('hex');
}
export function filesUnder(root: string, base = root): string[] {
  if (!existsSync(root)) return [];
  const st = lstatSync(root);
  if (st.isSymbolicLink()) throw new Error('A checkpoint never holds links: ' + root);
  if (st.isFile()) return [relative(base, root)];
  return readdirSync(root).sort().flatMap(name => filesUnder(join(root, name), base));
}
/** One digest per file under `.coc`, and one for the whole tree. Paths are relative, so two restores compare. */
export function treeDigest(home: string, skip: (path: string) => boolean = () => false) {
  const files: Row = {};
  for (const path of filesUnder(join(home, '.coc'), home)) if (!skip(path)) files[path] = sha256File(join(home, path));
  return { files, tree_sha256: createHash('sha256').update(JSON.stringify(Object.entries(files))).digest('hex') };
}
function git(gitDir: string, args: string[], input?: Buffer) {
  const result = spawnSync('git', ['--git-dir', gitDir, ...args], { input, maxBuffer: 1024 ** 3, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString().trim()}`);
  return result.stdout;
}
/** Processes holding any file under these paths: a checkpoint is cut only from a workspace at rest. */
export function holders(paths: string[]) {
  const result = spawnSync('/usr/sbin/lsof', ['-b', '-w', '-nP', '-u', String(process.getuid?.()), '-Fpn'], { encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 ** 2 });
  if (result.error || ![0, 1].includes(result.status ?? -1)) throw new Error('Cannot establish that the workspace is at rest');
  const found: Row[] = []; let pid = 0;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    if (line.startsWith('n') && pid !== process.pid && paths.some(p => line.slice(1) === p || line.slice(1).startsWith(p + '/'))) found.push({ pid, path: line.slice(1) });
  }
  return found;
}
function codeVersion(root: string) {
  const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || null;
  const diff = spawnSync('git', ['-C', root, 'diff', 'HEAD'], { maxBuffer: 1024 ** 3 }).stdout ?? Buffer.alloc(0);
  const untracked = spawnSync('git', ['-C', root, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).stdout.trim();
  return { root, head, dirty_sha256: diff.length || untracked ? createHash('sha256').update(diff).update(untracked).digest('hex') : null };
}

/** The sidecar commit at which the campaign waits for line N. */
export function commitBefore(gitDir: string, turn: number) {
  for (const line of git(gitDir, ['log', '--format=%H %cI', 'HEAD']).toString().trim().split('\n')) {
    const [commit, at] = line.split(' ');
    let cursor: Row | null = null;
    try { cursor = JSON.parse(git(gitDir, ['show', `${commit}:turn.json`]).toString()); } catch { continue; }
    if (cursor?.turn === turn && cursor.state === 'awaiting_player') return { commit, at };
    if (typeof cursor?.turn === 'number' && cursor.turn < turn) break;
  }
  throw new Error(`No sidecar commit leaves the campaign awaiting line ${turn}`);
}
/** The commit that closed turn N: the player's line comes from it, and the original outcome is named by it. */
function commitAfter(gitDir: string, turn: number) {
  const path = `turns/${String(turn).padStart(4, '0')}.json`;
  let found: Row | null = null;
  for (const line of git(gitDir, ['log', '--format=%H %cI', 'HEAD']).toString().trim().split('\n')) {
    const [commit, at] = line.split(' ');
    let record: Row | null = null;
    try { record = JSON.parse(git(gitDir, ['show', `${commit}:${path}`]).toString()); } catch { }
    if (!record) break;
    found = { commit, at, player_text: typeof record.player_text === 'string' ? record.player_text : null, closed_by: record.closed_by ?? null };
  }
  return found;
}

/**
 * Stores outside the campaign directory that the play host or kernel reads for this campaign. Each entry says what
 * it is, so a gap names a thing and not only a path. Static book material is shared read-only content.
 */
export function storesFor(campaign: string, module: string) {
  const chapter = createHash('sha256').update(campaign).digest('hex').slice(0, 32);
  return [
    { path: `modules/${module}`, what: 'bound module (book source, graph, generations)' },
    { path: `module-campaigns/${campaign}`, what: "campaign's module copy and its reading caches" },
    { path: 'mods/packages', what: 'installed Mod packages' },
    { path: 'npc', what: 'NPC lane attempts' },
    { path: 'npc-voice', what: 'NPC voice card reviews (cache)' },
    { path: 'map-words', what: 'map presentation words (cache)' },
    { path: 'ui-words', what: 'UI words (cache)' },
    { path: `memory-decisions/${campaign}`, what: 'memory admission decisions' },
    { path: `memory-drafts/${campaign}`, what: 'memory drafts' },
    { path: `chapter-scope/${chapter}.json`, what: "campaign's chapter scope" },
    { path: 'chapter-scope', what: 'resident chapter views (cache)', only: (name: string) => name.startsWith('resident-') },
    { path: `narrate-journal/${campaign}.json`, what: 'kernel narrate journal' },
    { path: 'document-presentations', what: 'document presentation cache' },
    { path: 'source-transcripts', what: 'page transcripts of the book (static book text, shared)', static: true },
  ];
}

function copyStore(source: string, target: string, cutoffMs: number | null, gaps: Row[], what: string, only?: (name: string) => boolean, isStatic = false) {
  for (const path of filesUnder(source)) {
    if (only && !only(path.split('/')[0])) continue;
    const from = join(source, path), to = join(target, path), st = statSync(from);
    if (/\.lock$|\.owner$|-shm$/.test(path)) continue;
    if (cutoffMs !== null && !isStatic && st.mtimeMs > cutoffMs) { gaps.push({ kind: 'written_after_c0', store: what, path: to }); continue; }
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { preserveTimestamps: true, mode: constants.COPYFILE_FICLONE });
  }
}
/** The source-reading database cut to this campaign's scopes, through SQLite's own backup (consistent even with a WAL). */
function copySourceReading(home: string, out: string, campaign: string, module: string, gaps: Row[], historic: boolean) {
  const from = join(home, '.coc', 'source-reading.sqlite');
  if (!existsSync(from)) return;
  const to = join(out, '.coc', 'source-reading.sqlite');
  const backup = spawnSync('sqlite3', [from, `.backup '${to.replaceAll("'", "''")}'`], { encoding: 'utf8' });
  if (backup.status !== 0) throw new Error('source-reading backup failed: ' + backup.stderr);
  const keep = `scope = 'modules/${module}' OR scope LIKE 'module-campaigns/${campaign}/%'`;
  const prune = spawnSync('sqlite3', [to, ['source_modules', 'source_jobs', 'source_revisions', 'source_imports', 'source_exports'].map(t => `DELETE FROM ${t} WHERE NOT (${keep});`).join(' ') + ' VACUUM;'], { encoding: 'utf8' });
  if (prune.status !== 0) throw new Error('source-reading prune failed: ' + prune.stderr);
  // The table keeps revisions but not when each was written, so a historic cut cannot rewind it.
  if (historic) gaps.push({ kind: 'not_rewindable', store: 'source-reading state (module reading jobs and revisions)', path: '.coc/source-reading.sqlite', note: 'end-of-run revision kept' });
}

export function exportCheckpoint(options: { home: string; campaign: string; turn: number; out: string; live?: boolean; id?: string }) {
  const home = resolve(options.home), out = resolve(options.out), { campaign, turn } = options;
  if (!validId(campaign) || !Number.isInteger(turn) || turn < 1) throw new Error('A checkpoint needs a campaign id and a turn number from 1');
  if (existsSync(out)) throw new Error('Preserve existing checkpoint: ' + out);
  const coc = join(home, '.coc'), campaignDir = join(coc, 'campaigns', campaign), gitDir = join(coc, 'repos', campaign + '.git');
  const config = JSON.parse(readFileSync(join(campaignDir, 'campaign.json'), 'utf8')), module = config.module_id;
  const busy = holders([campaignDir, gitDir, join(coc, 'module-campaigns', campaign), join(coc, 'source-reading.sqlite')]);
  if (busy.length) throw new Error('The workspace is not at rest: ' + JSON.stringify(busy.slice(0, 3)));
  const before = commitBefore(gitDir, turn), after = commitAfter(gitDir, turn);
  const head = git(gitDir, ['rev-parse', 'HEAD']).toString().trim(), branch = git(gitDir, ['symbolic-ref', 'HEAD']).toString().trim();
  if (options.live) {
    const cursor = JSON.parse(readFileSync(join(campaignDir, 'turn.json'), 'utf8'));
    if (cursor.turn !== turn || cursor.state !== 'awaiting_player') throw new Error(`--live needs the campaign awaiting line ${turn}; it is at ${cursor.turn}/${cursor.state}`);
  }
  const gaps: Row[] = [], target = join(out, 'home'), cutoff = options.live ? null : Date.parse(before.at) + 999;
  mkdirSync(join(target, '.coc', 'campaigns', campaign), { recursive: true });
  // The campaign directory and its history up to C0.
  if (options.live) cpSync(campaignDir, join(target, '.coc', 'campaigns', campaign), { recursive: true, preserveTimestamps: true, mode: constants.COPYFILE_FICLONE });
  else {
    const archive = git(gitDir, ['archive', '--format=tar', before.commit]);
    const untar = spawnSync('tar', ['-x', '-C', join(target, '.coc', 'campaigns', campaign)], { input: archive });
    if (untar.status !== 0) throw new Error('Could not unpack the C0 tree: ' + untar.stderr);
    gaps.push({ kind: 'async_after_commit', store: 'background writes after the C0 commit (memory extraction, NPC journal and ledger, first sight, telemetry)', path: `.coc/campaigns/${campaign}`, note: 'they land in the next commit together with turn N, so they cannot be separated' });
  }
  const repo = join(target, '.coc', 'repos', campaign + '.git');
  const clone = spawnSync('git', ['clone', '--bare', '--no-local', '--no-tags', '--quiet', gitDir, repo], { encoding: 'utf8' });
  if (clone.status !== 0) throw new Error('Could not copy the sidecar repository: ' + clone.stderr);
  cpSync(join(gitDir, 'config'), join(repo, 'config'));
  for (const ref of git(repo, ['for-each-ref', '--format=%(refname)']).toString().trim().split('\n').filter(Boolean)) if (ref !== branch) git(repo, ['update-ref', '-d', ref]);
  git(repo, ['update-ref', branch, options.live ? head : before.commit]); git(repo, ['symbolic-ref', 'HEAD', branch]);
  git(repo, ['reflog', 'expire', '--expire=now', '--all']); git(repo, ['gc', '--prune=now', '--quiet']);
  // The kernel stages through the repository's index; a bare clone has none, so it is rebuilt at the C0 tree.
  git(repo, ['--work-tree', join(target, '.coc', 'campaigns', campaign), 'read-tree', 'HEAD']);
  for (const store of storesFor(campaign, module)) {
    const from = join(coc, store.path), to = join(target, '.coc', store.path);
    if (!existsSync(from)) continue;
    if (statSync(from).isFile()) {
      if (cutoff !== null && statSync(from).mtimeMs > cutoff) { gaps.push({ kind: 'written_after_c0', store: store.what, path: '.coc/' + store.path }); continue; }
      mkdirSync(dirname(to), { recursive: true }); cpSync(from, to, { preserveTimestamps: true });
    } else copyStore(from, to, cutoff, gaps, store.what, store.only, store.static);
  }
  copySourceReading(home, target, campaign, module, gaps, !options.live);
  const source_run = findSourceRun(home, campaign, after?.player_text ?? null);
  const grade = options.live ? 'A-state' : 'B';
  // One line per store and kind; paths relative to the seed home.
  const grouped = new Map<string, Row>();
  for (const gap of gaps) {
    const path = gap.path.startsWith('/') ? relative(target, gap.path) : gap.path, key = gap.kind + '|' + gap.store;
    const row = grouped.get(key) ?? { kind: gap.kind, store: gap.store, count: 0, examples: [] as string[], ...(gap.note ? { note: gap.note } : {}) };
    row.count++; if (row.examples.length < 3) row.examples.push(path); grouped.set(key, row);
  }
  const digest = treeDigest(target);
  const id = options.id ?? `${campaign}-t${String(turn).padStart(4, '0')}`;
  const manifest = {
    format: FORMAT, id, created_at: new Date().toISOString(), grade,
    boundary: { kind: 'pre_input', next_turn: turn, mode: options.live ? 'live' : 'historic' },
    source: { home, campaign, module, sidecar_branch: branch, c0_commit: options.live ? head : before.commit, c0_commit_at: before.at, original_turn_commit: after?.commit ?? null, original_closed_by: after?.closed_by ?? null, run: source_run },
    code: { exporter: codeVersion(REPO_ROOT) },
    rng: { kernel: 'PythonRandom (CPython v2 seeding, MT19937), process-scoped, seeded by COC_KERNEL_SEED', source_seed: null, source_state: 'not recorded by the source run: original dice cannot be reproduced', replay_policy: 'each paired replay sets COC_KERNEL_SEED=<checkpoint id>/<repetition>, the same for both arms' },
    clock: { game_clock: 'world.json clock, part of the campaign tree', wall_clock: 'not frozen: wall-clock timestamps in records and prompts differ between runs' },
    pending_work: { supported: [], unsupported: ['memory extraction, NPC journal and similar background jobs in flight at C0 are not resumed; a historic cut does not hold their results'] },
    gaps: [...grouped.values()], components: digest.files, tree_sha256: digest.tree_sha256,
  };
  writeFileSync(join(out, 'input.json'), JSON.stringify({ turn, player_text: after?.player_text ?? null }, null, 2) + '\n');
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

/** The driver run that played turn N, found by the player's line: the source configuration the case came from. */
function findSourceRun(home: string, campaign: string, playerText: string | null) {
  const root = join(home, '.coc', 'playtests');
  if (!existsSync(root) || !playerText) return null;
  for (const name of readdirSync(root).filter(n => n.startsWith(campaign + '-')).sort()) {
    let daemon: Row | null = null;
    try { daemon = JSON.parse(readFileSync(join(root, name, 'daemon.json'), 'utf8')); } catch { continue; }
    if (daemon?.campaign !== campaign) continue;
    for (const file of readdirSync(join(root, name)).filter(f => /^turn-\d+\.json$/.test(f))) {
      let record: Row | null = null;
      try { record = JSON.parse(readFileSync(join(root, name, file), 'utf8')); } catch { continue; }
      if (record?.player_text !== playerText) continue;
      const log = (() => { try { return readFileSync(join(root, name, 'driver.log'), 'utf8'); } catch { return ''; } })();
      return { run_id: name, driver_turn: record.turn, model: daemon.model_requested, thinking: / --thinking (\S+)/.exec(log)?.[1] ?? null, launcher: daemon.launcher, plugins: (daemon.plugins ?? []).map((p: Row) => p.id), wall_seconds: record.wall_seconds, settle_class: record.settle_class };
    }
  }
  return null;
}

export function verifyCheckpoint(dir: string) {
  dir = resolve(dir);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')), home = join(dir, 'home'), problems: string[] = [];
  if (manifest.format !== FORMAT) problems.push('unknown format ' + manifest.format);
  const { campaign } = manifest.source, turn = manifest.boundary.next_turn;
  const now = treeDigest(home);
  for (const [path, digest] of Object.entries(manifest.components)) if (now.files[path] !== digest) problems.push((now.files[path] ? 'changed: ' : 'missing: ') + path);
  for (const path of Object.keys(now.files)) if (!(path in manifest.components)) problems.push('unlisted: ' + path);
  const campaignDir = join(home, '.coc', 'campaigns', campaign), repo = join(home, '.coc', 'repos', campaign + '.git');
  const cursor = JSON.parse(readFileSync(join(campaignDir, 'turn.json'), 'utf8'));
  if (cursor.turn !== turn || cursor.state !== 'awaiting_player') problems.push(`turn.json is ${cursor.turn}/${cursor.state}, not ${turn}/awaiting_player`);
  if (!filesUnder(join(campaignDir, 'party')).some(f => f.endsWith('.json'))) problems.push('no investigator sheet in party/');
  if (!existsSync(join(home, '.coc', 'modules', manifest.source.module))) problems.push('bound module missing');
  if (existsSync(join(campaignDir, 'turns', String(turn).padStart(4, '0') + '.json'))) problems.push('the record of turn N itself is inside C0');
  const headCommit = git(repo, ['rev-parse', 'HEAD']).toString().trim();
  if (headCommit !== manifest.source.c0_commit) problems.push('sidecar HEAD is not the C0 commit');
  const all = git(repo, ['rev-list', '--all']).toString().trim().split('\n'), reachable = git(repo, ['rev-list', 'HEAD']).toString().trim().split('\n');
  if (all.length !== reachable.length) problems.push('the sidecar holds commits beyond C0');
  if (manifest.boundary.mode === 'historic') {
    // --no-optional-locks: status must not refresh the index, which would change the checkpoint it is checking.
    const status = spawnSync('git', ['--no-optional-locks', '--git-dir', repo, '--work-tree', campaignDir, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim();
    if (status) problems.push('campaign tree differs from the C0 commit: ' + status.split('\n').slice(0, 5).join('; '));
  }
  const objects = spawnSync('git', ['--git-dir', repo, 'count-objects', '-v'], { encoding: 'utf8' }).stdout;
  return { ok: problems.length === 0, id: manifest.id, grade: manifest.grade, problems, files: Object.keys(now.files).length, tree_sha256: now.tree_sha256, sidecar: { head: headCommit, commits: reachable.length, objects: /count: (\d+)/.exec(objects)?.[1] ?? null } };
}

function args(argv: string[]) { const a: Row = { _: [] }; for (let i = 0; i < argv.length; i++) { if (argv[i] === '--live') a.live = true; else if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i]; else a._.push(argv[i]); } return a; }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2), a = args(rest);
  try {
    if (command === 'export') { const m = exportCheckpoint({ home: a.home, campaign: a.campaign, turn: Number(a.turn), out: a.out, live: a.live, id: a.id }); console.log(JSON.stringify({ id: m.id, grade: m.grade, files: Object.keys(m.components).length, gaps: m.gaps.map((g: Row) => `${g.kind}: ${g.store} x${g.count}`), tree_sha256: m.tree_sha256 })); }
    else if (command === 'verify') { const r = verifyCheckpoint(a._[0]); console.log(JSON.stringify(r, null, 2)); process.exitCode = r.ok ? 0 : 1; }
    else { console.error('usage: checkpoint.ts export --home H --campaign C --turn N --out DIR [--live] | verify DIR'); process.exitCode = 2; }
  } catch (error) { console.error('error: ' + (error instanceof Error ? error.message : error)); process.exitCode = 1; }
}
