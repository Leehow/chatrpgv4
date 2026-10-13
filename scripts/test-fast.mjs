/** The default development feedback loop; integration remains a separate mandatory gate. */
import { readFileSync } from 'node:fs';
import { runExtensionTests } from './test-extension.mjs';
const manifest = JSON.parse(readFileSync(new URL('../tests/direct-ts-migration.json', import.meta.url), 'utf8'));
await runExtensionTests(['--test-concurrency=2', ...process.argv.slice(2), ...manifest.fastFiles]);
