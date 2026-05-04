## Why

当前 `Edit README` 按钮打开的是一个全屏弹窗里的 `@uiw/react-md-editor`,这个 WYSIWYG-lite 编辑器对纯文本编辑的友好度不高(光标行为、行选择、键盘快捷键都不像写代码那样顺手),而且每次写一点就要被弹窗遮住正文,频繁开关心智成本不低。我希望桌面端可以把编辑器固定在右侧分栏里,跟正文并排,让"读 + 改"是连续动作;同时把编辑器换成 Monaco(VSCode 同款,我已经熟悉它的快捷键和 Markdown 高亮),并保留浏览器原生 textarea 作为可选 fallback(慢机器、离线 / Monaco 加载失败时不至于完全不能写)。

## What Changes

1. **替换编辑器内核**:`@uiw/react-md-editor` → `@monaco-editor/react`,语言模式 `markdown`,默认开启 wordWrap、行号关闭(README 是散文,不是代码)、自动焦点到末尾。
2. **响应式布局**(基于视口宽度,不基于 UA):
   - **手机** (<768px):保持现在的全屏 `<Dialog>` 弹窗(BREAKING:UI 行为不变,但内部组件换 Monaco)
   - **平板** (768–1023px):同手机,弹窗
   - **桌面** (≥1024px):右侧分栏 — 详情页正文 + 右侧固定宽度的编辑面板,不再用 `<Dialog>`,而用一个常驻的右侧 panel(可折叠)
3. **编辑器顶部工具栏**新增两个控件:
   - **"Plain editor" 切换**:点击后切到原生 `<textarea>`(monospace 字体,无语法高亮);用户偏好持久化到 localStorage(`memon:readme-editor:plain`);Monaco 加载失败时自动 fallback 到 plain 并显示 toast
   - **"Copy markdown" 按钮**:一键把当前编辑器内容写入剪贴板,toast 反馈;失败(剪贴板被禁)时 fallback 到选中文本
4. **桌面端面板可折叠**:右侧 panel 顶端有一个折叠按钮(展开 / 收起);收起时只剩窄边栏(显示一个垂直的 "Edit README" 把手),点击或拖拽展开;展开宽度持久化到 localStorage(`memon:readme-editor:width`,默认 50% / clamp 至 [320px, 50%])
5. **保留**:草稿恢复、debounced autosave、conflict 视图(`react-diff-viewer-continued`)、`expectedMtime`/`expectedHash` 乐观锁、`Edit README` 按钮入口 — 行为不变,只是承载它们的容器从 Dialog 变成 desktop side panel(在桌面上)。

## Capabilities

### New Capabilities

(无)

### Modified Capabilities

- `experiment-edit`:`Requirement: README inline editor` 改为 Monaco + 工具栏 + plain fallback;新增 desktop side panel 布局 requirement;新增折叠 / 宽度持久化 requirement。conflict 视图 requirement 不变。
- `web-dashboard`:`Requirement: README inline editing with conflict-aware save` 的承载容器在桌面端从 Dialog 改为右侧分栏,需要在 spec 里说明断点和 fallback 行为。

## Impact

- **代码**:
  - `apps/web/components/readme-editor.tsx`:大幅重写,拆出 `<MonacoArea>` / `<PlainArea>` / `<EditorToolbar>` 子组件;`Dialog` 包装变成条件渲染(mobile/tablet 用 Dialog,desktop 用新的 `<ReadmeSidePanel>`)
  - `apps/web/components/edit-readme-button.tsx`:在桌面端不再控制 `open` modal,而是 toggle 右侧 panel 的 visibility(走 context 或 URL search param)
  - `apps/web/components/experiment-detail.tsx`:在桌面端 layout 里给右侧 panel 留位置(grid 或 flex 双栏)
  - 新组件 `apps/web/components/readme-side-panel.tsx`:桌面端右侧的常驻 panel,内部包含编辑器 + 工具栏 + 折叠把手
  - 新 hook `apps/web/hooks/use-is-desktop.ts`:基于 `matchMedia('(min-width: 1024px)')`,跟现有 `useIsMobile` 同模式
- **依赖**:新增 `@monaco-editor/react` (~30KB gzip + monaco worker chunk lazy-loaded);保留 `@uiw/react-md-editor` 一段时间可以,但这次直接拆掉以减少打包体积
- **测试**:`readme-editor.test.tsx` 需要 mock Monaco(它依赖 `window` + worker),plain fallback 路径单测必须覆盖
- **样式**:Monaco 默认主题需要跟 shadcn 的 light/dark token 对齐(用 Monaco 的 `defineTheme` 读取 CSS 变量)
- **不影响**:后端 `PUT /api/readme`、front matter 解析、conflict 检测算法、JOURNAL/HYPOTHESES 编辑流(本次仅限 README)
