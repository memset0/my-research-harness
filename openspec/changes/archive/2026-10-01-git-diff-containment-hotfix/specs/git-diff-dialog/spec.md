## ADDED Requirements

### Requirement: Working-tree diff sides answer for paths absent from the worktree

`GET /api/projects/:project/git-diff` with `side=unstaged` or
`side=untracked` SHALL judge path containment without requiring the path,
any of its parent directories, or the configured Project root to exist on the
serving filesystem. Containment of an absent path SHALL be judged against the
real path of its nearest existing ancestor, so an absent path is never treated
as contained merely because it is absent. Absence alone SHALL NOT produce a
server error: the Git readers decide the payload (a working file deleted since
the index yields `200 { ok: true, status: 'deleted', newContent: '' }`).
Escapes SHALL still be rejected with `400` before any reader runs: `..`
segments, absolute paths, and a path whose existing ancestor is a symlink that
resolves outside the Project, whether or not the final file exists.

#### Scenario: Unstaged diff of a file deleted from the worktree
- **GIVEN** a tracked file `gone.ts` that is deleted from the working tree but
  still in the index
- **WHEN** `GET /api/projects/<p>/git-diff?path=gone.ts&side=unstaged`
- **THEN** the response is `200 { ok: true, status: 'deleted',
  oldContent: '<index content>', newContent: '' }`

#### Scenario: Configured Project root not present on the serving filesystem
- **GIVEN** a registered Project whose configured root does not exist on the
  serving host
- **WHEN** `GET /api/projects/<p>/git-diff?path=app.ts&side=unstaged`
- **THEN** the containment check does not fail and the response is whatever
  the Git readers report for that path, never a `500` caused by the
  containment check itself

#### Scenario: Symlink escape with an absent leaf
- **GIVEN** a directory link `out` inside the Project that points outside it
- **WHEN** `GET /api/projects/<p>/git-diff?path=out/new.txt&side=untracked`
  and `out/new.txt` does not exist
- **THEN** the response is `400` and no Git reader is invoked
