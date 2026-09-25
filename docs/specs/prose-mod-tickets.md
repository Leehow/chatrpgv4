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

Status: `ready-for-human`。在集成分支上做，依赖 W1–W3 合入。范围：规格 §6。

## W5 — 真桌验收（lead）

Status: `ready-for-human`。依赖 W4。范围：规格 §7。

## Comments
