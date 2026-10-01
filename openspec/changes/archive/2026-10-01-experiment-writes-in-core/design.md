## Context

See proposal.md — Why. Current state of the write paths:

- **CLI** (`packages/cli/src/commands/experiment-doc.ts`, `experiment.ts`
  (the formal Run-side commands live here despite the name), `run-rename.ts`,
  `warning.ts`) reads and writes with `node:fs`, appends legacy journal events
  that the CLI invocation ledger absorbs, and exits through `emitErrorAndExit`.
- **Backend** (`packages/backend/src/mutation-service.ts`,
  `FilesystemMutationService`) reads and writes through `projectFs`, records one
  invocation receipt per call, and throws `BackendMutationError`.
- **Standalone Web** (`apps/web/lib/server/standalone-*.ts`,
  `app/api/experiments/**`, `app/api/runs/**`) does *not* own a third write
  implementation: it already calls the Backend service in-process, adding the
  lock read for Web callers that omit one and the runtime/SSE refresh. Central
  Web reaches the same service through the direct gateway. There are therefore
  two write implementations and three callers.

### Difference table (operation × implementation)

| Operation | CLI | Backend (central + standalone) | Converged behavior |
|---|---|---|---|
| Experiment create — id allocation | `mkdir -p` then README `wx`, retry on README `EEXIST` | non-recursive `mkdir` of the bundle dir, retry on `EEXIST`, all four files `wx` | atomic `mkdir` (Backend) |
| create — README sections | passes all 11 section keys (v6 render) | passes 5 legacy keys, all null (v6 render) | one builder; v6 renderer over `CANONICAL_EXPERIMENT_SECTION_HEADINGS` (bytes were already equal) |
| create — `--from-run` Variant description | "Imported from an existing Run by `memon experiment create --from-run`; refine the Variant definition before launching another comparison." | "Imported from an existing Run; refine this Variant before reuse." | CLI text (spec silent; skills teach CLI output) |
| create — tags | always `[]` | caller-supplied | caller-supplied (CLI supplies none) |
| create — slug check | strict regex | wire schema only | core validates strict regex |
| create — from-run lock | none | required mtime+hash | optional in core; Backend still requires it |
| link / unlink — locks | none | Experiment and Run mtime+hash | optional in core; Backend still requires both |
| link — `runs[]` rewrite | drop bare id, append path if absent | `Set` (also collapses unrelated duplicates) | CLI (unrelated entries verbatim) |
| link — rewrite + rollback | `writeFileAtomic` | atomic replace + postimage rollback | single atomic replace (rollback of one rename is a no-op) |
| delete — removal | `rm -rf` | rename to `.memon-delete-<id>-<uuid>`, then `rm` | quarantine rename (Backend) |
| delete — lock | none | required | optional in core; Backend still requires it |
| Experiment status set — unchanged | rewrites README (bumps `updated_at`) | no write (`unchanged`) | no write (Backend) |
| Experiment status / archive — lock order | lock, then transform | lock, then transform | unchanged (lock first) |
| Run status set — document change | `status` only | `status`, `updated_at`, `finished_at` set/clear | Backend |
| Run status set — archived + RUNNING | written | refused (`FORBIDDEN`) | refused; CLI maps to `BAD_REQUEST` (exit 2) |
| Run status set / archive — stale lock + already in target | noop | noop | unchanged (noop first) |
| Run README write | verbatim bytes, missing README + `expectedMtime 0` creates | reparse, reserialize, stamp `updated_at` | kept as an explicit policy (`updatedAt: 'preserve' \| 'stamp'`), see D5 |
| Run archive / unarchive | core `setRunArchived` (no lock) | inline copy with optional lock | one primitive, optional lock |
| Warning add/resolve/reopen/delete | optional locks, category validated by CLI | required locks, category defaults to `other` | optional locks in core; input policy stays in adapters |
| Run rename | CLI only | — | moved into core unchanged |
| Experiment readme write | — | Backend only | moved into core unchanged |
| Experiment rename | already core (`renameExperiment`) | — | unchanged, out of scope |
| atomic replace | `writeFileAtomic` (mode not kept) | temp + rename, mode kept | temp (`atomicTempPath`) + rename, mode kept |

## Goals / Non-Goals

**Goals:**
- One implementation of each Experiment/Run write in `@memon/core`; CLI,
  Backend and standalone Web are adapters.
- Byte-identical outputs across CLI and Backend for the same inputs and clock,
  proven by a shared golden fixture.
- Unchanged wire shapes, unchanged CLI JSON keys and exit codes, unchanged
  Backend scheduling/caching (`projectFs` is injected, not replaced).

**Non-Goals:**
- The pseudo-HTTP/token layer in `apps/web/lib/server/central/direct-runtime.ts`.
- CLI command names or options; managed skills.
- Unifying target resolution (CLI `RunTargetIndex` / Backend
  `resolveRunReference`) — resolution stays per adapter.
- Moving `renameExperiment` or `deprecateRun` (already in core).

## Decisions

### D1. Core API and filesystem port

`packages/core/src/experiments/mutations.ts`:
`createExperiment`, `linkExperimentRun`, `unlinkExperimentRun`,
`setExperimentStatus`, `setExperimentArchived`, `deleteExperiment`,
`writeExperimentReadme`, `mutateDocumentWarning` (+ `addExperimentWarning`
convenience), `buildExperimentBundle` (pure).
`packages/core/src/runs/mutations.ts`: `setRunStatus`, `setRunArchiveState`,
`writeRunReadme`, `renameRun`.
Shared: `MutationFs`, `nodeMutationFs`, `readDocumentLock`,
`replaceDocumentAtomic`, `MutationError`, `DocumentLock`, `FileChange`.

```ts
export interface MutationFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile(path: string, data: string,
    options?: { encoding?: 'utf8'; flag?: string; mode?: number }): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
  rename(from: string, to: string): Promise<void>
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  stat(path: string): Promise<{ mtimeMs: number; mode: number }>
  readdir(path: string): Promise<string[]>
}
```

The Backend passes `projectFs` (so every mutation read/write keeps the project
file store's scheduling, containment and cache invalidation); the CLI passes
`nodeMutationFs` (`node:fs/promises`). Every primitive takes
`{ fs, now?: () => Date, ... }`; timestamps are `formatIsoLocal(now())`.
Primitives take *resolved* targets (README path, Experiment path/id, a parsed
Run with its derived owner) so each adapter keeps its own resolution and cache
semantics. Discovery helpers the primitives call (`nextExperimentId`,
`discoverExperiments`, `declaredRunOwner`) keep their existing `projectFs`
reads — outside a project-file context that facade is native fs.

Locks are `{ expectedMtime?: number; expectedHash?: string }`; an omitted field
is not checked. A stale lock throws `MutationError('CONFLICT')` carrying
`current: { content, mtime, hash }` and `details.stale: 'mtime' | 'hash'`.

Results report `changes: FileChange[]` (`{ path, before, after }`, contents or
null) so the Backend can emit typed `file-change` receipt details and the CLI
can ignore them.

Alternative considered: injecting the whole Backend service into the CLI.
Rejected — it would drag receipts, `ProjectConfig` resolution and HTTP-shaped
errors into a direct local tool.

### D2. Convergence (written into the delta specs)

- **Id allocation**: atomic non-recursive `mkdir` of `E<NNNN>-<slug>/`; on
  `EEXIST` recompute and retry (5 attempts). Because two writers with
  different slugs can both create `E<NNNN>-…` directories, the creator then
  lists the folder: when another entry holds the same number under a
  lexically smaller name it removes its own directory and retries (neither
  previous implementation guarded this). Files are then written with
  `wx` into the directory this call created; any failure removes it.
- **README sections**: one builder renders the canonical heading list from
  `documents.ts` (`CANONICAL_EXPERIMENT_SECTION_HEADINGS`) via the v6
  serializer; no caller passes a section map any more.
- **Variant prose**: the spec does not fix it, so the CLI text wins.
- **Proof**: golden fixture `packages/core/test-fixtures/mutation-parity/`
  (seed project + expected tree with a `{{NOW}}` placeholder). Core, CLI and
  Backend tests each run create, create-from-run, link, Experiment status set
  and Run status set against a copy of the seed with a fixed clock and compare
  the tree byte-for-byte with the same expected files; equality to one fixture
  makes the CLI and Backend outputs byte-identical by construction.

### D3. Adapter responsibilities

- **CLI**: argument validation, target resolution, legacy journal event
  appends (absorbed by its invocation ledger), stderr warnings,
  `emitErrorAndExit` mapping of `MutationError` codes, deprecation banners,
  conflict content on stdout. JSON keys unchanged.
- **Backend**: `ProjectConfig` lookup, `resolveRunReference` /
  `readExperimentDoc` resolution, required-lock policy, `record()` receipts with
  `file-change` details from `changes`, mapping `MutationError` →
  `BackendMutationError` with the previous messages (wire messages unchanged).
- **Standalone Web**: authorization, project selection, lock read for callers
  that omit one (now `readDocumentLock` from core), runtime refresh, response
  shapes.

### D4. Error model

`MutationError(code, message, { reason?, details?, current? })` with codes
`NOT_FOUND | CONFLICT | BAD_REQUEST | BAD_STATE | FORBIDDEN |
WARNINGS_SECTION_NOT_TABLE | INTERNAL` and machine `reason`s
(`DUPLICATE_SLUG`, `SLUG_PREFIX_COLLISION`, `RUN_ALREADY_OWNED`,
`HAS_MEMBERS`, `HAS_SCRATCH`, `ARCHIVED_RUNNING`, `RUNNING_ARCHIVE`,
`ALLOCATION_EXHAUSTED`, …). The default message is the CLI's existing text;
the Backend maps reasons to its existing messages.

### D5. Run README write keeps two content policies

`run-edit` says the server must not rewrite `updated_at` and `memon-cli` says
the CLI writes caller bytes verbatim, while the Web editor contract (and
AGENTS.md) relies on the server stamping `updated_at` and returning
`finalContent`. Changing either side would be a product decision outside this
refactor, so `writeRunReadme` takes `updatedAt: 'preserve' | 'stamp'`
(CLI → preserve, Backend → stamp). The rest (lock, idempotent canonical-equal
noop, archived-RUNNING refusal) is shared.

### D6. Route fixes

- Run ids are validated in one Web helper reused by every `app/api/runs/[id]`
  route with core `isRunDirName` / `isRunPath`; failure answers
  `400 {error:{code:'INVALID_RESOURCE'}}`. The code follows the team decision;
  `cluster-backend-api` uses `BAD_REQUEST` for the Backend surface — noted
  under Future.
- Standalone Results keeps code `INVALID_RESULTS` (a route-level code, not a
  core error) and only changes 422 → 400.

### Superseded code removed

CLI local lock/canonical/journal-free copies (`experiment.ts`, `warning.ts`,
`run-rename.ts`, `experiment-doc.ts` create/link/unlink/status/archive/delete
bodies), the Backend inline `mutate`, `readLockedDocument`, `atomicReplace`,
`restorePostimage`, `importedVariantStatus` and create/bind/delete bodies, and
the core `discovery/archive.ts` write path (`setRunArchived`, `archiveRun`,
`unarchiveRun`, `ArchiveRunningForbiddenError`, `ArchiveResult`), whose only
caller was the CLI. The Backend helpers went with the Backend adapter commit.

### Observable differences (complete list)

1. Web create-from-run Variant description now uses the CLI text.
2. Web create rejects slugs that pass the wire regex but not the strict regex
   (none exist: the wire regex already requires a non-hyphen end; only the
   3-char minimum differs and stays in the schema).
3. `memon run status set` stamps `updated_at` and maintains `finished_at`.
4. `memon run status set <archived> --to RUNNING` exits 2 `BAD_REQUEST`.
5. `memon experiment status set` with an unchanged status no longer rewrites
   the README.
6. CLI delete removes via quarantine rename; CLI rewrites keep file mode.
7. Web link no longer collapses unrelated duplicate `runs[]` entries.
8. Web/CLI temp files use the shared `atomicTempPath` naming.
9. `/api/runs/<malformed>` → 400 `INVALID_RESOURCE` (was 500).
10. Standalone invalid Results → 400 (was 422).

## Risks / Trade-offs

- [CLI agents relied on `run status set` leaving `updated_at` alone] →
  Backend already did this for every Web edit; the timestamp is advisory and
  listed in the release notes via the design.
- [Golden fixture churn when the serializer legitimately changes] → one
  fixture directory to regenerate; the failure message names it.
- [Backend `dist` rebuilt during this change exposes 10 pre-existing
  failures in `app/api/projects/[project]/git-diff/route.test.ts`, caused by
  the earlier containment-resolver commit (the test mocks a non-existent
  project root) and previously masked by a stale `dist`] → out of scope here;
  reported for follow-up.
- [`projectFs` and native fs differ in `stat` shape] → the port only reads
  `mtimeMs` and `mode`, which both provide.
- [Commits land while another agent edits Web components] → this change
  touches only `apps/web/app/api/**` and `apps/web/lib/server/**`.

## Migration Plan

No data migration and no FS convention change. Release as MINOR (CLI and
central surfaces change). Rollback is a revert of the commits; on-disk files
written by either version stay valid.

## Future

- Unify Run target resolution (CLI `RunTargetIndex` vs Backend
  `resolveRunReference`) behind a core resolver once its caching contract is
  settled.
- Reconcile the `run-edit` "server SHALL NOT rewrite updated_at" wording with
  the Web editor's server-stamp contract and drop the D5 policy switch.
- Align the Web Run-id rejection code (`INVALID_RESOURCE`) with the Backend
  `BAD_REQUEST` mapping in one error-mapping pass.
- Retire the legacy journal-event strings in CLI adapters once every CLI write
  records typed receipt details like the Backend.
