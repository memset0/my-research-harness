## 1. Dependencies and base setup

- [ ] 1.1 Add web deps: `@uiw/react-md-editor`, `react-diff-viewer-continued`, `sonner`, `@tailwindcss/typography`
- [ ] 1.2 Wire `@tailwindcss/typography` into `apps/web/app/globals.css` via `@plugin`
- [ ] 1.3 Mount `<Toaster richColors position="bottom-right" />` (sonner) in `app/layout.tsx`

## 2. Core: extract createExperimentScaffold helper

- [ ] 2.1 Refactor `packages/cli/src/commands/new.ts` to extract scaffold logic into a new `@memon/core` function `createExperimentScaffold({ projectRoot, projectName, name, now? })` returning `{ id, path }`
- [ ] 2.2 Update CLI `runNew` to consume the new helper
- [ ] 2.3 Re-export the helper from `@memon/core/index.ts`
- [ ] 2.4 Unit tests: collision detection, README + run.sh template content, JOURNAL `[CREATE]` event appended

## 3. Backend: POST /api/experiments

- [ ] 3.1 Implement `apps/web/app/api/experiments/route.ts` `POST` handler accepting `{ name, project? }`, calling `createExperimentScaffold` + updating runtime index, emitting `experiment-change` event
- [ ] 3.2 Validate input with zod; 400 on missing name; 404 on unknown project
- [ ] 3.3 Detect collision (directory already exists) → 409 with `{ error: { code: 'CONFLICT', ... } }`

## 4. Web client: SSE event subscription

- [ ] 4.1 Implement `apps/web/lib/events-client.ts` exporting a singleton `EventSource` wrapper with subscribe/unsubscribe API; lazy-connect on first subscriber, close on last unsubscribe
- [ ] 4.2 Implement `apps/web/components/use-memon-events.tsx` hook that subscribes and dispatches `experiment-change` to TanStack Query: `invalidateQueries(['experiments'])` + `invalidateQueries(['experiment', id])`
- [ ] 4.3 Detect "new experiment" (id not in cache) and `toast.info('New experiment: <id>')` with `View` action
- [ ] 4.4 Mount the hook once in `Providers` so it's active across all routes
- [ ] 4.5 Verify single connection (Network panel shows only one `text/event-stream` per tab)

## 5. Web client: LogViewer SSE rewrite

- [ ] 5.1 Replace LogViewer's `setInterval(fetchLog, 3000)` with `EventSource('/api/log/stream?path=...')`
- [ ] 5.2 Handle SSE events: `ready` (set totalLines), `append` (concat lines), `rotated` (clear + refetch), `error` (banner + retry button)
- [ ] 5.3 Track scroll position via ref; compute `atBottom = scrollHeight - scrollTop - clientHeight < 50`
- [ ] 5.4 When new lines arrive while `!atBottom`, append to buffer but don't auto-scroll; render floating `N new lines ↓` badge
- [ ] 5.5 Click on badge or scroll back to bottom → resume follow, scroll into view, clear badge
- [ ] 5.6 Component tests: append while at-bottom (auto-scroll), append while scrolled-up (badge), rotated (clear), error (banner)

## 6. Web client: status edit control

- [ ] 6.1 Add `<StatusEdit>` component in detail page header next to existing `<StatusPill>`: dropdown of 5 enum values, default = current
- [ ] 6.2 On change, optimistically display loading spinner, issue `PUT /api/readme` with full current README content but `status` field updated, carrying `expectedMtime`
- [ ] 6.3 On 200: refetch experiment, success toast, dropdown returns to read mode
- [ ] 6.4 On 409: open conflict modal (see task 7)
- [ ] 6.5 On other error: toast.error with retry action

## 7. Web client: README editor + conflict resolution

- [ ] 7.1 Add `<EditReadmeButton>` on detail page that lazy-imports `@uiw/react-md-editor` and opens a modal
- [ ] 7.2 Implement modal `<ReadmeEditor>` reading initial content + mtime + sha1(content); render @uiw split-pane editor
- [ ] 7.3 Implement debounced (500ms) localStorage autosave with key `memon:draft:<path>:<mtime>` and value `{content, savedAt}`
- [ ] 7.4 On open, scan all `memon:draft:*` keys; delete entries older than 7 days
- [ ] 7.5 On open, check for matching draft: if disk mtime matches and content differs by ≥5 chars, show recovery prompt (Restore / Discard)
- [ ] 7.6 Save button: `PUT /api/readme` with `{path, content, expectedMtime, expectedHash}`
- [ ] 7.7 On 200: close modal, refetch, success toast, delete localStorage draft for this key
- [ ] 7.8 On 409: transition modal to conflict view (`<ConflictView>`)
- [ ] 7.9 `<ConflictView>` uses `react-diff-viewer-continued` showing left=draft, right=server-current; three buttons: Keep mine / Discard mine / Cancel
- [ ] 7.10 "Keep mine" → re-issue PUT with the new mtime from 409 response
- [ ] 7.11 "Discard mine" → replace editor content with server-current and return to edit mode
- [ ] 7.12 "Cancel" → dismiss conflict view, keep editor open
- [ ] 7.13 Component tests: save success, conflict-keep, conflict-discard, draft autosave + recovery, draft cleanup

## 8. Web client: add note / request

- [ ] 8.1 Add `+ Note` button to detail page header opening `<AddNoteModal>` (textarea only)
- [ ] 8.2 On submit, `POST /api/journal/append` with `{ project, tag: 'NOTE', body: '\`<id>\` <user input>' }`; success → toast + close
- [ ] 8.3 Add `+ Add` control to journal page opening `<AddJournalEntryModal>` with tag selector (NOTE / REQUEST) and body textarea
- [ ] 8.4 On REQUEST submit, body has no experiment-id prefix (free-form); on NOTE submit, optional id prefix dropdown
- [ ] 8.5 Refresh journal query after successful submit (already triggered by SSE, but optimistic invalidation is OK)

## 9. Web client: new experiment wizard

- [ ] 9.1 Add `+ New experiment` button to list page header opening `<NewExperimentModal>`
- [ ] 9.2 Modal: `name` text input + `project` select (defaulting to current; hidden when only one project)
- [ ] 9.3 On submit, `POST /api/experiments`; success → toast + `router.push` to detail page
- [ ] 9.4 On 409 collision → inline modal error `An experiment with that name already exists this second; try again`

## 10. Polish: skeletons + error boundary

- [ ] 10.1 Build `<RowSkeleton>`, `<CardSkeleton>`, `<DetailSkeleton>` primitives in `apps/web/components/skeletons.tsx`
- [ ] 10.2 Replace text `loading…` placeholders in list / detail / hypothesis / journal views with appropriate skeletons (only on first load, not refetch)
- [ ] 10.3 Add `apps/web/app/error.tsx` rendering friendly error UI with `Reload` action (uses Next.js `reset()` prop)
- [ ] 10.4 Add `apps/web/app/not-found.tsx` for 404 routes (e.g. unknown project)
- [ ] 10.5 In `/p/[project]/layout.tsx`, validate the project exists in config; if not, call `notFound()`

## 11. Cross-cutting: Caddy SSE flush hint (optional)

- [ ] 11.1 Document in README that for production reverse-proxies, `flush_interval -1` (or equivalent) should be set on `/api/events` and `/api/log/stream` paths to disable buffering
- [ ] 11.2 Update local Caddyfile entry to include `flush_interval -1` for memon-vultr (verify SSE latency < 1s end-to-end)

## 12. Validation

- [ ] 12.1 Walk every Scenario in `experiment-edit/spec.md` end-to-end against the live UI
- [ ] 12.2 Walk every Scenario in `live-updates/spec.md` end-to-end against the live UI
- [ ] 12.3 Open two browser tabs; verify a status change in tab A reflects in tab B within ~1s via SSE
- [ ] 12.4 Trigger a 409 by editing the same README in tab A and tab B simultaneously; verify both go through the conflict modal correctly
- [ ] 12.5 `openspec validate add-write-flow --type change` clean
- [ ] 12.6 Mobile responsive sanity check (375px width) on every modal added by this change
