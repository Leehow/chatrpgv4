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
import {createHash} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';

/**
 * The recovery metadata this kernel grew after the freeze: `retryable` and `next`, carried by every
 * error frame since "Make PipiCOC tool failures actionable". The retired implementation never wrote
 * them, so no captured outcome can contain them, and comparing a live frame against one reads two
 * deliberate fields as a difference -- which is how one commit left every error-frame case in six
 * suites red at once.
 *
 * They are dropped from the LIVE side only, and only off an error frame. The captured outcomes are
 * kept exactly as the reference printed them: they are evidence, and writing a field into them that
 * the reference never produced would make the evidence say something untrue. This is the same move
 * the scope-review divergence already makes in `ts-kernel-modules` -- keep every prior assertion on
 * the unchanged payload, and let the addition be asserted where it belongs. These two fields have
 * their own tests (`kernel-error-bridge`, `resolve`); what these suites compare is the ported
 * vocabulary, which the addition did not change.
 */
export const POST_FREEZE_ERROR_FIELDS = Object.freeze(["retryable", "next"]);
export function withoutPostFreezeRecovery(value) {
  if (Array.isArray(value)) return value.map(withoutPostFreezeRecovery);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => {
    if (key !== "error" || !inner || typeof inner !== "object" || Array.isArray(inner)) return [key, withoutPostFreezeRecovery(inner)];
    return [key, Object.fromEntries(Object.entries(inner).filter(([field]) => !POST_FREEZE_ERROR_FIELDS.includes(field)))];
  }));
}

const FIXTURES = resolve(import.meta.dirname, 'fixtures/oracle');
const digestOf = source => createHash('sha256').update(source).digest('hex').slice(0, 16);
/**
 * A capture answers one question put to one reference program, but keys are built from the question
 * alone. Edit the program and every key it ever wrote still points at text the edit was meant to
 * change, so the suite goes on comparing against the answer to a question it no longer asks -- the
 * catalogue digests were served that way for a whole branch. Each suite records which program its
 * captures came from, beside them, and stale ones fail instead of answering.
 *
 * One file per suite, named for the prefix every one of its keys carries, so the process that runs
 * a suite is the only writer of that suite's record even when the runner runs the files at once.
 */
const sourcesPath = key => join(FIXTURES, key.split('-')[0] + '.sources.json');
const readSources = key => {
  try { return JSON.parse(readFileSync(sourcesPath(key), 'utf8')); } catch { return {}; }
};

/**
 * The captured outcome as the text it was printed as, so each suite parses it with the same reader
 * it parses a live answer with. A number too large for a double survives as itself that way.
 *
 * `source` is the reference program `produce` runs. Pass it, and a capture taken from a different
 * program fails rather than answering.
 */
export function expected(key, produce, source) {
  const path = join(FIXTURES, key + '.json');
  if (!process.env.PI_COC_REFREEZE_ORACLE) {
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      throw new Error(`Missing captured outcome ${key}; regenerate with PI_COC_REFREEZE_ORACLE=1`, {cause: error});
    }
    if (source !== undefined) {
      const recorded = readSources(key)[key];
      if (recorded !== digestOf(source))
        throw new Error(`Captured outcome ${key} came from a different reference program (recorded ${recorded ?? 'nothing'}, now ${digestOf(source)}); regenerate with PI_COC_REFREEZE_ORACLE=1`);
    }
    return text;
  }
  const text = produce();
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, text.endsWith('\n') ? text : text + '\n');
  if (source !== undefined) {
    const sources = {...readSources(key), [key]: digestOf(source)};
    const ordered = Object.fromEntries(Object.keys(sources).sort().map(name => [name, sources[name]]));
    writeFileSync(sourcesPath(key), JSON.stringify(ordered, null, 2) + '\n');
  }
  return text;
}
