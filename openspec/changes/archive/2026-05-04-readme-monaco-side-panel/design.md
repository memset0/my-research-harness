## Context

`apps/web/components/readme-editor.tsx` 当前是一个全屏 `<Dialog>` 包住 `@uiw/react-md-editor`(下称 MDEditor)。MDEditor 是 WYSIWYG-lite,对长篇 markdown 散文(README 通常是 100+ 行)的纯文本编辑友好度差(光标行为、行选区、键盘快捷键、查找替换都不像代码编辑器)。同时全屏弹窗遮住正文,迭代写作时的"读一段→改一段"心智成本很高。本次目标是替换内核 + 改桌面布局,但**保留**所有已经稳定工作的子系统:debounced autosave、草稿恢复、`expectedMtime`/`expectedHash` 乐观锁、conflict diff 视图。

## Goals / Non-Goals

**Goals:**

1. 替换编辑器内核为 `@monaco-editor/react`,保留 markdown 高亮和 keymap。
2. 桌面端 (≥1024px) 把编辑器从弹窗改为右侧常驻分栏,正文和编辑器并排可见。
3. 桌面端 panel 可折叠 / 展开 / 拖拽改宽,宽度持久化。
4. 编辑器工具栏:plain editor 切换(localStorage 偏好)、copy markdown 按钮。
5. 移动端 (<768px) 和平板 (768–1023px) 保持现有 `<Dialog>` 全屏体验,仅内核换 Monaco。
6. 不破坏 conflict 解决、草稿恢复、autosave 任何已有行为。

**Non-Goals:**

1. JOURNAL.md / HYPOTHESES.md 编辑器(本次仅 README)。
2. 实时 Markdown 预览(MDEditor 那种 split-pane 不再支持;Monaco 写源码,预览靠详情页本身)。
3. 多文件 / 多 tab 编辑(Monaco 支持,但本次只编一个 README)。
4. dark mode 完整适配(出品 light theme 即可,后续若有 dark mode 再统一)。
5. 自定义 Monaco 主题(用 vs 默认 light + 微调字号即可)。

## Decisions

### D1. 编辑器选 Monaco 而不是 CodeMirror 6 / Lexical

- **选择**:`@monaco-editor/react` (官方 React wrapper)。
- **理由**:用户熟悉 VSCode keymap,markdown 高亮开箱即用,查找替换 / multi-cursor / 行操作都是 VSCode 一致的。CodeMirror 6 体积小但 markdown grammar 要单独装,Lexical 是 WYSIWYG 框架不符合"想写源码"的诉求。
- **取舍**:Monaco bundle 大(~5MB 含 worker),但 `@monaco-editor/react` 默认按需加载 worker,首屏只多 ~30KB gzip 的 loader。详情页本身不会触发加载,只有用户点 "Edit README" 才拉。

### D2. 桌面 / 平板 / 手机断点

- **选择**:沿用 Tailwind 默认 — 桌面 ≥1024px (`lg:`),其余走弹窗。
- **理由**:Tailwind v4 已经在用,无需引入新断点常量。1024 是大多数笔记本横屏的下限,刚好够正文 (~600px) + 编辑器 (~400px)。
- **实现**:新建 `apps/web/hooks/use-is-desktop.ts`,跟现有 `use-mobile.ts` 同结构(`matchMedia('(min-width: 1024px)')`),`useIsMobile` 也保留(它有调用方)。
- **取舍**:为什么不复用 `useIsMobile` 的反值?因为 `!isMobile` 把平板 (768–1023) 算成桌面,这跟用户要求(平板走弹窗)冲突。两个独立的 hook 更直白。

### D3. 桌面 panel 与按钮联动

- **选择**:用 React Context (`ReadmeEditorContext`),provider 挂在 `experiment-detail.tsx`,内部维护 `{ open, setOpen, collapsed, setCollapsed }`。`<EditReadmeButton>` 和 `<ReadmeSidePanel>` 都消费它。
- **理由**:URL search param 会污染 query string + 移动端有冗余 state;Zustand 引入新依赖不划算;Context 在单一详情页内 prop drilling 也行,但用 context 后 sidebar 自己的折叠按钮可以反过来 toggle 按钮的视觉状态。
- **取舍**:Context 只在详情页 scope 内;切实验或离开详情页都会重置。这是期望行为(关闭一个实验的编辑器后切到另一个不该弹出来)。

### D4. Plain mode 是 `<textarea>` 不是 shadcn `<Input>`

- **选择**:原生 `<textarea>` + `font-mono` + 受控 value/onChange,跟 Monaco 共享同一个 `content` state。
- **理由**:`<Input>` 是单行;shadcn `<Textarea>` 可以,但 plain 模式的卖点就是"完全不依赖任何复杂组件",原生 textarea 更稳。
- **持久化**:`localStorage['memon:readme-editor:plain']` 存 `'1'`/`'0'`,默认 `'0'`(Monaco 优先)。Monaco 加载失败(dynamic import reject)时自动切换到 plain 并 toast 提示。

### D5. Copy markdown 走 navigator.clipboard,失败 fallback 选中

- **选择**:`navigator.clipboard.writeText(content)`;catch 后选中 textarea 文本提示用户手动 Cmd+C。
- **理由**:跟现有 agent-handoff 的 copy prompt 实现一致,逻辑可复用。memon 跑在 localhost / https 反代后,clipboard API 都可用。
- **取舍**:不做 toast 队列 / 防抖;一次点击 → 一次 toast。

### D6. 折叠态 UX

- **展开**:右侧 panel 占 `clamp(320px, persistedWidth, 50vw)`;顶部工具栏右上角有"≫"按钮折叠。
- **折叠**:panel 收成一个 32px 宽的垂直 handle,显示竖排 "Edit README" 文字 + 一个"≪"图标;点击 handle 任意位置展开。
- **拖拽改宽**:左侧边缘 4px wide drag handle(`cursor: col-resize`),拖动改宽,松开后写入 `localStorage['memon:readme-editor:width']` (px 数值)。
- **理由**:折叠态留把手而不是完全消失,是为了不丢失"我开着编辑器"这个上下文(尤其切实验后想再编辑同一个);完全消失等价于关闭。

### D7. Monaco theme 跟 shadcn 对齐

- **选择**:用 Monaco 的 `monaco.editor.defineTheme('memon-light', { ... })`,colors 直接从 `getComputedStyle(document.documentElement).getPropertyValue('--background')` 等读取(在 onMount 阶段)。
- **理由**:CSS 变量是 oklch(),Monaco 接受 `#rrggbb` 也接受其它格式 — 用 oklch 直接传字符串有兼容风险,所以用 `<canvas>` 的 `fillStyle` 把 oklch 强转 hex 后塞给 Monaco。
- **退而求其次**:如果 oklch → hex 转换出问题(老 Chromium / 内嵌浏览器),用 vs 默认 light theme,不影响功能。

## Risks / Trade-offs

- **[Monaco bundle 体积]** Lazy chunk 实际下载 ~1.5MB(workers 自动分包);首次点击 "Edit README" 后会有 200–500ms 加载延迟 → **Mitigation**:loading state 显示骨架 + "loading editor…" 文字;加载失败 toast + 自动切 plain。
- **[SSR / hydration]** Monaco 不能 SSR(`window` 未定义) → **Mitigation**:`dynamic(() => import('@monaco-editor/react'), { ssr: false })`,沿用现有 MDEditor 的写法。
- **[Context provider 增加 re-render]** open/collapsed/width 变更可能导致整个详情页 re-render → **Mitigation**:context value 用 `useMemo`;width 改变只在 mouse-up 时持久化 + 触发 setState,拖拽过程用 ref + DOM 直接改宽度。
- **[Test mocking]** Monaco 在 jsdom 下不能跑 → **Mitigation**:`vi.mock('@monaco-editor/react', () => ({ default: ({ value, onChange }) => <textarea data-testid="monaco-mock" value={value} onChange={(e) => onChange(e.target.value)} /> }))`;plain 模式直接渲染原生 textarea,可直接断言。
- **[Clipboard 在不安全 context]** memon 跑 http://localhost 是安全 origin,但通过 IP / 0.0.0.0 暴露给团队时可能不是 → **Mitigation**:catch + fallback 到选中 + 提示。
- **[拖拽改宽和详情页滚动冲突]** 全局 mousedown 监听需要 stopPropagation → **Mitigation**:仅在 handle 元素上注册;拖拽过程在 document.body 加 `cursor: col-resize` + `user-select: none` class,防止文本选中。
- **[现有测试 readme-editor.test.tsx 会大幅破]** 因为组件结构变了 → **Mitigation**:重写测试,保留覆盖率(save / conflict / draft recovery / plain toggle / copy / desktop panel render),把对 MDEditor 的断言换成 monaco-mock。

## Migration Plan

无 data migration。前端组件替换是部署即生效。回退方案:revert PR 即恢复 MDEditor。`localStorage` 新增的 key (`memon:readme-editor:plain`, `memon:readme-editor:width`) 不存在时取默认值,不需要清理。

## Open Questions

无。
