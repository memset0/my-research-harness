# Design — fix-warning-cmd-v5-path

## D1. Why use `discoverExperiments` and not a path constructor

The minimal-edit alternative is to hand-build the v5 path:

```ts
const readmePath = join(projectRoot, 'docs', 'experiments', idOrSlug, 'README.md')
```

This works for the happy path but quietly drops two pieces of behavior
the v5 discovery layer already encapsulates:

1. **Legacy v4 fallback.** Mid-migration, an exp doc may still live at
   `docs/experiments/E0001-foo.md` (no folder yet). `discoverExperiments`
   detects this and surfaces a `LEGACY_LAYOUT` warning while still
   returning the record. A hand-coded path constructor would 404 on the
   legacy file form even though the doc is reachable.
2. **MIGRATION_COLLISION detection.** When both `E0001-foo/` AND
   `E0001-foo.md` exist, the discovery layer flags this and prefers the
   v5 folder. A path constructor would silently pick one shape and
   could write to the wrong target.

Routing through `discoverExperiments` is also the convention every
other CLI exp-doc command in this repo uses
(`experiment-doc.ts:42-44`, `experiment.ts:43-46`), so this change
brings `warning.ts` in line.

## D2. Why NOT switch to `readExperimentDoc`

`readExperimentDoc(projectRoot, projectName, id)` is the singular form
that internally calls discover-by-id. Either would work; the
ListAllExperiments form is the same cost on a per-call basis because
the warning command only fires once per CLI invocation. I'm picking
`discoverExperiments` to stay consistent with how `experiment-doc.ts`
threads `discoverExperiments` results back to other code paths and to
keep error reporting uniform (the existing CLI commands report
"experiment not found in <root>" with the same wording).

## D3. Slug-only form not added by this change

The current code's exp-id branch only accepts the canonical
`E<NNNN>-<slug>` form (the `EXP_ID_RE` test gates entry). A user typing
`memon experiment warning add foo --category result --message ...`
falls through to the run-dir branch and gets a NOT_FOUND. This change
preserves that behavior — adding slug-only resolution to
`experiment warning *` is a new feature, not a bug fix. If desired,
it can ride on a follow-up.

## D4. Test fixture strategy

The existing `warning.test.ts` setup creates a single run dir
(`foo-260501-100000/README.md`) under `root` and exercises all
warning subcommands against that. The new exp-doc tests SHALL:

- Be in their own `describe` block (`'memon experiment warning * — v5
  exp doc'`) so the run-dir-form `beforeEach` doesn't pollute the
  exp-doc-form fixture (`root` is mkdtemp'd; either describe block
  builds whichever shape it needs in its own `beforeEach`).
- Seed an exp-doc fixture using the v5 layout:
  `docs/experiments/E0001-foo/README.md` with a minimal exp-doc body
  containing a `## Warnings` section (just the header row).
- Cover at least: `warning add` happy path (with `--run`), `warning
  list` returns the row, `warning add` against a non-existent exp id
  returns NOT_FOUND.

Tests should NOT use `--from-run` allocation logic or hit `experiment
create` — that's a separate code path. We're testing the
`resolveTarget` exp-id branch in isolation.

## D5. Out of scope

- This change does NOT add slug-only resolution to `warning *`
  subcommands (D3).
- This change does NOT update any web API. The web side (`PATCH
  /api/experiments/:id/warnings/...`) already uses the v5 path.
- This change does NOT modify `runWarningAdd` / `runWarningList` /
  `runWarningResolve` / `runWarningReopen` / `runWarningDelete`
  bodies. Only `resolveTarget` changes.
