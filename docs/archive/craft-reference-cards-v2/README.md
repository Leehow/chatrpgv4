# 表达方法卡 v2（已退役的归档）

这里是 Narration Craft 1.5.0–1.7.1 里 Jev 选卡机制用过的两份数据，2026-09-25 随机制一起退役，从运行时拿掉，原字节存档在此。

| 文件 | 是什么 |
| --- | --- |
| `cards.en.json` | 48 张英文方法卡，8 族（exchange、voice、dialogue、sensory、horror、rhythm、memory、action）各 6 张。与 1.7.1 包里的同名文件逐字节相同（sha256 `d27815d0…dad9f7a2`）。 |
| `starter-ids.json` | 1.7.1 的候选表：每回合 Jev 只在这 12 个 id 里选一张或 `NONE`。 |

这两份不在任何包的 `package_files` 里，内核与宿主都不读它们。改这里的字节不会影响任何一局。

## 为什么退役

用户 2026-09-25 裁定，见 [`docs/specs/prose-mod.md`](../../specs/prose-mod.md) §1、§2.3、§5；契约记录在 `docs/kernel-rpc.md` §30.7f。

量出来是零收益：

- **对照评测都是平手。** `.coc/evaluations/craft-reference-20260924/RESULTS.md`：B/A 3:2:1，C/B 2:2:2；`d-v3/REPORT.md`：接真实 Jev 的 D 组 2:2:2。
- **合入后的真桌也一样。** `luna-prose-quality-zhhans2-20260926` 共 20 回合，19 回合的参考确实进了真实出站请求，读者仍列出同样的缺陷。
- **还有代价。** 每次玩家输入，选卡在 compose 步的投影路径上多花 240–520 ms。

证据目录在主检出的 `.coc/` 下，不进 git，也不要删。

## 以后还能怎么用

卡片的**结构**可以留给将来的示范（exemplar）设计复用：一个具体场合（`context`），同一场合的几种写法（`acceptable` / `stronger` / `alternative`），一条差一点的反例和它错在哪（`nearMiss` / `diagnosis`），再加上适用与不适用的条件（`useWhen` / `avoidWhen`）。原来的宿主只把 `id`、`title`、`purpose`、`useWhen`、`avoidWhen`、`context`、`acceptable`、`stronger`、`alternative`、`elaboration` 给守秘人看，`nearMiss`、`diagnosis`、`boundaryContext`、`boundaryText`、`why` 只留给评审。

复用前要知道三件事：

1. 这批卡的例句是编辑自拟的英文（`examplesOrigin: "original_editorial_fixture"`），没经过真人校准（`validationStatus: "not_human_calibrated"`）。`sourceStudyIds`（`LIT-xx`、`MOD-xx`）指向的来源研究不在仓库里。
2. 退役的是「每回合让 Jev 选一张卡注到请求里」这个机制，不是卡片形状本身。新设计不应恢复每回合选卡。
3. 用玩家语言写整段示范受契约 §16.1 与 2026-09-09 的 i18n 裁定约束，要另开 spec（prose-mod §2.5）。

被删的代码（`runtime/craft/`、`runtime/jev/craft-reference-domain.ts`、`extensions/table/craft-reference.ts`、`extensions/table/craft-runtime.ts`、`kernel-ts/mods/craft-package.ts`、`kernel-ts/mods/craft-reference.ts`）在 git 历史里，最后一版是 `95df22a6d`。
