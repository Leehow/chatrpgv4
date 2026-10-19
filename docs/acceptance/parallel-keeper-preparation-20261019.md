# Parallel material preparation and existing decisions

Implementation:30d4461f0 with native-queue correctiona93e9d7e5 on0.9.8a.
Final-source live verification and terminal regression evidence are recorded
below. Scheduling/reuse are verified; a net latency improvement is not proven.
This follow-up does not add a model, a semantic classifier, a prompt reminder,
a speculative author, a tool-schema change or another orchestration framework.

## Actual dependency change

Before: existing continuous-turn preparation/judgment, then actor reads, then KP.
After: finish the judgment's native read prerequisites; start current/named actor
reads; overlap those reads with the existing remote judgment; join people and
ready source views before KP. Existing independent Jev batches already run via
Promise.allSettled, so no additional judgment batch was necessary.

The TypeScript kernel transport awaits native RPC requests serially. Starting
every optional card before apply-options merely queues those options behind the
cards. A first ordering attempt still blocked a conditionally needed time-band
read. Both shapes have red/green engine regressions. The final scheduling point
is the end of ContinuousTurn.prepare's native read barrier, before remote decide.

The host includes current people and at most eight explicitly named known NPCs.
It matches issued public names/exact npc_N tokens; duplicate labels do not guess
an identity. Names are not intent, permission, presence or a disclosure grant.
Prepared offstage people remain Keeper-only; the existing author selection and
actor-knowledge boundary remain. Unknown/new topics retain ordinary lookup tools.

One run-local cache shares completed/in-flight reads across unchanged model
steps. Identity binds campaign/worldline/loop/turn/source/world revisions and
the supplied people/voices. A write or another input requires fresh preparation;
missing revision identity disables reuse. Failed cards retain explicit coverage.
No persistent world state, kernel arithmetic or transaction order changes.

## Real MiniMax comparison

Both arms use the same retained Blood Road starting seed, private CoW views,
minimax-cn/MiniMax-M3.1-Flash-Preview and medium reasoning. Primary/author actual
attribution is recorded. Inputs are individually submitted by the main player,
after reading each genuine reply, not a scripted-player or synthetic KP run.
The seed is1,076,405,624 logical bytes/4,614files; default4GiB/512MiB/10GiB
storage bounds apply. Admission observes131GiB free. Raw evidence is preserved.

Fresh baseline is edb705a0e, runtime-equivalent to a49aeb408's docs-only change.
The preliminary candidate is30d4461f0, before the native-queue correction.
All first four input strings are identical across these two arms.

| Player intent | Baseline seconds, KP/author/tools | Preliminary seconds, KP/author/tools | Outcome boundary |
|---|---|---|---|
| Confirm paid pickup and retained spare film |16.338;1/1/1|16.261;1/1/1|Both confirm, no fee or handover repeated |
| Ask directions without leaving the shop |16.179;1/1/1|13.354;1/1/1|Candidate chooses a prologue waypoint; not a usable direction |
| Return to Cafe and greet Vera |17.164;1/1/1|18.000;2/1/2|One move/30minutes in both; candidate retries forbidden fixed-route parameters; both have Vera/waitress wording ambiguity |
| Ask where to find the doctor, without departing |19.886;1/1/1|16.952;1/1/1|Baseline gives known address report; candidate supplies only limited-acquaintance material |

Four-response totals are69.567s versus64.567s. Those are not equal successful
intent totals. A natural candidate follow-up costs another18.088s and still
does not fully resolve the doctor's address question: that original intention
costs35.040s, two KP/author/output rounds, and remains incomplete. Total observed
candidate wait is82.655s. Do not advertise the raw four-response7.2% reduction
as a successful speed improvement. Historical E's95.274s is also not the fresh
control; its extra lookup is stochastic, not reproduced on every baseline run.

The direction defect is already in the candidate KP decision:
directions(to=Marathon Cafe,via=[west-texas-highway-prologue]). The author renders
the supplied public label. The movement retry supplies via/travel_band for a
host-bound route; the existing validator refuses before writes and the second
packet removes them. The doctor packet selects only the limited-acquaintance
report. These are genuine decision/wording limitations, not hidden successful
intents or errors repaired by a new judge. No arbitrary route/name content fix,
silent parameter removal or post-hoc whole-response rewrite was introduced.

## Material, state and author evidence

Final a93e9d7e5 repeats the identical four baseline input strings, then naturally
returns to the shop and confirms pickup details. All six use one KP, one author
and one successful output, with zero foreground retrieval or parameter retries.

| Complete intent | Final seconds | KP/author/tools | Observed result |
|---|---:|---:|---|
| Confirm pickup and spare film |12.331|1/1/1|Both confirmed; no fee or handover |
| Ask directions while staying put |11.943|1/1/1|Answers south toward the Cafe; no prologue label or movement |
| Return to Cafe and greet its attendant |18.778|1/1/1|One30minute move, current attendant greets; Vera/epithet relationship remains implicit |
| Ask where to find the doctor |36.142|1/1/1|Gives existing north-road address report, retains uncertainty about today's presence |
| Return to the shop and greet, without collection/payment |16.569|1/1/1|One30minute return, original clerk retained |
| Confirm next-day pickup again |16.464|1/1/1|Reuses actual prior pickup/spare-film information |

Matched first-four totals:69.567s before versus79.194s final,13.8% slower.
Both use four KP requests, four authors, four outputs and zero retrieval tools.
There is no observed reduction in those round counts against the fresh baseline.
Final six-intent total is112.227s; the extra two are functional continuity checks,
not matched benchmark arms. Preliminary partial/failed intents above remain.

The final doctor's one KP request takes27.746s versus10.936s before. Waiting
from submitted request to the first nonempty thinking delta is15.735s versus
3.818s. Output tokens are751 versus1101; the final request has about1.4k extra
input tokens (92,722 versus91,358). This is a slower single generation, not an
extra reasoning round or a19-41ms material read. These traces do not distinguish
provider queuing from pre-delta internal work, or establish a causal effect of
the extra material. No provider/model/effort/cache-policy change is made to
manufacture an improvement.

Final preparation times are21/19/19/41/22/19ms. Each projection reuses its completed
run-local preparation with zero repeated card reads. The doctor has one extra
native record proactively loaded; the baseline already had zero foreground
retrieval, so this is not a reduction in total native reads. Actor reference
hashes prove the named person's identity reaches the first actual KP request.

The real run's continuous route preselection remains selection_deferred with
no_unique_named_destination. It does not produce an eligible early route verdict,
even in the extra return input. Do not claim measured live Jev/read overlap from
this sequence. The blocked serial-RPC red/green regressions prove overlap for
eligible independent judgments; source traces prove actual prefetch/join/reuse.
Dependent admission remains after the KP supplies a proposal, as before. No new
judgment is issued merely to obtain a parallel benchmark sample.

Preliminary telemetry shows current-person preparation19-23ms, named-doctor
preparation41ms, and zero repeated native card reads on each same-revision model
projection. Movement's parameter retry also reuses the preparation. The actual
first doctor request's delivered people.1.ref hash matches npc_19, the issued
known identity, rather than a free-name lookup of a different module namesake.
This proves material delivery and reuse, not a causal reduction in KP rounds.

Both arms retain cash178.5USD, the spare film with36charges and the pickup receipt
with the investigator; exposed film remains with the clerk. They reach Marathon
Cafe at clock465 after exactly one30minute move. The candidate follow-up adds
one canonical3minute conversation-time result, ending at468; it is excluded from
the same-four-input state comparison. No second fee, film consumption or move.

All four new baseline memory jobs and all five preliminary-candidate jobs finish.
The four inherited deferred jobs remain separate. Recorded new background Jev
requests are3/2/2/2 before and3/2/2/3/3 after; these are memory-lane counts, not
global HTTP totals. The old experimental HTTP observer is known incomplete.
There is no new foreground judgment model. Actual author deltas remain plain
text, with one author per completed output and no buffered typewriter stage.

Final matched state is Cafe/clock465. After its two extra inputs, state is the
photo shop/clock495, with exactly two movement receipts totalling60minutes and
no cash/item transfer or extra conversation time. Cash178.5USD, spare36charges,
receipt ownership and exposed-film clerk ownership remain unchanged. All six new
memory jobs87-92 are done (3/2/2/3/2/3 recorded background Jev requests). Four
inherited deferred jobs remain unchanged. All six actual authors are MiniMax3.1;
primary request efforts and delivery evidence select medium. The six deliveries
contain51 actual text deltas, spanning5ms to1.052s per response. This proves
transport preservation, not visible incremental painting in the installed App.

## Checks and evidence locations

The initial engine regression is red5/6 before implementation. Final source has
26 passing preparation/continuous/current-context tests,130 passing fast checks,
five passing system-language checks and a passing focused preparation-module
typecheck. The final author/streaming file passes65/65. No baseline is edited to
make unrelated tests pass.

LAN focused run.1j55Ok5p on30d4461f0 is terminal, exit1/wall1024s:
442 extension files,4031tests,4030pass/1fail; integration2223tests,
2222pass/1skip; routing12pass. The sole failure is the existing shipped-but-unused
turn_unfinished_notice caption. This broad run predates the serial-queue correction.
Final a93e9d7e5 builds on LAN (run.n9qfDKZH), then its targeted preparation,
continuous, current-context and author regressions pass91/91 on LAN in18s
(run.GTUWCm62). These source revisions are deliberately distinguished rather
than repeating or relabeling the earlier broad result as a new full-suite pass.

Driver evidence:
.coc/playtests/kp-preparation-{before,after,final}-20261019.
Derived metrics: .coc/experiments/npc-action-contract-20261018/browser-seams/
prose-contract-20261019/preparation-{before,after,final}-metrics.json.
The before/after artifacts retain actual revisions and failed/partial intentions.
Installed canonical App remains the preceding edb705 package; these source-driver
measurements do not claim that the new runtime is already installed in the App.
All three driver runs stopped cleanly after their actual completed inputs.
The owned validation path/branch is terminal and explicitly retained by lifecycle
closeout as retained_verification_failed. Audit reports the terminal dirty path
and its two dependency symlinks, not audit_ok or deletion. No forced cleanup or
other-owner source changes were performed.
