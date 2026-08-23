## Why

Agents currently have two options to read experiment results:

1. **`memon experiment doc show <id> results`** — returns the raw parsed YAML (columns + variants with nested parameters/metrics). The caller must flatten, pivot, and format the data itself.
2. **Direct YAML file read** — requires understanding the schema, parsing YAML, and handling edge cases (missing files, parse errors, schema version mismatches).

Neither path provides a clean tabular projection with row/column selection. Agents working on analysis tasks (comparing variants, extracting specific metrics, feeding downstream tools) need a command that:

- Reads results.yaml and handles all error cases internally
- Lets the caller select specific rows (by variant ID or status) and columns (by key or group)
- Returns a flat, structured table with multiple machine-readable formats

Without this, agents reimplement the same pivot logic in every session, producing inconsistent output and brittle parsing.

## What Changes

- Add `memon experiment results <id-or-slug>` — a new read-only subcommand that loads results.yaml, applies row/column filters, and emits a flat table.
- Support five output formats: `json` (default, structured), `human` (aligned terminal table), `csv` (machine-readable), `markdown` (GFM table), `yaml` (structured YAML).
- Support row filtering by variant ID (`--variant`) and variant status (`--status`).
- Support column filtering by key (`--column`) and by group (`--group parameter|metric|all`).
- Add a dedicated `memon-read-results` skill that teaches agents when and how to use this command.

## Capabilities

### New Capabilities

- `cli-experiment-results`: read experiment results as a selectable, multi-format table via `memon experiment results <id-or-slug>`.

### Modified Capabilities

- `memon-skills`: new `memon-read-results` skill for structured results analysis.

## Impact

- `packages/cli/src/commands/experiment-results.ts` (new) — command implementation.
- `packages/cli/src/commands/experiment-results.test.ts` (new) — vitest tests.
- `packages/cli/src/lib/output.ts` — add `emitCsv`, `emitMarkdownTable`, `emitYaml`, `renderHumanTable`.
- `packages/cli/src/index.ts` — register `experiment results` subcommand.
- `.claude/skills/memon-read-results/SKILL.md` (new) — agent-facing skill documentation.
- No core library changes — reuses existing `readExperimentDoc`, `resolveExperimentId`, and `ResultsDocument` types from `@memon/core`.
- No FS format changes — read-only operation on existing results.yaml.
