import { access, readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = resolve(electronRoot, 'packs/deepwood-sync/app')
const outDir = resolve(appRoot, 'dist')
const entry = resolve(outDir, 'panel.js')

await rm(outDir, { recursive: true, force: true })
await build({ configFile: resolve(appRoot, 'vite.config.ts') })
await access(entry)

const code = await readFile(entry, 'utf8')
if (/\bfrom\s*["']react(?:\/jsx-runtime)?["']/.test(code)) {
  throw new Error('deepwood-sync app artifact must not contain bare React imports')
}
if (!code.includes('createComponent')) {
  throw new Error('deepwood-sync app artifact must export createComponent')
}
