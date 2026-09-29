/**
 * The Keeper's Pi CLI on the hybrid engine (`PI_COC_LOOP_ENGINE=hybrid-v1`; selected by `runtime/launch.ts`). It
 * runs the vendored Pi's own `main` with the same arguments the legacy launch passes to `dist/cli.js`, plus one
 * thing the CLI cannot take from arguments: the RunDriver with the product's policy and ports, and the inline
 * extension that hands those ports what they read. Everything else -- argument parsing, sessions, extensions, RPC
 * mode -- is Pi's, unchanged.
 *
 * A play session gets the play engine (`runtime/jev/hybrid-engine.ts`); a setup session (`PI_COC_MODE=setup`) gets
 * the setup engine and its policy `coc-setup-v1` (`runtime/jev/setup-engine.ts`, contract §151.6), never the play
 * policy, which reads a world that does not exist before `setup.confirm`.
 */
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PI_ENTRIES, PI_PACKAGE_ROOT, resourceRootFrom } from './deployment.mjs';
import { createHybridEngine } from './jev/hybrid-engine.ts';
import { createSetupEngine } from './jev/setup-engine.ts';

export async function piHybridMain(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.PI_COC_LOOP_ENGINE !== 'hybrid-v1') throw new Error('pi-hybrid runs only when the launcher selected PI_COC_LOOP_ENGINE=hybrid-v1');
  const root = resourceRootFrom(import.meta.url, env);
  // The same package the legacy launch starts (ADR-0006: one Pi); `setupCli` is what its `dist/cli.js` runs first.
  const { setupCli } = await import(pathToFileURL(join(root, PI_PACKAGE_ROOT, 'dist/cli/setup.js')).href);
  const { main } = await import(pathToFileURL(join(root, PI_ENTRIES.piModule)).href);
  setupCli();
  await main(args, hybridMainOptions(env));
}

/** What `main` is handed for this session's mode: the setup engine for setup, the play engine otherwise. */
export function hybridMainOptions(env: NodeJS.ProcessEnv): {extensionFactories: Array<{name: string; factory: (pi: any) => void}>; runDriver: {engine: string}; [key: string]: unknown} {
  if (env.PI_COC_MODE === 'setup') {
    const setup = createSetupEngine({ env });
    return { extensionFactories: [{ name: 'coc-setup-engine', factory: setup.extension }], runDriver: setup.runDriver };
  }
  const engine = createHybridEngine({ env });
  return { extensionFactories: [{ name: 'coc-hybrid-engine', factory: engine.extension }], runDriver: engine.runDriver,
    keeperCallCapMs: engine.keeperCallCapMs, onKeeperCallCap: engine.onKeeperCallCap };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await piHybridMain(process.argv.slice(2));
}
