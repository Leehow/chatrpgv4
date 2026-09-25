/** Canonical Pi startup: deployment paths are captured before profile or process work. */
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyProviderModelCorrections, composeRuntimeContext, type RuntimeHostOptions } from './host.ts';
import { extensionArgs, resourceRootFrom, sessionExtensionPaths } from './deployment.mjs';
import { selectLoopEngine } from './loop-engine.ts';

/**
 * How long a provider connection may say nothing before the transport gives up.
 *
 * Pi turns this setting into undici's `headersTimeout` and `bodyTimeout` (its own default is five
 * minutes) and into the per-request SDK timeout. A table does not have five minutes: the host's
 * turn watchdog (`TURN_WATCHDOG_TIMEOUT_MS`, two minutes) fires first, and what it produces is an
 * *abort*, which pi correctly never retries -- `_prepareRetry` runs on `stopReason: "error"` only,
 * because auto-retrying a cancellation would defeat the cancellation. So a connection that answers
 * and then says nothing costs the player the whole turn, while a connection that fails outright is
 * retried three times at two-second backoff and costs him one red line (2026-09-15: turn 14's
 * `Connection error.` recovered in 2 s; turns 2, 7 and 10 went silent and were aborted at 126 s,
 * 129 s and 147 s with nothing delivered).
 *
 * Under the watchdog, the same silence becomes a timeout *error*, which the retry patterns in
 * pi-ai already match ("timeout", "timed out", "terminated") -- so the existing retry path covers
 * it and nothing new has to be invented. The four silent streams on record that no watchdog cut
 * short are the proof: each ended at ~302 s, at this very timer, as `stop_reason: "error"`.
 *
 * One minute rather than a guess: across the 15,942 provider requests on disk the gap between the
 * request and its response headers is 770 ms at the median, 12.4 s at p99.9 and 29.7 s at its
 * worst, and not one exceeded 30 s. This is an *idle* timeout, not a budget for the answer: a
 * streaming reply resets it on every chunk, and the slowest healthy turn on record still streams.
 *
 * Bytes are not progress, though. A stream that answers and then sends only bytes no model event is
 * made of (keep-alive comments) is never idle to undici, and hung two SL-02 gate turns past this
 * setting. The same value therefore also bounds the silence between the *events* of a provider
 * attempt (vendored Pi `core/stream-progress.ts`, contract §135.29): across the retained grok-build
 * streams the worst healthy gap between events is 23 s mid-stream and 20 s before the first.
 */
const HTTP_IDLE_TIMEOUT_SETTING = 'httpIdleTimeoutMs';
const HTTP_IDLE_TIMEOUT_MS = 60_000;

export async function piLaunch(input: string[], options: RuntimeHostOptions = {}) {
  const env = {...(options.env ?? process.env)};
  const root = options.resourceRoot ?? resourceRootFrom(import.meta.url, env);
  const compiled = options.layout === 'compiled' || env.PI_COC_LAYOUT === 'compiled' || existsSync(join(root, 'deployment.json'));
  if (compiled && (!env.PI_COC_HOME || !env.PI_CODING_AGENT_DIR))
    throw new Error('Standalone startup requires its writable PI_COC_HOME and PI_CODING_AGENT_DIR bindings');
  const args = [...input];
  const mode = args[0] === 'setup' ? (args.shift(), 'setup') : 'play';
  let campaign = env.PI_COC_CAMPAIGN;
  const forwarded: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--campaign') {
      if (index + 1 === args.length) throw new Error('--campaign must be followed by a campaign id.');
      campaign = args[++index];
    } else if (args[index].startsWith('--campaign=')) campaign = args[index].slice('--campaign='.length);
    else forwarded.push(args[index]);
  }
  const context = composeRuntimeContext({owner: 'session', home: env.PI_COC_HOME ?? root, campaign}, {
    ...options, resourceRoot: root, env,
    agentHome: compiled ? env.PI_CODING_AGENT_DIR : join(root, '.pi/coc-agent'),
  });
  const prompt = join(context.resourceRoot, 'prompts', `${mode === 'setup' ? 'setup' : 'keeper'}.md`);
  accessSync(prompt, constants.R_OK);
  accessSync(selectLoopEngine(context.env, mode) === 'hybrid-v1' ? context.entrypoints.piHybrid : context.entrypoints.pi, constants.R_OK);
  mkdirSync(context.agentHome, {recursive: true});
  const path = join(context.agentHome, 'settings.json');
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(context.layout === 'source'
      ? {packages: [context.resourceRoot], quietStartup: true, httpIdleTimeoutMs: HTTP_IDLE_TIMEOUT_MS, cacheWarming: 'off'}
      : {quietStartup: true, httpIdleTimeoutMs: HTTP_IDLE_TIMEOUT_MS, cacheWarming: 'off'}, null, 2) + '\n');
  } else {
    const settings = JSON.parse(readFileSync(path, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error(`${path} must contain an object`);
    let changed = false;
    if (context.layout === 'source') {
      const packages = Array.isArray(settings.packages) ? settings.packages : [];
      if (!packages.includes(context.resourceRoot)) {
        settings.packages = [...packages, context.resourceRoot];
        changed = true;
      }
    }
    // Written once, never re-asserted: the operator's own value, including a deliberate 0
    // ("disabled"), is theirs and this must not walk over it on the next launch.
    if (!(HTTP_IDLE_TIMEOUT_SETTING in settings)) {
      settings[HTTP_IDLE_TIMEOUT_SETTING] = HTTP_IDLE_TIMEOUT_MS;
      changed = true;
    }
    // Pi 0.86+ defaults to paid cache-refresh requests. Preserve the product's previous
    // request behavior unless the operator has explicitly selected a warming policy.
    if (!('cacheWarming' in settings)) {
      settings.cacheWarming = 'off';
      changed = true;
    }
    if (changed) writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
  }
  // SL-61, contract §135.27.1: product corrections for provider model data the product knows
  // to be wrong (e.g. an omitted thinking level the endpoint actually supports), merged the same
  // way settings.json is above -- a user's own override for the same provider+model always wins.
  await applyProviderModelCorrections(context.agentHome, join(context.contentRoot, 'providers', 'model-corrections.json'));
  const hostSession = forwarded.some(arg => arg === '--session' || arg.startsWith('--session='));
  const session = campaign && !hostSession ? ['--session-id', `coc-${mode === 'setup' ? 'setup-' : ''}${campaign}`] : [];
  // Provider extensions come from the shared list every lane child mounts too, so a model this
  // session can be switched to is a model a lane can still run. image-gen registers tools, not a
  // provider, and stays a session mount.
  const mounts = !forwarded.includes('--no-extensions')
    ? ['--no-extensions', ...extensionArgs(sessionExtensionPaths(context.entrypoints))] : [];
  // PI_COC_LOOP_ENGINE: the same arguments reach Pi either way; hybrid-v1 starts them through the entry that
  // hands Pi's main the RunDriver. The child is told the engine it runs, which its startup record names.
  const engine = selectLoopEngine(context.env, mode);
  return {command: context.nodeExecutable,
    args: [engine === 'hybrid-v1' ? context.entrypoints.piHybrid : context.entrypoints.pi, '--no-builtin-tools', '--no-context-files', '--system-prompt', prompt, ...session, ...mounts, ...forwarded],
    // image-gen owns image_gen/image_edit; Pi refuses duplicate tool names, so grok-build-oauth is told not to register its own.
    cwd: context.resourceRoot, env: {...context.env, PI_COC_MODE: mode, PI_GROK_BUILD_IMAGE_TOOLS: '0', PI_COC_LOOP_ENGINE: engine}};
}

export async function launchMain(args: string[]): Promise<number> {
  const launch = await piLaunch(args);
  if (launch.env.PI_COC_JEV_S0 === '1' || launch.env.PI_COC_TASK_RUNTIME === '1' && launch.env.PI_COC_MODE === 'play') {
    // Contract §135.5: the S0/TaskRuntime private roles (their `submit_plan_packet`) run on the legacy loop only. On
    // hybrid-v1 the plan is an artifact inside the run, so the combination is refused rather than started as legacy
    // under a startup record that says hybrid.
    if (launch.env.PI_COC_LOOP_ENGINE === 'hybrid-v1')
      throw new Error('PI_COC_LOOP_ENGINE=hybrid-v1 does not run the S0/TaskRuntime private roles (PI_COC_JEV_S0, PI_COC_TASK_RUNTIME): the plan is an artifact inside the run');
    const { startS0Rpc } = await import('./jev/s0-rpc.ts');
    return startS0Rpc(launch);
  }
  const grouped = process.platform !== 'win32';
  return new Promise((accept, reject) => {
    const child = spawn(launch.command, launch.args, {...launch, stdio: 'inherit', detached: grouped});
    let escalation: NodeJS.Timeout | undefined;
    const stop = (signal: NodeJS.Signals) => {
      try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
      catch { /* The child has already completed. */ }
      escalation ??= setTimeout(() => {
        try { if (grouped && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {}
      }, 10000);
    };
    const term = () => stop('SIGTERM'), interrupt = () => stop('SIGINT'), hangup = () => stop('SIGHUP');
    process.on('SIGTERM', term); process.on('SIGINT', interrupt); process.on('SIGHUP', hangup);
    const cleanup = () => {
      clearTimeout(escalation);
      process.removeListener('SIGTERM', term); process.removeListener('SIGINT', interrupt); process.removeListener('SIGHUP', hangup);
    };
    child.once('error', error => {cleanup(); reject(error);});
    child.once('exit', (code, signal) => {
      cleanup();
      if (grouped && child.pid) { try {process.kill(-child.pid, 'SIGKILL');} catch {} }
      accept(code ?? (signal ? 128 : 1));
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {process.exitCode = await launchMain(process.argv.slice(2));}
  catch (error) {console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;}
}
