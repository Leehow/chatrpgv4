# Source-bound RuleGraph stage 1

Status: **revision-required; source-bound; not accepted; not integrated**.

This tree rebinds six previously reviewed derivative candidate shapes to
visually reviewed pages from the exact 40th Anniversary Keeper Rulebook PDF:

- core checks, Push, and Luck;
- social/interpersonal rules;
- concealed Psychology observation and realization gaps;
- non-session damage;
- SAN checks, thresholds, and bouts of madness;
- skill prose plus equipment, build, cash, and living-standard reference
  windows.

The external source bundles are identified by PDF SHA-256 and canonical bundle
digests in `manifest-draft.json`; their page text is intentionally not copied
into Git. `tests/fixtures/_gen_rulegraph_source_stage1.py` can reproduce the
committed candidate/provenance bytes when
`COC_RULE_GRAPH_SOURCE_BUNDLE_ROOT` names those external bundles.

No candidate in this directory has passed independent semantic review.
`graph_content_digest`, shard digests, reviewer identity, and promotion
eligibility therefore remain unset/false. The generator must not call
`accept()` or `build()`.

Development/reference lookup content is now bound through two separate source
windows so neither bundle exceeds the 32-page review boundary. Its runtime
lookup, advisory, and secrecy adapter semantics remain candidate policy rather
than rulebook claims, and therefore require independent contract review. The
old `stage1/` tree remains derivative-parity evidence only.

PDF index 85 is recorded as an extraction gap because it is full-page art with
no rule text to bind. MinerU emitted no table text for PDF index 413, so the PDF
skill recovered that one visually verified page with `pdftotext -layout`; its
exact normalized text hash is part of `reference-tables-v2`. No text was
invented for either page.

The initial PP-OCRv6 corpus submission failed once with provider code 10010
(queue full) and was not retried. These bundles instead use the already
completed external MinerU page-index output as text, followed by manual visual
review of every selected PDF page and canonical `coc_pdf_bundle.py` validation.
