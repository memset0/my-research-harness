## Context

The web dashboard's title is set once in `apps/web/app/layout.tsx`:

```ts
export const metadata: Metadata = {
  title: 'memon',
  description: 'Run monitoring & management',
}
```

Every route under `/p/<project>/**`, `/manage/tmux`, and `/terminal-popup`
inherits this. Browsers therefore render identical tabs for distinct
pages, defeating the user's tab/bookmark workflow when multiple pages
are open across projects.

Next.js App Router supports a per-route metadata API with two relevant
pieces:

1. `metadata.title.template` on a layout: a string with `%s` placeholder
   that wraps the title contributed by descendant pages.
2. `generateMetadata({ params, searchParams })` on a page: an async
   function that returns a `Metadata` object whose `title` becomes the
   `%s` substitution.

Pages currently are server components that already `await getRuntime()`
or `await getExperimentData()` to render. `generateMetadata` can reuse
the same calls — Next.js de-duplicates concurrent `fetch`/cache reads
within one render, and `getRuntime()` is in-process. So the cost of
adding a title is essentially zero.

## Goals / Non-Goals

**Goals:**
- Every distinct route renders a distinct, human-scannable `<title>`.
- One global title template (`%s · memon`) so per-page titles only
  need to express the page-specific segments.
- Reuse existing data fetches; no new HTTP round-trips or runtime
  changes.
- Graceful fallback when the dynamic id cannot be resolved (404, orphan,
  runtime error) — emit the id alone rather than throwing.

**Non-Goals:**
- Updating the `description` meta tag per route (out of scope).
- Open Graph / Twitter card metadata (out of scope).
- Localizing titles (the rest of the UI is English-only).
- Changing in-page H1s or breadcrumbs — those are independent of
  document titles.
- Adding a title to the legacy `/p/<project>/r/<id>` redirect (it
  immediately throws a redirect; no title is rendered).

## Decisions

### D1. Use `title.template` on the root layout, default `'memon'`

Set the root layout's metadata to:

```ts
export const metadata: Metadata = {
  title: { default: 'memon', template: '%s · memon' },
  description: 'Run monitoring & management',
}
```

- `default: 'memon'` is what gets rendered when a page does NOT supply
  its own title (e.g. the `/` redirect fallback render).
- `template: '%s · memon'` wraps any page-supplied title.

Alternatives considered:
- **One central title-builder function imported by every page.** Rejected
  — Next.js's built-in template covers this exact case, and avoids
  client/server module boundaries.
- **Setting a layout-level title that pages override.** Rejected —
  Next.js merges nested layout metadata, but for our case the segments
  are page-specific (id, slug), so doing it in the page is cleaner.

### D2. Use `generateMetadata` (not static `metadata`) on every dynamic route

For server-rendered pages with `params`, `generateMetadata` is the
correct API. Static `metadata` cannot read `params`. Use static
`metadata` only on the leaf pages with no params: `/manage/tmux`.

### D3. Title segment ordering: most-specific first, joined by ` · `

Reading order: the leftmost segment is the most specific resource on
screen; the rightmost (before the template's `· memon`) is the
broadest container (project name).

- `E0042 my-slug · my-project` reads as "this is experiment E0042 with
  slug my-slug, in project my-project". The browser tab strip — which
  truncates from the right — keeps the most specific token visible.

Alternatives considered:
- **Coarse-to-fine ordering (`my-project · Digests · D0007`)**: rejected.
  When the OS truncates tabs, all the user sees is the project name
  repeated, which is the opposite of what helps distinguish tabs.

### D4. Experiment title format: `<E-id> <slug>` (space-separated)

The id and slug together form a unique, machine-grep-able token while
remaining human-scannable. Space (not hyphen) between id and slug so
the user can copy/paste the id alone with a double-click.

Alternatives considered:
- `<slug> (<E-id>)` — slightly nicer reading, but harder to grep.
- Just the id — too cryptic for users who don't memorize ids.
- The frontmatter `title:` field — not all experiments have a title;
  inconsistency across the project would be jarring.

### D5. Reuse existing runtime lookups; no new fetch paths

For experiment routes, `generateMetadata` calls `getRuntime()` (or the
same `getExperimentData()` the page uses). The runtime singleton is
cached in-process and refreshed by the poller; reading from it is
~microseconds.

For terminal-popup, the `sessionName` / `scope` / `slug` query params
are already validated on the page; `generateMetadata` re-parses the
same shape.

### D6. Graceful fallback in `generateMetadata`

`generateMetadata` MUST NOT throw. If id resolution fails:
- Experiment route: return just the id (e.g. `E0042 · my-project`) and
  let the page itself render the 404.
- Project layout: if project name doesn't exist, return `<project>` as
  given (the layout will `notFound()` anyway).
- Digest/Report: return the id alone.
- Terminal popup: if neither shape is recognizable, return `Terminal`.

Wrapping body in try/catch and falling back is cheap insurance against
runtime errors making every page un-titled.

## Risks / Trade-offs

- **[Risk] `generateMetadata` runs before the page body, so a slow
  experiment lookup blocks first paint.** → Mitigation: we only read
  from the in-process runtime singleton (already loaded by the time
  the request arrives in steady state). Cold start is the same path
  the page itself takes, so we don't add new latency.
- **[Risk] Title template doubles `memon` if a page explicitly emits
  a title ending in `memon`.** → Mitigation: instruct that page titles
  contain ONLY the page-specific segments; the template adds `· memon`.
  Reviewer should reject any `generateMetadata` whose title literal
  contains `memon`.
- **[Trade-off] Adding `generateMetadata` to ~10 routes is mechanical
  boilerplate.** → Acceptable. Centralizing into a helper would couple
  routes to a shared module and offer little savings.
- **[Risk] When a page resolves the same experiment from the runtime
  twice (once in `generateMetadata`, once in the page body), the cost
  doubles.** → Mitigation: in practice `getRuntime()` returns the
  same singleton instance, and `index.get(id)` is O(1). Both calls
  resolve in microseconds; no concern.

## Migration Plan

1. Update root layout `metadata.title` to `{ default, template }`. This
   is a no-op for any page that doesn't yet supply its own title —
   `default: 'memon'` preserves current behavior.
2. Add `generateMetadata`/`metadata` to each route, one route per
   commit-able unit if desired. Order doesn't matter — pages without
   their own metadata continue to get `memon`.
3. After all routes are wired, verify per `CLAUDE.md` F1 protocol: curl
   each route and grep the `<title>` tag.

No rollback risk: title changes are visible only in the browser tab
chrome and bookmarks. Reverting is a pure code revert.
