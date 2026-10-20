# Wiki and Report maintenance

Wiki carries the current explanation and ongoing comparisons. Report captures a
bounded analysis at a stated time; its identity can survive nearby updates.
Choose this responsibility independently of topic/category and presentation.
Both may be Markdown, static HTML or dynamic views. Do not create a Report for
every Run, or turn every report into HTML when a short page is enough.

Record `created_at` and `updated_at` with local offsets. For a Report also record
`as_of` (evidence cutoff), `source_commits` (relevant repository-to-full-SHA map)
and `freshness` (`CURRENT` or `STALE`, with `stale_reason` when needed). These are
authoring metadata, not yet dedicated dashboard filters. Use the analyzed code
revisions, not the publication commit; explain unavailable or dirty-source
provenance instead of inventing a clean SHA. Formatting edits do not advance
`as_of`. Keep the evidence horizon visible inside HTML reports as well.

Staleness means the content needs updating for current use; it does not invalidate
its historical evidence. Age alone is insufficient. Measurement validity,
interpretation confidence and service availability are separate facts. Report
interactivity may use pinned data; an ever-changing monitor normally belongs in
Wiki. A refreshed Report must accurately advance its declared evidence horizon.

On an authorized Wiki-to-Report move, retain assets, evidence qualifications and
working old references, then leave a contextual Wiki link. A correction should
identify the wrong claim; archiving must not make invalid measurements valid.
Do not treat an old page as erroneous solely because the research moved on.

## Reader compatibility during the redesign

New content is a folder. Markdown uses README.md; static HTML uses index.html
and its assets. The installed reader still requires a small README adapter for
HTML discovery (see html-bundle.md), with authoring metadata in its frontmatter.
The planned HTML/service manifest replaces this adapter once supported. A live
site will declare its port; the agent starts/stops it and memon only forwards it.
Do not invent manifest-only support, a universal proxy URL or automatic startup
in the current release. Use an existing configured route, or report the missing
connection. Regeneration scripts are optional and invoked by the agent.
