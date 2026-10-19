# Decision-only KP v4: implementation and bounded acceptance

The v4 decision/sole-author path is implemented on0.9.8a throughc057cbc9f.
KP event/dialogue writing entrances are closed, the existing mechanical tools
remain, and the sole author receives canonical results and selected fragments.
The signed canonical App runs this implementation. Short tested interactions
can use one KP request and one author request. This is not evidence of universal
NPC answer quality, a complete communication ontology, or causal reuse speedup.

Follow-up under validation: the partial procedural answer exposes missing
input_requirements(topic,fields) meaning. A new closed constructor is implemented
and its red/green regression passes; it is not included in the c057 package or
measurements below. Fresh MiniMax and package evidence remain required.

## Changes and failure boundaries

The production wire has commands/interactions/reveal, explicit people and
recipients, actor-scoped source/fact references, and registered new-content
constructors. It has no event, points, intent, stance, speech text or future
heard declaration. Existing character state and directed relationships come
from canonical projections. Host-owned references bind before writes. Model
mechanical apply cannot bypass the separation through a policy origin.

Two live defects were repaired at their producer/reader/execution seams:

- Communication references now include prepared destinations and separate
  people from places. A listener cannot become a whereabouts destination or
  route waypoint; schema and execution consume the same issued role sets.
- A known-uncommitted atomic refusal no longer vetoes independently committed
  native results. The refusal ledger remains, and only closed failure status
  reaches the author. Unknown execution, partial settlement and incomplete
  coverage still block. Only host-native compilation supplies the private
  publication token. Free-form Keeper false-success guards remain active.

The second defect was found through actual Computer Use in the canonical App:
KP batched an unchosen advance payment with a requested move. Admission refused
the atomic batch; a later move-only call succeeded, but output still failed
held_act_outcome before author startup. The real-kernel regression was red,
then green. A second downstream guard also tried to judge the already-streamed
native author; it now consumes the same bounded native provenance. No new model
or prompt reminder was introduced.

The older ENOTDIR screen is separate. Native UI details match the retained
turn-failure-app-2026-10-19T02-49-16-369Z fault-injection workspace: a test made
expression-writes a file, then restored it. Its historical failure remains.
New App turns2/3 onf801 and4-7 onc057 are distinguished by their timestamps;
an old failure screen was never counted as normal v4 acceptance.

## Genuine consecutive MiniMax measurements

All primary/author roles use minimax-cn/MiniMax-M3.1-Flash-Preview, medium,
verified in actual model/author records. Supporting process profiles select
the same model. No fallback model or additional judgment lane was introduced.
Driver views reuse the single retained seed through forced CoW; the seed is
1,076,405,624logical bytes/4,614files. Actual free space exceeded130GiB at
admission. No full-tree copy, per-arm archive or test-evidence deletion occurred.

Driver C on8b78104bf, with equivalent historical intent categories:

| Complete player intent | Seconds | KP requests | Authors | Tool submissions | Retrieval |
|---|---:|---:|---:|---:|---:|
| Confirm paid pickup and retained spare film |16.139|1|1|1|0|
| Ask directions while remaining in the shop |23.322|2|1|1|0|
| Walk to the Cafe and greet its current person |25.067|1|1|1|0|
| Ask the person where to find Doctor Bob |22.414|1|1|1|0|
| Total |86.942|5|4|4|0|

The extra request followed a thinking-only provider completion. Each output
submission succeeded. Canonical state records one move/30minutes, no repeated
charge,178.5USD, no open owed rows, retained spare film and pickup receipt, and
the exposed film remaining with the photo clerk. The last answer selects the
actor's exact existing report; its old wording is not promoted to world truth.

Historical2be99914d native-v3 took133.823s, seven KP requests, four authors and
six tools; legacy took105.458s, eight KP requests, four authors and four tools.
C is descriptively35.0% below v3 and17.6% below legacy. Revisions, precise player
wording, provider timing and output lengths differ. This is not a controlled
causal comparison. Both historical arms already retained material facilities;
they do not isolate the benefit of reuse itself. Do not rerun a forbidden
prose-writing KP mode just to obtain another comparator.

Driver D onf80128896 is a harder independent sequence, not the same four-input
control. Its first three intents take15.331/16.934/22.512s, each one KP/author/
output. A question about both Vera and the doctor answers only the doctor after
39.390s; the natural Vera follow-up takes25.788s. Count that original intent as
65.178s, five KP requests, two authors, three tools including one history recall.
The complete sequence totals119.955s, eight KP requests, five authors, six tools.
It preserves the same state/custody boundaries. The incomplete first answer and
awkward causal phrasing remain quality limitations, not successful fast answers.

## Current canonical App, c057cbc9f

The main session operated the real /Applications/PipiCOC.app through native
Computer Use, sending one natural input per observed reply. Four consecutive
inputs use one KP, one MiniMax author and one output each, with no tool refusals
or foreground retrieval. These are engine times from the committed user message
to run_end, excluding UI connection/queue overhead; they are not driver wall times.

| Intent | Engine seconds | Observation |
|---|---:|---|
| Observe the library desk and greet its attendant |13.148|Creates a temporary clerk, renders greeting; UI reports18s |
| Ask which information a records search needs |16.623|Related directions, but does not answer the requested fields; partial |
| Move to Hall of Records without applying or paying |13.520|One30minute move, no research/payment; UI reports14s |
| Ask whether the service window is open |11.346|Answers open; adds a redundant spatial direction; UI reports12s |

All four preserve tested state and protocol boundaries. Only three satisfy the
requested conversational intent without a missing substantive answer. Publication
success is not a semantic correctness score. No deterministic prose classifier
or new judge was added to force a better score.

Native AX observations capture the clerk reply growing at1792408072871,
1792408073140 and1792408073345; final UI replacement occurs1792408074226.
The author transport records seven actual text_delta chunks. The native sampler
first observes text after the last raw chunk timestamp, so it alone does not
prove first paint preceded provider completion. Source inspection confirms the
renderer appends received chunks without a typewriter timer or whole-text split.
Earlier browser inputs85/86 independently retained growing streaming DOM text.
Together these establish actual delta transport and incremental UI rendering,
not a guaranteed visible interval for every very short response.

## Material reuse and background work

C reuses17/21 and20/21 issued references in adjacent stationary contexts; D
reuses19/21, then retires the old cast on movement and issues7 current fragments.
D's next question reuses6/8 references, and subsequent inference retries reuse
8/8. These counts describe stable aliases/current issuance, not avoided reads or
provider KV reuse. Baseline foreground retrieval was already zero. C mostly
reports128cache-read tokens; D varies from0/128 to28k and68-76k on later retries.
Prepared enum changes can change tool-prefix bytes. No stable cache-speed win is
claimed and no prompt/cache-policy change is smuggled into this implementation.

The experimental Jev HTTP observer missed a confirmed admission request; its
zero totals are invalid. Corrected metrics report total HTTP requests unknown.
C's recorded foreground admission has one call on the move; D's recorded move
admission reuses the prior verdict with zero new calls. These are bounded recorded
lanes, not complete global HTTP counts. Zero-question story rows are not requests.

All five new D memory jobs, turns87-91, are done. Four inherited jobs remain
explicitly deferred: t39 keeper:7, t46 keeper:10, t52 keeper:4, t58 keeper:19.
They contain an old clerk's records offer, a doctor's unreported illness account,
an unidentified driver's interjection, and the remote editor's closing remark.
These are explicitly deferred historical segments, not running new jobs. Their
accepted extraction remains incomplete; the job result alone does not identify
why every Jev decision deferred. Do not invent a speaker, force acceptance or
call all four one proven attribution bug. They are not new v4 backlog.

## Validation, packaging and evidence

Current source c057cbc9f:24 focused decision/author/real-kernel cases pass, as do
seven held-failure/legacy false-success cases. The reproduction checks committed
move, absent cash receipt, preserved refusal status, and zero held-outcome judge.
Integration tsc retains its previously recorded callback/unknown-error and driver
declaration errors; no runtime/extensions type error was reported. It is not green.

LAN all run.n2BfDKl2 onleehow-pc: extension6187tests,6177pass/1fail/9skip;
integration2228tests,2227pass/1skip; routing12pass. Overall exit1. The sole failed
file is the existing extension-words inventory mismatch; no failure baseline was
edited and other-owner search/UI changes were excluded. Earlier runs V7DsHnmw
and M4lROPDc remain separate revision-bound evidence.

Canonical receipt identifiesc057cbc9f8977206ef656d8837748f886f13b85c;
121comparable runtime files byte-match the owned checkout. Stable PipiUI Dev
requirement is108232C5A713C15A869FC4C267E18D2E35CD276C. Staging is empty,
/Applications is the real bundle and the former build location is its backlink.
MiniMax lane overrides are process-only; product defaults were not edited.

Raw evidence: .coc/playtests/kp-decision-v4-{a,b,c,d}-20261019 (A/B are failed
intent evidence); retained canonical App session binding under the fault-test
workspace above; experiment browser-seams/prose-contract-20261019 contains
live-c-metrics-corrected.json, live-d-metrics.json, canonical-metrics.json and
canonical-c057-launch.json. LAN logs live at
/home/leehow/leehow/code/wt/codex-tests/.pytest-runs/kp-blood-road-20261018/run.n2BfDKl2/remote-all.log.
