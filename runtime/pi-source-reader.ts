/** One tool-enabled Pi source child with the existing RunDriver and Jev port. */
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {PI_ENTRIES,PI_PACKAGE_ROOT,resourceRootFrom} from './deployment.mjs';
import {readJevApiKey} from '../extensions/jev/agent/config.js';
import {createSourceReaderDriver} from './jev/source-reader-driver.ts';

export async function piSourceReaderMain(args:string[],env:NodeJS.ProcessEnv=process.env):Promise<void>{
 const root=resourceRootFrom(import.meta.url,env);
 const source=JSON.parse(env.PI_COC_READER_SOURCE??'null');
 if(!source||typeof source.pdf!=='string'||typeof source.cache!=='string')throw new Error('Source reader requires a bound original PDF and page cache');
 const {setupCli}=await import(pathToFileURL(join(root,PI_PACKAGE_ROOT,'dist/cli/setup.js')).href);
 const {main}=await import(pathToFileURL(join(root,PI_ENTRIES.piModule)).href);
 setupCli();
 const driver=await createSourceReaderDriver({cwd:process.cwd(),env,source,apiKey:readJevApiKey(env)});
 await main(args,{runDriver:driver,extensionFactories:[{name:'coc-source-request',factory:pi=>driver.registerSourceRequest(pi)}]});
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await piSourceReaderMain(process.argv.slice(2));
