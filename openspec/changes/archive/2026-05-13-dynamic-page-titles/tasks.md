## 1. Root layout — title template

- [x] 1.1 Edit `apps/web/app/layout.tsx`: change `metadata.title` from
  the string `'memon'` to
  `{ default: 'memon', template: '%s · memon' }`. Leave `description`
  unchanged.

## 2. Project routes

- [x] 2.1 `apps/web/app/p/[project]/layout.tsx` — add
  `generateMetadata({ params })` returning
  `{ title: decodeURIComponent((await params).project) }`. This makes
  every descendant page that does NOT set its own title fall back to
  `<project> · memon`, and gives the project layout itself the
  project name when applicable.
- [x] 2.2 `apps/web/app/p/[project]/page.tsx` — rely on the layout's
  metadata (no need to set a page-level title for the bare project
  list; the project name is the right title).
- [x] 2.3 `apps/web/app/p/[project]/digests/page.tsx` — add
  `generateMetadata` returning
  `{ title: \`Digests · ${decodeURIComponent((await params).project)}\` }`.
- [x] 2.4 `apps/web/app/p/[project]/digests/[id]/page.tsx` — add
  `generateMetadata` returning
  `{ title: \`${id} · Digests · ${project}\` }` using decoded params.
- [x] 2.5 `apps/web/app/p/[project]/reports/page.tsx` — same as digests
  list but `Reports`.
- [x] 2.6 `apps/web/app/p/[project]/reports/[id]/page.tsx` — same as
  digest detail but `Reports`.
- [x] 2.7 `apps/web/app/p/[project]/hypotheses/page.tsx` — title
  `Hypotheses · <project>`.
- [x] 2.8 `apps/web/app/p/[project]/journal/page.tsx` — title
  `Journal · <project>`.

## 3. Experiment routes

- [x] 3.1 `apps/web/app/p/[project]/e/[id]/page.tsx` — add
  `generateMetadata({ params })` that resolves the experiment via
  `getRuntime()` (or `getExperimentData(id)` if already exported from
  `lib/server/data`), extracts the `slug` from the experiment's
  frontmatter / record, and returns
  `{ title: \`${expId} ${slug} · ${project}\` }`. If id cannot be
  parsed or experiment cannot be resolved, return
  `{ title: \`${rawId} · ${project}\` }`. Wrap body in try/catch.
- [x] 3.2 `apps/web/app/p/[project]/experiments/[id]/page.tsx` — same
  shape as 3.1 (this route is the older form pointing at the same
  detail; share the title format).
- [x] 3.3 (Skip) `apps/web/app/p/[project]/r/[id]/page.tsx` — redirect
  only, no title.

## 4. Top-level utility routes

- [x] 4.1 `apps/web/app/manage/tmux/page.tsx` — add static
  `export const metadata = { title: 'Tmux' }`.
- [x] 4.2 `apps/web/app/terminal-popup/page.tsx` — add
  `generateMetadata({ searchParams })` implementing the three cases
  in spec § "Terminal popup title": raw `sessionName`, structured
  `scope:slug`, or fallback `Terminal`. Validate against the same
  `RAW_SESSION_NAME_RE` / `VALID_SCOPES` constants already in the
  file. Do not throw on bad input.

## 5. Verification (F1 protocol)

- [x] 5.1 Read auth credentials from `config.yml` as documented in
  `CLAUDE.md`.
- [x] 5.2 Restart the prod build per `CLAUDE.md` "Dev: prefer prod
  build" sequence (kill old, build `@memon/web`, start). Do NOT
  delete `.next/` while the server is running.
- [x] 5.3 `pnpm --filter @memon/web typecheck` is clean.
- [x] 5.4 For each route in the spec's scenarios, curl with auth
  and grep `<title>...</title>` from the served HTML. Each grep
  MUST match the expected exact string. Routes to verify:
  - `/` (expect `<title>memon</title>`)
  - `/p/<a-real-project>` (expect `<project> · memon`)
  - `/p/<project>/digests`, `/reports`, `/hypotheses`, `/journal`
  - `/p/<project>/digests/<a-real-D-id>` and `/reports/<R-id>`
  - `/p/<project>/e/<a-real-E-id-slug>` (verify slug appears)
  - `/p/<project>/e/E9999-nonexistent` (verify graceful fallback to
    `E9999 · <project> · memon`; page body returns 404 markup is
    fine, the title check is the focus)
  - `/manage/tmux` (expect `Tmux · memon`)
  - `/terminal-popup?sessionName=memon-something` and
    `/terminal-popup?project=p&scope=run&slug=s-260513-091200`
- [x] 5.5 Document the verification results inline in the implementing
  commit message or as a one-line summary in the chat — F1 says
  "200 OK proves nothing"; the HTML-grep evidence is the proof of
  completion.

### Verification results (5.5)

All 14 routes verified against prod build on `localhost:3737`:

| Route | Rendered `<title>` |
| --- | --- |
| `/` | `memon` |
| `/p/project-a` | `project-a · memon` |
| `/p/project-a/digests` | `Digests · project-a · memon` |
| `/p/project-a/digests/D0001` | `D0001 · Digests · project-a · memon` |
| `/p/project-a/reports` | `Reports · project-a · memon` |
| `/p/project-a/reports/R0001` | `R0001 · Reports · project-a · memon` |
| `/p/project-a/hypotheses` | `Hypotheses · project-a · memon` |
| `/p/project-a/journal` | `Journal · project-a · memon` |
| `/p/project-a/e/E0001-vpred-convergence` | `E0001 vpred-convergence · project-a · memon` |
| `/p/project-a/e/E9999-nonexistent` | `E9999 · project-a · memon` |
| `/manage/tmux` | `Tmux · memon` |
| `/terminal-popup?sessionName=memon-some-session` | `memon-some-session · memon` |
| `/terminal-popup?project=p&scope=run&slug=foo-260513-091200` | `run:foo-260513-091200 · memon` |
| `/terminal-popup` | `Terminal · memon` |

Implementation note: Next.js does not chain `title.template` across
nested layout segments, so the project layout sets a template that
includes ` · <project> · memon` (instead of pages stringing the project
name in themselves). The root layout's template `'%s · memon'` then
applies only to routes outside the project subtree
(`/`, `/manage/tmux`, `/terminal-popup`).

Pre-existing oddity discovered during verification (not addressed by
this change): `/p/<project>/experiments/[id]` 404s for v3 E-ids
because the route's `getExperimentData()` helper still looks up via
`rt.index` (RunIndex) rather than `rt.experiments`. The route's
`generateMetadata` resolves correctly, but Next.js renders the
not-found tree (which inherits the project layout's title), so the
title shows `project-a · memon` on the 404 page. The `/p/<project>/e/[id]`
route uses `rt.experiments` directly and resolves end-to-end.
