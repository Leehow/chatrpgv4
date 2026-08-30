# R7 stage-1 candidate status

Status: **revision-required; not source-accepted; not production-integrated**.

The stage-1 candidate graph is useful derivative-parity evidence. Its inputs
are committed `rules-json` files and test fixture graphs, not accepted
rulebook page Markdown. Under `docs/specs/pi-coc-rule-graph-runtime.md` §4 and
§6, those derivatives may check parity but cannot serve as RuleGraph source
authority.

The two independent reviews in `reviews/` approve the prepared candidate
semantics and packaging discipline only. Both original verdicts explicitly
kept the package revision-required and unaccepted. They do not approve source
binding, runtime promotion, or production integration.

The generated build under `accepted/` is retained as deterministic mechanical
evidence because deleting it would discard useful comparison data. Its
manifest deliberately remains `review_status: revision-required`. The
directory name is historical and does not confer acceptance authority.

To become source-accepted, each family must be regenerated from a validated
page-level rulebook corpus with immutable `{pdf_index, layer, revision,
content_sha256}` bindings, independently reviewed, and then pass the runtime
promotion gates. No page number or source span may be inferred from the
whole-book MinerU `full.md` file.
