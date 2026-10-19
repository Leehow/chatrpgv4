# Whole-intent Keeper comparison, 2026-10-19

## Result and scope

The same-revision comparison does not pass an overall speed-improvement gate.
Four complete player intentions take105.458seconds with the legacy interface
and133.823seconds with the native packet interface, including actual retries.
Both arms preserve the tested movement, stationary dialogue, payment and film
custody. This is a small descriptive comparison, not a statistical regression
estimate or proof about every part of the original material-reuse proposal.

Both arms execute the canonical App's2be99914d compiled TypeScript runtime,
MiniMax M3.1 Flash Preview / medium in primary and author lanes, one natural
player input per response through the real RPC driver. One frozen campaign seed
creates private CoW views through scripts/test-workspace.mjs. The initial seed
contains1,076,405,624bytes across4,614files; capacity admission passed with over
130GiB free. Neither arm imports the original long Pi chat branch. The native
arm uses packet=1/prescreen=1; legacy uses packet=0/prescreen=0 and the isolated
author. Material facilities remain enabled in both. Consequently this isolates
the decision path, not all reuse changes together against a historical product.
Product settings and other-owner dirty search/notice changes remain untouched.

| Intention | Legacy seconds | Native seconds | Legacy KP requests | Native KP requests | Legacy tools | Native tools |
|---|---:|---:|---:|---:|---:|---:|
| Confirm paid pickup and retained spare film |26.365|51.517|2|1|1|1|
| Ask directions while explicitly staying |22.307|19.265|2|1|1|1|
| Walk to the known Cafe and greet Vera |30.090|19.734|2|1|1|1|
| Ask Vera where to find Doctor Bob now |26.696|43.307|2|4|1|3|
| Total |105.458|133.823|8|7|4|6|

Each arm has four author requests and zero foreground retrieval calls. The
native fourth intention includes one real upstream500 retry and one refused
event-material binding; both remain in its cost. Its three actual inference
steps produce four provider requests. Driver wall time includes its existing
readiness/ack overhead; native run times total90.219vs118.607seconds. Startups
are separate. A first failed launcher import is retained as infrastructure
evidence and did not send a model request. It is excluded from gameplay timing.

The native first request takes36.413seconds and emits3,560output tokens,
including14,080characters of private thinking and a200-character tool argument
serialization. The author takes9.351seconds. Fewer calls alone do not guarantee
a shorter request. The provider reports little cache read on the first two
native requests, then73,472cache-read tokens on the known-movement request.
System/tool hashes match across those first two native requests; these records
do not establish why the provider missed, so no cache-policy repair is claimed.

The two middle intentions total52.397vs38.999seconds, about26percent less for
the native path. This favorable subset does not replace the slower full total.
Output lengths also differ: legacy461/350/406/387characters versus native
183/90/110/171; prose variability remains a confound. No significance claim or
long-tail percentile is justified by four observations per arm.

## Correctness and actual reuse

Both arms end at Marathon Cafe with178.5USD, no open owed rows, one movement,
unopened spare film and pickup receipt owned by the investigator, and the exposed
film owned by the photo clerk. Asking directions does not move the party. The
photo clerk remains at the shop and Vera at the Cafe. All eight intentions have
accepted delivery; this is checked against receipts and state, not inferred from
that status. Minor narrative continuity defects remain: the legacy Cafe greeting
says morning despite the afternoon clock, and its first reply invents a three-day
aside. Reasonable improvisation is allowed; these defects are retained, not
called perfect narrative continuity or repaired by changing test expectations.

An observational extension fingerprints the actual outgoing context string
leaves. At the same context type/path/hash, native adjacent inputs retain
86.8/96.0/81.3percent of their string-content bytes; legacy retains78.2/84.4/58.5
percent. These denominators exclude schemas, JSON punctuation and nonstring
values. They measure unchanged sent content, not avoided reads, cache hits or
semantic relevance. Reusing unchanged bytes still sends a large context and
does not itself eliminate another inference. Both arms already have zero lookup
tools, so this comparison cannot attribute an avoided lookup to native packets.

Current reuse has several distinct owners. ContinuousTurn.materials is a
same-turn option packet bound to source/read-set/campaign/worldline/loop/turn.
Its prepared_material_reuse event must not be called cross-turn retention.
The source-answer shelf holds bounded answers while staying in a scene and
retires them on scene/scope changes; accepted source memos survive in module
storage, while the in-process shelf does not survive restart. The hybrid
projection also hydrates current NPC views on each inference and supplies
retained history. This is not one general persistent library with differential
addition, retention and retirement across all material types.

## Long-session browser verification

The existing Blood Road browser session continues in Ego8/p1, using committed
2be99914d source. Its runtime entries and browser assets byte-match the installed
App. These are separate browser/session and canonical-App startup gates; the
browser service is not claimed to be the desktop process itself.

| Input | Intention | Complete seconds | KP | Author | Tools | Retrieval |
|---|---|---:|---:|---:|---:|---:|
|81|Ask directions without leaving|26.245|2|1|2|0|
|82|Walk to Cafe and greet Vera|21.898|1|1|1|0|
|83|Ask about the already-mentioned doctor|194.259|5|1|7|5|

Input83 has five inference steps of14.851/20.270/41.962/57.070/38.090seconds,
total172.243seconds. Its first three read-tool batches take0.167/0.079/0.082
seconds, total0.328seconds. It reads a scene/person, finds the clinic and bar
module entries, recalls prior dialogue, writes a full speech/event material,
then separately submits an output packet with the speech/event again. The
author takes19.312seconds. The predominant wait is repeated inference, not
document I/O. Module results report ready material; this turn does not run a
foreground PDF reader. Non-present-person detail, a newly mentioned destination
and a prior-utterance integrity check are not all redundant reads.

One read is mechanically wrong: look focus=scene with a remote name returns
the current Cafe, because name only selects npc/object/map in the existing
contract. The flat parameter schema accepts this inapplicable field instead of
making the read intention explicit. The later clinic lookup therefore does not
mean the first call supplied the requested remote scene. This is a specific
protocol ambiguity, not evidence for another semantic classifier.

The browser's82arrival says the player thanked the waitress while leaving the
photo shop; canonical actor locations remain correct. This minor origin-actor
continuity error is retained as evidence of the author-context boundary. No
prompt patch or automatic whole-response rewrite is introduced.

Visible streaming and final-state assertions are retained under the evidence
directory. Analyze only visible streaming DOM samples matching this delivery,
before provider message_stop; after completion virtualization can remount an
older DOM node, so its last sample is not the current final body.

## Validation and packaging

Canonical package receipt names2be99914d and stable certificate
108232C5A713C15A869FC4C267E18D2E35CD276C. All51required runtime entries and612
browser assets match the clean committed build. codesign verifies; the App
starts at /Applications/PipiCOC.app with the expected executable and ready UI.
LaunchServices and Spotlight resolve the canonical bundle; staging is empty.
The build-home path is a back-link, not another bundle. No deployment or push.

LAN all run.yWhVbJYn exits1: extensions6,140tests,6,130pass,9skip,1cancel;
integration2,228tests,2,227pass,1skip; routing12/12pass. The sole cancelled
extension case reaches its unchanged15second timeout under32-file concurrency.
The same complete memory-native-recovery file passes5/5 serially, including
that case in11.322seconds. This is composite validation, not one green full run.
All original failures and invocation logs remain retained.

## Consequence for the design

Normal movement and dialogue work in these samples, with the narrative limits
above. Overall speed improvement is unproven and fails in this four-intention
sample. The fast native path exists, but normal NPC dialogue can still escape
into the broad apply/event interface, duplicating prose, knowledge bindings and
the later native packet. The native tools occupy116,724serialized bytes versus
101,407in legacy here; the decision interface is not yet uniformly compact.

The next bounded design work should address the complete dialogue-to-event
contract and the named-scene read contract, reusing authoritative material IDs
and current results. It should not add a judgment model, prompt reminders or
one-off destination aliases. Establishing the causal latency benefit of material
reuse separately still needs a controlled comparison; unchanged-content ratios
are insufficient. No production change is made in this measurement batch.

Raw evidence: .coc/experiments/npc-action-contract-20261018/browser-seams/
comparison-20261019/comparison.json and per-input logs; real driver records under
.coc/playtests/kp-whole-intent-{legacy-20261019-b,packet-20261019}/;
rebuilt-browser-intent81/82/83-final.json; rebuild-package-provenance.json;
rebuild-app-all-lan.log and rebuild-app-memory-serial-lan.log. Keep originals.

Method references: [Google Benchmark warm-up and repetition](https://github.com/google/benchmark/blob/main/docs/user_guide.md)
and [NVIDIA GenAI-Perf latency definitions](https://docs.nvidia.com/deeplearning/triton-inference-server/archives/triton-inference-server-2640/user-guide/docs/perf_benchmark/genai-perf-README.html).
Their micro/server benchmarks inform metric separation, not gameplay validity.
