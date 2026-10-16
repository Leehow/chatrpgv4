#!/bin/zsh
# One isolated CoW view of a quiescent App campaign, with private path rewrites.
set -euo pipefail
campaign_id=$1
target_home=$2
source_home="/Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc"
script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(cd "$script_dir/../../.." && pwd)"
node "$repo_dir/scripts/test-workspace.mjs" "$source_home" "$target_home" "$campaign_id"
node --input-type=module - "$source_home" "$target_home" "$repo_dir" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [source, destination, repo] = process.argv.slice(2).map(value => path.resolve(value));
const {shareTestTree} = await import(pathToFileURL(path.join(repo, 'scripts/test-workspace.mjs')).href);
for (const name of ['reference-library','reference-cache','character-presentations','document-presentations','map-source-cache','ui-hints.json']) {
  const from = path.join(source, '.coc', name), to = path.join(destination, '.coc', name);
  if (fs.existsSync(from)) shareTestTree(from, to);
}
const before = Buffer.from(source + '/'), after = Buffer.from(destination + '/');
let changed = 0;
function visit(directory) {
  if (directory.endsWith('.git') || directory.includes('/.git/') || directory.endsWith('/objects')) return;
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { visit(file); continue; }
    if (!entry.isFile() || fs.statSync(file).size > 64 * 1024 ** 2) continue;
    const data = fs.readFileSync(file), chunks = []; let start = 0, offset;
    while ((offset = data.indexOf(before, start)) >= 0) { chunks.push(data.subarray(start, offset), after); start = offset + before.length; }
    if (!chunks.length) continue;
    chunks.push(data.subarray(start));
    const mode = fs.statSync(file).mode & 0o7777;
    fs.chmodSync(file, mode | 0o200);
    try { fs.writeFileSync(file, Buffer.concat(chunks)); changed++; } finally { fs.chmodSync(file, mode); }
  }
}
visit(path.join(destination, '.coc'));
console.log(JSON.stringify({rewritten_private_files: changed}));
JS
