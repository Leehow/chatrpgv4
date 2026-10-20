# Dialogue continuity and native transport, 2026-10-19

This work traces the retained doctor's-address answer, photo-clerk pronoun drift
and extra Keeper inference on receipt confirmation. Acceptance is PARTIAL: the
latest author still repeats an unrelated historical line. The repair changes
material roles and a deterministic argument decoder. It adds no judging model,
review round or prose reminder. The sole author still receives its complete
input once and streams native text deltas. This is focused real-driver acceptance,
not a chapter playthrough, App package or browser-paint acceptance.

## Causes and accepted changes

The original run is `.coc/playtests/kp-render-final-ad1f-20261019`, canonical
turns 87–90. The doctor-related question is addressed to the cafe waitress,
not a new encounter with the doctor himself. The Keeper selected `fact_25`,
`fact_27`, `fact_29`, `fact_28`: old address wording, lack of a personal visit,
laboratory records and pickup-truck hearsay. All four reached the author as
mandatory current response claims. Repetition therefore began before prose:
already-public transcripts had been misclassified as new assertions to deliver.

Verified selected own public speech now travels through existing participant-scoped
`recent_public`, using current public names. Current typed claims/new reports
remain response content. When the selected material contains only prior speech,
one `existing_account_response` proposition preserves the selected reply to the
current question, with `new_information:false` and prior turn references. This
permits a bounded answer without requiring every old sentence to be repeated
or claiming a new verification. Duplicate exact historical lines merge. There
is no extra lookup, model request, parameter refusal or inferred player intent.

The earlier successful 9b6e doctor case is a useful controlled seam observation: the Keeper
again selected address `fact_25` and laboratory `fact_29`, but the author received
one current-account proposition and optional history. It answered the address
question without laboratory/pickup-truck digressions. Thus the evidence is not
merely that the Keeper happened to choose fewer references.

The returning photo clerk's old author card had only a public role, neutral
personality and spoken words. First-sight was already marked shown; persistent
appearance and surrounding public portrayal were absent. Turn 89 used "she";
turn 90 selected older quoted material containing "he" and switched. The existing
NPC read now retains explicit source appearance, without biography/summary
fallback, and may supply the latest stationary same-scene single-speaker public
portrayal. Canonical verified speech spans are removed from that excerpt: spoken
facts are not duplicated into an unconditional characterization channel.
Movement, mixed/unresolved speakers, failed/reference/future/other-scene/other-
branch records and unverifiable span alignment cannot supply portrayal. No
name/gender classifier, regular-expression semantic rule or new identity write
is used. The excerpt is historical evidence, not current physical state.

The tested additional native confirm act is removed in 1f1fd2aa1. Live e92a
selected confirm for address and laboratory rows and again forced both old claims
into the answer. That run was stopped after two inputs. The original interaction
API is restored. The catalog now unifies verified own public speech across
recent-speech/report/commitment fields by explicit attribution and unambiguous
cast identity; no semantic classifier infers speech ownership. Ambiguous labels,
other speakers and private/authored knowledge retain their original authority.
This addresses the material's role once rather than adding a second wrapper.

The retained extra receipt inference was not missing receipt data or another
adjudication. Its first Keeper request took 5.336 seconds and produced thinking
plus a complete prose draft, no native output call. `workspace/wire-8.json`
retains that original assistant response in the following request. The filtered
session's thinking-only representation was misleading. Bounded protocol recovery
cost a further 2.640 seconds before the one author call (3.661 seconds); the
whole player intent took 17.126 seconds. Discarded prose is never executed or
used to bypass the sole author. MiniMax's endpoint-specific contract supports
automatic tool selection, not guaranteed forced calls:
https://platform.minimax.io/docs/api-reference/text-chat-anthropic . The SDK
overview is insufficient proof of every strategy; Claude likewise distinguishes
automatic from required tool calls:
https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview . The
existing single bounded recovery remains necessary for actual noncompliance.

A later real greeting exposed a different avoidable correction: three category
leaves arrived as `{label:"",$text:"label>..."}`. The existing decoder now recovers
only a closed single-string-field object with exactly the declared empty field
and `$text`, the exact field-name prefix and a suffix passing the full leaf
schema. Values are retained literally. Conflicts, other keys, wrong prefixes,
missing fields, ambiguous schemas and bounds failures remain refusals. Separate
`textRepairs` telemetry avoids miscounting these as array repairs. The captured
first packet now passes the normal native packet validator with three text
repairs and unchanged commands, rather than requiring another Keeper request.
This identifies the observed transport shape; it does not claim access to the
provider's internal serializer. Ajv's reversible schema-driven coercion and
jsonrepair's syntax-only approach support the narrow boundary, not broad data
inference: https://ajv.js.org/coercion.html and
https://github.com/josdejong/jsonrepair . No dependency is added.

## Failed candidates are retained

- `kp-dialogue-confirm-14ba-20261019`: four real intents, 56.412 seconds,
  4 Keeper + 4 author requests. Clerk continuity/receipt confirmation improved,
  but the doctor's-address answer still selected old words through `answer`.
- `kp-dialogue-final-3409-20261019`: forcing explicit `confirm`/`recap` did not
  solve repetition. The Keeper selected recap and an unissued free-text topic,
  retried, then repeated old material. This constraint was reverted by
  `18a19b1ab` and `11059f1d3`. It is not retained as a performance optimization.
  Movement was separately held with selection 0.59 against the unchanged 0.6
  threshold, scope 0.78; no operation landed. I then incorrectly sent the pickup
  question while still at the cafe. That fourth input is invalid-for-intent and
  invalid-for-acceptance; it is not a completed pickup-confirmation comparison.
- `kp-dialogue-history-00d0-20261019`: after two real inputs, removing all old
  claims without retaining a current reply proposition caused silence despite
  selected `answer`. That candidate is not accepted. The final account-response
  proposition closes this handoff. No raw records were edited or deleted.

Intermediate 14ba and 3409 broad runs were stopped because their source was
superseded, with interrupted evidence retained. They are not passing final
regressions. Shared-box contention is separate from player-intent latency.

## Whole player-intent measurements

All runs use the same quiescent retained seed through private CoW workspaces,
with explicit MiniMax M3.1 Flash Preview / medium for Keeper, author and supporting
lanes. One main-session player sends one natural input per actual reply. No
synthetic Keeper or scripted player generates these records. Runtime request
and author telemetry verify actual attribution. Each row measures one completed
player input, including readiness, protocol correction, host settlement and
authoring. Counts below are foreground Keeper/author requests; background work
is not silently included, and the experimental HTTP observer cannot establish
an overall Jev HTTP total.

| Intent | Original ad1f seconds; KP/author | 9b6e A seconds; KP/author | 9b6e B seconds; KP/author |
| --- | --- | --- | --- |
| Enter cafe and greet | 14.075; 1/1 | 25.304; 2/1 | 17.612; 1/1 |
| Confirm doctor's address | 12.323; 1/1 | 17.767; 1/1 | 18.592; 1/1 |
| Return and greet clerk | 14.061; 1/1 | 16.313; 1/1 | 14.660; 1/1 |
| Confirm pickup | 17.126; 2/1 | 14.285; 1/1 | 14.692; 1/1 |
| Total | 57.585; 5/4 | 73.669; 5/4 | 65.556; 4/4 |

Both 9b6e groups completed all four intents with actual settlement. No foreground
retrieval calls occurred. The doctor's-address answers no longer repeat the
unrelated laboratory/truck material; the clerk's returning portrayal uses the
same public identity, including "he" in the second group's return; pickup did
not require another player confirmation or another Keeper inference. All world
objects are byte-equivalent in value to the seed, including film/receipt custody.
The first group ends at minute 495 after two 30-minute journeys; the second at
496, including a separately selected one-minute conversation. No cash/item
settlement occurs in these inputs. These observations do not mean every sentence
is perfect: the second doctor answer is conservative and has an unclosed
quotation mark. It is retained unchanged, not post-judged or rewritten.

Overall speed is not improved by these samples. Group A's greeting needed one
format correction; group B removed that round but remained slower than the old
sample. In A the doctor Keeper took 6.357 seconds versus 3.239 originally; author
5.931 versus 3.795. The new author input was 2484 tokens with 196 output tokens;
its visible delta span was only 0.738 seconds, so most of its task duration was
before the first text increment. This does not identify the provider's internal
queue/prefill/reasoning split. Do not attribute all elapsed differences to the
local material patch: source evolved concurrently and samples are temporally
separated. This is descriptive evidence, not a controlled causal speed claim.

A's primary native system/tool hashes remain identical across all five requests,
but cache reads range from 0/128 to 49920 tokens. That rules out changed
system/tool bytes within this run; it does not prove equality of the entire
cache prefix or a provider KV guarantee. No cache-control or model setting is
changed by this repair. The final transport repair specifically removes the
captured malformed-leaf retry; it does not promise zero possible provider errors.

## Intermediate transport build and verification

Source snapshot `e92ab7601` adds the literal-leaf decoder to the tested 9b6e
material repair. The live candidate uses a bounded local incremental build of
affected entrypoints with two compiler threads and existing dependencies; no
vendor/native/dependency build or Internet payload is run. The record is
`dialogue-transport-incremental.json`. Complete runtime build and the required
focused suite remain assigned to the LAN box, queued behind other work. Do not
call incremental compilation a full package or App acceptance.

Targeted checks pass 134, mandatory foundation/control-flow and context/disclosure
checks pass 50, and kernel type checking passes. Groups overlap with earlier
iterations and are not additive unique coverage. New tests exercise the actual
NPC read and author task, selected-history role, retained current reply and
actual malformed native arguments. The author instruction is unchanged by this
work. Direct text transport remains `text_delta`; 9b6e runs recorded 5–18
player-delivery chunks per author and nonzero incremental spans. That establishes
transport, not browser painting.

Final unified-source live results and LAN suite outcome are recorded below when complete.
Evidence root:
`.coc/experiments/npc-action-contract-20261018/browser-seams/prose-contract-20261019/`.
Raw runs remain under `.coc/playtests/`. Existing seeds, raw failures, native
requests, author tasks, model attribution and prior App evidence are preserved.

## Unified source 1f1fd2aa1: live failure retained

Run kp-dialogue-unified-1f1f-20261019 submitted four sequential player inputs.
The first three published; pickup confirmation did not. Exact raw driver times:

| Intent | Seconds | KP requests in driver window | Author requests | Result |
| --- | ---: | ---: | ---: | --- |
| Enter cafe | 16.344 | 1 | 1 | Scene/arrival/greeting published |
| Doctor address | 21.715 | 1 | 1 | Answer published; unrelated laboratory line repeated |
| Return to clerk | 49.202 | 3 | 1 | Move committed once; return greeting; no pronoun switch |
| Pickup confirmation | 1203.053 | 4 | 0 | No decision/tool; interrupted by sleeping host |

The doctor task actually contains one existing_account_response claim and the
old words only in recent_public. The author nevertheless copies the old address
paragraph and laboratory caveat. This falsifies any claim that correcting the
material role guarantees relevant dialogue. The deterministic history/portrayal
seams are covered; repeated old words remain a final-author relevance failure.
No keyword deletion, post-judge, prompt reminder or full-prose regeneration was
added to conceal it. Two earlier 9b6e successes cannot outweigh this failure.

The long final input is not a usable provider/KP speed sample. Retained macOS
power events (dialogue-unified-sleep.log) show Clamshell Sleep at 21:37:26 -0400,
then maintenance sleeps of 50, 206, 954 seconds and further sleep/wakes. That
also overlaps the return-to-clerk retries. Raw events show Connection error,
terminated, a first-byte cap error and subsequent request timeout. The raw
wall times remain unchanged; do not subtract sleep heuristically.

The driver's fourth input stops waiting at 01:58:14.747Z, but its daemon keeps
automatically retrying. Request observations after the input start contain SIX
Keeper attempts before explicit stop, not the four within the driver result.
This is a measurement boundary gap: a driver timeout is not agent termination.
The daemon is now stopped. No fourth-input native output, author invocation or
new settlement was observed. A later continuation, if successful, is recorded
separately and cannot turn the original timeout into a clean fast intention.

Latest local source checks: 172/172 pass, kernel typecheck passes. Full focused
LAN validation for exact source 1f1fd2aa1 is assigned to amax after leehow-pc
became unavailable; outcome is recorded below. This is not App packaging or
browser paint acceptance.

## Continuation of the interrupted pickup input

kp-dialogue-pickup-resume-1f1f-20261019 uses a new private CoW view of the stopped
unified run's workspace, preserving the actual return and all failed attempts.
It is not a new unrelated fixture or a rewritten earlier result. MiniMax/medium
Keeper and author are verified again. The same pickup question publishes in
22.115 seconds with TWO Keeper output calls and one author. No additional
confirmation is asked of the player, but the protocol retry remains a failure:

1. The first packet selects old fact_11 and fact_13, then redundantly proposes
   service_at with raw string items meaning negative and print. Those strings
   are not issued entity references. Decision material binding refuses it before
   any transaction, returning invalid_params/decision_material_binding.
2. The second packet drops that redundant proposed service, selects only the
   existing facts, and publishes. The clerk confirms keeping the negative and
   prints together with no additional charge. No time/cash/item effect lands.

Root boundary: the static native tool declares those reference leaves as open
strings; the exact current issued enum exists only in output_parameter_schema
at the request tail and the runtime resolver. This was an intentional cache-
prefix compromise, and the live result proves it does not eliminate this class
of invalid native arguments. Native tool schema, dynamic capability schema and
runtime authority are different layers. Do not weaken authority or convert an
unknown name into a reference/category by semantic guess.

No new workaround is landed here: binding the complete dynamic schema into the
native output declaration would address the advertised vocabulary mismatch but
changes the prior stable-tool cache contract. It requires a measured correctness
versus prefix-reuse decision; provider auto tool selection still cannot guarantee
zero malformed calls. MiniMax documents tool schemas and auto-only selection
(https://platform.minimax.io/docs/api-reference/text-chat-anthropic); Anthropic
documents the tools/system/messages cache-prefix dependency
(https://platform.claude.com/docs/en/build-with-claude/prompt-caching). Anthropic's
cache rules are an analogue, not proof of MiniMax internal KV placement.

Final acceptance remains PARTIAL, not three bugs fully fixed: historical role
and portrayal plumbing are repaired, but the final writer still repeated an
unrelated old caveat and pickup still needed parameter repair. There is no
credible overall latency improvement claim. All raw failures remain retained.

State proof after continuation: world.objects values have SHA-256
8d2cce41dd66837ea7c9794771f3e7e8a220f71a8c0be2389a7176228d005513 in the
original seed, unified result and pickup continuation. Clock is 435 in the seed
and 495 in both results, exactly the two thirty-minute trips. No pickup charge,
film transfer or additional travel settles during the resumed conversation.
The resumed author delivered four native text deltas spanning 0.344 seconds; its
task took 3.894 seconds. KP requests took 9.478 and 2.899 seconds. This proves
stream transport and exposes the remaining protocol retry; it does not establish
visible App painting. Both live daemons were explicitly stopped after evidence
collection, and failed inputs were not deleted or rewritten.

## Final regression and retained worktrees

Exact source 1f1fd2aa1a6a29f4782325bb5b00b939fd92831a completed the canonical
focused runner on amax. Full runtime build succeeded. Overall exit is 1, not a
clean green run. Retained original evidence:
/home/lihao/chatrpgv4-testbox/wt/codex-tests/.pytest-runs/kp-blood-road-20261018/run.aQAKVgJr/

- Extension: 495 files; 4402 tests, 4392 pass, 9 skipped, 1 cancelled on timeout.
  The file is memory-native-recovery.test.mjs, first test, 15097.9 ms against
  its existing 15000 ms cap. No assertion mismatch was reported.
- Native integration: exit 0, 2238 tests, 2237 pass, 1 skipped.
- Routing loop: exit 0, 12/12 pass.

The timed-out case was isolated without changing code, assertion or timeout. On
the Mac with explicit Node 24 it passed in 6.229 seconds; on the original amax
after the heavy suite it passed in 11.542 seconds (process total 12.842 seconds).
This is consistent with load-sensitive timing, not proof that the original red
run passed. The first local rerun mistakenly inherited Node 22 and failed its
fs-ext ABI load (127 versus existing 137); its log is retained separately.
No native module was rebuilt or dependency changed to disguise that environment
error. The corrected rerun explicitly uses Node 24.

Local targeted group: 172/172 pass; exact validation-source kernel typecheck
passes (dialogue-unified-typecheck.log). The final direct author and original
committed state remain distinct from these deterministic tests.

Both current-task worktrees are terminal and retained_verification_failed:
- /Users/haoli/.codex/worktrees/kp-blood-road-20261018
  (codex/kp-blood-road-validation-20261018): keep the exact tested source and
  dependency links while live quality is unresolved.
- /Users/haoli/.codex/worktrees/kp-material-baseline-20261019
  (codex/kp-material-baseline-20261019): retain the failed baseline.
The canonical lifecycle tool performed both closeout checks and the final audit.
It reports audit_pending=2 because it counts every retained path as pending;
this is explicitly classified retained evidence, not a clean/delete claim.
Next action is integrate and verify a future repair before reconsidering either
closeout. No branch, dirty concurrent work, test evidence or campaign was removed.

The main checkout has concurrent location-observation changes owned by another
task. This report commits only this task's new acceptance file; those dirty
paths are preserved and are not absorbed into the dialogue source snapshot.
