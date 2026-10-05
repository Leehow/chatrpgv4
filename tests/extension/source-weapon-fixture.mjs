/** Controlled accepted artifacts, real kernel calls; no provider or author model runs. */
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function sourceWeapon(game, {bound=true, mode='melee', name="Corbitt's ritual dagger"}={}) {
  const definition={name:'Source dagger fixture',category:'item',description:'A held ritual dagger with a sharp blade.',
    basis:'Controlled fixture for the source dagger described on printed page 449; no model author.',
    parameters:{charges:null,effects:[]},player_view:{description:'A dagger.',fields:[]}};
  const job=await game.call('mods.job',{role:'create',input:{name:definition.name,category:'item',description:definition.description}});
  assert.equal(job.enabled,true);
  await writeFile(join(job.cwd,'result.json'),JSON.stringify(definition));
  const accepted=await game.call('mods.accept',{job:job.job});
  await game.apply([{kind:'define',name:definition.name,category:'item',_definition:accepted.definition,_provenance:accepted.provenance},
    {kind:'object',name,definition:definition.name,to:game.sheet.name,...(bound?{source_object:'corbitt-ritual-dagger'}:{})}]);
  const value={name:mode==='thrown'?'throw':'stab',description:mode==='thrown'?'Throw the held dagger.':'Stab with the held dagger.',
    basis:'The registered intact blade in the investigator hands.',mode,
    parameters:{skill:mode==='thrown'?'Throw':'Fighting (Brawl)',damage:'1D4',base_range_yards:mode==='thrown'?5:null,
      uses_per_round:1,magazine:null,malfunction:null,impale:true,adds_damage_bonus:true},
    player_view:{description:'A dagger used to attack.',fields:['skill','damage']}};
  const usageJob=await game.call('mods.job',{role:'usage',input:{object:name,name:value.name,description:value.description}});
  assert.equal(usageJob.enabled,true);
  await writeFile(join(usageJob.cwd,'result.json'),JSON.stringify(value));
  const usageAccepted=await game.call('mods.accept',{job:usageJob.job});
  await game.apply([{kind:'usage',object:name,name:value.name,description:value.description,_usage:usageAccepted}]);
  const world=JSON.parse(await readFile(join(game.directory,'world.json'),'utf8'));
  const item=Object.values(world.objects.instances).find(item=>item.name===name);
  const usage=Object.values(world.objects.usages).find(row=>row.object_id===item.id&&row.name===value.name);
  return {item,usage,name,definition};
}

export async function enterSourceEncounter(game) {
  for(const to of ['corbitt-house-ground','basement-rites','corbitt-confrontation'])
    await game.apply([{kind:'move',to,travel_minutes:0}]);
}

export async function setFixtureSkill(game, value=99) {
  const sheet=JSON.parse(await readFile(game.sheetPath,'utf8'));
  sheet.skills['Fighting (Brawl)']=value;
  sheet.skills.Throw=value;
  sheet.characteristics.DEX=95;
  await writeFile(game.sheetPath,JSON.stringify(sheet));
}
