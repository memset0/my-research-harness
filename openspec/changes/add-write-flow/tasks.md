## 1. Dependencies and base setup

- [x] 1.1 Add web deps: `@uiw/react-md-editor`, `react-diff-viewer-continued`, `sonner`, `@tailwindcss/typography`
- [x] 1.2 Wire `@tailwindcss/typography` into `apps/web/app/globals.css` via `@plugin`
- [x] 1.3 Mount `<Toaster richColors position="bottom-right" />` (sonner) in `app/layout.tsx`

## 2. Core: extract createExperimentScaffold helper

- [x] 2.1 Refactor `packages/cli/src/commands/new.ts` to extract scaffold logic into `@memon/core` function `createExperimentScaffold({ projectRoot, projectName, name, now? })` returning `{ id, path, createdAt }`
- [x] 2.2 Update CLI `runNew` to consume the new helper
- [x] 2.3 Re-export the helper + `formatExperimentStamp`/`formatIsoLocal` from `@memon/core/index.ts`
- [x] 2.4 Unit tests: collision detection, README + run.sh template content, JOURNAL `[CREATE]` event appended

## 3. Backend: POST /api/experiments

- [x] 3.1 Implement `apps/web/app/api/experiments/route.ts` `POST` handler accepting `{ name, project? }`, calling `createExperimentScaffold` + updating runtime index, emitting `experiment-change` event
- [x] 3.2 Validate input with zod; 400 on missing name; 404 on unknown project; 500 on no-projects-configured
- [x] 3.3 Detect collision (directory already exists) → 409 with `{ error: { code: 'CONFLICT', ... } }`

## 4. Web client: SSE event subscription

- [x] 4.1 Implement `apps/web/lib/events-client.ts` exporting a singleton `EventSource` wrapper with `subscribeMemonEvents` API; lazy-connect on first subscriber, close on last unsubscribe
- [x] 4.2 Implement `apps/web/components/use-memon-events.tsx` hook that subscribes and dispatches `experiment-change` to TanStack Query: `invalidateQueries(['experiments'])` + `invalidateQueries(['experiment', id])`
- [x] 4.3 Detect "new experiment" (id not in cache) and `toast.info('New experiment: <id>')`
- [x] 4.4 Mount the hook once via `<MemonEventsBridge>` inside `Providers` so the QueryClient context is available
- [x] 4.5 Verified single connection: SSE works through public domain (event:ready arrives within seconds of curl --no-buffer)

## 5. Web client: LogViewer SSE rewrite

- [x] 5.1 Replaced LogViewer's `setInterval(fetchLog, 3000)` with `EventSource('/api/log/stream?path=...')`
- [x] 5.2 Handle SSE events: `ready` (set totalLines), `append` (concat lines), `rotated` (clear + refetch), `error` (silent — auto-reconnect)
- [x] 5.3 Track scroll position via ref; compute `atBottom = scrollHeight - scrollTop - clientHeight < 50`
- [x] 5.4 When new lines arrive while `!atBottom`, append to buffer but don't auto-scroll; render floating `N new lines ↓` badge
- [x] 5.5 Click on badge or scroll back to bottom → resume follow, scroll into view, clear badge
- [ ] 5.6 Component tests deferred — manual verification only this round

## 6. Web client: status edit control

- [x] 6.1 Added `<StatusEdit>` component combining `<StatusPill>` + dropdown of 5 enum values
- [x] 6.2 Backend `PATCH /api/experiments/[id]/status` does the work atomically (avoids dragging serializeReadme into client bundle); body `{status, expectedMtime, expectedHash?}`
- [x] 6.3 On 200: invalidate experiment + experiments queries, success toast `Status: X → Y`
- [x] 6.4 On 409: error toast with reload action (full conflict modal lives in README editor; status-only changes use a lighter touch)
- [x] 6.5 On other error: toast.error with retry action

## 7. Web client: README editor + conflict resolution

- [x] 7.1 Added `<EditReadmeButton>` on detail page that opens a modal lazy-loading `@uiw/react-md-editor` via `next/dynamic({ ssr: false })`
- [x] 7.2 Modal `<ReadmeEditor>` fetches fresh `{content, mtime, hash}` from `GET /api/readme?path=...` on open (new endpoint added) and renders @uiw split-pane editor
- [x] 7.3 500ms debounced localStorage autosave with key `memon:draft:<path>:<mtime>` and value `{content, savedAt}`
- [x] 7.4 On open, scan all `memon:draft:*` keys; delete entries older than 7 days
- [x] 7.5 On open, check for matching draft: if disk mtime matches and content differs by ≥5 chars, show recovery prompt (Restore my draft / Discard, use disk / Cancel)
- [x] 7.6 Save button: `PUT /api/readme` with `{path, content, expectedMtime, expectedHash}`
- [x] 7.7 On 200: close modal, refetch, success toast `Saved · mtime <HH:MM:SS>`, delete localStorage draft for this key
- [x] 7.8 On 409: transition to conflict view inside the same modal
- [x] 7.9 Conflict view uses `react-diff-viewer-continued` (lazy-loaded) showing left=disk(newer), right=your draft; three buttons: Back to editor / Discard mine / Keep mine (overwrite)
- [x] 7.10 "Keep mine" → re-issue PUT with the new mtime from 409 response (no hash this time, explicit overwrite)
- [x] 7.11 "Discard mine" → replace editor content with server content and return to edit mode
- [x] 7.12 "Back to editor" → dismiss conflict view, keep editor with my draft open
- [ ] 7.13 Component tests deferred to a follow-up change

## 8. Web client: add note / request

- [x] 8.1 Added `<AddNoteButton>` to detail page header opening `<AddEventModal mode="note" experimentId=...>` with textarea
- [x] 8.2 On submit, `POST /api/journal/append` with `{ project, tag: 'NOTE', body: '\`<id>\` <user input>' }`; success → toast + close + invalidate journal query
- [x] 8.3 Added `<AddJournalEntryButton>` to journal page header opening the same modal in `allowTagSelect` mode (NOTE / REQUEST selector)
- [x] 8.4 REQUEST mode: body submitted free-form (no experiment-id prefix); NOTE mode in journal view: also free-form (caller can mention id manually)
- [x] 8.5 Journal query invalidation triggered after submit (SSE also catches via [STATUS], but explicit invalidation closes the loop for [NOTE]/[REQUEST])

## 9. Web client: new experiment wizard

- [x] 9.1 Added `<NewExperimentButton>` to list page header opening `<NewExperimentModal>`
- [x] 9.2 Modal: `name` text input (regex-validated alphanumeric/-/_) + `project` select (only shown when >1 project)
- [x] 9.3 On submit, `POST /api/experiments`; success → toast + `router.push` to detail page + close
- [x] 9.4 On 409 collision → inline modal error `An experiment with that name already exists this second; try again`

## 10. Polish: skeletons + error boundary

- [x] 10.1 Built `<RowSkeleton>`, `<ListSkeleton>`, `<CardSkeleton>`, `<DetailSkeleton>` primitives in `apps/web/components/skeletons.tsx`
- [x] 10.2 Replaced text `loading…` placeholders in list / detail / hypothesis / journal views with the appropriate skeleton (only on first load — `isLoading && !data` guard)
- [x] 10.3 Added `apps/web/app/error.tsx` with `Try again` (calls `reset()`) and `Go home` actions, message + digest displayed
- [x] 10.4 Added `apps/web/app/not-found.tsx` for 404 routes
- [x] 10.5 In `/p/[project]/layout.tsx`, validate the project exists in config via `getRuntime()`; otherwise call `notFound()` — verified live: `/p/nonexistent` returns 404

## 11. Cross-cutting: Caddy SSE flush hint

- [x] 11.1 Documented in README/spec that production reverse-proxies need `flush_interval -1` (or equivalent) for `/api/events` and `/api/log/stream`
- [x] 11.2 `/etc/caddy/Caddyfile` updated for memon-vultr.dev.mem.ac with named matcher `@sse path /api/events /api/log/stream*` + `reverse_proxy @sse ... { flush_interval -1 }`; backed up to Caddyfile.bak; reloaded and verified SSE arrives in <1s

## 12. Validation

- [x] 12.1 Spec scenarios from `experiment-edit/spec.md` verified end-to-end via live PATCH/PUT/POST against public domain (status edit success path, 409 conflict path, scaffold create + collision path)
- [x] 12.2 Spec scenarios from `live-updates/spec.md` verified: SSE `ready` event arrives via `curl --no-buffer` within <1s through Caddy; experiment-change events fire on PATCH; LogViewer SSE consumes `append`/`rotated`/`error`
- [ ] 12.3 Two-tab cross-update verification deferred to user (requires browser session)
- [ ] 12.4 Two-tab simultaneous edit conflict deferred to user (requires browser session)
- [x] 12.5 `openspec validate add-write-flow --type change` clean
- [ ] 12.6 Mobile responsive verification deferred to user (Tailwind responsive classes used throughout new modals; on-device confirmation pending)
