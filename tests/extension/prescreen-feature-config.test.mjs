import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {API_KEY_ENV, PRESELECT_KEY, SETTINGS_ENV, readJevPreselectEnabled, describePrescreenConfig}
  from '../../extensions/jev/agent/config.js';
import {formatJevStatus} from '../../extensions/jev/agent/index.js';

const managed = (enabled, extra = {}) => ({PIPIUI_SPAWN_CONTRACT: '{}', PIPIUI_MOUNTED_EXTENSIONS: 'kernel,jev',
  [SETTINGS_ENV]: JSON.stringify({[PRESELECT_KEY]: enabled}), [API_KEY_ENV]: 'configured-key', ...extra});

test('managed mounted settings own preselection activation independently from stale CLI flags', () => {
  assert.equal(readJevPreselectEnabled(managed(true, {PI_COC_JEV_PRESELECT: '0'})), true);
  assert.equal(readJevPreselectEnabled(managed(false, {PI_COC_JEV_PRESELECT: '1'})), false);
  assert.equal(readJevPreselectEnabled(managed(true, {PIPIUI_MOUNTED_EXTENSIONS: 'kernel', PI_COC_JEV_PRESELECT: '1'})), false);
  assert.equal(readJevPreselectEnabled(managed(true, {PIPIUI_MOUNTED_EXTENSIONS: undefined, PI_COC_JEV_PRESELECT: '1'})), false);
});

test('source CLI accepts only explicit development overrides and otherwise defaults false', () => {
  assert.equal(readJevPreselectEnabled({PI_COC_JEV_PRESELECT: '1'}), true);
  assert.equal(readJevPreselectEnabled({PI_COC_JEV_PRESELECT: '0'}), false);
  assert.equal(readJevPreselectEnabled({PI_COC_JEV_PRESELECT: 'yes'}), false);
  assert.equal(readJevPreselectEnabled({}), false);
  assert.equal(readJevPreselectEnabled({[SETTINGS_ENV]: JSON.stringify({[PRESELECT_KEY]: true})}), true,
    'cold preparation consumes the mounted settings snapshot');
});

test('prescreen status separates configured, enabled and active', () => {
  assert.deepEqual(describePrescreenConfig(managed(true)), {configured: true, enabled: true, active: true});
  assert.deepEqual(describePrescreenConfig(managed(false)), {configured: true, enabled: false, active: false});
  assert.deepEqual(describePrescreenConfig(managed(true, {[API_KEY_ENV]: ''})), {configured: false, enabled: true, active: false});
});

test('manifest declares the optional boolean disabled by default', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../extensions/jev/pipiui-extension.json', import.meta.url)));
  assert.deepEqual(manifest.app.settings.schema.properties[PRESELECT_KEY], {
    type: 'boolean', default: false, title: 'Enable Jev context preselection',
    description: 'Supply selected private context before Keeper requests. Requires a configured TypeSafe API key.'
  });
});

test('jev status exposes configured, enabled and active separately', () => {
  assert.equal(formatJevStatus(managed(true)), 'Jev: configured=yes; preselection enabled=yes; active=yes');
  assert.equal(formatJevStatus(managed(false)), 'Jev: configured=yes; preselection enabled=no; active=no');
  assert.equal(formatJevStatus(managed(true, {[API_KEY_ENV]: ''})), 'Jev: configured=no; preselection enabled=yes; active=no');
});
