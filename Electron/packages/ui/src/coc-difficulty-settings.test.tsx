// @vitest-environment jsdom
/**
 * The difficulty settings section (contract §33.5): the dial maps to the §33.1 stored shape,
 * the newspaper panel's knobs are omitted when blank, and the client-side dice/range check is
 * feedback only. Words come from the shipped difficulty surface through the ui-words answer.
 */
import React from 'react';
import {render, screen, fireEvent, cleanup, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  SETTINGS_KEY, blankDraft, buildSetting, createComponent, draftFromSetting, validateSetting,
} from '../../../../pipicoc/settings-difficulty.js';
import {HOST_SETTINGS_TAB_IDS} from './ui-registries';
import {SETTINGS_NAV_HINTS} from './ModelVisibilityModal';
import {say, ui} from './fixtures/coc-ui-words';

const Section = createComponent(React);
afterEach(cleanup);
const en = (key: string) => say('en', 'difficulty', key);

function hostWith(stored?: unknown) {
  return {
    getExtensionSettings: vi.fn(async () => (stored === undefined ? {} : {[SETTINGS_KEY]: stored})),
    updateExtensionSettings: vi.fn(async () => ({ok: true, data: {}})),
  };
}
function renderSection(host: ReturnType<typeof hostWith>) {
  const api = {invoke: vi.fn(async () => ({ok: true, data: {ui: ui('en')}}))};
  render(<Section api={api} ctx={{host}} />);
  return host;
}

describe('registration (contract §33.5)', () => {
  it('admits coc-difficulty into the host whitelist right after extensions', () => {
    expect(HOST_SETTINGS_TAB_IDS).toEqual(['models', 'extensions', 'coc-difficulty', 'coc-lane-model', 'image-model', 'rerank', 'themes', 'updates']);
  });
  it('carries a nav hint', () => {
    expect(typeof SETTINGS_NAV_HINTS['coc-difficulty']).toBe('string');
    expect(SETTINGS_NAV_HINTS['coc-difficulty'].length).toBeGreaterThan(0);
  });
  // Contributing a section is not enough: a tab exists only once its id is admitted, and it reads as
  // a nameless row until the nav has a hint for it. The lane-model picker needed both.
  it('admits the lane-model picker and gives it a nav hint too', () => {
    expect(HOST_SETTINGS_TAB_IDS).toContain('coc-lane-model');
    expect(SETTINGS_NAV_HINTS['coc-lane-model']?.length).toBeGreaterThan(0);
  });
  // The Rerank extension's picker is controlled (its model list depends on the chosen vendor), so
  // it needs the same two admissions a tab needs: the whitelist entry and a nav hint.
  it('admits the rerank picker and gives it a nav hint too', () => {
    expect(HOST_SETTINGS_TAB_IDS).toContain('rerank');
    expect(SETTINGS_NAV_HINTS['rerank']?.length).toBeGreaterThan(0);
  });
});

describe('the stored shape (contract §33.1)', () => {
  it('maps a preset stop to {mode:"preset"} and a blank custom stop to an empty custom object', () => {
    expect(buildSetting({...blankDraft(), stop: 0})).toEqual({mode: 'preset', preset: 'extreme'});
    expect(buildSetting({...blankDraft(), stop: 1})).toEqual({mode: 'preset', preset: 'hard'});
    expect(buildSetting({...blankDraft(), stop: 3})).toEqual({mode: 'preset', preset: 'easy'});
    expect(buildSetting({...blankDraft(), stop: 4})).toEqual({mode: 'custom', custom: {}});
  });
  it('omits blank knobs and keeps set ones, dice keyed by the rulebook pool expressions', () => {
    const setting = buildSetting({...blankDraft(), stop: 4,
      dicePrimary: ' 4D6 ', charMax: '95', luckKind: 'fixed', luckValue: '50',
      occupationKind: 'multiplier', occupationValue: '2', skillCap: '90'});
    expect(setting).toEqual({mode: 'custom', custom: {
      characteristic_dice: {'3D6': '4D6'},
      characteristic_max: 95,
      luck: {fixed: 50},
      occupation_points: {multiplier: 2},
      skill_cap: 90,
    }});
    expect(validateSetting(setting)).toEqual({});
  });
  it('round-trips a stored setting into the draft and back', () => {
    const stored = {mode: 'custom', custom: {
      characteristic_dice: {'3D6': '4D6', '2D6+6': '3D6+4'},
      characteristic_min: 20, characteristic_max: 120,
      luck: {dice: '3D6'},
      occupation_points: {fixed: 400}, interest_points: {multiplier: 3},
      skill_cap: 80,
    }};
    expect(buildSetting(draftFromSetting(stored))).toEqual(stored);
    expect(buildSetting(draftFromSetting({mode: 'preset', preset: 'normal'}))).toEqual({mode: 'preset', preset: 'normal'});
    expect(buildSetting(draftFromSetting(undefined))).toEqual({mode: 'preset', preset: 'normal'});
  });
});

describe('client-side validation (contract §33.3; feedback only)', () => {
  const custom = (patch: Record<string, string>) => buildSetting({...blankDraft(), stop: 4, ...patch});
  it('accepts the closed dice grammar and rejects anything else', () => {
    for (const ok of ['3D6', '2D6+6', '1d100', '10D4+12']) expect(validateSetting(custom({dicePrimary: ok}))).toEqual({});
    for (const bad of ['0D6', 'D6', '3D7', '3D6-1', '3D6+100', 'dice', '3 D6'])
      expect(validateSetting(custom({dicePrimary: bad}))).toEqual({dicePrimary: 'error_dice'});
  });
  it('bounds the characteristic limits to multiples of 5 with min below max', () => {
    expect(validateSetting(custom({charMin: '15', charMax: '90'}))).toEqual({});
    expect(validateSetting(custom({charMin: '17'}))).toEqual({charMin: 'error_multiple_five'});
    expect(validateSetting(custom({charMax: '500'}))).toEqual({charMax: 'error_multiple_five'});
    expect(validateSetting(custom({charMin: '90', charMax: '15'}))).toEqual({charMax: 'error_bounds'});
  });
  it('checks a lone bound against the rulebook creation bound it does not replace (15/90)', () => {
    expect(validateSetting(custom({charMin: '85'}))).toEqual({});
    expect(validateSetting(custom({charMin: '95'}))).toEqual({charMin: 'error_bounds'});
    expect(validateSetting(custom({charMax: '20'}))).toEqual({});
    expect(validateSetting(custom({charMax: '10'}))).toEqual({charMax: 'error_bounds'});
  });
  it('bounds luck, budgets and the skill cap to the §33.3 ranges', () => {
    expect(validateSetting(custom({luckKind: 'fixed', luckValue: '7'}))).toEqual({luckValue: 'error_multiple_five'});
    expect(validateSetting(custom({luckKind: 'dice', luckValue: '3D6'}))).toEqual({});
    expect(validateSetting(custom({occupationKind: 'multiplier', occupationValue: '0.1'}))).toEqual({occupationValue: 'error_range'});
    expect(validateSetting(custom({occupationKind: 'multiplier', occupationValue: '8'}))).toEqual({});
    expect(validateSetting(custom({interestKind: 'fixed', interestValue: '2001'}))).toEqual({interestValue: 'error_range'});
    expect(validateSetting(custom({skillCap: '75.5'}))).toEqual({skillCap: 'error_integer'});
    expect(validateSetting(custom({skillCap: '501'}))).toEqual({skillCap: 'error_range'});
  });
});

describe('the section', () => {
  it('renders the dial stops from the shipped words with normal selected by default', async () => {
    renderSection(hostWith());
    await screen.findByText(en('preset_hard'));
    for (const key of ['preset_extreme', 'preset_normal', 'preset_easy', 'preset_custom'])
      expect(screen.getByText(en(key))).toBeTruthy();
    expect(screen.getByTestId('coc-diff-stop-normal').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(en('preset_hard'))).toBeTruthy();
    for (const key of ['preset_extreme_descriptor', 'preset_hard_descriptor', 'preset_normal_descriptor', 'preset_easy_descriptor'])
      expect(screen.getByText(en(key))).toBeTruthy();
    const note = document.querySelector('.coc-diff-note');
    expect(note?.textContent).toContain(en('applies_note'));
    expect(note?.textContent).toContain(en('preset_normal_note'));
  });
  it('persists a preset choice as {mode:"preset"} under ext.coc-keeper.difficulty', async () => {
    const host = renderSection(hostWith());
    await screen.findByText(en('preset_easy'));
    fireEvent.click(screen.getByTestId('coc-diff-stop-easy'));
    await waitFor(() => expect(host.updateExtensionSettings).toHaveBeenCalledWith('coc-keeper',
      {[SETTINGS_KEY]: {mode: 'preset', preset: 'easy'}}));
  });
  it('unfolds the newspaper panel on the custom stop and persists only the set knobs', async () => {
    const host = renderSection(hostWith());
    await screen.findByText(en('preset_custom'));
    fireEvent.click(screen.getByTestId('coc-diff-stop-custom'));
    await screen.findByText(en('custom_headline'));
    expect(screen.getByText(en('custom_masthead'))).toBeTruthy();
    fireEvent.change(screen.getByTestId('coc-diff-skillCap'), {target: {value: '90'}});
    await waitFor(() => expect(host.updateExtensionSettings).toHaveBeenLastCalledWith('coc-keeper',
      {[SETTINGS_KEY]: {mode: 'custom', custom: {skill_cap: 90}}}));
  });
  it('shows a newspaper error for a bad dice expression and stops persisting', async () => {
    const host = renderSection(hostWith({mode: 'custom', custom: {}}));
    await screen.findByText(en('custom_headline'));
    host.updateExtensionSettings.mockClear();
    fireEvent.change(screen.getByTestId('coc-diff-dicePrimary'), {target: {value: '3D7'}});
    await screen.findByText(en('error_dice'));
    expect(host.updateExtensionSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId('coc-diff-dicePrimary').getAttribute('aria-invalid')).toBe('true');
  });
  it('restores a stored custom setting onto the draft', async () => {
    renderSection(hostWith({mode: 'custom', custom: {skill_cap: 80, luck: {fixed: 50}}}));
    await screen.findByText(en('custom_headline'));
    expect((screen.getByTestId('coc-diff-skillCap') as HTMLInputElement).value).toBe('80');
    expect((screen.getByTestId('coc-diff-luckValue') as HTMLInputElement).value).toBe('50');
    expect((screen.getByTestId('coc-diff-luckKind') as HTMLSelectElement).value).toBe('fixed');
  });
});
