/**
 * Outcomes captured once from the implementation this kernel was ported from, kept as evidence.
 *
 * These suites used to run that implementation beside this one and compare the two. It cannot move
 * any more -- there is no Python left to pin a newer revision to -- so every capability and every
 * projection field added after the freeze read as a difference rather than as the change it was.
 * The cases and the outcome each case is owed are a file now: the coverage is the same, and a
 * change in what an input is owed has to be made deliberately, in a diff.
 *
 * Set `PI_COC_REFREEZE_ORACLE=1` to rewrite a fixture from `produce`, which is only meaningful
 * while a checkout still has the retired implementation available.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/oracle');

/**
 * The captured outcome as the text it was printed as, so each suite parses it with the same reader
 * it parses a live answer with. A number too large for a double survives as itself that way.
 */
export function expected(key, produce) {
  const path = join(FIXTURES, key + '.json');
  if (!process.env.PI_COC_REFREEZE_ORACLE) {
    try {
      return readFileSync(path, 'utf8');
    } catch (error) {
      throw new Error(`Missing captured outcome ${key}; regenerate with PI_COC_REFREEZE_ORACLE=1`, {cause: error});
    }
  }
  const text = produce();
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, text.endsWith('\n') ? text : text + '\n');
  return text;
}
