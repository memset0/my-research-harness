## Why

Clicking `Edit markdown (run)` from inside an expanded run panel on the
v3 exp detail page produces a load error:

```
Could not load README: EISDIR: illegal operation on a directory, read
```

Root cause: in `apps/web/components/readme-editor.tsx`, the
`loadFromDisk` helper has two branches:

```ts
if (target?.kind === 'exp') return fetchExpDocReadme(target.id)
return fetchReadme(path)   // legacy fallback used for kind === 'run' too
```

For runs, `path` (passed from `experiment-page.tsx` as `run.path`) is
the run **directory** — not the README file inside it. The legacy
`/api/readme?path=…` endpoint expects an absolute file path, so when
handed a directory it fails with `EISDIR`.

This is a regression introduced when v3's id-addressed targets were
plumbed through but the run-side load was never fixed to mirror the
exp-doc-side load helper (`fetchExpDocReadme(id)`, which derives the
file path from the detail endpoint and then GETs the file).

The save side (`putRunReadme(id, …)`) already works because it's id-
addressed via `PUT /api/runs/:id/readme` — only the load is broken.

The `experiment-edit` spec already says (Requirement: Run-panel
actions): "the editor opens with the content of
`<projectRoot>/<…>/bar-260501-100000/README.md`". So this is purely
an impl bug, not a spec change. A small spec clarification pinning the
load endpoint will keep this from regressing again.

## What Changes

- A new `fetchRunReadme(id)` helper SHALL exist in `apps/web/lib/api.ts`
  that mirrors `fetchExpDocReadme(id)`: GET `/api/runs/:id` to learn
  the run dir, then GET `/api/readme?path=<run-dir>/README.md` for the
  raw file content.
- The `ReadmeEditorBody.loadFromDisk` helper SHALL dispatch to
  `fetchRunReadme(id)` when `target.kind === 'run'`, instead of
  falling through to the legacy `fetchReadme(path)`.
- The `experiment-edit` spec gains a small clarification on the v3
  load path for run READMEs.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `experiment-edit`: extend the existing "Run-panel actions inside the
  exp detail page" requirement with an explicit load-endpoint scenario
  so the EISDIR regression is pinned by a test-shaped scenario.

## Impact

- `apps/web/lib/api.ts` — add `fetchRunReadme(id)`.
- `apps/web/components/readme-editor.tsx` — extend `loadFromDisk` to
  dispatch on `target.kind === 'run'`.
- No backend API change. No data shape changes.
