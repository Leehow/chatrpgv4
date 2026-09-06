"""The reader's standing commands for one section (contract §14.3, §14.5).

`module.packet` returns this text filled in; the extension puts it in front of
the child `pi` process whose system prompt is `content/setup/reader.md`. The
commands are the only way the reader is expected to touch evidence: a search,
a verify, a page, and the review gate. Nothing here judges content."""

from __future__ import annotations

import json
from typing import Any

BRIEF_TEMPLATE = """# Read this section: {module_id} / {section_id}

Working directory: `{work_dir}`. This section is **{section_title}** of *{title}* (kind: {kind}),
covering pdf_index {first_page}-{last_page}; {pages_before} pages come before it and {pages_after} after it.
**Pages outside this section are not in the packet, and an id like `span-p{next_page}-1` does not exist** --
check with `verify` before writing.

## What you have

- `packet.json`: the evidence spans (`spans[]`, each `span_id`/`page`/`text`), `page_window`,
  `skeleton` (the module node `{module_node_id}` and the roster from accepted shards -- the same person/place/clue
  **keeps its id**; do not redefine it), `vocabulary` (the closed word lists and the id rules), `coverage_domains`,
  `machine_filled_keys`.
- The system prompt carries the full contract; when unsure, go back and read it, do not guess.

## Query the evidence with these commands, do not chew the JSON yourself

```
{evidence} search <name or number>      # find it in every span of the section, every source at once
{evidence} verify <span-id>[,<span-id>...]   # whether these ids exist in this packet
{evidence} page <pdf_index>          # the whole page (only {first_page}-{last_page})
{evidence} outline                   # spans and characters per page
{evidence} coverage --shard shard.json   # after writing: which substantive paragraphs are still uncited
```

## Delivery

Write the shard to `{work_dir}/shard.json` (one `coc.module-graph-shard.v3` object; several write/edit passes are fine).
`module_id` is `{module_id}`, `section_id` is `{section_id}`, `source_language` is `{source_language}`,
`aspects` is {aspects_json}. The machine fills `relations`, the `coverage` domains you leave out, each claim's
`visibility`/`asserted_by_ids`/`known_by_ids`/`validity`, and any omitted `claim_id`.

Then run the gate:

```
{review}
```

`accepted: true` means done; otherwise fix by the findings (gate/code/path/message) and run again, three rounds at most.
The findings are deterministic machine verdicts; do not argue with them. After passing, write `{work_dir}/DONE.json`:
`{{"nodes": N, "claims": N, "rounds": <how many>}}`.

## Three red lines

1. Cite only span ids that really exist in `packet.json`; every name and every number must be in the text of the span it cites.
2. Do not add what the book does not say; when you do not know, mark that domain `unresolved` in `coverage`.
3. Do not force a link to a neighbour outside this packet: when `pages_after` > 0, mark `causal` as `partial` and say the entrance or exit lies outside this section.
"""


def render(*, module_id: str, section_id: str, title: str, section_title: str, kind: str | None,
           source_language: str, aspects: list[str], work_dir: str, page_window: dict[str, Any],
           module_node_id: str, evidence_command: str, review_command: str) -> str:
    return BRIEF_TEMPLATE.format(
        module_id=module_id,
        section_id=section_id,
        title=title,
        section_title=section_title or section_id,
        kind=kind or "unclassified",
        source_language=source_language,
        aspects_json=json.dumps(list(aspects), ensure_ascii=False),
        work_dir=work_dir,
        first_page=page_window.get("first_page"),
        last_page=page_window.get("last_page"),
        next_page=int(page_window.get("last_page") or 0) + 1,
        pages_before=page_window.get("pages_before"),
        pages_after=page_window.get("pages_after"),
        module_node_id=module_node_id,
        evidence=evidence_command,
        review=review_command,
    )
