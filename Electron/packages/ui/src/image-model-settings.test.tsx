// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createComponent } from '../../../../extensions/image-gen/app/settings-model.js';

const Panel = createComponent(React);
afterEach(cleanup);

it('refreshes Automatic with the current chat provider and keeps every configured image option selectable', async () => {
  const models = [
    { provider: 'grok-build', id: 'grok-imagine-image', name: 'Grok Imagine' },
    { provider: 'minimax-cn', id: 'image-01', name: 'MiniMax Image 01' },
    { provider: 'openai-codex', id: 'gpt-image-2', name: 'Codex (gpt-image-2)' },
  ];
  let current: string | null = null;
  const invoke = vi.fn(async (_method, params) => {
    if (params.op === 'set') current = params.model;
    if (params.op === 'clear') current = null;
    return { ok: true, data: { current, models, autoModel: params.selectedModel.provider === 'minimax-cn'
      ? 'minimax-cn/image-01' : 'grok-build/grok-imagine-image' } };
  });
  const api = { invoke };
  const view = render(<Panel api={api} ctx={{ current: { provider: 'grok-build', id: 'grok-4.5' }, visibility: { models: [] } }} />);
  await waitFor(() => expect(screen.getByTestId('image-model-row-auto').textContent).toContain('grok-build/grok-imagine-image'));
  for (const model of models) expect(screen.getByRole('radio', { name: model.name })).toBeTruthy();
  fireEvent.click(screen.getByTestId('image-model-row-openai-codex/gpt-image-2'));
  await waitFor(() => expect(screen.getByTestId('image-model-row-openai-codex/gpt-image-2').getAttribute('aria-pressed')).toBe('true'));
  view.rerender(<Panel api={api} ctx={{ current: { provider: 'minimax-cn', id: 'MiniMax-M2.5' }, visibility: { models: [] } }} />);
  await waitFor(() => expect(screen.getByTestId('image-model-row-auto').textContent).toContain('minimax-cn/image-01'));
  expect(screen.getByTestId('image-model-row-openai-codex/gpt-image-2').getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByTestId('image-model-row-auto'));
  await waitFor(() => expect(screen.getByTestId('image-model-row-auto').getAttribute('aria-pressed')).toBe('true'));
  expect(invoke).toHaveBeenLastCalledWith('model', { op: 'clear', selectedModel: { provider: 'minimax-cn', id: 'MiniMax-M2.5' } });
});
