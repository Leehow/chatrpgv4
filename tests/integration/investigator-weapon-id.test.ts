// A weapon the setup put on the card is a weapon combat finds (1026j: a card's switchblade, written without its
// rules id, left the investigator nothing but fists, and every attack with it was refused).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importSource,native,tables} from './rules-engine-support.ts';
const {resolveInvestigatorWeapon,weaponOptions}=native;
const {SetupCatalog}=await importSource('kernel-ts/setup/catalog.ts');
const KNIFE='knife_small';

test('the setup writes the rules id on every printed weapon it puts on the card',async()=>{
  const catalog=new SetupCatalog({skillTable:{},occupationTable:{}},tables,await tables.weaponsTable());
  for(const [entry] of catalog.weaponProfiles().values())assert.ok(entry.weapon_id,`${entry.display_name} has no weapon_id`);
  const [knife,printed]=catalog.weaponProfiles().get('knife small switchblade');
  assert.equal(knife.weapon_id,KNIFE);
  const sheet={id:'x',skills:{},weapons:[{name:printed,...knife}]};
  assert.equal((await resolveInvestigatorWeapon(tables,sheet,printed)).weapon_id,KNIFE);
});

test('a card written before the id still carries its printed weapon, by the printed name or the player\'s',async()=>{
  const knife=(await tables.weaponsTable())[KNIFE], printed=knife.display_name;
  const legacy={id:'x',skills:{},weapons:[{name:printed,...knife}]};
  assert.ok(weaponOptions(legacy).includes(printed));
  assert.equal((await resolveInvestigatorWeapon(tables,legacy,printed)).weapon_id,KNIFE);
  const renamed={id:'x',skills:{},weapons:[{...knife,name:'弹簧刀',display_name:'弹簧刀',profile:printed}]};
  assert.equal((await resolveInvestigatorWeapon(tables,renamed,'弹簧刀')).weapon_id,KNIFE);
  const unprinted={id:'x',skills:{},weapons:[{name:'祖传短剑'}]};
  assert.equal(await resolveInvestigatorWeapon(tables,unprinted,'祖传短剑'),null,'a name with no printed row is not a weapon');
});
