/**
 * The Keeper's Pi CLI on the hybrid engine (`PI_COC_LOOP_ENGINE=hybrid-v1`, play only; selected by
 * `runtime/launch.ts`). It runs the vendored Pi's own `main` with the same arguments the legacy launch
 * passes to `dist/cli.js`, plus one thing the CLI cannot take from arguments: the RunDriver with the
 * product's policy and ports, and the inline extension that hands those ports the kernel bridge.
 * Everything else -- argument parsing, sessions, extensions, RPC mode -- is Pi's, unchanged.
 */
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PI_ENTRIES, PI_PACKAGE_ROOT, resourceRootFrom } from './deployment.mjs';
import { createHybridEngine } from './jev/hybrid-engine.ts';

export async function piHybridMain(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.PI_COC_LOOP_ENGINE !== 'hybrid-v1') throw new Error('pi-hybrid runs only when the launcher selected PI_COC_LOOP_ENGINE=hybrid-v1');
  const root = resourceRootFrom(import.meta.url, env);
  // The same package the legacy launch starts (ADR-0006: one Pi); `setupCli` is what its `dist/cli.js` runs first.
  const { setupCli } = await import(pathToFileURL(join(root, PI_PACKAGE_ROOT, 'dist/cli/setup.js')).href);
  const { main } = await import(pathToFileURL(join(root, PI_ENTRIES.piModule)).href);
  setupCli();
  const engine = createHybridEngine({ env });
  await main(args, { extensionFactories: [{ name: 'coc-hybrid-engine', factory: engine.extension }], runDriver: engine.runDriver,
    keeperCallCapMs: engine.keeperCallCapMs, onKeeperCallCap: engine.onKeeperCallCap });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await piHybridMain(process.argv.slice(2));
}
