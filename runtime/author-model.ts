/** Independent prose-author choices, read at each composition from the host settings store. */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {FAST_MODEL_SETTINGS_FILE} from './fast-model.ts';
export const AUTHOR_MODEL_KEY='ext.coc-keeper.authorModel';
export const AUTHOR_THINKING_KEY='ext.coc-keeper.authorThinking';
export async function readAuthorModelChoice(agentHome?:string):Promise<{model?:string;thinking?:string}> {
  if(!agentHome)return {};
  try {
    const document=JSON.parse(await readFile(join(agentHome,FAST_MODEL_SETTINGS_FILE),'utf8'));
    const settings=document?.extensions?.['coc-keeper']?.settings;
    const model=settings?.[AUTHOR_MODEL_KEY]?.model;
    const thinking=settings?.[AUTHOR_THINKING_KEY]?.level;
    return {...(typeof model==='string'&&model.trim()?{model:model.trim()}:{}),
      ...(typeof thinking==='string'&&thinking.trim()?{thinking:thinking.trim()}:{})};
  }catch{return {};}
}
