## Context

memon 现状:
- web 后端的 API 是 skill 写动作的**唯一入口**(`PUT /api/readme` 等),要求 web 进程在跑
- CLI 只有 read 命令(`list`/`show`/`search`/`hypo`),且需要 `config.yml`
- skill 跑在 agent 的当前进程(可能是浏览器内的 ttyd → tmux → claude code,也可能是用户外面 ssh 上来的终端),**它的 cwd 就是 project root**,带上 `--project-root .` 应该足够

需要把"读 + 写"的契约从 HTTP 全部下沉到 CLI,且不依赖 config.yml。

## Goals / Non-Goals

**Goals**

- skill 用 4-5 个 CLI 命令就能完成所有动作,无需起 web 进程
- 命令行调用形式可预测(`memon <noun> <verb> <project-root> [--flags]`)
- 输出 JSON,字段名与现有 web API 响应**1:1 对齐**(skill 抄过来就能用)
- 错误信息结构化、退出码语义稳定

**Non-Goals**

- 不重写 web 后端;web 后端继续用 `config.yml` + runtime singleton
- 不实现扫描缓存(v1)— 写进 spec,留给后续 change
- 不引入新的运行时依赖
- 不改文件格式 / 不改 mtime 锁协议

## Decisions

### D1. CLI 表面:`memon <noun> <verb>` 而不是扁平动词

**选择**:read 命令保留扁平形式(向后兼容),write 命令一律用 `noun verb`:

```
read:   memon list / show / search / hypo / scan
write:  memon experiment status set <id> --to FINISHED
        memon experiment readme write <id>
        memon journal append --tag NOTE --body "..."
        memon journal digest-mark --at ISO
```

**理由**:write 操作天然有"对什么资源做什么"的 OO 形态;扁平命名(`memon set-status`)空间命中率低,也不利于 tab 补全。

### D2. `--project-root` 模式:绕过 config,把 path 当作单一匿名项目根

复用 `@memon/core` 已有的 `implicitCwdProject(cwd)` helper(它返回 `{ name: 'cwd', root: cwd, exclude: [] }`),只需新增一层 entrypoint:

```ts
// @memon/core/cli-context.ts
export function loadCliContext(opts: {
  projectRoot?: string         // --project-root abs/rel
  configPath?: string          // --config
  cwd: string                  // process.cwd()
}): { projects: ProjectConfig[]; configSource: 'project-root' | 'config' | 'implicit-cwd' }
```

优先级:`--project-root` > `--config` > cwd/config.yml > implicit cwd。

**互斥校验**:同时给两者 → exit 2 + 提示。

### D3. write 命令统一带 mtime 锁,失败 exit 9

所有"必须写既存 README"的命令(status set / readme write)都强制 `--expected-mtime`:

- 缺这个 flag → exit 2
- mtime 不匹配 → exit 9 + JSON 错误体含 `{ error: { code: 'CONFLICT' }, currentMtime, currentContent }`,**stdout** 同时打印当前内容(skill 可以 pipe 进 diff 工具)

skill 必须先 `memon experiment show <id> --format json` 拿到 mtime,再带过来写。这是已有 web API 的同等契约,只是搬到 CLI。

### D4. JOURNAL append 从不动 frontmatter,有专门的 digest-mark 命令

memon-cli capability 早就规定了 "JOURNAL is append-only, frontmatter only writable by digest path"。这里把它具象化成两个命令:

- `journal append` — **永远只追加事件行**;`--tag` 必须是合法的 5 个之一
- `journal digest-mark --at ISO` — **唯一**会改 `last_digest_at` 的入口,内部调 `updateLastDigestAt`(已有 helper)

skill 名字也对应:`memon-append-journal` 用前者,`memon-digest-journal` 用后者。CLI 命令隔离,意外混用难度 ↑。

### D5. `scan` 命令:一次拿一份完整快照,降低 skill 的串行化成本

skill 经常需要 "给我项目所有现状再让我决策":

- 当前如果走多次 `list` + `hypo list` + `journal read`,要 3+ 个 process,串行 ~500ms+
- `scan` 一次性返回所有,目标 < 100ms(命中 runtime 后续的 cache 后 < 10ms)

输出 shape **完全等价于** web 后端的 `/api/scan`(同时新增,但本 change 不强制 web 也加),让 skill 在 CLI 和 HTTP 之间无感切换:

```jsonc
{
  "projectRoot": "/abs/path",
  "scannedAt": "2026-05-04T01:30:00+08:00",
  "experiments": [/* IndexedExperiment shape */],
  "hypotheses": { /* ParsedHypotheses shape */ },
  "journal":     { /* ParsedJournal shape, capped to last 200 events */ }
}
```

### D6. 扫描缓存(v1 不做但 spec 落盘)

**位置**:`~/.cache/memon/scan/<sha1(absoluteProjectRoot)>/snapshot.json`(沿用 mvp 阶段约定的 `~/.cache/memon/` 根目录,与 LineIndex disk cache 同辈)。

**形态**(v1 不写代码,但格式定下来):
```jsonc
{
  "schemaVersion": 1,
  "projectRoot": "/abs",
  "writtenAt": "2026-05-04T...",
  "experiments": [{ "id": "...", "path": "...", "mtimeMs": 12345, "size": 2048 }, ...],
  "hypothesesMtime": 99999,
  "journalMtime":     88888,
  "snapshot": { /* same shape as scan output */ }
}
```

**有效性判定**:遍历 `experiments[].path` + `HYPOTHESES.md` + `JOURNAL.md`,逐个 `fs.stat` 比 mtime;有任意不匹配即 cache 失效,触发完整 rescan + 覆盖写入。

**激活**:env var `MEMON_SCAN_CACHE=1`(默认关)。 v1 这两段都不实现 — 但 Requirement 入 spec,后续 change 直接照着实现就行。

**为什么不在 v1 做**:
1. 跑通 skill 流程是当前主线,缓存是性能优化
2. 规模未知 — 用户可能 5 个实验也可能 5000 个;先观察实际触顶情况再决定 invalidation 粒度
3. 缓存的 cross-process consistency 要单独想清楚(CLI 写一份 web 也要看到),引一条额外 IPC 路径会拖慢 v1

### D7. 退出码字典固化在 spec

skill 用脚本 / Claude Skill 的 metadata 里要根据退出码做不同分支(retry vs propagate)。固化:

| code | 意义 |
|---|---|
| 0 | 成功 |
| 1 | 通用 / 未分类错误 |
| 2 | usage / flag 错(commander.js 默认) |
| 4 | NOT_FOUND(实验不存在 / project root 不是目录 / ...) |
| 9 | CONFLICT(mtime 锁失败,skill 应 retry) |
| 13 | FORBIDDEN(路径越界等) |

### D8. 复用现有 core helper,几乎不写新逻辑

| 命令 | 内部调用 |
|---|---|
| `scan` | `discoverExperiments` + `readExperimentDir`(批量) + `parseHypotheses` + `parseJournal` |
| `experiment status set` | `parseReadme` → 改 status 字段 → `serializeReadme` → atomic write → `appendJournalEvent` |
| `experiment readme write` | mtime 校验 → atomic write → `appendJournalEvent`(若 status 变了) |
| `journal append` | `appendJournalEvent`(已存在,默认不动 frontmatter) |
| `journal digest-mark` | `updateLastDigestAt`(已存在) |
| `experiment archive/unarchive` | `fs.writeFile(<run>/.archived, '')` / `fs.unlink(...)` + `appendJournalEvent('[ARCHIVE]', ...)` |
| `doctor` | `discoverExperiments({ includeArchived })` + `parseReadme` + 一组 rules(纯函数集合) |

### D9. Archive 用 sidecar 文件,**不**入 frontmatter

**选择**: archive 状态由 run 目录下的 `.archived` 空文件标记,**不**作为 README front-matter 字段。

**对比**:

| 方案 | 优点 | 缺点 |
|---|---|---|
| frontmatter `archived: bool` | agent parseReadme 直接看到 | 需要 mtime 锁 + atomic write + bumps mtime + 给已稳定的 README 增加无关字段 |
| **sidecar `.archived`** | bash 一行能 toggle;不动 README;parseReadme 完全不变;0 schema 变更 | agent 拿 README 看不到状态(但 archive 是元数据,本就不该是 agent 关心的内容) |
| 项目级 `ARCHIVED.md` 列表 | 一处集中 | 多 agent 并发 toggle 要锁;迁移目录时容易丢同步 |
| 状态枚举 `ARCHIVED` | 0 新概念 | archive 与 status 正交 — `FAILED + archived` 是合法状态;吞掉 status 就丢信息 |

**实现**:

- discovery: `discoverExperiments` 加可选 `includeArchived: boolean`(默认 false);默认行为下,在每个匹配 `^.+-\d{6}-\d{6}$` 的目录上 `fs.access(<dir>/.archived)`,有就跳过
- toggle: `memon experiment archive <id>` = `fs.writeFile(<run>/.archived, '')`;`unarchive` = `fs.unlink(...)`(不在则 no-op)
- JOURNAL: archive / unarchive 各自追加 `[ARCHIVE]` / `[NOTE]` 事件,留个审计痕迹
- web 后端透明继承:web 的 runtime 用同一个 `discoverExperiments`,默认行为自动跟齐

**为什么 web 不暴露 `--include-archived` 切换**(v1):
- 浏览器主路径就是"能跑的实验",archived 是后台维护视角,放 sidebar 反而干扰
- 后续若要看,可以在 hypotheses / journal digest 视图按需 expand;CLI 已经覆盖了这个需求
- 如果用户硬要在 web 看 archived,目前 fallback:`rm <run>/.archived` 解开即可

### D10. `memon doctor`:维护扫描

**目的**:扫描 project root 找出"残局" — FINISHED 但 README 没填全、stale RUNNING 等需要人为决断的状态。

**职责切分**:
- CLI(`memon doctor`):**只检测,不动磁盘**。输出结构化 JSON 问题列表,退出码 = 问题严重性最高那一档(`error → 1`、`warn / info → 0`)
- skill(`memon-doctor`):在 CLI 之上做交互。逐条把问题摆给用户,根据回答调对应的 write CLI(`experiment readme write` / `status set` / `archive`)落盘

**检测规则**(v1 锁定这一组,未来可扩展):

| code | severity | 触发条件 | 建议处理 |
|---|---|---|---|
| `MISSING_RESULT` | warn | `status === FINISHED` 且 sections.result 缺失或仅占位文本 | 补 Result / 降级 FAILED / archive |
| `MISSING_CONCLUSION` | warn | `status === FINISHED` 且 sections.conclusion 缺失 | 补 Conclusion / archive |
| `STALE_RUNNING` | info | `status === RUNNING` 且 stale 标记触发 | 看是否进程死了,降 FAILED / 续命 |
| `FAILED_NO_NOTE` | info | `status === FAILED` 且 sections.result 完全空 | 至少留一句失败原因 |
| `PARSE_ERROR` | error | parseReadme 报 error | 修语法 |
| `PARSE_WARNING` | warn | parseReadme 报 warning | 看情况修 |
| `ORPHAN_HYPOTHESIS_REF` | warn | README 里的 `hypotheses: [Hn]` 在 HYPOTHESES.md 中找不到 | 修引用 / 把假说加进 HYPOTHESES.md |

**`--include-archived`**:默认 doctor 也走 archive 过滤;加 flag 才会扫已 archive 的(很少需要,但比如 audit 时有用)。

**输出形态**:稳定 JSON,skill 用 jq 索引。`--format human` 给人看时按 severity 分组高亮。

**与现有 stale 检测的关系**:复用 `isStaleRunning` helper(已有);doctor 是它的 superset,把更多种类的"该看一眼"汇成一个入口。

### D11. `memon-write-script` 的两层信息

参考 skill `claude-templates/commands/write-shell-script.md` 的 Style A(扁平)/ Style B(分组数组)模板,**只采纳模板形态,不采纳目录命名**:

| 维度 | 上游模板 | memon 适配 |
|---|---|---|
| 目录形态 | `outputs/run_name_${TIMESTAMP}` | `<projectRoot>/<...>/<name>-yymmdd-hhmmss/`,匹配现有 `^.+-\d{6}-\d{6}$` 正则 |
| timestamp 格式 | `${TIMESTAMP}`(由用户决定) | 强制 `yymmdd-hhmmss`(memon discovery 的硬约定) |
| 日志写入 | `2>&1 \| tee <log_path>` | 同;`<log_path>` 推荐 `<run-dir>/run.log` 或 `<run-dir>/log/...`,LineIndex 已知如何 tail |
| script header | 无 | **强制**:每个 shell 脚本第一行非 shebang 处加一行 `# <一句话功能>`(例:`# Sweep batch size 4/8/16 with fp16, log per-step loss to log/`) |
| script ↔ 实验绑定 | 无 | shell 不绑实验目的;实验级元信息全在 README |

**为什么 script 头部只放一行**:用户明确表达过"单个 shell 脚本往往不能绑定到某个假说/实验目的上"。一行功能性描述足够 grep + 让人一眼看懂"这个脚本是做什么的",更详细的语义在 README。把 `# Motivation` / `# Method` 塞 shell 注释里反而是失焦。

**关于 `memon new`**:这个 CLI 子命令在本 change 里**被删除**,连同 `createExperimentScaffold` core helper 和 web 端的 `+ New experiment` 按钮 / `POST /api/experiments`。原来的设计是"先 scaffold 出 run dir + boilerplate 脚本",但 skill 流程演进后:launcher script 只做 `mkdir -p "$RUN_DIR"` + 3 行 `echo "[memon] PROJECT_ROOT/RUN_NAME/RUN_DIR=..."`,初始 README 由 `memon-run-experiment` 在脚本启动后由 agent 直接写入(`memon experiment readme write --expected-mtime 0` for fresh launch,或带现存 mtime for resume)。Scaffold 路径上没有剩余调用方,整条移除。

### D12. 关于被去掉的 `memon-summarize`

mvp proposal 时假设 "agent 跑完实验之后,memon-summarize 来统一收口写 Result / Conclusion"。后来设计走向:**写实验脚本 + 跑实验 + 维护 README** 都收敛到 `memon-run-experiment`,因为"跑"和"写报告"在时间和上下文上紧挨,分开两个 skill 反而割裂。

`memon-doctor` 替代了 summarize 的 "检测谁还没写" 职责;`memon-run-experiment` 替代了 "跑完写 Result"。所以 summarize 不再单列。

### D13. fixture-based 测试,不 mock fs

CLI e2e 测试用 `mock/project-a/` 做 fixture(已经在 git 里),每个测试 `tmpdir/` copy 一份,跑 CLI,断言:
- stdout JSON 形状
- exit code
- 文件磁盘内容(写命令)
- 文件 mtime 变化(写命令)

无 fs mock。这种风格在 `packages/core/src/discovery/*.test.ts` 已经用了,沿用即可。

## Risks / Trade-offs

- **[CLI 启动慢] → tsc compile 后是个 Node 脚本,冷启动 ~150-300ms**;skill 一个回合可能要调 4-5 次,加起来 ~1s。可接受 v1;若成瓶颈再考虑 daemon mode。
- **[`--expected-mtime` 不可避免要先 read 一次再 write] → 写一次要 2 个 process**;是 mtime 锁的固有代价,无法绕过。
- **[scan 输出可能很大] → 200 个实验 × 5KB ≈ 1MB JSON**;可接受 stdout buffer。如果将来扛不住,加 `--shape compact`(只 frontMatter 不返回 sections)。
- **[扫描缓存竞争]:多个 CLI 实例同时写 cache → 用 atomic rename 解决(同 mvp readme 写入)**;v1 不实现所以无影响。
- **[`journal append` 误用 `--tag STATUS`]**:`STATUS` 事件应该走 `experiment status set`,不应直接 append。CLI 在 `journal append` 命令侧拒绝 `STATUS` tag(返回 BAD_REQUEST),把 STATUS 写权交给专用命令。

## Open Questions

无 — 所有架构层决策对齐用户意图(独立 CLI / 接 path 不接 config / 缓存可选并落盘)。具体 flag 名称、JSON 字段微调走代码 PR review。
