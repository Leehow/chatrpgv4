import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { compiledEnvironment, readDeployment, resourceRootFrom, runtimeEntrypoints } from '../runtime/deployment.mjs';

export function keeperArguments(args, repo, mode = 'play', entrypoints = runtimeEntrypoints(repo)) {
  if (!['play', 'setup'].includes(mode)) throw new Error(`Unsupported pi-coc mode: ${mode}`);
  const forwarded = [];
  const valueFlags = new Set(['--system-prompt', '--append-system-prompt', '--tools', '--extension', '-e']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i].split('=')[0];
    if (valueFlags.has(flag)) {
      if (!args[i].includes('=')) {
        if (i + 1 >= args.length) throw new Error(`Missing value for ${flag}`);
        i++;
      }
      continue;
    }
    forwarded.push(args[i]);
  }
  const mounts = [
    join(entrypoints.hostAssets, 'kernel', 'pipiui-ext-invoke.mjs'),
    ...entrypoints.extensions, entrypoints.agent, entrypoints.deepseek, entrypoints.grokBuild,
  ];
  return [...(mode === 'setup' ? ['setup'] : []), ...forwarded,
    '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes',
    ...mounts.flatMap(path => ['-e', path])];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = resourceRootFrom(import.meta.url);
  const deployment = process.env.PI_COC_LAYOUT === 'compiled' || existsSync(join(repo, 'deployment.json')) ? readDeployment(repo) : undefined;
  const env = deployment ? compiledEnvironment(deployment, process.env) : {...process.env, PI_COC_RESOURCE_ROOT: repo};
  const entrypoints = deployment?.entrypoints ?? runtimeEntrypoints(repo);
  // Host prompt contracts must not become a second persona in a reader or Keeper.
  for (const name of ['PIPIUI_CORE_PROMPT', 'PIPIUI_PROMPT_OBSERVER_EXT', 'PIPI_PHILOSOPHY_LAYER_DIRS']) delete env[name];
  if (deployment && (!env.PI_COC_HOME || !env.PI_CODING_AGENT_DIR)) throw new Error('Standalone UI startup requires its writable profile and COC home');
  env.PI_COC_HOME ||= repo;
  let stopping = false;
  let child;
  const launch = mode => {
  const args = keeperArguments(process.argv.slice(2), repo, mode, entrypoints);
  child = spawn(deployment?.node ?? join(repo, 'bin/pi-coc'), deployment ? [entrypoints.launch, ...args] : args, {
    cwd: repo, env: {...env,PI_COC_MODE:mode}, stdio: 'inherit', detached: process.platform !== 'win32',
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => {
    if(!stopping && !signal && code===0 && mode==='setup' && env.PI_COC_SETUP_AUTOSTART==='1') {
      try {
        const id=env.PI_COC_CAMPAIGN;
        if(typeof id==='string' && /^[a-z0-9-]{1,80}$/.test(id)) {
          const campaign=JSON.parse(readFileSync(join(env.PI_COC_HOME,'.coc/campaigns',id,'campaign.json'),'utf8'));
          if(campaign.status==='ready_for_table'){launch('play');return;}
        }
      } catch { /* A failed setup cannot open the table. */ }
    }
    process.exitCode=code ?? (signal?128:1);
  });
  };
  const stop = signal => {
    stopping = true;
    try {
      if (process.platform !== 'win32' && child?.pid) process.kill(-child.pid, signal);
      else child?.kill(signal);
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => stop(signal));
  launch(env.PI_COC_MODE || 'play');
}
