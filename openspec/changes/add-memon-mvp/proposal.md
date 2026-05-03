## Why

研究流程中实验数量爆炸式增长(以前一周几个,现在 agent 一天能跑十几个),`logs/` 目录里几十个实验混在一起难以追踪——哪些在跑、哪些 crash、跑了什么、验证了哪个假说,全靠人脑或反复问 agent。已有的痛点包括:实验状态需要手动 squeue 查、结果要手动整理 README、假说和实验的关联关系没有数据结构、跨项目检索困难、agent 写的实验记录质量参差且分散。需要一个**单用户、本地运行、文件系统驱动**的实验管理面板,把"实验目录扫描 + 结构化记录 + 假说追踪 + 事件流"统一起来,既给人看(响应式 web 面板)也给 agent 用(CLI 检索接口)。

## What Changes

- 新增 `memon` 包(npm 全局安装),提供 CLI(`memon serve|list|show|search|new|hypo|mock`)与 Next.js 15 + shadcn/ui 前后端一体的 web 面板
- 约定一组**文件系统格式**作为唯一 source of truth:
  - 每个实验目录维护 `README.md`(YAML front matter + Motivation/Setup/Method/Result/Conclusion/Caveats/Artifacts/(可选)New Hypotheses 章节)
  - 每个项目根维护 `HYPOTHESES.md`(summary table + 编号假说,5 态 emoji)
  - 每个项目根维护 `JOURNAL.md`(`last_digest_at` frontmatter + `[CREATE]/[STATUS]/[NOTE]/[REQUEST]/[ARCHIVE]/[ERROR]` 事件行)
- 实验目录通过正则 `^.+-\d{6}-\d{6}$` 在配置的 project root 下递归发现(无视父目录是否叫 `logs`),内置 exclude 默认值(`.git`/`node_modules`/`__pycache__`/`.venv`/`venv`/`.cache`)
- 文件变化检测**禁用 fs watcher**,改用**轮询 + 指数退避**(1s→5min,backoff factor 2),适配集群 inotify 限制
- 实验状态使用 5 态 enum(`PENDING`/`RUNNING`/`FINISHED`/`FAILED`/`UNKNOWN`),由 agent 写入 front matter,前端可直接编辑(写回 README + JOURNAL 双写)
- 大日志 tail 自实现 LineIndex(行号 ↔ byte offset 缓存),支持绝对行号显示、SSE 实时跟随、向上无限滚动
- README 编辑采用 mtime 乐观锁:写入时携带 `expectedMtime`,冲突返回 409 + 当前内容;前端 localStorage 草稿恢复
- 时间戳一律 ISO8601 + 时区 offset(本机时区写入,前端按浏览器时区渲染)
- 配置文件 `<repo>/config.yml`(gitignored)+ `<repo>/config.example.yml`(脱敏,提交);CLI 默认 cwd 找,`--config` 覆盖
- Mock 数据 `<repo>/mock/<project>/...`,git 跟踪;`memon mock seed` 复制到 dev 路径方便本地起站

## Capabilities

### New Capabilities

- `experiment-discovery`: 递归扫描配置的 project roots,通过目录名正则识别实验目录,应用 exclude 规则,以指数退避轮询变化
- `experiment-readme`: 实验 README.md 的 schema(front matter + 必选/可选章节)、解析、校验、mtime 乐观锁写入
- `hypotheses`: HYPOTHESES.md schema(summary table + per-hypothesis entry + 5 态 emoji)与实验↔假说交叉引用
- `journal`: JOURNAL.md schema(frontmatter `last_digest_at` + 事件行格式)、追加协议、整理协议
- `log-viewer`: 大日志高性能 tail(LineIndex 缓存、绝对行号、SSE 实时推送、向上无限滚动加载)
- `memon-cli`: `memon` 命令行工具(`serve`/`list`/`show`/`search`/`new`/`hypo`/`mock seed`)与 JSON 输出协议
- `web-dashboard`: Next.js 15 App Router + shadcn/ui + Tailwind v4 前端面板(实验列表/详情/编辑/假说视图/JOURNAL 视图)

### Modified Capabilities

(无;首次创建,无既有 spec)

## Impact

- **新仓库结构**:`pnpm` monorepo 形态(`packages/cli`、`apps/web`、`packages/core` 共享 schema/解析/索引),根目录 `mock/`、`config.example.yml`
- **运行时依赖**:Node.js ≥ 20.19,无外部 DB,无 fs watcher
- **磁盘约定**:任何符合实验目录正则的子目录都会被识别为实验;新增 `HYPOTHESES.md`/`JOURNAL.md` 在项目根
- **未纳入 MVP(后置)**:Skill 包(系统稳定后再设计)、跨多机/SLURM agent、嵌入式 web terminal、GPU/磁盘资源监控(API hook 位预留)、WandB iframe、旧实验一次性 import 工具
