# Static HTML bundles

A Wiki bundle is `docs/wiki/<kind>/W<NNNN>-<slug>/README.md` plus its assets.
Use `memon --project-root . wiki create <kind> <slug> --bundle`; preserve working
paths in existing bundles. No manifest or frontend framework is required.

A useful layout is `data/` for evidence, `assets/` for shared media and
`views/<slug>/index.html` for each view. Inline data is also valid; retain source
IDs and avoid conflicting copies of results. Record a regeneration command only
when needed to maintain the view.

In README.md:

```markdown
![Interactive view](./views/example/index.html)
[Open separately](./views/example/index.html)
```

The image form embeds HTML; the ordinary link navigates. Wiki frontmatter
`entry: ./views/example/index.html` makes that view the primary page body.
Inline HTML in Markdown is static; scripts need an HTML embed or entry.

Serve built static files directly: no development server or server-side runtime.
Local URLs resolve relative to their file and must stay inside the bundle; avoid
machine paths and localhost dependencies. Assets use
`/api/wiki-assets/<project>/<W-id>/<bundle-path>`. A running monitor needs its own
service and configured connection; saved HTML alone does not provide one.

HTML runs in a trusted, same-origin, unsandboxed iframe. Keep credentials out of
browser files and show useful errors for unavailable data or CDN resources.
Use responsive content within the iframe; no custom resize handshake is needed.
Verify real asset-route loading, key controls, links, keyboard/touch access and
390px/desktop layout. Report unresolved rendering or data limitations.
