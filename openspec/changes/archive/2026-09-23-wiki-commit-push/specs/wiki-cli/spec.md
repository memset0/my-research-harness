## MODIFIED Requirements

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

