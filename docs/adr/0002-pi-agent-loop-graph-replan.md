# 0002. 在 Pi 顺序工具批次加入 working-set replan

- Status: **Superseded**（2026-09-05，规格 #12）
- Track: pi-coc v2

## 原决策（2026-08-30）

旧树的模型可见工具面随 role、phase、stage、图谱 affordance 与已加载 operation 投影而变形；一个工具完成后 working set 可能已变，Pi 0.84.2 仍会执行同一助手消息里余下的旧调用。旧树因此给 Pi 两个包打补丁，加了 `replan` 信号：完成工具返回它后，余下调用不执行并各得一条 `not_executed` 的工具结果。

## 为什么废止

v2 的工具面在游玩期间是静态的：守秘人只见七个动词（契约 §5），不再变形，也就没有「批次中途失效」这件事。唯一保留的批次控制是契约 §8 的 `tool_call` 闸门——`narrate` 成功后同一批次余下的调用一律拦下并说明回合已关，这是扩展 API 本来就有的能力，不需要补丁。

## 后果

- 对 Pi 不 fork、不打补丁；依赖以文档契约表达（`docs/pi-host-contract.md`），升版按其第 7 节核对。
- 旧树的三项补丁（replan、provider message transform、tool result `isError`）在 0.85.1 上全部不再需要（host contract 版本日志）。
