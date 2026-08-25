# 战役历史 Git 化（slice1：finalize 即 commit）

> **Status:** Implemented — sidecar git history is the sole campaign history store.
> **ID:** `campaign-git-history`
> **Scope:** 共享内核战役历史、崩溃恢复、以及战报 state 完整性证明（`plugins/coc-keeper`）。
> **Tracks:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc` — Codex 轨 off-limits。共享内核改动已获该计划的跨轨显式授权，范围仅限本 spec。
> **Decision record:** [ADR 0001](../adr/0001-campaign-git-history.md)
> **Template:** Problem / Solution / Implementation Decisions / Testing / Out of Scope

---

## 1. Problem

Historical: 每次 `turn.finalize` 用 `copytree` 把 `save/` 复制到
`save/commit-snapshots/<finalization-id>/`：无去重、无 rotation、无提交图。
历史与 receipt 只有命名约定绑定，崩溃恢复与取证没有单一读取路径。

Success looks like: 每个已结算回合在交付前留下一枚带机读 trailer 的 git
commit；恢复只回写旧 copytree 捕获的 `save/` 子集；verify 脚本能证明
trailer 与 `logs/turn-finalizations.jsonl` 1:1。

Hollow delivery would be: 保留 copytree 双读、把 git 做成通用 Agent memory
DB、或异步提交留下「已结算未提交」窗口。

---

## 2. Solution

每个战役一个 sidecar **bare** git 仓库：

`.coc/repos/campaigns/<campaign-id>.git`

战役目录是 worktree，战役树内不放 `.git`。

唯一写者是 **Commit Coordinator**
（`plugins/coc-keeper/scripts/coc_git_history.py`）：全部 git 写操作经
subprocess 调 git 二进制；任何 Agent / 其它脚本不得直接写战役仓库。

`turn.finalize` 在全部 canonical 写入完成之后、交付之前**同步**调用
Coordinator 提交。Those writes include the wrapper's pending-turn cleanup,
source-cursor/manifest completion, and continuation checkpoint; those writes
and the Git commit share one exclusive campaign lock. The Git commit is the
last step of the `turn.finalize` wrapper, not an inner step of the receipt
builder. A new turn commit is refused while `save/pending-turn.json` exists.
commit 失败 = finalize 失败（与旧 copytree 失败语义对等，fail-closed）。git 历史**替代** `commit-snapshots` 目录复制，成为崩溃恢复与
取证的唯一读取路径（single reader，无双读）。

在途战役遗留的 `save/commit-snapshots/`：不导入、不读取、不删除。

---

## 3. Implementation Decisions

### 3.1 Coordinator 公开面

| 操作 | 语义 |
| --- | --- |
| `ensure_repo(root, campaign_id)` | 幂等创建 sidecar bare repo，刷新 `info/exclude`。对象库损坏时把原仓库改名保留为证据，再以带 `COC-History-Reset` trailer 的 baseline 重初始化。 |
| `commit_baseline(root, campaign_id, *, schema_generation, note)` | 战役创建时的一次性 baseline。已有 HEAD 则原样返回，不回填历史。 |
| `commit_finalized_turn(...)` | 一回合一提交。同一 `Finalization-Id` 重放返回已有 SHA，不产生重复 commit。不同 finalization 即使无 diff 也 `--allow-empty` 落盘。 |
| `restore_save_subset(root, campaign_id)` | 从 HEAD 的 **turn** commit checkout 旧 copytree 捕获的 `save/` 子集。HEAD 不是 turn commit 或无仓库时返回 `None`，不整树回滚。 |
| `remove_repo(root, campaign_id)` | 只删 sidecar 仓库，永不碰战役 worktree。 |

路径辅助：`repo_path_for` / `worktree_path_for`。二者一律返回**绝对**
路径：git 子进程以 worktree 为 cwd，root 相对时 `--git-dir` 会按错误
cwd 解析并报 `not a git repository`。trailer 解析走
`parse_trailers`（`git interpret-trailers --parse`）。schema 代际字符串由
`format_schema_generation` 按当前 `campaign/world/pacing/investigator`
版本渲染，例如 `campaign-3/world-2/pacing-1/investigator-1`。

分支名固定 `main`。时间线分支 / tag / 玩家可见 UX 不在本切片。

### 3.2 提交 trailer（机读）

baseline：`COC-Commit-Type: baseline`、`Campaign-Id`、`Timeline-Id: tl-main`、
`Schema-Generation`；损坏重建时另加 `COC-History-Reset`。

turn：`COC-Commit-Type: turn`、`Campaign-Id`、`Timeline-Id`、`Turn-Number`、
`Finalization-Id`、`Journal-Decision-Id`、`Settlement-Snapshot-Id`、
`Rendered-Text-SHA256`、`Schema-Generation`。

trailer 值与 subject 一律净化为单行（≤200 字符）：多行 git stderr
不得注入伪 trailer。

### 3.3 追踪面与忽略面

追踪：`campaign.json`、`party.json`、`save/`（除忽略项）、`logs/` 下
canonical JSONL、`memory/`、scenario 绑定清单。

忽略面是单一事实源常量 `IGNORE_PATHS`，写入 bare repo 的 `info/exclude`，
**不**在战役目录落 `.gitignore`：

- `logs/pending-turns/`
- `save/session-state.json`
- `save/toolbox-ledger.json`
- `save/commit-snapshots/`
- `save/development-settlements/`
- `save/roll-operation-receipts.json`
- `save/run-identity.lock`
- `memory/index.json`

### 3.4 恢复子集（独立于忽略面）

`RESTORE_SAVE_EXCLUDES` 决定恢复时**绝不可回写**的 `save/` 子项：

`commit-snapshots`、`development-settlements`、`session-state.json`、
`toolbox-ledger.json`、`roll-operation-receipts.json`。

幂等簿记（尤其 `toolbox-ledger.json`）回滚会破坏 `decision_id` 语义。
忽略清单与恢复子集是两个独立清单。

### 3.5 错误语义

| 情况 | 行为 |
| --- | --- |
| git 二进制缺失 | 战役创建与 finalize 明确硬失败，无降级。 |
| 陈旧 `index.lock` | 清理后重试一次；再失败即硬失败。 |
| 对象库损坏 | 原仓库改名保留为证据（不得删除任何战役文件），以带 `COC-History-Reset` 的 baseline 重初始化。 |
| git-dir 路径解析失败（含 `not a git repository`） | **不是**损坏：硬失败，不触发改名/重置。 |

`campaign.quick_start` 在发布完成后落同款 baseline；发布点之后失败不回滚
（与 compiled archive 同级 maintenance），记 warning，历史由首次 turn
commit 兜底（`commit_finalized_turn` 会先 `ensure_repo`）。

git 调用不得依赖用户全局 config：固定
`user.name=coc-keeper` / `user.email=coc-keeper@localhost` /
`commit.gpgsign=false`，并隔离 `GIT_CONFIG_*`。干净 HOME 下也必须可提交。

零依赖变化：纯 subprocess + 标准库；不动 `pyproject.toml` / `uv.lock` /
`.python-version`。

### 3.6 退役

删除 finalize copytree 与目录型恢复。`commit-snapshots/` 的运行时写/读/
恢复路径迁到 Coordinator。遗留 `save/commit-snapshots/` 仍是 ignore-face：
不导入、不读取、不删除，也不得作为战报 state 证明。

Historical (slice1): 导出器暂不改读 git。That deferral is closed. The
canonical exporter now consumes the structured proof below and never the
retired snapshot directory.

### 3.7 Structured state integrity proof

Read-only library API:
`coc_git_history_verify.state_integrity_proof(root, campaign_id, expected_finalization_id=..., valid_finalization_ids=...).to_dict()`.
Do not parse CLI prose. Status is exactly `PASS` | `FAIL` | `NOT_PROVEN`.

Major `to_dict()` fields: `status`, `campaign_id`, `history_enabled`,
`history_valid`, `repo_present`, `repo_healthy`, `git_available`, `fsck_ok`,
`repo_path`, `worktree_path`, `head` (sha / commit_type / finalization_id /
turn_number / trailers), `latest_receipt` (finalization_id / commit_sha /
paired), `expected_head_sha`, `head_matches_latest_receipt`,
`later_non_turn_commit`, `counts`, `tree` (clean / canonical_paths_present /
dirty_paths / missing_paths / drifted_paths), `history_reset`, `findings`
(`code`, `detail`, optional sha / finalization_id / path).

`PASS` requires a healthy sidecar, `fsck --strict`, HEAD as the turn commit
for the latest valid receipt, 1:1 receipt/commit pairing, and a clean tracked
tree matching the campaign worktree. The tree proof checks only the bounded
authoritative subset — `campaign.json`, `save/world-state.json`,
`logs/turn-finalizations.jsonl` (after the first finalized turn), and the
non-ignored `save/` prefix. Other tracked paths (e.g. `logs/rolls.jsonl`,
`memory/`) are committed but not drift-checked by this proof. `FAIL` is a
contradiction or corruption
(wrong HEAD, unpaired receipts, hash drift, dirty authoritative paths,
committed `save/pending-turn.json`, `repo_not_git`, `fsck_failed`). A
worktree-only pending turn is not this finding; it follows the ordinary dirty
authoritative-path contract. `NOT_PROVEN` is missing evidence: no sidecar,
unsafe/missing campaign path, git unavailable, baseline-only, or a later
`COC-History-Reset` trailer. A reset-explained later non-turn commit is
permitted as the reset explanation and still `NOT_PROVEN`; it never upgrades
to `PASS`. An unexplained later non-turn commit is `FAIL`.

The battle-report exporter maps that status 1:1 onto the `state` dimension.
Player evidence schema 8 carries only the bounded `state_integrity`
projection; audit schema 2 carries the full `git_history` proof.

---

## 4. Testing

- 夹具只用 `tmp_path`。**绝不得**删除或修改任何现存战役、playtest 证据、
  `.coc/campaigns/` 下真实数据。
- 本切片不改 state 写入协议；只在 finalize 之后加提交。不得手工编辑 live save。
- 规则 JSON 未改则不跑 rulebook audit；`tests/test_plugin_metadata.py` 必跑。
- 只读诊断（比照 `coc_pdf_bundle.py`）：

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_git_history_verify.py --root . --campaign <id>
```

  校验 `git fsck`、trailer 完整性、schema 代际、以及 turn commit 与
  `logs/turn-finalizations.jsonl` 的 1:1。只报告不修复。零 turn commit 且零
  receipt 时显式失败（exit 2），拒绝空通过。

验收：pi-coc RPC 真实跑团必须使用 exact-current-schema 新战役。
`state_integrity_proof` 为 `PASS`，导出器 `state` 维度为 `PASS`，且不得把
遗留 `commit-snapshots` 或 harness `run.json` 当作证明。`NOT_PROVEN` 与
`FAIL` 必须保持可区分并令战报 `INCOMPLETE`。历史战报只读；无迁移、无双读。
证据保留。

---

## 5. Out of Scope

玩家 / KP 可见的任何变化；回档 / 分支 / 比较 UI；memory 与 commit 绑定；
语义索引；proposal branch / CAS / delivered ref；双仓库投影；Codex 轨与
pi-coc host 适配（`pi/`、launcher、session-roles）；LFS / 资产存储。
