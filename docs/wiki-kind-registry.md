# Wiki kind registry

## Source and schema

Edit **`packages/core/src/wiki/kinds.json`**. This is the only canonical taxonomy;
Core ships the JSON beside compiled code, loads it relative to the module (not
the current directory), and validates it with the strict Zod schema in
`packages/core/src/wiki/kind-registry.ts`. Web imports the JSON-only package
export, never the filesystem-dependent Core barrel in client code.

Each entry defines a stable `id`, unique nonnegative integer `order`, Chinese
`label`, `zh` help, `en` help and `en.authoring`, `relatedKinds`, and `policy`.
Both languages require purpose, suitable uses, examples and distinctions.
Keep translations aligned when changing meaning. `relatedKinds` references
other declared IDs. Reserved directory IDs cannot be registered as page kinds.

Policies are data, not executable plugins:

- `statuses`: allowed values, first value is the creation default; empty means
  no page status. Existing reads ignore status on statusless kinds; explicit
  CLI status arguments are rejected, and an explicit move drops old status.
- `dateRequired`: lint requires YYYY-MM-DD; create requires `--date`.
- `sourcesRequired`: lint requires nonempty sources. As before, create can
  produce a draft with diagnostics; it does not invent evidence.
- `recommendedHeadings`: creation H2 template and missing-heading warnings,
  never hard errors. Extra/reordered headings remain valid.
- `requiredHeadings`: must currently be empty. New structural enforcement is
  a custom capability requiring an explicit code/spec change, not free text.
- `bodyEvidenceWarning` and `reviewWarningStatus`: existing evidence/review
  diagnostics only; these never write human review marks. The latter must
  reference a declared status.

Roadmap, initiative, catalog and note have no status or heading scaffold.
Initiative is evolving goal-oriented work, catalog is a classification guide,
and roadmap remains a research direction tree with many-to-many evidence.

## Safe edit and refresh

For an ordinary addition, copy an entry, choose an unused ID/order, update both
languages and related references, and set supported policies. No second kind
list needs editing. Do not add runtime project overrides or executable hooks.

From a development checkout:

```sh
pnpm wiki:kinds:generate
pnpm wiki:kinds:check
pnpm --filter @memon/core exec vitest run src/wiki/kind-registry.test.ts src/wiki/lint.test.ts
pnpm --filter @memon/skills exec vitest run src/wiki-kinds.test.ts
pnpm --filter @memon/cli... build
```

Generation rebuilds Core, validates the source registry and deterministically
regenerates `packages/skills/memon-wiki/references/page-kinds.md`. Commit that
generated file with the configuration when a commit is separately authorized.
Generic safety rules remain handwritten in `SKILL.md` and `page-rules.md`.
Skills build/prepack and Web build fail on drift; they do not regenerate silently.
The check command also rebuilds Core to use the current schema, not an old dist.

Build in a separate checkout if the working checkout is serving a running
instance: package builds replace dist files. A source edit does **not** update
already installed CLI packages, installed skills, or a deployed Web build.
Install the updated CLI/Core/Skills packages through the normal installation
workflow. To refresh managed skill copies explicitly:

```sh
memon --project-root <project-root> install-skills --agent codex --dry-run
memon --project-root <project-root> install-skills --agent codex
```

Use the installed command's `--target` option for an explicitly selected custom
skill directory. Installation replaces managed skill copies; review dry-run
output first. A separately authorized Web rollout builds Core/Backend and Web
and restarts the chosen host using the new build. This task performs no rollout.

## Read the installed definitions

```sh
memon wiki kinds ls --format human
memon wiki kinds ls --format json
memon wiki kinds show initiative --format human
memon wiki kinds show catalog --format json
```

These commands need no project, git repository, central connection or filesystem
scan. `GET /api/wiki/kinds` returns the central installation's validated registry
through the existing authenticated global-read policy. The Wiki action area
opens “Wiki 类型指南”; definitions reflect that Web release. Different installed
releases can legitimately differ until explicitly refreshed.

## Compatibility and migration

Description edits never rewrite page bodies, status, identity or review state.
Removing a kind leaves its pages readable with `WIKI_UNKNOWN_KIND`; changing a
policy can add diagnostics, which require explicit resolution. Registry updates
do not silently rename kinds or migrate directories.

```sh
memon wiki move <page-id-or-slug> initiative
memon wiki move <page-id-or-slug> catalog
memon wiki move <page-id-or-slug> <kind>/<new-slug> --status <compatible-status>
```

An explicit move preserves the ID; omitting the new slug preserves it too.
Existing move behavior repairs supported physical links/sources. Inspect its
report and lint afterward; external/manual physical links may need repair.
Do not duplicate/recreate pages or verify/unverify commits as part of a kind edit.
None of these migration, installation, commit or deployment examples are actions
automatically performed by editing configuration.
