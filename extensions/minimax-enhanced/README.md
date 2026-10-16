# MiniMax Enhanced

An independent PipiCOC extension over Pi's existing `minimax-cn` and `minimax`
accounts. No new login, credential file or model catalog is created. The extension
must be enabled in a managed desktop session; source CLI sessions enable it by
default. Disabling it removes the contributed stream/capability on the next session.

## Text and search

The native Anthropic transport preserves unsigned thinking with
`allowEmptySignature: true`. Effort, token limits, native tool arithmetic and
selected model remain unchanged. Thinking is not converted to ordinary text.
Custom non-Anthropic model definitions retain their own API transport.

Historical Reference can use MiniMax's hosted `web_search_20250305` only through
the existing campaign/run/step permission. Search results, interleaved thinking,
citations and server tool pairs use the existing private native-search journal.
On an exact visible text/tool match, the original blocks are replayed in their
original order. Changed or compacted material never receives guessed old blocks.
This is currently the Anthropic Messages route, not a new Responses model.
The initial search model identities are MiniMax-M3 and MiniMax-M3.1-Flash-Preview;
older models are not automatically opted into the beta server-search feature.
The separate Anthropic Active Cache extension continues to own cache placement.

## Images

Select the model from this extension's settings in an active chat, or run:

```text
/minimax:image-model minimax-cn/image-01
/minimax:image-model minimax-cn/image-01-live
```

The existing `/image-gen:model` command accepts the same specs. Use `minimax/`
instead for the international account. Existing image-model selection wins;
installation does not change it or automatic Codex/Grok defaults. `image_gen`,
`image_edit`, portraits and illustrations share the new MiniMax adapter. Each
call requests one base64 image without rewriting the prompt. Image-to-image is
MiniMax's character subject-reference regeneration, not arbitrary masked editing.
Ordinary reference confinement and session image storage remain in image-gen.

## Video

Use the MiniMax settings section in an active chat, or submit once:

```text
/minimax:video {"provider":"minimax-cn","prompt":"A lantern sways on a rain-soaked station platform.","model":"MiniMax-H3","duration":5,"resolution":"768P","aspect_ratio":"16:9"}
/minimax:video-status {"provider":"minimax-cn","task_id":"TASK_ID"}
```

With no explicit account, commands use the current MiniMax provider, otherwise
`minimax-cn`. They never fall through to another account on failure. H3 accepts
4–15 seconds and 768P/2K; H3-Max accepts 5–15 seconds and 480P/768P. The first
version supports text, a first frame, and optional paired last frame. Frame
inputs are HTTPS URLs or image data URLs; local paths are not uploaded implicitly.
Image-conditioned requests use the API's adaptive ratio. Reference video/audio,
Context-IR, regeneration, remote deletion and cancellation are outside this version.

Submission returns a task ID immediately after acceptance. A private
`minimax-media` session receipt records task/account/model metadata without prompt
or credentials; recent IDs reappear in the settings section after reopening the
chat. If local journaling fails, the response still returns the submitted ID with
`receipt: "unavailable"`; save that ID before leaving. Query returns queued,
running, succeeded, failed or cancelled and, on success, an HTTPS video URL.
There is no polling timer, generation retry or automatic video download. A
transport failure can leave an unknown submitted task; do not resubmit blindly.
Actual service entitlement and billing belong to the configured account.

The stable host entry exports `createMiniMaxHostLibrary(context, options)` with
`status`, `generateImage`, `editImage`, `createVideo` and `queryVideo`. It receives
the caller's Pi model registry; media credentials never leave the library. The
App uses the existing `pipiui.ext-invoke.registry`, not returned command values.
No media tool is added to the fixed Keeper verb set or kernel state authority.

## Validation

`node --test tests/extension/minimax-enhanced.test.mjs` uses synthetic credentials
and network-free responses through the actual Pi Anthropic adapter. Native
search, image-gen, profile installation and launch tests cover shared paths.
These checks do not establish live API entitlement, generated quality or GUI
acceptance. App packaging is separate.

Official references: [M3 tool continuations](https://platform.minimax.cn/docs/guides/text-m3-function-call),
[server search](https://platform.minimax.cn/docs/guides/server-tools),
[images](https://platform.minimax.cn/docs/guides/image-generation),
[video creation](https://platform.minimax.cn/docs/api-reference/video-generation-v2-create)
and [video query](https://platform.minimax.cn/docs/api-reference/video-generation-v2-query).
