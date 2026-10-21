# EL-07: Return a known uncommitted output refusal to the same Keeper

Original session inputs73 and75 ended without prose after an optional time-band
proposal was refused. Their earlier price quotes remained committed. The native
submitTurnPacket catch always abandoned the input for needs, despite the existing
refusal guidance permitting a genuinely independent selected remainder. Shape
errors already return to the Keeper; these known prepublication consent errors
never reached that continuation.

Keep all admission gates and transactions. No automatic removal, splitting,
resending or publication of a rejected packet. Permit one same-input continuation
only for action_not_authorized or action_admission_uncertain before any author
stream/evidence exists, with the current HeldActOutcome proving complete known
uncommitted failures. The Keeper receives the original error and selects the
independent remainder itself. Every new operation still uses normal admission;
existing successful receipts remain facts, refused effects remain uncommitted.

Writer: the native output catch marks the current turn/run recovery allowance.
Reader: a later catch of that same input refuses another continuation. Actor:
the same Keeper can submit a new fully validated packet; the sole author reads
canonical results and the existing failed_attempts projection. It cannot narrate
an unsupported arrival, payment or other refused result. Unknown settlement,
publication failure, interrupted/started streams, stale owners and other error
reasons remain terminal. This is an authorization-retry bound, not a model time
limit, and does not make a refused action eligible to execute.

Regression: the actual Pi/native output path returns the original refusal before
a successful independent reply; the rejected time does not advance the clock;
no author runs before recovery; exactly one completed delivery afterward. A
repeated rejected packet stops with zero public bytes, and existing publication
and stale/unknown-outcome tests retain their boundaries. Deterministic harnesses
are component evidence only. Finish with the original App/backend via ego.

The ordinary tool-result continuation in
[Anthropic tool handling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
and [xAI best practices](https://docs.x.ai/developers/model-capabilities/text/best-practices)
confirms returning error evidence to the agent. Our stricter eligibility and
single continuation follow the existing consent/receipt contract; neither source
authorizes retrying a refused player action or guessing a partial success.
