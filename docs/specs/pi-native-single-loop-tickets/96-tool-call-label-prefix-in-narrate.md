Status: ready (filed 2026-09-26 from long gate #23; batch 18; P1 — Keeper-side dialect text reached the player)
Stage: SL-96 (host argument boundary: the provider's `text <label>` artifact at the head of a narrate string)
Spec: docs/kernel-rpc.md §138 (a Keeper tool argument that carries the model's own tool-call markup is unwrapped at the host boundary, `prepareArguments`), §135.5.2 (`apply.narrate`), §135.11.4.1 (the floor, apply.narrate only); `extensions/kernel/index.ts` (`prepareArguments`), `extensions/grok-build-oauth/` (how the provider's function-call arguments reach Pi)

# SL-96: a narrate string that starts with the provider's `text <label>` artifact

## Evidence
- Long gate #23 (`longgate23-haunting-1350`, 13ce6a7dd, grok-4.5 low), turn 6:
  - `apply.narrate` was `"text intermediate罗克斯伯里疗养院的门厅闻着石炭酸…"`.
  - It was delivered with the prefix: the player read "text intermediate" glued to the story.
  - The floor (§135.11.4.1) cannot catch it, because the rest is 400 characters of real prose.
- Long gate #22: turn 1's whole `apply.narrate` was `"text thriftily-placeholder"`; turn 8's was `"text"`. SL-93's floor now catches those, but only by length.
- One recurring shape, so far only on grok-build and only in `apply.narrate`:
  - the literal `text`;
  - optionally a Latin label (`intermediate`, `thriftily-placeholder`);
  - then the real value, or nothing.

  It looks like the model's own serialization leaking the field's type/label into the value, the same class as §138.

## Scope (investigate first, then fix at the boundary)
1. **Find every occurrence in retained evidence before writing a rule.** Search all `events.jsonl` / `turn-N.json` under `/Users/haoli/leehow/code/chatrpgv4-wt-*/.coc/playtests/` and the App's session files, read-only. Tabulate:
   - which tool/field;
   - which provider/model;
   - the prefix variants;
   - what follows: CJK or Latin, empty or not.

   Establish whether the artifact is in the raw function-call arguments the provider returned, i.e. the model's output, or introduced by our provider extension's parsing. Show the raw bytes.
2. **Fix at the argument boundary** (`prepareArguments`, §138's place), structurally:
   - strip the artifact where it is provably the dialect, not prose;
   - a value that is only the artifact becomes empty, so the existing refusal and floor paths handle it.

   The rule must not remove a legitimate English narration that begins with the word "Text". Decide the distinguishing structure from the evidence table (for example, the label token touching the value with no separator, or the exact label vocabulary the evidence shows), and state it in the contract. If the evidence shows the leak is on our side (parser), fix the parser instead.
3. **Telemetry:** a row `{lane:"arguments", event:"dialect_prefix_stripped", tool, field, prefix}`.

## Tests
Mutation-killable:
- the #23 t6 string delivers without the prefix;
- `"text"` and `"text thriftily-placeholder"` become empty and are refused as before;
- an English narration `"Text scrawled on the wall reads…"` is untouched;
- a zh narration that legitimately contains the word "text" mid-sentence is untouched.

## Acceptance
Long gate #24: count `dialect_prefix_stripped` rows. No delivered prose starts with the artifact.

## Comments
