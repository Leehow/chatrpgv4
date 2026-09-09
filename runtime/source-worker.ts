/** Host PDF.js runs on the deployment's Node ABI, including when its caller is Electron. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceInfo, sourcePage } from '../extensions/module/source.ts';

export async function sourceMain(args: string[]): Promise<number> {
  try {
    if (args.length !== 2 || !['info', 'page'].includes(args[0])) throw new Error('Unknown source operation');
    const request = JSON.parse(args[1]);
    const result = args[0] === 'info' ? await sourceInfo(request.pdf)
      : await sourcePage(request.pdf, request.cache, request.page, request);
    process.stdout.write(JSON.stringify({ok: true, result}) + '\n');
    return 0;
  } catch (error) {
    process.stdout.write(JSON.stringify({ok: false, error: error instanceof Error ? error.message : String(error)}) + '\n');
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await sourceMain(process.argv.slice(2));
}
