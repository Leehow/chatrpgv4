/** The source library has no startup side effects when bundled into another host. */
import { sourceCli } from './source.ts';

sourceCli(process.argv.slice(2)).catch(error => {
  console.error(JSON.stringify({error: String(error.message ?? error)}));
  process.exitCode = 1;
});
