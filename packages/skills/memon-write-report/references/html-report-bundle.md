# HTML reports

Use `docs/reports/R<NNNN>-<slug>/README.md` with the report's frontmatter,
summary and local assets. Preserve existing working paths. `data/`, `assets/`
and `views/<slug>/index.html` are useful conventions, not a required manifest.

```markdown
![Interactive view](./views/example/index.html)
[Open separately](./views/example/index.html)
```

The image form embeds HTML. Follow the shared
[static HTML contract](../../memon-wiki/references/html-bundle.md) for runtime,
relative URLs, evidence and responsive checks. Report assets are served through
`/api/report-assets/<project>/<R-id>/<bundle-path>`; Wiki `entry` frontmatter
does not apply. HTML is trusted and same-origin, not sandbox-isolated.

Keep regeneration information only where useful. Verify the actual Report view
and its Retry, open-in-new-tab and fullscreen controls. A saved report needs no
running development server; preserve the requested interactions when simplifying.
