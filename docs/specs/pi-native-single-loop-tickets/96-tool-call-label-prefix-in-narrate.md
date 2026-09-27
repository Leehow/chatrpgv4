Status: ready-for-human (filed 2026-09-26 from long gate #23; batch 18; P1; implemented 2026-09-26 on claude/sl96-20260926, fix 83782e08f, see Comments)
Stage: SL-96 (host argument boundary: the provider's `text <label>` artifact at the head of a narrate string)
Spec: docs/kernel-rpc.md §144 (a Keeper tool argument that carries the model's own tool-call markup is unwrapped at the host boundary, `prepareArguments`), §135.5.2 (`apply.narrate`), §135.11.4.1 (the floor, apply.narrate only); `extensions/kernel/index.ts` (`prepareArguments`), `extensions/grok-build-oauth/` (how the provider's function-call arguments reach Pi)

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

  It looks like the model's own serialization leaking the field's type/label into the value, the same class as §144.

## Scope (investigate first, then fix at the boundary)
1. **Find every occurrence in retained evidence before writing a rule.** Search all `events.jsonl` / `turn-N.json` under `/Users/haoli/leehow/code/chatrpgv4-wt-*/.coc/playtests/` and the App's session files, read-only. Tabulate:
   - which tool/field;
   - which provider/model;
   - the prefix variants;
   - what follows: CJK or Latin, empty or not.

   Establish whether the artifact is in the raw function-call arguments the provider returned, i.e. the model's output, or introduced by our provider extension's parsing. Show the raw bytes.
2. **Fix at the argument boundary** (`prepareArguments`, §144's place), structurally:
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

**2026-09-26, implementation (worker, branch `claude/sl96-20260926`, base 187a7b780).** One commit, `83782e08f`
fix(arguments): contract §144.1 (new addendum after §144, plus a one-clause note in §135.11.4.1's tests), code, tests.
Files: `docs/kernel-rpc.md`, `extensions/kernel/dialect-prefix.ts` (new: `EMBEDDED_ARGUMENTS`, `dialectPrefix`,
`stripDialectPrefixes`), `extensions/kernel/index.ts` (`prepareArguments`), `tests/extension/dialect-prefix.test.mjs`
and `tests/extension/fixtures/dialect-prefix-gates-22-23.json` (new), `tests/extension/delivery-floor-every-path.test.mjs`.

**Evidence (Scope 1), read-only, 2026-09-26T18:32Z.** 689 playtest `events.jsonl` under every
`chatrpgv4-wt-*/.coc/playtests/`, their `turn-N.json`, the App's 44 Pi session files, and 5,170 delivered kernel turn
records (177 the App's): 23,926 tool calls, 16,869 top-level string arguments. Seven occurrences, all
`apply.narrate`, all grok-build/grok-4.5 low, 7 of that model's 32 `apply.narrate` (0 of its 62 `narrate.text`;
0 of the other 5,263 `narrate.text`, 103 `ask.text`, 3 deepseek `apply.narrate`; none in the App):

| run, turn | prefix | follows | delivered |
| --- | --- | --- | --- |
| gate #22 t1 | `text thriftily-placeholder` | nothing | yes, whole turn |
| gate #22 t5 | the name in the play language + `\|` | `{{move:…}}` + zh prose | yes, with the label |
| gate #22 t8 | `text` | nothing | yes, whole turn |
| gate #22 t12 | `text` | zh prose, no separator | yes, glued |
| gate #22 t20 | the name in the play language + `::` | `{{time}}` + zh prose | yes, with the label |
| gate #23 t6 | `text intermediate` | zh prose, no separator | yes, glued |
| gate #23 t8 | `text interim` | zh prose, no separator | no (an effect was refused; the resent explicit narrate had no label) |

The ticket counted three; the scan found the two play-language variants and t12/#23 t8 as well.

**Root cause: the model (through xAI), not our parser.** `grok-build-oauth` registers `api: "openai-responses"` and
has no stream code; Pi's streamer appends `response.function_call_arguments.delta` verbatim and emits it as the
`toolcall_delta` the event log keeps. Gate #23 t6's single delta at the field:
`"narrate":"text intermediate\xe7\xbd\x97\xe5\x85\x8b…`; gate #22 t8: `"narrate":"text"}`; t1:
`"narrate":"text thriftily-placeholder"}`. The model writes the name of the parameter it is filling (`apply.narrate`
is the narrate tool's `text`, §135.5.2) into the value; where `text` is the key itself it never does (gate #23 t8's
same prose, resent as `narrate.text`, came without it).

**Rule** (details and safety argument in §144.1): only fields that carry another tool's argument
(`apply.narrate` -> `narrate.text`), position 0 only; (a) the declared name exactly (case-sensitive), optional
`[A-Za-z][A-Za-z0-9_-]*` tag after one space, meeting end / `|` / `::` / a `{{` token or non-ASCII character with no
separator; (b) any Unicode letter run followed at once by `|` or `::`. A label-only value becomes `""` and is refused
by the floor (`chars: 0`) or, once the steer is spent, by the kernel's non-empty check. Applied to every one of the
16,869 top-level string arguments (every tool, not only the embedded field) it matches exactly the seven rows.
Known boundary, tested: a label followed by whitespace (`text intermediate The door…`, `text\n…`) is left alone.
Telemetry: `{lane: "arguments", event: "dialect_prefix_stripped", tool, field, prefix}` as the ticket names it (note:
§144's own row is `lane: "tool_arguments"`; kept the ticket's lane).

**Tests** (single files on the Mac, all exit 0): `dialect-prefix` 11/11, `delivery-floor-every-path` 11/11,
`tool-argument-markup` 6/6, `apply-narrate-combined` 4/4, `single-loop-turn-close` 15/15, `jev-s0-read-dispatch` 7/7,
`skills` 20/20, `system-language` 5/5, `contract-section-numbers` 3/3. Two SL-93 fixtures changed on purpose:
`narrate: "text"` now counts `chars: 0`; the lowered-floor case uses `门开了。` instead of the label.
Mutations (restored by `cp`): unstripped args handed on (with and without the row), row dropped, case-insensitive
(a), (a) without its end/delimiter/glue condition, (a) without the glue case, tag not taken, (b) removed, whitespace
kept — each turns at least one test red. Not run: `test:ext`/pytest (box-only), `build:runtime` (the installed App
needs a rebuild from the integration line to carry this). Acceptance stays with long gate #24.
