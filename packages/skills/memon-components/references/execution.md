# Python-generated component payloads

Use a YAML payload with exactly one of `script: <path>::<function>` or `code:`.
An inline `code` body has one top-level function. Other payload keys become
keyword arguments; the function returns a JSON-serializable object.

The runner passes `__id`, `__md_file_path`, `__project_root` and `__assets_dir`;
accept `**kw` when unused. Working directory is the project root; document and
assets paths are project-relative. Script references resolve relative to the
document and must stay within a configured project root.

Executable blocks require a unique `#id`. Run them explicitly:

```sh
memon --project-root . components run <document> --id <id>
```

The result is stored beside the document as `<stem>__assets/<id>.json` (including
`README__assets` for bundle READMEs). Commit that cache with the document; never
hand-edit its data or bookkeeping fields. Rendering does not execute Python.
A failed run retains previous data with an error; report that state rather than
presenting cached output as newly computed. Choose inline code or a reusable
script according to the analysis; neither needs a separate workflow.
