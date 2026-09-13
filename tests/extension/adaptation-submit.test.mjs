import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import adaptationSubmit from '../../extensions/kernel/adaptation-submit.ts';

test('adaptation submission checks the phase shape, writes once and terminates', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'adaptation-submit-'));
    const previousRole = process.env.PI_COC_ADAPTATION_SUBMIT_ROLE, previousDir = process.env.PI_COC_ADAPTATION_SUBMIT_DIR;
    process.env.PI_COC_ADAPTATION_SUBMIT_ROLE = 'review'; process.env.PI_COC_ADAPTATION_SUBMIT_DIR = cwd;
    try {
        const hooks = {}, reminders = []; let tool;
        adaptationSubmit({on(name, fn) {hooks[name] = fn;}, registerTool(value) {tool = value;}, sendMessage(value) {reminders.push(value);}});
        const invalid = await tool.execute('one', {result: {verdict: 'supported'}});
        assert.equal(invalid.isError, true);
        hooks.agent_end(); assert.equal(reminders.length, 1); assert.match(reminders[0].content, /submit_adaptation/);
        const result = {verdict: 'supported', summary: 'Checked.', issues: [], checked: []};
        const accepted = await tool.execute('two', {result});
        assert.equal(accepted.terminate, true);
        assert.deepEqual(JSON.parse(await readFile(join(cwd, 'result.json'), 'utf8')), result);
        hooks.agent_end(); assert.equal(reminders.length, 1);
    } finally {
        if (previousRole == null) delete process.env.PI_COC_ADAPTATION_SUBMIT_ROLE; else process.env.PI_COC_ADAPTATION_SUBMIT_ROLE = previousRole;
        if (previousDir == null) delete process.env.PI_COC_ADAPTATION_SUBMIT_DIR; else process.env.PI_COC_ADAPTATION_SUBMIT_DIR = previousDir;
    }
});
