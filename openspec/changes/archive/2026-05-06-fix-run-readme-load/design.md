## Context

The v3 ReadmeEditor accepts an optional `target: EditorTarget`:

```ts
type EditorTarget =
  | { kind: 'exp'; id: string }
  | { kind: 'run'; id: string }
```

For exp doc targets the load path is:
- `fetchExpDocReadme(id)` → GET `/api/experiments/:id` → reads
  `detail.path` (which IS the .md file for exp docs) → calls
  `fetchReadme(detail.path)`.

For run targets the load path falls through to `fetchReadme(path)`
where `path` is whatever the caller passed in `props.path`. In
`experiment-page.tsx` that prop comes from `run.path`, which is the
**run directory** (the README sits inside as `README.md`). Hitting
`/api/readme?path=<dir>` triggers `EISDIR` server-side.

There are two clean fix shapes:

1. **Client-side helper.** Add `fetchRunReadme(id)` mirroring
   `fetchExpDocReadme(id)`: GET `/api/runs/:id`, take `detail.path`,
   join `/README.md`, fetch via `/api/readme`. Editor switches its
   load branch when `target.kind === 'run'`.
2. **Server-side GET.** Add `GET /api/runs/:id/readme` (and likely
   `GET /api/experiments/:id/readme` for symmetry) that returns the
   file in one round-trip. The client helpers shrink.

## Goals / Non-Goals

**Goals:**
- The run README load works without EISDIR.
- The save side keeps working unchanged.
- The fix is minimal and matches the existing exp-doc-side pattern,
  so the asymmetry between the two helpers stays small.

**Non-Goals:**
- Adding new GET endpoints in this change. The `fetchExpDocReadme`
  source comment says "the GET on /api/experiments/:id/readme could
  be added later" — same reasoning applies to the run side, but
  collapsing both to a single GET endpoint each is a separate
  cleanup.
- Changing the meaning of `Run.path` from "run dir" to "README.md
  file". `Run.path = run dir` is load-bearing for the file-tree API,
  archive, terminal, and many other surfaces.

## Decisions

**D1. Use the client-side helper (option 1).** It mirrors the exp-
side exactly, doesn't introduce new HTTP routes, and matches the
existing technical-debt comment in `fetchExpDocReadme`. The cost is
one extra round-trip; that's already paid by the exp-doc side and
nobody has flagged it.

**D2. Helper name `fetchRunReadme`.** Symmetric with
`fetchExpDocReadme`. The `Doc` suffix on the exp helper is there
because exp docs have a separate "document" identity from runs;
`fetchRunReadme` doesn't need a suffix because there's only one
kind of run README.

**D3. The helper joins `path + '/README.md'` with a literal `/`.**
The web layer is the only consumer; the project root path is always
absolute and Posix-shaped (this is a Linux-only deployment per
CLAUDE.md). No need for `path.join` machinery.

## Risks / Trade-offs

- [Risk] If a future change moves the run README to a non-default
  filename (e.g. `INDEX.md`), the literal `/README.md` join breaks. →
  Mitigation: that's not on the v3 roadmap; if it lands, both the
  load helper and the spec scenario need to change together. The
  spec scenario explicitly names `README.md` to make this an obvious
  signal at review time.
- [Risk] The 2-RTT load (detail then file) is slower than a single
  GET. → Mitigation: the editor is opened on user click, latency is
  not load-bearing. The exp-doc side already pays this cost.

## Migration Plan

Code-only edit. No data migration. Restart picks it up.

## Open Questions

None.
