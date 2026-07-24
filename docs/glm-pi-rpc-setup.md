# 在 pi-coc RPC 模式下使用 GLM 模型

## 关键结论

**GLM 系列模型（zai-coding-cn/glm-5-turbo、glm-5.2 等）可以在 pi 的 RPC 模式下使用**，但必须用 `set_model` RPC 命令切换模型，**不能用 `--model` 命令行参数**。

## 错误用法（不工作）

```bash
# ❌ 这样启动 RPC + glm 模型，assistant 消息不会返回
pi --mode rpc --no-session --model "zai-coding-cn/glm-5-turbo"
```

用 `--model` 启动时，pi 的 prompt 请求会被接受（`success: true`），但
assistant 消息永远不会返回。原因不明（可能是 pi 在启动时通过命令行参数
选模型走的是不同的初始化路径，与 zai-coding-cn 的 API 不兼容）。

## 正确用法（工作）

```bash
# ✅ 启动时不带 --model，连上后用 set_model 切换
pi --mode rpc --no-session
```

连上后发送 `set_model` RPC 命令：

```jsonl
{"id":"m1","type":"set_model","provider":"zai-coding-cn","modelId":"glm-5-turbo"}
```

收到 `{"id":"m1","type":"response","command":"set_model","success":true}` 后，
再发 prompt 就能正常收到 assistant 响应。

这个方法来自 pipiui 项目（`/Users/haoli/leehow/code/pipiui`，Swift 原生
macOS 应用），它在 `ChatSession.swift:1445` 用 `set_model` 动态切换模型。

## Python 驱动示例

```python
import subprocess, json, threading, queue, time, os

proc = subprocess.Popen(
    ["pi", "--no-builtin-tools", "--approve", "--no-context-files",
     "--append-system-prompt", "plugins/coc-keeper/pi/prompts/host-system.md",
     "--mode", "rpc", "--no-session"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    text=True, bufsize=1,
    env={**os.environ, "PI_CODING_AGENT_DIR": os.path.expanduser("~/.pi/coc-agent")}
)

def send(obj):
    proc.stdin.write(json.dumps(obj, ensure_ascii=False) + "\n")
    proc.stdin.flush()

time.sleep(6)  # 等 MCP 预热

# 1. 切模型
send({"id": "m1", "type": "set_model",
      "provider": "zai-coding-cn", "modelId": "glm-5-turbo"})
time.sleep(2)

# 2. 发 prompt
send({"id": "p1", "type": "prompt", "message": "用一句话确认就绪"})

# 3. 读响应（assistant 内容在 message_update/message_end 事件里）
for line in proc.stdout:
    ev = json.loads(line)
    msg = ev.get("message", {})
    if msg.get("role") == "assistant" and ev.get("type") == "message_end":
        content = msg.get("content", "")
        # content 可能是 string 或 [{type:"text", text:"..."}]
        if isinstance(content, list):
            text = "".join(p.get("text","") for p in content
                           if isinstance(p, dict) and p.get("type") == "text")
        else:
            text = content
        print(f"KP: {text}")
        break
    if ev.get("type") == "agent_settled":
        break
```

## 可用的 GLM 模型

```
zai-coding-cn   glm-5-turbo     200K   131K   yes   no
zai-coding-cn   glm-5.1         200K   131K   yes   no
zai-coding-cn   glm-5.2           1M   131K   yes   no
```

## JellyToken 模型

JellyToken（`https://aiservice.jellytoken.com/v1`）也可以配成 pi provider，
但同样需要 `set_model` 方式（不能用 `--model`）。配置方式见
`~/.pi/coc-agent/models.json` 的 `providers` 字段。

## 注意事项

- `set_model` 是必须的——即使你在 `settings.json` 里设了 `defaultProvider`
  和 `defaultModel`，RPC 模式下仍然需要显式 `set_model`。
- `--thinking off` 不是必须的（zai-coding-cn 的 thinkingFormat=zai 会自动
  处理 reasoning），但如果不传 `--thinking`，glm 默认会思考（reasoning_content）。
- glm-5-turbo 比 grok-4.5 慢（~400s/开局 vs ~250s），但能作为 grok 限流时的替代。
