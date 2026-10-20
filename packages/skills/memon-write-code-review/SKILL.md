---
name: memon-write-code-review
description: Write a human-facing code-review document with commit permalinks and human-owned review progress.
---

# Code review document

Read `../PREFLIGHT.md`. Explain a reviewable change: the problem, decisions,
important code and verification. Use concise excerpts with immutable line links;
choose the structure and grouping that help the reviewer. No fixed sections or
intermediate draft approval are required.

Use `docs/code-review/<YYYY-MM-DD>-<slug>.md`, or
`docs/experiments/E<NNNN>-<slug>/code-review/<YYYY-MM-DD>-<slug>.md` for one
Experiment. Required frontmatter:

```yaml
---
title: Change under review
description: What the reviewer should assess
experiment: null # or the enclosing Experiment ID
created_at: 2026-10-20T12:00:00+08:00
updated_at: 2026-10-20T12:00:00+08:00
commits:
  - repo: .
    sha: <full 40-character commit SHA>
    url: https://github.com/<owner>/<repo>/commit/<sha>
    reviewed: false
review_todolist:
  - item: A useful check for the reviewer
    done: false
---
```

Resolve each commit URL and line permalink from the owning repository's remote,
SHA and root-relative path, including submodules. Use `/blob/<sha>/<path>#L<n>`
for GitHub lines; preserve other hosts' URL conventions.

New `reviewed`/`done` flags are false. Preserve existing human selections; agent
verification does not mark human review complete. Bump `updated_at` on edits.
Link an existing implementation item only when relevant; do not create phase
tracking to accommodate a review. Return the document path and actual validation.
