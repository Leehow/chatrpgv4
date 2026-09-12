/** Canonical Pi startup: deployment paths are captured before profile or process work. */
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeRuntimeContext, type RuntimeHostOptions } from './host.ts';
import { resourceRootFrom } from './deployment.mjs';

export function piLaunch(input: string[], options: RuntimeHostOptions = {}) {
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
  accessSync(context.entrypoints.pi, constants.R_OK);
  mkdirSync(context.agentHome, {recursive: true});
  const path = join(context.agentHome, 'settings.json');
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(context.layout === 'source'
      ? {packages: [context.resourceRoot], quietStartup: true} : {quietStartup: true}, null, 2) + '\n');
  } else if (context.layout === 'source') {
    const settings = JSON.parse(readFileSync(path, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error(`${path} must contain an object`);
    const packages = Array.isArray(settings.packages) ? settings.packages : [];
    if (!packages.includes(context.resourceRoot)) {
      settings.packages = [...packages, context.resourceRoot];
      writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
    }
  }
  const hostSession = forwarded.some(arg => arg === '--session' || arg.startsWith('--session='));
  const session = campaign && !hostSession ? ['--session-id', `coc-${mode === 'setup' ? 'setup-' : ''}${campaign}`] : [];
  // Provider extensions come from the shared list every lane child mounts too, so a model this
  // session can be switched to is a model a lane can still run. image-gen registers tools, not a
  // provider, and stays a session mount.
  const mounts = !forwarded.includes('--no-extensions')
    ? ['--no-extensions', ...[...context.entrypoints.extensions, ...context.entrypoints.providerExtensions,
      context.entrypoints.imageGen].flatMap(path => ['-e', path])] : [];
  return {command: context.nodeExecutable,
    args: [context.entrypoints.pi, '--no-builtin-tools', '--no-context-files', '--system-prompt', prompt, ...session, ...mounts, ...forwarded],
    // image-gen owns image_gen/image_edit; Pi refuses duplicate tool names, so grok-build-oauth is told not to register its own.
    cwd: context.resourceRoot, env: {...context.env, PI_COC_MODE: mode, PI_GROK_BUILD_IMAGE_TOOLS: '0'}};
}

export async function launchMain(args: string[]): Promise<number> {
  const launch = piLaunch(args);
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
