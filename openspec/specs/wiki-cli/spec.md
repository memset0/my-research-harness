# wiki-cli Specification

## Purpose
Defines the `memon wiki` command group through which agents and humans create, relocate, annotate, inspect, lint, and prune wiki pages without touching the dashboard.

## Requirements

### Requirement: `memon wiki` command group and addressing

`memon wiki <subcommand>` SHALL exist with exactly the subcommands `ls`, `show`, `create`, `move`, `set`, `review`, `commit`, `lint`, `backlinks`, `migrate-report`, `kinds`, `deprecate`, `undeprecate`, `delete`. The group SHALL NOT register `stale`, `data` or `components` subcommands: source-staleness is a Web projection (see the `ls` and `backlinks` requirements), and component execution is `memon components run`. Every subcommand SHALL accept `--project-root <p>` (defaulting to `cwd`) and `--format json|human` (default `json`); `ls` and `show` SHALL additionally accept `--format markdown`. Where a `<page>` argument is taken it SHALL accept a slug (primary) or a canonical `W<NNNN>` id; an unpadded id (`W7`) SHALL exit 2 `BAD_REQUEST`; an unknown page SHALL exit 4 `NOT_FOUND`. Error output SHALL be a single JSON object on stderr of the form `{"error":{"code":…,"message":…}}`.

#### Scenario: Slug addressing
- **GIVEN** page `W0004` with slug `vsa-debt`
- **WHEN** the user runs `memon wiki show vsa-debt --project-root .`
- **THEN** the output is identical to `memon wiki show W0004 --project-root .`

#### Scenario: Unknown page
- **WHEN** the user runs `memon wiki show nope --project-root .`
- **THEN** the command exits 4 with `{"error":{"code":"NOT_FOUND",…}}`

#### Scenario: Inspect installed kinds without a project
- **WHEN** the user runs `memon wiki kinds ls` or `memon wiki kinds show <kind>` with `--format human|json`
- **THEN** the command returns the shipped registry definitions without project discovery, central access, git or journal writes
- **AND** an unknown kind exits 2 with BAD_REQUEST

#### Scenario: Unregistered subcommands are rejected
- **WHEN** the user runs `memon wiki stale`, `memon wiki data` or `memon wiki components`
- **THEN** the command fails as an unknown command with a non-zero exit and reads or writes no Wiki file

### Requirement: `memon wiki show` prints one page

`memon wiki show <page> [--body-only]` SHALL print the page's summary fields, `diagnostics`, and `content`. `--body-only` SHALL print only the Markdown body after the frontmatter (human/markdown formats) or set `content` to that body (json).

#### Scenario: Show includes diagnostics
- **GIVEN** a page with a `WIKI_MISSING_SECTION` warning
- **WHEN** the user runs `memon wiki show <page>`
- **THEN** the output lists that diagnostic alongside the content

### Requirement: `memon wiki create` allocates an id and writes a template

`memon wiki create <kind> <slug> --title <T> [--description <D>] [--status S] [--date D] [--source A]... [--tag T]... [--language L] [--bundle]` SHALL: validate `kind` against the canonical list (exit 2 on an unknown kind), validate the slug regex and project-wide uniqueness (exit 9 `CONFLICT` when taken), validate `status` against the kind's vocabulary (exit 2 when invalid; default to the vocabulary's first value when omitted for a kind that requires one), require `--date` when the registry date policy requires it (including `meeting`; exit 2 when absent), allocate the next free `W<NNNN>` across all pages, and write `docs/wiki/<kind>/<slug>.md` (or `<slug>/README.md` with `--bundle`) containing the full frontmatter (including `description` when given), an H1 equal to the title, and an empty H2 for every recommended section of the kind. `created_at` and `updated_at` SHALL be the current time with offset. Output SHALL be the new page's summary including its absolute `path`. `--language <en|zh>` SHALL write the `language` field; the scaffolded H2s SHALL be the English recommended headings for every language; any other value SHALL exit 2.

#### Scenario: Create a finding
- **WHEN** the user runs `memon wiki create finding vsa-debt --title "VSA common-path debt" --status VERIFIED --source E0017`
- **THEN** `docs/wiki/finding/vsa-debt.md` exists with `id: W<next>`, `kind: finding`, `status: VERIFIED`, `sources: [E0017]`, and H2s `Claim`, `Evidence`, `Limits`
- **AND** stdout is the page summary with `stale: false`

#### Scenario: Slug already used in another kind
- **GIVEN** `docs/wiki/note/vsa-debt.md` exists
- **WHEN** the user runs `memon wiki create finding vsa-debt --title x`
- **THEN** the command exits 9 with `CONFLICT` and writes nothing

#### Scenario: Meeting without date
- **WHEN** the user runs `memon wiki create meeting weekly --title "Weekly"`
- **THEN** the command exits 2 with `BAD_REQUEST` mentioning `--date`

#### Scenario: Create a Chinese finding
- **WHEN** the user runs `memon wiki create finding kv-cache --title "KV cache 显存占用" --language zh --source E0017`
- **THEN** the page has `language: zh` and H2s `Claim`, `Evidence`, `Limits`

### Requirement: `memon wiki move` relocates a page

`memon wiki move <page> <kind>[/<slug>]` SHALL move the page file or bundle directory to the new kind directory (and new slug when given), rewrite `kind` (and `slug`-derived path) while keeping `id`, `created_at`, and every other frontmatter key, bump `updated_at`, and validate that the page's `status` is valid for the new kind (exit 2 when it is not; the caller passes `--status S` to set a valid one in the same operation). The target slug SHALL be unique (exit 9 otherwise). Output SHALL be the updated summary including old and new `path`.

#### Scenario: Reclassify a migrated note
- **GIVEN** `W0012` at `docs/wiki/note/kernel-questions.md`
- **WHEN** the user runs `memon wiki move W0012 question --status OPEN`
- **THEN** the file is at `docs/wiki/question/kernel-questions.md` with `kind: question`, `status: OPEN`, `id: W0012`, and `legacy_id` unchanged

#### Scenario: Status incompatible with target kind
- **GIVEN** a `finding` page with `status: VERIFIED`
- **WHEN** the user runs `memon wiki move <page> bottleneck` without `--status`
- **THEN** the command exits 2 and the file is unchanged

### Requirement: `memon wiki set` edits frontmatter with an optimistic lock

`memon wiki set <page> [--status S] [--title T] [--description D] [--date D] [--add-source A]... [--rm-source A]... [--add-tag T]... [--rm-tag T]... [--language L] [--expected-mtime <ms>]` SHALL apply only the requested frontmatter changes, preserve the body byte-for-byte, preserve unknown keys, bump `updated_at`, and write atomically. When `--expected-mtime` is given and differs from the on-disk mtime the command SHALL exit 9 `CONFLICT` with the current mtime in the error. At least one change flag SHALL be required (exit 2 otherwise). Invalid `status` for the page's kind SHALL exit 2. `--language <en|zh>` SHALL set the `language` field and counts as a change flag; any other value SHALL exit 2.

#### Scenario: Mark a finding retracted
- **WHEN** the user runs `memon wiki set vsa-debt --status RETRACTED`
- **THEN** the frontmatter has `status: RETRACTED`, a newer `updated_at`, and the body is unchanged

#### Scenario: Stale expected mtime
- **WHEN** the user runs `memon wiki set vsa-debt --add-tag x --expected-mtime 1`
- **THEN** the command exits 9 with `CONFLICT` and the file is unchanged

#### Scenario: Switch a page to Chinese
- **WHEN** the user runs `memon wiki set vsa-debt --language zh`
- **THEN** the frontmatter has `language: zh`, a newer `updated_at`, and the body is unchanged

### Requirement: `memon wiki lint` reports diagnostics

`memon wiki lint [page] [--strict]` SHALL print every diagnostic for the addressed page (or all pages) grouped by page, plus project-level diagnostics (`WIKI_SLUG_DUPLICATE`, `WIKI_ID_DUPLICATE`). Exit SHALL be 0 unless `--strict` is set and at least one `error` severity diagnostic exists, in which case exit 1.

#### Scenario: Strict lint with an error
- **GIVEN** a page missing `title`
- **WHEN** the user runs `memon wiki lint --strict`
- **THEN** the command exits 1 and lists `WIKI_TITLE_MISSING`

### Requirement: `memon wiki review` exposes and records human verification

The review CLI SHALL expose log, diff, verify and unverify over Git-backed whole-Wiki review. Diff SHALL compare the newest reachable verification baseline (or empty tree) with committed HEAD under docs/wiki, not an individual page or uncommitted working-tree changes. Log SHALL expose commit marks; verification SHALL preserve human authority and ordered review. Per-page review ls SHALL remain unavailable. Unreachable marks and Git failures SHALL be reported rather than replaced by a false clean result.

#### Scenario: Whole-Wiki committed diff
- **WHEN** wiki review diff runs
- **THEN** it reports the committed Wiki changes since the verification baseline independently of dirty document edits

#### Scenario: No verification baseline
- **WHEN** committed Wiki files exist without a reachable review mark
- **THEN** diff compares against the empty tree without claiming human verification

### Requirement: `memon wiki commit` isolates wiki changes in their own commit

`memon wiki commit [<page>...] [-m <summary>] [--allow-empty-message] [--no-push]` SHALL stage every change under `docs/wiki/` (and nothing else), refuse with exit 2 when there is nothing to stage, refuse with exit 9 `MIXED_INDEX` when the index already contains non-wiki paths, and create a commit whose subject is `wiki: <summary>`; when `-m` is omitted the summary SHALL be generated from the touched pages (`update W0004, create W0009`). A page's `<stem>__assets/` directory is staged with it; Python files referenced by `script:` payloads that live outside `docs/wiki/` SHALL be committed separately. The command SHALL print the new SHA and the pages it touched. Given one or more `<page>` arguments (id or slug; an id need not exist on disk), the command SHALL instead stage and commit only the paths of those pages — single file or bundle directory, `<stem>__assets/`, and renames or deletions of the same id — leaving every other staged or unstaged change uncommitted and unmodified, without the `MIXED_INDEX` refusal. After a successful commit the command SHALL push the current branch to its configured upstream with a normal non-force push, including earlier unpushed local commits, unless `--no-push` is given; the output SHALL report the push result. When the push cannot complete (no upstream, rejected, or failed) the commit SHALL remain and the command SHALL exit 1 with `PUSH_FAILED` naming the new SHA and the reason, without pulling, rebasing, merging, or forcing.

#### Scenario: Only wiki paths are committed
- **GIVEN** modified `docs/wiki/finding/W0001-x.md` and modified `src/train.py`
- **WHEN** the user runs `memon wiki commit -m "tighten W0001 limits"`
- **THEN** a commit `wiki: tighten W0001 limits` containing only the wiki file is created and `src/train.py` stays unstaged

#### Scenario: Dirty index refuses
- **GIVEN** `src/train.py` is already staged
- **WHEN** the user runs `memon wiki commit`
- **THEN** the command exits 9 with `MIXED_INDEX` and creates no commit

#### Scenario: Commit only the agent's pages
- **GIVEN** modified `docs/wiki/roadmap/W0012-x.md`, modified `docs/wiki/note/W0013-y.md`, and staged `src/train.py`
- **WHEN** the agent runs `memon wiki commit W0012 -m "prune W0012 history"`
- **THEN** the new commit contains only the W0012 file, W0013 stays modified and unstaged, and `src/train.py` stays staged

#### Scenario: Commit is pushed
- **GIVEN** the branch tracks `origin/main` and holds one earlier unpushed commit
- **WHEN** the agent runs `memon wiki commit W0012`
- **THEN** both commits reach `origin/main` and the output reports `push.status: pushed`

#### Scenario: Rejected push keeps the commit
- **GIVEN** `origin/main` advanced since the last fetch
- **WHEN** the agent runs `memon wiki commit W0012`
- **THEN** the commit exists locally, the command exits 1 with `PUSH_FAILED` naming its SHA, and no pull, rebase, or force push happens

### Requirement: `memon wiki migrate-report` moves one Report into the wiki

`memon wiki migrate-report <R-id> <kind> [<slug>] [--status S]` SHALL: require an existing Report `R<NNNN>` (exit 4 otherwise); validate `kind` and `status` as `create` does (exit 2); default `<slug>` to the Report's slug and require project-wide uniqueness (exit 9); copy the Report file to `docs/wiki/<kind>/<slug>.md` or the Report bundle directory to `docs/wiki/<kind>/<slug>/` with all assets; allocate the next `W<NNNN>`; set `id`, `kind`, `legacy_id: R<NNNN>`, `status` (when the kind requires one), and `updated_at`; keep `title`, `created_at`, `selector`, and every other frontmatter key; delete the Report only after the wiki page is written and lints without `error`; and print the old path, the new path, and the pages or Markdown files that referenced the Report (`backlinks` result) so the caller can fix relative links. On any failure after copying, the copy SHALL be removed and the Report left untouched.

#### Scenario: Migrate a single-file report
- **GIVEN** `docs/reports/R0007-bf16-drift.md` with `title` and `selector`
- **WHEN** the user runs `memon wiki migrate-report R0007 finding --status TENTATIVE`
- **THEN** `docs/wiki/finding/bf16-drift.md` exists with `id: W<next>`, `kind: finding`, `legacy_id: R0007`, `status: TENTATIVE`, the original `title`/`selector`
- **AND** `docs/reports/R0007-bf16-drift.md` no longer exists

#### Scenario: Migrate a bundle
- **GIVEN** `docs/reports/R0011-kernel-map/` with `README.md`, `data/`, `views/`
- **WHEN** the user runs `memon wiki migrate-report R0011 showcase`
- **THEN** `docs/wiki/showcase/kernel-map/` contains the same relative files and only `README.md` frontmatter differs

#### Scenario: Lint error aborts before deleting
- **GIVEN** the migrated page would carry a `WIKI_*` error diagnostic
- **WHEN** the command runs
- **THEN** it exits non-zero, no wiki page remains, and the Report is untouched

#### Scenario: Backlinks for a legacy id
- **GIVEN** a Run README linking `../../docs/reports/R0007-bf16-drift.md`
- **WHEN** the user runs `memon wiki backlinks R0007`
- **THEN** that README path is listed under Markdown references

### Requirement: `memon wiki delete` removes a page

`memon wiki delete <page> [--force]` SHALL delete a single-file page, or a bundle directory containing only `README.md`; a bundle with other content SHALL require `--force` (exit 2 otherwise). Output SHALL list the removed paths.

#### Scenario: Bundle with assets needs --force
- **GIVEN** `docs/wiki/showcase/kernel-map/` containing `README.md` and `views/`
- **WHEN** the user runs `memon wiki delete kernel-map`
- **THEN** the command exits 2 and nothing is deleted
- **WHEN** the user runs `memon wiki delete kernel-map --force`
- **THEN** the directory is removed

### Requirement: `memon wiki deprecate` marks a page outdated

`memon wiki deprecate <page> --reason <R> [--superseded-by <W-id>] [--at <ISO>]` SHALL write the `deprecated` frontmatter object (default `at` = now with offset), validate `--superseded-by` resolves to an existing page (exit 4 otherwise), bump `updated_at`, and print the updated summary. `memon wiki undeprecate <page>` SHALL remove the object. `memon wiki ls` SHALL show `[deprecated]` on such pages in human/markdown formats and accept `--deprecated` / `--no-deprecated` filters; `ls` SHALL also print `deprecatedSections` when non-empty. Section-level deprecation is authored in the Markdown body directly (see wiki-store) and has no CLI command.

#### Scenario: Deprecate with successor
- **WHEN** the user runs `memon wiki deprecate W0004 --reason "superseded" --superseded-by W0012`
- **THEN** `W0004`'s frontmatter has `deprecated.at`, `deprecated.reason`, `deprecated.superseded_by: W0012`, and `memon wiki ls` shows `[deprecated]` on it

#### Scenario: Unknown successor
- **WHEN** the user runs `memon wiki deprecate W0004 --reason x --superseded-by W9999`
- **THEN** the command exits 4 and the file is unchanged

### Requirement: `code-review` is a reserved kind

`memon wiki create code-review …` and `memon wiki move <page> code-review` SHALL exit 2 with a message that code reviews are authored by `memon-write-code-review` until they are consolidated into the wiki; a `docs/wiki/code-review/` directory that exists anyway SHALL be discovered under the unknown-kind rules.

#### Scenario: Reserved kind rejected
- **WHEN** the user runs `memon wiki create code-review x --title t`
- **THEN** the command exits 2 and writes nothing

### Requirement: `memon wiki ls` lists declared page metadata

Wiki ls SHALL enumerate supported Wiki files and bundles, expose their declared metadata and relative paths, and support the registered kind, status, source and description filters/formats. It SHALL NOT resolve linked Run/Experiment/Hypothesis bodies or derive source-staleness or per-page human-review state. CLI --stale and --review filters SHALL remain unavailable; source resolution and viewer review projection belong to Web.

#### Scenario: Unavailable referenced artifact
- **WHEN** a Wiki page declares a source that cannot be read
- **THEN** native listing retains the declared source without reading its target or fabricating resolved staleness

### Requirement: `memon wiki backlinks` filters declared source references

Wiki backlinks SHALL select Wiki pages by their declared sources without resolving referenced targets or scanning other document bodies for links. The CLI SHALL NOT expose wiki stale; Web owns actual source-staleness projection.

#### Scenario: Declared source backlink
- **WHEN** a page declares an Experiment source whose body is unavailable
- **THEN** backlinks can return the declaring page without reading that Experiment or its Runs

### Requirement: `memon components run` executes a document's component blocks locally

`memon components run <document> [--id <id>]…` SHALL run inside the project (no central address), locate the executable component blocks of the given Markdown document (project-relative or absolute path inside the project), run every one or only the named ids, write each result to `<stem>__assets/<id>.json` per `component-execution`, print one JSON line per block (`{ id, status: "updated"|"unchanged"|"failed", path, durationMs, error? }`), and exit 0 only when every requested block succeeded (1 otherwise, 2 for a bad request such as an unknown id or a document without executable blocks when ids were named, 4 when the document does not exist). The CLI SHALL validate only that the function returned a JSON object; schema validation stays central. `memon wiki lint` SHALL keep structural-only component checks (`WIKI_COMPONENT_UNPINNED`, `COMPONENT_ID_DUPLICATE`) and the `--central` merge SHALL be removed with the API.

#### Scenario: Run one block
- **WHEN** `memon components run docs/wiki/note/W0004-x.md --id fid`
- **THEN** only `fid` executes and `docs/wiki/note/W0004-x__assets/fid.json` is written

#### Scenario: Unknown id
- **WHEN** `--id nope` names no executable block of the document
- **THEN** the command exits 2 and lists the executable ids
