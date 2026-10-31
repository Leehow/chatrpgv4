/**
 * Replay evaluation (R1): one arm, one repetition, one player line, from a verified C0 checkpoint.
 *
 *   node tests/replay/run.ts --checkpoint <dir> --arm <name> --model provider/id [--thinking low] [--rep 1]
 *                            [--tape <capture dir>] [--timeout 300]
 *
 * Each run gets its own root under .coc/eval/runs/<run_id>/ with a copy-on-write workspace restored from the
 * checkpoint, so nothing it writes reaches the checkpoint, the source campaign or another arm. The real host and
 * kernel run through the play driver with the owner's PipiCOC plugins (the driver refuses without them; this runner
 * also refuses unless all nine, Jev included, are on the daemon record). Every outbound request is captured where it
 * leaves fetch (capture-preload.mjs). The kernel's dice come from COC_KERNEL_SEED=<checkpoint>/r<rep>, the same for
 * every arm of a repetition. With --tape, model and service answers come from an earlier capture instead.
 *
 * The run's prose stays in its evidence files; this runner prints only counts, digests and verdict fields.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shareTestTree } from '../../scripts/test-workspace.mjs';
import { REPO_ROOT, treeDigest, verifyCheckpoint, type Row } from './checkpoint.ts';
import { captureSummary, outcomeOf, stateDigest } from './compare.ts';

export const EXPECTED_PLUGINS = ['anthropic-cache', 'codex-relay', 'deepseek', 'grok-build-oauth', 'image-gen', 'jev', 'minimax-enhanced', 'openai-fast', 'rerank'];
export const RUNS_ROOT = join(REPO_ROOT, '.coc', 'eval', 'runs');
const DRIVER = join(REPO_ROOT, 'tests', 'play', 'driver.ts'), PRELOAD = join(REPO_ROOT, 'tests', 'replay', 'capture-preload.mjs');
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const readJson = (path: string, fallback: any = null) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } };

/**
 * Provider keys the App holds for lane models the driver does not seed (the author and journal lanes run on MiniMax):
 * read from PipiCOC's own credentials into the driver's environment only, never onto a command line or into a file.
 */
const PIPICOC_AUTH = join(process.env.HOME ?? '', 'Library/Application Support/Pipi/pipicoc/pi-coc/agent/auth.json');
const KEY_ENVS: Record<string, string> = { 'minimax-cn': 'MINIMAX_CN_API_KEY' };
export function pipicocKeyEnv() {
  const auth = readJson(PIPICOC_AUTH, {}), env: Record<string, string> = {};
  for (const [provider, name] of Object.entries(KEY_ENVS)) if (typeof auth?.[provider]?.key === 'string' && auth[provider].key) env[name] = auth[provider].key;
  return env;
}
function driver(args: string[], log: string, timeoutSeconds: number) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [DRIVER, ...args], { cwd: REPO_ROOT, encoding: 'utf8', timeout: timeoutSeconds * 1000, maxBuffer: 256 * 1024 ** 2, env: { ...process.env, ...pipicocKeyEnv() } });
  writeFileSync(log, `$ driver ${args[0]}\n${result.stdout ?? ''}\n--- stderr\n${result.stderr ?? ''}\n`, { flag: 'a' });
  return { status: result.status, signal: result.signal, ms: Date.now() - started };
}
/** Processes still alive that belong to this run: its daemon, its Pi, and any child that names its workspace. */
export function leftovers(marks: string[], pids: number[]) {
  const ps = spawnSync('ps', ['-E', '-ww', '-A', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 256 * 1024 ** 2 }).stdout ?? '';
  return ps.split('\n').map(line => /^\s*(\d+)\s+(.*)$/.exec(line)).filter(Boolean).map(m => ({ pid: Number(m![1]), command: m![2] }))
    .filter(p => p.pid !== process.pid && (pids.includes(p.pid) || marks.some(mark => p.command.includes(mark))))
    .map(p => ({ pid: p.pid, command: p.command.slice(0, 160) }));
}

export async function replayRun(options: { checkpoint: string; arm: string; model: string; thinking?: string; rep?: number; tape?: string; timeout?: number; label?: string }) {
  const checkpoint = resolve(options.checkpoint), rep = options.rep ?? 1, timeout = options.timeout ?? 300;
  const verdict = verifyCheckpoint(checkpoint);
  if (!verdict.ok) throw new Error('Checkpoint does not verify: ' + verdict.problems.slice(0, 5).join('; '));
  const manifest = readJson(join(checkpoint, 'manifest.json')), input = readJson(join(checkpoint, 'input.json'));
  if (typeof input?.player_text !== 'string' || !input.player_text) throw new Error('The checkpoint holds no player line');
  const { campaign } = manifest.source, turn = manifest.boundary.next_turn;
  const runId = `${manifest.id}--${options.arm}--r${rep}${options.tape ? '--tape' : ''}--${stamp()}`, root = join(RUNS_ROOT, runId);
  const workspace = join(root, 'workspace'), capture = join(root, 'capture'), log = join(root, 'runner.log');
  mkdirSync(root, { recursive: true });
  const restore = shareTestTree(join(checkpoint, 'home', '.coc'), join(workspace, '.coc'));
  if (existsSync(join(checkpoint, 'home', 'source-skeletons'))) shareTestTree(join(checkpoint, 'home', 'source-skeletons'), join(workspace, 'source-skeletons'));
  const restored = treeDigest(workspace);
  if (restored.tree_sha256 !== manifest.tree_sha256) throw new Error('Restored workspace differs from the checkpoint');
  const seed = `${manifest.id}/r${rep}`, driverRun = 'replay-' + runId.replace(/[^A-Za-z0-9._-]/g, '_');
  const nodeOptions = [process.env.NODE_OPTIONS, `--import=${PRELOAD}`].filter(Boolean).join(' ');
  const env = [`PI_COC_HOME=${workspace}`, `COC_KERNEL_SEED=${seed}`, `PI_COC_REPLAY_CAPTURE=${capture}`, `NODE_OPTIONS=${nodeOptions}`, ...(options.tape ? [`PI_COC_REPLAY_TAPE=${resolve(options.tape)}`] : [])];
  const record: Row = {
    run_id: runId, label: options.label ?? null, checkpoint: { dir: checkpoint, id: manifest.id, grade: manifest.grade, tree_sha256: manifest.tree_sha256 },
    arm: { name: options.arm, model: options.model, thinking: options.thinking ?? null, code: { root: REPO_ROOT, head: spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim() } },
    provider_keys_from_pipicoc: Object.keys(pipicocKeyEnv()),
    rep, mode: options.tape ? 'tape' : 'live', tape: options.tape ? resolve(options.tape) : null, kernel_seed: seed, turn,
    restore: { method: restore.method, files: restore.files, tree_sha256: restored.tree_sha256 }, driver_run: driverRun, started_at: new Date().toISOString(),
  };
  const save = () => writeFileSync(join(root, 'result.json'), JSON.stringify(record, null, 2) + '\n');
  save();
  const start = driver(['start', '--campaign', campaign, '--run', driverRun, '--model', options.model, ...(options.thinking ? ['--thinking', options.thinking] : []), '--no-default-run', ...env.flatMap(pair => ['--env', pair])], log, 120);
  const evidence = join(REPO_ROOT, '.coc', 'playtests', driverRun), daemon = readJson(join(evidence, 'daemon.json'), {});
  record.daemon = { status: daemon.status ?? null, model_confirmed: daemon.model_confirmed ? `${daemon.model_confirmed.provider}/${daemon.model_confirmed.id}` : null, plugins: (daemon.plugins ?? []).map((p: Row) => p.id + (p.mount === 'profile' ? '@profile' : '')), daemon_pid: daemon.daemon_pid ?? null, pi_pid: daemon.pi_pid ?? null };
  const loaded = new Set((daemon.plugins ?? []).map((p: Row) => p.id)), missing = EXPECTED_PLUGINS.filter(id => !loaded.has(id));
  if (start.status !== 0 || missing.length) {
    record.refused = start.status !== 0 ? 'driver did not start' : 'plugins missing: ' + missing.join(', ');
    if (start.status === 0) driver(['stop', '--run', driverRun], log, 60);
    record.leftovers = settle(workspace, record.daemon); save();
    throw new Error(`Replay refused (${record.refused}); see ${log}`);
  }
  const began = Date.now(), played = driver(['turn', input.player_text, '--run', driverRun, '--timeout', String(timeout)], log, timeout + 60);
  record.turn_result = { exit: played.status, ms: Date.now() - began };
  driver(['stop', '--run', driverRun], log, 60);
  record.leftovers = settle(workspace, record.daemon);
  const turnFile = readdirSync(evidence).filter(f => /^turn-\d+\.json$/.test(f)).sort().pop(), driverTurn = turnFile ? readJson(join(evidence, turnFile)) : null;
  record.driver_turn = driverTurn ? { settle_class: driverTurn.settle_class, stop_reason: driverTurn.stop_reason, wall_seconds: driverTurn.wall_seconds, tools: (driverTurn.tools ?? []).map((t: Row) => t.name), delivery_kind: driverTurn.delivery?.kind ?? null, thinking_steps: (driverTurn.thinking_steps ?? []).length, long_thinking_steps: (driverTurn.thinking_steps ?? []).filter((s: Row) => s.tokens > 1000).length, prose_chars: typeof driverTurn.final_text === 'string' ? driverTurn.final_text.length : 0 } : null;
  record.outcome = outcomeOf(workspace, campaign, turn);
  record.state_after = stateDigest(workspace, campaign);
  record.capture = captureSummary(capture);
  record.isolation = { checkpoint_unchanged: treeDigest(join(checkpoint, 'home')).tree_sha256 === manifest.tree_sha256 };
  record.ended_at = new Date().toISOString();
  save();
  return record;
}

/** Wait for the run's processes to end; whatever outlives the stop is ended and named in the record. */
function settle(workspace: string, daemon: Row) {
  const pids = [daemon?.daemon_pid, daemon?.pi_pid].filter(Number.isInteger);
  for (let i = 0; i < 40; i++) { if (!leftovers([workspace], pids).length) return []; spawnSync('sleep', ['0.5']); }
  const left = leftovers([workspace], pids);
  for (const p of left) try { process.kill(p.pid, 'SIGTERM'); } catch { }
  spawnSync('sleep', ['2']);
  for (const p of leftovers([workspace], pids)) try { process.kill(p.pid, 'SIGKILL'); } catch { }
  return left;
}

function args(argv: string[]) { const a: Row = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i]; return a; }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = args(process.argv.slice(2));
  try {
    const r = await replayRun({ checkpoint: a.checkpoint, arm: a.arm, model: a.model, thinking: a.thinking, rep: a.rep ? Number(a.rep) : 1, tape: a.tape, timeout: a.timeout ? Number(a.timeout) : undefined, label: a.label });
    console.log(JSON.stringify({ run_id: r.run_id, settle: r.driver_turn?.settle_class, wall: r.driver_turn?.wall_seconds, closed: r.outcome?.closed_by, rolls: r.outcome?.rolls?.length, requests: r.capture?.requests, uncovered: r.capture?.uncovered, divergences: r.capture?.divergences, plugins: r.daemon?.plugins?.length, leftovers: r.leftovers?.length }));
  } catch (error) { console.error('error: ' + (error instanceof Error ? error.message : error)); process.exitCode = 1; }
}
