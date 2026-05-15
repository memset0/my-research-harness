## Context

The dashboard polls run state but is blind to the **repository** state of
each project. Users routinely flip between dashboard and terminal to
answer "what branch am I on?", "am I behind origin?", "did I commit
before launching that sweep?". A compact zsh-git-plugin-style indicator
inside the dashboard closes that loop.

Two existing patterns in this codebase are directly relevant:

- **`slurm-status`** — polls an external CLI (`squeue --me`) via
  `execFile`, exposes a `/api/slurm/status` JSON route, surfaces in
  the sidebar footer. We copy the shape almost verbatim for git.
- **`anomaly-banner`** — polls `/api/anomalies?project=...` and renders
  per-project content using TanStack Query. Demonstrates the
  per-project polling key pattern.

`/p/<project>/layout.tsx` is currently a thin wrapper. It is the
natural mount point for a new VSCode-style fixed footer.

## Goals / Non-Goals

**Goals:**

- Show per-project git working-tree state (branch, ahead/behind, dirty
  counts) in the sidebar AND in a new fixed bottom-bar on project
  pages.
- Reuse the existing "shell out + polling widget" pattern; no new
  watchers, no new dependencies.
- Graceful no-op when the project is not a git repo, when `git` is
  missing, or when `git status` times out.
- Establish `<ProjectFooter />` as a reusable bottom-bar primitive
  that future widgets (build state, monitor, etc.) can plug into.

**Non-Goals:**

- Commit history viewing or diff display (deferred to a follow-up).
- Interactive git operations from the dashboard (commit, push, fetch).
- Periodic `git fetch` to refresh ahead/behind against the remote —
  ahead/behind is reported relative to whatever local refs the user
  last fetched.
- Per-file change list, stash, or tag count.

## Decisions

### D1. Shell out to `git` via `execFile`

Alternatives considered: `simple-git` (npm package), `isomorphic-git`
(pure JS), raw `child_process.exec`.

**Chosen:** `execFile('git', ['status', '--porcelain=v2', '--branch',
'--ignore-submodules=all'], { cwd, timeout })`.

- Mirrors `slurm-status`'s `execFile('squeue', ...)` pattern → fewer
  surprises for future maintainers.
- No new npm dependency. `git` is universally available on the user's
  cluster nodes; if it isn't, the reader returns `{ enabled: false,
  reason: 'git-not-found' }` and we never blow up.
- `--porcelain=v2 --branch` gives branch + upstream + ahead/behind +
  per-file state in one stable, parsable stream.
- `--ignore-submodules=all` avoids unbounded recursion in repos with
  vendored submodules.
- `execFile` (not `exec`) means no shell interpolation; the cwd is the
  only attacker-controlled-ish input and it comes from the
  `Config.projects` registry, not the URL.

### D2. Single command, single parse

Rather than running `git symbolic-ref` + `git rev-parse` + `git status`
separately, we parse one `--porcelain=v2 --branch` stream:

- Header lines `# branch.head <ref>`, `# branch.upstream <ref>`,
  `# branch.ab +<n> -<n>` are the meta.
- Body lines starting with `1`, `2`, `u`, `?` give file state. We
  count rather than itemize: staged = lines whose XY[0] != `.`,
  unstaged = lines whose XY[1] != `.`, untracked = lines starting
  with `?`.
- For detached HEAD: `# branch.head (detached)` and we read the SHA
  from `# branch.oid <sha>`.

A small parser unit-tests trivially.

### D3. Single config knob `git_status.interval_ms` (default 10s)

Slurm widget polls every 1s because users want job state changes to
land instantly. Git working-tree state moves on the cadence of editor
saves and the occasional `git commit`, so 10s is plenty.

ONE `git_status.interval_ms` value (default `10000`, min `1000`)
drives BOTH:

- the client TanStack `refetchInterval` (`staleTime = intervalMs / 2`)
- the server-side throttle window in the API route

Tying them together means the user has one knob, the two sides can't
drift, and at t=intervalMs the server cache expires just as the
client fires its next poll — so the next response is always fresh.

Alternatives considered: two separate keys (`poll_interval_ms` and
`throttle_window_ms`). Rejected — the only sensible relation between
them is `throttle ≤ poll`, and the safest setting is `throttle ==
poll`. Two knobs invites footguns (throttle > poll → users see stale
data even between polls) without buying anything useful.

### D4. Server-side throttle uses the same `intervalMs`

The API route keeps a tiny in-memory cache keyed by `project.name`:
`{ readAt: number; result: GitStatus }`. If a request arrives within
`intervalMs` of `readAt`, the cached `result` is returned without
re-shelling.

This protects against:
- HMR / dev reload storms that fire multiple requests at once.
- Future client bugs that accidentally tighten the poll interval.
- Multiple browser tabs polling in parallel.

### D4a. How the client receives `intervalMs`

Pure config flows server → client through a new SSR-injected
`<script id="memon-runtime-config" type="application/json">` element
in the root layout, mirroring the existing `memon-session` bootstrap.
A small `apps/web/lib/runtime-config.ts` reader (and a `useRuntime
Config()` hook for client components) parses it once on first read
and memoizes the result. Default fallback (when the script tag is
absent — e.g. unit-test render without SSR) is `intervalMs: 10000`.

### D5. Discriminated-union response shape

```ts
type GitStatus =
  | { enabled: false; reason: 'not-a-repo' | 'git-not-found' |
      'timeout' | 'error'; message?: string }
  | {
      enabled: true;
      branch: string | null;     // null when detached
      detached: boolean;
      sha: string;               // short SHA (always present)
      upstream: string | null;
      ahead: number;             // 0 when no upstream
      behind: number;
      staged: number;
      unstaged: number;
      untracked: number;
      dirty: boolean;             // staged + unstaged + untracked > 0
    }
```

Matches `SlurmStatus`'s `{ enabled: false } | { ... }` discriminator.
UI components early-return on `!data.enabled`.

### D6. Project name → root resolution at the route layer

The route handler resolves `params.name` through
`runtime.config.projects.find(p => p.name === name)`. No path comes
from the URL. This is structurally safer than calling
`assertWithinProjectRoots(arbitraryPath)` because we never accept a
path at all.

If the name doesn't match a registered project, return 404.

### D7. Viewer scope enforcement

Viewer sessions get 403 for projects outside their scope set. The
sidebar widget on the client side suppresses the pill on any
non-200 response, so out-of-scope viewers see nothing rather than an
error.

### D8. Shared `<GitStatusPill />`, two variants

```tsx
<GitStatusPill project={name} variant="compact" />   // sidebar
<GitStatusPill project={name} variant="footer" />    // project footer
```

Both variants share the same TanStack query key `['git-status', name]`
so the polling dedupes — the sidebar pill and the footer pill on the
same project make ONE shared request per 5s, not two.

- **compact:** `<GitBranch icon> <branch (truncate 12)> <dot if dirty>`.
  Tooltip surfaces ahead/behind + counts on hover.
- **footer:** `<GitBranch icon> <branch> [↑a ↓b] [●s ○u ?n]`.
  Monospace, fits in a ~26px row, tooltip on hover for the full
  upstream ref.

Both variants render nothing when `data.enabled === false` or when
the query is pending on its first load (no skeleton flash, matches
`SlurmStatusWidget`).

### D9. `<ProjectFooter />` as the project-scoped bottom-bar primitive

New `apps/web/components/project-footer.tsx`:

- `position: fixed; bottom: 0; left: 0; right: 0` with a `z-index`
  below `Toaster` (sonner is at 100) but above content.
- Height ~26px, `border-t`, `bg-card text-muted-foreground` semantic
  classes (CLAUDE.md F4 — must verify the tokens exist before
  shipping).
- On desktop, sits inside the same grid as the sidebar so it doesn't
  cover the sidebar (i.e. left edge = sidebar width). On mobile, full
  width.
- Initial content: project name + git-status pill (footer variant).
  Reserves a flex right-slot for future widgets.
- Mounted in `app/p/[project]/layout.tsx`. Adds `pb-7` to the
  children container so the last row isn't covered.

### D10. No new SSE topic — polling only

Live updates spec gets no changes. Polling is sufficient because:

- Git state doesn't need sub-second freshness.
- Adding an SSE topic implies a server-side watcher → would need
  either `fs.watch` (forbidden) or a server-side poller that fans
  out, which adds complexity for marginal gain.

If a future workflow demands real-time git updates, we can revisit.

## Risks / Trade-offs

- **[git binary missing on host]** → reader returns `{ enabled: false,
  reason: 'git-not-found' }`; pills render nothing globally. Surface
  this once at runtime init time in the server log so debugging is
  possible.
- **[NFS-mounted project root, slow `git status`]** → 3s `execFile`
  timeout. On timeout, return `{ enabled: false, reason: 'timeout' }`
  and the pill goes empty for that cycle. The next 5s tick retries.
- **[Branch name with weird chars (slashes, unicode, emoji)]** →
  Rendered as a React text node + CSS truncation. Never embedded in
  another shell command.
- **[Stale cached result if user commits via terminal between
  polls]** → 5s window is acceptable. An explicit refresh button can
  be added in a follow-up if it bites.
- **[Submodule-heavy repos]** → `--ignore-submodules=all` keeps the
  output bounded.
- **[Mobile viewport]** → Footer eats ~26px; chunk content gets `pb-7`
  to avoid overlap. If footer is intolerable on small screens, a
  follow-up can make it tap-collapsible.
- **[Repo at project root vs repo above project root]** → `git status`
  inside a subdirectory of a repo Just Works (git auto-discovers
  `.git`). So if a user's project root is e.g. `<monorepo>/projects/
  foo/`, the reader correctly reports the monorepo's branch. Document
  this in the spec — it is the desired behavior.

## Migration Plan

Pure additive. No migration, no flag, no spec deletions.

- Deploy → polling kicks in immediately for any open dashboard tab.
- Rollback → revert the change set; no on-disk artifacts to clean.

## Open Questions

- **Should the footer include the project name?** Defaulting to YES
  for v1 (`<project-name> · <branch> ●N`), because the sidebar
  selection isn't always in view on smaller screens and the breadcrumb
  doesn't currently include the project name on all sub-pages. Easy
  to revisit.
- **Should we surface upstream ref in the footer?** Defaulting to NO
  in the visible row (it'd crowd the bar) but YES in the tooltip
  (`upstream: origin/<branch>` line). The compact-variant tooltip
  also includes it.
