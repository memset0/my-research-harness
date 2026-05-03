## Context

`add-memon-mvp` 完成后,前端是个"只读 dashboard":能看不能改,数据靠 5–30s 轮询,反馈方式只有"页面刷新就有了"。后端写入 API(`PUT /api/readme`、`POST /api/journal/append`、`/api/events` SSE、`/api/log/stream` SSE)其实都在,只是没有 UI / 客户端订阅。

本 change 的目标是把这些 API 接出来,让 memon 真正成为一个可交互的研究操作面板。同时把几个低成本但用户每打开一次就硌一次的体验 bug(markdown 没有 prose 样式、错误白屏、loading 只有文字)修掉。

## Goals / Non-Goals

**Goals:**
- 前端能完成所有日常实验维护操作,无需打开终端:状态切换、写 conclusion/note、加假说关联、新建实验
- 写入体验闭环:乐观更新 → 失败时 toast + 完整 diff 解决 → 草稿不丢失
- 数据反馈实时:状态变更、新事件、新日志行在 1 秒内可见
- 错误兜底:任何异常路径都有清晰的 UI 反馈,不会白屏

**Non-Goals (本期不做):**
- Dark mode(Tailwind v4 + CSS 变量主题改造较大,放下一期)
- 命令面板 ⌘K(独立功能,值得单独 change)
- 视觉化:假说图谱、Gantt、CSV 折线、状态饼图
- A/B 实验对比
- WandB iframe 嵌入
- Agent 集成(让网页直接调 Claude API)
- 简单 token gate(用户已说先暴露,信任内网/HTTPS)
- Skill 包(单独 change `add-memon-skills`,且必须等 write flow 跑顺再上)

## Decisions

### D1. README 编辑器选 `@uiw/react-md-editor`(不是 Milkdown)

`@uiw/react-md-editor` 是经典 split-pane(左源右预览)Markdown 编辑器,30k 周下载,稳定。Milkdown 是 WYSIWYG 风格(类 Notion),功能更现代但插件生态复杂,且对 YAML front matter 处理不友好(可能把 `---` 解释成水平线)。

研究 README 中常见的 LaTeX 公式、表格、代码块,split-pane 的所见即所得在源/预览两侧都直观,踩坑少。`@uiw` 直接把整个文件文本作为 string 编辑,front matter 完全保留。

**备选(不采纳):** Milkdown(WYSIWYG 但 front matter 处理麻烦)、CodeMirror 6 直接挂(没有预览,体验降级)。

### D2. 冲突解决:`react-diff-viewer-continued` + 三选一,不做手动 merge UI

409 时弹模态框,左右展示"我的草稿" vs "磁盘当前内容",底部三个按钮:
- **Keep my changes (overwrite)**:直接再发一次 PUT,这次用最新 mtime
- **Discard mine (use disk)**:抛弃草稿,用磁盘内容覆盖编辑器
- **Cancel**:留在编辑器里继续看,什么都不做

**不做"手动 merge"** —— 太复杂,且与 `@uiw` 的 single-textarea 模型不匹配。需要细粒度合并的用户应直接关闭弹窗,自己去 git 处理。

### D3. localStorage 草稿:key `memon:draft:<absolute path>:<mtime ms>`

键带绝对路径 + 当时打开的 mtime,确保:
- 同一文件不同 mtime 的草稿不会互相覆盖
- 磁盘 mtime 已变 → 旧草稿的 key 不再匹配 → 自动跳过(不弹恢复对话框,因为基础已变)

值是 `{ content: string, savedAt: ISO8601 }`。每次输入有 500ms debounce 写入。

清理策略:打开编辑器时扫描 `memon:draft:*` 前缀的 key,删除 `savedAt > 7 天前` 的。轻量、不需要后端配合。

### D4. SSE 客户端:单连接,顶层 layout 挂一次

新建 `useMemonEvents()` hook,在 `app/layout.tsx`(经 Providers 包装)调用,内部用 `EventSource('/api/events')`。收到 `experiment-change` 事件:

```typescript
queryClient.invalidateQueries({ queryKey: ['experiments'] })  // list 视图
queryClient.invalidateQueries({ queryKey: ['experiment', evt.id] })  // 当前详情页
toast.info(`${evt.id} updated`)  // 非阻塞通知
```

**为什么顶层挂一次而非每个组件各连各的**:浏览器对单 origin 的 SSE 连接数有限(通常 6),每个 React 组件挂一个会很快爆。顶层一个连接 + 内部 EventEmitter 分发到订阅组件即可。

**重连策略**:`EventSource` 自带断线重连(默认 3s)。HMR 时浏览器自动重建。生产环境 Caddy 已支持 SSE 透传。

### D5. LogViewer 重写:SSE-driven,不再 setInterval

现状:每 3 秒整个 fetch 一次最后 100 行。改为:
1. 初次加载:`GET /api/log?path=...&count=100` 拿初始 100 行 + totalLines
2. 建立 SSE:`GET /api/log/stream?path=...`,事件:
   - `ready`(连接确认)
   - `append`:增量行 → 直接 push 到 lines 数组尾部
   - `rotated`:文件被截断/轮转 → 整个重置
3. 滚动监听:用 ref 跟踪 scrollTop / scrollHeight,**计算"距离底部 < 50px"为'在底部'**;
   - 离开底部:`follow=false`,新增 lines 仍 append 但不自动滚动,显示一个浮动徽章 "N new lines ↓"
   - 用户点徽章或滚回底部:`follow=true`,清徽章,scroll into view

### D6. Toast 体系:sonner

- 成功写入:`toast.success('Saved · mtime 14:23:17')` (1s 自动消失)
- 冲突:不用 toast,弹 diff modal(更显眼)
- 网络/服务器错误:`toast.error('Save failed: <message>')` (5s,带 retry 按钮)
- 实时 SSE 事件:`toast.info(...)` (2s,可批量去重)
- 全局 `<Toaster />` 挂在 root layout 里(client side)

### D7. 加 NOTE / REQUEST 入口:两处

1. **详情页**:右上角 `+ Note` 按钮 → 弹 textarea 模态 → 提交 `POST /api/journal/append { tag: NOTE, body: '\`<id>\` <text>' }`
2. **journal 页**:顶部 `+ Add request / note` → 类似模态,可选 tag(NOTE / REQUEST),body 自由输入(REQUEST 一般不带 experiment id)

后端 `/api/journal/append` 已存在,直接消费。

### D8. 创建实验 wizard

新增 `POST /api/experiments`:
- body: `{ name: string, project?: string }`(同 CLI `memon new`)
- server 端复用 `@memon/cli/commands/new` 的核心逻辑,**抽到 `@memon/core` 中**作为可复用的 `createExperimentScaffold()` 函数(目前 CLI 内部直接写文件,需要 refactor 出来)
- 返回 `{ created: { id, path, project } }`

UI:列表页右上角 `+ New experiment` 按钮 → 模态(name + project 下拉)→ 提交后 toast "Created" 并直接 router.push 到详情页。

### D9. Skeleton + Error Boundary

- **Skeleton**:三个尺寸的简单组件(`<RowSkeleton />`、`<CardSkeleton />`、`<DetailSkeleton />`),用 `bg-slate-200 animate-pulse` 实现。组件接 `isLoading` 时渲染 skeleton 而非 "loading…" 文字
- **Error Boundary**:`apps/web/app/error.tsx`(全局)+ `apps/web/app/not-found.tsx`(404),Next.js App Router 原生支持。错误页给个 `<button onClick={reset}>重试</button>` 按钮,日志事件按钮("发送给开发者"——MVP 先不做,留按钮)

### D10. Tailwind typography

简单加依赖 + 在 `globals.css` 里 `@plugin '@tailwindcss/typography';` 即可(Tailwind v4 用 `@plugin` 而非 `tailwind.config`)。

## Risks / Trade-offs

- **SSE 在生产代理后的稳定性**:Caddy 默认透传 SSE,但 `flush_interval` 没设可能会缓冲。已知风险:对外暴露时,某些代理/CDN 可能 buffer 30s。**Mitigation**:Caddy 配置 `flush_interval -1` 在 SSE 路径(下个 change 再做,本期先信赖默认)
- **`@uiw/react-md-editor` 体积**:gzipped ~150KB,下游 lazy-load 它(只在编辑模态打开时 import)以避免污染列表页 bundle
- **localStorage 配额**:5MB 上限,典型 README < 50KB,留至少 100 个 draft slot,实际用户不会触发。**Mitigation**:7 天清理 + 写入失败时 toast 警告
- **Optimistic update 复杂度**:状态切换是否做 optimistic UI?**Decision**:不做。改完立刻回写后端 → 等 mtime 返回 → 再失效缓存。多 200ms 延迟换简单可靠。失败时 toast + 不改本地状态,用户重试
- **草稿恢复 UX 噪音**:每次打开有 draft 都弹"恢复 / 放弃"对话框可能烦人。**Mitigation**:草稿 < 30 秒前的"保存到现在"差不多没意义,只在 draft 比当前 disk 内容长 5+ 字符时弹

## Migration Plan

无破坏性变更:
- 新增的 routes / 组件不影响 read-only 路径
- TanStack Query 在 SSE 收到事件时**额外**触发 invalidate,与现有 `refetchInterval` 不冲突
- 老用户 `pnpm install` 拉新依赖、HMR 重连一次即可

config.example.yml 不变。mock 数据不变。

## Open Questions

无。

(开发期间发现的细节决策由 PR review 处理,不回到 design。)
