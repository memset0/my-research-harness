# Design — fix-experiment-id-v5-readdir

## D1. Why `id.ts` was missed by the v4→v5 migration

The migration spec (`openspec/changes/migrate-fs-v4-to-v5/`) enumerated
seven groups of tasks (1.x parser, 2.x discovery, 3.x CLI, 4.x web,
5.x mocks, 6.x core integration tests, 7.x skills). The id allocator
lives in `packages/core/src/experiments/id.ts` and is invoked exclusively
from `packages/cli/src/commands/experiment-doc.ts:158`
(`runExperimentCreate`) and `apps/web/lib/experiments.ts:408` (the web
equivalent). Neither call site was edited during the migration — they
already routed through `nextExperimentId`, so the migration assumed the
allocator was a passthrough.

The allocator does its own `readdir` + regex match, independent of
`discoverExperiments`. Because that scan was hard-coded to
`EXPERIMENT_FILENAME_REGEX` (the v4 `.md` form) and the test fixtures
seed v4 `.md` files, the migration's CI-green signal masked the actual
behavior on v5 data. This is the same failure mode as F1 in CLAUDE.md
("CI passing != feature working"), translated to the FS-version axis.

## D2. Why allocate over the union of v5 folders + v4 files

The v5 migration is atomic per-commit at the project-root level (one
`git mv` loop, one version-marker bump). But during the migration's
own execution window — between the first `git mv` and the last —
`docs/experiments/` contains a mix of legacy `.md` files and newly
created folders. Any caller that allocates an experiment ID during
this window (unlikely but possible: a script running `memon
experiment create` concurrently with the migration) must see the
*combined* max NNNN, not just one form's max. Counting both forms
guarantees the monotonic-allocation invariant even mid-migration. The
extra cost is one regex test per entry, negligible.

Once the migration is done, the legacy regex never matches anything
on a real project root, so the v4 branch is dead code on the happy
path — but still cheaply executed.

## D3. Why NOT stat() each entry

The simpler alternative is to `readdir` and check entry type via the
`Dirent.isDirectory()` API (`fs.readdir(path, { withFileTypes: true })`),
which is one syscall total instead of N. This change does NOT take
that route, because:

1. The folder/file distinction is already an error case caught by
   `discoverExperiments` via the `MIGRATION_COLLISION` warning. If
   both `E0001-foo.md` AND `E0001-foo/` exist for the same id, the
   user must resolve manually — the allocator counting both as one
   slot toward NNNN allocation is the right behavior either way.
2. The id allocator runs once per `experiment create` call. The
   bottleneck is the file system, not the regex; whether we use
   `Dirent` or string regex makes no measurable difference.
3. Keeping the API surface (`readdir(path)` returning strings) means
   the tests can stub via an in-memory map without touching
   `Dirent` plumbing.

So the implementation simply does `for (const entry of readdir(...))
{ if (matches v5 regex) ...; else if (matches v4 regex) ... }`.

## D4. Test rewrite strategy

The existing `id.test.ts` is structurally fine — two `describe` blocks
(`nextExperimentId` and `resolveExperimentId`), `mkdtemp`-based
isolation, no mocks. Only the fixture-seeding lines need to switch
from `writeFile('Exxxx-foo.md', '')` to
`mkdir('Exxxx-foo'); writeFile('Exxxx-foo/README.md', '')`.

ADD one fixture case (`mixed v4 + v5 entries during migration window`)
that seeds both shapes and verifies the union-max behavior. This
prevents regressions if a future refactor accidentally drops the
fallback branch.

The `id.test.ts` tests SHALL NOT be moved to a different file. The
v4-style "raw `.md` in `docs/experiments/`" cases are RETAINED in the
suite (under a renamed `describe` block like "legacy fallback during
v4→v5 migration") because the allocator still supports them per D2.

## D5. Out of scope

- This change does NOT touch `discoverExperiments`, `readExperimentDoc`,
  the parser, or any web/CLI command body. Those were correctly
  migrated.
- This change does NOT introduce a new spec capability — it modifies an
  existing requirement in `experiment-edit`.
- This change does NOT add a `Dirent`-based optimization (see D3).
- This change does NOT update the canonical `experiment-discovery` spec
  (its v5 update lives in the in-flight `migrate-fs-v4-to-v5` change
  and will land at its archive).

## D6. Verification beyond unit tests

After the implementation lands, the verification step SHALL hit a real
v5 project root (the repo's `mock/project-a/`, which has
`E0001..E0005` as v5 folders) via the CLI:

```
node packages/cli/dist/index.js experiment ls --project-root mock/project-a
# (sanity check that discovery is still happy)

# Allocate a new ID, then immediately delete the would-be folder. We
# want this to return E0006, not E0001.
node -e "
  import('./packages/core/dist/experiments/id.js').then(async m => {
    console.log(await m.nextExperimentId('mock/project-a'))
  })
"
# expected: E0006

# Slug resolution by bare slug, by full id
node -e "
  import('./packages/core/dist/experiments/id.js').then(async m => {
    console.log(await m.resolveExperimentId('mock/project-a', 'zero-snr-eval'))
    console.log(await m.resolveExperimentId('mock/project-a', 'E0001-vpred-convergence'))
    console.log(await m.resolveExperimentId('mock/project-a', 'nonexistent'))
  })
"
# expected: E0002-zero-snr-eval / E0001-vpred-convergence / null
```

This sanity-check lives in tasks.md as a verification step, not in the
test suite (the test suite already covers the contract end-to-end
against temp dirs).
