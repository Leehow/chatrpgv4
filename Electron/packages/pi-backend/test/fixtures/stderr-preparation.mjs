/**
 * A preparation worker that dies the way a crashed one does: noise on stderr, a non-zero exit, and
 * no `{type:"error"}` event at all. That is the case where the host has nothing but stderr to go
 * on, and stderr was what it used to put in front of the player (§48).
 */
import { spawn } from 'node:child_process';

/**
 * What the test looks for in the player's answer. Every onboarding answer carries the play
 * language's caption keys and words (`ui.words`), so a marker that is an English word -- `secret`
 * was -- matches a key like `secretClear` the moment a surface adds one, and the test reports a leak
 * that is not there. No caption key or word contains this. It is in both lines, so a fragment of
 * either is caught.
 */
export const MARKER = '7f3a9c-stderr-only';

export const NOISE = `TypeError: cannot read ${MARKER} of undefined\n    at /Users/someone/${MARKER}/reader.ts:41:9`;

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
