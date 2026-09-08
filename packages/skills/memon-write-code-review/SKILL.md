---
name: memon-write-code-review
description: Author or update a human-facing code-review doc for one reviewable unit, with immutable commit/line links and unchecked review progress. Use project-wide scope or an Experiment's code-review directory; when it supports an Implementation item, link the finished review through memon-write-experiment-doc.
---

# memon-write-code-review

A **code-review doc** is human-facing memory: an agent-authored guide that walks
a human reviewer through one session's worth of change. The human opens it in
the dashboard's **Code review** tab, follows the links to exact commits and
lines, and checks off each commit and checklist item; when every box is checked
the review is complete.

You write the doc and leave **every checkbox unchecked** (`reviewed: false`,
`done: false`) — checking them is the human's job. Completion is derived from
the boxes; there is no status field.

One doc = **one reviewable unit**, normally one session or one large functional
change. It may span many commits — features, fixes, refactors — and all of them
belong in that single doc.

## Preflight

Follow `../PREFLIGHT.md` — FS-version check, secrets, Journal, CLI issue
handoff. Do not write the doc unless the FS check says `match`.

## When NOT to use

- A one-line project-level observation, request, or open question → the project
  wiki through `memon-wiki`; if that surface is missing, ask the user.
- Execution facts or Experiment write-up → `memon-run-experiment` /
  `memon-drive`; a theme report → `memon-write-report`; an Experiment warning or
  limitation → `memon-write-experiment-doc`.
- A doc per commit. One doc per session or large change.

## File naming and scope

- project-wide: `<projectRoot>/docs/code-review/<YYYY-MM-DD>-<slug>.md`
- experiment-scoped: `<projectRoot>/docs/experiments/E<NNNN>-<slug>/code-review/<YYYY-MM-DD>-<slug>.md`

`<YYYY-MM-DD>` is today (local). `<slug>` is short kebab-case
(`[a-z0-9][a-z0-9-]*`), e.g. `bf16-attn-stability`. Use the Experiment's
`code-review/` folder **iff** the change belongs to that one Experiment;
otherwise the flat project-wide directory. Create the directory if missing.

## Frontmatter — the contract the dashboard parses

```yaml
---
title: <human-readable title>
description: <one or two sentences on what this review covers>
experiment: E0042-attn-stability   # enclosing experiment id, or null for project-wide
created_at: 2026-05-24T15:30:00+08:00   # ISO8601 WITH offset
updated_at: 2026-05-24T15:30:00+08:00   # == created_at at creation; bump on update
commits:
  - repo: .                         # "." = main repo; otherwise the submodule path
    sha: <full 40-char hash>
    url: https://github.com/<owner>/<repo>/commit/<full-sha>
    subject: "fix(attn): clamp logits before bf16 cast"
    reviewed: false                 # ALWAYS false when you write it
  - repo: third_party/flash-attn    # a submodule: its own url + sha
    sha: <full 40-char hash>
    url: https://github.com/<owner2>/<repo2>/commit/<full-sha>
    subject: "feat(kernel): expose configurable softmax scale"
    reviewed: false
review_todolist:
  - item: <a concrete thing the reviewer should check>
    done: false                     # ALWAYS false when you write it
---
```

`experiment` equals the enclosing `E<NNNN>-<slug>` or `null`. Timestamps are
ISO8601 with an offset, never bare UTC. `commits[]` may span the main repo and
submodules, each carrying its own `repo`. `review_todolist[]` items are
concrete, checkable steps ("verify the new test fails on the pre-fix commit").

## GitHub links — resolved permalinks, submodules included

Stored `url`s and in-body line links must be already-resolved, directly
openable GitHub URLs anchored to a commit sha — never a branch name.

```sh
git -C <repo> remote get-url origin   # → https://github.com/<owner>/<repo> (strip ".git")
git -C <repo> rev-parse <sha-or-HEAD> # full 40 chars
git submodule status                  # <sha> <submodule-path> (<describe>)
```

- commit URL: `https://github.com/<owner>/<repo>/commit/<sha>`
- line permalink: `https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<a>-L<b>`

A commit or file inside a submodule uses **that submodule's** remote, sha, and
root-relative path. So `third_party/flash-attn/csrc/flash_fwd.cu` links as
`https://github.com/<flash-attn-owner>/flash-attn/blob/<flash-attn-sha>/csrc/flash_fwd.cu#L210-L245`
— path `csrc/flash_fwd.cu`, not the superproject path. Keep a non-GitHub host in
its own URL form.

## Body

Markdown, rendered as-is (GitHub-flavored + LaTeX via `$…$` / `$$…$$`):

```markdown
# <title>

## Requirement

## Changes

### <conventional-commit title for change 1>

#### Deliverables
#### Design Decisions
#### Analysis
#### Verification
#### Details

## Verification

## Notes
```

- **Requirement** — the driving need (a bug hit, a user request) and the agreed
  scope: what is in, what is explicitly out.
- **Changes** — one H3 per logical change, titled like a commit (`feat(scope):`,
  `fix(scope):`, `refactor(scope):`, also `perf`/`docs`/`test`/`chore`). A
  change need not map 1:1 to a git commit. Each carries the five H4s (keep the
  heading and write "None" when empty):
  - *Deliverables* — what it produces (files, components, endpoints, fields) and
    which commits it traces to.
  - *Design Decisions* — why it is done this way: root-cause logic, trade-offs,
    rejected alternatives, relevant math in LaTeX. Go deep; this matters most.
  - *Analysis* — a complete walk-through of the change, substantial enough that
    a reader understands it without the diff. Weave prose with short excerpts of
    the essential real code, line-level permalinks, pseudocode where it conveys
    a flow better (say it is pseudocode in the preceding sentence), and any
    math. Never dump a bare code block with no explanation.
  - *Verification* — how to check this change specifically.
  - *Details* — gotchas, naming choices, leftover TODOs, edge cases.
- **Verification** — how the whole review's correctness is established:
  experiments run (link the Run/Experiment/W&B) and unit tests, how they were
  run, and the result.
- **Notes** — mid-session requests, counter-intuitive observations and how they
  were resolved, lessons (a bug exposing an original design flaw, a hardware or
  environment limit), anything else worth recording.

Keep raw code minimal — excerpt plus permalink, never whole files — while the
explanation stays thorough. These sections are angles, not fields: omit what
does not apply, add what is missing, and never pad.

When a section needs a registered fenced-block component, follow
`memon-author-components`.

## Workflow

1. Preflight; stop unless `match`.
2. Decide scope and linkage: one Experiment (→ its `code-review/`) or
   project-wide. If the caller supplies an `IMP...` item, verify it exists; the
   doc never duplicates the Implementation tree.
3. Gather the commits (`git log`, the session's commits) and resolve each one's
   `repo`/`sha`/`url`/`subject`, submodules with per-repo url + sha.
4. Decide the change-split granularity. When ambiguous — one `refactor` or three
   `fix`es — ask the user first, with 2–3 concrete options:

   > （这次改动我想这样拆 code-review 的 changes，你看哪种合适？)
   > A. 合成一条 `refactor`  B. 按子系统拆成 3 条 `fix`  C. 其它（你说）

5. Draft the body and show it before writing the file:

   > （这是 code-review 草稿，过一下有没有要改的？写文件前我先给你看。)

6. Write the file with all `reviewed`/`done` false and
   `created_at == updated_at` (ISO8601 + offset).
7. For an Experiment-scoped doc, close the direct maintenance with one
   submission (`../PREFLIGHT.md`):

   ```sh
   memon --project-root . --format json journal submit \
     --files docs/experiments/E0042-attn-stability/code-review/2026-05-24-bf16-attn-stability.md
   ```

   A project-wide doc under `docs/code-review/` is outside the accepted scope —
   do not submit it.
8. When it supports an Implementation item, invoke
   `memon-write-experiment-doc` to add the review's Experiment-relative path to
   that item's `code_reviews`. Never create an item just because a review exists,
   and never edit `implementation.yaml` from here.
9. Tell the user in the conversation that the review is ready, with its path.

**Updating an existing doc:** append the new commits (`reviewed: false`) and
checklist items (`done: false`), add the new change sections and notes, and bump
`updated_at`. Never flip a `reviewed`/`done` the human already checked. An
Experiment-scoped doc is submitted again; an identical resubmission reports
`noop`.

## Anti-patterns

- ❌ Setting any `reviewed`/`done` to `true`.
- ❌ Branch-pinned links (`/blob/main/…`); anchor to a commit sha.
- ❌ Submodule links built from the superproject's owner/sha/path.
- ❌ Pasting whole files; excerpt and link.
- ❌ Unlabeled pseudocode, or a one-line Analysis.
- ❌ A bare UTC timestamp.
- ❌ One doc per commit, or one session split across docs.
- ❌ Duplicating or auto-creating an Implementation item.
- ❌ `journal submit` for a project-wide doc or an untouched path.

Exit 0 when the doc is written or updated; exit 1 on failure (fs error, an
unresolvable repo remote, …).
