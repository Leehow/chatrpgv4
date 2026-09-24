/**
 * Explanatory arguments the clerk composes by code (contract §135.27; the spec's ruling "Parameter binding never goes
 * to the LLM"). An explanatory parameter of a clerk write (`why` on a person, a meeting or a combat disposition) is
 * never generated: it is put together from what the candidate already carries -- the obligation's demand, the table's
 * own label, the parameters a disposition was read from -- and the player's declaration, quoted as typed.
 *
 * Every composed argument is one sentence under the §135.21 ceiling (`SENTENCE_MAX`, counted in code points as JSON
 * Schema's `maxLength` counts it). The clerk writes it, so the clerk fits it: whitespace runs become one space, and a
 * quote that would pass the ceiling is shortened at a code-point boundary and ends with "...", so the kernel never
 * refuses a clerk's own sentence for its length. The words are the system language's (English, Keeper-facing): no field
 * a player reads is composed here (§80: a clue's `how` is on the player's card, so the clerk leaves it out).
 */
import {SENTENCE_MAX} from '../../extensions/kernel/tools.ts';

const ELLIPSIS = '...';
const points = (value: string): string[] => Array.from(value);
const flat = (value: string): string => value.replace(/\s+/g, ' ').trim();
const clip = (value: string, max: number): string => {
  const chars = points(value);
  return chars.length <= max ? value : `${chars.slice(0, Math.max(0, max - ELLIPSIS.length)).join('')}${ELLIPSIS}`;
};

/**
 * One sentence: `lead`, then `; player: "<quote>"` when there is a declaration to quote. The lead is the candidate's
 * own words and is kept whole when it fits; the quote gives way first. A lead that alone passes the ceiling is
 * shortened and carries no quote.
 */
export function composeSentence(lead: string, quote?: string, max: number = SENTENCE_MAX): string {
  const head = flat(lead), said = flat(quote ?? '');
  if (points(head).length >= max) return clip(head, max);
  if (!said) return head;
  const frame = `${head}; player: ""`, room = max - points(frame).length;
  if (room < ELLIPSIS.length + 1) return head;
  return `${head}; player: "${clip(said, room)}"`;
}
