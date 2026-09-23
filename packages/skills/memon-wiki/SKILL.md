---
name: memon-wiki
description: "Maintain durable project knowledge under docs/wiki/ using the installed kind registry. Use when the user wants knowledge recorded, corrected, promoted from Experiment Results, or explicitly migrated out of a Report — in the current directory or an sshfs-mounted project."
---

# memon-wiki

Maintain the project wiki: the durable, human-readable layer above Experiments
and Runs. Experiments hold structured evidence; the wiki holds the meaning a
person needs six months later — what was decided, what is known, what is
blocked, what is still open.

A wiki page is never the source of a number. Every factual statement traces
back to an Experiment, a Variant row, or a Run README, and every wiki change
lands in its own commit so a human can verify it line by line.

## Authoring language

Pages are written in English unless the user chooses otherwise. The language
belongs to the page: frontmatter `language: zh` marks a Chinese page, and no
field means English.

- Write a new page in Chinese only when the user asks for Chinese for that
  page, states it as their preference for the pages of this task, or the
  page's maintenance rules require it. Create it with `--language zh`;
  otherwise create it in English.
- Update an existing page in its declared language. The conversation language
  does not change it: a Chinese discussion of an English page is recorded in
  English, and the reverse.
- Switch a page's language only when the user asks: rewrite the whole page
  faithfully (same claims, numbers, sources, links, and structure), run
  `memon wiki set <page> --language <en|zh>`, and land both in one wiki
  commit. Never leave a page half in one language.
- On a Chinese page, write the title, description, headings, prose, and table
  text in Chinese, and use the kind's Chinese heading forms listed in
  `references/page-kinds.md`. Ids, slugs, frontmatter keys, and `status`
  values never change.
- On every page, keep technical terms in English wherever a translation could
  blur them: artifact ids and `@` references, paths, commands, code, config
  keys, column, Variant, and metric names, method, model, library, and kernel
  names (DMD, FastVideo, VSA), acronyms (FID, CFG, SNR, QAT, NVFP4), and domain
  terms without a standard, unambiguous Chinese rendering (checkpoint,
  rollout, critic, cube). Use Chinese for ordinary words and for terms whose
  Chinese rendering is standard (训练, 学习率, 显存). For example:
  "V0341 在 K3 shifted schedule 下使用 C128 cube；checkpoint 500 的 DMD loss 仍在下降。"
- Keep verbatim source quotations in their original language. Do not translate
  or rewrite unrelated pages as part of a routine update.

Discussion and handoffs stay in the user's language whatever the page
language is. Readers who want the other language use the dashboard's
translation action; do not add a second-language copy to the page.

## Human-readable knowledge

Optimize wiki pages for human readers, not machine bookkeeping. Explain the
research goal, reasoning, relationships between experiments, what is known,
what remains uncertain, and the next decisions in concise prose.
Use headings, nested lists, and small tables only when they improve readability.

Experiment documents remain the maintained source of detailed designs, Results,
Variant metrics, execution state, and experiment-local tasks. Link to that
evidence instead of duplicating raw results, run logs, machine-oriented schemas,
or exhaustive status tables in the wiki. A small cited result may be included
when it is necessary to explain a conclusion.

Use the generated kind reference for kind-specific narrative and evidence
relationships. Never invent Experiment IDs for uncreated work. If discussion
exposes an outdated Experiment document, route its correction through the
Experiment authoring workflow instead of keeping corrected truth only here.

Represent user feedback faithfully. Preserve the user's priorities, corrections,
constraints, and unresolved disagreements in the relevant narrative, not merely
in a generic acknowledgement. Distinguish agreed decisions from suggestions and
open questions; never turn feedback into an unsupported experimental finding.
When feedback changes direction, explain the change and retain the historical
context rather than silently rewriting earlier conclusions. Translate meaning
faithfully into the page language without adding goals or commitments the user
did not make.

## Maintenance rules

A page can carry the owner's standing requirements for the agents that work on
it, in one section with a fixed name: `## Maintenance rules` on English pages,
`## 维护规则` on Chinese pages, placed as the page's last H2. It records how
agents maintain the page and what they must or must not do when acting on its
subject. Research facts, evidence, and decisions stay in the body.

Format (`wiki lint` warns `WIKI_MAINTENANCE_RULES_INVALID` otherwise):

- The section contains list items only: no paragraphs, sub-headings, tables,
  callouts, or code blocks.
- One requirement per item, stated as an instruction, ending with the date the
  user stated it: `(2026-09-23)`.
- Top-level items bind every agent. Requirements for one agent sit indented
  under a scope item worded exactly `- Only for <agent>:`. Related rules may be
  grouped under a topic item that ends with a colon (`- Launch safety:`), at
  any depth. Scope and topic items state no requirement themselves.
- The section holds current rules only. A replaced rule is edited, a withdrawn
  rule is removed; git keeps the history, so no `[!DEPRECATED]` markers here.

```markdown
## Maintenance rules

- Keep the top callout limited to the owner's current decision. (2026-09-22)
- Discuss in Chinese; write this page in English. (2026-09-13)
- Only for Oh My Pi:
  - Delegation:
    - Main owns research design, interpretation, and dispatch; delegated agents only execute. (2026-09-18)
  - Allocations:
    - Never cancel or modify a Slurm allocation; stop the launcher and hold the node in the queue CLI. (2026-09-18)
```

Before editing any page, read its rules and follow every top-level rule and
every rule scoped to you. Preserve rules scoped to other agents unchanged.

### Maintenance mode

The user can put you into maintenance mode for one page ("进入 W0012 的维护模式",
"maintain W0012"). Then:

1. Read the whole page, including its rules, and tell the user in a short list
   which rules bind you.
2. For the rest of the session, record every long-term requirement the user
   states — anything meant to hold beyond the current request ("以后", "每次",
   "默认", "never", "always", a standing preference about content, structure,
   language, process, or execution). Do not ask whether to record it. One-off
   instructions for the current request are not rules.
3. A requirement that replaces or contradicts a rule edits that rule; a
   withdrawn requirement removes it. Never keep two conflicting items. Scope a
   requirement to one agent only when the user says it applies to that agent.
4. Create the section when the first rule is recorded.
5. After every change to the section, tell the user exactly what changed,
   quoting the items:

   > 已更新 W0012「Maintenance rules」：
   > - 新增：「Only for Oh My Pi: Never cancel or modify a Slurm allocation; … (2026-09-23)」
   > - 删除：「Use one small-model owner per assigned node. (2026-09-13)」
   > - 修改：「Validate every 100 steps.」→「Validate every 50 steps. (2026-09-23)」

6. Rule edits are ordinary page edits: lint, `journal submit`, and a commit at
   the next stopping point (see "Commit and push at stopping points") whose
   summary names the rule change.

Outside maintenance mode, a standing requirement the user states explicitly
about how a page is maintained is recorded and reported the same way.

## When to use

- The user wants a roadmap, conclusion, decision, meeting, open question, or
  bottleneck written down where the whole project can find it.
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
- Manipulating a Journal file, or writing a digest/summary of one — neither is
  work any skill does; see `../PREFLIGHT.md`.
- Verifying a page. Verification is the human's job (see below).

Use the ordinary `digest` Wiki kind for a user-requested retrospective over a
time window. Link research evidence directly; do not synthesize the diagnostic
Journal. Legacy `docs/digests/` files belong to the reviewed v7 migration, not
ad-hoc move/relabel operations. Never create new standalone D documents.

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
├── roadmap/W0009-research-directions.md
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

Read [references/page-rules.md](references/page-rules.md) for shared safety and
frontmatter rules, and the generated [references/page-kinds.md](references/page-kinds.md) for every kind's
purpose, status vocabulary, required frontmatter, recommended H2 sections, and
authoring guidance. Inspect the installed definitions with `memon wiki kinds ls`
and `memon wiki kinds show <kind> --format human` (or `--format json`). Generated
guidance is refreshed when the updated skills package is installed, not when
someone edits the source registry. Pick the kind with the user, or infer it
when the request is unambiguous. When two kinds both fit, ask:

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
   duplicate or silently contradict an existing one. Before editing an
   existing page, read its maintenance rules.
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
   Add `--language zh` for a Chinese page (see Authoring language); it also
   scaffolds the Chinese heading forms. Add `--bundle` only when the page will
   carry assets.
3. Write the body by editing the Markdown file directly (through the local
   mount path in mounted mode). Fill the kind's recommended H2 sections when it
   has any; shape a roadmap around the research tree rather than fixed headings.
4. Frontmatter-only changes go through `memon wiki set` — status, title,
   description, tags, sources, language — never by hand-editing YAML:

   ```sh
   memon --project-root . wiki set zero-snr-brightness --status VERIFIED --add-source E0003
   ```

   Keep `description` accurate whenever the body changes materially.
5. Lint before handoff and resolve every `error`:

   ```sh
   memon --project-root . wiki lint zero-snr-brightness
   ```

   Explain remaining warnings, such as missing recommended sections, in the
   handoff. CLI lint checks content and syntax only: it does not open source
   targets, check their existence, compute staleness, or consult git — it
   never reports whether a page or a finding has been reviewed. Inspect those
   target-derived checks in Web, which reuses the central file cache.
6. Submit the direct page edits to the Journal. Body edits made in the editor
   are invisible to the invocation ledger, while `wiki create`, `wiki set`,
   `wiki deprecate` and `wiki migrate-report` already record themselves. After
   lint passes, close the whole batch with exactly one submission naming only
   the page files you hand-edited:

   ```sh
   memon --project-root . --format json journal submit \
     --files docs/wiki/finding/W0001-zero-snr-brightness.md
   ```

   In mounted mode this runs through `ssh` like every other `memon` command,
   with paths relative to the remote project root. Follow the full contract in
   `../PREFLIGHT.md`: one submission per batch, no prose input, all-or-nothing
   validation, and no second submission for a change a `wiki` subcommand
   already made. It is not a commit — `memon wiki commit` still runs
   separately. Keep the returned `invocationId` for the handoff; if the
   submission is rejected, keep the page edit and report the maintenance as
   unrecorded with the exact command and error.
7. When updating an existing page, preserve prior claims or mark the
   correction explicitly. Never quietly rewrite history.

Follow the generated kind-specific writing guidance in `references/page-kinds.md`.

## Links and callouts

Reference other artifacts with `@<ref>` — bare (`@E0002`, `@W0001`,
`@H0003`, `@zero-snr-eval-260502-110000`) or as a link target
(`[the SNR sweep](@E0003)`). Slugs work too (`@zero-snr-brightness`). An
unresolvable reference renders as plain text and lints
`WIKI_LINK_UNRESOLVED`, so check `wiki lint` output rather than eyeballing.

GitHub alert blockquotes render as callouts: `> [!NOTE]`, `> [!TIP]`,
`> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`, `> [!DEPRECATED]`.

For component blocks (`` ```<lang> <type>@<N> #<id> ``), follow
`memon-components`; do not restate or invent component rules here.

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
page look like it was always right. Run `memon wiki delete` only when the user
asks for deletion by id — the CLI cannot tell you whether a page has already
been reviewed, so assume it has.

## Review is a human boundary

Verification is the user's decision, and the whole point of the review trail
is that a human read the diff. Never run `memon wiki review verify` or
`memon wiki review unverify`, never write `.memon/wiki-review.csv`, and never
call `POST` or `DELETE` on `/api/wiki/review/*` — not even when the user says
"it's fine, mark it". Ask them to do it in the dashboard or the CLI.

Ordinary wiki commands — `ls`, `show`, `create`, `set`, `move`, `deprecate`,
`undeprecate`, `delete`, `lint`, `backlinks`, `migrate-report` —
carry no review information at all and never inspect git. Do not expect a
`review` field in their output, and do not read the review trail "just to be
safe" after ordinary wiki work. Only `wiki commit` and the `review`
subcommands touch git, and `wiki commit` marks nothing verified.

Read the review trail only when the user explicitly asks for it, through the
`review` subcommands:

```sh
memon --project-root . wiki review log
memon --project-root . wiki review diff
```

`review log` lists the wiki commits in order and where human verification
currently stops. `review diff` takes no page argument: it is one diff of the
whole `docs/wiki/` tree from the last human-verified commit (`base`) to current
`HEAD`. There is no per-page CLI diff. When nothing has been verified yet,
`base` is the git empty tree and the diff covers all committed wiki content.
Uncommitted edits are never included — commit them first if the user wants to
review what you just wrote.

When `review diff` fails — a git failure, or `REVIEW_STALE_BASELINE` because a
recorded mark no longer exists in the wiki history — report the error verbatim
and stop. Never "fix" it by unverifying a mark; that is the user's call.

Per-page review state (`VERIFIED` / `CHANGED_SINCE_VERIFY` / `UNVERIFIED`, the
exact unverified line ranges, `verifiedThrough`) is a **Web-only** surface, as
are resolved sources and staleness. Point the user at the dashboard for it;
the CLI does not derive it.

## Commit and push at stopping points

Do not commit after every edit. Commit when the batch of page changes has
reached a stopping point — the pages say what this task set out to record.
While an experiment the pages depend on is still running or pending, or a
question to the user is open whose answer would change the pages, leave the
edits uncommitted and say so in the handoff, unless the user asks you to commit
the current version now.

At a stopping point, commit the batch as one commit that names exactly the
pages you changed — related pages changed together (a finding and the roadmap
that links it) share one commit; unrelated batches get separate commits:

```sh
memon --project-root . wiki commit W0001 W0012 -m "record zero-SNR brightness finding"
```

With page arguments the command stages and commits only those pages' files
(including renames, deletions, and `__assets/`), so pages and files other
agents changed in the same working tree stay out of your commit. Never omit
the page list; never pass a page you did not change. Collector scripts and any
other non-wiki file go in their own separate commit.

The command then pushes the branch to its upstream automatically; earlier
unpushed local commits go with it, which is expected. It exits 1 with
`PUSH_FAILED` when the push cannot happen (no upstream, remote advanced,
network or credentials): the commit stays local. Report the SHA and git's
reason; do not fetch, rebase, merge, or force on your own. `--no-push` exists
for the rare case where the user asks to commit without pushing. In mounted
mode the command runs through `ssh` like every other `memon` command.

The closing message names the new wiki commit SHA(s) with their push result
and asks the user to review them. Committing never marks anything verified,
and a change that is not committed cannot appear in `memon wiki review diff`:

> 已提交并推送 `wiki: record zero-SNR brightness finding`(`a1b2c3d`)。
> 本次改动涉及 @W0001、@W0012,尚未有人 review。
> 需要的话可以用 `memon wiki review diff` 看自上次人工校验以来 docs/wiki 的整体改动,
> 或在 dashboard 上逐条 review 后标记;单页的 review 状态只在 Web 上显示。

## Trust and conflict resolution

Wiki pages and Experiment documents are trustworthy by default; do not re-derive
what a document already states. When two documents contradict each other, or a
document contradicts fresh Experiment data, prefer, in order:

1. content a human has verified;
2. content of a partly verified page that falls **outside** its unverified
   line ranges;
3. content nobody has verified yet.

That ordering needs per-page review state, which only Web derives: the review
badge, `verifiedThrough`, and the tinted unverified blocks in the reading pane.
Ask the user to read it there, or — when they ask for it — run
`memon wiki review diff` for the whole-wiki diff since the last verified
commit. Never infer a page's review state from an ordinary `wiki` command or
from `wiki lint`; they do not report one.

Use the winning number, note the conflict in the handoff, and flag the losing
page for correction. When that ordering does not settle it — nothing verified
on either side, or a verified passage contradicted by fresh Results — stop and
ask, quoting both passages and whatever is known about their review state:

> 两处说法冲突,而且都还没被校验:
> @W0009 写「提升 12%」,@E0017/V0031 的 Results 是 20%。
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
3. Review the declared Wiki source references returned by `backlinks`.
   The CLI does not scan Markdown links or resolve targets; inspect resolved
   backlinks in Web and update affected Markdown links to the new page path.
4. Lint, submit the reorganised page with one `journal submit --files` call
   (the `migrate-report` invocation is already recorded; the body rewrite is
   not), commit with `memon wiki commit`, and hand the page over as never yet
   reviewed — a migrated page carries no verification from its Report life.

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
- pages created/updated with ids, slugs, kinds, and language;
- maintenance rules added, removed, or changed (already reported when they
  happened; repeat them here);
- the wiki commit SHA(s) with their push result, or which pages stay
  uncommitted and what they wait for; and the `journal submit` `invocationId`
  for the direct page edits (or the reason the maintenance is unrecorded);
- an explicit ask for human review of those commits; do not report a per-page
  review state — the CLI derives none, and Web is where the user reads it;
- remaining lint diagnostics and why they are acceptable;
- harness-feedback candidates, or the one-sentence "none" statement;
- any suspected CLI issue, per `../PREFLIGHT.md`.

## Guardrails

- Never derive a host from `LOCAL.md` or any prose file; `findmnt` only.
- Never write a number that is not in an Experiment, Variant row, or Run
  README you read during this task.
- Never edit an Experiment bundle, a Run README, or a Report.
- Never read, write, or repair a Journal file; the only contact with the
  Journal is the single `journal submit` in step 6.
- Never set or clear a review mark, and never touch `.memon/wiki-review.csv`.
- Never run a `memon wiki review` command unless the user asked for the review
  trail; ordinary wiki work ends at `memon wiki commit`.
- Never mix wiki and non-wiki paths in one commit.
- Never delete or silently rewrite a historical claim; deprecate it.
- Never edit a page without first reading its maintenance rules, and never
  record or drop a rule without telling the user the exact item.
- Never invent an id, path, or slug — `memon wiki create` and
  `memon wiki move` own them.
- Never migrate a Report the user did not name.
- Never skip the harness-feedback step.
