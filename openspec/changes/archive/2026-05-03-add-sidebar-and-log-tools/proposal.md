## Why

`add-write-flow` 把读写交互+实时反馈都跑通了,但视觉/导航层面还有几个明显短板:

1. **导航**:多 project 时,顶部 tab 栏(项目 + 视图)挤在一起;切换实验只能从列表点。需要一个"项目 → 实验"两级树状导航。
2. **Log viewer**:能 tail 但不能内搜索,只看 `stdout.log` 一个文件,ANSI 颜色直接被当字符串显示,看不出日志级别;行选中无法分享。
3. **Agent 协作**:用户想从详情页一键"让 agent 总结"——明确要求**不在网页里嵌 LLM 对话**,而是**生成一段 prompt + 上下文让用户去 Claude Code 终端粘贴**。
4. **shadcn 体验统一**:目前 UI 是自手搓 Tailwind 原语;sidebar/menu/dialog 这种结构性组件用 shadcn 才能保持视觉一致性和无障碍。

## What Changes

### 1. 桌面布局重设计

- 引入 **shadcn/ui Sidebar** 作为主导航容器(替代当前顶栏的 project tabs)
- 左侧 Sidebar:
  - 每个 project 一个**可折叠组**(默认折叠)
  - 展开后显示该 project 下**最近 ≤5 个 run**(按 `created_at` 降序)
  - 若超过 5 个,底部一个 `View more` 链接 → 临时展开显示全部(不持久)
  - 当前活跃 project + run 高亮
- 顶部 **AppBar**:
  - 把原来的 `Experiments / Hypotheses / Journal` 切换从 Header 挪到这里
  - 也放 `+ New experiment` 按钮 + 项目级动作
- 移动端:Sidebar 自动塌缩成 drawer(shadcn Sidebar 内建,无需自己写)
- 顺手把已有的 Button / Card / Badge 也走 shadcn 一遍,统一视觉风格

### 2. Log viewer 增强

- **多文件 tab**:列出实验目录中所有 `*.log` / `*.txt` / `*.out` / `*.err`;新增 `GET /api/log-files?expPath=...` 后端枚举
- **内文搜索**:viewer 顶部搜索框,client 侧匹配,所有命中行高亮当前关键字,`< / >` 按钮在命中之间循环
- **ANSI 颜色解析**:用 `anser`(轻量,zero-dep)把 `\x1b[...m` 序列解析成 span+inline color;常见 INFO/WARN/ERROR 颜色都正确显示
- **行选中 + 永久链接**:点行号选中(shift-click 选范围),URL 自动更新为 `#L123-L130`;打开带 hash 的 URL 自动滚到那段并保持高亮

### 3. Agent handoff (Claude Code)

- 详情页加一个 `Ask Claude Code` 按钮
- 点击 → 弹出小模态,展示一段**生成好的 prompt**(包含实验 id、README 路径、相关 hypothesis ID、最近 200 行 stdout 摘要),底部一个 `Copy to clipboard`
- 同时显示一行命令提示:`cd <project-root> && claude code` 然后粘贴这段
- **不实现**:网页内的 LLM 对话框、`claude://` 协议自动跳转(浏览器对此支持不可靠)

### 4. 收尾 P0 剩余

- 编辑器组件单测(write-flow 中 `5.6`/`7.13` 当时 deferred 的)— 用 vitest + Testing Library

## Capabilities

### New Capabilities

- `web-layout`:shadcn Sidebar + AppBar 主导航;项目折叠树 + 最近 run 列表;新建实验入口
- `log-viewer-tools`:多文件 tab、内文搜索高亮、ANSI 颜色、行选中永久链接
- `agent-handoff`:Claude Code prompt 生成 + 剪贴板复制

### Modified Capabilities

(无;`web-dashboard` capability 在 mvp/write-flow 阶段未归档,本 change 的新需求都是 ADD 进 `web-layout` 等新 capability)

## Impact

- **新增前端依赖**:`anser`(ANSI → HTML)、shadcn 组件(`sidebar`/`button`/`badge`/`card`/`dialog`/`scroll-area`/`separator`/`tooltip`/`tabs`)
- **shadcn 安装方式**:这次不走交互式 `pnpm dlx shadcn init`(上次卡住),改为直接拷贝组件源到 `apps/web/components/ui/*.tsx`(从 https://ui.shadcn.com 当前 stable),配 `cn` helper 已有
- **新增 backend 路由**:`GET /api/log-files?expPath=...`
- **既有组件迁移**:`Button` / `Card` / `Badge` / `StatusPill` / `Skeleton` 这些自手搓的原语逐步替换为 shadcn 等价物;视觉差异极小但更统一
- **路由不变**:URL 结构 `/p/[project]/{,hypotheses,journal,experiments/[id]}` 保持
- **客户端 bundle**:shadcn 组件全 client-side,不会污染服务端;sidebar 状态(哪个 project 展开)写 localStorage,小数据
- **Caddy 不变**:已有 `flush_interval -1` 在 SSE 路径,本期无新增 SSE
- **明确不做**:dark mode、命令面板、URL 持久化筛选状态、视觉化(Gantt/图谱/CSV 折线)、A/B 实验对比、网页内 agent 对话、token gate、skill 包(都留给后续 change)
