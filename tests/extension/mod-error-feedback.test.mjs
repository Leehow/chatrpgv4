import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {KernelError} from '../../extensions/kernel/client.ts';
import {openTable} from './harness.mjs';



// Section 166 retires automatic prose-review integration cases.
// Current no-review delivery coverage: single-pass-narration.test.mjs and post-delivery-continuity.test.mjs.
