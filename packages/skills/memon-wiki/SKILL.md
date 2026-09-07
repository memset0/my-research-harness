---
name: memon-wiki
description: "Maintain a project's memon wiki under docs/wiki/: meeting notes, findings, bottlenecks, showcases, questions, decisions, notes, and harness feedback. Use when the user wants durable project knowledge recorded, corrected, promoted from Experiment Results, or migrated out of a Report — whether the project root is the current directory or an sshfs-mounted remote project."
---

# memon-wiki

Maintain the project wiki: the durable, human-readable layer above Experiments
and Runs. Experiments hold structured evidence; the wiki holds the meaning a
person needs six months later — what was decided, what is known, what is
blocked, what is still open.

A wiki page is never the source of a number. Every factual statement traces
back to an Experiment, a Variant row, or a Run README, and every wiki change
lands in its own commit so a human can verify it line by line.

## When to use

- The user wants a conclusion, decision, meeting, open question, or bottleneck
  written down where the whole project can find it.
- An Experiment produced a result worth promoting into shared knowledge.
- An existing page is wrong, outdated, or contradicts newer Results.
- The user asks to move a Report into the wiki.
- The user asks what the project already knows about a topic.

## When NOT to use

- Writing or correcting Experiment content — that is
  `memon-write-experiment-doc`; this skill never edits a bundle.
- Writing a Run README or launching work — `memon-run-experiment`.
- A theme-driven narrative Report — `memon-write-report` stays the Report
  writer, and existing Reports are migrated only on explicit request.
- Digests and the journal cursor — `memon-digest-journal`.
- Verifying a page. Verification is the human's job (see below).

## Step 1 — Detect the operating mode

Do this before anything else. The project may be local, or it may be an
sshfs mount of a cluster filesystem, in which case the `memon` binary lives on
the remote host and only the *files* are reachable locally.

Resolve the project path `P`: an explicit path the user gave, otherwise `cwd`.
Then run exactly:

```sh
abs=$(realpath "$PROJECT"); read -r src fs mp <<<"$(findmnt -T "$abs" -o SOURCE,FSTYPE,TARGET -n)"; if [ "$fs" = "fuse.sshfs" ]; then REMOTE="${src%%:*}"; ROOT="${src#*:}${abs#$mp}"; echo "mounted: ssh $REMOTE 'cd $ROOT && memon ...'"; else echo "in-project: memon --project-root $abs ..."; fi
```

`${abs#$mp}` strips the mountpoint prefix, so a project nested below the mount
target still derives the correct remote root.

From here on, every `memon` invocation in this skill uses the channel the
snippet selected:

- **mounted** — `ssh "$REMOTE" "cd '$ROOT' && memon --project-root . <args>"`.
  Page files are read and written through the **local** mount path `$abs`;
  only the CLI runs remotely.
- **in-project** — `memon --project-root "$abs" <args>` locally.

State the detected mode to the user before continuing, and in mounted mode
name the derived `user@host` and remote root:

> 检测到挂载模式:远端 `<user>@<host>`,远端项目根 `/…/project-a`。memon 命令走 ssh 执行,
> 页面文件直接在本地挂载路径读写。

> 检测到本地模式:项目根 `/…/project-a`,memon 直接本地执行。

Never guess a host. Never read `LOCAL.md`, a README, a shell history, or any
other prose file to find one — `findmnt` is the only host source. If `findmnt`
reports `fuse.sshfs` but the source has no `user@host:` form, stop and ask the
user for the ssh target rather than inventing one.

## Step 2 — Preflight

Through the channel chosen in step 1:

```sh
memon --project-root . --format json fs-version check
```

Continue only on `status == "match"`; for every other status follow
`../PREFLIGHT.md` and write nothing (this includes `docs/wiki/`).

## Memon CLI issue handoff

For every `memon` command used by this skill, follow the CLI issue handoff in
`../PREFLIGHT.md`. After safely finishing the requested task, report any CLI
crash, valid-input rejection, malformed/inconsistent output, or required
workaround; if it blocks completion, report it in the blocked handoff. Do not
mislabel an expected validation or domain-state rejection as a CLI bug.

## Where pages live

```text
docs/wiki/
├── meeting/W0004-2026-05-04-weekly.md
├── finding/W0001-zero-snr-brightness.md
├── bottleneck/W0002-edm2-nan-crash.md
├── decision/W0003-adopt-bf16-flow-matching.md
├── question/W0005-snr-weighting-hf-artifacts.md
├── note/…
├── showcase/W0006-precond-explorer/        # bundle form
│   ├── README.md
│   ├── data/*.json
│   └── views/<slug>/index.html
└── harness-feedback/W0008-live-data-toggle.md
```

The slug is the primary human address; the `W<NNNN>` prefix keeps ids visible.
Both `memon wiki show <slug>` and `memon wiki show W0008` work. Discovery is
exactly two levels deep — never place a page directly under `docs/wiki/`.

## Choose the kind

Read [references/page-kinds.md](references/page-kinds.md) for every kind's
purpose, status vocabulary, required frontmatter, recommended H2 sections, and
authoring guidance. Pick the kind with the user, or infer it when the request
is unambiguous (a pasted meeting transcript is a `meeting`; "record that X is
now our approach" is a `decision`). When two kinds both fit, ask:

> 这条内容我打算记成 `finding`(有 Results 支撑的结论),也可以记成 `note`(暂时的观察)。
> 你倾向哪一个?

## Evidence discipline

Experiment Results, Variant rows, and Run READMEs are the only sources of
factual truth. Read them at authoring time — never from memory, never from
another wiki page:

```sh
memon --project-root . --format human experiment doc render <E-id> results
memon --project-root . experiment results summary <E-id> --output json
```

Rules:

- Every factual statement in the body names the Experiment, Variant, or run
  directory it comes from. Prefer the `E<NNNN>/V<NNNN>` Variant form — it
  points at the exact Results row.
- `sources` lists exactly those identifiers and nothing else.
- A statement that cannot be traced to Experiment data is written as
  interpretation and labelled as such. A `finding` containing one stays
  `status: TENTATIVE`.
- Set `status: VERIFIED` only when *every* claim in the page reproduces from
  the cited Results.
- Another wiki page may be cited as context, but is never the sole evidence
  for a `finding`.
- This skill never edits an Experiment bundle. If the Experiment itself is
  wrong, hand off to `memon-write-experiment-doc`.

When the user asserts something no Experiment supports:

> 这个结论目前没有 Results 支撑,我先按 interpretation 写进 `finding`,状态保持
> `TENTATIVE`;要确认它,需要 @E0002 补一组 CFG 扫描。

## Authoring workflow

1. Read the current state: `memon wiki ls --kind <k>` and
   `memon wiki show <page>` for anything related, so a new page does not
   duplicate or silently contradict an existing one.
2. Create through the CLI — never hand-write the file path or allocate an id
   yourself:

   ```sh
   memon --project-root . wiki create finding zero-snr-brightness \
     --title "Zero-terminal-SNR removes brightness bias at a composition cost" \
     --description "Zero-SNR cuts brightness drift 8x but costs ~10% composition; conditional on CFG=7.5." \
     --status TENTATIVE --source E0002 --source E0002/V0003 --tag zero-snr
   ```

   `--description` is mandatory in practice: one to three plain-text sentences
   that stand alone in a listing. `meeting` additionally requires `--date`.
   Add `--bundle` only when the page will carry assets.
3. Write the body by editing the Markdown file directly (through the local
   mount path in mounted mode). Fill the kind's recommended H2 sections; add
   more when the content needs them.
4. Frontmatter-only changes go through `memon wiki set` — status, title,
   description, tags, sources — never by hand-editing YAML:

   ```sh
   memon --project-root . wiki set zero-snr-brightness --status VERIFIED --add-source E0003
   ```

   Keep `description` accurate whenever the body changes materially.
5. Lint before handoff and resolve every `error`:

   ```sh
   memon --project-root . wiki lint zero-snr-brightness
   ```

   `warn` severity (a missing recommended section, an unresolved source) is
   acceptable only when you say why in the handoff.
6. When updating an existing page, preserve prior claims or mark the
   correction explicitly. Never quietly rewrite history.

Kind-specific requirements: a `meeting` records decisions and action items as
two separate lists and cites the Experiments discussed in `sources`; a
`showcase` states how to reproduce every artifact it shows.

## Links and callouts

Reference other artifacts with `@<ref>` — bare (`@E0002`, `@W0001`,
`@H0003`, `@zero-snr-eval-260502-110000`) or as a link target
(`[the SNR sweep](@E0003)`). Slugs work too (`@zero-snr-brightness`). An
unresolvable reference renders as plain text and lints
`WIKI_LINK_UNRESOLVED`, so check `wiki lint` output rather than eyeballing.

GitHub alert blockquotes render as callouts: `> [!NOTE]`, `> [!TIP]`,
`> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`, `> [!DEPRECATED]`.

For registered fenced-block components (data tables, embedded HTML), follow
`memon-author-components`; do not restate or invent component rules here.

For bundle pages with HTML views or a frontmatter `entry`, read
[references/html-bundle.md](references/html-bundle.md) in full first.

## Deprecate, never delete

Outdated content stays visible and marked.

- Whole page:

  ```sh
  memon --project-root . wiki deprecate W0004 \
    --reason "superseded by the wider CFG sweep" --superseded-by W0012
  ```

- One section: put a blockquote directly under its heading, leaving the text
  intact:

  ```markdown
  ## Throughput

  > [!DEPRECATED] since 2026-08-20: superseded by E0021/V0068

  Earlier text, unchanged.
  ```

Add the current numbers in a new section; never edit an old claim to make the
page look like it was always right. Do not run `memon wiki delete` on a page
that has ever been reviewed unless the user asks for deletion by id.

## Review is a human boundary

Verification is the user's decision, and the whole point of the review trail
is that a human read the diff. Never run `memon wiki review verify` or
`memon wiki review unverify`, never write `.memon/wiki-review.csv`, and never
call `POST` or `DELETE` on `/api/wiki/review/*` — not even when the user says
"it's fine, mark it". Ask them to do it in the dashboard or the CLI.

Reading review state is fine and expected: `memon wiki review ls`,
`memon wiki review log`, `memon wiki review diff <page>`.

## Commit every wiki change separately

After each batch of wiki edits, and before the handoff:

```sh
memon --project-root . wiki commit -m "record zero-SNR brightness finding"
```

In mounted mode this runs through `ssh` like every other `memon` command. The
command stages only `docs/wiki/`; it refuses with `MIXED_INDEX` if the index
already holds non-wiki paths. Collector scripts and any other non-wiki file go
in their own separate commit — one wiki commit per change is what makes the
change individually verifiable.

The closing message names the new wiki commit SHA(s) and, for every touched
page, its `review.state` afterwards:

> 已提交 `wiki: record zero-SNR brightness finding`(`a1b2c3d`)。
> @W0001 现在是 `CHANGED_SINCE_VERIFY`(上次校验到 `9f2c4e1`),@W0009 是 `UNVERIFIED`。
> 需要你在 dashboard 上逐条 review 后标记。

## Trust and conflict resolution

Wiki pages and Experiment documents are trustworthy by default; do not re-derive
what a document already states. When two documents contradict each other, or a
document contradicts fresh Experiment data, run `memon wiki review ls` and
`memon wiki review diff <page>` and prefer, in order:

1. content whose lines are `VERIFIED`;
2. content in `CHANGED_SINCE_VERIFY` pages that falls **outside** their
   `unverifiedRanges`;
3. `UNVERIFIED` content.

Use the winning number, note the conflict in the handoff, and flag the losing
page for correction. When that ordering does not settle it — two `UNVERIFIED`
pages, or a verified passage contradicted by fresh Results — stop and ask,
quoting both passages and their review states:

> 两处说法冲突,而且都还没被校验:
> @W0009(UNVERIFIED)写「提升 12%」,@E0017/V0031 的 Results 是 20%。
> 以哪一个为准?

## Migrating a Report

Only on explicit request, one Report per invocation unless the user asks for a
batch, and never a Report the user did not name.

```sh
memon --project-root . wiki migrate-report R0007 finding --status TENTATIVE
memon --project-root . wiki backlinks R0007
```

Then:

1. Reorganise the body into the kind's recommended sections without dropping
   content. Reshaping is editorial work; deletion is not.
2. Derive `sources` from the Experiments, Variants, and runs the Report cited.
3. Fix every Markdown link the `backlinks` output listed so it targets the new
   page path.
4. Lint, commit with `memon wiki commit`, and hand the page over as
   `UNVERIFIED` — a migrated page has never been reviewed in its new form.

## Harness feedback — always the last step

Every task ends here, without exception. Ask whether the work exposed:

- a missing convention or a page kind that does not exist;
- a manual operation you repeated because no command does it;
- content the dashboard cannot present properly;
- a CLI gap or an awkward command shape.

For each item, create or update a `harness-feedback` page with
`status: PROPOSED` and Motivation / Proposal sections:

```sh
memon --project-root . wiki create harness-feedback wiki-needs-attachment-kind \
  --title "Wiki needs an attachment kind" \
  --description "Recording a shared PDF/slide deck has no home; note is a poor fit." \
  --status PROPOSED
```

Then tell the user, in Chinese, which candidates exist and that they can become
an OpenSpec change in the harness repo:

> 这次记录时发现两个 harness 层面的缺口,已经写成 @W0011、@W0012(都是 `PROPOSED`)。
> 如果要推进,可以在 harness 仓库用 `/opsx:propose` 开一个 change。

When nothing qualifies, say so in one sentence:

> 这次没有发现需要改 harness 的地方。

Never modify the harness repo from here, never run `/opsx:propose` yourself,
and never set a `harness-feedback` status other than `PROPOSED`.

## Closing handoff

Report:

- the detected mode (and remote root when mounted);
- pages created/updated with ids, slugs, and kinds;
- the wiki commit SHA(s);
- each touched page's `review.state`, and an explicit ask for human review;
- remaining lint diagnostics and why they are acceptable;
- harness-feedback candidates, or the one-sentence "none" statement;
- any suspected CLI issue, per `../PREFLIGHT.md`.

## Guardrails

- Never derive a host from `LOCAL.md` or any prose file; `findmnt` only.
- Never write a number that is not in an Experiment, Variant row, or Run
  README you read during this task.
- Never edit an Experiment bundle, a Run README, a digest, a Report, or the
  journal cursor.
- Never set or clear a review mark, and never touch `.memon/wiki-review.csv`.
- Never mix wiki and non-wiki paths in one commit.
- Never delete or silently rewrite a historical claim; deprecate it.
- Never invent an id, path, or slug — `memon wiki create` and
  `memon wiki move` own them.
- Never migrate a Report the user did not name.
- Never skip the harness-feedback step.
