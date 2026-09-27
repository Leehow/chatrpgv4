/** The two text helpers every Jev domain needs: a code-point clip with an ellipsis, and a short digest of a value. */
import {createHash} from 'node:crypto';

/** `value` cut to `max` code points, ending in `...` when it was cut; never inside a surrogate pair. */
export const clip = (value: string, max: number): string =>
  Array.from(value).length <= max ? value : Array.from(value).slice(0, max - 3).join('') + '...';
/** The first sixteen hex digits of the SHA-256 of `JSON.stringify(value)`: a binding revision, not a security digest. */
export const digest16 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
