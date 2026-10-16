import { sniffImageMime } from '../../grok-build-oauth/agent/images/client.js';
import { IMAGE_MODELS, VIDEO_MODELS, mediaOrigin } from './config.js';

function nonempty(value, limit, name) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > limit) throw Error(`Invalid MiniMax ${name}`);
  return value;
}
function oneOf(value, values, name) {
  if (!values.includes(value)) throw Error(`Unsupported MiniMax ${name}`);
  return value;
}
/** A single HTTP attempt. Never echo raw error bodies or credentials. */
async function jsonRequest(path, creds, body, opts = {}) {
  nonempty(creds.apiKey, 32768, 'credential');
  const origin = mediaOrigin(creds.baseUrl, creds.provider);
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000);
  let response;
  try {
    response = await (opts.fetchImpl ?? fetch)(origin + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${creds.apiKey}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    if (signal.aborted) throw Error('MiniMax media request cancelled or timed out; an already submitted task may still be running');
    throw Error('MiniMax media transport failed; submission was not retried');
  }
  if (!response.ok) throw Error(`MiniMax media HTTP ${response.status}; no account or model fallback was attempted`);
  const value = await response.json().catch(() => { throw Error('Invalid MiniMax media JSON response'); });
  if (value.base_resp && value.base_resp.status_code !== 0) throw Error(`MiniMax media rejected the request (code ${Number.isSafeInteger(value.base_resp.status_code) ? value.base_resp.status_code : 'unknown'})`);
  if (value.error) throw Error('MiniMax media returned a provider error');
  return value;
}

/** Shared image_gen adapter: subject-reference regeneration, not masked editing. */
export async function minimaxImageAdapter(req, creds, opts = {}) {
  oneOf(req.model, IMAGE_MODELS, 'image model');
  const body = { model: req.model, prompt: nonempty(req.prompt, 1500, 'image prompt'), n: 1,
    response_format: 'base64', prompt_optimizer: false };
  if (req.aspectRatio && req.aspectRatio !== 'auto') body.aspect_ratio = oneOf(req.aspectRatio,
    req.model === 'image-01' ? ['1:1','16:9','4:3','3:2','2:3','3:4','9:16','21:9'] : ['1:1','16:9','4:3','3:2','2:3','3:4','9:16'], 'image ratio');
  if (req.kind === 'edit') {
    if (!req.images?.length) throw Error('MiniMax subject-reference generation requires an image');
    body.subject_reference = req.images.map(image => {
      if (typeof image !== 'string' || !/^data:image\/(png|jpeg);base64,/.test(image)
        || Buffer.byteLength(image.slice(image.indexOf(',') + 1), 'base64') >= 10 * 1024 * 1024) throw Error('Invalid MiniMax subject reference');
      return { type: 'character', image_file: image };
    });
  }
  const value = await jsonRequest('/v1/image_generation', creds, body, opts);
  const encoded = value.data?.image_base64?.[0];
  if (typeof encoded !== 'string' || !encoded.length) throw Error('MiniMax returned no base64 image');
  const bytes = Buffer.from(encoded, 'base64');
  const mime = sniffImageMime(bytes);
  const magic = bytes.subarray(0,3).equals(Buffer.from([255,216,255]))
    || bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    || bytes.length >= 12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
  if (!magic) throw Error('MiniMax returned invalid image data');
  return { bytes, mime, model: req.model };
}

function frame(value) {
  if (typeof value !== 'string') throw Error('MiniMax video frames must be HTTPS or image data URLs');
  if (/^data:image\/(png|jpeg|webp);base64,/.test(value)) {
    if (Buffer.byteLength(value, 'utf8') > 40 * 1024 * 1024) throw Error('MiniMax video frame is too large');
    return value;
  }
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('MiniMax video frames require HTTPS');
  return url.href;
}
export function videoBody(req) {
  const model = oneOf(req.model ?? 'MiniMax-H3', VIDEO_MODELS, 'video model');
  const duration = req.duration ?? 5;
  if (!Number.isInteger(duration) || duration < (model === 'MiniMax-H3' ? 4 : 5) || duration > 15) throw Error('Unsupported MiniMax video duration');
  const resolution = oneOf(req.resolution ?? '768P', model === 'MiniMax-H3' ? ['768P','2K'] : ['480P','768P'], 'video resolution');
  const content = [{ type: 'text', text: nonempty(req.prompt, 7000, 'video prompt') }];
  if (req.last_frame && !req.first_frame) throw Error('MiniMax last_frame requires first_frame in this extension');
  if (req.first_frame) content.push({ type: 'image_url', image_url: {url: frame(req.first_frame)}, role: 'first_frame' });
  if (req.last_frame) content.push({ type: 'image_url', image_url: {url: frame(req.last_frame)}, role: 'last_frame' });
  const ratio = content.length > 1 ? 'adaptive' : oneOf(req.aspect_ratio ?? '16:9', ['21:9','16:9','4:3','1:1','3:4','9:16'], 'video ratio');
  const body = { model, content, resolution, duration, ratio };
  if (Buffer.byteLength(JSON.stringify(body)) > 64 * 1024 * 1024) throw Error('MiniMax video request exceeds 64 MB');
  return body;
}
export async function createVideo(req, creds, opts) {
  const body = videoBody(req);
  const value = await jsonRequest('/v2/video_generation', creds, body, opts);
  return { task_id: taskId(value.task_id), model: body.model, status: 'submitted' };
}
function taskId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw Error('Invalid MiniMax task id');
  return value;
}
export async function queryVideo(id, creds, opts) {
  const value = await jsonRequest('/v2/query/video_generation/' + encodeURIComponent(taskId(id)), creds, undefined, opts);
  const task = value.task;
  if (task?.id !== id) throw Error('MiniMax task response does not match the requested task');
  oneOf(task.status, ['queued','running','succeeded','failed','cancelled'], 'video task status');
  const result = {task_id: id, model: task.model, status: task.status};
  if (task.status === 'succeeded') {
    const url = new URL(task.content?.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('MiniMax video result requires HTTPS');
    result.url = url.href;
  }
  if (task.status === 'failed') result.error = 'MiniMax video generation failed';
  return result;
}
