## Context

Existing Run readers and status writers assume README frontmatter; the derived index stores README fingerprints. See proposal.md for motivation. Existing projects must remain readable during gradual migration.

## Goals / Non-Goals

Goals: small tracked execution records; one shared parser and mutation boundary; CLI creates and updates facts; index entries retain format and actual record fingerprint.

Non-goals: execute jobs, infer process outcomes, redesign all CLI commands, migrate research projects, or fabricate measurements.

## Decisions

- Add `run.json` with snake_case persisted fields and validation of known fields while preserving extension fields. Retain shared Run/frontMatter projections to avoid changing every display consumer at once; expose `recordFormat`, `recordPath`, `recordMtime` and metadata explicitly so no surface treats JSON as editable Markdown.
- Prefer JSON when present, even malformed. Diagnostics remain visible rather than resurrecting legacy facts.
- Keep default legacy Run locations and add two bounded layout patterns. The CLI recognizes short experiment IDs and Variant directories; a READY Run stores planned parameters before execution. Each run.json stores its own active flag; creating a second execution does not silently replace existing evidence. New CLI creation allocates a dated unique Run identifier, writes metadata and publishes derived CSV files and inventory without a Run README. Existing `record` retains legacy behavior outside the new layout for gradual migration.
- Reuse project writer locks, document mtime/hash checks, atomic replacement and index mutation events. Creation uses an exclusive temporary file and hard-link publication so readers never observe a partial initial record.
- New records use independent execution status and active selection. READY means unsubmitted, QUEUED means submitted, RESUME_READY means prepared continuation but unsubmitted. PENDING is legacy-ambiguous. Preserve optional legacy archive/deprecation markers when reading old records, without creating a new required lifecycle dimension.
- Store optional params, name and assessment reasons on the Run. Preserve previous actual parameters during resume preparation; changes to measured conditions require a new Run. Export params and requested metadata fields to result.csv without overwriting metric rows.
- Import old README headings/bodies into optional legacy_sections; deprecation describes the format, not measurement validity. Do not require agents to maintain these sections.

## Risks / Trade-offs

- Shared Run fields have legacy names → expose record format separately and adapt consumers explicitly.
- Arbitrary remote writers → only operations through the existing writer admission/lock contract have serialized updates.
- Existing explicit run_dirs override new defaults → migration must update declaration explicitly; direct contained paths continue to resolve.

## Migration Plan

Ship additive readers and CLI support with the experiment-format migration. No implicit on-read conversion; README-only historical Runs remain intact. Rollback requires retaining the newer reader for any newly written JSON Runs.
