## Why

`add-memon-mvp` 已经把实验目录做成了 in-memory `ExperimentIndex` + `Poller`(per-dir 指数退避轮询,1s→5min)。但其它两个文件型 source-of-truth 没走同一套机制:

- `/api/hypotheses?project=X` 每次请求都 **重新读盘 + parseHypotheses(content)** `<root>/HYPOTHESES.md`
- `/api/journal?project=X` 每次都 **重读 + parseJournal()** `<root>/JOURNAL.md`
- SSR prefetch(刚上的 `add-server-prefetch`)在 `lib/server/data.ts` 的 `getHypothesesData` / `getJournalData` 也是每次读盘

加上 dev 模式 Next.js 的冷编译(`/api/projects` 第一次 14s),用户感受到的"慢"主要来自:
1. 假说/journal 文件每次硬读
2. Runtime 是 **lazy** 初始化——任何 `/api/*` 第一次命中才触发全量扫描 + 索引,导致首请求 14s 起步
3. dev 重启后又要从头扫一遍

`/p/[project]/experiments/[id]` 的 README 也类似:Runtime 已经把它存进 ExperimentIndex,但对应的 LogIndex(line-index)是 lazy 建的,大文件首次打开还是要扫一遍。

## What Changes

新增**统一的 Runtime cache 层**,把所有"已知文件"的"上一次解析结果"和"上一次 mtime"内存化,并交给现有 `Poller` 自动失效:

- 新增 `HypothesesCache`:每 project 对应一项 `{ path, mtime, parsed }`;Poller 监视 `<root>/HYPOTHESES.md`,mtime 变化时重新读盘 + parse,原子替换;不存在的文件保留 `null` 标记同样监视(等待创建)。
- 新增 `JournalCache`:同上,目标是 `<root>/JOURNAL.md`。
- 改造 `/api/hypotheses` + `/api/journal` 直接从 cache 拿,**不再 fs.readFile**。同样改造 `lib/server/data.ts` 的 SSR fetchers。
- 新增 **eager warmup**:`apps/web/instrumentation.ts`(Next.js 15 标准 hook)在服务器启动时 `await getRuntime()`,完成一次性扫描 + 索引 + 假说 / journal cache 初始化 + 假说 / journal Poller 启动。dev 启动时虽然要等几秒,但把"首请求 14s"摊到了 boot 阶段,前端从一开始就能秒级响应。
- 新增轻量诊断接口 `GET /api/runtime/health`,返回 `{ projects, experiments, hypothesesCached, journalsCached, warmupAt, lastError }` 给我们后续验证用。

## Capabilities

### New Capabilities

- `runtime-cache`: 假说/journal 的内存缓存 + 写穿失效(通过 Poller mtime 检测) + 启动时 eager warmup。

### Modified Capabilities

(无;`experiment-discovery` capability 的 Poller 已是 ADD 进 cache 时复用,不改它的现有 requirement。)

## Impact

- **新增模块**:`apps/web/lib/runtime/hypotheses-cache.ts`, `apps/web/lib/runtime/journal-cache.ts`(或合并为一个 `file-cache.ts`)。
- **改动模块**:`apps/web/lib/runtime.ts`(实例化两类 cache + 启动时调用 `await cache.warmup()`)、`apps/web/lib/server/data.ts`(走 cache)、`apps/web/app/api/hypotheses/route.ts`、`apps/web/app/api/journal/route.ts`、`apps/web/app/api/journal/append/route.ts`(append 后立即标记 cache dirty 等待下次 poll;或直接同步替换内存值,避免 lag)。
- **新增文件**:`apps/web/instrumentation.ts`(Next.js 15 自动检测,无需 next.config 修改;`register()` 中触发 `getRuntime()`)。
- **新增路由**:`apps/web/app/api/runtime/health/route.ts`(诊断用,只读)。
- **不变**:文件格式、CLI、所有 spec scenarios、SSR prefetch 流程、Caddy 配置。
- **明确不做**(后续 change):磁盘持久化 cache(`~/.cache/memon/runtime-snapshot.json` for warm dev restart);多机分布式 cache 失效;LogIndex 的预热(已有 disk cache)。
