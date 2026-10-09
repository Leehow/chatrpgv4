/** §73.3: extensions/kernel/index.ts settles only after a successful stranded release has updated host state. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable, waitFor} from './harness.mjs';

const look = () => fauxAssistantMessage([fauxToolCall('look', {focus: 'scene'})], {stopReason: 'toolUse'});
const narrate = text => fauxAssistantMessage([fauxToolCall('narrate', {text})], {stopReason: 'toolUse'});

test('an input immediately after a delayed successful release carries no stale stranded flag', async t => {
	const table = await openTable({env: {FAKE_KERNEL_RELEASE_REPLY_DELAY_MS: '1000'}, responses: [
		look(), narrate('The refused draft.'), fauxAssistantMessage('No delivery can land.'),
		look(), fauxAssistantMessage('The new input was accepted.'),
	]});
	t.after(() => table.dispose());
	table.emit('coc:task-delivery-guard', () => { throw Error('Fixture delivery expired'); });
	await table.session.prompt('I listen at the door.');
	await waitFor(() => table.kernelRequests().some(x => x.method === 'table.release'), {label: 'the stranded release', timeoutMs: 60000});
	await table.session.prompt('I return to the corridor.');
	await waitFor(() => table.kernelRequests().filter(x => x.method === 'table.player_input').length >= 2,
		{label: 'the next input', timeoutMs: 60000});
	const inputs = table.kernelRequests().filter(x => x.method === 'table.player_input');
	assert.equal(inputs[1].params.release, undefined, 'the kernel already closed the prior turn; the input must be ordinary');
});
