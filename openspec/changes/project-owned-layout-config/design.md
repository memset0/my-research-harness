## Context

`fs-v8-derived-index` (design §11) introduced the tracked, optional `.memon/project.yml` with `schema_version: 1` and `run_dirs`, and the chain CLI `--run-dir` > central `run_dirs` > declaration > v8 default. All other per-project keys still exist only in central `config.yml` (`packages/core/src/schemas.ts` `ProjectConfigRawSchema`, resolved by `packages/core/src/config/load.ts`). Non-`serve` CLI commands never read `config.yml`, so a CLI node sees no `exclude`/`include`/`github` at all. The user decided to decentralise: central keeps deployment facts, the project keeps its layout.

## Goals / Non-Goals

**Goals:** one tracked place for project layout read by every surface; zero behaviour change for existing central configurations during the deprecation window; a mechanical path (`memon project init --from-central`) to move the keys.

**Non-Goals:** removing the central keys (a later change once deployments migrated); changing the FS convention or the `run_dirs` chain order; touching real project or central configuration files; moving any deployment key.

## Decisions

### 1. Field classification

Every key of a central `projects[]` entry:

| Key | Class | Reason |
|---|---|---|
| `name` | deployment (stays central) | identity in URLs and shares; a deployment may name the same repository differently |
| `root` | deployment | absolute or config-relative path on this machine |
| `host` | deployment | Host namespace of the serving instance |
| `storage` | deployment | how this machine reaches the files (`local` / `sshfs`) |
| `storage_group` / `storageGroup` | deployment | I/O scheduling bucket of a mount |
| `persistent_cache` | deployment | dump opt-in of this instance |
| `read_only` / `readOnly` | deployment | write refusal decided by the operator of this instance |
| `execution` (`kind`, `python`, `component_timeout_ms`, `target`, `remote_root`, `port`, `identity_file`, `known_hosts_file`) | deployment | where and with which interpreter commands run; machine paths and SSH targets |
| `run_dirs` | **layout** (moves to project) | where Run directories live in the repository |
| `include` | **layout** | which discovered Run paths count, relative to the repository |
| `exclude` | **layout** | which repository subtrees discovery skips |
| `github` | **layout** | which repository subdirectory checks out which GitHub repo (`path` relative to the project root) |

Share tokens and labels are not Project keys (they live in the share store) and are unaffected. Instance-level keys (`central`, `backend`, `auth`, `fileAccess`, `file_cache`, `media`, `poll`, `slurm`, `git_status`) are deployment by definition.

### 2. Declaration schema (still `schema_version: 1`)

```yaml
schema_version: 1          # required, integer, only 1
run_dirs: [logs/*, outputs/*/*]   # optional, non-empty, Run pattern rules
include: ['logs/**']       # optional, glob list (same as central include)
exclude: [wandb, scratch]  # optional, names or globs (same as central exclude)
github:                    # optional
  - { owner: acme, repo: project-a, path: . }
```

- The four layout keys are one zod object (`ProjectLayoutRawSchema` in `schemas.ts`) spread into `ProjectConfigRawSchema` and used by `validateProjectDeclaration`, so central and project validation cannot drift.
- Declaration-only extra rule: `github[].path` must be relative and must not escape the project root (`..`, absolute, NUL). Central paths come from the operator; declaration paths come from a repository and must not point outside it.
- Strictness unchanged: any other key, a missing/unsupported `schema_version` or a non-mapping is `PROJECT_DECLARATION_INVALID` naming the key. Adding optional keys inside version 1 is the forward extension §11 of `fs-v8-derived-index` allowed ("adding keys in a later change").

### 3. Precedence (per key, first present source wins as a whole, never merged)

| # | Source | Keys | Seen by |
|---|---|---|---|
| 1 | CLI `--run-dir` | `run_dirs` | CLI |
| 2 | central Project entry (deprecated) | all four | central / standalone `serve` |
| 3 | `.memon/project.yml` | all four | all |
| 4 | default | `run_dirs` → `logs/*`, `outputs/*`, `experiments/*`; `include` → everything; `exclude` → none (built-in excludes `.git`, `node_modules`, … always apply); `github` → none | all |

"Present" means a non-empty list (an empty central `exclude: []`, the old example default, is absent). Keys resolve independently: a central `exclude` does not hide the declaration's `run_dirs`.

Central stays above the declaration during the deprecation window so that no running deployment changes behaviour when a project adds a declaration; the operator removes the central key to hand control to the project.

Warnings, both code `CENTRAL_LAYOUT_DEPRECATED`:

- **deprecated** — `loadConfig` logs once per process per (Project identity, key) to stderr naming the key and the migration command.
- **conflict** — the layout resolver, when a central key is present and the declaration also declares that key with a different value, logs once per process per (root, key) that the central value is used.
- `memon project lint --from-central <config> --project <name>` reports both as warning diagnostics (exit 0).

### 4. Resolver and reading points

`packages/core/src/project-declaration/layout.ts`:

- `selectProjectLayout({ project, declaration, cliRunDirs? })` (pure) → `{ runDirs, include, exclude, github, sources }` with `sources[key] ∈ cli | central | project | default`; `github` paths are resolved absolute against the root.
- `resolveProjectLayout(project, { cliRunDirs? })` loads the declaration through `projectFs` (central observes it via the Store). An invalid declaration throws only when some key falls through to it; when the central entry covers every key it is ignored (no conflict check), preserving today's behaviour for fully central-configured Projects.
- `discoverRuns` uses it (explicit `project.runDirs` still counts as source 1/2). `scanProjectRoot`, `resolveRunTarget`, rebuild and verification pass through `discoverRuns`, so `exclude`/`include` from the declaration apply everywhere without touching their callers.
- `resolveEffectiveRunDirs` keeps its signature and chain (the derived index records it).
- The code-preview Git adapter (`packages/backend/src/git-service.ts`) and its standalone route (`apps/web/app/api/code-preview/route.ts`) resolve `github` with `resolveProjectLayout`; declaration mappings are always containment-checked.

### 5. Migration helper

`readCentralProjectLayout(configPath, name, host?)` parses the central YAML without the instance-role checks of `loadConfig` (it only needs one entry), validates that entry with `ProjectConfigRawSchema`, and returns its raw layout keys (relative `github` paths kept as written). Ambiguous names across hosts require `--host`. `memon project init --from-central <config> --project <name> [--host <id>]` writes those keys (only the present ones; `run_dirs` falls back to `--run-dir` then the default) with exclusive create, never commits. It does not compare the central `root` with `--project-root` beyond reporting it.

## Risks / Trade-offs

- [Declaration read on every walk even when central sets `run_dirs`] → it is one observed file per walk (Store-cached on central, one `readFile` locally), the same cost discovery already pays when `run_dirs` is not central.
- [A project could set `github.path` outside its root] → rejected at declaration validation and re-checked at use.
- [Two sources during the window confuse operators] → conflict warnings plus `memon project lint --from-central` show exactly which value wins.

## Migration Plan

Release (not this change): for each central Project, run `memon project init --project-root <root> --from-central <config> --project <name>`, review, commit in the project, then delete the moved keys from central `config.yml` and restart. Rollback: put the keys back in central (central wins).

## Open Questions

None.
