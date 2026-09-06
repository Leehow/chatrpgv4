# pi-coc v2

COC Keeper for Pi：一个 Pi 包加一个 Python 内核子进程。守秘人只见七个动词：`look`、`lookup`、`recall`、`resolve`、`apply`、`ask`、`narrate`。

- 架构规格：GitHub issue #12。切片票：#13 到 #18。
- 扩展与内核之间的契约：`docs/kernel-rpc.md`。
- 对 Pi 的依赖与升版流程：`docs/pi-host-contract.md`，不 fork、不打补丁。

## 布局

```
extensions/   Pi 扩展：kernel（七个工具、回合事务）、table（HUD 与欢迎）、onboarding、module、memory
kernel/coc/   Python 内核包，入口 `python -m coc.rpc`
content/      只读内容：rulesets/coc7、starters/<module>
prompts/      守秘人系统提示
tests/        kernel（内核接缝）、extension（扩展接缝）、play（真桌驾驭器）
bin/pi-coc    启动器
```

## 运行

```bash
npm install
uv sync --frozen --dev
bin/pi-coc --campaign <id>
```

## 测试

```bash
uv run --frozen python -m pytest tests/kernel -q
npm run test:ext
```

真桌验收走 `tests/play/driver.py`，grok 当守秘人，Claude 当玩家，一回合一回。
