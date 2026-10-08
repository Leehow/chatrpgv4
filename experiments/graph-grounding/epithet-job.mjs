import {readFile, writeFile, rm, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {kernel} from './kernel-api.mjs';
const home = process.argv[2], campaign = 'game-565055f1-8a99-4e69-9932-ca64c0e27d93';
const cdir = join(home, '.coc/campaigns', campaign);
const fork = join(home, '.coc/module-campaigns', campaign, 'modules/book-2');
// The fork as it stood at 12:52Z: generation 74.
const meta = JSON.parse(await readFile(join(fork, 'module.json'), 'utf8'));
const g74 = (await readdir(join(fork, 'generations'))).find(d => d.startsWith('generation-74-'));
meta.generation = 74; meta.graph_file = `generations/${g74}/module-graph.json`; 
await writeFile(join(fork, 'module.json'), JSON.stringify(meta));
const world = JSON.parse(await readFile(join(cdir, 'world.json'), 'utf8'));
delete world.person_epithets; delete world.person_labels;
await writeFile(join(cdir, 'world.json'), JSON.stringify(world));
await writeFile(join(cdir, 'epithets.json'), JSON.stringify({people: {}}));
await rm(join(cdir, 'npc-journal.json'), {force: true});
await rm(join(cdir, 'turns'), {recursive: true, force: true});
const stored = JSON.parse(await readFile(join(process.argv[3]), 'utf8')).people;
const k = await kernel(home);
const jobs = [];
for (let round = 0; round < 3; round++) {
  const job = await k.call('epithets.job', {campaign});
  if (!job.job_id) break;
  jobs.push(job);
  // Submit the words the App actually kept, so the next job is the App's next job.
  const entries = job.people.map(p => ({id: p.id, word: stored[p.id]?.word})).filter(e => e.word);
  const res = await k.call('epithets.submit', {campaign, entries});
  console.error('round', round, job.job_id, 'people', job.people.length, 'written', res.written.length, 'refused', res.refused.length);
}
await writeFile(process.argv[4] ?? join(home, 'jobs.json'), JSON.stringify(jobs, null, 1));
k.runtime.close?.();
