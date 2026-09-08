## Context

See proposal.md for motivation. Existing Run frontmatter requires entry/command and existing skills prescribe four prose sections, repeated expansion and per-event writer calls. Run parsing must continue accepting historical rich documents. Shared working-tree changes for file access/performance and another agent's Wiki work are independent.

## Goals / Non-Goals

Goals: lightweight new records, reversible execution exclusion, strictly layered research reading, one structural lint interface, measurable reduction in both skill tokens and mandatory work.

Non-goals: deleting historical documents/artifacts, terminating a job when it is deprecated, changing Wiki maintenance rules, introducing a second evidence registry, automatically interpreting results, deployment or migration of real projects.

## Decisions

- Keep execution status, Variant membership and deprecated separate. Missing deprecated means false; archived is not converted into deprecation. Preserve the existing Variant association and list placement on deprecation. Explicit inspection for execution reuse remains possible. CLI mutations follow existing locks and invocation recording.
- Retain rich parsing while future creation emits only necessary execution identity, association, status/time and available execution-specific references. Omit unknown optional values and redundant prose. Updating a historical record preserves its unrelated body and fields.
- Apply evidence exclusion centrally for normal read/aggregation paths, not as repeated prose-only instructions. Do not replace stored measurements with guessed numbers: derive an explicit unavailable/stale result when active evidence is invalidated, while preserving source bytes for deliberate reconciliation.
- Remove doctor and separate validate calls from the ordinary contract; lint composes syntax/schema/structure checks. Stale processes, conclusions and archive recommendations are not lint failures. Legacy content is readable even if new-writing lint is stricter.
- Propose consumes only Experiment documents and their Variant-level results. It does not read Run files/logs, including indirectly through a hydrated summary. Insufficient experimental documentation is an explicit gap for a lower-layer recovery task.
- Skills are reusable instructions, not mandatory subprocess or subagent launches. Execute meaningful batch updates with one owner. Preserve concurrency, provenance, privacy, resume safety and human authority; remove repeated templates, full scans and routine Run narratives.
- A redo preserves the Variant and deprecated execution history, checks the old setup for the known problem, and creates fresh Runs for unchanged conditions. Scripts/configuration/recovery logs may be reused without reusing rejected measurements. Changed comparison conditions must be declared before launch.
- Distinguish historical Run membership from the evidence supporting current metrics. Newly verified replacement results should recover validity without removing old associations or undeprecating rejected executions; old measurements and their dependencies remain traceable.
- Count exact saved UTF-8 document text using tiktoken 0.14.0 o200k_base before and after, including YAML frontmatter and code fences. Count shared/reference files too, so moving text cannot masquerade as reduction. This is a reproducible tokenizer measurement, not a claim about every model's billing.

## Risks / Trade-offs

- Deprecation can invalidate manually aggregated results without recoverable per-metric lineage. Report unavailability rather than claiming a recomputation occurred.
- Documentation-only clarification: current `projectResultsRunEligibility` checks every id in `Variant.runs`, not a separately identified current-metric evidence set. Retaining deprecated history can therefore keep replacement results `partial`. The intended recovery semantics require a subsequent implementation change; this update adds no YAML fields, automatic writeback, or runtime recovery. Report the limitation instead of bypassing it by deleting history.
- Minimal writes must not truncate rich legacy Run content. Exercise old/new documents and lifecycle roundtrips.
- Removing commands requires source callers and installed skill examples to move together. Do not publish skills ahead of a compatible CLI.
- Global discovery filtering must not break explicit lookup or restoration. Verify default exclusion and explicit inclusion independently.
- Token reduction alone is insufficient: compare a retained-safeguard checklist and run focused contract checks plus actual CLI scenarios. No full or remote unit suite.
