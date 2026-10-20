# Static HTML bundles

A Wiki bundle lives at `docs/wiki/<kind>/W<NNNN>-<slug>/`. Build index.html and
assets with the agent's preferred tools; any framework's static build is valid.
The installed reader discovers it through README.md frontmatter. Allocate with
`memon --project-root . wiki create <kind> <slug> --bundle --title <title>
--description <description>`; preserve working paths in existing bundles.

Keep README.md as a small adapter, not a second report. Set frontmatter
`entry: ./index.html` to make the HTML the primary body. Subdirectories and inline
data are both valid; keep source references and useful regeneration information.

In README.md:

```markdown
![Interactive view](./index.html)
[Open separately](./index.html)
```

The image form optionally embeds HTML in Markdown; the ordinary link navigates.
Inline HTML in Markdown is static; scripts need an HTML embed or entry.

Serve built static files directly: no development server or server-side runtime.
Local URLs resolve relative to their file and must stay inside the bundle; avoid
machine paths and localhost dependencies. Assets use
`/api/wiki-assets/<project>/<W-id>/<bundle-path>`. A running monitor needs its own
service and configured connection; saved HTML alone does not provide one.

HTML runs in a trusted, same-origin, unsandboxed iframe. Keep credentials out of
browser files and show useful errors for unavailable data or CDN resources.
Use responsive content within the iframe; no custom resize handshake is needed.
Verify real asset-route loading, important interactions and layout on the intended
screens. Report unresolved rendering or data limitations.
