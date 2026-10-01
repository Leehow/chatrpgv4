# NPC speech edit lane

Status: ready-for-agent

Contract: `docs/kernel-rpc.md` §165. Evidence: `.coc/playtests/speech-replay-20260930/` in the main checkout (gitignored).

## Goal

NPC lines should read like people talking. After a narrate delivery, a post-delivery lane rewrites only the wording of the
NPC spoken lines (connectives, discourse markers, modal particles; no fact changes), and the player's card is patched in
place when the edit arrives (about 15 s on grok-4.7 low). The Keeper's record and every kernel reader keep the original.

## Rulings (owner, 2026-10-01)

- Use lane v2 (the owner's 16 rewrite pairs as demonstrations plus the connective/particle inventory by function); the
  corpus-retrieval variant v3 was not better and costs more.
- Stay on the table's model; show the Keeper's lines first and replace them when the edit arrives.
- Zero-tool completion although post-delivery (Agents.md exception, second after §155.9).

## Decisions made from the code (2026-10-01, lead)

- The edit is display plus an audit overlay; `text`, `rendered_text`, `marked_text`, `speech` and the transcript row are
  never rewritten (memory anchors, quote locators and delivery digests compare against them).
- The lane's words live in a Mod (`contributes.speech_edit_lane`, `zh-optimize` 1.1.0 for `zh`), not in the base.
- Jev fact gate per changed line, fail closed when Jev is unavailable.
- Prompt = v2 as the owner judged it (full turn prose and all 16 pairs). The speed test showed trimming them saves input
  tokens but no time (grok-build bills no tokens), so nothing is trimmed.
- `ask` deliveries are a known boundary for the first version (no stored `marked_text`), with their own test.

## Tickets

1. Kernel: `speech.edit` lane RPC and the `speech_edit` overlay (§165.5.1), RPC table and ownership lists.
2. Extension host: the lane (trigger, input, model, zero-tool run, gates incl. Jev, kernel call, card patch, telemetry).
3. Electron UI: the fold also matches `speech_original.marked_text` (§165.5.3), live and history.
4. Mod: `zh-optimize` 1.1.0 with `speech-edit-lane.md` (v2 instruction + 16 owner pairs), manifest, digests, mods list.
5. Tests per §165.8.

## Comments

- 2026-10-01 (implementation, `claude/speech-edit-lane-20261001`): tickets 1-5 are in code and tests; the decisions the
  contract left open are written in `docs/kernel-rpc.md` §165.9. The two that go beyond §165's text: the host gets its
  input from a second read-only lane RPC, `speech.job` (the kernel owns the Mod catalog, as `voice.job` already hands
  the voice lane its owner's words), and `contributes.speech_edit_lane` requires the capability `speech.edit.lane.v1`
  (the §153.1 pairing, so an older build marks the package incompatible instead of refusing it). The live check on a
  table is still owed: it needs a new zh campaign (a campaign locked to zh-optimize 1.0.1 keeps it until
  `mods.configure` moves it) and a Jev key, since without one the lane drops every edit.
