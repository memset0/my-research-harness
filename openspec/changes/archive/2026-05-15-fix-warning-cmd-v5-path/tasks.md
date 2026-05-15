## 1. CLI: route exp-id branch through `discoverExperiments`

- [x] 1.1 In `packages/cli/src/commands/warning.ts`, add
  `discoverExperiments` to the existing `@memon/core` imports.
- [x] 1.2 In `resolveTarget(ctx, idOrSlug)`:
  - After `singleProjectRoot(r)`, capture
    `const projectName = r.config.projects[0]!.name`.
  - In the `EXP_ID_RE.test(idOrSlug)` branch (currently
    `const readmePath = join(projectRoot, 'docs', 'experiments',
    \`${idOrSlug}.md\`)`):
    - Call `const { experiments } = await
      discoverExperiments(projectRoot, projectName)`.
    - Find `const exp = experiments.find((e) => e.id === idOrSlug)`.
    - When `exp` is `undefined`, `emitErrorAndExit('NOT_FOUND',
      \`experiment "${idOrSlug}" not found in ${projectRoot}\`)`.
    - Return
      `{ readmePath: exp.path, projectRoot, targetId: idOrSlug,
        isExpDoc: true }`.
  - Leave the run-dir-form branch (lines 53-68) unchanged.
- [x] 1.3 Remove the stale `// v3: experiment id ...` comment above
  line 49 — replace with a one-line comment "Exp-id form: resolve
  via the v5-aware discovery helper, which handles both the v5 folder
  layout and the v4 legacy file fallback".

## 2. Tests: cover the v5 exp-doc branch

- [x] 2.1 In `packages/cli/src/commands/warning.test.ts`, add an
  exp-doc README fixture constant near the top:

  ```ts
  const EXP_README_BASE = `---
  id: E0001-foo
  slug: foo
  title: Exp foo
  status: OPEN
  archived: false
  runs: []
  hypotheses: []
  tags: []
  created_at: '2026-05-01T08:00:00+08:00'
  updated_at: '2026-05-01T08:00:00+08:00'
  ---

  ## Motivation

  m

  ## Method

  x

  ## Conclusion

  c

  ## Caveats

  cav

  ## Warnings

  | Row ID | Created | Status | Category | Run | Message | Resolved at | Resolved by | Resolution note |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  `
  ```

- [x] 2.2 Add a new `describe('memon experiment warning * — v5 exp
  doc', ...)` block with its own `beforeEach` that:
  - Creates `root = await fs.mkdtemp(...)`.
  - Creates `expDir = join(root, 'docs', 'experiments', 'E0001-foo')`
    and writes `EXP_README_BASE` to `join(expDir, 'README.md')`.
  - Reuses the existing `exitSpy` / stdout/stderr capture from the
    file-level setup, OR mirrors that capture inside the describe
    block.
- [x] 2.3 Inside the new describe, add the following tests:
  - `it('writes the new row to the v5 exp folder README on `warning
    add E0001-foo`', ...)` — invoke `runWarningAdd({ cwd: root,
    projectRoot: root, runId: 'E0001-foo', run: 'bar-260501-100000',
    category: 'result', message: 'loss diverges' })`; assert the
    `docs/experiments/E0001-foo/README.md` body contains "loss
    diverges" and `bar-260501-100000`, and that the JOURNAL has
    `op=add ... run=bar-260501-100000`.
  - `it('returns NOT_FOUND when the exp-id is missing', ...)` —
    invoke with `runId: 'E0099-missing'`; assert exit code 2 and
    stderr error code `NOT_FOUND`.
  - `it('warning list returns the rows from the v5 exp folder
    README', ...)` — after a successful add, invoke `runWarningList`
    and assert `warnings.length === 1`.

## 3. Verification

- [x] 3.1 `pnpm --filter @memon/cli test` passes, including the new
  describe block.
- [x] 3.2 `pnpm --filter @memon/core typecheck` and
  `pnpm --filter @memon/core build` still pass (the change does not
  touch core but core is rebuilt for the runtime import).
- [x] 3.3 Smoke test against the repo's `mock/project-a/`: after
  building, run

  ```bash
  pnpm --filter @memon/cli build
  node packages/cli/dist/index.js experiment warning add E0001-vpred-convergence \
    --category context --message "smoke test row from fix-warning-cmd-v5-path" \
    --project-root mock/project-a
  ```

  Expected: stdout `{"ok":true,"rowId":"w_...","mtime":...,"hash":"..."}`,
  and the new row visible in
  `mock/project-a/docs/experiments/E0001-vpred-convergence/README.md`.
  Then remove the test row manually (or revert via git) so the mock
  fixture is clean again.
- [x] 3.4 `openspec validate fix-warning-cmd-v5-path --type change` is
  clean.
