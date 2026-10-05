/** Canonical campaign-relative path shared by turn record readers and writers. */
import {join} from 'node:path';

export const turnRecordPath = (turn: number): string => join('turns', `${String(turn).padStart(4, '0')}.json`);
