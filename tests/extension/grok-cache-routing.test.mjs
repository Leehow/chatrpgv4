// xAI routes a request to the server holding its prompt cache only by `x-grok-conv-id`; Pi's session id went
// out as `prompt_cache_key`, which xAI ignores, so a Keeper turn's first call missed the cache (2026-10-02).
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import test from 'node:test';

import {CONVERSATION_HEADER, registerCacheRoutingHooks, routeCacheByConversation} from '../../extensions/grok-build-oauth/agent/cache-routing.js';

const ROOT = resolve(import.meta.dirname, '../..');
const ctx = (provider, sessionId) => ({model: {provider, id: 'grok-4.5'}, sessionManager: {getSessionId: () => sessionId}});

test('a grok-build request carries the session id as x-grok-conv-id', () => {
  const headers = {authorization: 'Bearer t', 'x-client-request-id': 'session-1'};
  routeCacheByConversation(headers, ctx('grok-build', 'session-1'));
  assert.equal(headers[CONVERSATION_HEADER], 'session-1');
});

test('the same session keeps one conversation id across turns', () => {
  const first = {}, second = {};
  routeCacheByConversation(first, ctx('grok-build', 'table-session'));
  routeCacheByConversation(second, ctx('grok-build', 'table-session'));
  assert.equal(first[CONVERSATION_HEADER], second[CONVERSATION_HEADER]);
});

test('another provider is left alone', () => {
  const headers = {authorization: 'Bearer t'};
  routeCacheByConversation(headers, ctx('opencode-go', 'session-1'));
  assert.equal(CONVERSATION_HEADER in headers, false);
});

test('a conversation header the caller set wins, whatever its case', () => {
  const headers = {'X-Grok-Conv-Id': 'chosen'};
  routeCacheByConversation(headers, ctx('grok-build', 'session-1'));
  assert.deepEqual(headers, {'X-Grok-Conv-Id': 'chosen'});
});

test('without a session id the request id Pi derived from it is used, and with neither nothing is added', () => {
  const derived = {'x-client-request-id': 'from-pi'};
  routeCacheByConversation(derived, {model: {provider: 'grok-build'}});
  assert.equal(derived[CONVERSATION_HEADER], 'from-pi');
  const none = {};
  routeCacheByConversation(none, {model: {provider: 'grok-build'}, sessionManager: {getSessionId: () => ''}});
  assert.equal(CONVERSATION_HEADER in none, false);
});

test('the hook mutates the header map in place, as Pi expects of before_provider_headers', () => {
  const handlers = new Map();
  registerCacheRoutingHooks({on: (name, handler) => handlers.set(name, handler)});
  const headers = {};
  assert.equal(handlers.get('before_provider_headers')({type: 'before_provider_headers', headers}, ctx('grok-build', 's')), undefined);
  assert.equal(headers[CONVERSATION_HEADER], 's');
});

test('the extension entry registers the hook', async () => {
  const entry = await readFile(join(ROOT, 'extensions/grok-build-oauth/agent/index.js'), 'utf8');
  assert.match(entry, /registerCacheRoutingHooks\(pi\)/);
});
