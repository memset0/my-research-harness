## Context

memon 现状:`AskClaudeCodeButton` 把生成好的 prompt + `cd <root> && claude` 命令复制到剪贴板,要求用户自己开终端粘贴。这个跳转有两个痛点:

1. 桌面 → 浏览器 → 终端的来回切换打断 flow
2. agent 在终端跑起来之后,如果要离开机器(笔记本休眠 / 切换 ssh 连接),要么人为干预把 claude 跑在 tmux 里,要么从头来过

理想方案是网页里直接显示终端,且终端绑定到一个 tmux session — 这样既解决了"嵌入"问题,也解决了"持久化"问题。

**已有约束**:
- 单用户开发工具,不需要多租户隔离
- 跑在共享集群上(`CLAUDE.md` 提到 inotify 限制),不能再多起 watcher
- Next.js 15 dev server 不原生支持 WebSocket(中间件 / API route 都是请求-响应模型)
- Caddy 已经在反代,SSE 路径有 `flush_interval -1`

**用户场景**:
- 在浏览器里看实验详情 → 点 "Open in browser" → 在同一个页面里看到 claude 终端 → 谈话
- 关掉浏览器 / 笔记本 → ssh 上去 → `tmux attach -t memon-claude-foo-260501-100000` → 接管
- 第二天回来再次打开浏览器 → 同一个按钮 → 还是同一个 tmux session(claude 留着上下文)

## Goals / Non-Goals

**Goals**

- 网页里能跑一个真正的交互式终端(全屏 / 大面板),输入输出延迟可接受(<100ms)
- 终端命令固定为 `tmux new-session -A -s memon-claude-<expid> claude`,attach-or-create 语义
- 关闭网页面板不杀 tmux session — 用户能在终端 `tmux attach` 接管
- 后端代码尽量少,不引入新的运行时依赖(node-pty 等)
- 不暴露内部端口,所有流量走 memon 自己的域名

**Non-Goals**

- 多并发终端(v1 单 ttyd,单端口)
- 自定义终端命令(v1 写死 `claude`)
- 上传文件 / 共享剪贴板等高级功能(ttyd 提供的开关足矣)
- 跨用户隔离 / 鉴权 — 单用户工具,Caddy 层有信任域名前提

## Decisions

### 决策 1: 用 ttyd 而不是 node-pty + xterm.js + 自己写 WebSocket

**选择**: 在 PATH 里找 `ttyd`,作为子进程拉起。

**对比**:

| 方案 | 实现量 | 运行时复杂度 | 失败模式 |
|---|---|---|---|
| node-pty + xterm.js + 自己 WS | 需写 WS 协议、PTY resize、断线重连;Next.js 还要改成 custom server 才能挂 WS | 高(进程内 PTY) | WS 实现 bug 等于终端坏 |
| **ttyd 子进程 + iframe** | memon 只管 `spawn('ttyd', [...])` | 低(独立进程) | ttyd 没装 → 按钮置灰提示 |
| GoTTY | 类似 ttyd 但作者归档 | 低 | 不维护 |
| webssh / xterm.js + ssh tunnel | 要 ssh server | 中 | 多一层认证 |

**关键考虑**:
- `node-pty` 在 Linux 上要编译 native module,在 cluster 上常常没 Python/build chain
- Next.js dev server 默认不支持 WebSocket,改 custom server 会改变 `next dev` 行为
- ttyd 是 C 写的单 **静态链接** 二进制,无依赖,自带 xterm.js — 直接外包整个 PTY + WS 问题
- **关键利好**:ttyd 上游每个 release 都附预编译静态二进制,memon 可以自己拉 → 不依赖系统包管理器

**代价**: 第一次启动要花几秒下载二进制(~5MB)。后续命中缓存。

### 决策 2: tmux session 命名 `memon-claude-<expid>`

**选择**: 固定前缀 `memon-claude-` + 实验目录名(已经是 kebab-case + timestamp,unique)。

**对比**:
- `claude-<expid>`:可能与用户自己的 tmux 撞名
- `<expid>`:同上
- UUID:用户没法记住,违背"我能 ssh 上去 attach"的目标

`memon-claude-foo-260501-100000` 这种名字对人很友好,且 grep `memon-claude-` 能列出所有由 memon 起的 session。

### 决策 3: 后端代理 ttyd 而不是直接暴露端口

**选择**: ttyd 绑 `127.0.0.1:7682`,memon 用 Next.js route 把 `/api/terminal/proxy/<sessionName>/*` 反代过去。前端 iframe 写 `/api/terminal/proxy/<sessionName>/`(走 memon 同源)。

**对比**:
- 直接 iframe `localhost:7682`:跨域 / 跨端口,生产环境上要单独 Caddy 配置;HTTPS 不通
- 子域名 `terminal.memon-vultr.dev.mem.ac`:要改 DNS + Caddy
- **同源代理**:零配置 — 已有的 Caddy 反代 memon 主域,memon 自己再代一层就行;HTTPS 自动继承

WebSocket 的代理:Next.js route 不支持 WS upgrade,但 ttyd 0.7+ 默认开启 SSE fallback(`-W` flag)。对一个低带宽的终端来说 SSE+POST 完全够。如果性能不够,后续可以单独跑一个小 Node 代理。

> 实测路径:先用 ttyd 默认 WS 模式 + Caddy 直通 `/api/terminal/proxy/*`(Caddy 支持 WS,Next.js 不在中间)→ Caddy 配置改成把 `/api/terminal/proxy/*` 直接代理到 `localhost:7682`,绕过 Next.js。这是最干净的方案。

**最终方案**: Caddy 加一条:
```
@terminal path /api/terminal/proxy/*
reverse_proxy @terminal localhost:7682 {
    flush_interval -1
}
```
memon 的 `/api/terminal/start` 只负责拉起 ttyd 子进程 + 返回 `/api/terminal/proxy/<sessionName>/`。前端 iframe 加载该 URL,Caddy 直接打到 ttyd,Next.js 不在路径上。

### 决策 4: 单端口 7682,同时只允许 1 个 ttyd

**选择**: v1 全局单 ttyd,启动新会话前 kill 旧的。

**对比**:
- 端口池 `7682-7700`:需要持久化端口分配,多终端并发,Caddy 要按 sessionName 路由 — v2 再说
- 永远复用同一个 ttyd 但切 tmux session:ttyd 的命令在启动时固定,不能动态切;复用 = 不行

**代价**: 同时只能盯一个 agent。够用 — 单人单脑也聊不过来两个。

### 决策 5: ttyd 进程不持久化,tmux session 持久

**选择**: ttyd 在 memon 进程里 spawn,关掉浏览器 / kill memon 都会让 ttyd 退出,但 tmux session 仍然 detached 存在(`tmux new-session -A -s ... -d` 不绑死 ttyd 的 TTY)。

实际上 ttyd 的命令是 `tmux new-session -A -s name`(没 `-d`),它会 attach 到 session;ttyd 退出时会断开 attach,session 进入 detached。这正是我们要的。

### 决策 6: ttyd 二进制由 memon 自管理(零 root)

**选择**: memon 自己负责 ttyd 二进制的获取、校验、缓存,**不依赖系统包管理器**。

**理由**:
- 用户主战场是共享 cluster,**没有 root**,`apt install` / `dnf install` 都用不了
- 让用户从源码编译 ttyd 需要 cmake + libwebsockets + libuv + json-c + zlib + OpenSSL,门槛太高
- ttyd 上游(https://github.com/tsl0922/ttyd/releases)每个 release 都附静态链接的预编译二进制,直接 `chmod +x` 就能跑

**实现**:

1. **版本锁定**:在源码里硬编码 `TTYD_VERSION = '1.7.7'`(后续升级走改代码 + 重启)。
2. **架构检测**:
   ```ts
   const archMap: Record<string, string> = {
     x64: 'x86_64', arm64: 'aarch64', arm: 'armhf', ia32: 'i686', mips: 'mips', mipsel: 'mipsel',
   }
   const asset = `ttyd.${archMap[process.arch]}`  // e.g. ttyd.x86_64
   ```
3. **缓存路径**:`~/.cache/memon/bin/ttyd-<version>-<arch>`(沿用 mvp 阶段已有的 `~/.cache/memon/lineindex/` 模式)。
4. **下载流程**(`/api/terminal/install`):
   ```
   url = https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/${asset}
   GET url → write to <cache>/.tmp.<rand> → fs.chmod(0o755) → fs.rename → 缓存路径就绪
   ```
   下载用 Node 内置 `fetch`(Node 20+),写入用 stream pipe。
5. **完整性校验**:每个 release 还附 `.sha256` 文件;下载后 stream-hash 校对;不匹配 → 删除 + 报错。
6. **macOS fallback**:上游不发预编译 macOS 二进制,在 darwin 上 install 接口直接返回 `{ ok: false, suggestion: 'brew install ttyd' }`。Mac 一般有 brew,接受手动一步。

**对比 (拒掉的方案)**:

| 方案 | 拒因 |
|---|---|
| 让用户 `apt/dnf/brew install` | 用户没 root |
| 让 memon 编译 ttyd | 缺 build chain;耗时;失败模式多 |
| 走 npm 包(假设有 wrapper) | 没找到维护良好的包,自己写 fetcher 反而稳 |
| 用 Bun + WebSocket | 增加运行时 |

**`/api/terminal/check` 行为修改**:
- 先看 `~/.cache/memon/bin/ttyd-<version>-<arch>` 在不在 + 可执行 + `--version` 跑得通
- 都成立 → `{ available: true, version, source: 'cached' }`
- 不在 → 检查 `which ttyd` 作为后备(用户可能自己装过)
- 都没有 → `{ available: false, downloadable: true, suggestedAction: 'POST /api/terminal/install' }`(macOS:`{ available:false, downloadable:false, suggestion: 'brew install ttyd' }`)

**前端 UX**: 按钮上的状态 3 选 1
- `available: true` → 蓝色可点,文字 "Open in browser"
- `downloadable: true` → 灰色,文字 "Install ttyd (5MB)" — 点击触发 `/api/terminal/install`,装完自动转 `available`
- `downloadable: false` → 灰色 + tooltip 显示手动安装命令

### 决策 7: 不实现 stop API 的"杀 tmux session"行为

`POST /api/terminal/stop` 只 kill ttyd 进程,**不**做 `tmux kill-session`。理由:这违背"网页关掉 tmux 留着"的核心 UX。

如果用户真的想杀 tmux session,直接 ssh `tmux kill-session -t memon-claude-<id>` — 不放进 UI(避免误操作)。

## Risks / Trade-offs

- **[ttyd 二进制下载失败 / GitHub 不可达] → install 接口返回 502 + 带 fallback 提示**;用户可以手动从 release 页下到本机,放进 `~/.cache/memon/bin/` 即可被识别
- **[ttyd 上游 release URL 命名变化] → 锁版本号 1.7.7,URL 是确定的**;升级时改源码 + 验证一次新 URL 仍可达
- **[sha256 校验文件不存在(冷门架构)] → 跳过校验,但记 warning**;主架构(x86_64/aarch64)上游一直有
- **[多个 memon 实例同时下载到同一个 cache 目录]:用 `<cache>/.tmp.<random>` + rename 保证原子;同时下两个最坏结果是其中一个 rename 成功,另一个看到目标已存在直接复用
- **[macOS 没预编译] → install 接口在 darwin 上返回 `brew install ttyd` 提示**;Mac 一般有 brew,可接受
- **[非 root cache 目录权限] → `~/.cache/memon/` 在用户 home 下,无权限问题**;首次 mkdir 会处理
- **[Caddy 配置漂移] → 用户的反代如果没加 `/api/terminal/proxy/*` 直通规则,WebSocket 会被 Next.js 吃掉返回 404**;首次部署要 README 说明,且 `/api/terminal/start` 返回的 URL 同时附一段 caddy snippet 让用户拷贝
- **[ttyd 版本差异] → 默认参数在不同版本可能略有不同**(`--writable` 是 readonly 的反义,旧版可能没有);锁住一个最低版本(0.7+)
- **[长时间空闲 ttyd 不退出] → 资源泄漏(轻微)**;不主动管,memon 进程退出时 cleanup
- **[tmux session 越积越多] → `tmux ls` 越来越长**;memon 提供 `GET /api/terminal/sessions` 列出所有 `memon-claude-*` 的 session,前端可加管理界面(v2)
- **[claude CLI 不在 PATH] → ttyd 启动后立即看到 "claude: command not found" 然后退出**;前端需要把 ttyd 子进程的 stderr 第一段抓出来,挂在 `start` 响应的 `warnings[]` 里
- **[一个面板里跑 claude,另一个 tab 同时操作 README → tmux session 内的文件被改但 agent 看不到]**:这是 agent 和文件系统协作的固有问题,memon 不解决,但 README 注释一句 "agent 编辑前后请刷新"
- **[Caddy WebSocket 连不上时 ttyd 自动 fallback 到 SSE+POST]**;延迟会升,但能用
- **[ttyd 暴露给非本机网络] → 安全问题**;明确只 bind `127.0.0.1`(`-i` 默认就是),不允许 `0.0.0.0`

## Open Questions

- iframe 里的终端样式继承 ttyd 默认主题(深色),和 memon 主页面 light/dark 的协调?v1 不管,iframe 自成一体可以接受。
- ttyd 的 token 鉴权(`-c user:pass`)要不要开?单用户机器可以不开,但代理路径暴露在 memon 域名下 = Caddy 信任边界覆盖即可。明确:**不开**,通过 Caddy 的访问控制(IP 白名单 / 客户端证书)做信任边界。
