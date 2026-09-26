Status: ready (filed 2026-09-26 from SL-94's finding, measured on long gate #22; batch 17; P1 — Keeper-only text and module spoilers reach the player's screen)
Stage: SL-95 (host: a COC session's assistant text is forwarded only once the host has decided it stays)
Spec: docs/kernel-rpc.md §135.11.1 (text beside tool calls is dropped), §135.11.4/SL-93 (the floor drops short drafts), §135.11.5/SL-94 (first-prose telemetry, path (c)); `Electron/packages/pi-backend/src/index.ts` (the `text_delta` forward ~6624–6633 at b8079e9c1, the `message_end` diff/`replace:true` ~6739–6753, `cocSessionBindings`), `Electron/packages/pi-backend/src/first-prose.ts`, `Electron/packages/ui/src/transcript-model.ts:692–731`, `extensions/kernel/index.ts:5405` (the extension hooks `message_end` only) and `:5495–5505` (the strip)

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
1. In a COC session (known from the session's COC binding, never from the text), the host does not forward assistant `text_delta` to the renderer as it streams.
   - It forwards the message's text once, at `message_end`, as the text the final message keeps after the extension's hook (the existing diff already emits the whole text when nothing was streamed).
   - Text the host drops is never drawn. Text the host keeps appears whole at the message end.
2. Sessions without a COC binding (ordinary chat) are unchanged and stream live.
3. The cost is stated and accepted: implicit (plain-text) prose no longer streams character by character. It appears at its message end, which is also when the host decides whether it stays. Tool-carried prose (`narrate`, `apply.narrate`) is unaffected.
4. SL-94's telemetry follows automatically. Held text is first streamed at `message_end`, so `firstProseMs` for the text path becomes that moment. Keep SL-94's tests green, adjusting only the ones whose premise was live COC streaming, and say which.
5. Report, do not change: whether a COC session renders the model's **thinking** to the player, where (file:line), and whether that thinking can carry Keeper-only content. Thinking visibility is an owner decision, not this ticket's.

## Scope
- Code: `Electron/packages/pi-backend` only. No extension change, no UI change.
- Contract: `#### 135.11.6` in `docs/kernel-rpc.md`, directly after §135.11.5.
  - SL-93 is adding text under §135.11.4 in parallel, so do not touch §135.11.4 or §135.11.5 beyond appending after §135.11.5's last line.
  - Section numbers are stable ids; never renumber.
- Tests (vitest, mutation-killable):
  - A COC session: text then a tool call → the renderer never receives that text, and no `replace` is needed to erase it.
  - A COC session: a text-only message → the renderer receives the kept text once, at `message_end`.
  - A COC session where the extension rewrote the text at `message_end` → the renderer receives only the rewritten text.
  - A non-COC session → live deltas as before.
  - SL-94: the held text's `firstProseMs` is the `message_end` forward.
  - The thinking stream is untouched by this change.
- Suites: the pi-backend test files touched plus every existing file exercising the text stream, run on the Mac as single files. The pi-backend vitest baseline is red (~160), so compare by test name.

## Acceptance
- Unit tests above.
- Long gate #23's events: text beside tool calls still occurs in the model's output (it is the model's habit), but the packaged App shows none of it. The integrator checks one App turn that had beside-text: the transcript never drew it.

## Comments
