---
name: memon-write-report
description: Create or update a time-scoped research report, progress snapshot or historical analysis in Markdown or HTML; use Wiki for continuously maintained knowledge.
---

# Report

Read `../PREFLIGHT.md` and the shared
[maintenance contract](../memon-wiki/references/maintenance.md). A Report answers
a question using evidence available at a declared time and relevant code revisions.
Use it for progress snapshots, bounded analyses and retired Wiki material.
Wiki links to useful Reports without duplicating their full contents.

Choose a simple Markdown page when sufficient, or build an HTML artifact/website
directly with the agent's preferred tools and layout. No mandatory template,
component syntax, external Skill or duplicate Markdown narrative. New Reports
use a bundle `docs/reports/[<category>/]R<NNNN>-<slug>/`; preserve existing working paths.
For HTML read [html-report-bundle.md](references/html-report-bundle.md).

For retired Wiki material, use its last-effective time as creation time and an
actual historical source revision; label a nearby revision as approximate.
Nearby corrections and extensions can update the same Report. Preserve creation
time, update the modification time, and advance the evidence cutoff only when
the evidence changes. Mark stale material explicitly with a reason; stale does
not mean incorrect. Keep meaningful corrections and source links discoverable.
Do not silently replace a historical Report's data with a live "latest" query.

Use native evidence, extract only useful fields, verify claims and inspect the
rendered result and important interactions. Agents own regeneration and service
startup; memon supplies access. Return the link, evidence horizon and useful limits.

After writing, moving or updating a Report, run `memon refresh` (preflight,
Published index) before returning the link. If the refresh is refused, fix every
listed document, including other Reports, and rerun.
