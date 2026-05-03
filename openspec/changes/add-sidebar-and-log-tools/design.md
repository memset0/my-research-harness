## Context

`add-memon-mvp` + `add-write-flow` 已经把读写交互+实时反馈+基础 UI 跑齐。但外观上仍是个"工程师 dev tool",不像产品:多 project 时项目和视图都挤在顶栏,log viewer 是个朴素的 `<pre>`,没有任何"agent 协作"入口。本 change 的目的是把它从"功能完整"推到"用着舒服"。

## Goals / Non-Goals

**Goals**

- 切换项目/实验比当前少 1-2 次点击(树状 sidebar 而非两段 tab)
- Log viewer 接近终端体验:能搜、能切文件、能看颜色、能分享某行
- "请 agent 总结"5 秒以内能从详情页跳进 Claude Code 终端开始干活
- shadcn 化让 button/card/dialog 风格不再五花八门
- 搬家不破坏:URL 不变,SSE/写入/草稿 API 全部继续工作

**Non-Goals (本期不做)**

- Dark mode(shadcn theme 是好做了但优先级低,且 sidebar 重做先要落地)
- ⌘K 命令面板(独立 change `add-command-palette`)
- URL 同步筛选状态(独立 change `add-persistent-filters`)
- 视觉化:假说图谱、Gantt、CSV 折线、状态饼图(独立)
- A/B 实验对比 (独立)
- 网页内 agent 对话 / Claude API 集成(明确不做,用户要求 handoff 走 Claude Code)
- Token / 简单 auth gate(用户暂未要求)
- Skill 包发布(独立 `add-memon-skills`)

## Decisions

### D1. 直接拷贝 shadcn 组件源,不走 `shadcn init`

上次执行 `pnpm dlx shadcn@latest init` 卡在交互选项("Radix vs Base","Nova vs Vega...")。本期改为**手动拷贝组件源**到 `apps/web/components/ui/*.tsx`,清单:
- `sidebar.tsx`(主目标)
- `button.tsx` / `badge.tsx` / `card.tsx` / `separator.tsx` / `scroll-area.tsx`
- `dialog.tsx`(替换我们手搓的 modal)
- `dropdown-menu.tsx`(替换 select 用 menu)
- `tabs.tsx`(log viewer 多文件 tab)
- `tooltip.tsx`(stale 标识 hover)
- `collapsible.tsx`(sidebar 内项目折叠组)

依赖加 `@radix-ui/react-*`(Radix primitives)、`class-variance-authority`、`tailwindcss-animate`。共约 10 个 npm 包。

`components.json` 配置文件在拷贝完后补上。`globals.css` 加 shadcn 推荐的 CSS variables(slate base color,只 light theme)。

**理由**:可控、可改、不卡交互,和上次给 `Button`/`Card` 自手搓的精神一致。

**备选(不采纳)**:再尝试自动 init(可能仍卡住)、用 daisyUI/Mantine(用户明确要 shadcn)。

### D2. 布局:Sidebar(左)+ AppBar(顶)+ Outlet(主区)

```
┌──────────────────────────────────────────────────────┐
│ AppBar:  memon  │  Experiments  Hypotheses  Journal  │ + New experiment │
├──────────┬───────────────────────────────────────────┤
│ Sidebar  │                                           │
│ ┌────────┤                                           │
│ │project-a│   主区(实验列表 / 详情 / 假说 / journal) │
│ │ ├ exp1 │                                           │
│ │ ├ exp2 │                                           │
│ │ ├ ...  │                                           │
│ │ └ View │                                           │
│ │   more │                                           │
│ │project-b│                                           │
│ └────────┤                                           │
└──────────┴───────────────────────────────────────────┘
```

实现:`app/p/[project]/layout.tsx` 包一层 `<SidebarProvider>` + `<AppSidebar />` + `<SidebarInset>`(main 区)。

### D3. Sidebar 项目折叠态:localStorage 持久化

key: `memon:sidebar:expanded` → JSON `string[]`(展开的项目名)。
默认空(全折叠)。点击 project 标题 toggle 时同步写。

不在 URL 里同步,因为这只影响导航视觉,不应让分享链接受牵连。

### D4. 最近 5 个 run 的列表数据

API 已存在:`/api/experiments?project=NAME` 已经返回该项目所有 experiments(默认按 `created_at` desc 排序)。Sidebar 展开某个项目时调 `useQuery(['experiments', project])`,take 前 5 个。

**性能**:每次展开一个项目都触发独立 fetch。多 project 同时展开时并发若干 GET,后端走的是内存索引,O(N) 项目实验数,可忽略。

### D5. "View more" 临时展开:component 局部状态

`useState<boolean>(showAll)`,默认 false。点击 `View more` → `setShowAll(true)`。

不持久化(用户下次打开仍只看 5 个)。如果用户想长期看全部,他们会切换到列表页 `/p/[project]`,那才是"看全部"的官方位置。

### D6. AppBar:tab switcher

shadcn `<Tabs>` + `<TabsList>` + `<TabsTrigger>` 的形态,但每个 trigger 是 Next `<Link>`。用 `usePathname()` 决定哪个 active。

也可以走 `<NavigationMenu>` 但 Tabs 更简洁,适合"互斥的视图选择"语义。

### D7. Log viewer 多文件 tab

后端新路由 `GET /api/log-files?expPath=...`:
- 复用 path-safety helper
- `fs.readdir` 实验目录(以及 `logs/` 子目录如果存在,一层深)
- 过滤 `*.log` / `*.txt` / `*.out` / `*.err`
- 返回 `[{name, path, size, mtime}]`,按 mtime desc 排序

前端 LogViewer 顶部加 shadcn `<Tabs>`,每个 tab 一个文件;点击切换 tab → 重新初始化 LineIndex 状态、SSE 连接。

### D8. 内文搜索 + 高亮

```
[ 🔍 search... ] [ 0 / 23 ] [ < ] [ > ]
```

实现:
- 客户端:把 lines buffer 中所有匹配项找出 → `matches: { lineNumber, indexInLine }[]`
- 渲染时,匹配的字符段用 `<mark className="bg-amber-300/70">` 包裹
- `< / >` 按钮切换 `currentMatchIndex`,scroll into view 当前匹配
- 大小写不敏感(可选 toggle)

不做正则,简单子串足够。

### D9. ANSI 颜色:`anser`

`anser` 把 `\x1b[31mfoo\x1b[0m` 解析成 `[{content: 'foo', fg: 'red', ...}]`。我们 map 到 Tailwind 类:
- `fg: 'red'` → `text-red-400`(深背景下红字可见)
- `fg: 'green'` → `text-emerald-400`
- `fg: 'yellow'` → `text-amber-300`
- `fg: 'blue'` / `cyan` / `magenta` → ...
- `bold` → `font-bold`
- `dim` → `opacity-60`

`anser` 体积 ~5KB,zero-dep,稳。

**备选(不采纳)**:`ansi-to-html`(更老,生成 raw HTML,XSS 风险更高)。

### D10. 行选中 + 永久链接

URL hash 格式:
- `#L123` 单行
- `#L123-L130` 范围

行号点击行为:
- 普通点击:选中该行,hash → `#L<n>`
- shift+点击:把锚行 → 当前行作为范围,hash → `#L<a>-<b>`(其中 a < b)

打开带 hash 的 URL:
- 解析 hash,设置 selection state
- LineIndex 已知 → 滚到该行(可能需要先 scroll-load 更早的行,如果当前 viewer 没覆盖到)
- **如果选中的行还没在 buffer 里**:fetch `/api/log` 一段足够大的 range 把它包进来

不持久化(刷新或换 tab 即丢失,符合"分享链接"的语义)。

### D11. Agent handoff prompt 格式

按钮位置:详情页 header,与 `+ Note` / `Edit README` 同行。

点击 → shadcn `<Dialog>` 弹出,内容:

```markdown
请总结实验 `<id>`。

实验目录: <abs path>
README: <abs path>/README.md
状态: <STATUS>
关联假说: H1, H3
最近 JOURNAL 事件(本实验相关):
- <timestamp> [STATUS] PENDING → RUNNING
- <timestamp> [NOTE] ...

请阅读 README 全文 + 上面提到的 JOURNAL 事件,然后:
1. 用 1-2 句话讲清这个实验在测什么(motivation)
2. 列出 result 中最关键的 2-3 个数字 / 观察
3. 判断关联假说当前应该是 ✅ CONFIRMED / ❌ REFUTED / 🟡 PARTIAL,以及理由
4. 如果发现新假说,提议加到 HYPOTHESES.md 的格式

请用中文回答。
```

底部:
- 大按钮 `Copy prompt to clipboard`(`navigator.clipboard.writeText`)
- 小一点的 `Copy "cd <root> && claude code"` 提示一行

**不在前端实际调用 Claude API**:用户明确要求 handoff,不要嵌入 LLM 对话。

### D12. 既有自手搓组件迁移

我们现有的 `apps/web/components/ui.tsx` 里有 `Button` / `Card` / `Badge` / `StatusPill` / `CardHeader` / `CardTitle` / `CardContent`。迁移策略:
- 替换为 shadcn 等价(`button.tsx` / `card.tsx` / `badge.tsx` 拷过来)
- 保留 `StatusPill` 的本地版本(逻辑组件,非 shadcn 范畴)
- 改 `apps/web/components/ui.tsx` 改成 re-export `./ui/*` 的 alias,这样所有现有 import path 不需要改

### D13. 编辑器组件单测(收尾 P0)

补 `add-write-flow` 中 deferred 的:
- `readme-editor.test.tsx`:render 编辑器、save 成功路径、409 触发 ConflictView、draft 恢复对话框
- `log-viewer.test.tsx`(本期已重写,加测试):append 时在底部自动滚动、scroll up 后徽章出现

vitest + @testing-library/react + jsdom。

## Risks / Trade-offs

- **shadcn 拷贝陷阱**:版本可能与依赖不匹配。Mitigation:严格按 shadcn 当前 stable 拷,锁版本(`class-variance-authority@^0.7.0` 等)
- **Sidebar 持久化**:localStorage 写入会被 SSR 命中"没有 window"。Mitigation:`useEffect` 中读写,初始 SSR 渲染按"全折叠"
- **多文件 tab 切换的 LineIndex 状态**:每次切 tab 重建 LineIndex,首次加载几 GB 文件会卡。Mitigation:复用上一 change 的 disk cache(已实现);切 tab 时显示 skeleton
- **ANSI 颜色 + 搜索高亮共存**:文本经过两层处理(ANSI 解析 → 文本片段;搜索 → 进一步切分)。Mitigation:先 ANSI 后 search,各自维护 segment 数组,渲染时合并属性
- **永久链接打开时该行未加载**:按 hash 反查 LineIndex,如果不在 buffer 里 fetch 围绕它的一段。Mitigation:fetch `endLine = target+50, count=100` 把锚定行放在中部
- **Agent prompt 内容长度**:JOURNAL 事件多时 prompt 会很长。Mitigation:只取最近 N 条 + 截断 README 的 body 到 4KB(单条剪贴板 < 16KB 通常 OK)

## Migration Plan

零破坏。但需要仔细切换:
1. shadcn 组件拷贝完后,先把 ui.tsx 改成 alias(导出新组件) — 不变 import 路径
2. 用 Sidebar 包 layout 后,所有 page.tsx 不变(`children` 仍然在 main 区域渲染)
3. AppBar tab 替换原 Header 的 ViewTabs 部分,Header 整体保留(以防其它地方用到 Header)— 实际上 Header 整个被 Sidebar+AppBar 取代
4. 删除老 `Header` 组件(只在 `app/p/[project]/layout.tsx` 用)

依赖装上后即可一次完成,不需要 feature flag。

## Open Questions

无。
