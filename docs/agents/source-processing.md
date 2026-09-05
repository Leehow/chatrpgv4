# Source processing and PDF evidence

Applies to product source-processing jobs and their design/validation, not every developer conversation that reads a document.

Paths and commands below are relative to the repository root unless absolute. Read only this route when the task requires it; it does not expand authorization.

## Text Work Runs As A Pi Agent (Binding, Ask Before Any Exception)

**Product source extraction/compilation over document or module text runs as a pi agent with tools.**
This implementation contract governs source-processing model jobs; ordinary developer reading, code review and instruction maintenance do not require spawning a Pi agent.
Not `--no-tools`. Not a single completion. Not a raw provider call, not an HTTP
request to an API, not a subprocess that takes a prompt and returns one string.

If you believe a task needs anything other than a tool-using pi agent, **stop
and ask the user in the current turn.** Do not decide this yourself, do not
decide it "just for an experiment", and do not decide it because a one-shot
channel is easier to wire. Silent adoption of a non-agent path is what this
rule exists to prevent.

### Why (measured, not preference)

A single completion has to fit its whole answer in one assistant message. On
this project's channel that ceiling sits near 47,000 characters -- 31 accepted
extractions, none above 47,226, and every truncation reported `stopReason:
error` rather than a clean stop. Everything downstream deforms around it:

- Sections get cut to four pages so the answer fits, which multiplies model
  calls -- the cost of a build is generation time, and a build already spends
  2.5 rounds per section.
- Density falls as the ceiling binds: ~11 nodes per thousand source characters
  on the sparse half of sections, ~3.6 on the dense half. The book is being
  compressed to fit a message, not read.
- The whole evidence packet has to be pushed through the prompt (60-70 KB)
  because the reader cannot open a file.
- Findings have to travel back out to a driver and in again, because the
  reader cannot run the validator itself.

An agent with `read/write/edit/bash` has none of those limits: it opens the
packet, writes the shard to a file across as many turns as it needs, runs the
gates itself, and fixes its own findings. The ceiling stops being a design
constraint on the pipeline.

### What this does not license

The agent still writes only what the source says, still cites real spans, and
is still judged by the same deterministic gates. Agent mode removes a length
limit; it removes no obligation. `--approve` grants tools, not trust: the gates
remain the authority on whether a shard is accepted.

## PDF Source Bundle Contract

The repository contains **no PDF parser**. An external PDF skill owns rendering,
review, extraction, and page evidence; repository code only validates/reformats
its bundle through `plugins/coc-keeper/scripts/coc_pdf_bundle.py`.

- Prefer the current host's suitable PDF capability. If none exists, recommend
  the open-source workflow at
  `https://github.com/openai/skills/tree/main/skills/.curated/pdf`.
- A third-party producer is acceptable only if it emits the same contract.
  Never add a repository PDF parser, OCR fallback, or PDF parsing dependency.
- `producer: codex-pdf-skill` identifies the handoff contract, not the host.
- Schema v1 records original path/hash, zero-based `pdf_index` Markdown
  paths/hashes, and host-declared `review_state`, `parse_confidence`, and
  `grep_anchors`. Pass it through; never invent quality or page offsets.
- Binding stores canonical `bundle_sha256`. Hydration rejects source identity,
  page content, review evidence, or asset drift.
- Repository code may check the original PDF's existence, suffix, and SHA-256;
  it must not open the PDF for page count, metadata, layout, images, or text.

### Pi subprocess mode evidence

Do not infer that a Pi image/tool workflow requires RPC merely because the
model performs several internal tool calls. A single `pi -p` task may run its
own model-tool loop, including reading a local image, before returning one
terminal result. Use `-p` only when one initial prompt can complete the closed
job and the outer controller needs only that terminal result. Evaluate and
test `--mode rpc` when the controller must append images or instructions after
launch, observe structured progress or state, steer or follow up, or request a
protocol-level abort. Every mode choice requires executable evidence for the
needed behavior; terminology such as “multi-turn” is not evidence by itself.

### Counting Calls In Playtest Evidence (Binding)

A string count over `rpc-events.jsonl` counts MENTIONS, not calls. Operation
names appear in tool catalogs, discovery payloads, JSON schemas, prompt prose
and error messages, so `grep -c '"turn.finalize"'` can report a hundred for an
operation that was called once.

Count calls from `tool_execution_start` events, reading `toolName` and
`args.operation`:

```python
name = row.get("toolName") or ""
op = (row.get("args") or {}).get("operation")
called = op or name
```

**The Keeper mostly uses the direct tool names, not the generic envelope**, so
an operation invoked as `coc_turn_finalize` is invisible to a search for
`turn.finalize`. Count both spellings or you will under-count the direct path
and over-count the generic one.

This was violated three times in one session, each time producing a decision:
`agency_review_operation` "1111 occurrences" (mostly prompt prose),
`turn.output_context` "58 calls" (4 real), `turn.finalize` "109 calls" (9
real). One feature was built onto an operation with zero real calls, then
migrated onto another believed to have 58 and actually having 4.

Before building anything the Keeper is meant to receive, count its host
operation's REAL calls in preserved evidence first. An unreachable operation
is a feature that does not exist, and this repository has now found four:
`output_instruction` (no readers), `localized_terms` (no writer),
`narration.review` (not offered in normal play), `narration.brief` (never
called).
