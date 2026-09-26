Status: landed（合入集成分支 claude/npc-as-actor-20260926 @ 46f2a2093，2026-09-26）
Spec: docs/specs/npc-acts-first.md（第九节「C4 桌」）

# 18 — 第二次交付时，纯包装标签剥掉而不是原样放出去

## 证据

C4 T3：KP 的 narrate 正文末尾是 `</text>`（deepseek 把参数用标签包了一层的习惯，工单 11 已查明来源），闸门按 §139.10 拒了一次，KP 重发的稿子**还带着**，第二次按设计照收带 warnings——于是玩家看到了 `</text>`。C3、C4 各一次。模型不会因为一次 steer 改掉这个习惯。

## Scope

- 第二次交付（同一回合、同一形状再来）时，若发现的标记是**纯包装**——只在正文最前或最后、标签之间没有正文（`<text>`…`</text>` 这种成对包裹，或末尾孤零零一个闭合标签），宿主/内核剥掉它再交付，warnings 行照记（`kind: markup_in_prose`, `stripped: true`）。夹在正文中间的标签、markdown 列表行不剥（那是内容，剥了会改稿），仍按现状照收带 finding。
- 判定是语法的（位置 + 成对），不是词表。
- 契约 §139.10 加带日期的注。

## Acceptance

- ext 用例：末尾 `</text>` 两次 → 第二次交付的 `rendered_text` 不含标签，warnings 行有 `stripped: true`；正文中间的 `<b>` 两次 → 原样交付、`stripped` 缺席；工单 11 的既有用例不变。
- 变异：去掉剥离，第一条逮住。
