# Image Generation

Owns the `image_gen` / `image_edit` agent tools for pipicoc: one tool surface,
two backends.

## Dispatch order

Per call, at execution time:

1. **Explicit choice wins.** The tool's optional `model` parameter
   (`<provider>/<model-id>` or a bare model id), else the configured model
   (`<agentHome>/image-model.json`, set with `/image-gen:model` or the
   settings picker) routes to the matching vendor adapter. Credentials and
   the base URL come from pi's model registry (`ctx.modelRegistry`) —
   `auth.json` is never read directly and no key is hardcoded. API keys
   travel over HTTPS only.
2. **Grok by default** (only while nothing is chosen). When the
   grok-build-oauth OAuth credential is usable, the call delegates to that
   extension's host library — same broker, tier gate, reference containment
   and session image writer as the grok tools.

A failure on the chosen route surfaces as-is: no silent fall-through to
another paid lane in either direction.

## Configuration

- `/image-gen:model <provider>/<model-id>` — set the image model, persisted
  to `<agentHome>/image-model.json` as `{ "model": "..." }`
  (agent home: `PI_COC_AGENT_DIR` > `PI_CODING_AGENT_DIR`). A choice
  overrides the grok-build default on every lane (the tools, `/image` and
  the portrait mount share one dispatch).
- `/image-gen:model` with no argument shows the current value.
- `/image-gen:status` shows which half of the dispatch is active.

Without a configured model (and no usable grok login) the tools fail with an
error that names `/image-gen:model`.

Edits routed to
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
