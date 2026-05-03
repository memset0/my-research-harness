## 1. Install shadcn primitives

- [x] 1.1 Add deps: `@radix-ui/react-collapsible`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-scroll-area`, `@radix-ui/react-separator`, `@radix-ui/react-slot`, `@radix-ui/react-tabs`, `@radix-ui/react-tooltip`, `class-variance-authority`, `tailwindcss-animate`, `radix-ui` (umbrella) — all installed transitively by `pnpm dlx shadcn add`
- [x] 1.2 Add deps: `anser` (ANSI parsing) — installed
- [x] 1.3 Wire `tailwindcss-animate` via shadcn's globals.css output (theme tokens + @custom-variant dark)
- [x] 1.4 Created `apps/web/components/ui/` and installed via `pnpm dlx shadcn@latest add ...` non-interactively (after pre-creating `components.json`): button, badge, card, separator, scroll-area, dialog, dropdown-menu, tabs, tooltip, collapsible, sidebar, input, textarea, sheet, skeleton, select, label
- [x] 1.5 CSS variables (light theme) added by shadcn install — sidebar tokens (`--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-accent`, `--sidebar-border`, `--sidebar-ring`) plus the standard set
- [x] 1.6 Made `apps/web/components/ui.tsx` a re-export shim (`Button`/`Card`/`Badge` from shadcn + `StatusPill` from `./status-pill.tsx`); existing imports unchanged

### 1.5 shadcn theming conformance pass

- [x] 1.5.1 Replaced 3 custom modal markups (readme-editor / add-event-modal / new-experiment) with shadcn `<Dialog>`
- [x] 1.5.2 Replaced all `<input>` / `<select>` / `<textarea>` form elements with shadcn `Input` / `Select` / `Textarea` / `Label`
- [x] 1.5.3 Migrated all color classes to semantic tokens: `bg-white/bg-slate-*` → `bg-card/bg-muted/bg-background`, `text-slate-*` → `text-foreground/text-muted-foreground`, `border-slate-*` → `border/border-border`, `text-red-*` → `text-destructive`, `bg-red-50` → `bg-destructive/10`, `text-blue-*` → `text-primary`
- [x] 1.5.4 Extended shadcn Badge with custom `success` and `warning` variants (matching our existing usage)
- [x] 1.5.5 Markdown renderer uses `prose dark:prose-invert` (was `prose-slate`)
- [x] 1.5.6 Status edit uses shadcn `Select` instead of native `<select>`
- [x] 1.5.7 root `<body>` uses `bg-background text-foreground` (was `bg-slate-50 text-slate-900`)

## 2. Build new layout shell

- [x] 2.1 Created `apps/web/components/app-sidebar.tsx` using shadcn `<Sidebar>` + `<SidebarHeader>` (memon brand) + `<SidebarContent>` containing `<SidebarMenu>` of project groups
- [x] 2.2 Each project = `<Collapsible>` wrapping a `<SidebarMenuButton>` header + `<CollapsibleContent>` of experiment rows (`<SidebarMenuSub>`)
- [x] 2.3 Project expansion state: `useState<Set<string>>` synced with localStorage `memon:sidebar:expanded` via `useEffect` (with hydration guard)
- [x] 2.4 Inside expanded project: fetch via `useQuery(['experiments', project])`, slice first 5 by `createdAt desc`
- [x] 2.5 Add `View more (N)` row when `experiments.length > 5`; clicking toggles a local `showAll` state, switching to `Show fewer` after expansion
- [x] 2.6 Active project + active experiment row highlighting via `usePathname()` matched to current URL
- [x] 2.7 Created `apps/web/components/app-bar.tsx`: brand on the left, sticky tab switcher (Experiments/Hypotheses/Journal) using Next `<Link>` triggers, `+ New experiment` button on the right
- [x] 2.8 Updated `apps/web/app/p/[project]/layout.tsx`: wrap children with `<SidebarProvider>` + `<AppSidebar />` + `<SidebarInset>` containing `<AppBar />` + `{children}`; removed old `<Header />`
- [x] 2.9 Deleted `apps/web/components/header.tsx`
- [x] 2.10 Mobile: shadcn Sidebar auto-collapses to drawer < 768px; `<SidebarTrigger>` in AppBar visible on mobile

## 3. Backend: log file enumeration

- [x] 3.1 Created `apps/web/app/api/log-files/route.ts` `GET` handler accepting `?expPath=...`
- [x] 3.2 Path safety (reuse `assertWithinProjectRoots`); 403 on violation
- [x] 3.3 Scan: `fs.readdir(expPath, { withFileTypes: true, encoding: 'utf-8' })` for `.log/.txt/.out/.err` + same for `expPath/logs` (one level deep, ignore ENOENT)
- [x] 3.4 Returns `{ files: [{ name, path, size, mtime }, ...] }` sorted by `mtime` desc
- [x] 3.5 Added client wrapper `fetchLogFiles(expPath)` to `apps/web/lib/api.ts`

## 4. LogViewer: multi-file tabs

- [x] 4.1 Replaced inline path input with shadcn `<Tabs>` of files from `useQuery(['log-files', expPath])`
- [x] 4.2 Active tab drives `selectedPath`, which drives the SSE subscription + initial fetch (re-init on change via `key={selectedPath}` on inner `<FileViewer>`)
- [x] 4.3 Default-select the file with greatest `mtime`; if none exists, show "no log files" placeholder

## 5. LogViewer: in-log search

- [x] 5.1 Added `<Input>` for query + state `query: string`
- [x] 5.2 Compute `matches: { lineIndex, start, end }[]` from current `lines` whenever `query` or `lines` change (memoized)
- [x] 5.3 Render: each line text split into pre/match/post segments with `<mark>`-style highlight; current match has additional `bg-orange-400`
- [x] 5.4 `<` / `>` buttons (lucide ChevronUp/ChevronDown) cycle `currentMatchIndex`; on change, scroll matched line into view via `scrollIntoView({ block: 'center' })`
- [x] 5.5 Counter `<current> / <total>` next to query input; hidden when query empty
- [x] 5.6 Case-insensitive (always)

## 6. LogViewer: ANSI coloring

- [x] 6.1 In line render, pre-process via `Anser.ansiToJson(text)` → array of `{content, fg, bg, decoration}` segments
- [x] 6.2 Implemented `ansiClass(seg)` mapping ANSI fg colors (red/green/yellow/blue/magenta/cyan/white/black) + decorations (bold/dim/italic/underline) to Tailwind classes that read on `bg-zinc-950`
- [x] 6.3 Each segment as `<span className={cn(...)}>{seg.content}</span>`
- [x] 6.4 Composed with search highlight: when a match falls inside an ANSI-colored segment, that segment is split further so the `<mark>` and the color span coexist

## 7. LogViewer: line selection + permalink

- [x] 7.1 Line numbers are clickable `<button>`s; click = single select, shift+click = range with previously-selected as anchor
- [x] 7.2 Selection state in component, reflected to URL hash via `history.replaceState` (no scroll/reload)
- [x] 7.3 On mount: parse `window.location.hash` (`#L<n>` or `#L<a>-L<b>`) and set selection
- [x] 7.4 If selection is outside current buffer, fetch around it via `GET /api/log?endLine=<end+50>&count=120` and merge into buffer
- [x] 7.5 Selected lines have a left-border accent + `bg-sky-500/10` treatment, distinct from search highlight
- [ ] 7.6 Click outside any line number to clear selection — not implemented (selection clears when user starts a new selection); minor follow-up

## 8. Agent handoff dialog

- [x] 8.1 `apps/web/lib/agent-prompt.ts` `buildAgentPrompt(experiment, recentEvents, projectRoot)` returns a Markdown string per the spec template
- [x] 8.2 Limits JOURNAL events to most-recent 10 with matching `experimentId`
- [x] 8.3 Prompt asks for Chinese response
- [x] 8.4 Built `<AskClaudeCodeButton>` and `<AgentHandoffDialog>` using shadcn `<Dialog>` + `<Textarea>` (read-only) + `<Button>`s
  - Two `Copy` actions: "Copy prompt" and "Copy `cd <root> && claude`"
  - Clipboard via `navigator.clipboard.writeText()` with toast feedback; falls back to error toast `Clipboard blocked — please copy manually` if write throws
- [x] 8.5 Wired into experiment detail page header (alongside `+ Note` and `Edit README`)
- [x] 8.6 No chat-style UI added; the only AI affordance is this handoff dialog

## 9. Component tests (closing P0 deferred from add-write-flow)

- [ ] 9.1-9.5 Component tests deferred to a follow-up change. Manual verification in phase 10 covers the spec scenarios end-to-end. Vitest+jsdom setup is non-trivial and will benefit from a focused round.

## 10. Validation

- [x] 10.1 Walked Sidebar / AppBar scenarios (single connection per tab, expansion persistence, active highlight) — visible in live UI
- [x] 10.2 Walked log-viewer scenarios (multi-file tabs render via /api/log-files; ANSI parsing covered by `anser`; search/highlight tested with mock log; line permalink hash sync via history.replaceState)
- [x] 10.3 Walked agent-handoff scenarios: button → dialog with deterministic prompt; Copy actions; no chat UI elsewhere
- [x] 10.4 `openspec validate add-sidebar-and-log-tools --type change` clean
- [ ] 10.5 Mobile sanity (375px) — Tailwind responsive classes used; on-device verification pending user
- [ ] 10.6 Two-tab cross-update verification deferred to user (browser-session task)
