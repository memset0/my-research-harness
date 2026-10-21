# Maintenance contract

Wiki is maintained current knowledge. Report is an analysis at a stated evidence
time and code revision; nearby corrections may update the same Report. Topic
(`category`) and presentation are independent of that responsibility. Do not
create a Report for every Run or turn a short answer into an elaborate website.

Each new item is a folder: `docs/wiki/<category>/W<NNNN>-<slug>/` or
`docs/reports/[<category>/]R<NNNN>-<slug>/`. Markdown uses README.md frontmatter;
HTML and services use manifest.json. A manifest takes precedence over README.
Existing standalone documents remain readable. IDs stay unique across categories;
the CLI maintains `.memon/id-watermarks.json` so deleted IDs are not reused.

Metadata: `title`, `description` (include for HTML; optional for other forms),
optional `category`, `created_at`, `updated_at`,
`freshness: CURRENT|STALE` and optional `stale_reason`. Record times with the
writer's local offset. Reports also record `as_of` (evidence cutoff) and
`source_commits` (repository name → full SHA). Use analyzed revisions, not the
publication commit; explain dirty/unavailable provenance instead of inventing it.
Formatting edits do not advance the evidence cutoff. Additional fields are allowed.

Explicit freshness controls the reader's badge/filter. Age or unrelated Git changes
do not change it. STALE means the content needs updating for current use; measurement
validity, confidence and service availability are separate. A monitor normally
belongs in Wiki; a Report should not silently replace pinned evidence with "latest".

For a user-authorized Wiki retirement, move useful time-scoped content to a Report
or remove it. Repair references before `wiki delete`; it reports blockers and has
no force bypass. Keep invalidity and superseding-method reasons with the evidence.
