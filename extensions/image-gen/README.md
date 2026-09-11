# Image Generation

Owns the `image_gen` / `image_edit` agent tools for pipicoc: one tool surface,
two backends.

## Dispatch order

Per call, at execution time:

1. **Grok first.** When the grok-build-oauth OAuth credential is usable, the
   call delegates to that extension's host library — same broker, tier gate,
   reference containment and session image writer as the grok tools. A grok
   failure surfaces as-is; a logged-in grok never silently falls through to a
   paid vendor key.
2. **Vendor fallback** (only when grok is not usable). The model is the tool's
   optional `model` parameter (`<provider>/<model-id>` or a bare model id) if
   given, else the configured fallback model. Credentials and the base URL
   come from pi's model registry (`ctx.modelRegistry`) — `auth.json` is never
   read directly and no key is hardcoded. API keys travel over HTTPS only.

## Configuration

- `/image-gen:model <provider>/<model-id>` — set the fallback image model,
  persisted to `<agentHome>/image-model.json` as `{ "model": "..." }`
  (agent home: `PI_COC_AGENT_DIR` > `PI_CODING_AGENT_DIR`).
- `/image-gen:model` with no argument shows the current value.
- `/image-gen:status` shows which half of the dispatch is active.

Without a configured model (and no usable grok login) the tools fail with an
error that names `/image-gen:model`.

The tools' optional `model` parameter only shapes the vendor fallback — a
usable grok-build login always takes precedence over it. Edits routed to
wan/wanx are rejected with a clear error (no reference-image field is wired
for the async DashScope family); use another family for image-to-image work.

## Supported vendor families (routing is a closed mapping on the model id)

| model id contains | adapter |
| --- | --- |
| `gpt-image`, `dall-e` | OpenAI Images (`/v1/images/generations`; multipart `/v1/images/edits`) |
| `grok-` + `image` | OpenAI-shape at `https://api.x.ai` |
| `seedream`, `seededit` | OpenAI-shape at Volcengine Ark (`/api/v3/images/generations`) |
| `gemini-` + `image` | Gemini `generateContent` with `responseModalities: ["TEXT","IMAGE"]` |
| `qwen-image` | DashScope synchronous multimodal generation |
| `wan`, `wanx` | DashScope async task API (create + poll) |
| `imagen-` | recognized but not supported (Vertex predict is out of scope) |

## Shadowing by design

pi resolves duplicate tool names first-wins by mount order. This extension is
mounted **before** grok-build-oauth, so its `image_gen` / `image_edit`
registrations win and grok-build-oauth's own image tools are skipped. The
grok provider, its slash commands and its hooks are unaffected — only the two
tool names are shadowed, and the grok half of the dispatch above keeps the
behavior identical.
