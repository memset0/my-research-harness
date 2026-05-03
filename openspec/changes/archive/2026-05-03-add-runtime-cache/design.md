## Context

`add-memon-mvp` 落地的 `Poller` 已经解决了"实验目录 mtime 监视"的问题——每个 experiment dir 有自己的指数退避轮询,变化时重新 `readExperimentDir` 并刷新 `ExperimentIndex`。这套机制可靠且 cluster 友好(无 fs watcher)。

但只覆盖了实验目录本身。对于 `<project root>/HYPOTHESES.md` 和 `<project root>/JOURNAL.md` 两个**项目级**的文件,API/SSR 路径目前都是直接 `fs.readFile + parse`。在 dev 模式下,加上 Next 冷编译,首次访问 `/p/<project>/journal` 可能需要 5-15 秒——很多请求其实可以用已有 mtime 信息直接命中缓存。

`add-server-prefetch` 让 SSR 在每次 page render 时调用这两个函数;意味着每次 page render 都至少有一次 disk read。如果用户开两个 tab,每个都要重新做一遍。

## Goals / Non-Goals

**Goals**

- API + SSR 数据 fetcher 命中 in-memory cache 时是 **O(1) 内存查表**,不碰 fs
- HYPOTHESES.md / JOURNAL.md 的修改在 Poller 检测到 mtime 变化后自动失效(最坏 5 分钟,与现有指数退避口径一致;用户主动操作时可主动 reset 退避)
- Next.js dev/prod 服务器启动后 **不再有"首请求慢"**——所有 cache 在第一个 HTTP 请求之前就已就绪
- 写入路径(`POST /api/journal/append`)同时更新内存 cache,不等下一轮 poll

**Non-Goals (本期不做)**

- Cache 的磁盘持久化(dev 重启时再走一次扫描);用户认为可接受。
- LogIndex 的预热(已有 LRU + disk cache,首次打开 1-2s 是已知 cost)
- 多机/分布式 cache 失效(本工具单进程)
- 前端 client-side cache 调优(TanStack Query 已经在管)

## Decisions

### D1. Cache 用单个 `FileCache<T>` 泛型,封装 mtime + 解析结果

```ts
class FileCache<T> {
  constructor(opts: {
    name: string                              // for logging
    paths: string[]                           // absolute paths to watch
    parse: (content: string) => T             // parser
    poller: Poller                            // shared with experiment poller
  }) { ... }

  get(path: string): { value: T; mtime: number } | null
  set(path: string, value: T, mtime: number): void  // for write-through
  warmup(): Promise<void>                          // initial scan + parse
}
```

`HypothesesCache = FileCache<ParsedHypotheses>`,`JournalCache = FileCache<ParsedJournal>`。

**理由**:两边逻辑除了 `parse` 不同,生命周期完全一致;泛型让代码量减半。

**备选(不采纳)**:为每种文件单独写类——无意义重复。

### D2. 复用现有 `Poller` 实例,不为缓存单独建第二个 Poller

`runtime.ts` 已经持有一个 `Poller` 用来跟实验目录 mtime。我们让 `FileCache` 把目标 paths(HYPOTHESES.md / JOURNAL.md)也注册进去。

**理由**:同一个 cluster 上多 Poller 浪费;且失效逻辑更直接——同一个 onChange 回调 dispatch 到不同 cache。

**实现**:`Poller.watch(path, mtime, callback?)` 增加可选 callback;为缺省 callback 时使用现有的实验目录处理逻辑。

实际上更干净的做法:Poller 只产出 `(path, mtime)` change 事件,由订阅者(包括 ExperimentIndex 维护者 + 各种 FileCache)各自决定怎么响应。

### D3. 文件不存在的处理

HYPOTHESES.md / JOURNAL.md 在新项目里可能根本不存在。Cache 不应在这种情况报错——而是:
- 注册 `Poller.watch(path)`(Poller 已经能处理 ENOENT,把 mtime 当 0)
- `cache.get(path)` 返回 `null`(内部存 `{ value: null, mtime: 0 }`)
- API 返回**空集**(沿用现有 `/api/hypotheses` 没文件就 `entries: []` 的行为)
- 当文件被创建,Poller 下一次 tick 检测到 mtime 增长,触发 onChange → cache 自动 populate

### D4. 写入路径同步更新 cache

`POST /api/journal/append` 当前流程:`appendJournalEvent({ path, event })` 写盘。然后客户端等 SSE / 下次 poll。

**改进**:写盘成功后,主动 `journalCache.markStale(path)`,让 Poller 立即重新 stat(`Poller.resetBackoff(path)`)。下一轮 tick 在 `min_interval_ms`(默认 1s)内就会重新读 + 解析 + 替换 cache 值。

**为什么不直接 `cache.set(path, parsedNew, newMtime)`?**:可以,作为 fast path。但内存里临时存的值和真正落盘后再读的值理论上应该相同——除非有并发 writer。保留 `markStale + resetBackoff` 作为兜底比 single-writer 假设更稳。我们两条都做:乐观 set + Poller 兜底。

### D5. eager warmup via `instrumentation.ts`

Next.js 15 在 server 启动时(包括 dev、build、start)会自动调用 `apps/web/instrumentation.ts` 中的 `register()` hook。我们的 register 触发:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return  // skip edge / browser
  const { getRuntime } = await import('./lib/runtime')
  await getRuntime()
}
```

`getRuntime()` 已经是 promise-memoized 单例;调用一次后续访问免费。`init()` 内部多了几步:warmup HypothesesCache + JournalCache(扫描所有 project 的两个文件,parse,存 cache)。

**dev 模式启动时间影响**:从 `Ready in 4s` 变成 `Ready in 6-8s`(取决于实验数);但 **首请求** 从 14s 砍到 ~100ms。净赚。

**生产模式**:本期还没用 `next start`,先在 dev 验证。

### D6. 诊断 endpoint

`GET /api/runtime/health` 返回:
```json
{
  "warmupAt": "2026-05-03T12:34:56+08:00",
  "projects": 2,
  "experiments": 9,
  "hypothesesCached": 2,
  "journalsCached": 2,
  "lastError": null,
  "uptime_ms": 12345
}
```

让我们(和 monitoring)能快速验证 cache 是否正常工作。

### D7. 不动 ExperimentIndex 的 cache 行为

ExperimentIndex 已经做对了:per-experiment-dir 内存表 + Poller 失效。本 change 不重写,只在 metric 上把它的 entry count 加到 `/health` 输出。

## Risks / Trade-offs

- **Eager warmup 把 dev "Ready in 4s" 推到 6-10s**。Mitigation:可以加 `MEMON_LAZY_INIT=1` env var 退回 lazy 模式做对比。但默认 eager,因为体感更好。
- **Cache 与磁盘最长 5min 不一致**(指数退避上限)。但用户主动写入路径(网页内编辑、CLI)都会 `resetBackoff` → 在 1s 内可见。被动等(外部 cli 直接写文件)最坏 5min。这是已有 ExperimentIndex 的约束,不变。
- **新增 instrumentation.ts 在 prod build 时也会执行 register()**。正确——prod 也希望 warm。
- **写入路径 race**:并发两个 append 时,Poller 可能在两次写之间 stat 一次,只刷一次。可接受;事件顺序由 fs append-only 写保证。
- **HYPOTHESES.md 是第一次创建时**(从无到有):Poller 已经在 watch,变化能感知;cache 状态从 `null` 平滑切到 parsed,无需特殊处理。

## Migration Plan

零破坏:
1. 部署后服务启动慢 4-6 秒(warmup),首请求快 13 秒以上。净赚。
2. 已有 API 行为不变(返回 shape 不变;`/api/runtime/health` 是新增)。
3. SSR prefetch 也只是变快,不变化。

无 schema 变更,无 file format 变更,无 CLI 变更。

## Open Questions

无。
