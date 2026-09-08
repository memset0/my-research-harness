## Purpose

Define the project-wide research maintenance loop that connects roadmap decisions, reusable findings, experiments and runs without rewriting historical evidence.

## ADDED Requirements

### Requirement: Roadmap uses its dedicated wiki kind and stable references

The coordinator SHALL maintain the research tree as a statusless `roadmap`
wiki page linked to decision, finding, and question pages. Its content SHALL
identify the research question, each Experiment's role, dependencies,
successor relationships, reusable evidence, and unresolved gates without
mandatory headings. Node state SHALL be expressed in prose rather than a
page-level lifecycle. Experiment and Variant evidence SHALL be cited inline
many-to-many; nodes SHALL NOT be treated as Experiment slots or an Experiment
inventory. The coordinator SHALL NOT introduce a separate roadmap database or
infer completed research from the existence of a link.

#### Scenario: Existing negative result informs new work
- **GIVEN** a related Experiment already records a rejected mechanism and its limits
- **WHEN** a new roadmap task considers that mechanism
- **THEN** the coordinator cites that evidence and states what changed before proposing a rerun

### Requirement: Approved decisions include affected artifact writeback

After an approved roadmap or evidence interpretation change, the coordinator SHALL inspect outgoing references, backlinks and related artifact mentions. It SHALL update affected wiki pages through the wiki workflow and Experiment descriptions, Findings, Limitations and successor references through the Experiment writer. Each affected item SHALL be updated, inspected-and-unchanged with a reason, or explicitly blocked; a suggestion to update later SHALL NOT count as completion.

#### Scenario: New benchmark supersedes an old contract
- **WHEN** the owner adopts E0002 as the new protocol authority replacing E0001
- **THEN** the roadmap and E0001's current description identify E0002 as successor
- **AND** E0001's original protocol, measurements and provenance are not relabelled as E0002 evidence

#### Scenario: Only one claim is affected
- **WHEN** new evidence narrows one claim in a multi-question Experiment
- **THEN** the coordinator updates that claim's scope and its dependents rather than retiring every claim or the whole Experiment

### Requirement: Writeback preserves authority and conflict boundaries

The workflow SHALL preserve existing human-only Experiment lifecycle and archive decisions, warning permissions and wiki-review permissions. It SHALL NOT write DEPRECATED into the Experiment status enum. Approved factual scope/description updates SHALL NOT require repeated per-file consent. It SHALL reread and merge on a hash/mtime conflict once, then report the blocked subset without overwriting newer work or claiming project-wide atomic completion.

#### Scenario: Concurrent experiment update
- **WHEN** an affected Experiment changes after the writer's snapshot
- **THEN** the writer does not overwrite it using the stale snapshot and the final handoff names any unresolved cross-document inconsistency

### Requirement: Knowledge writeback preserves existing conflict authority

Source-document writeback SHALL preserve existing Wiki conflict and human-review permissions. It SHALL NOT add a new precedence state based on hypothetical evidence-confirmation metadata.

#### Scenario: Conflicting research interpretations
- **WHEN** source documents disagree
- **THEN** the workflow reports and handles the disagreement under existing source and human authority rather than inventing a confirmation state
