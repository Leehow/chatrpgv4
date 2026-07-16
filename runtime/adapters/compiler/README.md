# Scenario compiler adapter

This is a Keeper-only boundary. Its first phase receives text extracted from
locally owned module pages and returns the seven canonical structured scenario
documents. Its second phase receives only the minimum-privilege structured
projection produced by `coc_epistemic_compile.py` and returns the three
provenance-bound epistemic sidecars.
Neither the AI player nor the narrator receives the request or raw source text.

The Python adapter validates the subprocess envelope. The runtime then stages
the returned files together with their source-evidence index, runs the canonical
scenario validators, promotes unreachable/provenance/invalid-skill warnings to
new-compile failures, and only persists a validated bundle. Validator failures
are returned to the same compiler as structured revision feedback within a
bounded retry budget. Configure the default runner with
`COC_COMPILER_MODEL_PROVIDER` and `COC_COMPILER_MODEL_ID` (defaults:
`coding-relay/gpt-5.6`).

The second phase never receives raw page text or Keeper-only agenda prose. Its
result is request-hash-bound, installed atomically with the base IR, and must
pass the same deep scenario validator before the cold compile is published.
