# v4 → v5 migration

## Background / Why

memon `FS_CONVENTION_VERSION` bumped from `4` to `5` to introduce two
coupled changes (see `openspec/changes/migrate-fs-v4-to-v5/`):

1. **Experiment doc is now a folder.** Each experiment moves from a
   single file at `<projectRoot>/docs/experiments/E<NNNN>-<slug>.md` to
   a folder with a README inside:
   `<projectRoot>/docs/experiments/E<NNNN>-<slug>/README.md`. The folder
   becomes a sanctioned local scratch space for files strongly tied to
   the experiment (smoke-run scripts, sbatch templates, multi-launch
   helpers) that don't belong in the main repo's `scripts/` tree.
2. **Run README section discipline tightens.** The post-v5 canonical
   section list shrinks to four entries: `Motivation` (optional),
   `Setup` (required), `Result` (required), `Artifacts` (required). The
   sections `Method`, `Conclusion`, and `Caveats` are now FORBIDDEN on
   the run side; each one's content has a designated relocation home:
   - `Method` content → fold into the run's `## Setup` (per-run
     methodology refinements are part of setup).
   - `Conclusion` content → fold into the run's `## Result` (per-run
     findings).
   - `Caveats` content → relocate to the parent experiment doc's
     `## Caveats` (cross-run interpretation limits).

The parser surfaces `RUN_HAS_METHOD` / `RUN_HAS_CONCLUSION` /
`RUN_HAS_CAVEATS` parse warnings for any non-empty forbidden heading
post-v5; the migration script in this guide halts on those warnings
and asks the user to resolve before completing the bump.

The migration script also surfaces `UNKNOWN_H2_SECTION` warnings for
any non-canonical H2 heading on either side (exp doc OR run README) so
custom user-added sections are auditable rather than silently accepted.

## Detection

Run these commands from `<projectRoot>`. The project is on v4 (needs
this migration) when all three return success / matches:

```sh
# 1. The on-disk marker is at v4.
test "$(jq -r .fs_convention_version .memon/version.json)" = "4" && echo OK

# 2. At least one legacy file-form exp doc exists at the top level.
find docs/experiments -maxdepth 1 -name 'E*.md' -type f | head -1

# 3. The new folder-based layout has not yet been adopted for any exp.
test -z "$(find docs/experiments -mindepth 1 -maxdepth 1 -type d -name 'E*')" && echo OK
```

A partially-migrated project (some `.md` files moved into folders,
others not) is detected by mixing the second and third checks: at
least one match for each. The migration script tolerates partial
state and only moves the still-flat `.md` files.

## Diff (v4 → v5)

### File 1: `<projectRoot>/docs/experiments/E*.md` (bulk move)

For each top-level `E<NNNN>-<slug>.md` file under `docs/experiments/`,
create a same-named folder (without the `.md` suffix) and move the file
inside as `README.md`. Pre-existing folder name collision is a halt
condition (`MIGRATION_COLLISION`).

```before
docs/experiments/E0001-foo.md
docs/experiments/E0002-bar.md
```

```after
docs/experiments/E0001-foo/README.md
docs/experiments/E0002-bar/README.md
```

Execute as a single shell loop (git mode):

```bash
set -e
for f in docs/experiments/E*-*.md; do
  [ -e "$f" ] || continue
  base="${f%.md}"
  if [ -d "$base" ]; then
    echo "MIGRATION_COLLISION: $base already exists as a folder; resolve manually before retrying" >&2
    exit 1
  fi
  mkdir -p "$base"
  git mv "$f" "$base/README.md"
done
echo OK
```

For non-git mode, replace `git mv` with `mv`. The migrate-fs runtime
selects the right form based on the project root's git status.

### File 2: `<projectRoot>/<runDir>/README.md` (run-doc section scan)

For each run dir's `README.md`, parse via the v5 parser and surface any
of `RUN_HAS_METHOD` / `RUN_HAS_CONCLUSION` / `RUN_HAS_CAVEATS` /
`UNKNOWN_H2_SECTION` warnings with non-empty body. The script HALTS on
each such finding, showing the snippet AND the heading-specific
relocation target, and waits for the user to either:

(a) Manually relocate the content per the hint, then re-run the
    migration step.
(b) Confirm the warning is acceptable as-is (the heading stays; the
    warning surfaces in `parse_warnings` going forward).

```before
## Method
We swept LR over [1e-4, 3e-4, 1e-3] using torch.optim.

## Conclusion
LR=3e-4 converged fastest.

## Caveats
Only one seed; results may vary.
```

```after  (user's resolution shown — relocated per hint)
## Setup
... existing setup ...

Methodology: swept LR over [1e-4, 3e-4, 1e-3] using torch.optim.

## Result
... existing result ...

LR=3e-4 converged fastest.
```
(And `## Caveats` content moves to the parent experiment doc's
`## Caveats` section — manual edit of the exp README in its new folder.)

Empty forbidden headings (heading present, body empty) are auto-cleaned
without prompting the user: the empty `## Method` / `## Conclusion` /
`## Caveats` heading lines get deleted from the run README.

Empty `## Notes` (or any other custom H2 with no body) is also
auto-cleaned. Non-empty custom H2 surfaces an `UNKNOWN_H2_SECTION`
prompt with three options: rename to a canonical heading, drop the
content, or accept the warning.

Run-doc scan command (executable inline):

```bash
set -e
find . -mindepth 2 -name 'README.md' -path '*/[a-z0-9]*-[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]/README.md' | while read -r f; do
  node -e "
    const fs = require('node:fs');
    const { parseReadme } = require('@memon/core');
    const p = parseReadme(fs.readFileSync(process.argv[1], 'utf8'));
    for (const w of p.parseWarnings) {
      if (/RUN_HAS_(METHOD|CONCLUSION|CAVEATS)|UNKNOWN_H2_SECTION/.test(w.message) && w.severity === 'warning') {
        console.log(process.argv[1] + ':', w.message);
        process.exit(1);
      }
    }
  " "$f"
done
echo OK
```

(In practice `memon-migrate-fs` runs this internally via
`parseReadme` and surfaces the snippet inline to the user — no node
one-liner needed.)

### File 3: `<projectRoot>/.memon/version.json` (version bump)

```before
{
  "fs_convention_version": 4,
  "installed_at": "...",
  "last_migrated_at": "..."
}
```

```after
{
  "fs_convention_version": 5,
  "installed_at": "...",
  "last_migrated_at": "<ISO8601 with offset for this migration commit>"
}
```

The `installed_at` field stays unchanged; only `fs_convention_version`
and `last_migrated_at` are touched.

## Target State (v5 Summary)

```
<projectRoot>/
├── .memon/
│   └── version.json                  # fs_convention_version: 5
├── docs/
│   ├── experiments/
│   │   ├── E0001-foo/                # NEW: folder per experiment
│   │   │   ├── README.md             # the exp doc body (frontmatter + sections)
│   │   │   └── (user-owned scratch — smoke scripts, sbatch templates, etc.)
│   │   ├── E0002-bar/
│   │   │   └── README.md
│   │   └── ...
│   ├── hypotheses.md                 # unchanged
│   ├── journal.md                    # unchanged
│   ├── digests/                      # unchanged
│   └── reports/                      # unchanged
└── <run dirs>/                       # unchanged location
    └── README.md                     # 4 canonical H2 sections post-v5:
                                      #   ## Motivation (optional)
                                      #   ## Setup       (required, rolls in methodology)
                                      #   ## Result      (required, rolls in conclusions)
                                      #   ## Artifacts   (required)
```

Run-doc bodies that contained `## Method` / `## Conclusion` / `## Caveats`
content before the migration have either been relocated per the
relocation hints OR have been explicitly accepted by the user (the
heading stays, surfaces a parse warning going forward).

## Verification

```bash
set -e
# 1. Marker bumped to v5.
test "$(jq -r .fs_convention_version .memon/version.json)" = "5" && echo OK

# 2. No legacy .md files remain at the top level of docs/experiments/.
test -z "$(find docs/experiments -maxdepth 1 -name 'E*.md' -type f)" && echo OK

# 3. Every E<NNNN>-<slug> folder has a README.md inside.
find docs/experiments -mindepth 1 -maxdepth 1 -type d -name 'E*-*' | while read -r d; do
  test -f "$d/README.md" || { echo "MISSING_README: $d has no README.md" >&2; exit 1; }
done
echo OK

# 4. `memon experiment ls` parses cleanly (no LEGACY_LAYOUT warnings).
memon experiment ls --project-root . --format json | jq -e '.experiments | all(.parseWarnings | all(.message | contains("LEGACY_LAYOUT") | not))' >/dev/null && echo OK
```

All four checks SHALL print `OK` on a successful migration.

## Rollback Notes

If the migration cannot complete (e.g. a `MIGRATION_COLLISION` halts
the move loop, or a run-doc forbidden-section content needs more time
to resolve), use the following:

**Git mode** — revert the most recent migration commit:

```bash
git reset --hard HEAD~1
```

The commit message of that commit is fixed:
`chore(memon): migrate FS convention v4 -> v5` (ASCII arrow `->`, not
Unicode `→`). No body, no trailing period.

**Non-git mode** — extract the pre-migration tarball:

```bash
tar -xf .memon/backups/post-v5-<timestamp>.tar.gz -C .
```

The tarball is written by `memon-migrate-fs` before applying any
filesystem mutations.

The commit message is fixed:
`chore(memon): migrate FS convention v4 -> v5`

## Edge Cases

- **Pre-existing folder collision** (`docs/experiments/E<NNNN>-<slug>/`
  exists as a directory before the migration). The file-move loop halts
  with `MIGRATION_COLLISION` naming both the file and the folder. The
  user resolves manually — typically by inspecting what's already inside
  the folder, merging or moving content as needed, then re-running the
  migration step.

- **User-added custom frontmatter fields** on the exp doc (e.g.
  `priority: high`, `owner: alice`). The migration does NOT touch
  frontmatter — only the file location changes. Any custom fields are
  preserved verbatim through the `git mv`.

- **User mid-edit (working tree dirty)**. Handled at the runtime layer:
  `memon-migrate-fs` refuses to start when the working tree has
  uncommitted changes (git mode). The user commits / stashes / discards
  before retrying. The guide intentionally does NOT auto-stash.

- **Concurrent migration** (two `memon-migrate-fs` invocations against
  the same project root). The tool does not lock. Concurrent invocations
  can result in interleaved commits and partial states. The user's
  responsibility to serialise; a single brief warning suffices.

- **Run-doc with `## Method` that's a single sentence vs. a long
  paragraph**. The migration treats them identically: any non-empty
  body halts and prompts. The user decides whether to fold (short) or
  rewrite (long).

- **Run-doc with `## Caveats` that's `_None._`-style placeholder**. The
  parser sees the heading + 1 line of body, so it's non-empty and
  surfaces `RUN_HAS_CAVEATS` with `severity: 'warning'`. The user
  treats this as an empty caveat and deletes both the heading and the
  placeholder line.

- **`docs/experiments/` does not exist at all** (the project has no
  exp docs yet). The file-move loop finds no matches and is a no-op;
  the version marker still bumps from 4 to 5. The folder layout
  applies to future `memon experiment create` calls.

- **A run dir's `README.md` has a frontmatter parse error** that
  prevents body parsing. The migration's run-doc scan logs the parse
  error and continues (does not halt). The version marker still
  bumps; the user can fix the broken run README later via the web
  editor.
