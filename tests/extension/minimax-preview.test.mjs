import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { AuthStorage } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js';
import { applyProviderModelCorrections, mergeProviderModelCorrections } from '../../runtime/host.ts';

const correctionsPath = new URL('../../content/providers/model-corrections.json', import.meta.url);
const modelId = 'MiniMax-M3.1-Flash-Preview';

test('MiniMax preview is added idempotently without replacing user models or credentials', async () => {
  const corrections = JSON.parse(await readFile(correctionsPath, 'utf8'));
  const existing = { providers: { 'minimax-cn': { apiKey: 'USER_KEY', models: [{ id: 'user-model' }] } } };
  const { config } = mergeProviderModelCorrections(existing, corrections);
  assert.equal(config.providers['minimax-cn'].apiKey, 'USER_KEY');
  assert.deepEqual(config.providers['minimax-cn'].models[0], { id: 'user-model' });
  assert.equal(config.providers['minimax-cn'].models.filter(m => m.id === modelId).length, 1);
  assert.deepEqual(mergeProviderModelCorrections(config, corrections).config, config);
  const userModel = { id: modelId, contextWindow: 12345, compat: { forceAdaptiveThinking: false } };
  const user = { providers: { 'minimax-cn': { models: [userModel] } } };
  assert.deepEqual(mergeProviderModelCorrections(user, corrections).config.providers['minimax-cn'].models, [userModel]);
});

test('MiniMax preview resolves through native Pi and serializes exact adaptive effort values', async t => {
  const root = await mkdtemp(join(tmpdir(), 'minimax-preview-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'models.json'), '{}');
  assert.deepEqual(await applyProviderModelCorrections(root, correctionsPath), { status: 'written' });
  assert.deepEqual(await applyProviderModelCorrections(root, correctionsPath), { status: 'unchanged' });
  const runtime = await ModelRuntime.create({
    credentials: AuthStorage.inMemory({ 'minimax-cn': { type: 'api_key', key: 'test-key' } }),
    modelsPath: join(root, 'models.json'), allowModelNetwork: false,
  });
  assert.equal(runtime.getError(), undefined);
  const model = (await runtime.getAvailable('minimax-cn')).find(m => m.id === modelId);
  assert.ok(model, 'preview must be in the authenticated catalog');
  assert.equal(model.contextWindow, 1_000_000);
  assert.equal(model.compat.forceAdaptiveThinking, true);
  assert.equal(model.thinkingLevelMap.off, null);
  assert.equal(model.thinkingLevelMap.minimal, null);
  // Abort at onPayload: exercise the real serializer without sending a request.
  for (const level of ['low', 'medium', 'high', 'xhigh', 'max', undefined]) {
    let payload;
    const controller = new AbortController();
    await runtime.streamSimple(model, {
      messages: [{ role: 'user', content: 'Reply OK.', timestamp: Date.now() }],
    }, {
      reasoning: level, maxTokens: 256, signal: controller.signal,
      onPayload(value) { payload = value; controller.abort(); },
    }).result();
    assert.ok(payload, `request must serialize for ${level}`);
    assert.notEqual(payload.thinking?.type, 'disabled');
    if (level) {
      assert.equal(payload.thinking.type, 'adaptive');
      assert.equal(payload.output_config.effort, level);
      assert.equal(payload.thinking.budget_tokens, undefined);
    }
  }
});
