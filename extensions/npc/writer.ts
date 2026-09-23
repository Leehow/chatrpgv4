/** Tool-enabled character author; only the kernel publication owner may accept the artifact. */
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {HostRuntime} from '../../runtime/host.ts';

export async function authorNpc(options:{runtime:HostRuntime;jobId:string;model:string;pinned?:boolean;instruction:string;input:unknown;signal:AbortSignal}):Promise<unknown>{
    const root=join(options.runtime.home,'.coc','npc','attempts',createHash('sha256').update(options.jobId).digest('hex'));
    await mkdir(root,{recursive:true});
    const cwd=await mkdtemp(join(root,'attempt-')),systemPrompt=join(cwd,'instructions.md'),eventLog=join(cwd,'events.jsonl');
    await writeFile(join(cwd,'packet.json'),JSON.stringify(options.input,null,2));
    await writeFile(systemPrompt,options.instruction);
    await writeFile(eventLog,'');
    const outcome=await options.runtime.runTask({kind:'mod',request:{cwd,systemPrompt,model:options.model,pinnedModel:options.pinned===true,tools:'read,write,edit,bash',priority:'background',eventLog,
        brief:'Read packet.json as source data. Use the provided instructions to write draft.json. Use read/write/edit/bash as needed, only inside this directory. Do not read credentials, start a kernel, call providers from bash, inspect another campaign or edit world state. The host reads the draft file, not the final message.'}},options.signal);
    await writeFile(join(cwd,'outcome.json'),JSON.stringify(outcome,null,2));
    options.signal.throwIfAborted();
    if(!outcome.ok)throw new Error('NPC author did not complete its owned task');
    return JSON.parse(await readFile(join(cwd,'draft.json'),'utf8'));
}
