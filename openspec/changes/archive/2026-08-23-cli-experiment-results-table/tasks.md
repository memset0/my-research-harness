## 1. Output format helpers

- [x] 1.1 Add `renderHumanTable`, `emitCsv`, `emitMarkdownTable`, and `emitYaml` to `packages/cli/src/lib/output.ts`. Each accepts the shared `TableOutput` shape and writes to stdout.
- [x] 1.2 Add unit tests for each formatter covering edge cases: empty rows, null values, special characters in labels, and boolean values.

## 2. Results table command

- [x] 2.1 Create `packages/cli/src/commands/experiment-results.ts` with `runExperimentResults()` and the `TableOutput` / `TableRow` types.
- [x] 2.2 Implement row filtering: `--variant` (comma-separated IDs) and `--status` (comma-separated statuses). Empty filter = no filtering.
- [x] 2.3 Implement column filtering: `--column` (comma-separated keys) and `--group parameter|metric|all`.
- [x] 2.4 Implement format dispatch: `json` → `emitJson`, `human` → `renderHumanTable` + `emitHuman`, `csv` → `emitCsv`, `markdown` → `emitMarkdownTable`, `yaml` → `emitYaml`.
- [x] 2.5 Handle error paths: experiment not found, results.yaml missing, YAML parse errors. Use `emitErrorAndExit` with appropriate codes (`NOT_FOUND`, `INVALID_RESULTS`).

## 3. Command registration and wiring

- [x] 3.1 Import `runExperimentResults` in `packages/cli/src/index.ts`.
- [x] 3.2 Register `experiment.command('results <id-or-slug>')` with options `--variant`, `--status`, `--column`, `--group`, `--output`.
- [x] 3.3 Wire the action handler to pass all options through to `runExperimentResults`.

## 4. Tests

- [x] 4.1 Create `packages/cli/src/commands/experiment-results.test.ts` following the existing vitest pattern (mkdtemp, stdout capture, process.exitCode reset).
- [x] 4.2 Test basic JSON output with a seeded results.yaml containing multiple variants, parameter columns, and metric columns.
- [x] 4.3 Test `--variant` filtering (single and multiple IDs).
- [x] 4.4 Test `--status` filtering (single and multiple statuses).
- [x] 4.5 Test `--column` filtering (specific keys).
- [x] 4.6 Test `--group parameter` and `--group metric` filtering.
- [x] 4.7 Test `--output csv`, `--output markdown`, and `--output yaml`.
- [x] 4.8 Test `--output human` aligned table rendering.
- [x] 4.9 Test missing results.yaml → NOT_FOUND error.
- [x] 4.10 Test nonexistent experiment ID → NOT_FOUND error.
- [x] 4.11 Test combined filters (e.g., `--status COMPLETED --group metric`).

## 5. Skill

- [x] 5.1 Create `.claude/skills/memon-read-results/SKILL.md` with frontmatter (`name`, `description`).
- [x] 5.2 Document preflight (`memon fs-version check`).
- [x] 5.3 Document the command syntax, all options, and output formats.
- [x] 5.4 Provide concrete examples for each use case: quick overview, metric comparison, parameter subset, piping to jq/csvkit.
- [x] 5.5 Clarify when to use this command vs. editing results.yaml directly.

## 6. Verification

- [x] 6.1 Run `pnpm --filter @memon/web typecheck` (no web changes, but verify CLI package still type-checks).
- [x] 6.2 Run CLI tests: `pnpm --filter @memon/cli test` (or equivalent vitest invocation).
- [x] 6.3 Run the new tests specifically and confirm all pass.
- [x] 6.4 Verify `memon experiment results --help` shows the new command and options.
- [x] 6.5 Validate the OpenSpec change with `openspec validate cli-experiment-results-table --type change`.
