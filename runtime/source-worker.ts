/** Host PDF.js runs on the deployment's Node ABI, including when its caller is Electron. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceInfo, sourceLines, sourcePage, sourceSearch, sourceText, sourceTextVersion, sourceWindow, closeSourceDocuments } from '../extensions/module/source.ts';
import { transcriptStoreFromEnv } from '../extensions/module/transcript-store.ts';
import { readSourcePageText } from '../extensions/module/source-page-text.ts';

export async function sourceMain(args: string[]): Promise<number> {
  try {
    if (args.length !== 2 || !['info', 'page', 'search', 'text', 'lines', 'pagetext', 'window'].includes(args[0])) throw new Error('Unknown source operation');
    const request = JSON.parse(args[1]);
    const {pdf, ...options} = request;
    const result = args[0] === 'info' ? await sourceInfo(request.pdf)
      // §191.7: a page with a stored transcript is searched in it; the store is the owner's home and content (its env).
      : args[0] === 'search' ? await sourceSearch(pdf, options, undefined, transcriptStoreFromEnv(process.env, sourceTextVersion))
      : args[0] === 'text' ? await sourceText(pdf, options)
      : args[0] === 'lines' ? await sourceLines(pdf, options)
      // §191.7: a page's stored transcript where one exists (the owner's store, from this worker's env), else its native text.
      : args[0] === 'pagetext' ? await readSourcePageText({ pdf, options, store: transcriptStoreFromEnv(process.env, sourceTextVersion),
        nativeText: ({ pdf: file, ...native }) => sourceText(file, native),
        digest: async file => createHash('sha256').update(await readFile(file)).digest('hex') })
      : args[0] === 'window' ? await sourceWindow(pdf, options)
      : await sourcePage(request.pdf, request.cache, request.page, request);
    process.stdout.write(JSON.stringify({ok: true, result}) + '\n');
    return 0;
  } catch (error) {
    process.stdout.write(JSON.stringify({ok: false, error: error instanceof Error ? error.message : String(error)}) + '\n');
    return 1;
  } finally { await closeSourceDocuments(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await sourceMain(process.argv.slice(2));
}
