# Maintenance contract

Wiki is maintained current knowledge. Report is an analysis at a stated evidence
time and code revision; nearby corrections may update the same Report. Topic
(`category`) and presentation are independent of that responsibility. Do not
create a Report for every Run or turn a short answer into an elaborate website.

Each new item is a folder: `docs/wiki/<category>/W<NNNN>-<slug>/` or
`docs/reports/[<category>/]R<NNNN>-<slug>/`. Markdown uses README.md frontmatter;
HTML and services use manifest.json. A manifest takes precedence over README.
Never create a new standalone `.md` Wiki page or Report: standalone files are
legacy, stay readable and keep their paths, but every new item is a folder. IDs stay unique across categories;
the CLI maintains `.memon/id-watermarks.json` so deleted IDs are not reused.

Metadata: `title`, `description` (include for HTML; optional for other forms),
optional `category`, `created_at`, `updated_at`,
`freshness: CURRENT|STALE` and optional `stale_reason`. Record times with the
writer's local offset. Reports also record `as_of` (evidence cutoff) and
`source_commits` (repository name → full 40-character hash from
`git rev-parse <revision>`; an abbreviated hash makes `memon refresh` refuse the
document). Use analyzed revisions, not the
publication commit; explain dirty/unavailable provenance instead of inventing it.
Formatting edits do not advance the evidence cutoff. Additional fields are allowed.
When retiring Wiki into a Report, set created_at to the content's last-effective
time (from the content and history), and updated_at to the current maintenance
time. Record the relevant historical source commit; a nearby actual commit is
acceptable if explicitly labeled approximate. Never invent a hash.

Explicit freshness controls the reader's badge/filter. Age or unrelated Git changes
do not change it. STALE means the content needs updating for current use; measurement
validity, confidence and service availability are separate. A monitor normally
belongs in Wiki; a Report should not silently replace pinned evidence with "latest".

For a user-authorized Wiki retirement, move useful time-scoped content to a Report
or remove it. Repair references in Experiment, Wiki and Report documents before
`wiki delete`; it checks these three trees, excluding Experiment runtime caches
and outputs. It reports blockers and has
no force bypass. Keep invalidity and superseding-method reasons with the evidence.

After any direct Wiki or Report change, follow the preflight Published index
steps: run `memon refresh` at the project source. A refused refresh lists every document it cannot index (for example a manifest
without `title`, or two folders with one ID); fix them all and rerun. Agents may
read `.memon/index/{experiments,wiki,reports}.json` directly; the website reads
only these catalogs, so an unpublished page shows "Not refreshed", and missing
or invalid catalogs need a refresh, not a website restart.
