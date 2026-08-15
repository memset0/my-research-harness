## Context

The v5 experiment folder already provides a natural home for sidecar data, but the README is the only canonical experiment record. `Plan` mixes engineering and empirical work, and large comparison tables in `Conclusion` do not scale. The owner wants file-first artifacts that agents can edit directly, a readable CLI/web projection, and a migration process that never overwrites semantically re-authored content before human approval.

## Goals / Non-Goals

**Goals:**
- Make the boundaries between design, engineering work, investigation work, factual results, interpretation, and final conclusion explicit.
- Keep raw files understandable to an agent using ordinary filesystem reads.
- Use one normalized model and one Markdown renderer across CLI and the first web implementation.
- Preserve legacy/unknown content visibly even when it fails v6 lint.
- Give Variant design a pre-run lifecycle and retain failed/superseded attempts without treating them as accepted evidence.
- Allow rich HTML reports only when the user explicitly asks for HTML.
- Make v5-to-v6 publication fully staged, resumable, reviewable, and all-at-once.

**Non-Goals:**
- Web editing of structured YAML.
- Item-level mutation CLI commands.
- Migrating existing single-file Reports.
- Sandboxing agent-authored HTML in v1 (the owner explicitly accepts same-origin execution); server path confinement remains mandatory.

## Decisions

### D1. README managed virtual sections are exact, stable pointers

The exact bodies are:

```markdown
## Implementation

> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.

## Investigation

> Managed in [investigation.yaml](./investigation.yaml); read and update that file directly.

## Results

> Managed in [results.yaml](./results.yaml); read and update that file directly.
```

A whole-document read returns these literal pointers. A section-scoped read materializes valid YAML as Markdown. If the body conflicts with the pointer, the read returns the real body plus a diagnostic; it never hides source content behind YAML.

### D2. Lenient read, strict lint

Parsing retains an ordered list of every H2 occurrence, including unknown and duplicate headings. Typed canonical fields are an additional view, not a replacement. Web and CLI render unsupported content with warnings. Lint exits non-zero for unsupported headings, duplicate canonical headings, managed-pointer conflicts, missing/invalid YAML, invalid IDs/references, dependency cycles, or inconsistent schema versions.

### D3. Nested YAML expresses hierarchy; IDs express links

Implementation and Investigation use nested `children` arrays because YAML order and nesting are human-readable. Stable `IMP<NNNN>` / `INV<NNNN>` IDs support `depends_on`, Variant references, commits, and reviews. Hierarchy means “part of”; dependency means “blocked by” and does not replace nesting.

Implementation status is `TODO | IN_PROGRESS | BLOCKED | DONE | DROPPED`. Investigation status is `PLANNED | IN_PROGRESS | BLOCKED | ANSWERED | INCONCLUSIVE | DROPPED`. Every node persists its explicit status; aggregate child progress/counts are derived for display and are not persisted.

### D4. Results columns and Variant lifecycle are explicit

`results.yaml` declares ordered columns with key, label, parameter/metric group, type, and enum `options` where applicable. Enum options are an allowed set; they need not all occur in current rows.

Variant status is `PLANNED | RUNNING | COMPLETED | FAILED | INCONCLUSIVE | DROPPED`. `runs` contains accepted runs used for metrics/findings. `attempts` contains failed, interrupted, superseded, or otherwise non-adopted attempts. A launched run initially enters `runs`; a later failure/rejection moves it to `attempts`. The same run may not occur in both.

Drive always writes Variant definitions before launch. It decides from the user's tone whether to pause for table confirmation or proceed autonomously. A parameter change creates/updates a Variant before execution; retries with unchanged comparison conditions stay on the same Variant.

### D5. One normalized model, multiple projections

Core parses YAML into normalized trees/results. A deterministic Markdown renderer powers CLI human/Markdown reads and remains the compatibility projection exposed by the Web API. The Web detail page consumes the same normalized model directly for status-aware Implementation/Investigation trees and an interactive Results table; it never reverse-parses generated Markdown.

Results is the primary decision surface, so it renders immediately after the Experiment header while Runs moves to the final card. Results table preferences use browser storage immediately and, for the authenticated owner, an owner-keyed SQLite record in `memon-ui-preferences.sqlite3` beside the active `config.yml`: visibility, an ordered multi-column default-sort chain, line count, ordered left/right pin groups, AND-combined row predicates, and force-show/force-hide row overrides are scoped to one Experiment, while starred display names are scoped to the Project so repeated metrics receive consistent emphasis. A present SQLite row is authoritative even when it explicitly contains no filters; an absent row instead permits an existing browser value to win and be migrated. Viewer and anonymous sessions remain browser-only. Client rendering and local writes do not await the serialized background server write. Filters and default sorts use compact badge editors: clicking a saved badge edits it and a trailing add badge creates another. Default-sort badges compare from left to right and always fall back to natural Variant-ID ascending order; with no badges, that fallback is the complete default. Header clicks instead create a non-persistent single-column temporary sort, with the configured default chain used for ties. Row overrides take precedence over ordinary predicates and are available from the row context menu without consuming a visible table cell or requiring a separate top-level selector. Independent show-all toggles bypass saved row and column filtering only for the mounted page and are deliberately excluded from persistence; show-all also makes normally absent rows available for override editing. Exact scalar `wandb.ai` URLs receive a compact semantic projection—a chart icon and final path ID—while retaining the complete target and revealing it in a tooltip, reducing content-driven column width without losing navigation. Pin order is user-defined rather than derived from YAML: pinned-left, unpinned YAML order, then pinned-right. The web client measures rendered pinned widths and applies cumulative sticky offsets only while the combined pinned width is smaller than the scroll viewport; otherwise all columns scroll together without losing their pinned grouping.

### D6. Experiment writes are centralized as a workflow, not a CRUD gate

`memon-write-experiment-doc` owns semantic writes to README and all three YAML sidecars. It instructs the agent to edit the files directly, preserve comments/order/unknown fields, and validate afterward. Other official skills invoke that workflow. Warning CLI commands and `memon-migrate-fs` are compatibility/special-purpose exceptions.

### D7. Directory Reports are opt-in and trusted

The legacy report file remains canonical for ordinary reports. Only an explicit user request for HTML selects `R<NNNN>-<slug>/README.md`. Sibling HTML can fetch sibling JSON and load local or CDN JS/CSS. `![caption](./x.html)` embeds an unsandboxed iframe; `[caption](./x.html)` stays a link. Report asset paths are confined to the report directory, but iframe code otherwise receives same-origin privileges by explicit owner decision.

### D8. Semantic migration is staged and approved by hash

The migration uses a persistent gitignored `.memon/migrations/v5-to-v6/<id>/` tree. Each experiment records source and staged hashes plus `DRAFT | APPROVED | STALE | PUBLISHED`; a source or staged-bundle change turns an approval into `STALE`. The agent iterates only in staging until the user approves. After all experiments are approved, the skill revalidates everything, obtains final confirmation, backs up, publishes all candidates, verifies, and updates `.memon/version.json` last. Any failure rolls back without leaving the global marker at v6.
