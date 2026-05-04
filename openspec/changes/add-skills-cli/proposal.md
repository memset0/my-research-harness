## Why

接下来要给 agent 写 6 个 skill,组成完整的 "agent 创建 → 跑 → 维护 → 总结" 闭环。它们**都不应该依赖 memon 的 web 进程**(拉起整个 stack 才能让 agent 写一行 journal,反向耦合太重),也**不应该依赖 `config.yml`**(skill 跑在 agent 的 cwd 下,用户可能压根没装 config)。

| Skill | 职责 |
|---|---|
| `memon-write-script` | 写实验用的 shell 脚本(主要是 `run.sh`),参考 [write-shell-script](https://github.com/MikaStars39/claude-templates/blob/main/commands/write-shell-script.md) 的 Style A / Style B 模板,但**目录命名走 memon 规范**(`<name>-yymmdd-hhmmss/`,匹配 `^.+-\d{6}-\d{6}$`,而不是上游的 `outputs/run_name_${TIMESTAMP}`)。每个 shell 脚本头部加一行简短注释说明该脚本做什么(功能性描述,不绑定假说/实验目的)。 |
| `memon-run-experiment` | 起进程跑实验脚本,跑稳了写 README,跑挂了标 FAILED + 简短 Result + 可选 archive |
| `memon-append-journal` | agent 把过程中的观察 / 决策追加到 JOURNAL |
| `memon-digest-journal` | 周期性消化 `last_digest_at` 之后的事件,出周报式摘要 |
| `memon-propose` | 看 HYPOTHESES.md + 历史实验,提议下一个该跑的实验 |
| `memon-doctor` | 扫描已 FINISHED 但缺 Result/Conclusion 的实验、stale RUNNING 等"残局",问用户怎么处理 |

> **去掉了原计划的 `memon-summarize`**:实验 README 由跑实验的 agent(`memon-run-experiment`)就地维护,不需要事后再有一个独立 skill 来总结。

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

`memon-doctor` skill 在这之上做交互:逐条把问题给用户,问"补 Result / 标 FAILED / archive / skip",再调 `experiment readme write` / `experiment status set` / `experiment archive` 落盘。

### 4. 输出 / 退出码约定

- 默认 JSON,`--format human` 切人类可读(沿用现有约定)
- 错误统一 `{"error":{"code":"...","message":"...","details":?}}` → stderr;code 字面值与 web API 对齐(`BAD_REQUEST` / `NOT_FOUND` / `CONFLICT` / `FORBIDDEN`)
- exit code 约定:`0` 成功 / `1` 通用失败 / `2` usage 错 / `4` 资源不存在 / `9` mtime 冲突 / `13` 路径越界

### 6. 跨 web/CLI 的扫描缓存(**v1 不实现,但 spec 落盘**)

定义一个**可选** capability:`~/.cache/memon/scan/<sha1(absoluteProjectRoot)>/snapshot.json`,内容是上次扫描的产物 + 每个实验目录的 mtime 表。CLI 启动时若发现缓存且全部 mtime 仍匹配,直接复用,不再走 fast-glob;web backend 启动时同样走这个 cache,把 warmup 时间从 N 秒压到 ms 级。

**v1 显式不实现**,但 Requirement 写进 spec(env var 开关、key 规则、失效条件、原子写入语义都定死),后续可以单独开 change 实现而不动既有契约。

## Capabilities

### New Capabilities

(无 — 所有变更都是已有 capability 的扩展)

### Modified Capabilities

- `memon-cli`:加 `--project-root` 模式 + 新 write 命令 + `scan` bulk read + 错误码统一 + archive/doctor 命令
- `experiment-discovery`:`discoverExperiments` 加 `includeArchived?: boolean` 选项;默认 false 时跳过含 `.archived` sidecar 的目录

## Impact

- **新增依赖**:无(用 `commander.js` 现有 CLI 框架 + `@memon/core` 现有 helper)
- **代码改动**:
  - `packages/cli/src/commands/{scan,experiment,journal,hypotheses,doctor}.ts` 新增
  - `packages/cli/src/commands/{list,show,search,new,hypo}.ts` 加 `--project-root` + `--include-archived` 分支
  - `@memon/core` 加 `loadCliContext` + `scanProjectRoot` + `runDoctor` + 改 `discoverExperiments` 签名加可选 `includeArchived`
- **不改变**:web 后端 API 形状、文件格式、状态枚举、JOURNAL append 协议、mtime 锁协议、README schema
- **行为变化(向后兼容)**:web 端 `/api/experiments` 默认 **不再列出含 `.archived` sidecar 的目录**(因为底层 `discoverExperiments` 默认行为变了)。但首次升级时,目录里还没有任何 `.archived` 文件,**实际可见列表与升级前完全相同**;只有用户主动 archive 后才看不到。
- **测试**:每个新命令一个 e2e fixture-based 测试(用 `mock/project-a` 做 fixture,无需 mock node:fs)
- **缓存层**:声明在 spec 但不实现(详见 spec 的 deferred Requirement)
