import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function keeperArguments(args, repo, mode = 'play') {
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
    join(repo, 'Electron/resources/runtime/kernel/pipiui-ext-invoke.ts'),
    ...['kernel', 'mods', 'onboarding', 'module', 'memory', 'table'].map(name => join(repo, 'extensions', name, 'index.ts')),
    join(repo, 'pipicoc/agent.ts'),
  ];
  return [...(mode === 'setup' ? ['setup'] : []), ...forwarded,
    '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes',
    ...mounts.flatMap(path => ['-e', path])];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const env = { ...process.env };
  // Host prompt contracts must not become a second persona in a reader or Keeper.
  for (const name of ['PIPIUI_CORE_PROMPT', 'PIPIUI_PROMPT_OBSERVER_EXT', 'PIPI_PHILOSOPHY_LAYER_DIRS']) delete env[name];
  env.PI_COC_HOME ||= repo;
  const child = spawn(join(repo, 'bin/pi-coc'), keeperArguments(process.argv.slice(2), repo, env.PI_COC_MODE || 'play'), {
    cwd: repo, env, stdio: 'inherit', detached: process.platform !== 'win32',
  });
  const stop = signal => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => stop(signal));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { stop('SIGTERM'); process.exitCode = code ?? (signal ? 128 + ({SIGINT: 2, SIGTERM: 15, SIGHUP: 1}[signal] || 1) : 1); });
}
