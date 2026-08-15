# Masks of Nyarlathotep 全模组马拉松 · 完整留档（2026-08-14）

> 本次运行：pi-coc RPC 模式，deepseek/deepseek-v4-flash 当 KP，主会话当唯一玩家
> （调查员迭戈·萨拉查，一次一句自然回复），8 个 unit（序章秘鲁 → 纽约 → 伦敦 →
> 开罗 → 肯尼亚 → 澳大利亚 → 上海 → 终章）全部抽取、安装、真玩到结构化结局。
> 八份战报（`artifacts/battle-report-{peru2,masks-*}.md` + evidence json）已随
> 提交 `0865b0f` 入库。本目录是**原始运行证据**的压缩归档，未进 git（体积原因），
> 常驻磁盘作复盘金库。校验和见 `SHA256SUMS`。

## 各包内容与链条

| 包 | 内容 | 作用 |
|---|---|---|
| `playtest-workspaces-8chapters.tar.gz`（98M） | `.tmp/pi-coc-{peru,america,london,cairo,kenya,australia,shanghai,finale}/`：RPC 事件流（rpc-events.jsonl 全量）、逐 turn 证据、各章 `.coc` 战役本体（含 commit-snapshots、turn-finalizations、rolls）、`.pi-subagents` 产物、rpc-driver.py | 逐骰逐回合的原始记录，复盘时任何一掷都可回溯 |
| `run-dirs-and-reports.tar.gz`（63M） | `.tmp/pi-coc-*-run/` 八个导出快照 + `pi-coc-peru-install`（IR 暂存） | 战报导出时的冻结现场（run.json 身份、canonical table-transcript、每包自带 artifacts） |
| `pipeline-masks-work.tar.gz`（188M） | `.tmp/masks-work/`：全书 669 页 fast/detail 双层页文本、structure.json（14 unit 页码）、7 章 sections、`ir/` 七章完整 IR | 外部管线的稳定副本（原件在 scratchpad，见下包） |
| `pipeline-original-scratchpad.tar.gz`（264M） | `/private/tmp/claude-501/.../scratchpad/` 全量：masks 工作目录**原件**（今晨 worker 产出：--page-offset 修复、prologue 抽取）、masks-*.log、audit-ws*/play2/play-toomany 等晨间验证材料 | 管线侧第一现场；`/private/tmp` 会被系统清理，故抢档 |
| `misc-campaigns-and-logs.tar.gz`（223K） | 主仓库 `.coc/campaigns/peru`（今晨安装原件，只读保留）+ `/private/tmp/coc-masks-ws`（8 月 12 日仓库内 progressive 旧尝试） | 外围旁证 |
| `logs/` | `index-*.log`、`extract-america.log`：每章 index-unit/extract 的校验器逐条输出 | 8/8 全绿、validator_attempts 的直接证据（随 git 提交） |

## 复盘要点索引（详见会话记录与战报）

1. steward 自动派发在 IR 冷编译战役上空转（首局 30+ 分钟；干净重装后八章未复发）；
   pi-subagents 在 deepseek 子代理上 "produced no output"。
2. 跨章状态半继承：技能成长一路带（侦查 42→63），HP/SAN 每章重置、幸运仅章内恢复；
   无章链/战役连续体机制。
3. KP 纪律方差：纽约章零 SAN、发展结算三章缺席三章恢复、NPC 医疗骰进玩家骰日志、
   结构化结局收据需玩家明确索要。
4. 埃及章覆盖最浅（90 页只触 5 幕）；终章原文计分制（逐章点数→分档结局）未执行，
   「明暗之眼」封印方向被再创作为「门闩」。
5. 符合度核验：火箭/日食/Gray Dragon Island/Nayra/Lesser Edale/Ahja Singh 等均
   在原书页文本中 grep 命中；唯一名词漂移 Ahja→Aja。

## 轨道

ACTIVE_IMPLEMENTATION_TRACK=pi-coc（Codex 侧未动）。
