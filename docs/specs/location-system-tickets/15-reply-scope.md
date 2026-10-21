# EL-15: a recovery preamble must not change player authorization

Original93 correctly held a move with action_admission_uncertain at.46; no
threshold is changed. The location representation confused a parent feature and
an undefined child destination. During recovery the model emitted a103-byte
text block alongside output. Subsequent calls were repeatedly blocked as OOC;
the App was stopped after fourteen failures and no delivered story. This is a
failed, manually stopped run, never a natural latency pass. Raw evidence remains.

Two stream hooks copied a model reply's reference scope into the table's input
scope. Native preambles could also acquire a public stream before the host knew
that the response contained tool calls. Isolate reply framing from input scope:
remove those model-origin assignments, buffer native reply text until the final
response shape is known, and discard a mixed tool-call preamble. Existing final
reference publication already uses its explicit reference record and dedicated
RPC; preserve it. Bound input-scope decisions, physical admission and all
transaction gates remain unchanged. Do not add a timeout or repeated-call cap.

Writer/read/actor: the bound input review owns input scope, the tool guard reads
it, and canonical operations act only after existing admission. The decoder owns
reply scope, final publication reads it, and table.reference.answer records a
standalone OOC answer. Neither scope writer may impersonate the other.

Extend the real native refusal/correction seam with a reference preamble and a
valid corrected output in the same assistant message. Prove the old path fails,
then verify one successful settlement and no exposed preamble. Keep direct OOC
publication and its prohibition on physical writes covered separately. These
controlled transports are component tests, not live acceptance.

External comparison: OWASP recommends preserving user authorization scope at
downstream execution rather than trusting model output as permission. Anthropic
recommends specific actionable tool feedback. They support separating authority
and diagnosis here; they do not authorize a new security framework, extra agent
or different product workflow.
https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
https://www.anthropic.com/engineering/writing-tools-for-agents
