# Image Generation

Owns the `image_gen` / `image_edit` agent tools for pipicoc: one tool surface,
several backends (contract §172).

## Dispatch order

Per call, at execution time, one route is resolved:

1. **Explicit choice wins.** The tool's optional `model` parameter
   (`<provider>/<model-id>` or a bare model id), else the configured model
   (`<agentHome>/image-model.json`, set with `/image-gen:model` or the
   settings picker). `openai-codex/gpt-image-2` pins the Codex adapter; every
   other provider routes to the vendor adapter its model id names (a bare
   `gpt-image-2` is looked up in the registry and does not reach Codex).
   Credentials and the base URL come from pi's model registry
   (`ctx.modelRegistry`) — `auth.json` is never read directly and no key is
   hardcoded. API keys travel over HTTPS only.
2. **Codex, when usable** (only while nothing is chosen). The player's
   ChatGPT subscription through Pi's built-in `openai-codex` login: the
   registry returns a token whose `https://api.openai.com/auth` claim carries
   `chatgpt_account_id` and a `chatgpt_plan_type` other than `free`. The
   extension never refreshes the token and never reads auth.json; Pi owns
   OAuth, refresh and the auth.json lock.
3. **grok-build, when usable.** When the grok-build-oauth OAuth credential is
   usable, the call delegates to that extension's host library — same broker,
   tier gate, reference containment and session image writer as the grok
   tools.
4. Otherwise the call fails with `image_model_unconfigured`.

A failure on the route taken surfaces as-is: no silent fall-through to
another paid lane in either direction, quota exhaustion included. An explicit
Codex choice that cannot run fails with `codex_not_signed_in`,
`codex_plan_excluded` or `codex_account_missing`; a Codex HTTP 429 whose body
says `usage_limit_reached` fails with `image_quota_exhausted` (carrying
`resets_at` and the `x-codex-active-limit` value).

The Codex endpoint ignores `quality` and `size`, so the adapter sends the
fixed values Codex CLI sends (`quality: "auto"`, `size: "auto"`) and carries a
non-`auto` aspect ratio as one fixed orientation sentence at the head of the
prompt.

## Configuration

- `/image-gen:model <provider>/<model-id>` — set the image model, persisted
  to `<agentHome>/image-model.json` as `{ "model": "..." }`
  (agent home: `PI_COC_AGENT_DIR` > `PI_CODING_AGENT_DIR`). A choice
  overrides the automatic Codex / grok-build route on every lane (the tools,
  `/image` and the portrait mount share one dispatch).
  `/image-gen:model openai-codex/gpt-image-2` pins Codex, like the settings
  picker's "Codex (gpt-image-2)" row.
- `/image-gen:model` with no argument shows the current value.
- `/image-gen:status` shows the configured model, the Codex state (signed in,
  plan, active or idle) and the grok-build state.

Without a configured model (and neither a usable Codex nor a usable grok
login) the tools fail with an error that names `/image-gen:model`.

Edits routed to
wan/wanx are rejected with a clear error (no reference-image field is wired
for the async DashScope family); use another family for image-to-image work.

## Supported vendor families

Provider `openai-codex` routes to the Codex adapter (`POST
https://chatgpt.com/backend-api/codex/images/generations`; JSON
`/codex/images/edits` with up to 5 data-URL references). Every other provider
uses a closed mapping on the model id:

| model id contains | adapter |
| --- | --- |
| `gpt-image`, `dall-e` | OpenAI Images (`/v1/images/generations`; multipart `/v1/images/edits`) |
| `grok-` + `image` | OpenAI-shape at `https://api.x.ai` |
| `seedream`, `seededit` | OpenAI-shape at Volcengine Ark (`/api/v3/images/generations`) |
| `gemini-` + `image` | Gemini `generateContent` with `responseModalities: ["TEXT","IMAGE"]` |
| `qwen-image` | DashScope synchronous multimodal generation |
| `wan`, `wanx` | DashScope async task API (create + poll) |
| `imagen-` | recognized but not supported (Vertex predict is out of scope) |

## Tool ownership

Pi does not resolve duplicate tool names by mount order: it refuses to load a
second extension that registers a tool name already taken. Both this
extension and grok-build-oauth can register `image_gen` / `image_edit`, so the
launcher sets `PI_GROK_BUILD_IMAGE_TOOLS=0` and grok-build-oauth leaves its
two image tools unregistered. The grok provider, its slash commands and its
hooks are unaffected, and the grok-build step of the dispatch above keeps the
generation behavior identical.
