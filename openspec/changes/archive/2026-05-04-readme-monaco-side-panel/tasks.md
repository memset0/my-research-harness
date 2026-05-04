## 1. 依赖与基础设施

- [x] 1.1 `pnpm --filter @memon/web add @monaco-editor/react`,确认版本 ≥ 4.6,并在 `apps/web/package.json` 检查不要把 `monaco-editor` 拉到 dependencies 顶层(让 react wrapper 自己 lazy load)
- [x] 1.2 `apps/web/hooks/use-is-desktop.ts`:复刻 `use-mobile.ts` 的结构,断点 1024,return `boolean | undefined`(undefined 表示 SSR 阶段)
- [x] 1.3 `apps/web/hooks/use-is-desktop.test.ts`:vitest + jsdom mock `window.matchMedia`,覆盖 ≥1024 / <1024 / resize 切换三个 case

## 2. 编辑器上下文与持久化

- [x] 2.1 `apps/web/components/readme-editor-context.tsx`:导出 `ReadmeEditorProvider`、`useReadmeEditor()`;state 形状 `{ open, setOpen, collapsed, setCollapsed, width, setWidth }`,value 用 `useMemo`
- [x] 2.2 `apps/web/lib/readme-editor-prefs.ts`:封装 `localStorage` 读写,导出 `readPlainPref()` / `writePlainPref(v)` / `readWidthPref()` / `writeWidthPref(px)`;all wrap try/catch
- [x] 2.3 单测 `readme-editor-prefs.test.ts`:mock localStorage,覆盖读默认值、写、读异常吞没

## 3. 工具栏组件

- [x] 3.1 `apps/web/components/readme-editor-toolbar.tsx`:props `{ content, plain, onPlainChange, onCopy, dirty, onSave, saving, extra? }`;布局 = 左侧 path + dirty 标记,右侧 plain toggle + copy + save + extra(close/collapse 按钮由父组件传入)
- [x] 3.2 plain toggle 用 shadcn `<Toggle>` 或 `<Button variant="ghost">`(选 toggle 显式 pressed 状态);copy 用 `<Button>` + `lucide-react Copy` icon
- [x] 3.3 单测 `readme-editor-toolbar.test.tsx`:点击 toggle/copy 触发回调,disabled 状态(saving 时全部禁用)

## 4. Monaco 与 Plain 渲染层

- [x] 4.1 `apps/web/components/readme-monaco.tsx`:`dynamic(() => import('@monaco-editor/react'), { ssr: false, loading: <Skeleton/> })`;props `{ value, onChange, onLoadError }`;onMount 调 `monaco.editor.defineTheme('memon-light', ...)`(色值用 D7 方法从 CSS 变量提取,遇错降级 vs)
- [x] 4.2 Monaco 配置:`language='markdown'`、`wordWrap='on'`、`lineNumbers='off'`、`minimap.enabled=false`、`fontFamily='ui-monospace, ...'`、`fontSize=13`、`automaticLayout=true`(让它跟容器一起 resize)
- [x] 4.3 `apps/web/components/readme-plain.tsx`:原生 `<textarea>` + `font-mono`,受控 value/onChange,`autoFocus`,`spellCheck=false`,`className` 走 cn(monospace + leading-relaxed)
- [x] 4.4 onMount 失败 → 把 `onLoadError(err)` 抛给父级,父级切到 plain + toast(走 spec 的 fallback 路径)

## 5. 重写 ReadmeEditor 主组件

- [x] 5.1 `apps/web/components/readme-editor.tsx`:抽出现有的 phase state machine、draft load/save、autosave、conflict 处理 — 这块逻辑保持原样
- [x] 5.2 抽出新的 `<EditorBody>` 子组件:接收 `{ content, setContent, plain, onPlainChange, ... }`;内部根据 `plain` 渲染 `<ReadmeMonaco>` 或 `<ReadmePlain>`,共享同一 `content` state
- [x] 5.3 把现有 toolbar (path + Save + Cancel) 替换成新的 `<ReadmeEditorToolbar>`,把 plain/copy 按钮编织进去
- [x] 5.4 conflict 视图保留 react-diff-viewer-continued,只是父容器变(由调用方决定 Dialog or panel)
- [x] 5.5 删除对 `@uiw/react-md-editor` 的 dynamic import 和所有引用
- [x] 5.6 `apps/web/package.json` 移除 `@uiw/react-md-editor`(若没有其它引用)

## 6. 桌面 Side Panel

- [x] 6.1 `apps/web/components/readme-side-panel.tsx`:外层是 `aside`,根据 context 的 `open` / `collapsed` / `width` 渲染不同形态;内部包 `<ReadmeEditor>`(传一个 `containerKind: 'panel'` prop 让它知道不该自动关闭)
- [x] 6.2 折叠态:32px 宽 vertical handle,显示 vertical text "Edit README" + 一个 ≪ icon;整块 click 触发 expand;有 `aria-label="Expand README editor"`
- [x] 6.3 拖拽改宽:左边缘 4px wide div,`onMouseDown` 进入 drag 模式,document 上挂 mousemove/mouseup,实时更新 `width` ref → DOM style;mouseup 时 setState + persistWidth
- [x] 6.4 拖拽时给 `document.body` 加 class `select-none cursor-col-resize`,松开移除
- [x] 6.5 关闭按钮(X):toggle context.open=false,不 unmount Monaco(用 CSS hide)— 不,直接 unmount,保持简单;dirty state 走 React 的 unmount cleanup 已经处理了 draft autosave

## 7. EditReadmeButton 与详情页接线

- [x] 7.1 `apps/web/components/edit-readme-button.tsx`:在桌面端走 context 的 `setOpen(true)`,移动/平板端保持原 local state + Dialog 路径(同一个组件内部根据 `useIsDesktop()` 分流)
- [x] 7.2 按钮文案不变(`Edit README`);desktop 已开 panel 时按钮变 `Hide editor`(toggle off)
- [x] 7.3 `apps/web/components/experiment-detail.tsx`:用 `<ReadmeEditorProvider>` 包住整个详情页;布局上,desktop 时根据 `useReadmeEditor().open && !collapsed` 决定主内容区 grid 是 `1fr` 还是 `1fr <panelWidth>px`;`<ReadmeSidePanel>` mount 在最右侧
- [x] 7.4 mobile/tablet 下 panel 不渲染(只渲染 Dialog),detail 内容区始终满宽
- [x] 7.5 跨视口切换:用 `useIsDesktop()` 切换时,如果原来 panel 开着且现在变小屏 → 自动迁移到 Dialog(保留 content state — 通过 context 共享解决)

## 8. 测试

- [x] 8.1 `apps/web/components/readme-editor.test.tsx`:全部 mock `@monaco-editor/react` 为 textarea-like,保留原有 save / conflict / draft recovery / cancel 测试,把 MDEditor 相关断言换成 monaco-mock
- [x] 8.2 新增 plain toggle 单测:点 toggle → `localStorage` 写入 `'1'` → 重新挂载默认渲染 plain
- [x] 8.3 新增 copy markdown 单测:mock `navigator.clipboard.writeText`,resolve 路径断言 toast,reject 路径断言文本被选中 + fallback toast
- [x] 8.4 新增 Monaco load failure 单测:让 dynamic import reject,断言自动切到 plain + toast
- [x] 8.5 `readme-side-panel.test.tsx`:context provider 包住,断言 expanded/collapsed/width 三个形态的 DOM;模拟拖拽 mousedown→mousemove→mouseup,断言 width 写 localStorage
- [x] 8.6 `experiment-detail.test.tsx`(若已有则补,否则新建):desktop viewport 下点击 button 渲染 panel 不渲染 Dialog;mobile viewport 下相反

## 9. 验证

- [x] 9.1 `pnpm --filter @memon/web typecheck` 干净
- [x] 9.2 `pnpm --filter @memon/web test` 全过
- [x] 9.3 `openspec validate readme-monaco-side-panel --type change --strict` 干净
- [x] 9.4 真机验证(走 CLAUDE.md F1 协议):dev server 起,curl 详情页 HTML grep `data-testid="readme-side-panel"` 或类似 anchor;curl `_next/static/css/app/layout.css` grep `--background` / `--foreground` 等 token 还在
- [x] 9.5 浏览器手动 smoke:
   - 桌面 viewport 点 Edit README → 右侧 panel 出现 → 输入文字 → 点 copy → 粘贴板有内容 → 点 plain toggle → textarea 替换 monaco → 刷新页面再开依然 plain → 点 collapse → 变 32px handle → 点 handle → 展开 → 拖左边改宽 → 刷新 → 宽度恢复 → 点 close → panel 消失
   - 平板 viewport (DevTools 设 800px) → 点 Edit README → 弹 Dialog
   - 手机 viewport (375px) → 点 Edit README → 弹 Dialog
   - DevTools 把视口从 1280 → 600 → panel 应迁移到 Dialog,内容不丢
- [x] 9.6 conflict 路径回归:在两个 tab 同时编辑,save 第二个,断言 diff 视图正确出现在 panel(desktop)/ Dialog(mobile)
