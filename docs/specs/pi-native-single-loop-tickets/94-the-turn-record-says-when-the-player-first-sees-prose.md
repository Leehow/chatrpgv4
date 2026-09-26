Status: ready-for-human (filed 2026-09-26, owner's ruling on the latency target; batch 17; implemented 2026-09-26 on claude/sl94-20260926)
Stage: SL-94 (host telemetry: the moment the turn's prose reaches the screen)
Spec: docs/kernel-rpc.md §135.11.5 (new, this ticket); `Electron/packages/pi-backend/src/turn-telemetry.ts` (phases, `buildRecord`, the record allowlist), `Electron/packages/pi-backend/src/index.ts` (the `entry_appended` → `presentation` seam ~6324–6343, `startDeliveryPresentation`, the host-delivered custom-message branch ~6344–6360 and `projectHostDeliveries`, the `message_end` text diff/`replace:true` ~6739–6753), `Electron/packages/pi-backend/src/coc-view.ts` (`mechanicsEntry` ~469–508), `pipicoc/mechanics.js` (the reading surface), `Electron/packages/pi-backend/test/turn-telemetry*.test.ts`

# SL-94: the turn record states when the player first sees the turn's prose

## Why
Owner, 2026-09-26: the latency target is 60 s from the player's input to **the first character of the prose the player finally sees**. It is not the whole text finishing.

The App cannot measure this today:
- `ttftMs` (turn-telemetry.ts ~620) is the first provider stream event. That is thinking or a tool call, not prose.
- `first_text` is the first `text_delta`. A PipiCOC turn's story travels in a `narrate` or `apply.narrate` tool argument, so no `text_delta` carries it.
- The story reaches the screen only when the extension's `coc-mechanics` entry lands. It becomes a `presentation` stream event rendered by `pipicoc/mechanics.js`, in one piece, after the kernel call. Tool args are not rendered progressively (the "narrate" tool card only spins), and grok-build sends them in one delta anyway.
- Implicit (plain-text) delivery streams live, but the host can replace it at `message_end` (`replace:true`).

Long gates measure the metric from the driver's `events.jsonl`: #22 median 29.7 s, max 53.0, 20/20 ≤ 60. Real play in the App has no number.

## Ruling
1. `turn-telemetry.ts` gains:
   - A phase `first_prose`.
   - `durations.firstProseMs`: `host_received` → the first moment in this turn the backend streams to the renderer prose that stays on screen.
   - `firstProseVia: "mechanics" | "host" | "text"`, next to it in the allowlisted record.

   No prose in the turn: the fields are absent, never 0. Only the first counts; later prose never moves it.
2. **The mark is taken at the backend's stream seam** (the `this.stream(...)` that forwards to the renderer), not from raw pi events in `observeRpc`. The host decides what is forwarded: `mechanicsEntry` can return nothing, presentations are deduplicated, and host deliveries are projected asynchronously.
3. What counts as prose:
   - (a) A `coc-mechanics` presentation whose delivery prose is non-empty. A mechanics-only card with no prose (a roll or clue card from a non-delivery tool) does not count. Decide by the entry's structure, not its text.
   - (b) A host-delivered prose message: the host's fallback, or `placed_by_host` (#22 turn 18 was delivered this way, with no `coc-mechanics` entry). Service notices (§55) do not count. Tell them apart structurally (entry type, details flag); no string matching.
   - (c) Assistant text, only if a PipiCOC session actually renders assistant text. Establish this with file:line evidence first; if it does not render, (c) is excluded and the contract says so.
     - If it renders, text the host keeps at `message_end` counts from its first delta.
     - Text replaced by non-empty text counts at the replace emission.
     - Text replaced by nothing never counts.
4. No change to what the player sees and no change to rendering. This ticket only measures.
5. Report, do not fix: whether a PipiCOC session shows the Keeper's text beside tool calls before the host drops it (`text_beside_tool_calls`). Example: #22 turn 1 had "受理委托与抵达已由书记结算。正在补登钥匙…" beside its calls. If it is shown, that is a player-visible leak for a separate ticket; say so with file:line.

## Scope
- Contract: §135.11.5, the ruling above plus the evidence.
- Code: `Electron/packages/pi-backend` only (turn-telemetry.ts, index.ts seam, record allowlist and sanitizer). No extension or UI change.
- Tests (vitest, `test/turn-telemetry*.test.ts` pattern, mutation-killable; each rule's removal turns one red):
  - Narrate delivered via a tool: `firstProseMs` at the presentation, `firstProseVia:"mechanics"`, `ttftMs` unchanged.
  - A no-prose mechanics card before the narrate: does not set it; the narrate does.
  - Host-delivered prose sets it (`"host"`); a service notice does not.
  - (c) cases if (c) applies: kept text, text replaced by prose, text replaced by nothing.
  - Only the first prose counts.
  - A turn with no prose: fields absent.
  - The record stays inside its 4 KB bound and allowlist.
- Suites: the two telemetry test files plus any existing test that exercises the stream seam you touch, run on the Mac as single files. The pi-backend vitest baseline is red (~160 failures), so compare by test name, never by count.

## Acceptance
- Unit tests above.
- In the packaged App, one real turn's `turns.jsonl` record carries `firstProseMs` and `firstProseVia`. Its value sits within 1 s of the moment the story card appears. The integrator checks this after packaging.

## Comments

- 2026-09-26, implementation (claude/sl94-20260926, from b8079e9c1): contract `14c2f75d6` (§135.11.5), code and tests
  `792332621`. `first_prose`, `durations.firstProseMs`, top-level `firstProseVia`; absent when there is no prose.
  - **(c) applies.** A PipiCOC session renders assistant text: the host streams every `text_delta` and diffs at
    `message_end` (`index.ts:6624-6633`, `:6739-6753` at b8079e9c1), the renderer draws it
    (`transcript-model.ts:692-731`, `AssistantTranscriptContent.tsx:210-211`, `Transcript.tsx:353`), and the only fold is
    `foldMarkedDeliveries` (`transcript-model.ts:231-243`) for a copy a `marked_text` card already draws.
  - **Text beside tool calls is shown, then dropped (reported, not fixed).** Streamed live
    (`agent-session.js:363-366`, `index.ts:6624-6633`), stripped only at the extension's `message_end` hook
    (`extensions/kernel/index.ts:5495-5505`), removed by `replace: true` with an empty delta (`index.ts:6741-6742`,
    `transcript-model.ts:692-700`). A player-visible leak for a separate ticket.
  - **Host prose vs notice** is by the details' keys: a `coc-delivery` row with any key besides `coc_delivery` and
    `turn` is a notice. Same answer as the driver's `NOTICE_DETAIL_KEYS` on every current row.
  - **Hold.** Without it the settle's flush beat the host delivery's projection in the live seam test (mutation M9a
    turned it red), so the §8 fallback would have gone unrecorded. The record waits for the projection (2 s bound);
    a placement projected after the next dispatch stays with the turn that placed it.
  - Tests: `test/turn-telemetry.test.ts` (15 -> 22), new `test/turn-telemetry-first-prose.test.ts` (9); 21 mutations,
    all killed. Seam regression files compared by name against b8079e9c1: no new failures (the same 10 `coc-view.test.ts`
    failures on both). Not done: the packaged-App acceptance (integrator, after packaging); `manifest.json` untouched.
