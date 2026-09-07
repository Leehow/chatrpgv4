#!/usr/bin/env node
/**
 * Package a *product* built on this base.
 *
 * A product is the base plus a `product.json`: id, display name, appId, userData
 * directory, icon. At runtime an unpackaged product picks that file up from
 * `PIPIUI_PRODUCT_CONFIG`; a packaged one reads it from its own resources, so packaging a
 * product means shipping its file as that resource and telling electron-builder the
 * product's name, bundle id and icon. Nothing here forks the base: the whole difference
 * between two products is the file this script is pointed at.
 *
 * Usage:
 *   node scripts/package-product.mjs --product <path/to/product.json> [--arch arm64|x64]
 *                                    [--icon <path/to/icon.icns>] [--target dir|dmg|zip]
 *                                    [--no-sign]  local dev loop: skip codesign (signing
 *                                    the bundle costs minutes; an unsigned local build
 *                                    launches fine on the machine that built it).
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const out = { arch: process.arch === 'x64' ? 'x64' : 'arm64', target: 'dir' }
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=', 2)
    const value = inline ?? argv[i + 1]
    const step = () => { if (inline === undefined) i += 1 }
    if (flag === '--product') { out.product = value; step() }
    else if (flag === '--arch') { out.arch = value; step() }
    else if (flag === '--icon') { out.icon = value; step() }
    else if (flag === '--target') { out.target = value; step() }
    else if (flag === '--no-sign') out.sign = false
    else if (flag === '--help' || flag === '-h') out.help = true
  }
  return out
}

const options = parseArgs(process.argv.slice(2))
if (options.help || !options.product) {
  console.log('usage: node scripts/package-product.mjs --product <product.json> [--arch arm64|x64] [--icon <icon.icns>] [--target dir|dmg|zip] [--no-sign]')
  process.exit(options.help ? 0 : 2)
}

const productPath = isAbsolute(options.product) ? options.product : resolve(process.cwd(), options.product)
let product
try {
  product = JSON.parse(readFileSync(productPath, 'utf8'))
} catch (error) {
  console.error(`cannot read product identity at ${productPath}: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
for (const field of ['id', 'name', 'appId']) {
  if (typeof product[field] !== 'string' || !product[field]) {
    console.error(`product identity at ${productPath} needs a non-empty "${field}"`)
    process.exit(1)
  }
}

// The icon electron-builder wants is a .icns; the runtime `icon` is a PNG for the dock of
// an unpackaged run. Take an explicit --icon, else the .icns sitting beside that PNG.
const iconCandidate = options.icon
  ?? (typeof product.icon === 'string' ? join(dirname(productPath), product.icon.replace(/\.png$/i, '.icns')) : undefined)

// A product that declares an icon and does not get it is the one failure electron-builder
// will not report: an unresolvable `mac.icon` falls back to `apps/electron/build/icon.icns`
// — the base's own icon — and the product ships wearing PipiUI's face, signed and valid.
// It happened once and was only caught by hashing the icns inside the bundle. So the
// declared icon must exist here, or this stops.
if (iconCandidate && !existsSync(iconCandidate)) {
  console.error(`product icon not found: ${iconCandidate}`)
  console.error('electron-builder would silently fall back to the base icon; refusing to build a product wearing it.')
  process.exit(1)
}

const pkgPath = join(electronRoot, 'apps', 'electron', 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

// Stage the product's identity where the packaged app expects to find it, without
// touching the base's own product.json.
const stageRoot = join(electronRoot, '.product-stage', product.id)
rmSync(stageRoot, { recursive: true, force: true })
mkdirSync(stageRoot, { recursive: true })
writeFileSync(join(stageRoot, 'product.json'), `${JSON.stringify(product, null, 2)}\n`)

// The icon is staged beside it rather than referenced where it lies. A product's artwork
// lives in the product's own directory, which is outside this workspace; copying it in
// means the build reads one directory it owns, and no path outside it has to resolve for
// the right icon to win.
const stagedIcon = iconCandidate ? join(stageRoot, `${product.id}.icns`) : undefined
if (iconCandidate && stagedIcon) copyFileSync(iconCandidate, stagedIcon)

const appRoot = join(electronRoot, 'apps', 'electron')
const relativeToApp = (path) => resolve(path).replace(`${appRoot}/`, '')
const config = {
  ...pkg.build,
  ...(options.sign === false ? { forceCodeSigning: false } : {}),
  appId: product.appId,
  productName: product.name,
  // Each product gets its own output directory. Sharing one meant packaging a second
  // product while the first ran from that directory, and codesign then failed partway
  // through the embedded runtime with "No such file or directory" — a signature the
  // packager reported as an error but the .app kept, incomplete.
  directories: { ...pkg.build.directories, output: `../../../build/${product.id}` },
  extraResources: pkg.build.extraResources.map(entry => (
    entry.to === 'product.json' ? { ...entry, from: relativeToApp(join(stageRoot, 'product.json')) } : entry
  )),
  mac: {
    ...pkg.build.mac,
    ...(options.sign === false ? { identity: null } : {}),
    ...(stagedIcon ? { icon: relativeToApp(stagedIcon) } : {}),
    extendInfo: { ...pkg.build.mac?.extendInfo, CFBundleDisplayName: product.name, CFBundleName: product.name },
    target: [options.target],
  },
}
const configPath = join(stageRoot, 'electron-builder.json')
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

console.log(`packaging ${product.name} (${product.id}) for darwin ${options.arch}`)
console.log(`  identity: ${productPath}`)
console.log(`  icon:     ${iconCandidate ?? '(none declared -- electron default)'}`)

const result = spawnSync(process.execPath, [
  join(electronRoot, 'scripts', 'package-electron-target.mjs'),
  '--platform', 'darwin', '--arch', options.arch,
  '--', '--mac', `--${options.arch}`, '--config', configPath,
], { stdio: 'inherit', cwd: electronRoot })
process.exit(result.status ?? 1)
