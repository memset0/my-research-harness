---
name: memon-write-code-review
description: Author or update a human-facing code-review doc for one reviewable unit, with immutable commit/line links and unchecked review progress. Use project-wide scope or an Experiment's code-review directory; when it supports an Implementation item, link the finished review through memon-write-experiment-doc.
---

# memon-write-code-review

A **code-review doc** is human-facing memory: an agent-authored guide that walks
a human reviewer through one session's worth of change. The human opens it in the
dashboard's **Code review** tab, follows the links to the exact commits and lines,
and checks off each commit and each review-checklist item as they go; when every
box is checked the review is complete.

You (the agent) **write** the doc and leave **every checkbox unchecked**
(`reviewed: false`, `done: false`) — checking them is the human's job, done in the
dashboard. Completion is *derived* from the boxes; there is no status field to set.

One code-review doc = **one reviewable unit**, normally one session / one large
functional change. It may span many commits — a mix of features, fixes, and
refactors — and all of them belong in this single doc.

## Preflight — FS convention version

Run, as the first step:

```sh
memon --project-root . --format json fs-version check
```

Branch on `status` per `../PREFLIGHT.md` (`match` → proceed; `behind` /
`uninitialised` / `ahead` → STOP with the recommendation there). Do not write the
doc unless `status == "match"`.

## Memon CLI issue handoff

For every `memon` command used by this skill or a delegated skill, follow the
CLI issue handoff in `../PREFLIGHT.md`. After safely finishing the requested
task, report any CLI crash, valid-input rejection, malformed/inconsistent
output, or required CLI workaround; if it blocks completion, report it in the
blocked handoff. Do not mislabel an expected validation or domain-state
rejection as a CLI bug.

## When to use

- You just finished a session or a large change and want to leave a human a
  guided review of the code.
- An existing code-review doc needs new commits / notes folded in.

## When NOT to use

- ❌ A one-line observation / request / error → `memon-append-journal`.
- ❌ A Run or Experiment write-up (Setup/Result, design, findings) →
  `memon-run-experiment` / `memon-drive`; a theme report → `memon-write-report`.
- ❌ An Experiment warning or limitation → `memon-write-experiment-doc`.
- ❌ A doc per commit. One doc per session / large change; it spans many commits.

## File naming and scope

A doc is **project-wide** or **experiment-scoped** by where it lives:

- project-wide: `<projectRoot>/docs/code-review/<YYYY-MM-DD>-<slug>.md`
- experiment-scoped: `<projectRoot>/docs/experiments/E<NNNN>-<slug>/code-review/<YYYY-MM-DD>-<slug>.md`

Rules:

- `<YYYY-MM-DD>` is the creation date (today, local).
- `<slug>` is short kebab-case, lowercase letters / digits / hyphens
  (`[a-z0-9][a-z0-9-]*`), e.g. `bf16-attn-stability`, `fsdp-comm-overlap`.
- Put the doc in an experiment's `code-review/` folder **iff** the change belongs
  to that one experiment; otherwise use the flat project-wide `docs/code-review/`.
- Create the `code-review/` directory if it does not exist yet.

## Frontmatter — the contract the dashboard parses

Write YAML frontmatter exactly in this shape (the dashboard reads these keys; the
body below is free markdown):

```yaml
---
title: <human-readable title>
description: <one or two sentences on what this review covers>
experiment: E0042-attn-stability   # the enclosing experiment id, or null for project-wide
created_at: 2026-05-24T15:30:00+08:00   # ISO8601 WITH timezone offset
updated_at: 2026-05-24T15:30:00+08:00   # == created_at at creation; bump on update
commits:                            # every commit this review covers
  - repo: .                         # "." = main repo; otherwise the submodule path
    sha: <full 40-char hash>
    url: https://github.com/<owner>/<repo>/commit/<full-sha>   # resolved + openable
    subject: "fix(attn): clamp logits before bf16 cast"        # the commit subject (optional but do include it)
    reviewed: false                 # ALWAYS false when you write it
  - repo: third_party/flash-attn    # a submodule — note the per-repo url + sha below
    sha: <full 40-char hash>
    url: https://github.com/<owner2>/<repo2>/commit/<full-sha>
    subject: "feat(kernel): expose configurable softmax scale"
    reviewed: false
review_todolist:                    # the human's review checklist — you draft the items
  - item: <a concrete thing the reviewer should check>
    done: false                     # ALWAYS false when you write it
  - item: <another check>
    done: false
---
```

Field rules:

- `experiment` MUST equal the enclosing `E<NNNN>-<slug>` for an experiment-scoped
  doc, and `null` for a project-wide one.
- All timestamps are **ISO8601 with a timezone offset** (e.g. `+08:00`) — never a
  bare UTC `Z`-less or offset-less string.
- `commits[]` may hold many commits across the main repo **and** submodules. Each
  commit carries the repo it belongs to (`repo`) so its link resolves against the
  right GitHub repo — see the next section.
- `review_todolist[]` is the checklist you want the human to walk: concrete,
  checkable review steps (e.g. "confirm the clamp threshold doesn't regress short
  sequences", "verify the new test fails on the pre-fix commit").

## Building the GitHub links (do this carefully — submodules!)

The `url` you store and any in-body line links MUST be **already-resolved,
directly-openable** GitHub URLs anchored to a **commit sha** (a permalink — never
a branch name). For each repo a commit lives in:

```sh
# 1. The repo's remote → owner/repo. `<repo>` is "." for the main repo, or the
#    submodule path for a submodule.
git -C <repo> remote get-url origin
#   git@github.com:acme/project.git        →  https://github.com/acme/project
#   https://github.com/acme/project.git    →  https://github.com/acme/project
#   ssh://git@github.com/acme/project.git  →  https://github.com/acme/project
#   (strip a trailing ".git"; for a non-github host keep that host in the URL.)

# 2. The repo's commit sha (full 40 chars):
git -C <repo> rev-parse <sha-or-HEAD>
```

Then assemble:

- commit URL: `https://github.com/<owner>/<repo>/commit/<sha>`
- line permalink: `https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<a>-L<b>`
  (single line: `#L<a>`)

**Submodules — the part that trips people up.** A commit or file inside a
submodule MUST use that **submodule's** remote, that submodule's `sha`, and a
`<path>` relative to the **submodule's** root — never the superproject's. List
submodules + their pinned shas with:

```sh
git submodule status        # lines: <sha> <submodule-path> (<describe>)
```

So a file `third_party/flash-attn/csrc/flash_fwd.cu` is linked as
`https://github.com/<flash-attn-owner>/flash-attn/blob/<flash-attn-sha>/csrc/flash_fwd.cu#L210-L245`
— path `csrc/flash_fwd.cu`, NOT `third_party/flash-attn/csrc/flash_fwd.cu`.

Use the `commits[]` entry's `repo` + `url` to keep every in-body link consistent
with the right repo.

## Body — sections and the per-change subsections

The body is markdown the dashboard renders as-is (GitHub-flavored + LaTeX math via
`$…$` / `$$…$$`). Use this structure:

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

### <conventional-commit title for change 2>
…

## Verification

## Notes
```

### `## Requirement`

Why this change exists. **These are angles to consider, not fixed fields** — write
what applies, in whatever order reads best, and skip what doesn't:

- the driving need — a bug you hit, or something the user asked you to build (both
  count as "the requirement");
- the **scope / boundaries** you and the user agreed on (what's in, what's
  explicitly out, constraints).

### `## Changes` — one H3 per change, titled Conventional-Commits style

Title each change like a commit: `feat(scope): …`, `fix(scope): …`,
`refactor(scope): …` (also `perf` / `docs` / `test` / `chore` as needed). The
title is a **logical classification of one piece of work** — it does NOT have to
map 1:1 to a single git commit (a change may span several commits, or be part of
one). When unsure how granular to make the split, **ask the user** (see Workflow).

Each change carries these five H4 subsections (keep the headings even when a
subsection is empty — write "None"):

- **Deliverables** — what this change produces (files / components / endpoints /
  fields), and which commit(s) it traces to.
- **Design Decisions** — *why* it's done this way. Go deep here: the underlying
  root-cause logic of the problem, the trade-offs (including rejected
  alternatives), and any relevant math written as LaTeX (`$…$` inline, `$$…$$`
  block). This is the most important subsection; do not skimp.
- **Analysis** — a **complete, end-to-end walk-through** of the change. Take the
  reader through what changed and how it works, step by step, until they could
  understand it without opening the diff themselves. This is a **substantial**
  section, NOT one or two lines — if your Analysis is that short you have not
  walked the reader through anything; expand it. **Weave together**, throughout
  the narrative: short excerpts of the **essential** real code (excerpt, never
  whole files), **line-level permalinks** to the changed code so the reader can
  jump to the full source, **pseudocode** wherever it conveys a flow better (say
  it is pseudocode in a sentence right before the fenced block), and any **math**
  (`$…$` / `$$…$$`) the change involves. The prose is the spine; the snippets,
  permalinks, pseudocode, and formulas are threaded into it — not dumped as a
  bare code block with no explanation.
- **Verification** — how to check *this* change specifically.
- **Details** — any leftover specifics for this change (gotchas, naming choices,
  TODOs left behind, edge cases). Write "None" if there are none.

Detail balance: keep **raw code** minimal (excerpt + permalink, never whole
files) — but the **explanation is thorough**. The minimal-code rule is about not
pasting source dumps; it is NOT license to write a short Analysis. Spend your
words on the Design Decisions "why" and the Analysis walk-through.

### `## Verification`

How the whole review's correctness is established: experiments you ran (link to
the run / experiment / W&B), and unit tests (which ones, how you ran them, and the
result).

### `## Notes`

The catch-all reflection bucket — again, angles, not fixed fields:

- special requests the user made mid-session;
- counter-intuitive things you observed while editing, and how you resolved them;
- lessons learned — e.g. a bug that exposes an *original design flaw*, a hardware
  limit (memory / bandwidth / cluster), an environment issue, or latent room for a
  better design;
- anything worth recording that didn't fit the sections above.

### Writing philosophy (applies to every section)

The structure above is a set of **angles to consider, not a rigid template**.
Fill in what genuinely applies, omit what doesn't, and **add extra content or
sections** whenever something is worth recording that the template doesn't name.
Don't pad sections just to fill them.

## Workflow

1. **Preflight** (above). Stop unless `match`.
2. **Decide scope and linkage**: is this change tied to one Experiment (→ that
   Experiment's `code-review/` folder) or project-wide (→
   `docs/code-review/`)? If the caller supplies an `IMP...` item, verify that it
   exists; the review doc itself does not duplicate the Implementation tree.
3. **Gather the commits** this review covers (`git log`, the session's commits).
   Resolve each one's `repo` / `sha` / `url` / `subject` per the link recipe —
   including any submodule commits, with per-repo url + sha.
4. **Decide the change-split granularity.** If it's ambiguous — e.g. the work
   could be one `refactor` or three `fix`es — ask the user before drafting. Use
   `AskUserQuestion` with 2–3 concrete splitting options when that tool is
   available; on agents without it, just ask in the conversation:

   > （这次改动我想这样拆 code-review 的 changes，你看哪种合适？)
   > A. 合成一条 `refactor`  B. 按子系统拆成 3 条 `fix`  C. 其它（你说）

5. **Draft the body** (sections + per-change subsections). Show the draft to the
   user before writing the file so they can correct course:

   > （这是 code-review 草稿，过一下有没有要改的？写文件前我先给你看。)

6. **Write the file** at the chosen path with the frontmatter (all `reviewed` /
   `done` set `false`) + the body. Set `created_at` == `updated_at` to now
   (ISO8601 + offset).
7. **Notify the user** that a code-review is ready, via the `memon-notify`
   skill (`memon notify`). The title MUST begin with `[code-review]`. Use
   severity `done`, always pass `--agent` + `--session`, and keep it one line:

   ```sh
   memon notify done "[code-review] <short title> ready to review" \
     --agent <agent> --session "$SESSION" \
     --context project=<project> \
     --config ./config.yml --soft
   ```

   This is best-effort and runs AFTER the doc is written: if `memon notify`
   exits 2 because Telegram is not configured, tell the user once (per the
   `memon-notify` skill's credentials note) and stop — the doc already exists,
   so a missing notification must not undo or fail it. Do not block waiting for
   a reply; the bot is send-only.
8. **Link an Experiment-scoped review when applicable.** Invoke
   `memon-write-experiment-doc` to add the review's Experiment-relative path to
   the existing Implementation item's `code_reviews`. Do not create an
   Implementation item merely because a review doc exists, and do not edit
   `implementation.yaml` directly from this skill.

### Updating an existing doc

Open the doc, add the new commits to `commits[]` (`reviewed: false`) and any new
`review_todolist` items (`done: false`), append the new change(s) under
`## Changes` and any new `## Notes`, and bump `updated_at`. **Never flip a
`reviewed` / `done` that the human already checked** — progress is theirs.

## Anti-patterns

- ❌ Setting any `reviewed` / `done` to `true`. You always write `false`; the
  human checks boxes in the dashboard.
- ❌ Branch-pinned links (`/blob/main/…`). Always anchor to a commit `sha`.
- ❌ Submodule links built from the superproject's owner/sha/path. Use the
  submodule's own remote, sha, and root-relative path.
- ❌ Pasting whole files into the body. Excerpt the essential lines; link the rest.
- ❌ Unlabeled pseudocode. Say it's pseudocode in the sentence before the block.
- ❌ A bare UTC timestamp. Use ISO8601 with a timezone offset.
- ❌ Treating the sections as fields to fill mechanically. They are angles; omit
  what doesn't apply and add what's missing.
- ❌ One doc per commit, or splitting one session across several docs.
- ❌ Duplicating an Implementation task in the code-review body or creating one
  automatically. Link to an existing `IMP...` item through the writer.

## Errors

| exit | meaning |
|---|---|
| 0 | code-review doc written / updated |
| 1 | failure (fs error, could not resolve a repo remote, etc.) |
