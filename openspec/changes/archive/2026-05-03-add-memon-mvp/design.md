## Context

研究项目里 `logs/` 目录存放每个实验的产物,目录命名约定 `<name>-<yymmdd>-<hhmmss>`,内部包含训练日志、checkpoints、可能的子产物。该目录可能位于项目根的任意深度(`/mnt/p/logs/foo-...` 或 `/mnt/p/sub/sub2/logs/foo-...`)。已有约定:每个实验目录里维护一个 markdown 文档描述 motivation/method/result/...,部分实验绑定 WandB run。

历史上这些文档由人或 agent 各自维护,缺乏:(1) 统一 schema,(2) 索引层,(3) 跨实验/假说的关联视图,(4) 并发编辑安全。集群环境对 inotify watcher 数量有硬上限,跨进程文件协调不能依赖 fs watch。

本 design 描述 `memon` 这个工具如何在不引入数据库、不破坏现有 logs 目录布局的前提下,以**文件系统作为单一 source of truth**,提供面向人(响应式 web)和面向 agent(JSON 输出 CLI)两种界面。

## Goals / Non-Goals

**Goals:**
- 单用户、本地运行、零外部依赖(无 DB / 无 broker / 无 fs watcher)
- 任何人 `git clone && cp config.example.yml config.yml && pnpm dev` 即可看到 mock 数据起站
- 实验目录扫描 / README 解析 / 假说交叉引用全部从文件系统派生,关闭 memon 后数据完整可读
- 编辑 README 在前后端两处发起(web 编辑器 + agent 写入)时不会静默覆盖
- 大日志(几 GB)也能秒开 tail,前端无限滚动到文件头
- CLI 输出对 agent 友好(默认 JSON,人类需要时 `--format human`)

**Non-Goals(MVP 显式排除):**
- Claude Skill 包设计(等系统稳定后再做,暂用 mock 数据驱动开发)
- 多机 / SLURM agent / 跨主机进程感知
- 嵌入式 web terminal(在 web 内启动 Claude Code/Codex)
- GPU/磁盘实时监控(后端 API 留 hook 位返回 null,前端 UI 留折叠区块,本期不实现)
- WandB iframe 嵌入(只跳转 URL)
- 旧实验目录一次性导入工具
- 多用户认证 / RBAC
- 跨项目搜索(MVP 只支持单 project 内,多 project 切换由前端 tab/dropdown 处理)

## Decisions

### D1. 文件系统作为唯一 source of truth(不引入 DB)

**选择**:实验数据 = `<project_root>/<...>/<exp-id>/README.md` + 同目录下文件;假说 = `<project_root>/HYPOTHESES.md`;事件流 = `<project_root>/JOURNAL.md`。后端启动时扫描配置的 project roots,在内存里建索引;轮询发现变化时增量更新索引。

**理由**:
- 关闭 memon 后,所有数据仍是普通 markdown,人可以直接读、可以 grep、可以 git diff
- agent 写 README 不需要走 memon API,直接 `Edit` 工具改文件即可,memon 只负责索引
- 无需迁移工具,不存在"数据库与文件不一致"的状态

**备选(不采纳)**:SQLite 索引层 — 增加状态同步复杂度,且 mock 数据的"clone 即用"体验受损

### D2. 轮询 + 指数退避(禁用 fs watcher)

**选择**:每个被关注的目录维护一个轮询周期(初始 1s,无变化则 ×2,上限 5min);后端 worker 在事件循环里调度。

**理由**:
- 集群上 inotify 数量有限制,递归 watch 几十个项目会爆
- 退避后冷数据不消耗 CPU(几十个静态实验目录每 5 分钟 stat 一次成本可忽略)
- 用户主动操作(打开实验详情、编辑 README)立即重置该目录退避,体验近实时

**备选(不采纳)**:`chokidar`/原生 watcher — inotify 限制问题;依赖 polling fallback 又走回轮询

### D3. 实验目录发现规则

**选择**:目录名匹配正则 `^.+-\d{6}-\d{6}$` 即视为实验目录,无视父目录是否叫 `logs`;扫描时应用 exclude 默认 + config 自定义。

**理由**:用户的 logs 目录嵌套形式不固定,父目录约定(`logs/`)不可靠。目录名格式是用户脚本生成时的稳定约定。

**备选(不采纳)**:依赖父目录名 `logs/` — 用户实际场景中存在 `logs/sub/<exp-id>` 形式;需要 README.md 才识别 — 实验启动后 README 可能尚未生成,会被漏

### D4. 实验状态:5 态 enum 由 agent 维护,前端可改

**选择**:`PENDING` / `RUNNING` / `FINISHED` / `FAILED` / `UNKNOWN`,front matter `status` 字段;前端编辑 = 写 README front matter + JOURNAL.md 追加 `[STATUS]` 事件,两步原子(失败回滚)。

**理由**:用户明确不希望强行用 PID 或 mtime 推断状态(有些实验根本无 PID,有些 RUNNING→stale 是预期的)。Agent 是最了解实验真实状态的执行者。
- "stale RUNNING"(`status=RUNNING` 且 mtime 长时间无变化)前端显示 `⚠`,不强制改 status,用户决定

### D5. README schema(YAML front matter + 8 章节)

```yaml
---
id: <auto = directory name>
name: <human readable>
project: <project name from config>
status: PENDING | RUNNING | FINISHED | FAILED | UNKNOWN
created_at: <ISO8601 + offset>
finished_at: <ISO8601 + offset> | null
host: <hostname>            # optional
pid: <int>                  # optional, fallback if absent
gpus: [<int>, ...]          # optional
entry: <relative path to launch script>
command: <full command line>
wandb: <url>                # optional
hypotheses: [H0001, H0003, ...]   # related hypothesis IDs (no judgment)
tags: [<str>, ...]
---

## Motivation
## Setup
## Method
## Result
## Conclusion
## Caveats
## Artifacts
- `./checkpoints/` — <description>
- `./outputs/loss.csv` — <description>
## New Hypotheses          # optional, triggers digest into HYPOTHESES.md
```

**理由**:`hypotheses` 字段只记关联,**不预设 verified/refuted**;判断由 agent 在 digest 时基于完整 README 内容写到 HYPOTHESES.md。`Artifacts` 用相对路径键值对替代之前的 front matter `disk_paths`(更可读、更易扩展)。

### D6. HYPOTHESES.md schema

文件位置:`<project_root>/HYPOTHESES.md`(复数)。

```markdown
## Status legend

| Symbol | Status      |
| :---:  | ---         |
| ✅     | CONFIRMED   |
| ❌     | REFUTED     |
| 🟡     | PARTIAL     |
| 🔵     | OPEN        |
| ⚪     | DEFERRED    |

## Summary table

| ID  | Statement | Status | Experiments |
| :-: | ---       | :-:    | ---         |
| H0001  | ...       | ✅     | foo-260501-100000, bar-260502-150000 |

## H0001. <slug>
- **Statement**: ...
- **Origin**: ...
- **Status**: ✅ CONFIRMED
- **Experiments**: foo-260501-100000 (data) → bar-260502-150000 (analysis)
- **Evidence**: ...
- **Caveats**: ...
- **Last verified**: <YYYY-MM-DD>
```

**关联方式**:用日志目录名作为索引(不再是 E1/E2)。Summary table 由 agent 维护(MVP 不做自动生成)。

### D7. JOURNAL.md schema

```markdown
---
last_digest_at: <ISO8601 + offset>
---

- 2026-05-03T08:28:00+08:00 [CREATE]   `foo-260503-082800` PENDING
- 2026-05-03T08:30:15+08:00 [STATUS]   `foo-260503-082800` PENDING → RUNNING
- 2026-05-03T09:45:00+08:00 [STATUS]   `foo-260503-082800` RUNNING → FINISHED
- 2026-05-03T10:15:00+08:00 [NOTE]     `foo-260503-082800` converged faster than expected
- 2026-05-03T11:00:00+08:00 [REQUEST]  please summarize experiments related to H0007
```

**事件 tag**(可扩展):`[CREATE]` / `[STATUS]` / `[NOTE]` / `[REQUEST]` / `[ARCHIVE]` / `[ERROR]`。

**写入者**:CLI(`memon new` / 状态变更命令)、web 前端(用户手动编辑 status / 加 note)、agent(任何 README 写入伴随 JOURNAL append)。

**digest 协议**:digest agent 只读 `last_digest_at` 之后的行,整理完更新 frontmatter。`last_digest_at` 不能被普通写入者改动。

### D8. README 编辑并发控制:mtime 乐观锁 + localStorage 草稿

**写入流程**:
1. 前端打开 README 时取 `mtime + content`,缓存到组件 state
2. 编辑期间内容实时存 localStorage(key = `<path>:<mtime>`)
3. 保存 `PUT /api/readme` 携带 `expectedMtime`
4. 后端比较磁盘 mtime:相等 → 写入 + 返回新 mtime;不等 → 返回 `409 + 当前磁盘内容`
5. 前端收到 409 → 显示 diff 对比 + 用户决断(保留我的 / 接受远端 / 手动合并)

**重新打开同一文件**:
- 若 localStorage 有该 path 当时 mtime 的草稿 → 弹"你有 N 分钟前的未保存草稿,**恢复 / 放弃从磁盘重读**"
- 若 mtime 已变 → 自动放弃草稿(基础已变),显示"自上次编辑后磁盘已变"

**不在 fs 层面加锁**:agent 自己负责并发控制(`memon-update-readme` skill 后期会规定 agent 也走同一 PUT 协议)。

### D9. Log tail 高性能方案:LineIndex + SSE

**LineIndex**(每文件):
- 维护 `lineNumber → byteOffset` 数组(稀疏,每 N 行一个锚点 + 锚点之间扫描)
- 首次访问:流式扫描整个文件建索引(几 GB 1-2s,可显示进度)
- 文件 append:从最后一个锚点之后增量索引
- LRU 内存缓存 + 可选磁盘持久化(`~/.cache/memon/lineindex/<sha1>.bin`)

**API**:
- `GET /api/log?path=X&endLine=N&count=100` → 区间 `[N-99..N]` 带绝对行号
- `GET /api/log/stream?path=X` → SSE,文件 mtime 变化时推增量行

**前端行为**:
- 默认拉最后 100 行,SSE 自动跟随 append
- 用户向上滚到顶 → 拉前 100 行 + 退出跟随模式
- 用户滚回底 → 自动恢复跟随

### D10. 配置:项目内 config.yml(开发期)

```yaml
projects:
  - name: fsdp-comm
    root: ./mock/project-a
    include: ["**"]            # 默认 ** 全包含
    exclude:                   # 默认排除 + 用户追加
      - .git
      - node_modules
      - __pycache__
      - .venv
      - venv
      - .cache
poll:
  min_interval_ms: 1000
  max_interval_ms: 300000
  backoff_factor: 2
```

`<repo>/config.yml` gitignored;`<repo>/config.example.yml` 提交,指向 `./mock/...`。CLI 默认在 cwd 找 `config.yml`,`--config <path>` 覆盖;无 `--config` 又找不到默认时,CLI 工具(非 serve)以 cwd 作单 project 模式跑。

### D11. 仓库结构:pnpm monorepo

```
<repo>/
  apps/web/                    # Next.js 15 App Router
  packages/core/               # schema、解析、索引、轮询、LineIndex 等共享代码
  packages/cli/                # memon CLI(consumes core)
  mock/                        # mock 数据,git tracked
  config.example.yml           # 提交,指向 mock/
  config.yml                   # gitignored
  package.json                 # workspace root
  pnpm-workspace.yaml
  tsconfig.base.json
```

**理由**:CLI 和 web 后端共享 schema/解析/索引逻辑;放 monorepo 避免发版本时的循环依赖,本地开发 `pnpm` 自动 link。

### D12. 时区

- 所有时间戳 ISO8601 + 时区 offset(`2026-05-03T08:28:00+08:00`)
- 写入端按本机时区生成
- 渲染端按浏览器时区显示(date-fns-tz)
- 接受可见的"未来实验"问题(浏览器时区 < 写入端时区时)

### D13. 前端框架与库选型

| 用途 | 选型 |
|---|---|
| 框架 | Next.js 15 App Router + TypeScript |
| UI | shadcn/ui(代码 own,基于 Radix + Tailwind) |
| 样式 | Tailwind CSS v4 |
| Server state / 轮询 | TanStack Query(`refetchInterval` 函数式 → 实现指数退避) |
| Table | TanStack Table |
| Markdown 编辑 | @uiw/react-md-editor |
| Markdown 渲染 | react-markdown + remark-gfm + rehype-highlight |
| Diff 视图 | react-diff-viewer-continued |
| 时间 | date-fns + date-fns-tz |
| 表单 | react-hook-form + zod |
| 图标 | lucide-react |
| Toast | sonner |

**后端**:Next.js Route Handler + gray-matter + fast-glob + js-yaml + zod + 原生 ReadableStream(SSE)。

**工程**:pnpm + Biome(lint/format)+ vitest + lefthook;Playwright E2E 列为 P1。

## Risks / Trade-offs

- **轮询延迟**:用户在 shell 中改 README 后,web 看到变更最慢可能 5min — 缓解:web 打开实验详情页时立即重置该目录的退避到 min interval
- **大日志首次 LineIndex 扫描**:几 GB 文件首次打开 1-2s 卡顿 — 缓解:进度条 + 后台预热(列表项被点击进入时提前开扫)+ 磁盘缓存
- **mtime 精度**:某些 fs(NFS)mtime 精度只到秒,同秒内多次写入可能漏冲突检测 — 缓解:配合 content hash 双重校验(若 mtime 相等但 hash 不同,亦视为冲突)
- **localStorage 容量**:大量未保存草稿 + 大 README 可能撑爆 5MB — 缓解:草稿超过 N 个或 7 天未触碰自动清理
- **正则误报**:目录名碰巧符合 `<x>-\d{6}-\d{6}` 但不是实验(几乎不可能,但) — 缓解:扫描时如果目录里完全没有 README.md 也没有任何 `*.log`/`*.csv`/`checkpoints/` 等迹象,标"不像实验",列表显示但灰色置底
- **monorepo 复杂度**:对单人开发者偏重 — 接受,因为 CLI/web 共享代码量大,后期发布也方便
- **Skill 后置**:agent 写 README/JOURNAL 时无统一约束,初期质量靠人审 — 接受,系统跑通后再补 skill 收口

## Migration Plan

不适用(全新项目,无既有数据)。开发期采用 `mock/` 目录里脱敏的样本数据驱动,生产使用时用户在自己的 `config.yml` 里指向真实 logs 路径即可。

## Open Questions

无。所有架构层决策均已与用户对齐;后续 implementation 期间若出现细节决策(具体 API 路径、组件树、数据格式微调)直接走代码 PR review,不再回到 design。
