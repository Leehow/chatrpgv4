# 真桌验收方法

每个切片的验收都是一张真桌：主会话的 Claude 当玩家，`pi` 跑 grok 当守秘人，一回合一回，走产品路径。禁止假守秘人脚本、批量结算、关键词路由或场景模板刷回合（仓库 `Agents.md` 的绝对禁令）。自动化接缝（内核 RPC、扩展、驾驭器）证明的是契约，真桌证明的是产品；到目前为止每次真桌都找出 3–5 个接缝看不见的系统缺陷。

## 工具

- 驾驭器 `tests/play/driver.py`：`start --campaign <id> --run <run_id> [--launcher bin/pi-coc-setup]` 起一个守护进程与 `pi --mode rpc`；`turn "<玩家原文>" --run <run_id> --timeout <秒>` 发一条玩家输入并打印交付；`stop`；`status`；`log`。证据落在 `.coc/playtests/<run_id>/`（每回合 `turn-N.json`、`events.jsonl`、`pi-stderr.log`）。
- 指标 `tests/play/kpi.py --campaign <id> --turns a-b`：从战役遥测算每回合「第一次写状态前的只读调用数」、工具总数、内核报错、是否进规则层；`--baseline` 给 `haunting-s0` 13–25 回合的基线。
- 资料包 `tests/play/bundle_from_pages.py`：宿主把 PDF 读成的页 Markdown 装成 `coc.pdf-bundle.v1` 资料包；仓库不解析 PDF。
- 建卡进程走 `bin/pi-coc setup`（驾驭器用 `--launcher bin/pi-coc-setup`），游玩进程走 `bin/pi-coc --campaign <id>`。

## 证据

- 战役目录 `.coc/campaigns/<id>/`：`turns/NNNN.json`（玩家原文、收据、交付、世界快照、事实清单、警告、胶囊、采纳）、`transcript.jsonl`、`events.jsonl`、`telemetry.jsonl`（工具、车道、Director 采纳）、`memory/`、`save/continuation/`。
- 模组目录 `.coc/modules/<id>/`：`build.jsonl`（每 section 每轮的门与耗时）、`sections.json`、`work/<section>/`（读者的 shard 与 findings）、`module.json` 里的可玩性报告。
- 证据只增不删：战役、逐字记录、遥测、玩测目录永不删除。

## 每个切片怎么判

- 切片 1（规则族）：造景到对峙，六条 lane 至少五条进规则层并结算。
- 切片 2（提交链）：一局跨两次 `pi-coc` 会话八回合以上，第二次会话中守秘人主动召回第一次会话的事实。
- 切片 3（胶囊与 Director）：同一战役对照，第一次写状态前的只读调用数下降（基线中位数 3 → 0），进规则层的 lane 不降。
- 切片 4（建卡与模组车道）：一本真 PDF 从 `bin/pi-coc setup` 走七步到 `ready_for_table`，开桌三回合，开场材料全部来自构建出的图。
- 切片 5（退役旧树）：全量测试在 `uv run --frozen` 下绿，一局十回合回归。

## 读证据的三条戒律

- 缓存、守护进程内存、证据排序各骗过我一次：验证前重开进程，按 `at` 排序，看回合记录不看叙述。
- 守秘人说「已就位」不算数：看 `campaign.json` 的 `module_id` 与 `turns/NNNN.json` 的收据。
- 叙述里发生了却没有收据的事等于没发生：世界位置看 `world.json`，不看守秘人的话。
