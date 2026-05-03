## 1. Install shadcn primitives

- [ ] 1.1 Add deps: `@radix-ui/react-collapsible`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-scroll-area`, `@radix-ui/react-separator`, `@radix-ui/react-slot`, `@radix-ui/react-tabs`, `@radix-ui/react-tooltip`, `class-variance-authority`, `tailwindcss-animate`
- [ ] 1.2 Add deps: `anser`(ANSI parsing) + `@types/anser`(if needed)
- [ ] 1.3 Add `tw-animate-css` plugin or wire `tailwindcss-animate` into `globals.css` per Tailwind v4 conventions
- [ ] 1.4 Create `apps/web/components/ui/` directory and copy shadcn component sources (current stable):
  - [ ] `button.tsx` `badge.tsx` `card.tsx` `separator.tsx` `scroll-area.tsx` `dialog.tsx` `dropdown-menu.tsx` `tabs.tsx` `tooltip.tsx` `collapsible.tsx` `sidebar.tsx`
- [ ] 1.5 Add CSS variables (light theme only) to `globals.css` per shadcn defaults (`--sidebar-background`, `--sidebar-foreground`, etc.)
- [ ] 1.6 Replace `apps/web/components/ui.tsx` with re-exports of `./ui/*` so existing imports keep working; preserve `StatusPill` (custom logic component)

## 2. Build new layout shell

- [ ] 2.1 Create `apps/web/components/app-sidebar.tsx`: shadcn `<Sidebar>` + `<SidebarHeader>` (memon brand) + `<SidebarContent>` containing `<SidebarMenu>` of project groups
- [ ] 2.2 Each project = `<Collapsible>` wrapping a `<SidebarMenuItem>` header + `<CollapsibleContent>` of experiment rows
- [ ] 2.3 Project expansion state: `useState<Record<string,boolean>>` synced with localStorage `memon:sidebar:expanded` via `useEffect`
- [ ] 2.4 Inside expanded project: fetch via `useQuery(['experiments', project])`, slice first 5 by `createdAt desc`, render rows
- [ ] 2.5 Add `View more` row when `experiments.length > 5`; clicking toggles a local `showAll[project]` state, switching to `Show fewer` after expansion
- [ ] 2.6 Active project + active experiment row highlighting via `usePathname()` + `data-active` attribute matched to current URL
- [ ] 2.7 Create `apps/web/components/app-bar.tsx`: brand on the left, shadcn `<Tabs>` (Experiments/Hypotheses/Journal) using Next `<Link>` triggers, `+ New experiment` button on the right
- [ ] 2.8 Update `apps/web/app/p/[project]/layout.tsx`: wrap children with `<SidebarProvider>` + `<AppSidebar />` + `<SidebarInset>` containing `<AppBar />` + `{children}`; remove old `<Header />`
- [ ] 2.9 Delete `apps/web/components/header.tsx` (no longer used)
- [ ] 2.10 Mobile sanity: confirm sidebar collapses to drawer < 768px and `<SidebarTrigger>` toggles it

## 3. Backend: log file enumeration

- [ ] 3.1 Create `apps/web/app/api/log-files/route.ts` `GET` handler accepting `?expPath=...`
- [ ] 3.2 Path safety check (reuse `assertWithinProjectRoots`); reject 403 on violation
- [ ] 3.3 Scan: `fs.readdir(expPath)` for `.log/.txt/.out/.err` + `fs.readdir(expPath+'/logs')` (one level deep, ignore ENOENT)
- [ ] 3.4 Return `{ files: [{ name, path, size, mtime }, ...] }` sorted by `mtime` desc
- [ ] 3.5 Add client wrapper `fetchLogFiles(expPath)` to `apps/web/lib/api.ts`

## 4. LogViewer: multi-file tabs

- [ ] 4.1 In `log-viewer.tsx`, replace the inline path text input with a shadcn `<Tabs>` of files from `useQuery(['log-files', expPath])`
- [ ] 4.2 Active tab drives `selectedPath`, which drives the SSE subscription + initial fetch (re-init on change)
- [ ] 4.3 Default-select the file with greatest `mtime`; if none exists, show "no log files in this experiment" placeholder

## 5. LogViewer: in-log search

- [ ] 5.1 Add `<input>` for query + state `query: string`
- [ ] 5.2 Compute `matches: { lineNumber, indexInLine, length }[]` from current `lines` whenever `query` or `lines` change (debounced ~150ms for typing UX)
- [ ] 5.3 Render: each line text split into pre/match/post segments, match wrapped in `<mark className="bg-amber-300/70 text-slate-900">`; the "current" match additionally has `bg-orange-400`
- [ ] 5.4 Add `< / >` buttons cycling `currentMatchIndex`; on change, scroll the matched line into view
- [ ] 5.5 Counter `<current> / <total>` next to query input; hide when query empty
- [ ] 5.6 Case-insensitive by default; consider adding a tiny `Aa` toggle if scope allows (else punt)

## 6. LogViewer: ANSI coloring

- [ ] 6.1 In line render, pre-process `text` via `Anser.ansiToJson(text)` → array of `{content, fg, bg, decoration}` segments
- [ ] 6.2 Implement `ansiSegmentClassName(seg)` mapping shadcn-themed Tailwind classes; default fg = inherit, default bg = transparent
- [ ] 6.3 Render each segment as a `<span className={cn(...)}>{seg.content}</span>`
- [ ] 6.4 Compose with search highlight: when a match falls inside an ANSI-colored segment, split that segment further so the `<mark>` and the color span coexist

## 7. LogViewer: line selection + permalink

- [ ] 7.1 Make line numbers clickable buttons; bind onClick (single = select; shift+click = range with previously-selected as anchor)
- [ ] 7.2 Track `selection: { start: number, end: number } | null` in state; reflect in URL hash via `history.replaceState` (no scroll, no reload)
- [ ] 7.3 On mount and on `popstate`, parse `window.location.hash` (`#L<n>` or `#L<a>-L<b>`); set selection state accordingly
- [ ] 7.4 If selection's range is outside current line buffer, fetch `GET /api/log?endLine=<end+50>&count=120` to fill around it
- [ ] 7.5 Selected lines have a left-border + subtle `bg-sky-900/30` treatment, distinct from search highlight
- [ ] 7.6 Click outside any line number → clear selection, remove hash

## 8. Agent handoff dialog

- [ ] 8.1 Implement `apps/web/lib/agent-prompt.ts`: `buildAgentPrompt(experiment, recentJournalEvents)` returns a Markdown string per the spec template
- [ ] 8.2 Limit JOURNAL events to most-recent 10 with matching `experimentId`
- [ ] 8.3 Include the prompt template footer asking for Chinese response
- [ ] 8.4 Build `<AskClaudeCodeButton>` and `<AgentHandoffDialog>` in `apps/web/components/`:
  - [ ] Dialog uses shadcn `<Dialog>` + `<DialogContent>`
  - [ ] Read-only `<Textarea>` showing the prompt
  - [ ] Two `Copy` buttons: "Copy prompt" and `Copy "cd <root> && claude"`
  - [ ] Clipboard write via `navigator.clipboard.writeText()` with fallback to `select() + execCommand('copy')` on failure
  - [ ] Toasts for success/failure
- [ ] 8.5 Wire `<AskClaudeCodeButton>` into experiment detail page header (alongside `+ Note` / `Edit README`)
- [ ] 8.6 Verify NO chat-style UI surfaces are added anywhere — handoff only

## 9. Component tests (closing P0 deferred from add-write-flow)

- [ ] 9.1 Add `vitest` + `@testing-library/react` + `jsdom` deps to `apps/web` (devDependencies)
- [ ] 9.2 Configure `apps/web/vitest.config.ts` for JSX + jsdom
- [ ] 9.3 `readme-editor.test.tsx`: render in editing phase, save success closes modal + calls invalidate, 409 transitions to ConflictView, draft recovery prompt shown when stale draft exists
- [ ] 9.4 `log-viewer.test.tsx`: mock SSE, initial 100 lines render with line numbers, append while at-bottom auto-scrolls, append while scrolled-up shows badge, search highlight works, line selection updates hash
- [ ] 9.5 `app-sidebar.test.tsx`: project groups all collapsed by default, click toggles and persists, View more reveals all rows

## 10. Validation

- [ ] 10.1 Walk every Scenario in `web-layout/spec.md` end-to-end against the live UI
- [ ] 10.2 Walk every Scenario in `log-viewer-tools/spec.md` (multi-file tabs, search highlight, ANSI colors via a synthetic colored log, permalink open)
- [ ] 10.3 Walk every Scenario in `agent-handoff/spec.md` (button → dialog → copy → toast → no chat UI elsewhere)
- [ ] 10.4 `openspec validate add-sidebar-and-log-tools --type change` clean
- [ ] 10.5 Mobile sanity: 375px width — sidebar drawer toggle, log viewer search bar wraps, agent handoff dialog scrollable
- [ ] 10.6 Two-tab cross-update still works after the layout change (paranoid check: SSE, write conflict, draft recovery)
