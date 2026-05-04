## Why

详情页里已经有 "Ask Claude Code" 按钮,但它只是把 prompt 复制到剪贴板,然后让我自己开终端 `cd <root> && claude` 粘贴。这中间手动跳转的成本不小。我希望直接在网页里就能跑一个 claude code 终端,而且这个终端要跑在 tmux 里,这样我事后 ssh 上去能 `tmux attach` 接管同一个会话(网页关了 / 浏览器崩了 / 想离线继续都行)。

## What Changes

1. **新增 ttyd 子进程编排**:memon 后端按需起一个 `ttyd` 进程(C 二进制,自带 xterm.js 前端 + WebSocket),命令是 `tmux new-session -A -s memon-claude-<expid> claude`。`-A` = "attach if exists, create if not",所以同一个实验反复打开都连到同一个 tmux session。
2. **新增 API**:
   - `POST /api/terminal/start` body `{ experimentId, projectName }` → 启动 ttyd(若没起),返回 `{ url, sessionName, port }`
   - `POST /api/terminal/stop` body `{ sessionName }` → kill ttyd(tmux session 不动,detached 状态保留)
   - `GET /api/terminal/list` → 当前活跃的 ttyd 进程列表
3. **前端**:
   - 详情页 "Ask Claude Code" 按钮旁边加一个 "Open in browser" 按钮 → 打开一个 shadcn `<Sheet>`(右侧滑出)或全屏对话框,内部 `<iframe>` 指向 ttyd URL
   - 第一次打开时,先调 `/api/terminal/start`,收到 url 再载入 iframe
   - 关闭面板时调 `/api/terminal/stop`(可选;tmux session 留着没问题)
4. **Caddy 反向代理**:`/api/terminal/proxy/<sessionName>/*` → `localhost:<port>/*`(memon 后端代理一层,前端 iframe 永远走 memon 自己的域名,不暴露内部端口)。
5. **ttyd 二进制由 memon 自管理**:**不依赖系统包管理器**(用户跑在共享集群,通常没 root)。memon 在首次需要时,从 GitHub Releases 拉一份对应架构的预编译静态二进制(`ttyd.x86_64` / `ttyd.aarch64` 等),校验后缓存到 `~/.cache/memon/bin/ttyd-<version>-<arch>`。后续直接复用。
   - 上游 release 提供静态链接二进制(linux x86_64 / aarch64 / armhf / i686 / mips...)→ 不需要任何 build chain
   - 版本号在 memon 源码里硬编码(初版锁 `1.7.7`),需要升级时改源码 + 重启
   - macOS 没有官方预编译 → fallback 提示用户 `brew install ttyd`(macOS 一般有 brew,且 memon 主战场是 Linux cluster)
6. **运维**:仅要求 `tmux` 在 PATH(集群上通常有)。

**约束**:
- v1 同一时刻只允许 1 个活跃终端(单端口 7682,新启就 kill 旧的)。多终端并发留给 v2。
- ttyd 默认绑定 localhost,只通过 memon 的反代暴露 → 不会被外网直连。
- tmux session 命名遵循 `memon-claude-<expid>`(20+ 字符,与已有 tmux 不冲突)。
- 不持久化 session 状态(进程列表只在内存),重启后 tmux session 还在,按钮重新点会重新起 ttyd 接上。
- 二进制下载是一次性的(~5MB),命中缓存后 0 网络。

## Capabilities

### New Capabilities

- `browser-terminal`:网页内 xterm 终端 + 后端 ttyd 编排 + tmux 持久化,定义启动/停止/proxy 的契约

### Modified Capabilities

(无;`agent-handoff` capability 已归档,本 change 是它的补充而非修改 — 复制 prompt 的流程不变,只是加了一个并行入口)

## Impact

- **系统依赖**:仅 `tmux` 必须在 `PATH`(集群通常有);`ttyd` **不需要**预装,memon 自动 fetch + cache。
- **新增前端依赖**:无 — 只用 iframe 加载 ttyd 自带的 xterm.js,不引 `xterm` npm 包。
- **新增后端代码**:`apps/web/lib/terminal/manager.ts`(子进程生命周期 + 端口分配)、`apps/web/app/api/terminal/{start,stop,list,proxy/[...path]}/route.ts`。
- **新增前端组件**:`apps/web/components/terminal-sheet.tsx`(打开按钮 + Sheet/Dialog + iframe)。
- **Caddy 配置**:不需要新规则 — 走 memon 自己的 `/api/terminal/proxy/*` 路径,memon 已经在反代下。
- **安全**:proxy 路由内部把 sessionName 映射到端口,sessionName 走 path safety 检查(只接受 `^memon-claude-[a-zA-Z0-9_-]+$` 格式)。
- **不改变**:已有的 "Ask Claude Code"(复制 prompt)按钮保留,作为低成本的第二选项。
