## 1. Core schema and resolver

- [x] 1.1 Extract `ProjectLayoutRawSchema` (`run_dirs`, `include`, `exclude`, `github`) in `packages/core/src/schemas.ts` and spread it into `ProjectConfigRawSchema`; verify existing config-load tests still pass.
- [x] 1.2 Extend `validateProjectDeclaration` to the four layout keys through the shared schema plus the `github.path` containment rule; verify with schema tests (valid keys, unknown key, wrong types, escaping `github.path`).
- [x] 1.3 Add `selectProjectLayout` / `resolveProjectLayout` with per-key sources and the once-per-process conflict warning; verify the four precedence cases (project only, central only, agree, conflict) and that an invalid declaration is ignored only when central covers every key.
- [x] 1.4 Make `discoverRuns` use the resolved layout (`run_dirs`, `include`, `exclude`); verify `exclude` from the declaration hides a subtree in `discoverRuns` and `scanProjectRoot`.
- [x] 1.5 Log `CENTRAL_LAYOUT_DEPRECATED` once per process per Project and key in `loadConfig`; verify with a config-load test (two loads, one warning; deployment-only entry, no warning).
- [x] 1.6 Add `readCentralProjectLayout(configPath, name, host?)`; verify extraction, unknown Project, ambiguous name and invalid entry.

## 2. Consumers

- [ ] 2.1 Resolve `github` mappings through `resolveProjectLayout` in the backend Git service and the standalone code-preview route; verify with the existing code-preview tests plus a declaration-sourced mapping test.

## 3. CLI

- [ ] 3.1 Add `--from-central`, `--project`, `--host` to `memon project init`; verify init-from-central, unknown Project (exit 2, nothing created), flags without `--from-central` (exit 2).
- [ ] 3.2 Extend `memon project lint` with the effective layout and `--from-central` deprecation/conflict diagnostics; verify the conflict scenario (exit 0) and an invalid `exclude` (exit 1).

## 4. Docs and validation

- [ ] 4.1 Update `AGENTS.md`, `README.md` and `config.example.yml` to "central = project path + deployment; layout in `.memon/project.yml`"; verify no example still shows layout keys under a central Project except as deprecated.
- [ ] 4.2 Run the selected core/CLI/backend/web tests and `openspec validate --all --strict`; verify they pass.
