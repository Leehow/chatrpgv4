/** DeepSeek Messages policy around Pi's existing serializer and SSE streamer. */
import {streamSimple} from '@earendil-works/pi-ai/api/anthropic-messages';
import {getCurrentSystemMessage, hasNonAdditiveToolChanges} from '@earendil-works/pi-ai/utils/transcript';
import {getSystemMessageText} from '@earendil-works/pi-ai/utils/text';
import {resolveBaseUrl} from './config.js';
import {DEEPSEEK_FAMILY_DEFAULTS, deepseekMessagesCompat} from './models.js';
import {assertRequestBodySize, assertFilesImageWithinLimit, decodedBase64ByteLength, decideImageRoute} from './images.js';
import {FilesImageChannel} from './files/channel.js';
import {DeepSeekFilesClient} from './files/client.js';
import {defaultFileIdCache} from './files/cache.js';

export function messagesBaseUrl(baseUrl) {
  const url = new URL(resolveBaseUrl(baseUrl));
  if (url.username || url.password || url.search || url.hash) throw new Error('DeepSeek baseUrl must not contain credentials, query or fragment');
  let path = url.pathname.replace(/\/+$/, '');
  if (url.origin === 'https://api.deepseek.com' && ['', '/v1'].includes(path)) path = '/anthropic';
  // The SDK supplies /v1/messages itself.
  if (path.endsWith('/v1')) path = path.slice(0, -3);
  return url.origin + path;
}

/** Derive snapshots only from persisted transcript deltas; no process-local prompt state. */
export function messagesContext(context, model) {
  if (!model.compat.supportsMidConvoSystemMessages) return context;
  const systems = [];
  return {...context, messages: context.messages.map(message => {
    if (message.role !== 'system') return message;
    systems.push(message);
    if (systems.length === 1) return message;
    const {sections, ...rest} = message;
    return {...rest, content: getSystemMessageText(getCurrentSystemMessage(systems))};
  })};
}

function cleanBlock(block) {
  if (!block || typeof block !== 'object') return block;
  const {cache_control, ...next} = block;
  if (Array.isArray(next.content)) next.content = next.content.map(cleanBlock);
  return next;
}

/** Keep only DeepSeek's thinking controls, without an authored reasoning directive. */
export function rewriteMessagesPayload(payload) {
  if (payload.response_format || payload.text?.format || payload.output_config?.format) {
    throw new Error('DeepSeek Messages does not support structured output formats; no protocol fallback was performed');
  }
  const {betas, ...next} = payload;
  next.thinking = {type: payload.thinking?.type === 'disabled' ? 'disabled' : 'enabled'};
  if (next.thinking.type === 'disabled') delete next.output_config;
  else {
    const effort = payload.output_config?.effort ?? 'high';
    if (!['low', 'high', 'max'].includes(effort)) throw new Error(`Unsupported DeepSeek thinking effort: ${effort}`);
    next.output_config = {effort};
  }
  if (Array.isArray(next.system)) next.system = next.system.map(cleanBlock);
  next.messages = next.messages.map(message => ({...message,
    content: Array.isArray(message.content) ? message.content.map(cleanBlock) : message.content}));
  if (Array.isArray(next.tools)) next.tools = next.tools.map(cleanBlock);
  assertRequestBodySize(next);
  return next;
}

/** Preserve Messages image shapes, including nested tool-result images and Files reuse. */
export async function rewriteMessagesImages(payload, model, options) {
  let files;
  async function block(part) {
    if (!part || typeof part !== 'object') return part;
    if (Array.isArray(part.content)) {
      const content = [];
      for (const child of part.content) content.push(await block(child));
      return {...part, content};
    }
    if (part.type !== 'image' || part.source?.type !== 'base64') return part;
    const length = decodedBase64ByteLength(part.source.data);
    const route = decideImageRoute(length, options.limits);
    if (route.kind === 'inline') return part;
    if (route.kind === 'too_large') assertFilesImageWithinLimit(length, options.limits?.maxFilesBytes);
    files ??= options.files ?? new FilesImageChannel(new DeepSeekFilesClient({
      baseUrl: model.baseUrl.replace(/\/anthropic$/, ''), apiKey: options.apiKey, fetchImpl: options.fetch,
    }), defaultFileIdCache());
    const id = await files.resolve({bytes: Buffer.from(part.source.data, 'base64'), mimeType: part.source.media_type, signal: options.signal});
    return {...part, source: {type: 'file', file_id: id}};
  }
  // Sequential traversal ensures identical image occurrences share the first completed upload.
  const messages = [];
  for (const message of payload.messages) {
    const content = [];
    if (Array.isArray(message.content)) {
      for (const part of message.content) content.push(await block(part));
      messages.push({...message, content});
    } else messages.push(message);
  }
  return {...payload, messages};
}

export function messagesModel(model) {
  return {...model, api: 'anthropic-messages', baseUrl: messagesBaseUrl(model.baseUrl),
    thinkingLevelMap: {...DEEPSEEK_FAMILY_DEFAULTS.thinkingLevelMap},
    compat: {...model.compat, ...deepseekMessagesCompat(model.id)}};
}

export function deepseekMessagesStream(model, context, options = {}) {
  // DeepSeek verifies additions only. Removal/redefinition uses the current tool set.
  model = {...model, compat: {...model.compat, supportsMidConvoToolChanges:
    model.compat.supportsMidConvoToolChanges && !hasNonAdditiveToolChanges(context.messages)}};
  const reasoning = options.reasoning ?? (options.thinkingEnabled ? options.effort ?? 'high' : undefined);
  const forwarded = {...options, reasoning: reasoning === 'off' ? undefined : reasoning, cacheRetention: 'none',
    headers: {...options.headers, 'anthropic-beta': ['files-api-2025-04-14',
      ...(model.compat.supportsMidConvoToolChanges ? ['mid-conversation-tool-changes-2026-07-01'] : [])].join(',')},
    onPayload: async (payload, physical) => {
      const prepared = await options.onPayload?.(payload, physical) ?? payload;
      const withImages = await rewriteMessagesImages(prepared, model, options);
      return rewriteMessagesPayload(withImages);
    }};
  return streamSimple(model, messagesContext(context, model), forwarded);
}
