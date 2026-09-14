/** Pure standalone App recipe; callers supply manifests, paths and environment overrides. */
import { join } from 'node:path';

export function createPackageRecipe({ repo, stage, product, version, userHome, appHome, appBundle }) {
  if (typeof product.appId !== 'string' || typeof product.name !== 'string' || typeof product.icon !== 'string' || !product.icon) {
    throw new Error('Product config needs appId, name and icon.');
  }
  if (typeof version !== 'string' || !version) throw new Error('Root package manifest needs a version.');
  // The real bundle lives in /Applications; the former build home holds only a receipt and back-link.
  const home = appHome || join(userHome, 'leehow/code/pipicoc-build');
  const target = appBundle || '/Applications/PipiCOC.app';
  const productIconPng = join(repo, 'pipicoc', product.icon);
  const config = {
    appId: product.appId,
    productName: product.name,
    forceCodeSigning: false,
    npmRebuild: true,
    extraMetadata: { version },
    directories: { output: join(stage, 'output') },
    files: ['out/**/*', 'package.json', '!node_modules/**/*', 'node_modules/node-pty/**/*', 'node_modules/@xterm/headless/**/*', 'node_modules/@xterm/addon-serialize/**/*'],
    extraResources: [
      { from: join(stage, 'product.json'), to: 'product.json' },
      { from: join(stage, 'pi-coc-runtime.json'), to: 'pi-coc-runtime.json' },
      { from: productIconPng, to: product.icon },
      { from: join(repo, 'Electron/packages/ui/dist/browser'), to: 'browser-ui' },
    ],
    mac: {
      identity: null,
      icon: productIconPng.replace(/\.png$/i, '.icns'),
      extendInfo: { CFBundleDisplayName: product.name, CFBundleName: product.name },
      target: ['dir'],
    },
  };
  return { config, home, target, link: join(home, 'PipiCOC.app'), app: join(config.directories.output, 'mac-arm64', `${product.name}.app`) };
}
