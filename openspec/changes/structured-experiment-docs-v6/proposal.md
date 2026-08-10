## Why

Experiment READMEs currently mix stable study design, coding tasks, research plans, run-comparison tables, intermediate interpretation, and final conclusions in the free-form `Method`, `Plan`, and `Conclusion` sections. As experiments accumulate retries and parameter sweeps, the Markdown becomes difficult for agents to update safely and difficult for humans to compare. Reports have a parallel limitation: a single Markdown file cannot carry interactive HTML visualizations and their structured data/assets cleanly.

The owner approved a v6 document model that keeps the readable README while moving three structured concerns into versioned YAML sidecars. `Implementation`, `Investigation`, and `Results` remain visible as managed virtual sections in the README, but their canonical content lives in `implementation.yaml`, `investigation.yaml`, and `results.yaml`. Agents edit YAML directly; Core, CLI, and the first web version share deterministic human-readable Markdown renderers. Rich HTML reports become an opt-in directory form while existing single-file Markdown reports remain unchanged.

This is a semantic, potentially lossy migration. Every existing experiment must be drafted in a persistent staging area, reviewed iteratively by the user, and explicitly approved. No live experiment is replaced and the global FS marker is not advanced until every staged experiment is approved and final validation passes.

## What Changes

- Bump `FS_CONVENTION_VERSION` from 5 to 6.
- Replace the experiment README section model with `Motivation`, `Design`, `Implementation`, `Investigation`, `Results`, `Findings`, `Limitations`, `Conclusion`, and `Warnings`.
- Require exact one-line managed pointers for `Implementation`, `Investigation`, and `Results`; store their canonical data in same-directory schema-versioned YAML files.
- Preserve every unsupported or duplicate H2 in source order. Lint fails strictly, while CLI and web reads render the original content with diagnostics instead of hiding it.
- Model Implementation and Investigation as independent nested trees with stable IDs, optional dependencies, and domain-specific fields.
- Model Results as ordered column definitions plus `Variant` rows. Variants exist before runs, carry lifecycle state, bind accepted `runs` separately from non-adopted `attempts`, and store parameters, metrics, and provenance.
- Add read/render/validate/lint CLI surfaces. Agents edit YAML directly; no item-level YAML CRUD CLI is introduced.
- Add `memon-write-experiment-doc` as the canonical Experiment-bundle writer workflow. `memon-drive` coordinates it with script/run/code-review skills.
- Remove the bundled `memon-append-warning` skill. Keep warning CLI compatibility commands permanently functional while printing a deprecation notice on every invocation.
- Support opt-in directory Reports at `docs/reports/R<NNNN>-<slug>/README.md` with sibling assets. Markdown images targeting local `.html` files render as same-origin, unsandboxed iframes; normal links remain links. Existing `R<NNNN>-<slug>.md` files remain valid and are not migrated.
- Add a staged, per-experiment, user-reviewed v5-to-v6 migration. Mechanical YAML schema upgrades ship deterministic scripts coordinated by `memon-migrate-fs`.

## Capabilities

### New Capabilities

- `structured-experiment-sections`: schema-versioned Implementation, Investigation, and Results sidecars, their renderers, lint rules, and links.

### Modified Capabilities

- `experiment-readme`: new narrative and managed virtual section contract; lossless unsupported-section reads.
- `web-dashboard`: Markdown rendering for structured sections, legacy diagnostics, and HTML report embeds.
- `reports-store`: additive directory report discovery and report-scoped assets.
- `memon-cli`: structured-section show/render/validate/lint commands and permanent warning deprecation output.
- `memon-skills`: new writer skill and routing changes across drive/run/script/propose/digest/report/code-review.
- `fs-version-tracking`: v6 marker and per-YAML schema compatibility mapping.
- `fs-migration-runtime`: persistent staged review and all-at-once publication for this semantic migration.

## Impact

- `packages/core`: schemas, lossless section parser, renderers, validation/lint, v6 migration support.
- `packages/cli`: read/check commands, new experiment creation, deprecation output.
- `apps/web`: structured-section reads and Markdown rendering, compatibility diagnostics, directory report assets and HTML iframe embeds.
- `packages/skills`: workflow rewrite and skill inventory change.
- Existing project data is untouched until the owner invokes and completes the interactive migration.
