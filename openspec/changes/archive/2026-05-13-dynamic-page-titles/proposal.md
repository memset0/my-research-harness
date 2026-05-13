## Why

Every route in the dashboard currently renders the same `<title>memon</title>`
(set once in `apps/web/app/layout.tsx`). Browser tabs, history entries,
and bookmarks therefore can't tell pages apart — a user with five tabs
open across two projects, an experiment detail, a digest, and the tmux
manage page sees five identical titles. Making the title reflect the
opened content is the minimum bar for a multi-tab dashboard.

## What Changes

- Add a `metadata.title.template` of `"%s · memon"` (with default
  `memon` as fallback) on the root layout so every page that supplies
  its own title automatically gets the `· memon` suffix.
- Add `generateMetadata` (or static `metadata`) to each route so each
  rendered page contributes its own title segment. Format (left-to-right
  = most specific to least specific, joined by ` · `):
  - `/` → `memon` (fallback, no template)
  - `/p/<project>` → `<project>`
  - `/p/<project>/digests` → `Digests · <project>`
  - `/p/<project>/digests/<id>` → `<D-id> · Digests · <project>`
  - `/p/<project>/reports` → `Reports · <project>`
  - `/p/<project>/reports/<id>` → `<R-id> · Reports · <project>`
  - `/p/<project>/hypotheses` → `Hypotheses · <project>`
  - `/p/<project>/journal` → `Journal · <project>`
  - `/p/<project>/e/<id>` → `<E-id> <slug> · <project>`
    (e.g. `E0042 my-slug`; resolved via the runtime experiment index)
  - `/p/<project>/experiments/<id>` → same shape as `e/<id>`
  - `/manage/tmux` → `Tmux`
  - `/terminal-popup` → `<sessionName>` if `sessionName=` is given;
    otherwise `<scope>:<slug>` (e.g. `run:my-run-260513-091200`)
- Treat unresolved ids gracefully: if the experiment id can't be
  resolved (orphan run-redirect path, or runtime lookup fails), fall
  back to just the id without slug. Never throw from `generateMetadata`.

## Capabilities

### New Capabilities
- `page-titles`: governs how each route in the web dashboard derives
  its `<title>` from the route segment and the resource it represents,
  and the global title template that ties them together.

### Modified Capabilities
<!-- none -->

## Impact

- Affected code: `apps/web/app/layout.tsx` (template), and every route
  file under `apps/web/app/**/page.tsx` plus `apps/web/app/manage/tmux/page.tsx`
  and `apps/web/app/terminal-popup/page.tsx`. The legacy
  `/p/<project>/r/<id>` route only redirects, so it does not need a title.
- No data-layer changes. `generateMetadata` for experiment routes reuses
  the same `getRuntime()` index lookup the page already does — no new
  fetch path.
- No new dependencies. Pure Next.js App Router metadata API usage.
- Verification: the F1/F4 verification protocol applies — curl each route
  and grep the served HTML for `<title>...</title>` containing the
  expected segments.
