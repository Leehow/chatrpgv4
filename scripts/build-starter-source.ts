/**
 * Contract §14.16.2: ship a built-in starter's source window. Extracts the pages the starter's
 * `source-binding.json` declares from the owner's copy of the book with the import pipeline's own
 * PDF.js extractor, writes them into the starter package, and records the extract in `built_in`.
 * Run once per book edition: `node scripts/build-starter-source.ts <starter-id> <book.pdf>`.
 */
import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {closeSourceDocuments, sourceInfo, sourceWindow, sourceWindowVersion} from '../extensions/module/source.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [starter, book] = process.argv.slice(2);
if (!starter || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(starter) || !book)
  throw new Error('Usage: node scripts/build-starter-source.ts STARTER_ID BOOK.pdf');
const folder = join(root, 'content/starters', starter), declarationPath = join(folder, 'source-binding.json');
const declaration = JSON.parse(await readFile(declarationPath, 'utf8'));
const [first, last] = declaration.book?.pages ?? [];
try {
  const info = await sourceInfo(book);
  if (info.file_sha256 !== declaration.book?.file_sha256)
    throw new Error(`${book} is not the book ${starter} declares (sha256 ${info.file_sha256}, declared ${declaration.book?.file_sha256})`);
  const path = declaration.built_in?.path ?? 'source.pdf';
  const extract = await sourceWindow(book, {first_page: first + 1, last_page: last + 1, out: join(folder, path), expected_file_sha256: info.file_sha256});
  declaration.built_in = {path, file_sha256: extract.file_sha256, page_count: extract.page_count, extractor: sourceWindowVersion};
  await writeFile(declarationPath, JSON.stringify(declaration, null, 2) + '\n');
  process.stdout.write(JSON.stringify({starter, path: join(folder, path), file_sha256: extract.file_sha256, page_count: extract.page_count,
    labels: extract.labels, book_pages: [first, last]}) + '\n');
} finally { await closeSourceDocuments(); }
