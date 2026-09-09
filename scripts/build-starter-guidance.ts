/** Offline release preparation. Reader and independent reviewer retain their evidence. */
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {KernelClient} from '../extensions/kernel/client.ts';
import {prepareCharacterGuidance, guidanceFingerprint} from '../extensions/module/character-guidance.ts';
import {loadPlayLanguages} from '../runtime/ui-words.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [moduleId, homeArg]=process.argv.slice(2);
if(!moduleId || !homeArg)throw new Error('Usage: node scripts/build-starter-guidance.ts MODULE_ID EVIDENCE_HOME');
const home=resolve(homeArg);
process.env.PI_CODING_AGENT_DIR=join(root,'.pi/coc-agent');
const kernel=new KernelClient({command:['uv','run','--frozen','python','-m','coc.rpc','--workspace',home,'--content',join(root,'content')],
  cwd:root,env:{...process.env,PYTHONPATH:join(root,'kernel'),PYTHONDONTWRITEBYTECODE:'1'} as Record<string,string>});
try {
  await kernel.call('module.register',{module_id:moduleId});
  const {occupations}=await kernel.call<any>('setup.occupations');
  const meta=JSON.parse(await readFile(join(home,'.coc/modules',moduleId,'module.json'),'utf8'));
  // One bundle per declared play language: the loop is `content/languages.json`, so adding a
  // language publishes its starter guidance without a line changing here (contract §23).
  for(const language of Object.keys((await loadPlayLanguages(join(root,'content'))).languages)) {
    const options={home,module_id:moduleId,play_language:language,occupations,buildBundle:true};
    const guidance=await prepareCharacterGuidance(options);
    const fingerprint=await guidanceFingerprint(options);
    const folder=join(root,'content/starters',moduleId,'character-guidance');
    await mkdir(folder,{recursive:true});
    await writeFile(join(folder,`${language}.json`),JSON.stringify({module_id:moduleId,play_language:language,
      graph_sha256:meta.graph_digest,fingerprint,approved:true,guidance},null,2)+'\n');
    process.stdout.write(`Published ${moduleId} ${language} ${fingerprint}\n`);
  }
} finally { await kernel.close(); }
