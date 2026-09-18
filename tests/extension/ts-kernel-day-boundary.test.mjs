import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {after, test} from 'node:test';
import {build} from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'pi-coc-day-boundary-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: "export {gameDayOf} from './kernel-ts/healing/day.ts';", resolveDir: ROOT, loader: 'ts', sourcefile: 'day.ts'},
  outfile: join(temporary, 'day.mjs'), bundle: true, format: 'esm', platform: 'node', target: 'node22', packages: 'external', logLevel: 'silent'});
const {gameDayOf} = await import(pathToFileURL(join(temporary, 'day.mjs')).href);

const DAY = 1440;
const TO_MIDNIGHT = 14 * 60; // 10:00 to the next midnight
const DEFAULT_TO_MIDNIGHT = 15 * 60; // the undated table defaults to 09:00

test("the day boundary is the book's midnight, or the table's default midnight when the book names no hour", () => {
  // No pregen ships for a book without a declared opening (`the-white-war`), so this is pinned on
  // the function the table calls rather than through a campaign: with a date the midnight is that
  // date's, with a bare `start_time` hour it is that hour's midnight, and with neither it is the
  // table's documented 09:00 default rather than an invented midnight opening.
  const graph = properties => ({moduleNode: properties === null ? null : {properties}});
  const dated = graph({start_clock: {local_datetime: '1920-10-12T10:00:00'}});
  const houred = graph({start_time: '22:00'});
  const silent = graph(null);
  assert.deepEqual([0, TO_MIDNIGHT - 1, TO_MIDNIGHT, TO_MIDNIGHT + DAY].map(m => gameDayOf(dated, m)), [0, 0, 1, 2]);
  assert.deepEqual([0, 119, 120, 120 + DAY].map(m => gameDayOf(houred, m)), [0, 0, 1, 2]);
  assert.deepEqual([0, DEFAULT_TO_MIDNIGHT - 1, DEFAULT_TO_MIDNIGHT, DEFAULT_TO_MIDNIGHT + DAY].map(m => gameDayOf(silent, m)), [0, 0, 1, 2]);
});
