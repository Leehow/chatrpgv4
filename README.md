# pi-coc v2

COC Keeper for Pi：一个 Pi 包加一个 Python 内核子进程。守秘人只见七个动词：`look`、`lookup`、`recall`、`resolve`、`apply`、`ask`、`narrate`。

- 架构规格：GitHub issue #12。切片票：#13 到 #18。
- 扩展与内核之间的契约：`docs/kernel-rpc.md`（§1–§16）。改契约先于改代码。系统语言英文、玩家语言由守秘人模型按 `play_language` 产出、机制走 JSON 投影：见 `Agents.md`。
- 对 Pi 的依赖与升版流程：`docs/pi-host-contract.md`，不 fork、不打补丁。
- 决策记录：`docs/adr/`。真桌验收方法：`docs/acceptance.md`。

## 布局

```
extensions/   Pi 扩展：kernel（七个工具、回合事务、校验车道）、table（状态行）、memory（记忆抽取车道）、
              module（无人值守构建与按需深读，读者是子 pi 进程）、onboarding（建卡进程的 setup 工具）、lanes（共用）
kernel/coc/   Python 内核包，入口 `python -m coc.rpc`；rules/（十族规则引擎与 RuleGraph 运行时）、modules/（模组存储与车道）
content/      只读内容：rulesets/coc7、starters/<module>、director/、craft/、ontology/、modules/（契约与可玩性模板）、setup/（七步表、读者提示）
prompts/      守秘人与建卡助手的系统提示
scripts/      starter 投影器（IR → 模组图）
bin/          pi-coc（游玩 / setup）、pi-coc-setup（驾驭器用）、coc-evidence 与 coc-review（读者工具）
tests/        kernel（内核接缝）、extension（扩展接缝）、play（驾驭器、KPI、资料包工具）
```

## 运行

```bash
npm install
uv sync --frozen --dev
bin/pi-coc setup                      # 建卡：选 starter 或资料包，建调查员，交桌
bin/pi-coc --campaign <id>            # 开桌
```

## 测试

```bash
uv run --frozen python -m pytest tests/kernel tests/play -q
npm run test:ext
```

真桌验收走 `tests/play/driver.py`，grok 当守秘人，Claude 当玩家，一回合一回；方法见 `docs/acceptance.md`。
