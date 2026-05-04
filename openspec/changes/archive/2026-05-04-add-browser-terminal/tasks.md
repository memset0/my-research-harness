## 1. ttyd 二进制管理(自下载,零 root)

- [x] 1.1 在 `apps/web/lib/terminal/binary.ts` 定义 `TTYD_VERSION = '1.7.7'` + arch 映射 (`x64→x86_64`, `arm64→aarch64`, `arm→armhf`, `ia32→i686`, `mips→mips`, `mipsel→mipsel`) + `cachePath()` 返回 `~/.cache/memon/bin/ttyd-<v>-<arch>`
- [x] 1.2 实现 `probeTtyd()`:先看 cache(存在 + 可执行 + `--version` 与 `TTYD_VERSION` 匹配),再 fallback 到 `which ttyd`,返回 `{ available, version?, source?, downloadable?, suggestion? }`
- [x] 1.3 实现 `installTtyd()`:in-process mutex(防止并发);若 cache 已 valid → 立即返回 `alreadyPresent: true`;否则用 Node 内置 `fetch` 拉 `https://github.com/tsl0922/ttyd/releases/download/<v>/ttyd.<arch>`,stream 到 `<cache>/.tmp.<rand>`,同步拉 `.sha256` 文件并校验,通过则 `fs.chmod(0o755)` + `fs.rename` 到正式路径;失败清掉 tmp
- [x] 1.4 macOS 处理:`installTtyd()` 在 `process.platform === 'darwin'` 直接抛 `NotAutofetchable` 错(supported error class);`probeTtyd()` 在 darwin 给 `downloadable: false, suggestion: 'brew install ttyd'`
- [x] 1.5 单元测试 `binary.test.ts`:mock `node:fetch` + `node:fs`,覆盖 cache hit / fresh download / sha256 mismatch / network error / concurrent calls 的串行化

## 2. ttyd 进程编排

- [x] 2.1 `apps/web/lib/terminal/manager.ts`:`startSession({ experimentId, projectName })` / `stopSession(sessionName)` / `listSessions()`;内部维持 `current: { child: ChildProcess; sessionName; port; startedAt; experimentId; projectName } | null`
- [x] 2.2 `startSession` 校验 experimentId(`^[a-zA-Z0-9._-]+$`),不通过抛 BadRequest
- [x] 2.3 `startSession` 若 `current` 已存在,先 SIGTERM child,2 秒后没退就 SIGKILL,然后重置 `current`
- [x] 2.4 `startSession` 解析要用的 ttyd 路径:cache 优先,fallback 到 PATH,都没有就抛 `TtydUnavailable`
- [x] 2.5 `startSession` 用 `child_process.spawn` 启动 `<ttyd> -p 7682 -i 127.0.0.1 --writable tmux new-session -A -s memon-claude-<id> claude`,捕获 stderr 前 200 字节作为 warnings
- [x] 2.6 注册 `process.on('SIGINT' | 'SIGTERM' | 'beforeExit')` → kill child,不动 tmux session

## 3. API 路由

- [x] 3.1 `apps/web/app/api/terminal/check/route.ts` GET → 调 `probeTtyd()`,200 返回检查结果
- [x] 3.2 `apps/web/app/api/terminal/install/route.ts` POST → 调 `installTtyd()`,200 `{ ok: true, version, path, alreadyPresent? }` / 502 `DOWNLOAD_FAILED` / 502 `INTEGRITY_FAILED` / 501 `NOT_AUTOFETCHABLE`(macOS)
- [x] 3.3 `apps/web/app/api/terminal/start/route.ts` POST 用 zod 校验 body,调 `manager.startSession`,响应 `{ sessionName, url, port, warnings? }`
- [x] 3.4 `apps/web/app/api/terminal/start` ttyd 不存在 → 503 `{ error: { code: 'TTYD_UNAVAILABLE', message: '..run /api/terminal/install first' } }`
- [x] 3.5 `apps/web/app/api/terminal/stop/route.ts` POST `{ sessionName }` → 调 `manager.stopSession`,200 `{ stopped: bool }`
- [x] 3.6 `apps/web/app/api/terminal/list/route.ts` GET → 调 `manager.listSessions()`,200 `{ sessions: [...] }`
- [x] 3.7 不要在任何 route 里实现 `/api/terminal/proxy/*`(由 Caddy 直通到 ttyd);加一个占位 route 返回 503 + 提示用户配置 Caddy

## 4. 前端

- [x] 4.1 `apps/web/lib/api.ts` 加 `checkTerminal`、`installTerminal`、`startTerminal`、`stopTerminal`、`listTerminals` client wrappers
- [x] 4.2 `apps/web/components/terminal-sheet.tsx`:`<TerminalSheet>` 组件,内部用 shadcn `<Sheet side="right">`(或 mobile 上 `<Dialog>` 全屏)+ `<iframe>`;props `{ open, onOpenChange, experiment }`
- [x] 4.3 在 sheet open 时调 `startTerminal` → 拿到 url 后载入 iframe;close 时 `stopTerminal`(fire-and-forget)
- [x] 4.4 `apps/web/components/terminal-button.tsx`:`<TerminalButton experiment>`;mount 时调一次 `checkTerminal`,3 态:
   - `available: true` → 蓝色按钮 "Open in browser",点 = 打开 sheet
   - `downloadable: true` → 灰按钮 "Install ttyd (5MB)",点 = 调 `installTerminal` + 进度态;成功后自动转到 `available`
   - `downloadable: false` → 灰按钮 + tooltip 显示手动 `suggestion`
- [x] 4.5 在 `apps/web/components/experiment-detail.tsx` header 把 `<TerminalButton>` 插在 `<AskClaudeCodeButton>` 旁边
- [x] 4.6 install 进行中显示 spinner + 估计时间("downloading 5MB...")

## 5. Caddy 反代配置

- [x] 5.1 `Caddyfile` snippet 加 `@terminal path /api/terminal/proxy/*` + `reverse_proxy @terminal localhost:7682 { flush_interval -1 }`,在 memon 主 reverse_proxy 之前
- [x] 5.2 README 加一段 Caddy snippet,告诉用户复制并 `caddy reload`
- [x] 5.3 dev 环境(localhost:3737 不走 Caddy)说明:可以直接 iframe `http://localhost:7682/`,不走代理也行,但生产推荐 Caddy 路径

## 6. 测试

- [x] 6.1 `apps/web/lib/terminal/binary.test.ts`:mock `node:fetch` + `node:fs`,覆盖 cache hit / 全新下载(含 sha256 校验) / 网络失败 / sha256 不匹配 / 并发请求被串行化 / macOS 走 NotAutofetchable 路径
- [x] 6.2 `apps/web/lib/terminal/manager.test.ts`:`vi.mock('node:child_process')`,覆盖 experimentId 校验、命令拼接、kill 老进程后 spawn 新的、stop 不杀 tmux
- [x] 6.3 `apps/web/app/api/terminal/check/route.test.ts`:mock `probeTtyd`,断言响应形状(available/cached/path/downloadable/macOS)
- [x] 6.4 `apps/web/app/api/terminal/install/route.test.ts`:mock `installTtyd`,200 / 502 DOWNLOAD_FAILED / 502 INTEGRITY_FAILED / 501 NOT_AUTOFETCHABLE
- [x] 6.5 `apps/web/app/api/terminal/start/route.test.ts`:mock manager,验证 BadRequest / TTYD_UNAVAILABLE / 200 响应
- [x] 6.6 `apps/web/components/terminal-button.test.tsx`:三态(available / downloadable / 手动 install)各一个 case

## 7. 文档

- [x] 7.1 README 加 "Browser terminal" 一节:`tmux` 是唯一系统依赖、ttyd 由 memon 自动 fetch、Caddy 配置 snippet、`/api/terminal/check` 自检
- [x] 7.2 README 单独写:"网页关掉后,要继续 agent 会话,在 ssh 上跑 `tmux attach -t memon-claude-<expid>`"
- [x] 7.3 README 写一行:"如果你想自己提供 ttyd(比如装在了别的位置),把它放进 PATH 即可被识别;`/api/terminal/install` 主要给完全没装的情况"

## 8. 验证

- [x] 8.1 `pnpm typecheck` 干净
- [x] 8.2 `pnpm test` 全过
- [x] 8.3 `openspec validate add-browser-terminal --type change` 干净
- [x] 8.4 真机验证:启动 memon → 详情页点按钮 → 触发 install(看到下载完成日志)→ 自动转 "Open in browser" → 看到 claude 终端 → 输入 `pwd` 看输出 → 关闭面板 → ssh `tmux attach -t memon-claude-<id>` → 能接管同一个 session
