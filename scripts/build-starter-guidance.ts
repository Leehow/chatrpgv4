/** Offline release preparation. Reader and independent reviewer retain their evidence. */
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareCharacterGuidance, guidanceFingerprint} from '../extensions/module/character-guidance.ts';
import type {ReaderRequest} from '../extensions/module/reader.ts';
import {composeRuntimeContext, createRuntime} from '../runtime/host.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
/** The tags a picker offers first, from `content/languages.json`: the bundles a release ships (contract section 23). */
async function suggestedPlayLanguages(contentRoot:string):Promise<string[]> {
  const raw=JSON.parse(await readFile(join(contentRoot,'languages.json'),'utf8'));
  const suggested=Array.isArray(raw?.suggested)?raw.suggested.filter((tag:unknown)=>typeof tag==='string' && tag.trim()):[];
  if(!suggested.length)throw new Error('content/languages.json suggests no play language to bundle');
  return suggested;
}
const [moduleId, homeArg]=process.argv.slice(2);
if(!moduleId || !homeArg)throw new Error('Usage: node scripts/build-starter-guidance.ts MODULE_ID EVIDENCE_HOME');
const home=resolve(homeArg);
// The author and the reviewer are tool-enabled Pi tasks of a host-owned runtime (contract §27): this
// script is one more preparation owner, composed the way the onboarding worker is, not a launch recipe.
const host={resourceRoot:root,contentRoot:join(root,'content'),agentHome:join(root,'.pi/coc-agent')};
const binding={owner:'preparation' as const,home};
const context=composeRuntimeContext(binding,host);
const runtime=createRuntime(binding,{...host,...context});
const kernel=runtime.openKernel();
const runner=({signal,...request}:ReaderRequest)=>runtime.runTask({kind:'reader',request},signal);
try {
  await kernel.call('module.register',{module_id:moduleId});
  const {occupations}=await kernel.call<any>('setup.occupations');
  const meta=JSON.parse(await readFile(join(runtime.home,'.coc/modules',moduleId,'module.json'),'utf8'));
  // One bundle per suggested play language: the set is open, so a release ships bundles only for
  // the tags a picker offers first, and any other tag generates its guidance per campaign.
  for(const language of await suggestedPlayLanguages(join(root,'content'))) {
    const options={home:runtime.home,contentRoot:context.contentRoot,module_id:moduleId,play_language:language,occupations,buildBundle:true,runner};
    const guidance=await prepareCharacterGuidance(options);
    const fingerprint=await guidanceFingerprint(options);
    const folder=join(root,'content/starters',moduleId,'character-guidance');
    await mkdir(folder,{recursive:true});
    await writeFile(join(folder,`${language}.json`),JSON.stringify({module_id:moduleId,play_language:language,
      graph_sha256:meta.graph_digest,fingerprint,approved:true,guidance},null,2)+'\n');
    process.stdout.write(`Published ${moduleId} ${language} ${fingerprint}\n`);
  }
} finally { await runtime.close(); }
