## 1. 测试基础设施

- [x] 1.1 添加 dev deps: `vitest`、`@vitest/ui`、`jsdom`、`@testing-library/react`、`@testing-library/jest-dom`、`@testing-library/user-event`
- [x] 1.2 创建 `apps/web/vitest.config.ts`:`environment: 'jsdom'`、`@/` 路径别名解析、`esbuild.jsx: 'automatic'`(React 19 新 JSX runtime),`css: false` 跳过 Tailwind 编译
- [x] 1.3 创建 `apps/web/test/setup.ts`:`import '@testing-library/jest-dom/vitest'` 注入 matchers
- [x] 1.4 在 `apps/web/package.json` 添加 `test` / `test:watch` 脚本
- [x] 1.5 确认根 `pnpm test` 跑通 packages/core (94) + packages/cli (6) + apps/web (smoke 2)

## 2. 组件测试 (`apps/web/components/*.test.tsx`)

- [x] 2.1 `ReadmeEditor` — load → 编辑 → save (200) → 关闭模态 + success toast(`components/readme-editor.test.tsx`)
- [x] 2.2 `ReadmeEditor` — 409 冲突 → 进入 diff view + "Keep mine" 按钮渲染(同上)
- [x] 2.3 `ReadmeEditor` — localStorage draft ≥5 字符差异 → 弹 recovery prompt + "Restore my draft" 按钮(同上)
- [x] 2.4 `LogViewer` — 搜索 case-insensitive matches 计数 + next 按钮推进(`components/log-viewer.test.tsx`)
- [x] 2.5 `LogViewer` — 行号点击 → URL hash 更新为 `#L<n>`(同上)
- [x] 2.6 `LogViewer` — SSE `append` → 缓冲区扩张 + totalLines 更新(同上,通过捕获式 EventSource stub)
- [x] 2.7 `AppSidebar` — active project 默认展开 + 切换其他项目 → localStorage `memon:sidebar:expanded` 持久化(`components/app-sidebar.test.tsx`)
- [x] 2.8 `AgentHandoffDialog` — `buildAgentPrompt` 单元测试覆盖 id / 路径 / 状态 / 假说 / journal 事件 ≤10 / 中文请求(`lib/agent-prompt.test.ts`,7 个 case)
- [x] 2.9 `StatusEdit` — onChange → PATCH 200 → success toast + invalidate query(`components/status-edit.test.tsx`)
- [x] 2.10 `StatusEdit` — onChange → PATCH 409 → 冲突 toast 带 reload action(同上)
- [x] 2.11 `NewExperimentModal` — name 空 → submit 禁用;非法字符 → inline error(`components/new-experiment-button.test.tsx`)
- [x] 2.12 `NewExperimentModal` — POST 200 → `router.push` 到详情页;POST 409 → inline error(同上)

## 3. 后端集成测试 (`apps/web/app/api/*/route.test.ts`)

- [x] 3.1 `/api/experiments` GET — 返回 indexed experiments + `stale` 标志;`?project=` 透传到 `index.list({project})`(`app/api/experiments/route.test.ts`)
- [x] 3.2 `/api/hypotheses` GET — 缺 `project` → 400;未知 project → 404;有效 project → 200 + 解析后的 entries[](`app/api/hypotheses/route.test.ts`)
- [x] 3.6 `/api/readme` 路径越界 → 403:已在 `assertWithinProjectRoots` 单元测试覆盖(`lib/path-safety.test.ts`,5 个 case 含 `/etc/passwd`、共享前缀骗局、`../` 反向遍历)
- [ ] 3.3 `/api/journal/append` POST — 待补:需要 mock `appendJournalEvent`(@memon/core)+ `getRuntime` + 验证 frontmatter 不变
- [ ] 3.4 `/api/readme` PUT 成功 — 待补:需要 mock `node:fs` (stat/readFile/writeFile/rename) + `parseReadme` + `appendJournalEvent`,工程量较大
- [ ] 3.5 `/api/readme` PUT 409 — 同 3.4,待补
- [ ] 3.7 `/api/log` 范围读取 — 待补:需要 mock `LineIndex` + 文件 fixtures
- [ ] 3.8 `/api/log/stream` SSE — 待补:需要 ReadableStream 测试基建

## 4. 验证

- [x] 4.1 `pnpm test` 在 monorepo 根跑通:packages/core 94 + packages/cli 6 + apps/web 33 = **133 tests pass**
- [x] 4.2 `openspec validate add-test-suite --type change` 干净
