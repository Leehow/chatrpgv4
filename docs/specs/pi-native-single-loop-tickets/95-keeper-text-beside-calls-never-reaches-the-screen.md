Status: ready-for-human (filed 2026-09-26 from SL-94's finding, measured on long gate #22; batch 17; P1 — Keeper-only text and module spoilers reach the player's screen; re-ruled 2026-09-26 by the owner: available, not pushed; implemented on claude/sl95-fold-20260926)
Stage: SL-95 (UI: where the assistant keeps secrets, a message's text is folded in a working card until that message ends; host telemetry only)
Spec: docs/kernel-rpc.md §135.11.6 (this ticket), §93 (the Keeper's working is available, not read to the player), §22's process-observability correction of 2026-09-15 (stands), §135.11.1 (text beside tool calls is dropped), §135.11.4/SL-93, §135.11.5/SL-94 (first-prose telemetry, path (c)); `Electron/packages/ui/src/transcript-model.ts` (`applyStreamEvent`, the text activities and their `segment`), `Electron/packages/ui/src/AssistantTranscriptContent.tsx`, `Electron/packages/ui/src/assistant-secrets.tsx`, `Electron/packages/pi-backend/src/turn-telemetry.ts` (`settleText`), `extensions/kernel/index.ts:5495–5505` (the strip), `extensions/onboarding/index.ts:827–831` (the setup strip)

# SL-95: the Keeper's text beside its tool calls never reaches the screen

## Evidence
- SL-94 established the path, with file:line in its ticket comments:
  1. Pi emits each `message_update` as it streams, and the host forwards every `text_delta` to the renderer at once.
  2. The UI draws it.
  3. The extension strips text beside tool calls only in its `message_end` hook.
  4. The host then sends `replace:true` with empty text, and the UI deletes it.

  So the player reads the text for the whole rest of the message's generation.
- Long gate #22 (`longgate22-haunting-1448`): **11 assistant messages carried text beside tool calls across the opening and 20 turns. That text was on screen for a median of 5.5 s, max 14.6 s.** What the player saw:
  - Keeper bookkeeping, e.g. "受理委托与抵达已由书记结算。正在补登钥匙、称呼…" and "源文仍在读取；按已有线索…".
  - Module spoilers: "需对照木板封墙与浮刀威胁的原书细节再结算" names the floating-knife threat before the player met it.
- The same window exists for any draft the host later drops or replaces at `message_end`: the SL-80/SL-93 floor steer, a speech-only draft, a draft the narrate audit refuses.

## Ruling

**Owner decision, 2026-09-26.** SL-95 is not a host hold. The first implementation (a bound session's text forwarded
only at `message_end`, branch `claude/sl95-20260926`) overrode §22's 2026-09-15 correction and is not merged; it stays
as the record. The owner chose §93's pattern instead: available, not pushed.

1. The host keeps streaming assistant text live exactly as today. There is no pi-backend hold, and nothing is
   suppressed: the 09-15 correction stands.
2. In a session whose assistant keeps secrets (§93's structural boolean, `AssistantKeepsSecrets` /
   `assistantKeepsSecretsFor`, never the content), the UI draws an assistant message's text **while that message is
   still streaming** inside a folded "working" card.
   - The body is collapsed by default and one click opens it, the treatment §93 gives the Thinking body.
   - It is not drawn as story prose.
   - The card's label shows the Keeper is working, like the Thinking card's label and spinner.
3. When the message ends:
   - text the message keeps is drawn as ordinary prose;
   - text the host removed (`replace:true` with empty) disappears with its card, as today;
   - kept text replaced by different text is drawn as the replacement;
   - after a history reload nothing changes from today.
4. Sessions that don't keep secrets (the base console) are unchanged: text opens and streams as prose.
5. SL-94 telemetry: in a bound COC session, text counts as first prose when it becomes prose, at its `message_end`
   settle, not at its first delta, because until then it sits folded. Sessions without a binding keep SL-94's
   first-delta rule. This is the only pi-backend change.
6. Setup mode keeps secrets too (same product): the fold applies there, and the onboarding hook's removal still makes the
   card disappear.
7. The card's label is a UI-words key with an English source, registered so a static scan finds it (the key written in
   the call). Never hand-translated (§23).

## Scope
- Contract: `#### 135.11.6` in `docs/kernel-rpc.md`, directly after §135.11.5. It applies §93 to assistant text and does
  not amend §22. §135.11.4 and §135.11.5 untouched; section numbers are stable ids.
- Code: `Electron/packages/ui` (the fold, the words, the replacement's row) and `Electron/packages/pi-backend` telemetry
  only. No extension change; the host's stream is unchanged.
- Words: `transcript.keeper_working` in `content/ui/en/transcript.json`; the `zh-Hans` seed's word from the presenter lane.
- Tests (mutation-killable), vitest in `Electron/packages/ui`:
  - beside-text in a secrets session: a folded card while streaming, never prose, gone after an empty `replace`;
  - kept implicit prose: folded while streaming, prose at message end;
  - a base-console session: unchanged;
  - default collapsed, one click opens;
  - history reload unchanged.
  - Existing `coc-keeper-process.test.tsx`, the §93 tests, `App.stream.test.tsx` and every test around `transcript-model`
    text handling stay green by name against the base.
  - Plus the pi-backend telemetry tests for point 5.
- Suites: single files only, `--maxWorkers=2`, on the Mac. The UI tsc baseline is red, so tsc is judged by file names;
  vitest is the gate.

## Acceptance
- Unit tests above.
- Long gate #23's events: text beside tool calls still occurs in the model's output (it is the model's habit), but the
  packaged App never draws it as prose: while it streams it sits in a closed working card, and it leaves with the card.
  The integrator checks one App turn that had beside-text.

## Comments

- 2026-09-26, first implementation, **not merged** (owner decision the same day): a host hold on
  `claude/sl95-20260926` (`c67819910` contract, `02a8b8c83` code, `9abdeb7ae` ticket). It forwarded a bound session's
  text only at `message_end` and so overrode §22's 2026-09-15 correction. Kept as the record; nothing from it is merged.
- 2026-09-26, implementation of the re-ruling (claude/sl95-fold-20260926, from b558f3048): contract `0efbb1b54`
  (§135.11.6), UI `e89f51565`, telemetry `6d7b42046`.
  - **"Still streaming" vs "ended"** (`unsettledTextIds`, `ui/src/transcript-model.ts:202`). A text activity is the
    Keeper's working unless its row stopped streaming, the host's `replace` for its `segment` marked it `final`, or a
    later `segment` began in the row. A `message_end` that changed nothing sends nothing, so such text becomes prose at
    the next message or the settle; closing that gap would need a host end marker, which ruling 1 rules out.
  - **The replacement's row.** An implicit narrate's card is appended inside the same `message_end` hook, so a
    `replace` used to land on the card and leave the draft (say tokens and all) in the live row until the history reload.
    It now lands on the streaming row that holds its segment; the plain copy then folds into the card live (§16.6).
  - **Setup: the fold applies.** `assistantKeepsSecretsFor` answers for the product; the onboarding hook's strip
    (`extensions/onboarding/index.ts:827-831`) reaches the UI as an empty `replace`, and the card goes with the text.
  - **UI word.** `transcript.keeper_working` = "The Keeper is working…" (`content/ui/en/transcript.json`); zh-Hans
    "守秘人正在工作…" from the presenter lane on the fast-model setting (opencode-go/deepseek-v4.1-flash, off), transcript
    surface projected whole, only the gap harvested (`loading` came back as shipped). Provided from the `timeline.graph`
    answer's `ui` block via `TranscriptWords`; `ui-words-surfaces.test.mjs` scans the renderer for the surface's keys.
    A first lane run over all 549 captions ended after 85 s with no output (cause not established).
    **Side effect:** the lane child's grok-build provider extension refreshed the App's grok-build OAuth token through
    the symlinked `auth.json` (written 12:29:26; the App was not running). Other copies of that refresh token may now be
    stale.
  - **Thinking (reported, unchanged).** Rendered: forwarded live (`pi-backend/src/index.ts:6656-6671`), backfilled at
    `message_end` (`:6789-6811`), kept in history, drawn as a Thinking card whose body starts closed in PipiCOC
    (`ui/src/AssistantTranscriptContent.tsx:247`, §93) and opens with one click. It can carry Keeper-only content.
  - **SL-94 tests adjusted.** `turn-telemetry-first-prose.test.ts` "counts assistant text the host keeps at message_end
    from its first delta" now runs unbound, renamed "... a session without a COC binding keeps ..." (its premise was
    live prose in a bound session). Added: "counts a bound COC session's kept text at its message_end, when it leaves the
    folded card" and, in `turn-telemetry.test.ts`, "counts a folded text at its settle, not its first delta, and an
    earlier prose still wins". The replace test is unchanged and still green on a bound session.
  - **Mutations** (restored by `cp` from saved copies; byte-compared after the loop):

    | id | mutation | red |
    | --- | --- | --- |
    | U1 | never fold | 7 (every secrets case, App PipiCOC case) |
    | U2 | fold without the secrets flag | 2 (both console cases) |
    | U3 | a non-streaming row can still be unsettled | 4 (settle, history, model, App) |
    | U4 | `final` ignored | 3 |
    | U5 | a later segment does not end a text | 2 |
    | U6 | `replace` routed to the last row, as before | 1 (the card case) |
    | U7 | `replace` does not mark `final` | 4 |
    | U8 | the card opens by itself | 4 |
    | U9 | a literal label instead of the word | 3 |
    | U10 | App provides no words | 1 (App PipiCOC case) |
    | U11 | the key kept in a variable | 1 (`ui-words-surfaces` scan) |
    | P1 | telemetry ignores the binding (always first delta) | 1 (bound seam case) |
    | P2 | always settle | 1 (unbound seam case) |
    | P3 | `settleText` ignores `from` | 2 (bound seam case, unit case) |

  - **Suites** (Mac, single files, `--maxWorkers=2`). UI (`../../node_modules/.bin/vitest run <files>` from
    `Electron/packages/ui`): App.browser-watch, App.busy-after-settle, App.stream, App, App.waiting, App.working-stop,
    App.illustration, the six AssistantTranscriptContent.*, LiveSubagentBinding, StreamEventCoalescer, ToolCardTruncate,
    a-notice-keeps-its-own-voice, coc-delivery-not-clipped, coc-markers, coc-mechanics-fold, coc-object-details,
    coc-speech, coc-keeper-process, keeper-thinking-is-available-not-pushed, tool-renderer-dispatch, transcript-boundary,
    transcript-live-fix, transcript-model.stream-cow, transcript-model, Transcript, ui-registries: base 538/538, after
    538/538 by name plus the new file (12). pi-backend: the 16 stream/`message_end` files: base 186 with 13 failing (all
    pack-host, missing `Electron/packs/*`), after 188 with the same 13 by name. UI tsc: errors only in files this change
    does not touch or lines it does not touch (`App.tsx:510`, `Transcript.tsx:389`, test files); pi-backend tsc clean.
    `node --test`: ui-words, ui-words-surfaces, ui-presentation, ui-presentation-context, extension-words,
    system-language, contract-section-numbers, all green.
  - Not done: the packaged-App acceptance on long gate #23 (integrator); `manifest.json` untouched.
