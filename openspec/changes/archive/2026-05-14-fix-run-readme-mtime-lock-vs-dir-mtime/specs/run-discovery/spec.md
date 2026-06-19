## MODIFIED Requirements

### Requirement: In-memory run index

The system SHALL maintain an in-memory index of all discovered runs. Each
indexed entry SHALL carry:
- a top-level `project` string field set from the `config.yml` project's
  `name` whose `discoverRuns` call surfaced the directory (membership is
  structural, never derived from frontmatter — `project:` field on the run
  side is gone in v3)
- a projection of frontmatter fields per `run-readme` capability
  (`id`, `name`, `status`, `created_at`, `updated_at`, `finished_at`,
  `experiment`, `host`, `pid`, `gpus`, `wandb`, `entry`, `command`)
- derived metadata (`mtime`, `readmeMtime`, `path`, `hasReadme`, `archived`)

`mtime` SHALL be the **effective** mtime: `max(dirStat.mtimeMs,
readmeStat.mtimeMs)` when the README exists, else `dirStat.mtimeMs`. This
value drives live-update invalidation (SSE), staleness banners, and the
runtime index's change-detection. It MUST NOT be used as the optimistic
locking key for mutating routes.

`readmeMtime` SHALL be the README.md file's own mtime, in isolation:
`readmeStat.mtimeMs` when the README exists; `0` when `hasReadme === false`.
This value is the canonical optimistic-locking key for `expectedMtime`
on every run-side mutating route (`PATCH /api/runs/:id/archive`,
`PATCH /api/runs/:id/status`, `PUT /api/runs/:id/readme`, the
`/api/runs/:id/warnings` family).

Membership filters (`memon list --project <name>`,
`/api/runs?project=<name>`) SHALL filter on the top-level `project` field.

#### Scenario: Top-level project equals config project name
- **WHEN** a run at `/mnt/p/logs/foo-260501-100000` is discovered via the
  project entry `{ name: "p", root: "/mnt/p" }`
- **THEN** the indexed entry's top-level `project` field equals `"p"`

#### Scenario: Missing README still indexed
- **WHEN** a discovered run directory has no `README.md`
- **THEN** the index entry has top-level `project` from config, `id` and
  `path` populated, `status: UNKNOWN`, `hasReadme: false`,
  `created_at` derived from the dir-name timestamp,
  `updated_at` equal to `created_at`
- **AND** `readmeMtime` equals `0` (no README file to stat)
- **AND** `mtime` equals `dirStat.mtimeMs`

#### Scenario: Index update on poll change
- **WHEN** a poll cycle observes that a `README.md` `mtime` has advanced
- **THEN** the index entry is re-parsed within that cycle; the top-level
  `project` field is preserved (it cannot drift on edit since the
  frontmatter `project:` field is gone in v3)
- **AND** the entry's `readmeMtime` reflects the new README stat
- **AND** the entry's `mtime` is the new `max(dir, README)`

#### Scenario: README mtime and dir mtime diverge
- **GIVEN** a run dir where the README was last written at `M_r` and a
  non-README file was last modified at `M_d` with `M_d > M_r`
- **WHEN** discovery indexes this run
- **THEN** `readmeMtime === M_r`
- **AND** `mtime === M_d`
- **AND** the two are distinct fields on the run record
