import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import moduleExtension from '../../extensions/module/index.ts';
import {readerCommand} from '../../extensions/module/reader.ts';

for (const [profile, pinned] of [
  ['codex-relay/gpt-6-luna', 'high'],
  ['grok-build/grok-4.5', 'high'],
  ['minimax-cn/MiniMax-M3.1-Flash-Preview', 'medium'],
  [undefined, undefined],
  ['fixture/other-model', undefined],
]) {
  test(`BUILD reader factory preserves the exact test profile: ${profile ?? 'ordinary session'}`, async t => {
    const previous = process.env.PI_COC_TEST_MODEL;
    if (profile === undefined) delete process.env.PI_COC_TEST_MODEL;
    else process.env.PI_COC_TEST_MODEL = profile;
    t.after(() => {
      if (previous === undefined) delete process.env.PI_COC_TEST_MODEL;
      else process.env.PI_COC_TEST_MODEL = previous;
    });
    const events = new EventEmitter(), hooks = new Map();
    let reading, tableThinking = 'off';
    events.on('coc:reading-bridge', service => { reading = service; });
    moduleExtension({events, on(name, hook) { hooks.set(name, hook); }, appendEntry() {},
      getThinkingLevel() { return tableThinking; }});
    const ctx = {model: {provider: 'fixture', id: 'table'},
      modelRegistry: {find(provider, id) {
        assert.equal(provider, 'fixture'); assert.equal(id, 'reader');
        return {input: ['text', 'image'], contextWindow: 200000};
      }}};
    events.emit('coc:kernel-bridge', {campaign: 'fixture',
      runtime: {home: '/unused', readerModel: 'fixture/reader'}, async call() { return {}; }});
    await hooks.get('session_start')({}, ctx);
    t.after(() => hooks.get('session_shutdown')());
    assert.ok(reading, 'The extension publishes its actual reading service');
    for (const level of ['off', 'max']) {
      tableThinking = level;
      const selected = reading.deps.model();
      assert.deepEqual(selected, {id: 'fixture/reader', vision: true,
        thinking: pinned ?? level, contextWindow: 200000});
      const args = readerCommand(selected.id, undefined, selected.thinking);
      assert.equal(args[args.indexOf('--thinking') + 1], pinned ?? level);
      assert.equal(args[args.indexOf('--model') + 1], 'fixture/reader');
    }
  });
}
