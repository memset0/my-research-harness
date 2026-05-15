## ADDED Requirements

### Requirement: `readGitSubmodules` core reader

`@memon/core` SHALL export
`readGitSubmodules(projectRoot: string, opts?: { timeoutMs?:
number; gitBin?: string }): Promise<GitSubmodules>` from
`packages/core/src/git/submodules.ts`.

```ts
export interface GitSubmoduleEntry {
  name: string   // value inside `[submodule "<name>"]` in .gitmodules
  path: string   // relative to projectRoot (from `submodule.<name>.path`)
}

export type GitSubmodules =
  | { enabled: false; reason: 'not-a-repo' | 'no-gitmodules' | 'git-not-found' | 'timeout' | 'error'; message?: string }
  | { enabled: true; submodules: GitSubmoduleEntry[] }
```

Implementation:

- Invokes `git config --file .gitmodules --get-regexp
  '^submodule\\..+\\.path$'` with `cwd = projectRoot`. The
  command's stdout has one line per submodule, of the form
  `submodule.<name>.path <relative-path>`. The reader parses out
  the name (everything between the first `submodule.` and the
  last `.path`) and the path.
- When `.gitmodules` does not exist (git config returns exit 1
  with stderr empty): `{ enabled: true, submodules: [] }`.
- Recursive / nested submodules are NOT enumerated. Only the
  top level.

#### Scenario: Repo with two submodules
- **GIVEN** a project root with a `.gitmodules` declaring
  submodules `vendor/foo` (path `vendor/foo`) and `themes/dark`
  (path `themes/dark`)
- **WHEN** `readGitSubmodules(projectRoot)` runs
- **THEN** the resolved value is
  `{ enabled: true, submodules: [{ name: 'vendor/foo', path:
  'vendor/foo' }, { name: 'themes/dark', path: 'themes/dark' }] }`
  (order matches `.gitmodules` declaration order)

#### Scenario: Project with no `.gitmodules`
- **GIVEN** a git repo with no `.gitmodules` file
- **WHEN** `readGitSubmodules(projectRoot)` runs
- **THEN** the resolved value is
  `{ enabled: true, submodules: [] }`

#### Scenario: Submodule name differs from path
- **GIVEN** a `.gitmodules` declaring
  `[submodule "external-lib"]\npath = vendor/lib`
- **WHEN** `readGitSubmodules(projectRoot)` runs
- **THEN** the entry is
  `{ name: 'external-lib', path: 'vendor/lib' }` — name and path
  may differ

#### Scenario: Non-repo cwd
- **GIVEN** `projectRoot` is not a git working tree
- **WHEN** `readGitSubmodules(projectRoot)` runs
- **THEN** the resolved value is
  `{ enabled: false, reason: 'not-a-repo' }`

### Requirement: `GET /api/projects/:project/submodules` endpoint

The web server SHALL expose `GET /api/projects/:project/submodules`
returning JSON.

Behaviour:

- Project resolution + viewer-scope rules identical to existing
  git endpoints. Unknown project → 404; viewer-out-of-scope → 403.
- Calls `readGitSubmodules(project.root)` and returns the
  discriminated-union value.

#### Scenario: Owner GET on a project with submodules
- **GIVEN** project-a has two submodules in `.gitmodules`
- **WHEN** an owner requests
  `GET /api/projects/project-a/submodules`
- **THEN** the response is `200 { enabled: true, submodules: [...
  with 2 entries] }`

### Requirement: `?submodule=<name>` scoping convention

The existing git endpoints SHALL accept an optional `submodule`
query parameter that scopes the reader's cwd. The affected
endpoints are `/git-status/files`, `/git-diff`, `/git-branches`,
`/git-log`, and `/git-commit`. For each:

- Absent → cwd = `project.root` (main repo, existing behaviour).
- Present with a name from the project's `.gitmodules` → cwd =
  `<project.root>/<submodule.path>`, where `submodule.path` is
  resolved via `readGitSubmodules`.
- Present with an unknown name → 400.

`submodule` MUST be validated against the actual `.gitmodules`
contents (no regex pre-validation; the name space is defined by
the project's own config). The route handler resolves the name to
its path through `readGitSubmodules` and never accepts a user-
supplied path.

#### Scenario: status/files scoped to a submodule
- **GIVEN** project-a has a submodule named `vendor/foo` at path
  `vendor/foo`
- **WHEN** an owner requests
  `GET /api/projects/project-a/git-status/files?submodule=vendor%2Ffoo`
- **THEN** the route resolves cwd to
  `<project-a-root>/vendor/foo` and invokes
  `readGitStatusFiles(cwd)`; the returned payload reflects the
  submodule's working-tree state

#### Scenario: Unknown submodule name → 400
- **WHEN** any of the affected endpoints receives
  `?submodule=does-not-exist`
- **THEN** the response is `400` and the underlying core reader is
  NOT invoked

#### Scenario: No submodule param → main repo (back-compat)
- **WHEN** an owner requests
  `GET /api/projects/project-a/git-log?ref=main` (no submodule
  param)
- **THEN** the route resolves cwd to `project.root` and invokes
  `readGitLog(cwd, ...)` exactly as before this change

### Requirement: Submodule directory may be missing on disk

The routes SHALL return a `200` JSON response whose body
reflects the underlying reader's `enabled: false` shape when a
submodule's resolved cwd does NOT exist on disk (the user
hasn't run `git submodule update --init`). The dashboard renders the
submodule's section with a placeholder indicating the submodule
is not initialised.

#### Scenario: Submodule not yet initialised
- **GIVEN** project-a's `.gitmodules` declares `vendor/foo` but
  `<project-a-root>/vendor/foo` is empty (or missing)
- **WHEN** an owner requests
  `GET /api/projects/project-a/git-status/files?submodule=vendor%2Ffoo`
- **THEN** the response is `200 { enabled: false, reason: 'not-
  a-repo' }` (the underlying reader's shape, surfaced verbatim)
