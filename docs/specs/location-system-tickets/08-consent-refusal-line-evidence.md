# EL-08: preserve the blocking line and decision axis in consent errors

Original meal input77 took236.730s and four failed tools. The first review held
item lines2–4 for selection probabilities. Its replacement held cash line1 on
the restriction axis. The Keeper received only an unspecified uncertain scope,
although telemetry retained those exact line results. It removed unrelated
operations, tried a quote, and still never served the selected meal.

Keep every question, probability, threshold, atomic batch and replay rule.
Before returning a non-authorizing verdict, derive the blocking line numbers
from the very same selection/scope arrays already used by that verdict. Ground
text names each blocking axis as unestablished selection or uncleared restriction;
it is evidence of the review, never a new factual claim about player intention.
Do not invent an explanation, prescribe different choices, mark any other line
as executable, automatically split a transaction, or add a semantic call.

Writer: reviewAdmissionJevOnly computes grounds from its existing checked answers.
Reader: both ordinary admission errors and same-Keeper native output errors
already retain verdict.grounds. Actor: the same Keeper sees which part needs a
meaningful correction, while all replacement proposals still need normal review.
Tests cover mixed selection/restriction holds, the refused case, unchanged gates
and grounds reaching the ordinary error object. Actual original-session success
and120s remain separate gates; this diagnostic change alone promises neither.

The official MCP tool error contract recommends actionable tool results for
self-correction, and Anthropic documents error results naming missing input.
Both support retaining known error evidence, not automatic authorization:
https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx
https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
