import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function run(cmd,args,cwd=root) { const r=spawnSync(cmd,args,{cwd,stdio:'inherit'}); if(r.status!==0)process.exit(r.status||1); }
run('npm',['run','build','-w','@pipi/host-api']);
run('npm',['run','build','-w','@pipiui/extension-api']);
run('npm',['run','build','-w','@pipi/account-usage-core']);
run(process.execPath,['packages/pi-backend/scripts/bundle-runtime-agents.mjs']);
await build({absWorkingDir:root,entryPoints:['apps/server/src/index.ts'],outfile:'apps/server/dist/index.js',bundle:true,platform:'node',format:'esm',packages:'external',
 alias:{'@pipi/pi-backend':'./packages/pi-backend/src/index.ts','@pipi/host-api':'./packages/host-api/src/index.ts'}});
run(resolve(root,'node_modules/.bin/vite'),['build','--config','vite.browser.config.ts'],resolve(root,'packages/ui'));
