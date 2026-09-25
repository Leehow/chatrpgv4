# 文笔 Mod：切片票

父规格：[prose-mod.md](prose-mod.md)。日期：2026-09-25。集成分支 `claude/prose-mod-20260925`，基底 `0.9.5a@95df22a6d`。

共用规则：

- 契约先于代码：改 `docs/kernel-rpc.md` 的指定节，节号只增不改。
- 只跑定向测试：`node --test <file>`、`uv run --frozen python -m pytest <file> -q -p no:cacheprovider --basetemp=/tmp/pytest-<slice>`；pytest 前先 `npm run build:runtime`。全套件由 lead 跑。
- 每票只碰自己范围内的文件；`mods/narration-craft` 的版本按票里写的发布，不发别的版本。
- 在自己的分支提交，报告 commit hash；不推、不合并、不动别的分支。
- 每票预留一次修复提交给集成时发现的接缝缺陷。

## W1 — jev-craft-retire

Status: `ready-for-agent`。分支 `claude/prose-mod-w1-20260925`。范围：规格 §5。

完成时可观察：`grep -rn "craft-reference\|craft_reference\|CRAFT_REFERENCE\|runtime/craft\|craftMode\|mods.craft" kernel-ts extensions runtime pipicoc tests` 只剩契约里的历史节；`mods/narration-craft` 1.8.0 只有 `agent.md`、`brief.md`；`docs/archive/craft-reference-cards-v2/` 有卡、候选表与 README；`node --test tests/extension/context-policy.test.mjs tests/extension/unified-voice.test.mjs tests/extension/mod-package-boundary.test.mjs tests/extension/jev-pacing-mod-alignment.test.mjs tests/extension/mods-panel-status.test.mjs` 通过；`tests/kernel/test_mod_order.py test_mod_vocabulary.py test_mod_director_text.py` 通过；契约 §30.7f 存在；两份旧 spec 的 Status 行指向 prose-mod.md。

## W2 — voice-owner

Status: `ready-for-agent`。分支 `claude/prose-mod-w2-20260925`。范围：规格 §4。

完成时可观察：`tests/kernel/test_voice.py` 旧 owner 用例原样通过；新增统一包夹具用例通过（新战役第一次 commit 后 `voice.job` 发包、`voice.submit` 写进统一包 dossier、胶囊 `voices` 出现该人、交接后不重生成）；`tests/extension/unified-voice.test.mjs` 通过；`extensions/npc-voice/index.ts` 与 `content/setup/npc-voice.md` 无改动；契约 §40.7 追加段与 §30.7e 追加句存在。

## W3 — style-contract

Status: `ready-for-agent`。分支 `claude/prose-mod-w3-20260925`。范围：规格 §3。

完成时可观察：`content/craft/beat-directives.json` 不存在；text-graph 无 `craft-directive`/`style-axis`/`review-rule` 节点；`mods/narration-craft` 1.9.0 带 `style.json`，内容与今天的行逐字相同；`tests/kernel/test_capsule_nine.py test_turn_floor.py test_capsule_module.py` 通过（含四条新用例）；`tests/extension/keeper-prose-contract.test.mjs` 通过，`craft-style-coherence.test.mjs` 已删；契约新节存在，§13.6 与 §34 有指向。

## W4 — 2.0.0 与基底瘦身（lead）

Status: `ready-for-human`（实施完成 2026-09-25，见 Comments）。在集成分支上做，依赖 W1–W3 合入。范围：规格 §6。

## W5 — 真桌验收（lead）

Status: `ready-for-human`（已跑 2026-09-25，见 Comments）。依赖 W4。范围：规格 §7。

## Comments

- 2026-09-25 W1 `330529e50`（+ §30.7f `89fd97391`）、W2 `863775319`、W3 `bb4ed9c91` 合入集成分支；W1 发现删 capability 名会锁死 1.5.0–1.7.1 的旧战役，lead 改为名字留作惰性接受（`88610909b`）。
- 2026-09-25 W4：narration-craft 2.0.0（agent.md / brief.md 968 B / style.json：全量 2015 B、最重 beat 简式 1308 B，按 35 字符语言标签量）；keeper.md 33064 → 30042 B；`repeated_line` 的 fix 文案不再要求人物让步/加码/换话题；定向测试：pytest 九文件 120 过、ext 九文件 201 过。
- 2026-09-25 W5：A（基底 95df22a6d）/B（3d24508de，2.0.0）各 15 回合，同 deepseek-v4.1-flash/low，同 15 句。两位 sonnet 盲读（一致率 0.928）六类缺陷合计 A 12/13 对 B 9/7：回执复述 5/3→2/1、规则复读 2/3→1/1、抽象套式 1/1→0/0、任务提示腔 4/4→4/4（NPC 台词里的去处清单，是 NPC 材料投影的事）、硬译 0/2→2/1、全称重复 0→0。口吻列队 A 35/42 对 B 25/27；B 桌 `voices` 有人在场即非空、say 全部归属到人、无英文名；style 无截断，brief 合计 4928 B。leehow-pc 全套件：ext 2840/2840，pytest 1703 过 2 败（`tests/play/test_driver.py` Linux 收尾，基底同败）。报告 `.coc/playtests/prose-mod-acceptance/REPORT.md`。不宣称文笔达标。
