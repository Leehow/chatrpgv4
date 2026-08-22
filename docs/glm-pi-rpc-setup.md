# 在 pi-coc RPC 模式下使用 GLM

最后更新：2026-08-22
适用版本：Pi 0.84.2、COC Keeper 0.6.2a

## 当前结论

GLM 可以作为 pi-coc RPC 的 Keeper 模型。产品入口不是裸 `pi`，而是
`plugins/coc-keeper/pi/bin/pi-coc` 或 Web/Electron 创建的同一 RPC 宿主。
模型必须来自本仓库隔离的 `.pi/coc-agent/models.json`，会话证据中的
`model_change` 才是实际生效路由；UI 选择、命令行意图或 provider 显示名本身
都不能代替该证据。

Web/Electron 的 RPC adapter 会在会话启动和每个回合边界执行 Pi 的
`set_model` / `set_thinking_level`，因此旧文档中“只能手工发送 `set_model`、
`--model` 一定挂起”的结论已经过期。

## 仓库隔离

不要读取或写入 `~/.pi/agent`、`~/.pi/coc-agent` 或其他项目的 `.pi`：

```text
{repo}/.pi/agent      # pi / PipiUI coding
{repo}/.pi/coc-agent  # pi-coc Keeper
```

先确认 `.pi/coc-agent/models.json` 和 `auth.json` 已按本机配置存在。不要把密钥
复制进 campaign、测试证据或提交。

## Web/RPC 启动

产品 Web 桥会为每个 campaign 启动一个 `pi-coc --mode rpc` 子进程：

```bash
node web/server-node/server.mjs --workspace /absolute/test/workspace --port 8765
```

创建会话时明确传 provider、model 和 thinking；下面的 provider 只是示例，
必须替换成当前 `.pi/coc-agent/models.json` 中真实存在且有凭证的条目：

```json
{
  "campaign_id": "fresh-campaign-id",
  "provider": "<configured-glm-provider>",
  "model": "glm-5.2",
  "thinking": "low"
}
```

创建返回后先 attach 并接完自动开桌流，再发送玩家行动。开桌仍在处理时立即发送
输入会得到 `Agent is already processing`；这是正确的并发保护，不应中断宿主或
重建 campaign 来绕过。

## 生效证据

每个验收会话至少保存：

- HTTP session-create 响应与完整 SSE；
- `.pi/coc-agent/sessions/...jsonl` 中的 `model_change` 和
  `thinking_level_change`；
- campaign 的 `logs/table-transcript.jsonl`、`rolls.jsonl`、
  `turn-finalizations.jsonl` 与 `narration-reviews.jsonl`；
- `run.json` 中的 provider/model、`mid_run_switch: false` 和
  `background_model_policy: inherit_parent`；
- canonical exporter 生成的玩家报告与 `artifacts/audit/`。

模型必须在激活前固定。中途切换模型只算 mixed-model 探索证据，不能冒充单模型
验收。

## 路由故障诊断

如果响应提到另一家 provider、图像通道或与所选 GLM 无关的 401/402：

1. 保留失败 SSE 和 Pi session，不删除 campaign；
2. 检查 session 的实际 `model_change`，不要根据 UI 标签猜测；
3. 对照 `.pi/coc-agent/models.json` 的 provider/model 配对；
4. 新建 campaign 和 session，用已配置的 GLM route 重试；不要在失败会话中途
   换路由后把它标成干净验收。

2026-08-22 的合并后实测中，`zhipu` 别名被环境错误送入 Grok Build 并返回
402；配置清单里的 `coding-relay-18890 / glm-5.2` 则完成了两个独立正式回合。
这是本机路由证据，不代表其他安装必须使用同名 provider。

## 验收边界

GLM 必须真的担任 Keeper：自行完成 NPC、规则调用、状态写入、agency review 与
最终叙事。玩家一次发送一句自然回复。批处理、固定脚本、直接修改 save 或手填
战报都不算 Pi-Coc 验收。短 smoke 可以导出 `INCOMPLETE` 报告用于合同验证，
只有自然跑到结构化结局且完整性通过的 fresh run 才能作为完整战役验收。
