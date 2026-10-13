/** Complete semantic fixture for setup contract tests, never a scripted player. */
import {CAMPAIGN,type RpcClient} from './support.ts';
export const profile=()=>({name:'Helen',occupation:'Journalist',age:29,sex:'female',concept:'A cautious local reporter seeking rent money.',own_language:'English',
  occupation_skills:['Art and Craft (Photography)','History','Language (Own)','Library Use','Psychology','Persuade','Spot Hidden','Listen'],
  interest_skills:['Accounting','Law','First Aid','Drive Auto'],backstory:{personal_description:'A practical coat',ideology_beliefs:'Evidence before rumors',significant_people:'An editor friend',scenario_bound:'Meeting Knott about the house investigation'},
  key_connection:{backstory_field:'significant_people',summary:'The editor friend'},equipment:['Press card','Notebook','Camera','Flashlight']});
export async function confirmedInvestigator(k:RpcClient,campaign=CAMPAIGN,name='Ada'){
  const draft=await k.ok('setup.draft',{campaign,profile:{...profile(),name}});
  const result=await k.ok('setup.confirm',{campaign,revision:draft.revision,consent:'approved'});
  return {...result,investigator:{id:result.sheet.id,name}};
}
