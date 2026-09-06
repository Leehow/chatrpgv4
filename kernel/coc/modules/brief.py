"""The reader's standing commands for one section (contract §14.3, §14.5).

`module.packet` returns this text filled in; the extension puts it in front of
the child `pi` process whose system prompt is `content/setup/reader.md`. The
commands are the only way the reader is expected to touch evidence: a search,
a verify, a page, and the review gate. Nothing here judges content."""

from __future__ import annotations

import json
from typing import Any

BRIEF_TEMPLATE = """# 读这一节：{module_id} / {section_id}

工作目录：`{work_dir}`。这一节是《{title}》的 **{section_title}**（kind: {kind}），
覆盖 pdf_index {first_page}–{last_page}；本节之前还有 {pages_before} 页，之后还有 {pages_after} 页。
**这一节之外的页不在包里，`span-p{next_page}-1` 这样的 id 不存在**——写之前用 `verify` 查。

## 手上的东西

- `packet.json`：证据 span（`spans[]`，每条 `span_id`/`page`/`text`）、`page_window`、
  `skeleton`（module 节点 `{module_node_id}` 与已接受分片里的名册——同一个人/地/线索**沿用它的 id**，
  不要重定义）、`vocabulary`（词表与 id 法则）、`coverage_domains`、`machine_filled_keys`。
- 系统提示里有契约全文；不清楚就回去读它，不要猜。

## 查证据用这些命令，别自己啃 JSON

```
{evidence} search <名字或数字>      # 全节 span 里找，一次拿到所有出处
{evidence} verify <span-id>[,<span-id>...]   # 这些 id 是否存在于本包
{evidence} page <pdf_index>          # 看整页（只能是 {first_page}–{last_page}）
{evidence} outline                   # 每页多少 span、多少字
{evidence} coverage --shard shard.json   # 写完看哪些实质段落还没引用
```

## 交付

把 shard 写到 `{work_dir}/shard.json`（一个 `coc.module-graph-shard.v3` 对象，可分多次 write/edit）。
`module_id` 填 `{module_id}`，`section_id` 填 `{section_id}`，`source_language` 填 `{source_language}`，
`aspects` 填 {aspects_json}。机器会填 `relations`、`coverage` 里没写的域、claim 的
`visibility`/`asserted_by_ids`/`known_by_ids`/`validity`，以及省略的 `claim_id`。

然后跑闸门：

```
{review}
```

`accepted: true` 就完成；否则按 findings（gate/code/path/message）改再跑，至多三轮。
findings 是确定性机器判定，不要跟它争。通过后写 `{work_dir}/DONE.json`：
`{{"nodes": N, "claims": N, "rounds": 几次}}`。

## 三条红线

1. 只引用 `packet.json` 里真实存在的 span id；每个名字、每个数字都要在它引用的 span 文本里。
2. 书上没写的不要补；不知道就在 `coverage` 里标 `unresolved`。
3. 邻居在本包之外就别硬连：`pages_after` > 0 时把 `causal` 标成 `partial`，说明出入口在本节之外。
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
