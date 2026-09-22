// @vitest-environment jsdom
import React from 'react';
import {render, screen, fireEvent, cleanup, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {createComponent, API_KEY_KEY, PRESELECT_KEY} from '../../../../extensions/jev/app/settings-jev.js';
import {HOST_SETTINGS_TAB_IDS} from './ui-registries';
import {SETTINGS_NAV_HINTS} from './ModelVisibilityModal';
const Section = createComponent(React);
afterEach(cleanup);
const host = () => ({getExtensionSettings: vi.fn(async () => ({})), updateExtensionSettings: vi.fn(async () => ({ok: true}))});

it('registers a visible Jev settings section', () => {
  expect(HOST_SETTINGS_TAB_IDS).toContain('jev');
  expect(SETTINGS_NAV_HINTS.jev).toBeTruthy();
});

it('commits a whole key once, clears the input only after success, and can remove it', async () => {
  const api = host();
  render(<Section ctx={{host: api}} />);
  await screen.findByText('No credential saved');
  const input = screen.getByLabelText('TypeSafe API key') as HTMLInputElement;
  expect(input.type).toBe('password');
  fireEvent.change(input, {target: {value: 'test-secret-key'}});
  expect(api.updateExtensionSettings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Save'));
  await screen.findByText('Credential saved');
  expect(api.updateExtensionSettings).toHaveBeenCalledExactlyOnceWith('jev', {[API_KEY_KEY]: 'test-secret-key'});
  expect(input.value).toBe('');
  fireEvent.click(screen.getByText('Clear'));
  await screen.findByText('No credential saved');
  expect(api.updateExtensionSettings).toHaveBeenLastCalledWith('jev', {[API_KEY_KEY]: null});
});

it('a rejected write retains the draft and does not claim a saved credential or echo errors', async () => {
  const api = host();
  api.updateExtensionSettings.mockResolvedValue({ok: false, error: {message: 'test-secret-key'}} as any);
  render(<Section ctx={{host: api}} />);
  await screen.findByText('No credential saved');
  const input = screen.getByLabelText('TypeSafe API key') as HTMLInputElement;
  fireEvent.change(input, {target: {value: 'test-secret-key'}});
  fireEvent.submit(input.closest('form')!);
  await screen.findByRole('alert');
  expect(screen.getByRole('status').textContent).toBe('No credential saved');
  expect(screen.getByRole('alert').textContent).not.toContain('test-secret-key');
  expect(input.value).toBe('test-secret-key');
});

it('does not submit overlapping writes or allow a late reply after unmount', async () => {
  const api = host();
  let complete: (value: any) => void = () => {};
  api.updateExtensionSettings.mockImplementation(() => new Promise(resolve => {complete = resolve;}));
  const view = render(<Section ctx={{host: api}} />);
  await screen.findByText('No credential saved');
  const input = screen.getByLabelText('TypeSafe API key');
  fireEvent.change(input, {target: {value: 'test-secret-key'}});
  fireEvent.submit(input.closest('form')!);
  fireEvent.submit(input.closest('form')!);
  expect(api.updateExtensionSettings).toHaveBeenCalledTimes(1);
  view.unmount(); complete({ok: true});
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
});

it('saves context preselection as a boolean without rewriting the secret', async () => {
  const api = host();
  render(<Section ctx={{host: api}} />);
  await screen.findByText('Context preselection disabled');
  const checkbox = screen.getByLabelText('Enable Jev context preselection') as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  await screen.findByText('Context preselection enabled');
  expect(api.updateExtensionSettings).toHaveBeenCalledExactlyOnceWith('jev', {[PRESELECT_KEY]: true});
  expect(api.updateExtensionSettings.mock.calls[0][1]).not.toHaveProperty(API_KEY_KEY);
});

it('a rejected preselection write leaves the displayed setting unchanged', async () => {
  const api = host();
  api.updateExtensionSettings.mockResolvedValue({ok: false} as any);
  render(<Section ctx={{host: api}} />);
  await screen.findByText('Context preselection disabled');
  const checkbox = screen.getByLabelText('Enable Jev context preselection') as HTMLInputElement;
  fireEvent.click(checkbox);
  await screen.findByRole('alert');
  expect(checkbox.checked).toBe(false);
  expect(screen.getByText('Context preselection disabled')).toBeTruthy();
});
