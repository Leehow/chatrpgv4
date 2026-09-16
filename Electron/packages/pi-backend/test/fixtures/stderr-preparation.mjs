/**
 * A preparation worker that dies the way a crashed one does: noise on stderr, a non-zero exit, and
 * no `{type:"error"}` event at all. That is the case where the host has nothing but stderr to go
 * on, and stderr was what it used to put in front of the player (§48).
 */
import { spawn } from 'node:child_process';

export const NOISE = 'TypeError: cannot read x of undefined\n    at /Users/someone/secret/reader.ts:41:9';

export function createPreparationHost(home) {
  return {
    home,
    start() {
      const child = spawn(process.execPath,
        ['-e', `process.stderr.write(${JSON.stringify(NOISE)});process.exit(1)`],
        {stdio: ['ignore', 'pipe', 'pipe']});
      const closed = new Promise(resolve => child.on('close', () => resolve()));
      return {child, closed, close: async () => {child.kill();}};
    },
  };
}
