## Why

`add-memon-mvp` / `add-write-flow` / `add-sidebar-and-log-tools` 三个 change 都把组件 + 集成测试推到了"后续 round",原因相同:vitest + jsdom + monorepo 路径解析在 Next.js 15 + Tailwind v4 + shadcn 的栈下要跑通需要一次集中配置,功能侧迭代时不想边做边折腾测试栈。现在核心功能已稳定,该把这部分基建一次性补齐。

## What Changes

1. **测试基础设施**(`apps/web/vitest.config.ts` + setup):vitest + jsdom + `@testing-library/react` + `@/` 路径别名 + Tailwind class 兜底(testing 时不需要真实样式编译)
2. **组件测试**(`apps/web/components/*.test.tsx`):
   - `ReadmeEditor`:load → debounced draft → save 200 / 409 冲突 → "Keep mine" 覆盖路径 → draft recovery prompt
   - `LogViewer`:搜索匹配计数 + next/prev、行选中 + URL hash、SSE `append` 事件触发 "N new lines" 浮标
   - `AppSidebar`:折叠展开 + localStorage 持久化
   - `AgentHandoffDialog`:prompt 拼装(experiment id / README path / journal 事件 ≤10)+ clipboard 成功 toast
   - `StatusEdit`:PATCH 成功 + 409 冲突
   - `NewExperimentModal`:name 校验 + 201 跳转 + 409 inline error
3. **后端集成测试**(`apps/web/app/api/*/route.test.ts`,基于真实 `mock/` fixtures):
   - `/api/experiments` 索引 + `stale` 标志
   - `/api/hypotheses` 解析
   - `/api/journal/append` `[NOTE]` 写入(不动 frontmatter)
   - `/api/readme` PUT 200 / 409 mtime 冲突 / 403 路径越界
   - `/api/log` 范围读取 + path safety
   - `/api/log/stream` SSE `ready` 事件包含 `totalLines`

## Capabilities

### New Capabilities

(无新业务 capability — 本 change 只新增工程基建,不改变运行时行为)

### Modified Capabilities

(无)

## Impact

- **新增 dev deps**:`vitest`、`@vitest/ui`、`jsdom`、`@testing-library/react`、`@testing-library/jest-dom`、`@testing-library/user-event`
- **新增配置**:`apps/web/vitest.config.ts`、`apps/web/test/setup.ts`
- **新增测试文件**:`*.test.tsx` / `*.test.ts` 与被测代码同级(就近原则)
- **CI**:本期暂不接入 GitHub Actions,本地跑 `pnpm test`;CI 留下一轮
- **不改变**:任何运行时逻辑、API 行为、UI
