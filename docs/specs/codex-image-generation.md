# Generate images on the player's Codex (ChatGPT) subscription

Status: ready-for-agent — contract §172; implementation on `claude/codex-image-20261003`
Date: 2026-10-03
Baseline inspected: 0.9.6a at 8bafe5141.
Related contract: §22.7 (investigator portrait mount, image-gen dispatch reuse), §35.4 (illustration image call, protagonist reference), §23 (settings words are English-authored and projected). The contract change lands as a new § when this is implemented; this spec links back to it then.

## Owner request (2026-10-03)

> 研究开源 codex 的鉴权……看看是否可以做一个 pipicoc 的 codex 扩展，就像 grok-build 插件这种直接通过登陆 chatgpt 的方式登陆，可以使用 codex 的额度，并且可以使用 codex 的图片生成

Rulings after the research and live probe:

> Codex 优先，证件照画质一直是 low，插件可以选择画质选项默认 medium，其他地方的生成按照玩家自己选择的来

> OpenAI gpt-image 也接上画质，开始实现吧

> 如果不能设置画质那就不需要这个画质选项了呗，以后的事以后再说，现在先尽可能简洁，就跟grok build那样

**Amended 2026-10-03 after the probes: the quality setting is withdrawn.** The Codex endpoint ignores `quality` and `size`, and the aspect ratio is steered by a prompt prefix instead. Contract §172 is authoritative. Everything below about a quality option, the portrait's fixed `low`, OpenAI `gpt-image` quality, the `quality` invoke op and `image-model.json`'s `quality` field (user stories 11–15 and 21, the Quality / Settings persistence decisions, and the related tests) no longer applies.

## Problem Statement

A player who pays for ChatGPT (Plus / Pro) already has a Codex image quota, but PipiCOC cannot spend it. Image generation for portraits, illustrations and the `image_gen` / `image_edit` tools runs on grok-build or on a separately keyed vendor. A player without grok-build and without an image API key gets "no image model configured" even though their ChatGPT login could generate images.

What the research established (sources: OpenAI Codex CLI at `claw-code-main/codex` HEAD 28327355b; Pi pi-ai 1.0.0):

- **Login already exists.** Pi ships a built-in provider `openai-codex` that does the same ChatGPT OAuth as Codex CLI: the same client id, the same PKCE browser flow on `localhost:1455`, a device-code fallback, and refresh 5 minutes before expiry. PipiCOC's provider login panel already lists every Pi OAuth provider. pi-backend reserves `openai-codex` as an official provider id, so an extension may not claim it. **No new login extension is needed or allowed.**
- **Pi has no Codex image generation.** Its Codex model catalog has no image models, and it never sends or parses image calls.
- **How Codex CLI generates images.**
  - Since 2026-07 (Codex commit a7c72aee8) it no longer uses the hosted Responses `image_generation` tool.
  - It makes a separate, synchronous JSON request with model `gpt-image-2`:
    - `POST https://chatgpt.com/backend-api/codex/images/generations` to generate;
    - `POST https://chatgpt.com/backend-api/codex/images/edits` to edit, with `images: [{image_url: <data URL>}]` (at most 5).
  - It sends these headers:
    - `Authorization: Bearer <access token>`
    - `ChatGPT-Account-ID: <chatgpt_account_id JWT claim>`
    - `originator`
    - a per-call `x-codex-image-turn-id`
  - The response is `data[0].b64_json`.
  - Codex hides the feature from Free-plan accounts.
- **Live probe (2026-10-03, the owner's account, script `experiments/codex-image-probe/probe.mjs`).**
  - The request used Pi's stored `openai-codex` credential with `originator: pi` and returned **HTTP 200 in 21 s**: a 2 MB PNG.
  - `quality: "auto"` came back as `low` at `1370x1148`, which is landscape. So auto is the wrong choice for a 3:4 portrait, and quality has to be sent explicitly to get anything but low.
  - Quota headers: `x-codex-active-limit: imagegen_premium`, plus a daily primary window (`x-codex-primary-window-minutes: 1440`). The limit id is not the `image_gen` that Codex's own test fixtures use, so limit ids must not be hard-coded.

## Solution

The image-gen extension gains a **Codex route** that spends the player's ChatGPT subscription through Pi's existing `openai-codex` login:

- **Automatic mode (no model chosen).** If the player is signed in to OpenAI Codex on a paid plan, images go to Codex first. Otherwise they go to grok-build if it is signed in. Otherwise the existing "no image model configured" refusal applies.
- **Explicit choice still wins.** The settings picker gains a "Codex (gpt-image-2)" row whenever Codex is signed in. Choosing it, or any other model, pins that route.
- **Quality setting.** The Image Generation settings section gains a quality option (low / medium / high), defaulting to **medium**. It applies to every generation on the Codex route and on the OpenAI `gpt-image` route except one: the investigator portrait (证件照) is always generated at **low**, whatever the setting says.
- **No silent fallback.** A failure on the route actually taken surfaces as it is. That includes quota exhaustion, which reports when the quota resets.

## User Stories

1. As a player with a ChatGPT Plus/Pro subscription, I want PipiCOC to generate my investigator portrait on my Codex quota, so that I do not need a grok-build login or an image API key.
2. As a player, I want to sign in to Codex from the provider login panel I already use, so that there is one place where accounts are connected.
3. As a player signed in to both Codex and grok-build, I want Codex to be the automatic image route, so that my paid ChatGPT quota is used first.
4. As a player signed in only to grok-build, I want images to keep going to grok-build exactly as today, so that nothing changes for me.
5. As a player signed in to neither, I want the same "choose an image model" refusal and settings hint as today, so that I know what to do.
6. As a player on the ChatGPT Free plan, I want the automatic route to skip Codex, so that I am not sent to an endpoint my plan does not include.
7. As a player on the Free plan who explicitly picks the Codex row, I want a clear error saying my plan does not include Codex image generation, so that I understand why nothing was drawn.
8. As a player, I want the image settings to show which route Automatic will use right now (Codex, grok-build or none), so that I can predict where my quota goes.
9. As a player, I want a "Codex (gpt-image-2)" row in the image model picker whenever I am signed in to Codex, so that I can pin Codex even after choosing another model earlier.
10. As a player who pinned the Codex row and later signed out of Codex, I want a clear "sign in to OpenAI Codex" error rather than a silent switch to another paid lane, so that I keep control over spending.
11. As a player, I want a quality option with low, medium and high in the image settings, so that I can trade generation time and quota for detail.
12. As a player who never touched the quality option, I want medium to be used, so that illustrations look better than the server's low default without my having to configure anything.
13. As a player, I want my investigator portrait always generated at low quality, so that the small sepia ID photo is fast and cheap whatever my quality setting is.
14. As a player, I want scene illustrations to use the quality I chose, so that my preference applies where detail matters.
15. As a player, I want the Keeper's `image_gen` and `image_edit` tool calls to use the quality I chose, so that every generation outside the portrait follows my setting.
16. As a player, I want a portrait-ratio (3:4) request to come back as a portrait image from Codex, so that the portrait frame and illustrations are not cropped from a landscape picture.
17. As a player, I want illustrations of my protagonist to keep using my portrait as a reference image on the Codex route, so that the figure still looks like my investigator (§35.4).
18. As a player, I want image editing through `image_edit` to work on the Codex route with up to five reference images, so that remixing behaves the same as on other vendors.
19. As a player whose Codex image quota is used up, I want an error that says the quota is exhausted and when it resets, so that I can wait or pick another model on purpose.
20. As a player whose Codex image quota is used up, I want PipiCOC **not** to silently switch to grok-build or another vendor, so that I am never billed on a lane I did not choose.
21. As a player, I want my quality setting to survive clearing or changing the image model, so that the two settings do not reset each other.
22. As a player, I want `/image-gen:status` to report the Codex state (signed in, plan, active or idle), so that terminal users see the same picture as the settings panel.
23. As a player, I want `/image-gen:model openai-codex/gpt-image-2` to work like picking the Codex row, so that the slash command and the picker agree.
24. As a Keeper agent, I want the `image_gen` tool description to mention Codex as a possible backend, so that its description matches what actually happens.
25. As an operator, I want the Codex access token never written to logs, tool results or error text, so that credentials do not leak into transcripts.
26. As an operator, I want the extension to take the Codex token only through Pi's model registry, never by reading auth.json, so that Pi keeps sole ownership of refresh and locking.
27. As an operator, I want a Codex HTTP failure to report status and response text with the token redacted, so that problems are diagnosable from the session log.
28. As a maintainer, I want the request shape (endpoint, headers, body fields) covered by tests at the extension's existing seam, so that a refactor cannot silently change what we send.
29. As a maintainer, I want the dispatch priority (explicit, then Codex, then grok, then refusal) covered by tests, so that the order cannot regress unnoticed.
30. As a maintainer, I want the portrait's fixed low quality covered by a test through the sheet's existing generator seam, so that the ruling cannot be lost when the dispatch changes.

## Implementation Decisions

**No new login, no provider registration.**
- The Codex route consumes Pi's built-in `openai-codex` provider.
- The access token comes from the session's model registry (`getApiKeyForProvider("openai-codex")`). Pi refreshes it under its own lock before returning it.
- The extension never reads or writes auth.json, and never refreshes on its own. A refresh rotates the refresh token, which other auth.json copies share.

**Codex usability.** Codex counts as usable for the automatic route when all of these hold:
- a session context with a model registry exists;
- the registry returns a non-empty `openai-codex` token;
- the token's `https://api.openai.com/auth` claim carries a `chatgpt_account_id`;
- its `chatgpt_plan_type` is not `free`.

Everything fails closed. The JWT payload is decoded without signature verification, as Codex CLI does; it is used only for routing, never trusted for authorization.

**Dispatch order.** The shared dispatch behind the tools, the portrait mount and illustrations becomes:
1. an explicit choice (the tool's `model` parameter, else the configured model);
2. Codex, if usable;
3. grok-build, if usable;
4. otherwise the existing `image_model_unconfigured` error.

The existing rule stays: a failure on the route taken surfaces as it is, with no fall-through in either direction. This amends the dispatch wording referenced by §22.7 and §35.4 ("grok-build the default") to "Codex, then grok-build, the default".

**Routing becomes provider-aware.**
- The vendor router takes the provider as well as the model id.
- Provider `openai-codex` routes to the new `codex` adapter; every other provider keeps the existing closed model-id map, where `gpt-image` still means the OpenAI Images API.
- The provider list is a closed contract enum, not a semantic classifier.
- The configured-model ref for Codex is `openai-codex/gpt-image-2`. A bare `gpt-image-2` without a provider keeps today's registry lookup and therefore does not reach Codex.

**Codex adapter contract.**
- Base URL `https://chatgpt.com/backend-api`, HTTPS only.
- Generate: `POST {base}/codex/images/generations`. Edit: `POST {base}/codex/images/edits`.
- Headers:
  - `Authorization: Bearer <token>`
  - `ChatGPT-Account-ID: <chatgpt_account_id>`
  - `originator: pi`, which matches Pi's own Codex chat traffic and was accepted in the probe
  - a Pi-style `User-Agent`
  - `x-codex-image-turn-id` with a fresh UUID per call
  - `Content-Type: application/json`
- Body:
  - `{ prompt, model: "gpt-image-2", background: "auto", quality, size }`
  - Edits add `images: [{ image_url: <data URL> }]`, at most 5, and are JSON rather than multipart.
  - No `n` and no `response_format`.
- Result: decode `data[0].b64_json` and sniff the mime type. A missing `data` is an error.
- The model id `gpt-image-2` is one constant in the adapter. The picker row and the configured ref use it too.

**Size mapping.**
- The adapter maps the request's aspect ratio to `1024x1536` (portrait ratios), `1536x1024` (landscape ratios) or `1024x1024` (square), using the same closed ratio sets as the OpenAI adapter.
- `size: "auto"` is sent only when the caller's aspect ratio is `auto` or absent.
- The probe showed that auto produced a landscape image for an unconstrained prompt.

**Quality.**
- Allowed values: `low | medium | high`; default `medium`.
- The dispatch operation gains an optional `quality`. Precedence: the operation's own `quality`, then the configured quality, then `medium`.
- The portrait mount always passes `quality: "low"`. Illustrations and the two tools pass nothing, so they follow the player's setting.
- The tools do **not** gain a `quality` parameter; the Keeper does not choose quality.
- The OpenAI Images adapter sends the same `quality` for `gpt-image` models, on both generations and multipart edits. DALL·E models never receive it, because their vocabulary differs.
- The remaining adapters (xAI, Ark, Gemini, DashScope) and grok-build accept `quality` and ignore it.

**Settings persistence.**
- Quality lives next to the model in the agent home's `image-model.json` as `{ "model"?: string, "quality"?: "low"|"medium"|"high" }`.
- Every write preserves the other field.
- `clear` removes only `model`. The file is deleted only when neither field remains.
- An absent or invalid `quality` reads as `medium`.
- Both writers must follow this rule: the agent-side config module and pi-backend's app-level `image-gen` invoke branch.

**Host invoke surface (app-level, no session).**
- The `image-gen` / `model` branch's answer gains:
  - `quality` (the effective value);
  - `codexSignedIn` (auth.json has an `openai-codex` oauth entry; the host already reads auth.json for `grokDefault`, so there is precedent);
  - `autoRoute: "codex" | "grok-build" | "none"`.
- A new op `quality` sets the quality and rejects values outside the enum.
- The host-side `autoRoute` cannot see the plan type without decoding the token. It may decode the stored access token's claims for the plan check, never logging them, so that a Free-plan login reports `grok-build` or `none`.

**Settings section.**
- The image model picker shows the Automatic row, with a subtitle naming the current `autoRoute`.
- It shows a synthesized "Codex (gpt-image-2)" row with ref `openai-codex/gpt-image-2` whenever `codexSignedIn` is true. Pi's Codex catalog has no image model, so the row cannot come from the visibility catalog.
- Then come the existing catalog rows.
- A quality control (three options, default medium) has a caption saying the portrait is always low and that the setting applies to Codex and OpenAI GPT Image. New words are English-authored, like the section's existing words.

**Errors (stable codes, English messages, token redacted).**

| Code | When | Message / payload |
|---|---|---|
| `codex_not_signed_in` | explicit Codex choice but no token | names Pi's login for `openai-codex` |
| `codex_plan_excluded` | explicit Codex choice on the Free plan | — |
| `codex_account_missing` | no `chatgpt_account_id` claim | — |
| `image_quota_exhausted` | HTTP 429 with `error.type: usage_limit_reached` | carries `resets_at` when present; the `x-codex-active-limit` value is reported verbatim, not matched against a list |
| (none) | any other HTTP failure | the existing "image request failed HTTP <status>: <text>" shape |

- The portrait mount keeps its two refusal codes. `image_quota_exhausted` and the Codex codes map to `portrait_unavailable`. They do not map to `portrait_no_model`, because a model *is* configured or automatic.

**Status and descriptions.**
- `/image-gen:status` reports the Codex state alongside grok-build and the configured model.
- The `image_gen` / `image_edit` descriptions name Codex among the backends.
- The README's dispatch section is rewritten to the new order. Its stale "Shadowing by design" paragraph is corrected in passing: Pi refuses duplicate tool names, and the launcher sets `PI_GROK_BUILD_IMAGE_TOOLS=0`.

## Testing Decisions

A good test drives the public seam and asserts what leaves the process: the URL, headers and body handed to the injected `fetch`, the bytes and route returned, and the error code thrown. It never asserts internal helper calls. Every behavior below needs a test that a plausible mutation would make fail: drop the header, swap the priority, ignore the low override. A worker's "all green" is not coverage.

**Seam 1: the image-gen extension factory** (`createImageGenExtension` with injected `fetchImpl`, `grok`, config IO and a fake `ctx.modelRegistry`). This is the existing seam in `tests/extension/image-gen.test.mjs`, and most behavior is tested here:
- **Codex adapter request shape:**
  - generate and edit URLs;
  - all required headers;
  - the token appears only in `Authorization`;
  - the body fields, with no `n` or `response_format`;
  - edit images as JSON data URLs, at most 5;
  - aspect ratio to size.
- **Result parsing:** b64 to bytes, and the missing-data error.
- **Dispatch priority:**
  - explicit choice beats Codex;
  - Codex beats grok when both are usable;
  - grok when Codex is unusable;
  - refusal when neither;
  - Free plan skips Codex automatically but errors when chosen explicitly;
  - no fall-through after a Codex failure, including a 429.
- **Quality precedence:** operation, then configured, then medium.
- **OpenAI adapter quality:** `gpt-image` generations and edits carry `quality`, and `dall-e` requests never do.
- **429 mapping:** `image_quota_exhausted` with `resets_at`, plus a limit id other than `image_gen`, such as the observed `imagegen_premium`.
- **Config:** preserving the model when quality is set, and clearing the model while keeping quality.
- **Commands:** `/image-gen:model openai-codex/gpt-image-2` and `/image-gen:status`.

**Seam 2: the sheet's portrait generator dependency** (`tests/extension/sheet-portrait.test.mjs`, which already injects `generatePortrait`). Assert that the portrait request carries `quality: "low"`. Also assert at seam 1 that the shared dispatch honours an operation-level `low` over a configured `high`.

**Seam 3: pi-backend's app-level `image-gen` invoke branch** (prior art `Electron/packages/pi-backend/test/image-gen-model.test.ts`):
- `get` reports `quality`, `codexSignedIn` and `autoRoute` from fixture auth.json files: Codex paid, Codex free, grok only, none;
- the `quality` op validates the enum;
- `set` / `clear` preserve the other field.

The pi-backend vitest baseline is already red in places. Judge regressions by test name, not by the total.

**Live acceptance, run by the owner** (the agent may not read credentials):
1. Extend the probe script to send an explicit size (`1024x1536`) and each quality value. Confirm `gpt-image-2` on the Codex endpoint accepts them before the adapter is finalised; if a value is refused, record it in the contract.
2. On the packaged App, signed in to Codex with no model chosen:
   - generate a portrait and check from the generation's response metadata that it went to Codex at low;
   - generate an illustration and check that it used medium;
   - switch quality to high and check that the next illustration follows.

Heavy suites run on the LAN test box (`test:ext`; the pi-backend vitest file), per Agents.md.

## Out of Scope

- Using Codex **chat** models as the Keeper. Pi's built-in `openai-codex` provider already does this; there is nothing to build.
- A PipiCOC-owned Codex OAuth flow or credential store. Pi owns it, and `openai-codex` is a reserved provider id.
- Applying the quality setting to vendors other than Codex and OpenAI `gpt-image` (Gemini, Ark, DashScope, xAI, grok-build, DALL·E). Their quality vocabularies differ.
- Automatic fallback to another lane on Codex quota exhaustion or failure. This is deliberately excluded by the existing no-silent-fall-through rule.
- A Codex quota meter for images. The existing account-usage monitor already reads `wham/usage` for Codex; surfacing the `imagegen` limit there is a separate change.
- Showing the usage headers (`x-codex-*`) in the UI beyond the quota-exhausted error.
- Streaming or partial images. The Codex endpoint is a single JSON response.
- Choosing the Codex image model. `gpt-image-2` is fixed, as in Codex CLI.

## Further Notes

**Risk: the endpoint is unofficial.**
- It works for third-party clients today: the probe used `originator: pi`.
- But it is not a published API, and OpenAI can change the model name, the accepted sizes or the client checks.
- The constants (base URL, model id, originator) live in one place, and a non-200 surfaces verbatim so a break is visible at once.

**Proposed slicing (Opus workers, contract first per Agents.md):**
- **CX-01:** the contract § plus the Codex adapter, provider-aware routing and the dispatch order, at seam 1.
- **CX-02:** quality end to end: config persistence, the dispatch operation field, the portrait low override, and the host invoke surface and settings control (seams 1–3).
- **CX-03:** status, descriptions, the README, and owner-run live acceptance.

CX-02 depends on CX-01's dispatch signature.

The probe script stays under `experiments/codex-image-probe/` as the reference for live checks; its `out/` images are not committed.

## Comments
