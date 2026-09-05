# Pi provider thinking notes

Only for the named Pi provider integration. Verify the current provider/model and transmitted parameters; these dated measurements do not select or configure the coding assistant’s model.

Paths and commands below are relative to the repository root unless absolute. Read only this route when the task requires it; it does not expand authorization.

## GLM / Z.AI Thinking Control (measured 2026-09-02)

任何在本仓库里用 GLM（zai / zai-coding-cn）跑 Keeper 回合、造景诊断或长任务
的 agent，先读这一节。**传 `--thinking low` 不会减少思考，等于没省额度。**

Pi 对 `thinkingFormat: "zai"` 的实现（`pi-ai/dist/api/openai-completions.js`）：

```js
thinking = reasoningEffort ? { type: "enabled", clear_thinking: false }
                           : { type: "disabled" }
```

`reasoningEffort` 只要有值（`low` 也算）就走 **enabled** 分支。Z.AI 官方文档里
关闭思考的唯一参数是 `thinking: {"type": "disabled"}`，对应 Pi 的
**`--thinking off`**。

同一条造景 lane、同一个 180 秒预算的实测：

| 配置 | 思考字符 | 工具调用 |
| --- | --- | --- |
| glm-5.3 + `low` | 26,818 | 2 |
| glm-5.2 + `low` | 26,977 | 5 |
| **glm-5.2 + `off`** | **4,076** | **13** |

推理量降到 1/6.6，可用的工具调用翻 2.6 倍。

**模型差异（Z.AI 官方文档）**：**GLM-5.3 与 GLM-5.3-FLASH 是强制思考，无法
关闭**；GLM-5.2、GLM-5.1、GLM-5、GLM-4.7 及更早可以关。所以省额度要用 5.2，
不要用 5.3——5.3 无论怎么设都会烧掉那两万多字符。
`models-store.json` 里五个模型只有 `glm-5.2` 的
`compat.supportsReasoningEffort` 为 `true`。

**边界**：`thinking off` 只解决「单次思考太长」，不解决「一个回合往返太多次」。
glm-5.2 + off 那条 lane 仍然把预算花在四次 `transcript.locate` 和四次
`discover` 上，回合没跑完。两者是不同的问题，别用前者的结论掩盖后者。

来源：<https://docs.z.ai/guides/capabilities/thinking-mode>

### xAI / Grok：同一类问题的另一面（2026-09-05 接入）

GLM 的坑是「传了 `low` 等于没关」。xAI 的坑方向相反：**不传就直接被拒**。

Grok 4.5/4.6 的推理同样关不掉。没有显式 effort 时 pi-ai 发通用的关闭值
`none`，而 **xAI 在推理开始前就拒绝这个值**——不是回答质量差，是整个调用失败。
所以 `state-claim-compiler` 对 `provider === "xai"` 且走 `openai-responses`
的模型显式发 `reasoningEffort: "low"`（xAI 支持的最省档位，够这段有界的语义
编译用）。注册表漏标 reasoning 能力时按 model id 认 `grok-4.5` / `grok-4.6`。

同一处还把 `stopReason === "error"` 变成抛出。在此之前 provider 报错是**静默**
的，编译器拿着一个空回答继续走。

### 校验过的默认 thinking 现在真的传下去了

`pi-coc-thinking-preflight.mjs` 一直在校验默认 thinking 级别，但**外层脚本
从不接住它的结论**。结果是某些 Pi RPC 启动会自己初始化到 `off`，尽管仓库设置
选的是另一个已校验的非 off 默认值。现在 wrapper 捕获 preflight 的输出并显式
传 `--thinking`。命令行或 model 后缀里的显式选择仍然归用户参数所有。

这条要和上面的表一起读：**在它修好之前，「我设了 off」和「它自己变成 off」
在现象上无法区分**，而两者对额度的结论完全不同。
