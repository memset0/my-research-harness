## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Skill invocation policy split by risk tier
**Reason**: The redesigned workflow intentionally replaces the former contract, including its obsolete authoring/default-context scenarios.
**Migration**: Use "Supported skill invocation preserves risk boundaries without Journal authors"; preserve historical user content and cut over every supported caller without a silent compatibility writer.

### Requirement: `--project-root` is always passed explicitly
**Reason**: The redesigned workflow intentionally replaces the former contract, including its obsolete authoring/default-context scenarios.
**Migration**: Use "All supported skill commands explicitly select the project"; preserve historical user content and cut over every supported caller without a silent compatibility writer.

### Requirement: mtime optimistic locking discipline
**Reason**: The redesigned workflow intentionally replaces the former contract, including its obsolete authoring/default-context scenarios.
**Migration**: Use "Document and review writers preserve optimistic concurrency"; preserve historical user content and cut over every supported caller without a silent compatibility writer.

### Requirement: Drive coordinates all Experiment work through a dedicated writer skill
**Reason**: The redesigned workflow intentionally replaces the former contract, including its obsolete authoring/default-context scenarios.
**Migration**: Use "Drive coordinates experiment writes and project knowledge writeback"; preserve historical user content and cut over every supported caller without a silent compatibility writer.

### Requirement: AI authority on warnings is strictly append-only
**Reason**: The redesigned workflow intentionally replaces the former contract, including its obsolete authoring/default-context scenarios.
**Migration**: Use "Warning authority remains restricted after digest retirement"; preserve historical user content and cut over every supported caller without a silent compatibility writer.

### Requirement: JOURNAL frontmatter is writable only via digest-mark
**Reason**: No supported workflow writes the retired Journal cursor.
**Migration**: Remove all manual append/cursor skill guidance; preserve legacy files.

### Requirement: Doctor checks fold into memon-digest-journal; no standalone memon-doctor skill
**Reason**: Integrity work must not depend on retired digest bookkeeping.
**Migration**: Use structural lint and ordinary source-writer repair workflows; doctor is retired.

### Requirement: Digests vs reports — date-keyed cursor-advancing vs theme-keyed cursor-independent
**Reason**: Cursor-advancing synthesis is retired; current source/Wiki knowledge replaces event-window summaries.
**Migration**: Preserve existing Report and Digest documents; update report authoring guidance away from mandatory Journal selectors.

### Requirement: `memon-digest-journal` doctor sweep walks per-experiment warning review
**Reason**: The owning digest workflow is removed.
**Migration**: Retain current-state warning inspection and existing human-only permissions without a digest window.
