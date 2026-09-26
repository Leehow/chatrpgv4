Status: ready-for-human（三处拍板后转 ready-for-agent）
Spec: docs/specs/npc-acts-first.md（D7）

# 06 — KP 侧：提示词、工具说明、否决面

## Scope

- `prompts/keeper.md` 在场段加一句：在场的人这一回合已经做的事在收据里（`present[].history.intents` 与本回合收据），正文写出它；要改结果，用 `apply npc {intent_ref, intent_outcome}` 明写，不许当它没发生。删掉 §138 时加的「spend_turn / first blow」教学句里与书记员默认攻击相关的措辞（现在没有默认攻击）。
- `extensions/kernel/tools.ts`：`intends` 描述加「桌子已替在场的人写过行动时，只在推翻它时再写」；压缩 `IntentResult` 在 10 个 effect 变体里的重复描述（同一句在 schema 里出现 10 次，8.9 KB；改成短句 + 一处长说明），改完过一次真桌（说明文字影响模型用法）。
- 否决面用例：KP 在同一回合写 `intent_outcome: abandoned` + 自己的 `intends` → 两条收据，闸门不拦，下一回合包里两行都在。

## Not in scope

- 文风（prose mod 的事）。

## Acceptance

- ext 用例：KP 否决路径（上述）通过；`long-campaign-context` 的请求字节不高于现在（工具说明压缩后应更低，记数字）。
- 真桌一回合（08 的 C 桌顺带）看 KP 是否按收据写正文；不单独开桌。
