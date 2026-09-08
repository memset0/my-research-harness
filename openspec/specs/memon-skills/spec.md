# memon-skills Specification

## Purpose
Define bundled research-writing workflows, ownership, safety and skill installation boundaries for the accepted native CLI.

## Requirements

### Requirement: Skill body is English; user-facing dialogue is Chinese

Every `packages/skills/memon-*/SKILL.md` instructional body (headings, paragraphs, list items, code-block comments) SHALL be written in English. Skills MAY embed Chinese strings as templates of what to *say* to the user during the conversation; those quoted Chinese examples MUST be visibly user-facing (e.g., enclosed in block quotes or backquotes) so the role distinction is unambiguous.

This convention reflects the broader project rule (codified in repo `CLAUDE.md`) that skills are agent-targeted artifacts (English) but human conversation is in Chinese.

#### Scenario: SKILL body is English
- **WHEN** sampling 5 random headings and 10 random paragraphs from any `memon-*/SKILL.md` instructional body
- **THEN** all sampled text is in English

#### Scenario: Embedded Chinese for user dialogue is explicit
- **WHEN** reviewing `memon-write-script/SKILL.md` "When you're done" section
- **THEN** Chinese-language example prompts appear inside `>` block quotes, distinguishing them as user-dialogue templates from the English instructional surround

### Requirement: code.diff allowlist lives in project's CLAUDE.md

`memon-run-experiment`'s `code.diff` capture (§1.b of its workflow) SHALL filter the project's `git diff HEAD` against an **allowlist** of pathspecs. The allowlist SHALL be stored in the project's root `CLAUDE.md` under a heading `## code.diff allowlist`, one pathspec per line.

If the heading is absent on first run, the skill SHALL interactively seed it: inspect the project's actual file extensions via `git ls-files | sed -n 's/.*\.//p' | sort | uniq -c | sort -rn`, propose an allowlist (intersecting with the skill's default seed list), get user confirmation, and append the heading + agreed list to `CLAUDE.md`. Subsequent runs SHALL read the section directly without reprompting.

#### Scenario: Allowlist read from CLAUDE.md
- **WHEN** `memon-run-experiment` runs in a project whose `CLAUDE.md` contains a `## code.diff allowlist` section
- **THEN** the skill reads the section's pathspecs verbatim and uses each as `:(glob)**/<pat>` in `git diff -- ...`

#### Scenario: First-run seeds the allowlist
- **WHEN** `memon-run-experiment` runs in a project whose `CLAUDE.md` lacks a `## code.diff allowlist` heading
- **THEN** the skill: (a) inspects file extensions via `git ls-files`, (b) proposes a candidate allowlist to the user, (c) on confirmation, appends `## code.diff allowlist` plus the agreed pathspecs to `CLAUDE.md`, (d) proceeds with that list

### Requirement: Pre-launch environment + GPU sanity check

`memon-run-experiment` SHALL perform a quick (~2-second) environment + GPU sanity check before invoking the launcher script. The check SHALL include: `which python` + `python -V`, `python -c 'import torch; print(torch.cuda.is_available())'` (when the script is GPU-bound), and `nvidia-smi --query-gpu=index,memory.used,memory.total,utilization.gpu --format=csv,noheader`. The skill SHALL bail out and ask the user (NOT proceed to launch) when any of: `nvidia-smi` itself fails (driver missing); a requested GPU is already at >5% memory in use by another process; `python` is not found and the script does not include in-script `conda activate`.

#### Scenario: GPU contention bails out
- **WHEN** `nvidia-smi` reports another process holds >5% memory on a requested GPU
- **THEN** the skill stops, surfaces the conflict to the user, and does NOT invoke the launcher script

#### Scenario: Healthy environment proceeds
- **WHEN** the check finds Python present, CUDA available (when expected), and all requested GPUs idle
- **THEN** the skill proceeds to capture `code.diff` and launch the script

### Requirement: Numeric IDs are 4-digit zero-padded across all skill outputs

All numeric identifiers emitted by skills (hypothesis `H<NNNN>`, digest `D<NNNN>`, report `R<NNNN>`, wiki page `W<NNNN>`, and the legacy `R<NNNN>` form preserved in a migrated page's `legacy_id`) SHALL use the canonical 4-digit zero-padded form per the `hypotheses` capability. Skills that compute `next_n + 1` SHALL format the result with `printf '%04d'` (or equivalent) before constructing the filename or id string. Skills SHALL NOT emit unpadded ids (`H1`, `D7`, `R42`, `W42`).

#### Scenario: Report filename uses %04d
- **WHEN** `memon-write-report` computes the next N as 42 with slug `bf16-investigation`
- **THEN** the filename is `R0042-bf16-investigation.md`, NOT `R42-bf16-investigation.md`

#### Scenario: Frontmatter hypothesis refs are padded
- **WHEN** `memon-run-experiment` writes a new run README and the user mentioned "this run tests hypothesis 3"
- **THEN** the frontmatter `hypotheses:` array contains `H0003`, NOT `H3`

#### Scenario: Wiki page id is padded
- **WHEN** `memon-wiki` refers to the page whose allocated number is 42
- **THEN** it writes the id as `W0042`, NOT `W42`

### Requirement: Spec-mutating skills SHALL preflight-check the FS convention version

Every memon skill that reads or writes spec files (the per-experiment `<runDir>/README.md`, the project's `<projectRoot>/docs/hypotheses.md`, `<projectRoot>/docs/journal.md`, or any file under `<projectRoot>/docs/digests/`, `<projectRoot>/docs/reports/`, or `<projectRoot>/docs/wiki/`) SHALL invoke `memon fs-version check --project-root <p> --format json` as the first executable step in its workflow body, parse the result, and branch as follows:

- `status === "match"`: proceed with the rest of the skill.
- `status === "behind"`: surface the gap to the user (current version, expected version), recommend invoking `memon-migrate-fs`, and stop. The skill SHALL NOT proceed to read or write any spec file.
- `status === "uninitialised"`: surface that `<projectRoot>/.memon/version.json` is absent and recommend running `memon install-skills` first. The skill SHALL stop.
- `status === "ahead"`: the CLI subcommand has already exited `MEMON_TOO_OLD`; the skill SHALL forward this error to the user and stop.

This preflight section SHALL appear in the skill body using consistent language across skills, so that an agent reading any memon-* skill encounters the same preamble shape. The exact preamble text is canonicalised in the bundled skills' source; skills SHALL NOT diverge from it.

The following skills are subject to this requirement (matching the user-invoked skill set plus the model-invocable append-* skills):
- `memon-write-script` — writes launcher scripts (does not directly mutate spec files, but is part of the run-experiment workflow that does).
- `memon-run-experiment` — writes `<runDir>/README.md`.
- `memon-digest-journal` — reads `docs/journal.md`, writes digests, advances cursor.
- `memon-write-report` — writes report files under `docs/reports/`.
- `memon-wiki` — writes wiki pages under `docs/wiki/`.
- `memon-propose` — writes proposal artifacts.
- `memon-append-journal` — appends event lines to `docs/journal.md`.
- `memon-append-warning` — appends warning rows to `<runDir>/README.md`.
- `memon-migrate-fs` itself is exempt from preflight (it IS the migration entry; it reads `.memon/version.json` directly as part of its own protocol).

A skill that must first establish *how* it reaches the project (for example `memon-wiki`, which detects whether it operates in-project or through an sshfs mount and derives the `memon` invocation channel from that) MAY place that non-mutating detection step ahead of the preflight, provided the preflight call is still the first `memon` invocation and no spec file is read or written before it resolves.

#### Scenario: Skill body contains the preflight preamble
- **WHEN** a reader inspects the workflow body of any of the six listed skills
- **THEN** the very first numbered step (or a section labelled "Preflight") executes `memon fs-version check --project-root <p> --format json`
- **AND** the step explicitly enumerates branches for `match` (proceed), `behind` (stop with migrate-fs recommendation), `uninitialised` (stop with install-skills recommendation), and `ahead` (stop with MEMON_TOO_OLD message)

### Requirement: `memon-migrate-fs` is the seventh bundled skill

A new bundled skill `packages/skills/memon-migrate-fs/SKILL.md` SHALL exist alongside the existing six skills. Like the other heavy skills, it SHALL declare `disable-model-invocation: true` (user-invoked only). Its workflow body, language conventions, and `--project-root` discipline SHALL conform to the project-wide rules already in this spec (English body, embedded Chinese for user-facing dialogue, every `memon ...` invocation passes `--project-root` explicitly).

This skill is the only one that is exempt from the FS-version preflight requirement above (because it IS the migration runtime).

#### Scenario: Skill exists with correct frontmatter
- **WHEN** a reader inspects `packages/skills/memon-migrate-fs/SKILL.md`
- **THEN** the frontmatter contains `disable-model-invocation: true`
- **AND** every `memon ...` example in the body passes `--project-root .` (or `--project-root <p>`) explicitly

#### Scenario: Skill body language conventions
- **WHEN** a reader samples 5 random headings and 10 random paragraphs from the SKILL body
- **THEN** all sampled text is in English
- **AND** any user-facing dialogue (confirmation prompts) appears inside `>` block quotes in Chinese

### Requirement: `memon-run-experiment` post-run anomaly review step

`memon-run-experiment` SHALL include a post-run anomaly review step that runs after the run README has been written. The step SHALL: (a) inspect `run.log`, wandb (if linked), and any explicit metric artifacts the run wrote; (b) for each finding the agent judges to require human adjudication, call `memon experiment warning add <id> --project-root . --category <cat> --message <text>`; (c) capture the new mtime returned by `add` and use it as input to subsequent writes within the same logical operation; (d) on CONFLICT, refresh mtime and retry once.

The skill body SHALL bound what qualifies as a warning: items with reproducibility risk, methodology drift, anomalous metrics, hardware noise, or a delta from a referenced baseline / paper. The skill body SHALL explicitly list anti-patterns: "every minor info note", "things the user already wrote in Caveats", "items that could be answered with a one-line journal append".

The skill SHALL NOT call `warning resolve`, `warning reopen`, or `warning delete` under any circumstance. State changes are human-only acts.

#### Scenario: Post-run review step appears after README write
- **WHEN** a reader inspects `packages/skills/memon-run-experiment/SKILL.md`'s workflow
- **THEN** there is a §7 (or equivalent terminal step) titled "post-run anomaly review" placed AFTER the README write step, and its example invocations call `memon experiment warning add` with `--project-root .` explicitly

#### Scenario: Run-experiment is forbidden from calling resolve/reopen/delete
- **WHEN** a reader greps `packages/skills/memon-run-experiment/SKILL.md` for `warning resolve`, `warning reopen`, or `warning delete`
- **THEN** any occurrence is inside an explicitly-marked Anti-pattern block

#### Scenario: Skill text bounds what qualifies as a warning
- **WHEN** a reader inspects the post-run review section
- **THEN** the text includes both a "what qualifies" paragraph (reproducibility / methodology / anomalous metrics / hardware noise / baseline-drift) and an explicit Anti-patterns list naming low-signal items the agent must NOT flag

### Requirement: `memon-write-code-review` exists as a model-invocable code-review authoring skill

A bundled skill at `packages/skills/memon-write-code-review/SKILL.md` SHALL
exist. It authors a single code-review doc per invocation at
`<projectRoot>/docs/code-review/<YYYY-MM-DD>-<slug>.md` (project-wide) or
`<projectRoot>/docs/experiments/E<NNNN>-<slug>/code-review/<YYYY-MM-DD>-<slug>.md`
(experiment-scoped). It SHALL be model-invocable (no
`disable-model-invocation: true` field, or `false`) — one low-stakes markdown
write, the same tier as `memon-write-report`. The skill body SHALL be English
with any user-facing dialogue in Chinese inside `>` block quotes.

The skill body SHALL document the frontmatter contract the runtime parses:
`title`, `description`, `experiment` (`E<NNNN>-<slug>` or null), `created_at` /
`updated_at` (ISO8601 with timezone offset), `commits[]` (each `repo`, `sha`,
`url`, optional `subject`, and `reviewed`), and `review_todolist[]` (each `item`
and `done`). It SHALL state that completion is derived (the human checks the
boxes in the dashboard) and that the agent writes every `reviewed` / `done` flag
as `false`.

The skill body SHALL give a submodule-aware recipe for the per-commit `url` and
for in-body line-level permalinks: each link uses the owner/repo and `sha` of the
repo the file lives in (the main repo or the specific submodule), with the
`<path>` relative to that repo's root; the commit URL is `…/commit/<sha>` and the
line permalink is `…/blob/<sha>/<path>#L<a>-L<b>`.

The skill body SHALL document the body template: `## Requirement`,
`## Changes`, `## Verification`, `## Notes`, with each change in `## Changes`
titled in Conventional Commits style and carrying the H4 subsections
Deliverables, Design Decisions, Analysis, Verification, and Details (write
"None" when empty). It SHALL instruct: `Analysis` is a complete, end-to-end
walk-through of the change (substantial, not one or two lines) that weaves
together essential code excerpts, line-level permalinks, pseudocode, and math
(`$…$` / `$$…$$`); keep raw code minimal (link full code via permalink, never
paste whole files) without shortening the walk-through; go deep on the "why" in
`Design Decisions` (underlying root cause and relevant math); label pseudocode
with a sentence before the fenced block. It SHALL instruct the agent to consult
the user via AskUserQuestion (or a plain question where that tool is
unavailable) when the change-split granularity is ambiguous, and SHALL frame the
sections as angles to consider rather than a rigid template (omit what does not
apply; extra content is allowed).

The skill SHALL preflight-check the FS convention version per
`../PREFLIGHT.md`, and SHALL appear in `packages/skills/README.md` (the
skill-selection matrix and the files-written table).

After successfully writing the document, the skill SHALL tell the user in the
active conversation that the code-review is ready and include the created or
updated path. Completion SHALL NOT depend on an out-of-band notification
command or transport.

#### Scenario: Skill exists with model-invocable frontmatter

- **WHEN** a reader inspects
  `packages/skills/memon-write-code-review/SKILL.md`
- **THEN** the frontmatter has `name: memon-write-code-review` and contains no
  `disable-model-invocation: true` line (the field is absent or `false`)

#### Scenario: Documents both scope locations

- **WHEN** a reader inspects the file-naming section
- **THEN** both the project-wide `docs/code-review/` and the experiment-scoped
  `docs/experiments/E<NNNN>-<slug>/code-review/` locations appear, with the
  `<YYYY-MM-DD>-<slug>` filename shape

#### Scenario: Submodule-aware permalink recipe

- **WHEN** a reader inspects the GitHub-link guidance
- **THEN** it specifies per-repo owner/sha and a `<path>` relative to the owning
  repo's root for both the `/commit/<sha>` and
  `blob/<sha>/<path>#L<a>-L<b>` forms

#### Scenario: Body template with conventional-commit change titles and five subsections

- **WHEN** a reader inspects the body template
- **THEN** the sections Requirement / Changes / Verification / Notes appear,
  and each change carries the five H4 subsections (Deliverables, Design
  Decisions, Analysis, Verification, Details)

#### Scenario: Listed in the skills index

- **WHEN** a reader inspects `packages/skills/README.md`
- **THEN** `memon-write-code-review` appears in the skill-selection matrix and
  in the files-written table

#### Scenario: Skill body language conventions

- **WHEN** a reader samples headings and paragraphs from the skill body
- **THEN** all sampled prose is in English, and any user-facing dialogue appears
  in Chinese inside `>` block quotes

#### Scenario: Code-review completion is conversational

- **WHEN** `memon-write-code-review` finishes writing a doc
- **THEN** the agent tells the user in the active conversation that the review
  is ready and provides its path
- **AND** no notification command is invoked

### Requirement: `memon-drive` offers a code-review when a reviewable change lands

The `memon-drive` orchestrator skill SHALL, after a Plan item completes whose
work was a non-trivial code change (a feature, fix, or refactor that landed as
one or more commits) and that has not already been written up, proactively ask
the user whether to capture it as a code-review doc and, on assent, hand off to
`memon-write-code-review` scoped to the current experiment. It SHALL ask once per
reviewable unit (not per commit) and SHALL skip runs / sweeps that produced
results but no code change. `memon-write-code-review` SHALL be listed among
`memon-drive`'s sub-tools.

#### Scenario: Offer fires after a code change, not after a results-only run

- **WHEN** a `memon-drive` Plan item that landed code commits completes
- **THEN** the orchestrator asks the user whether to generate a code-review and,
  on yes, invokes `memon-write-code-review`
- **AND** a Plan item that produced only run results (no code change) gets no offer

#### Scenario: Code-review is a listed sub-tool

- **WHEN** a reader inspects the `memon-drive` skill body
- **THEN** `memon-write-code-review` appears among its sub-tools

### Requirement: Warning skill is removed while CLI compatibility remains

The bundled skill inventory SHALL NOT contain `memon-append-warning`. Official skills SHALL route Warning updates through `memon-write-experiment-doc`. Existing warning CLI commands remain functional indefinitely and print a deprecation notice on every invocation.

#### Scenario: Installed skill set removes warning skill
- **WHEN** `memon install-skills` synchronizes v6 skills
- **THEN** no `memon-append-warning` directory remains in the target

### Requirement: `memon-write-report` coordinates optional external visualization skills within one view namespace

After the user explicitly requests an HTML/interactive Report,
`memon-write-report` MAY invoke a suitable visualization skill already installed
for the project. Delegation is optional and SHALL NOT install or require one
particular external skill or frontend framework. `memon-write-report` remains
the coordinator and owner of the Report ID, frontmatter, evidence claims,
`README.md` narrative/composition, and final user handoff.

Before invoking the delegate, the writer SHALL allocate one unused lowercase
kebab-case `views/<slug>/` namespace and provide the exact write path,
visualization objective, selected inputs, source-attribution requirements,
static-output/relative-URL/JSON rules, and mobile/desktop acceptance criteria.
The writer SHALL extract normalized evidence into root `data/*.json` and expose
those paths to the delegate as read-only inputs. View-local JSON MAY describe UI
configuration but SHALL NOT duplicate or redefine the normalized evidence.
The external skill SHALL write only inside that allocated namespace. It SHALL
NOT modify the Report README/frontmatter, writer-owned root `data/`, other
bundle-root files, another view, or any other project path. It SHALL return its
produced paths and validation evidence to the writer.

After delegation, `memon-write-report` SHALL verify the write scope and output,
author the README embed itself, and either accept the view or request correction.
External-skill completion alone SHALL NOT constitute Report completion.

#### Scenario: Installed visualization skill contributes one view

- **GIVEN** the user explicitly requested an interactive Report and the current
  project Agent has a suitable visualization skill installed
- **WHEN** `memon-write-report` delegates a loss-curve view
- **THEN** it assigns an unused path such as `views/loss-curves/` and supplies
  the view contract plus writer-owned root JSON as read-only evidence
- **AND** the delegate returns static output only below that path
- **AND** `memon-write-report`, not the delegate, edits README.md to embed
  `./views/loss-curves/index.html`

#### Scenario: Delegate may not manage Report identity or narrative

- **GIVEN** a visualization delegate is writing `views/latency-comparison/`
- **WHEN** it completes its work
- **THEN** it has not modified README.md, frontmatter, the Report ID/slug, or any
  sibling view
- **AND** the writer checks this boundary before accepting the output

#### Scenario: No external skill is available

- **GIVEN** the user requested an HTML Report but no suitable external
  visualization skill is installed
- **WHEN** `memon-write-report` plans the work
- **THEN** the Report may still be authored directly under the same static
  output and acceptance rules
- **AND** the absence of a delegate does not change the explicit-user-only HTML
  representation rule

### Requirement: `memon-write-report` performs final static, mobile, and desktop acceptance

Before reporting an HTML bundle complete, `memon-write-report` SHALL open each
new or changed view through the same Report asset route used by the dashboard.
It SHALL verify local fetch/import/image/font URLs and MIME types, writer-owned
root JSON data separation and read-only consumption, source attribution,
understandable loading/empty/error fallback text, and the absence of absolute
local paths or read-time server/build dependencies.

The writer SHALL test the rendered Report at exactly 390 CSS pixels wide and at
a representative desktop width of at least 1280 CSS pixels. At 390px, content
and primary controls SHALL not be page-clipped or overlap, text SHALL remain
readable, and every data dimension SHALL remain reachable through responsive
layout or intentional internal scroll/pan. At desktop width, content and
controls SHALL remain unclipped and use the available space legibly. At both
widths, the writer SHALL verify the host wrapper's Retry, Open in new tab, and
fullscreen actions are reachable.

Any unresolved failure or desktop-only limitation SHALL be reported rather than
silently accepted. These checks do not introduce a manifest or iframe
auto-height protocol.

#### Scenario: 390px acceptance catches a desktop-only view

- **GIVEN** a delegated visualization whose legend covers its controls at a
  390px viewport
- **WHEN** `memon-write-report` performs final acceptance
- **THEN** the writer does not report the Report complete
- **AND** it requests a responsive correction or reports the remaining
  limitation to the user

#### Scenario: Static portable view passes final acceptance

- **GIVEN** a view whose local assets and writer-owned root JSON resolve through
  the Report route and whose layout is usable at 390px and at least 1280px
- **WHEN** Retry, Open in new tab, fullscreen, attribution, and fallback checks
  also pass
- **THEN** `memon-write-report` may compose it into README.md and deliver the
  final Report handoff

### Requirement: Every bundled skill reports encountered CLI problems at terminal handoff

Every skill exported in `SKILL_NAMES` SHALL follow the shared CLI-issue reporting protocol. A suspected memon CLI problem includes a crash, unexpected non-zero exit, rejection of valid input, malformed or internally inconsistent output, documented/output behavior mismatch, or a workaround required because the intended CLI path did not work.

When a safe workaround exists, the skill SHALL continue the user's requested task and defer the CLI issue report until its final successful handoff. When the issue prevents completion, the skill SHALL include the report in its blocked handoff. The report SHALL contain the redacted command or operation, observed behavior, expected behavior, task impact and workaround, and whether the issue was reproduced. It SHALL NOT expose credentials or other secrets.

Expected domain-state and validation failures SHALL NOT automatically be labeled CLI bugs. Examples include a documented preflight version mismatch, a genuinely missing ID, invalid user input, or lint correctly rejecting an invalid document. When classification is uncertain, the skill SHALL describe the evidence and uncertainty instead of asserting a bug.

#### Scenario: Workaround succeeds and report is deferred
- **GIVEN** a memon CLI operation produces malformed output during a skill workflow
- **AND** the Agent safely completes the requested task through a direct-file or equivalent supported workaround
- **WHEN** the skill returns its final handoff
- **THEN** it reports the CLI operation, observed versus expected behavior, workaround, and reproducibility
- **AND** it does not interrupt the task solely to report the non-blocking issue

#### Scenario: CLI issue blocks completion
- **GIVEN** a suspected CLI problem has no safe in-scope workaround
- **WHEN** the skill returns a blocked handoff
- **THEN** the handoff includes the redacted diagnostic evidence and task impact

#### Scenario: Expected validation failure is not mislabeled
- **GIVEN** `memon experiment doc lint` correctly rejects an invalid Experiment bundle
- **WHEN** the skill reports its outcome
- **THEN** it describes the document diagnostic as project state to fix
- **AND** it does not claim the CLI itself is buggy without contradictory evidence

### Requirement: Three narrative artifacts divide the project's prose surface

Reports SHALL remain theme-keyed snapshots authored by their Report skill. Wiki pages SHALL remain living, source-linked knowledge maintained by the Wiki skill. Historical Digests SHALL remain readable, but no managed digest authoring skill or Journal cursor advancement SHALL be required. A writer SHALL stay within its owning artifact and preserve research history.

#### Scenario: Maintaining current knowledge
- **WHEN** accepted findings change
- **THEN** the writer updates the relevant Wiki and Experiment sources without generating a mandatory digest or advancing a Journal cursor

### Requirement: Supported skill invocation preserves risk boundaries without Journal authors

The FS migration skill SHALL remain user-invoked. Other supported skills MAY be model-invocable subject to their documented authority boundaries. The inventory SHALL exclude memon-append-journal and memon-digest-journal; no replacement Journal prose or digest scheduler skill SHALL be added. Wiki/component skills from the completed wiki change SHALL remain supported.

#### Scenario: Installed inventory matches the release
- **WHEN** supported skills are synchronized into a project
- **THEN** the two retired Journal skills are removed and unrelated custom skills remain unchanged

### Requirement: All supported skill commands explicitly select the project

Every skill-issued memon invocation SHALL explicitly select its project root. Mounted workflows SHALL execute commands through the selected remote channel rather than run normal memon/git scans over sshfs. New activity and evidence commands follow the same rule.

#### Scenario: Mounted writer finalization
- **WHEN** a writer finalizes edited files in a mounted project
- **THEN** journal submit runs on the actual host with an explicit project root; the agent never operates on Journal files

### Requirement: Document and review writers preserve optimistic concurrency

README and managed-document writers SHALL snapshot the source hashes/mtimes, preserve existing optimistic locks, and reread/reapply once on conflict before reporting a repeated conflict. They SHALL NOT use force to overwrite concurrent work. Review-record writes also SHALL carry exact content and metadata preconditions.

#### Scenario: Claim changes before confirmation
- **WHEN** a confirmation fingerprint no longer matches the displayed claim
- **THEN** the workflow reports a conflict and does not confirm the changed assertion

### Requirement: Drive coordinates experiment writes and project knowledge writeback

Drive SHALL retain the v6 separation of engineering work, investigations, Variants and Runs, and route Experiment semantic writes through the dedicated writer. It SHALL consult roadmap/findings and complete scoped related-Experiment writebacks without expanding lifecycle authority. Variant creation remains before launch. After direct Experiment/Wiki maintenance, writers SHALL invoke `memon journal submit --files <relative-paths...>` once for the completed batch, never directly manipulating Journal files. Native CLI operations SHALL not require a duplicate manual record. New questions, conclusions and decisions SHALL enter Wiki and cite Experiment/Run evidence, not Journal.

#### Scenario: Approved successor decision
- **WHEN** an approved decision changes which Experiment owns future work
- **THEN** drive updates the roadmap and routes the affected old/new Experiment descriptions and scope through the writer before claiming the change complete

### Requirement: Warning authority remains restricted after digest retirement

Existing human-only warning resolution, reopening and deletion boundaries SHALL remain unchanged. Skills SHALL route supported warning content through the Experiment writer and SHALL NOT gain extra authority from the retirement of the digest skill.

#### Scenario: Integrity check finds an old warning
- **WHEN** a normal structural-lint-guided repair encounters an unresolved warning
- **THEN** the coordinator does not resolve it merely to complete the repair

### Requirement: Normal knowledge work does not consume or author Journal

All supported skills SHALL remove normal Journal reads, manual append instructions, digest cursor updates and event-window research synthesis. Research requests/decisions/questions SHALL route to Wiki and factual changes to their Experiment/Run source. Explicit debugging MAY read bounded diagnostic history. Report selectors that historically read Journal SHALL be preserved as text, not automatically executed for routine knowledge refresh.

#### Scenario: Resume a research task
- **WHEN** drive or a report writer gathers normal research context
- **THEN** it reads source artifacts and Wiki relationships rather than Journal history

### Requirement: Knowledge maintenance does not fabricate human confirmation

Agents SHALL preserve source provenance and existing human-only Wiki review permissions. Updating documents or recording an invocation SHALL NOT imply a scientific conclusion was independently checked or human-confirmed. Unimplemented per-claim evidence commands SHALL NOT be prescribed by installed skills.

#### Scenario: User approves an implementation
- **WHEN** the user approves code changes
- **THEN** the agent does not convert that approval into scientific conclusion verification

### Requirement: Structural lint replaces doctor without digest bookkeeping

Supported skills SHALL use structural lint and current source inspection rather than a doctor command, standalone doctor skill or digest sweep. Repairs SHALL preserve existing writer authority and conflict handling.

#### Scenario: Structural repair
- **WHEN** lint identifies a document structure problem
- **THEN** the source is repaired through its owning workflow without a Journal cursor or doctor invocation
