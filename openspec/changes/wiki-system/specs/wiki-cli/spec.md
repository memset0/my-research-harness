## Purpose

Defines the `memon wiki` command group through which agents and humans create, relocate, annotate, inspect, lint, and prune wiki pages without touching the dashboard.

## ADDED Requirements

### Requirement: `memon wiki` command group and addressing

`memon wiki <subcommand>` SHALL exist with subcommands `ls`, `show`, `create`, `move`, `set`, `review`, `commit`, `lint`, `stale`, `backlinks`, `migrate-report`, `data`, `components`, `deprecate`, `undeprecate`, `delete`. Every subcommand SHALL accept `--project-root <p>` (defaulting to `cwd`) and `--format json|human` (default `json`); `ls` and `show` SHALL additionally accept `--format markdown`. Where a `<page>` argument is taken it SHALL accept a slug (primary) or a canonical `W<NNNN>` id; an unpadded id (`W7`) SHALL exit 2 `BAD_REQUEST`; an unknown page SHALL exit 4 `NOT_FOUND`. Error output SHALL be a single JSON object on stderr of the form `{"error":{"code":…,"message":…}}`.

#### Scenario: Slug addressing
- **GIVEN** page `W0004` with slug `vsa-debt`
- **WHEN** the user runs `memon wiki show vsa-debt --project-root .`
- **THEN** the output is identical to `memon wiki show W0004 --project-root .`

#### Scenario: Unknown page
- **WHEN** the user runs `memon wiki show nope --project-root .`
- **THEN** the command exits 4 with `{"error":{"code":"NOT_FOUND",…}}`

### Requirement: `memon wiki ls` lists and filters pages

`memon wiki ls [--kind K] [--status S] [--tag T] [--stale] [--review STATE] [--source A] [--no-description]` SHALL, with no filter, list every discovered wiki document file in the project — every kind directory including unknown kinds, both single-file and bundle forms — one entry per page, ordered by canonical kind then `updated_at` descending. Each entry SHALL carry the wiki list projection fields (same as `GET /api/wiki`, minus `mtime`) plus `path`, the project-relative path of the page's Markdown file (`docs/wiki/<kind>/<slug>.md` or `docs/wiki/<kind>/<slug>/README.md`). Filters SHALL combine conjunctively. `--review STATE` SHALL accept `VERIFIED|CHANGED_SINCE_VERIFY|UNVERIFIED`. `--source A` SHALL match pages whose `sources` reference artifact `A` by bare id, id-with-slug, or Variant form. In every format `ls` SHALL print each page's `path` and `description` (`null` when absent) with its title; `--no-description` SHALL suppress the description only. `--format markdown` SHALL render one H2 per kind with a table of `id | path | status | review | stale | updated_at | title | description`; `--format human` SHALL print one line per page as `<id>  <path>  [<status>] [<review>] [stale]  <title>` followed by an indented description line when present.

#### Scenario: Unfiltered listing is exhaustive
- **GIVEN** `docs/wiki/finding/a.md`, `docs/wiki/showcase/b/README.md`, and `docs/wiki/retro/c.md`
- **WHEN** the user runs `memon wiki ls`
- **THEN** exactly three entries are printed, with `path` values `docs/wiki/finding/a.md`, `docs/wiki/showcase/b/README.md`, `docs/wiki/retro/c.md`

#### Scenario: Description shown and suppressible
- **GIVEN** page `a` has `description: Why the C256 wrapper round-trips.` and page `c` has none
- **WHEN** the user runs `memon wiki ls --format human`
- **THEN** `a`'s line is followed by its description and `c` has no description line
- **WHEN** the user runs `memon wiki ls --format human --no-description`
- **THEN** no description lines are printed

#### Scenario: Filter by kind and status
- **GIVEN** three `bottleneck` pages, two `OPEN` and one `RESOLVED`
- **WHEN** the user runs `memon wiki ls --kind bottleneck --status OPEN`
- **THEN** exactly the two `OPEN` pages are printed

#### Scenario: Stale filter
- **WHEN** the user runs `memon wiki ls --stale`
- **THEN** only pages with `stale: true` are printed, each with a non-empty `staleSources`

### Requirement: `memon wiki show` prints one page

`memon wiki show <page> [--body-only]` SHALL print the page's summary fields, `diagnostics`, and `content`. `--body-only` SHALL print only the Markdown body after the frontmatter (human/markdown formats) or set `content` to that body (json).

#### Scenario: Show includes diagnostics
- **GIVEN** a page with a `WIKI_MISSING_SECTION` warning
- **WHEN** the user runs `memon wiki show <page>`
- **THEN** the output lists that diagnostic alongside the content

### Requirement: `memon wiki create` allocates an id and writes a template

`memon wiki create <kind> <slug> --title <T> [--description <D>] [--status S] [--date D] [--source A]... [--tag T]... [--bundle]` SHALL: validate `kind` against the canonical list (exit 2 on an unknown kind), validate the slug regex and project-wide uniqueness (exit 9 `CONFLICT` when taken), validate `status` against the kind's vocabulary (exit 2 when invalid; default to the vocabulary's first value when omitted for a kind that requires one), require `--date` for `meeting` (exit 2 when absent), allocate the next free `W<NNNN>` across all pages, and write `docs/wiki/<kind>/<slug>.md` (or `<slug>/README.md` with `--bundle`) containing the full frontmatter (including `description` when given), an H1 equal to the title, and an empty H2 for every recommended section of the kind. `created_at` and `updated_at` SHALL be the current time with offset. Output SHALL be the new page's summary including its absolute `path`.

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

`memon wiki set <page> [--status S] [--title T] [--description D] [--date D] [--add-source A]... [--rm-source A]... [--add-tag T]... [--rm-tag T]... [--expected-mtime <ms>]` SHALL apply only the requested frontmatter changes, preserve the body byte-for-byte, preserve unknown keys, bump `updated_at`, and write atomically. When `--expected-mtime` is given and differs from the on-disk mtime the command SHALL exit 9 `CONFLICT` with the current mtime in the error. At least one change flag SHALL be required (exit 2 otherwise). Invalid `status` for the page's kind SHALL exit 2.

#### Scenario: Mark a finding retracted
- **WHEN** the user runs `memon wiki set vsa-debt --status RETRACTED`
- **THEN** the frontmatter has `status: RETRACTED`, a newer `updated_at`, and the body is unchanged

#### Scenario: Stale expected mtime
- **WHEN** the user runs `memon wiki set vsa-debt --add-tag x --expected-mtime 1`
- **THEN** the command exits 9 with `CONFLICT` and the file is unchanged

### Requirement: `memon wiki lint` reports diagnostics

`memon wiki lint [page] [--strict]` SHALL print every diagnostic for the addressed page (or all pages) grouped by page, plus project-level diagnostics (`WIKI_SLUG_DUPLICATE`, `WIKI_ID_DUPLICATE`). Exit SHALL be 0 unless `--strict` is set and at least one `error` severity diagnostic exists, in which case exit 1.

#### Scenario: Strict lint with an error
- **GIVEN** a page missing `title`
- **WHEN** the user runs `memon wiki lint --strict`
- **THEN** the command exits 1 and lists `WIKI_TITLE_MISSING`

### Requirement: `memon wiki review` exposes and records human verification

`memon wiki review` SHALL have subcommands: `log` (every wiki commit in order with `sha`, `authoredAt`, `subject`, `pages`, `verified`, and `verifiedThrough`); `ls [--state VERIFIED|CHANGED_SINCE_VERIFY|UNVERIFIED]` (every page with its `review.state`, `unverifiedCommits` count, and `dirty`); `diff <page>` (the unified diff of the page file, or bundle directory, from `verifiedThrough` to the working tree - empty output and exit 0 when the page is `VERIFIED`; exit 4 for an unknown page); `verify <sha|next> [--note N]` (human; marks the commit, `next` resolves to the oldest unmarked wiki commit; exit 9 `REVIEW_ORDER` when an older commit is unmarked, exit 4 when there is nothing to verify); and `unverify <sha>` (removes that mark and all newer ones). `memon wiki ls --review STATE` and `memon wiki show` SHALL use the same derived `review` object. All subcommands SHALL exit 4 with `NOT_A_GIT_PROJECT` when the project root is outside a git worktree.

#### Scenario: Diff since verification
- **GIVEN** `W0004` verified through `c2` and edited in `c3` and again uncommitted
- **WHEN** the user runs `memon wiki review diff W0004`
- **THEN** the output is one unified diff from `c2` to the working tree for that file

#### Scenario: Verify next
- **GIVEN** wiki commits `c1` (verified) and `c2`, `c3` (unverified)
- **WHEN** the user runs `memon wiki review verify next`
- **THEN** `c2` is marked and the output names `c3` as the next candidate

#### Scenario: List fully verified pages
- **WHEN** the user runs `memon wiki review ls --state VERIFIED`
- **THEN** only pages whose every line and asset is covered by `verifiedThrough` are printed

### Requirement: `memon wiki commit` isolates wiki changes in their own commit

`memon wiki commit [-m <summary>] [--allow-empty-message]` SHALL stage every change under `docs/wiki/` (and nothing else), refuse with exit 2 when there is nothing to stage, refuse with exit 9 `MIXED_INDEX` when the index already contains non-wiki paths, and create a commit whose subject is `wiki: <summary>`; when `-m` is omitted the summary SHALL be generated from the touched pages (`update W0004, create W0009`). Collector scripts referenced by `memon-data` blocks live outside `docs/wiki/` and SHALL be committed separately. The command SHALL print the new SHA and the pages it touched.

#### Scenario: Only wiki paths are committed
- **GIVEN** modified `docs/wiki/finding/W0001-x.md` and modified `src/train.py`
- **WHEN** the user runs `memon wiki commit -m "tighten W0001 limits"`
- **THEN** a commit `wiki: tighten W0001 limits` containing only the wiki file is created and `src/train.py` stays unstaged

#### Scenario: Dirty index refuses
- **GIVEN** `src/train.py` is already staged
- **WHEN** the user runs `memon wiki commit`
- **THEN** the command exits 9 with `MIXED_INDEX` and creates no commit

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

### Requirement: `memon wiki stale` and `memon wiki backlinks` expose derived views

`memon wiki stale` SHALL print every page with `stale: true` together with `staleSources`. `memon wiki backlinks <artifact>` SHALL print every page whose `sources` reference `<artifact>` (Experiment id, id-with-slug, or Variant form, Hypothesis id, wiki id, or run directory name), ordered by `updated_at` descending. When `<artifact>` is an `R<NNNN>` Report id it SHALL additionally list every Markdown file under `docs/` and every run `README.md` containing a relative link that resolves to that Report's path, under a separate `markdownReferences` key. Both commands SHALL exit 0 even when empty.

#### Scenario: Backlinks for an experiment
- **GIVEN** `W0004` and `W0009` cite `E0017`
- **WHEN** the user runs `memon wiki backlinks E0017`
- **THEN** exactly those two pages are printed

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

### Requirement: `memon wiki components` reads the central registry

`memon wiki components ls|show <name>[@N]|migrate [page] [--dry-run]` SHALL obtain the registry from a central dashboard (`GET /api/wiki/components`, `GET /api/wiki/components/<name>[@N]`, `POST /api/wiki/components/migrate`) addressed by `--central <url>` or `MEMON_CENTRAL_URL`, authenticating with `MEMON_CENTRAL_TOKEN` or `-u`-style Basic credentials from the environment; the CLI artifact SHALL contain no component descriptors. Without a central address the commands SHALL exit 2 with a message naming the option. `ls` prints name, version, one-line description, and `outdated`; `show` prints the full descriptor (args, effect, useWhen, example, invalidExamples, fixtures); `migrate` sends each page body to central and writes back the returned body only when it differs. `memon wiki lint` SHALL run without central and SHALL then only report `WIKI_COMPONENT_UNPINNED` for component blocks; with `--central <url>` it SHALL additionally include central's component diagnostics.

#### Scenario: No central configured
- **WHEN** the user runs `memon wiki components ls` with no `--central` and no `MEMON_CENTRAL_URL`
- **THEN** the command exits 2 and names both ways to configure it

#### Scenario: Lint without central is structural only
- **GIVEN** a page with a `memon-data@1` block whose rows are ragged
- **WHEN** the user runs `memon wiki lint`
- **THEN** no `WIKI_DATA_BLOCK_INVALID` is reported
- **WHEN** the user runs `memon wiki lint --central http://localhost:3737`
- **THEN** `WIKI_DATA_BLOCK_INVALID` is reported
