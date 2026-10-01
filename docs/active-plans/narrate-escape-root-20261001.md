# Escaped Keeper prose: root-cause probes (pre-registration, 2026-10-01)

Written before any live probe. Scope (lead, 2026-10-01): root cause only — why the model emits escaped or
serialized arguments, why it clusters, and whether anything on our side raises it. No decoders (another branch,
`claude/serialized-args-20261001`, owns §160.1/§160.2).

## What is already established from the logs (no model calls)

- O1. The escapes are in the provider's bytes. Every case's `toolcall_delta` (driver `events.jsonl`) already
  carries them, e.g. mood-live t10 `"narrate":"\"\\u4f60\\u653e…`. Nothing of ours writes them.
- O2. Survey of 23,823 retained Keeper calls (918 playtest event logs, 49 App sessions): 12 escaped calls.
  10 are grok-build/grok-4.7-build-fast, 2 grok-4.5 (C/D). Per prose-bearing call:
  grok-4.7-build-fast 10/148; grok-4.5 2/1031; xai grok-4.6 0/4445; deepseek-v4.1-flash 0/533.
- O3. Within grok-4.7-build-fast, by field: `apply.narrate` 7/28, `narrate.text` 3/120.
- O4. By time: grok-4.7-build-fast was not used 09-26..09-29. Before 09-26: 1/110 (all `narrate.text`;
  `apply.narrate` did not exist, it arrived with SL-92 on 09-26). Since 09-30: 9/38
  (`apply.narrate` 7/28, `narrate.text` 2/10).

## Hypotheses and pre-registered predictions

Probes replay real requests (reconstructed from the mood-live-20261001 event log, with tools captured from this
worktree's own registration) against grok-build/grok-4.7-build-fast, thinking low, K replays per arm. An arm's
"escape" is any top-level string argument of a Keeper call that carries a JSON escape as text or is a
serialized form (A, A', B, C, D, \u run). Volume cap: about 60 calls in all.

- **H1 model.** The model double-serializes stochastically and the request does not matter at our level.
  Predicts: replays of the requests that escaped and of comparable requests that did not escape escape at
  similar rates; none of the variants below moves the rate beyond noise.
- **H-field (ours).** `apply.narrate` is a string field named after another tool and described as carrying
  "the narrate tool's text"; the model fills it with a serialized form of that tool's argument (grok-4.5:
  key label, `{"text": …}`, `text":"…`; grok-4.7-build-fast: a JSON string literal). Predicts: on the same
  request, renaming the field and describing its content directly (plain prose, no reference to another
  tool's argument) cuts the apply escape rate by at least half (pre-registered threshold: from >= 4/8 to
  <= 1/8 when the baseline arm is that hot).
- **H3 self-imitation (ours: what we feed back).** Escaped prose already in the request (capsule `recent`,
  `coc-history` quotes) makes the next call imitate it. Predicts: mood-live t3 (its capsule carries t1's
  escaped text) escapes more than t10 (no escaped text in its request), and removing the escaped text from
  t3's request lowers its rate.
- **H4 change since 09-25 (ours).** Explained by the field (H-field) if the field accounts for the jump;
  `narrate.text` moved 1/110 -> 2/10, which the field cannot explain and the probes below test only weakly.
- **H5 request shape.** Long values or CJK alone trigger it. Predicts: escape rate rises with prose length;
  the field variant does not matter.

Decision rule: an arm difference counts only when it meets the threshold above; otherwise it is reported as
noise, with counts.

## Results (2026-10-01, 54 model calls, all grok-build/grok-4.7-build-fast low)

Method. A request is rebuilt from the `mood-live-20261001` driver log: the logged system prompt, the context brief
(from the turn-1 capsule, as the context hook caches it), historical quotations (the last two `recent` turns from the
campaign transcript), the player message, the turn's capsule view, and this turn's working messages before the call;
the tool catalog is captured from this worktree by a `before_provider_request` hook that aborts before the call goes
out (no model call), with the npc-mood branch's `mood` field patched into `apply`. Missing: the run's issued-bodies
packet and any mid-turn capsule update (transport-only, never logged). Replays are posted with a plain HTTPS client
(no Pi, no extension) and the raw `function_call` argument bytes are classified. Counts are prose arguments.

| request | arm | prose arguments | escaped |
| --- | --- | --- | --- |
| t10 | as recorded | apply.narrate 5, narrate 1 | 3 (A_u, A, A_u), all apply.narrate |
| t10 | field renamed `prose`, direct description | apply.prose 2, narrate 2 | 1 (apply.prose, `\u` run without quotes) |
| t10 | apply.narrate removed | narrate 4 | 0 |
| t10 | one format sentence on apply.narrate | apply.narrate 7 | 0 (4–8 real line breaks each) |
| t10 | §162 as implemented (tools from the built extension) | apply.narrate 5, narrate 1 | 0 |
| t1 | as recorded | apply.narrate 3 | 1 (A') |
| t1 | §162 as implemented | apply.narrate 5 | 0 |
| t3 | as recorded | none (4 responses, apply only) | — |

Recorded 4/8 against 0/17 with the sentence (one-sided Fisher p = 0.006).

Verdicts against the predictions above:

- H1 model: **holds for the mechanism, not for "the request does not matter".** The escapes come back from a plain
  client, so the model writes them; but the same request moves from 3/5 to 0/7 with one sentence in a field
  description, and in the survey prose inside or beside a write escapes 9/33 against 1/112 alone.
- H-field: **partly.** The rename alone did not stop it (1/2); removing the field did (0/4, small n), but the survey
  has the `narrate` beside an `apply` at 2/8 too. What the field description says about the string's form is what
  moved the rate.
- H3 self-imitation: **not supported.** t3, whose capsule carries t1's escaped text, did not put prose in its call in
  four replays; t10, with no escaped text anywhere in its request, escaped 3/5; 7 of 10 survey cases are the first in
  their run.
- H4 change since 09-25: **holds.** SL-88 and SL-92 (2026-09-26) moved this model's prose from a `narrate` alone (107
  of 110 before) to inside or beside an `apply` (33 of 38 since 09-30); the npc-mood branch's mood line pushes more
  into `apply.narrate`.
- H5 length/CJK: **no evidence as a trigger.** Decoded, the escaped values carry 173–325 characters of prose and the clean ones 150–453, on the same requests;
  CJK decides the shape (`\u` runs are an ASCII-escaped encoding of CJK), not the occurrence.
