## Why

`add-memon-mvp` 把 read 路径全跑通了:列表/详情/假说/journal/log tail 都能渲染 mock 数据,后端 PUT/POST 写入 API 也都做了。但前端目前**只读**——任何修改都得回到命令行或直接编辑文件,这与"完整系统"的体验差距巨大。同时,前端用的是 5-30s 轮询,服务器已经支持 SSE(`/api/events`、`/api/log/stream`)但客户端没消费,导致用户看到状态变化要等好几秒,新事件不会主动通知。再加上一些明显的体验 bug(markdown 不渲染 prose 样式、错误直接白屏、loading 只有"loading…"文本),需要一次集中收尾。

## What Changes

- 新增 **write flow** UI:
  - 详情页 `Status` 控件下拉直接改状态(原子 README + JOURNAL `[STATUS]`)
  - README 在线编辑器(`@uiw/react-md-editor`)+ mtime 乐观锁 + content-hash 双重校验
  - 409 冲突时弹 diff 三选一(覆盖 / 放弃 / 手动合并)
  - localStorage 草稿(key = `<path>:<mtime>`)+ 重开时草稿恢复提示
  - 详情页 / journal 页内联"加 NOTE"/"加 REQUEST"按钮
  - 网页内创建实验 wizard(等价于 `memon new`,后端新增 `POST /api/experiments`)
- 替换轮询为 **SSE 实时反馈**:
  - 客户端订阅 `/api/events`,收到 `experiment-change` 时按需失效 TanStack Query 缓存,新建实验弹 toast
  - LogViewer 用 `/api/log/stream` SSE 替代当前 3s 轮询;mtime 增长时增量推新行
  - follow 模式监听滚动,离开底部自动暂停(显示"N new lines")回到底部自动恢复
- 体验打磨:
  - 引入 sonner toast(写入成功/失败/冲突全部走 toast,非 alert)
  - 安装 `@tailwindcss/typography` 让 markdown 渲染真的有 prose 排版
  - 替换"loading…"文字为 skeleton 占位
  - 加全局 error boundary + `not-found.tsx` + `error.tsx`,写入失败不再白屏

## Capabilities

### New Capabilities

- `experiment-edit`: 实验数据写入交互(状态编辑、README 编辑器、冲突 diff 解决、草稿恢复、note/request 追加、新建实验)
- `live-updates`: 实时反馈(SSE 事件订阅、SSE log 流、follow 自动暂停/恢复、toast 通知、loading skeleton、error boundary)

### Modified Capabilities

(无;`add-memon-mvp` 中 `web-dashboard` 与 `log-viewer` capability 的 spec 已经预留了相关 scenario(如 README 编辑/SSE follow 等),本 change 只补**新**需求,实现层面把延迟的 scenario 也一起兑现)

## Impact

- **新增依赖**(都是 web 侧):`@uiw/react-md-editor`(markdown 编辑)、`react-diff-viewer-continued`(冲突 diff)、`sonner`(toast)、`@tailwindcss/typography`(prose 样式)
- **新增 backend 路由**:`POST /api/experiments`(网页内创建)
- **修改 backend 路由**:`POST /api/journal/append` 已存在,无变更;`/api/log/stream` 已存在,无变更
- **客户端架构**:增加一个 `useMemonEvents()` hook 在顶层 layout 挂一次 SSE 连接,通过 TanStack Query 的 `queryClient.invalidateQueries()` 派发本地刷新
- **风险**:SSE 长连接在 Next.js dev 中 HMR 时会断开/重连,这是预期的。生产模式下 Caddy 已配置好支持 chunked SSE(默认即可)
- **范围外**(后续 change):dark mode、命令面板、URL 持久化筛选、视觉化(假说图谱/Gantt/CSV 折线)、log 内搜索、A/B 实验比较、agent 集成、token gate
