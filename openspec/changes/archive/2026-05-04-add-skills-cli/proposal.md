## Why

接下来要给 agent 写 6 个 skill,组成完整的 "propose → write → run → observe → digest → report" 闭环。它们**都不应该依赖 memon 的 web 进程**(拉起整个 stack 才能让 agent 写一行 journal,反向耦合太重),也**不应该依赖 `config.yml`**(skill 跑在 agent 的 cwd 下,用户可能压根没装 config)。

| Skill | 职责 |
|---|---|
| `memon-write-script` | 写实验用的 shell 脚本(主要是 `run.sh`),参考 [write-shell-script](https://github.com/MikaStars39/claude-templates/blob/main/commands/write-shell-script.md) 的 Style A / Style B 模板,但**目录命名走 memon 规范**(`<name>-yymmdd-hhmmss/`,匹配 `^.+-\d{6}-\d{6}$`,而不是上游的 `outputs/run_name_${TIMESTAMP}`)。每个 shell 脚本头部加一行简短注释说明该脚本做什么(功能性描述,不绑定假说/实验目的)。 |
| `memon-run-experiment` | 起进程跑实验脚本,等 stable RUNNING 后写 README,跑挂了标 FAILED + 简短 Result。前置加 env+GPU sanity check;`code.diff` 走 allowlist(列表存项目 `CLAUDE.md`,首次运行交互式 seed) |
| `memon-append-journal` | agent 把过程中的观察 / 决策追加到 JOURNAL(单事件,允许 model 自动调) |
| `memon-digest-journal` | 周期性消化 `last_digest_at` 之后的事件,date-keyed `D<NNNN>-<YYYY-MM-DD>.md`;**整合 doctor 检查**:在 cursor advance 之前完成 integrity sweep + 交互式修复 |
| `memon-write-report` | 主题驱动的自由形态报告(`R<NNNN>-<slug>.md`),frontmatter 携带可重跑 `selector` shell snippet;不动 cursor;允许时间窗重叠 |
| `memon-propose` | 看 HYPOTHESES.md + 历史实验 + 最新 digest/report,先 brainstorm 5-8 candidates 再 converge 到 1-3 个,带 trade-off 说明 |

> **去掉了原计划的 `memon-summarize`**:实验 README 由跑实验的 agent(`memon-run-experiment`)就地维护,不需要事后再有一个独立 skill 来总结。

> **去掉了原计划的 `memon-doctor` 单独 skill**:检测逻辑保留为 `memon doctor` CLI 命令(被 digest skill 内部调用,也允许 ad-hoc 跑),但不再有单独的 skill 文件。"在 cursor advance 之前做整体 integrity sweep" 才是 doctor 检查的自然时机,跟 digest 合并避免了「跑完 doctor 但忘了 digest 收尾」的失败模式。

> **`memon-update-journal` 改名为 `memon-append-journal`**:原名容易让人以为它做的是组织/整理,但其实只是 append 一条事件;组织属于 `memon-digest-journal`。

> **数字 ID 全部 4 位 zero-pad**(`H0001`/`D0042`/`R0123`):见已归档的 `zero-pad-ids` change。本 change 里所有 `D<NNNN>` / `R<NNNN>` 引用都按那个约定走。

> **Skill invocation policy**:重操作 skill(`memon-write-script` / `memon-run-experiment` / `memon-digest-journal` / `memon-write-report` / `memon-propose`)在 frontmatter 里带 `disable-model-invocation: true`,只能用户显式触发;轻量单事件的 `memon-append-journal` 不带,允许 model 自动调。

> **`memon-write-script` 与 README 的分工**:每个 shell 脚本头部只放一行功能性 header(例:`# Sweep batch size 4/8/16 with fp16, log per-step loss to log/ subdir.`)。脚本不必绑定到具体假说,因此不需要像 README 那样写 Motivation/Method/Result。**实验级别**(目的、setup、结果、结论)的元信息由 `memon-run-experiment` 写到 README;**脚本级别**的元信息由 `memon-write-script` 写到脚本头。两个层级互不重复。

因此每个 skill 落到磁盘上的写动作都需要一个**独立、零运行时依赖**的 CLI 入口:接收 `<project-root>` 直接扫该目录,无 config 也能跑。memon 原本的 CLI 已经覆盖了 read 路径,但缺少 write 命令(append journal、写 README、digest mark、archive)、健康检查(doctor)、以及"传 project root"的形式。

## What Changes

### 1. 现有命令加 `--project-root <path>` 模式

`list` / `show` / `search` / `hypo list` / `hypo show` / `new` 都支持 `--project-root <abs-or-rel-path>`,**绕过 config 解析**,把传入路径当作单一匿名项目根。

- `--project-root` 与 `--config` / `--project NAME` 互斥;前者指定时一切其他配置忽略
- 没有 `--project-root` 也没有 config → 维持当前 implicit cwd 行为(向后兼容)

### 2. 新增 read 命令:`memon scan <project-root>`

一次性 dump 项目根下的所有结构化数据:

```
{
  projectRoot, hypotheses, journal,
  experiments: [{id, path, mtime, hasReadme, frontMatter, sections, parseErrors[], parseWarnings[]}, ...]
}
```

skill 拿到一坨 JSON 就能离线决策,不用再连续打多个命令。

### 3. 新增 write 命令(全部需要 `--project-root`)

| 命令 | 作用 | 关键 flag |
|---|---|---|
| `memon experiment status set <id> --to <STATUS>` | 原子改 status:写 README + append `[STATUS]` 到 JOURNAL | `--expected-mtime <ms>` 必须;不匹配 → 退 9 |
| `memon experiment readme write <id>` | 整体覆盖 README;内容从 stdin 读 | `--expected-mtime <ms>` 必须;`--expected-hash` 可选 |
| `memon experiment archive <id>` / `unarchive <id>` | 标记 / 解除标记 archive(详见 §4) | — |
| `memon journal append --tag <T> --body <B>` | 追加 `[NOTE]` / `[REQUEST]` / `[ERROR]` / `[ARCHIVE]` 事件 | `--experiment-id <id>` 可选;**不动 frontmatter** |
| `memon journal digest-mark --at <ISO>` | 唯一被允许更新 `last_digest_at` 的命令 | 仅 digest skill 使用 |
| `memon journal read [--since ISO] [--tag T] [--experiment-id ID] [--limit N]` | 已有 read API 的 CLI 镜像 | 默认按时间正序 |
| `memon hypotheses read` | 已有 API 的 CLI 镜像(JSON shape 与 `/api/hypotheses` 完全一致) | — |
| `memon doctor` | 扫一遍 project root 找出 "残局":FINISHED 但缺 Result/Conclusion、stale RUNNING、parseErrors 等 | `--include-archived` 可选 |

### 4. Archive 机制:`.archived` sidecar 标记 + 默认过滤

失败的实验 / 误跑的实验会污染 `memon list` 视图。引入"archive 但保留磁盘内容"的标记:

- **存储**:在 run 目录下放一个空的 `.archived` 文件(没有 = 未 archive,有 = archived)
- **不动 README**:archive 只是元数据,不应该回头改实验 README,也不该 bump mtime
- **discovery 默认 skip 已 archive**:`discoverExperiments({ includeArchived: false })` 跳过含 `.archived` 的目录(默认行为)
- **CLI / web 双侧统一**:web 后端通过同一个 `discoverExperiments` 走,archive 行为对前端自动生效
- **opt-in 视图**:`memon list --include-archived` / `memon scan --include-archived` / `memon doctor --include-archived` / digest 周报视图等少数场景需要看到全集
- **JOURNAL 事件**:archive / unarchive 操作各自追加一条 `[ARCHIVE]` / `[NOTE]` 事件(`[ARCHIVE]` tag 已在 spec 内)

为什么用 sidecar 不用 frontmatter:
- archive 是**元数据 / 工作流标记**,跟实验内容正交;塞进 frontmatter 就要走 mtime 锁 + atomic write,大材小用
- bash 一行就能 archive(`touch run-dir/.archived`),agent / 用户都能直接做
- 解析 README 完全不变,backward compat 0 风险

### 5. `memon doctor`:维护扫描

扫一遍指定 project root 下所有(非 archived)实验,产出问题列表:

```jsonc
{
  "issues": [
    { "experimentId": "...", "code": "MISSING_RESULT", "severity": "warn",
      "message": "FINISHED experiment has empty Result section",
      "suggestedAction": "fill Result, downgrade to FAILED, or archive" },
    { "experimentId": "...", "code": "STALE_RUNNING", "severity": "info", ... },
    { "experimentId": "...", "code": "MISSING_CONCLUSION", ... },
    { "experimentId": "...", "code": "PARSE_ERROR", "severity": "error", ... }
  ],
  "summary": { "total": 4, "byCode": { ... }, "bySeverity": { ... } }
}
```

CLI 命令本身**只检测,不写盘**。在 skill 层,`memon-digest-journal` 在 cursor advance 之前调它,然后逐条把问题给用户,问"补 Result / 标 FAILED / skip",再调 `experiment readme write` / `experiment status set` 落盘。整体 integrity sweep 跟 digest 合在一个交互闭环里 —— 不再有单独的 `memon-doctor` skill。

### 6. 数字 ID + 文件命名约定

每个 namespace 的数字 ID 一律 4 位 zero-pad:

- 假说:`H0001` ~ `H9999`(见已归档的 `zero-pad-ids` change)
- Digest:`<projectRoot>/docs/digests/D<NNNN>-<YYYY-MM-DD>.md`,**date-keyed**;同一天再次跑就 append 到当天文件,新一天才递增 N
- Report:`<projectRoot>/docs/reports/R<NNNN>-<slug>.md`,**主题驱动**,不带日期;允许多个 report 时间窗重叠

Digest vs Report 的关键区别:digest 推 `last_digest_at` 游标(严格非交叠),report 不动游标(可任意覆盖事件)。两者放在不同目录,各自由对应的 skill 写。

### 7. Skills 分发:`memon install-skills` + `@memon/skills` 包

skill 文件本身要随 memon 一起分发,不能让用户手动 `cp -r`。引入:

- `packages/skills/`:新 monorepo 包(private),目录布局 `memon-*/SKILL.md` 一个 skill 一个文件夹;`packages/skills/README.md` 是写给开发者的 INDEX(不进 install)
- `memon install-skills [--project-root <p>] [--target <path>] [--dry-run]`:严格同步 `<projectRoot>/.claude/skills/` 下所有 `memon-*` 目录(全删全装)。**非 `memon-*` 目录绝不动**,用户自己装的第三方 skill 互不打架

每次 memon 升级后,用户在项目根跑一次 `memon install-skills`,skill 文件就刷到最新。

### 8. 输出 / 退出码约定

- 默认 JSON,`--format human` 切人类可读(沿用现有约定)
- 错误统一 `{"error":{"code":"...","message":"...","details":?}}` → stderr;code 字面值与 web API 对齐(`BAD_REQUEST` / `NOT_FOUND` / `CONFLICT` / `FORBIDDEN`)
- exit code 约定:`0` 成功 / `1` 通用失败 / `2` usage 错 / `4` 资源不存在 / `9` mtime 冲突 / `13` 路径越界

### 9. 跨 web/CLI 的扫描缓存(**v1 不实现,但 spec 落盘**)

定义一个**可选** capability:`~/.cache/memon/scan/<sha1(absoluteProjectRoot)>/snapshot.json`,内容是上次扫描的产物 + 每个实验目录的 mtime 表。CLI 启动时若发现缓存且全部 mtime 仍匹配,直接复用,不再走 fast-glob;web backend 启动时同样走这个 cache,把 warmup 时间从 N 秒压到 ms 级。

**v1 显式不实现**,但 Requirement 写进 spec(env var 开关、key 规则、失效条件、原子写入语义都定死),后续可以单独开 change 实现而不动既有契约。

## Capabilities

### New Capabilities

- `memon-skills`:把 6 个 SKILL.md 散落的跨 skill 约定提炼成 SHALL 级 requirement,作为 invariants 兜底。包括:invocation policy split、`--project-root` 必显式、mtime 锁纪律、README 作者归属、JOURNAL frontmatter 写权、doctor 折叠进 digest、English skill / Chinese dialogue 语言约定、digest vs report 双 artifact、code.diff allowlist 走 CLAUDE.md、pre-launch sanity、4 位 zero-pad ID。SKILL.md 文件本身仍是 agent 的工作手册;新 spec 仅记录"任何 skill 改动都不能破坏的不变式"

### Modified Capabilities

- `memon-cli`:加 `--project-root` 模式 + 新 write 命令 + `scan` bulk read + 错误码统一 + archive/doctor 命令 + `install-skills` 命令
- `experiment-discovery`:`discoverExperiments` 加 `includeArchived?: boolean` 选项;默认 false 时跳过含 `.archived` sidecar 的目录

## Impact

- **新增依赖**:无(用 `commander.js` 现有 CLI 框架 + `@memon/core` 现有 helper)
- **新增 monorepo 包**:`packages/skills/`(private,`@memon/skills`),内容是 6 个 `memon-*/SKILL.md` 加一个 INDEX `README.md`。无 TS 代码,只有 markdown + 一个 `index.ts` 导出 `SKILLS_DIR` 路径常量供 CLI 定位
- **代码改动**:
  - `packages/cli/src/commands/{scan,experiment,journal,hypotheses,doctor,install-skills}.ts` 新增
  - `packages/cli/src/commands/{list,show,search,hypo}.ts` 加 `--project-root` + `--include-archived` 分支
  - **删除**:`packages/cli/src/commands/new.ts`(连同 `createExperimentScaffold` core helper、web `+ New experiment` 按钮、`POST /api/experiments`)— 见 design D11
  - `@memon/core` 加 `loadCliContext` + `scanProjectRoot` + `runDoctor` + `archiveExperiment`/`unarchiveExperiment` + 改 `discoverExperiments` 签名加可选 `includeArchived`
- **项目级文件约定**:`memon-run-experiment` 第一次跑时会读项目根 `CLAUDE.md` 里的 `## code.diff allowlist` 段;不存在就交互式 seed 一份并 append 进去。约定本身在 SKILL.md 里描述,不需要 core / CLI 做事
- **不改变**:web 后端 API 形状(除去删除的 `POST /api/experiments`)、文件格式、状态枚举、JOURNAL append 协议、mtime 锁协议、README schema
- **行为变化(向后兼容)**:web 端 `/api/experiments` 默认 **不再列出含 `.archived` sidecar 的目录**(因为底层 `discoverExperiments` 默认行为变了)。但首次升级时,目录里还没有任何 `.archived` 文件,**实际可见列表与升级前完全相同**;只有用户主动 archive 后才看不到。
- **测试**:每个新命令一个 e2e fixture-based 测试(用 `mock/project-a` 做 fixture,无需 mock node:fs)
- **缓存层**:声明在 spec 但不实现(详见 spec 的 deferred Requirement)
