# HTML reports

Build `docs/reports/R<NNNN>-<slug>/index.html` and its assets freely. Preserve
existing working paths. The installed reader still requires a small README.md
with frontmatter, a title and an embed/link; no duplicate narrative is required.
Put the actual explanation, evidence horizon and source references in the HTML.

```markdown
![Interactive view](./index.html)
[Open separately](./index.html)
```

The image form embeds HTML. Follow the shared
[static HTML contract](../../memon-wiki/references/html-bundle.md) for runtime,
relative URLs, evidence and responsive checks. Report assets are served through
`/api/report-assets/<project>/<R-id>/<bundle-path>`; Wiki `entry` frontmatter
does not apply. HTML is trusted and same-origin, not sandbox-isolated.

Keep regeneration information only where useful; the agent invokes updates.
Verify the actual Report view and important interactions. A static report needs
no running server. See the shared maintenance contract before using live data.
