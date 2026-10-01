# memon-wiki-skill Specification

## Purpose
Defines the bundled `memon-wiki` skill: how an agent maintains a project's wiki from inside the project root or from the harness repo through an sshfs mount, how it anchors every page to Experiment evidence, where its authority ends (human review), and how it feeds harness-improvement candidates back through `harness-feedback` pages.

## Requirements

### Requirement: The skill detects in-project versus mounted operation

Before any other step the skill SHALL resolve the project path `P` (an explicit user-given path, else `cwd`) and run `findmnt -T "$P" -o FSTYPE -n`. When the result is `fuse.sshfs` the skill SHALL derive `user@host` and the remote project root from `findmnt -T "$P" -o SOURCE,TARGET -n` plus the path of `P` relative to the mount target, and SHALL run every `memon` command as `ssh <user@host> 'cd <remote root> && memon --project-root . …'` while reading and writing page files through the local mount path. Otherwise the skill SHALL run `memon --project-root "$P" …` locally. The skill SHALL state the detected mode and, in mounted mode, the remote root to the user before continuing. The skill SHALL NOT parse `LOCAL.md` or any other prose file to find hosts.

#### Scenario: Mounted project
- **GIVEN** the agent runs from the harness repo and the user names `mounted/cluster-a/project-a`
- **WHEN** the skill starts
- **THEN** it reports mounted mode with the derived `user@host` and remote root
- **AND** its FS-version preflight is executed through `ssh`

#### Scenario: In-project
- **GIVEN** the agent's `cwd` is a project root on a local filesystem
- **WHEN** the skill starts
- **THEN** it reports in-project mode and runs `memon --project-root .` locally

### Requirement: The skill follows preflight and CLI-issue protocols

After mode detection the skill SHALL run `memon --format json fs-version check` through the selected channel and branch per `../PREFLIGHT.md`; it SHALL follow the shared CLI-issue handoff for every `memon` invocation.

#### Scenario: Behind project stops
- **GIVEN** the project marker is behind the running memon
- **WHEN** the skill runs preflight
- **THEN** it stops and directs the user to `memon-migrate-fs` without writing any page

### Requirement: Every claim is anchored to Experiment evidence

The skill SHALL treat Experiment Results, Variant rows, and Run READMEs as the only sources of factual truth. It SHALL read numbers and outcomes from `memon experiment doc render <id> results`, `memon experiment results summary`, or Run READMEs at authoring time, never from memory or from other wiki pages. Every factual statement in a page body SHALL name the Experiment, Variant (`E<NNNN>/V<NNNN>` form preferred), or run directory it comes from, and `sources` SHALL list exactly those identifiers. Statements that cannot be traced to Experiment data SHALL be written as interpretation, and a `finding` containing such statements SHALL keep `status: TENTATIVE`. The skill SHALL set `status: VERIFIED` only when every claim in the page reproduces from the cited Results. Existing wiki pages MAY be cited as context but SHALL NOT be the sole evidence for a `finding`. The skill SHALL NOT edit Experiment bundles.

#### Scenario: Promoting a conclusion
- **WHEN** the user asks to record a verified conclusion from `E0017`
- **THEN** the skill reads the Results, creates a `finding` citing `E0017/V<NNNN>` rows and run directories, writes each number next to its source identifier, and sets `VERIFIED` only if every claim reproduces

#### Scenario: Claim without data stays tentative
- **WHEN** the user asserts a conclusion for which no Experiment Results exist yet
- **THEN** the page is written with `status: TENTATIVE`, the assertion marked as interpretation, and the user is told which Experiment would verify it

### Requirement: Review is a human boundary and the agent commits wiki changes separately

The skill SHALL never run `memon wiki review verify|unverify`, never write `.memon/wiki-review.csv`, and never call `POST|DELETE /api/wiki/review/*`. After every batch of wiki edits the skill SHALL create a separate commit with `memon wiki commit -m "<summary>"` (through `ssh <host>` in mounted mode) so that each wiki change is individually verifiable; it SHALL commit collector scripts and other non-wiki files in their own commits. The closing message SHALL name the new wiki commit SHA(s) and, for every touched page, its `review.state` afterwards.

#### Scenario: Rework after verification
- **GIVEN** `W0004` is `VERIFIED`
- **WHEN** the user asks the agent to tighten its Limits section
- **THEN** the skill edits the page, runs `memon wiki commit`, and the closing message states the page is now `CHANGED_SINCE_VERIFY` with the new commit SHA and asks the user to verify it

#### Scenario: Skill text contains no verify command
- **WHEN** a reader greps `SKILL.md` for `review verify` or `/api/wiki/review`
- **THEN** there are no matches except the sentence forbidding them

### Requirement: The agent trusts documents by default and consults review state on conflict

The skill (and, by one shared sentence, `memon-write-experiment-doc` and `memon-drive`) SHALL treat wiki pages and Experiment documents as trustworthy by default. When two documents contradict each other, or a document contradicts fresh Experiment data, the skill SHALL run `memon wiki review ls` / `memon wiki review diff <page>` and prefer, in order: content whose lines are `VERIFIED`, then content in `CHANGED_SINCE_VERIFY` pages outside their `unverifiedRanges`, then `UNVERIFIED` content. When that ordering does not settle the conflict, the skill SHALL stop and ask the user, quoting both passages and their review states, rather than choosing.

#### Scenario: Verified passage wins
- **GIVEN** `W0001` (VERIFIED) states a 20% gain and `W0009` (UNVERIFIED) states 12% for the same Variant
- **WHEN** the skill needs the number
- **THEN** it uses 20%, notes the conflict, and flags `W0009` for correction

#### Scenario: Both unverified
- **GIVEN** two `UNVERIFIED` pages that contradict each other
- **WHEN** the skill needs the number
- **THEN** it asks the user with both passages quoted and their review states

### Requirement: The skill authors pages by kind

The skill SHALL choose the kind with the user (or infer it from an unambiguous request) using `references/page-kinds.md`; create pages only through `memon wiki create` and always pass `--description` with a one-to-three-sentence plain-text summary; keep `description` accurate whenever the body changes materially (`memon wiki set --description`); edit bodies by writing the Markdown file; prefer `memon wiki set` for frontmatter-only changes; run `memon wiki lint <page>` before handoff and resolve every `error`; and when updating an existing page preserve prior claims or explicitly mark corrections. For `meeting` pages the skill SHALL record decisions and action items as separate lists and cite the Experiments discussed in `sources`. For `showcase` pages the skill SHALL state how to reproduce each shown artifact.

#### Scenario: Recording a meeting
- **WHEN** the user pastes meeting notes and a date
- **THEN** the skill creates `meeting/<date>-<slug>.md` with `date`, fills Attendees/Notes/Decisions/Action items, and sets `sources` to the Experiments discussed

### Requirement: The skill migrates Reports editorially on request

When asked to migrate a Report, the skill SHALL run `memon wiki migrate-report <R-id> <kind> [<slug>]`, reorganise the body into the kind's recommended sections without dropping content, derive `sources` from the Experiments, Variants, and runs the Report cited, run `memon wiki backlinks <R-id>` and fix every listed Markdown link so it targets the new page path, run lint, and hand the page over as `UNVERIFIED`. The skill SHALL migrate one Report per invocation unless the user explicitly asks for a batch, and SHALL never migrate a Report the user did not name.

#### Scenario: Migrate one report
- **WHEN** the user asks to move `R0007` into the wiki as a finding
- **THEN** the skill runs `migrate-report`, restructures the page, fixes the listed links, and reports the page id and its `UNVERIFIED` state

### Requirement: Every task ends with the harness-feedback step

After completing the requested wiki work the skill SHALL perform a harness-feedback step: review whether the task exposed a missing convention, a repeated manual operation, content the dashboard cannot present, or a CLI gap. For each such item it SHALL create or update a `harness-feedback` page (`status: PROPOSED`) with Motivation and Proposal sections, then tell the user in Chinese which candidates exist and that they can be turned into an OpenSpec change in the harness repo. When nothing qualifies it SHALL say so in one sentence. The skill SHALL NOT modify the harness repo, SHALL NOT run `/opsx:propose`, and SHALL NOT set a `harness-feedback` status other than `PROPOSED`.

#### Scenario: Gap found
- **GIVEN** the task needed a page kind that does not exist
- **WHEN** the skill finishes
- **THEN** a `harness-feedback` page with `status: PROPOSED` describes the missing kind
- **AND** the closing message names it and offers the OpenSpec route

#### Scenario: No gap
- **WHEN** the task completed with existing conventions
- **THEN** the closing message states in one sentence that no harness feedback was recorded

### Requirement: Skill index and preflight docs name the wiki

`packages/skills/README.md` SHALL list `memon-wiki` in the skill index and files-written table (write scope: wiki pages via `memon wiki` and direct Markdown edits; never Experiment bundles, Reports, review fields, the journal cursor, or legacy `docs/digests/` files, which only the reviewed v7 migration converts; a `digest`-kind Wiki page is an ordinary Wiki page) and SHALL describe the wiki forms next to the Report forms. `packages/skills/PREFLIGHT.md` SHALL add `docs/wiki/` to the protected-file lists.

#### Scenario: README updated
- **WHEN** a reader greps `packages/skills/README.md` for `memon-wiki`
- **THEN** it appears in both tables, and `memon-write-report` still appears

### Requirement: Outdated content is deprecated, not deleted

When updating a page whose earlier claims no longer hold, the skill SHALL keep the earlier text and mark it: a whole page via `memon wiki deprecate … --reason … [--superseded-by …]`, a section via a `> [!DEPRECATED] since <date>: <reason>` blockquote directly under its heading. The skill SHALL NOT delete or rewrite historical claims to make a page look current, and SHALL NOT run `memon wiki delete` on a page that has ever been reviewed unless the user explicitly asks for deletion by id.

#### Scenario: Superseded section
- **WHEN** new Results contradict the `## Throughput` section of a `VERIFIED` page
- **THEN** the skill adds a new section with the current numbers and marks `## Throughput` with a `[!DEPRECATED]` blockquote naming the superseding Variant, leaving its text intact

### Requirement: Component authoring lives in `memon-components`, not in other skills

The harness SHALL bundle a skill `packages/skills/memon-components/SKILL.md` (shipped to projects by `install-skills`; no harness-repo copy) that is the only skill describing how to write component blocks. It SHALL contain a generated section, delimited by markers, holding one table row per registered component type at its latest version (type, version, one-line description, when to use, payload fields with type/required/meaning, a copyable example) produced by `scripts/component-docs.mjs` from the descriptor directories; the skills build SHALL fail when that section is stale. The skill SHALL teach the declaration syntax, static versus executable payloads, the `script`/`code` reuse rule (inline by default; extract a `.py` only when reused elsewhere or unusually long), the `__assets` cache and `memon components run`, and SHALL NOT tell the agent to query a CLI or HTTP API for field lists. `memon-author-components` SHALL be retired through `retired-skills.json`. `memon-wiki`, `memon-write-experiment-doc`, `memon-run-experiment`, and `memon-write-code-review` SHALL each contain exactly one routing sentence naming `memon-components` and SHALL NOT restate component rules.

#### Scenario: Other skills only route
- **WHEN** a reader greps `packages/skills/memon-wiki/SKILL.md` for `memon-components` and for `views:`
- **THEN** the first matches exactly once and the second not at all

#### Scenario: Skill table is generated
- **WHEN** a descriptor's `description` changes and `scripts/component-docs.mjs --check` runs
- **THEN** the check fails until `--write` regenerates the table, which then lists every registered type at its latest version

#### Scenario: No component fits
- **GIVEN** the agent needs an interactive 3-D plot that no registered component renders
- **WHEN** it follows the skill
- **THEN** it writes an `embed@1` block (static HTML or an executable payload returning `data`) and creates a `harness-feedback` page proposing the component

### Requirement: Component authoring constrains which images a figure may use

The `memon-components` skill SHALL tell the agent to keep a figure's image beside the containing document (normally in its `<stem>__assets/` directory) with a descriptive kebab-case file name, to preserve user-provided image bytes unless a transformation is requested, to ask before downloading or inserting any image the user did not supply or explicitly authorize, and never to hotlink. Agent-drawn SVG SHALL be self-contained: no scripts, event handlers, `foreignObject`, external fonts, or external image/resource references. The `description` SHALL be grounded in the actual image (its labels, relationships, axes, encodings) or the user's supplied description; when the agent cannot establish what an image shows it SHALL ask instead of inventing a description.

#### Scenario: User supplies a reference image
- **WHEN** the user asks to insert an image they provided
- **THEN** the agent saves its original bytes beside the document, writes the block with an accurate caption and description, and verifies the rendered page

#### Scenario: Drawing an explanatory SVG
- **WHEN** an agent creates a diagram for a page
- **THEN** it saves a self-contained SVG beside the document and describes its actual nodes, labels, and relationships in the block

#### Scenario: External image is not authorized
- **WHEN** an agent finds a potentially useful image that the user has not supplied or authorized
- **THEN** it asks before downloading or inserting it

#### Scenario: Skill states the rule
- **WHEN** a reader greps `packages/skills/memon-components/SKILL.md` for `hotlink` and for `foreignObject`
- **THEN** each matches at least once

### Requirement: Pages are written in their declared language

The skill SHALL write new pages in English unless the user asks for Chinese for that page or states it as a preference for the task, in which case the page SHALL be created with `language: zh` and written in Chinese (title, description, prose, table text) while every section heading stays in English. Updates SHALL keep an existing page's declared language; a conversation held in Chinese SHALL NOT by itself switch a page's language. A language switch SHALL happen only on request, as a faithful whole-page rewrite that changes no claims or sources, together with the `language` field, in one wiki commit. In Chinese prose the skill SHALL keep in English: artifact identifiers, paths, code, column, Variant, metric and config names, method, model and library names, acronyms, and technical terms with no standard unambiguous Chinese rendering; frontmatter enums and slugs SHALL stay unchanged.

#### Scenario: User asks for a Chinese page
- **WHEN** the user asks for a finding about KV-cache memory "用中文写"
- **THEN** the page is created with `--language zh`, keeps the English section headings `Claim`, `Evidence`, `Limits`, and keeps terms such as `KV cache`, `FP8`, and `E0017` in English

#### Scenario: Updating an English page from a Chinese conversation
- **GIVEN** an English page and a user who discusses it in Chinese without asking for a language change
- **WHEN** the skill records the agreed update
- **THEN** the update is written in English and `language` is unchanged

### Requirement: Agents follow and maintain a page's maintenance rules

The skill SHALL document the maintenance rules section: fixed English name `Maintenance rules for agents` on every page, last H2 of the page, list items only, one dated requirement per item, agent-specific requirements nested under a scope item worded `- Only for <agent>:`, and related rules optionally grouped under topic items ending with a colon at any depth. Every agent SHALL read a page's rules before editing it and follow those that apply to it, preserving rules scoped to other agents. When the owner puts the agent into maintenance mode for a page, the agent SHALL record every long-term requirement the owner states in that section without asking, SHALL edit or remove a rule the owner replaces or withdraws instead of adding a conflicting item, SHALL NOT record one-off instructions, and after each change SHALL tell the owner exactly which items were added, removed, or changed, quoting them. Outside maintenance mode a standing requirement the owner states explicitly about how a page is maintained SHALL be recorded and reported the same way. The section SHALL stay compact: before adding a rule the agent SHALL fold it into an existing rule it refines or duplicates, and SHALL merge duplicate or overlapping rules and replace several specific rules with one general rule when the general rule requires everything they did; compression SHALL NOT drop or weaken a requirement without the owner's word, and every merge SHALL be reported with the replaced items quoted. A recurring error pattern the agent identifies (an incident, a costly wrong assumption, a tooling trap) SHALL enter the section only after the owner authorizes it: the agent SHALL propose the exact item, its scope and topic, and the evidence, SHALL add it dated with the authorization day only on approval, and SHALL record nothing for a declined proposal. An error pattern the owner states as a rule is a requirement and is recorded directly.

#### Scenario: Owner states a standing requirement in maintenance mode
- **GIVEN** the agent is in maintenance mode for `W0012`
- **WHEN** the owner says that from now on Oh My Pi must never cancel an allocation
- **THEN** a dated item is added under `- Only for Oh My Pi:` in W0012's `## Maintenance rules for agents` and the agent reports the added item verbatim

#### Scenario: Owner withdraws a rule
- **WHEN** the owner says an existing rule no longer applies
- **THEN** the item is removed, no deprecated marker is left in the section, and the agent reports the removed item verbatim

#### Scenario: New requirement refines an existing rule
- **GIVEN** the rules contain `- Validate every 100 steps. (2026-09-13)`
- **WHEN** the owner says validation must also run at step 0
- **THEN** that item becomes one rule covering both requirements, no second validation item is added, and the agent reports the change with the old item quoted

#### Scenario: Agent-identified error pattern awaits authorization
- **GIVEN** two concurrent jobs failed because they shared a fixed rendezvous port
- **WHEN** the agent identifies the pattern
- **THEN** it proposes the quoted rule with its scope and evidence and leaves the section unchanged until the owner approves

#### Scenario: Declined error pattern
- **WHEN** the owner declines a proposed error-pattern rule
- **THEN** nothing is recorded in the section

### Requirement: Wiki changes are committed per batch of the agent's own pages and pushed

The skill SHALL commit only when a batch of page changes reaches a stopping point: while an experiment the pages depend on is still running or pending, or a question to the user is awaiting an answer that would change the pages, it SHALL leave the edits uncommitted unless the user asks for a version to be committed now. At a stopping point it SHALL commit that batch of related page changes as one `memon wiki commit <page>...` naming exactly the pages the agent changed in that batch, SHALL commit unrelated batches separately, SHALL never include pages or files changed by others, and SHALL rely on the command's automatic push. The handoff SHALL report each commit's SHA and push result; on `PUSH_FAILED` the skill SHALL report the SHA and reason and SHALL NOT fetch, rebase, merge, or force on its own.

#### Scenario: Finding plus roadmap
- **WHEN** the agent records a finding W0024 and links it from roadmap W0012 in one task
- **THEN** it runs one `memon wiki commit W0024 W0012 -m ...` and reports the pushed SHA

#### Scenario: Another agent's edit in the tree
- **GIVEN** W0013 was modified by another agent in the same working tree
- **WHEN** this agent commits its W0012 change
- **THEN** W0013 is not part of the commit

#### Scenario: Work waits on an experiment
- **GIVEN** the agent updated W0012 and the result it will cite is still being produced
- **WHEN** it hands off to wait for the experiment
- **THEN** the edit stays uncommitted and the handoff says so and why

#### Scenario: User asks for a snapshot
- **WHEN** the user asks to commit the current version while questions remain open
- **THEN** the agent commits and pushes the pages it changed

### Requirement: `memon-wiki` is bundled in `packages/skills`

A skill SHALL exist at `packages/skills/memon-wiki/SKILL.md` with `name: memon-wiki`, no `disable-model-invocation: true`, a `references/page-kinds.md` describing every canonical kind's purpose, status vocabulary, required frontmatter, recommended sections, and authoring guidance, and a `references/html-bundle.md` carrying the static bundle contract adapted to the wiki asset route. The skill SHALL exist only under `packages/skills/` and reach projects through `memon install-skills`; the harness repository SHALL NOT carry a copy. `memon-write-report` SHALL remain bundled and unchanged. The skill body SHALL be English; user-facing dialogue examples SHALL be Chinese inside block quotes.

#### Scenario: Skill present only in the package
- **WHEN** a reader lists the harness repository
- **THEN** `packages/skills/memon-wiki/SKILL.md` exists and `.claude/skills/memon-wiki/` does not
- **AND** `packages/skills/memon-write-report/` still exists
