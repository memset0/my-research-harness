# fs-migration-guide-authoring Specification

## Purpose
Define the authoring contract for memon's filesystem-convention migration guides so agents can consistently interpret and execute migrations between consecutive versions. Standardize guide location, the seven-section structure, executable detection and verification commands, rollback guidance, commit messages, and edge-case handling while preserving user-owned content.

## Requirements
### Requirement: Migration guides live at a fixed path with a fixed naming pattern

Every migration guide SHALL live at `packages/core/migrations/v<N>-to-v<N+1>.md`, where `<N>` and `<N+1>` are consecutive positive integers. There SHALL NOT be guides that skip versions (`v1-to-v3.md`); every consecutive pair from `1` to `FS_CONVENTION_VERSION` SHALL have its own guide. There SHALL NOT be more than one guide for a given version pair.

`packages/core/migrations/README.md` SHALL exist (even when no guide files do) and SHALL describe the directory's purpose and naming contract for future contributors.

#### Scenario: Naming pattern is enforced
- **WHEN** `FS_CONVENTION_VERSION === 3`
- **THEN** `packages/core/migrations/` contains exactly two guide files: `v1-to-v2.md` and `v2-to-v3.md`
- **AND** there is no `v1-to-v3.md`, no `v0-to-v1.md`, and no other `vX-to-vY.md` files

#### Scenario: README is present even when empty
- **WHEN** `FS_CONVENTION_VERSION === 1` (no migrations yet)
- **THEN** `packages/core/migrations/README.md` still exists with content describing the contract
- **AND** there are no `vN-to-vN+1.md` files in the directory

### Requirement: Each guide follows the fixed seven-section structure

Every `v<N>-to-v<N+1>.md` migration guide SHALL contain these top-level headings in this exact order, using H2 (`##`):

1. `## Background / Why`
2. `## Detection`
3. `## Diff (v<N> → v<N+1>)`
4. `## Target State (v<N+1> Summary)`
5. `## Verification`
6. `## Rollback Notes`
7. `## Edge Cases`

Section content rules:

- **Background / Why** (1–3 paragraphs): explains what changed in memon's tooling that motivated this migration. Includes the issue number / change name in the openspec changes folder if available.
- **Detection** (bullet list of conditions): how an agent confirms the project root is currently in v<N> state. Each bullet SHALL be a literal command or filesystem check (e.g., `test -f README.md && grep -q '^status:' README.md`). Vague prose like "if the README looks old" SHALL NOT appear.
- **Diff (v<N> → v<N+1>)** (per-file blocks): for each file the migration touches, a subsection naming the file path and showing the before / after fragment. Use fenced code blocks labelled `before` and `after` for clarity. If a file is added, only an `after` block. If removed, only a `before` block.
- **Target State (v<N+1> Summary)** (canonical structure): the agent's terminal expectation. Used for verification ("does the project now look like this?"). Concise — describe the shape, not every line.
- **Verification** (numbered list of shell commands): runnable commands the agent executes after applying the diff. Each command SHALL print enough output to confirm success (use `grep -q && echo OK`, `test -f && echo OK`, etc.). Verification SHALL fail closed: any non-zero exit aborts the step.
- **Rollback Notes** (1 paragraph): what the agent should tell the user if it cannot complete the step. Includes the git-revert command (git mode) and tarball-extract command (non-git mode).
- **Edge Cases** (bullet list): known awkward situations and how to handle them — e.g., "project has no `HYPOTHESES.md`", "user has manually deleted `JOURNAL.md`", "frontmatter has user-added custom fields".

Sections SHALL appear in the order listed; reordering breaks the agent's parsing assumptions. Sections SHALL NOT be omitted; if a section is genuinely empty (e.g., no edge cases known), the section heading SHALL still be present with the body `_None known at time of writing._`

#### Scenario: All seven headings present in order
- **WHEN** a guide `v<N>-to-v<N+1>.md` is opened
- **THEN** the H2 headings appear in this order: `Background / Why`, `Detection`, `Diff (v<N> → v<N+1>)`, `Target State (v<N+1> Summary)`, `Verification`, `Rollback Notes`, `Edge Cases`
- **AND** no other H2 heading appears between them

#### Scenario: Detection uses literal commands
- **WHEN** a guide's `## Detection` section is read
- **THEN** every bullet contains a runnable shell snippet or a literal file-path check
- **AND** no bullet is purely descriptive prose ("the README looks old")

#### Scenario: Empty section uses placeholder
- **GIVEN** a migration with no known edge cases
- **WHEN** the `## Edge Cases` section is read
- **THEN** it contains the body `_None known at time of writing._` (or equivalent explicit empty marker), NOT a deleted heading

### Requirement: Verification commands are imperative shell, not prose

Every `## Verification` step SHALL be a literal shell command that:

- Returns exit 0 on success and non-zero on failure (verification "fails closed").
- Prints something to stdout on success so the running agent has explicit confirmation (e.g., trailing `&& echo OK`).
- Does NOT depend on tools other than POSIX coreutils, `git`, `grep`, `jq`, and `memon` itself. Other dependencies (`yq`, `xmllint`, etc.) SHALL be avoided.
- Executes in seconds, not minutes. Long verifications belong in CI, not in the in-loop migration check.

The verification block SHALL be wrapped in a shell-fenced code block so the agent can extract and execute it directly.

#### Scenario: Verification is executable shell
- **WHEN** a guide's `## Verification` block is read
- **THEN** it is a fenced code block labelled `bash` or `sh`
- **AND** every line is either a comment (`#`) or a runnable shell command
- **AND** at least one command prints `OK` (or equivalent confirmation) on success

#### Scenario: Verification fails closed
- **GIVEN** a guide's verification expects `grep -q '^status:' README.md` to match
- **WHEN** `README.md` does not contain `^status:`
- **THEN** the grep returns non-zero
- **AND** the migrate-fs runtime treats this as step failure and aborts before commit

### Requirement: Commit message format is fixed

Every migration step's `git commit` (in git mode) SHALL use the literal message:

```
chore(memon): migrate FS convention v<N> -> v<N+1>
```

with `<N>` and `<N+1>` substituted as positive integers and the arrow rendered as the two ASCII characters `->` (NOT a Unicode arrow `→`). No body, no trailing period.

The guide itself SHALL include this message verbatim in its `## Rollback Notes` section so the agent has a literal source to copy from when scripting the commit. Guides SHALL NOT propose alternative commit message formats.

#### Scenario: Commit message exact format
- **WHEN** the migrate-fs runtime commits the v1-to-v2 step
- **THEN** the commit's first line is exactly `chore(memon): migrate FS convention v1 -> v2`
- **AND** the commit has no body and no trailing period

#### Scenario: Guide includes the literal commit message
- **WHEN** a reader opens any `v<N>-to-v<N+1>.md` guide and reads `## Rollback Notes`
- **THEN** the section contains the literal string `chore(memon): migrate FS convention v<N> -> v<N+1>` so the agent can copy it directly

### Requirement: Edge-case section covers four canonical situations

Every guide's `## Edge Cases` section SHALL address (or explicitly note as not-applicable) these four canonical situations:

1. **Missing required file**: e.g., the guide expects `HYPOTHESES.md` but it doesn't exist. Guide states whether the migration creates it, skips it, or aborts.
2. **User-added custom frontmatter fields**: project has frontmatter keys not part of memon's schema. Guide states that custom fields SHALL be preserved verbatim and only memon-owned fields are modified.
3. **User mid-edit (working tree dirty)**: addressed at the runtime level (refusal), but the guide SHALL acknowledge it and refer to the runtime requirement so guide authors don't reinvent the handling.
4. **Concurrent migration**: two migrate-fs invocations against the same project root. Guide notes this is the user's problem (the tool does not lock); a brief warning suffices.

Guides MAY add additional edge cases beyond these four. Guides SHALL NOT silently omit any of these four; if not applicable, state explicitly that the situation cannot occur for this migration.

#### Scenario: Four canonical edge cases addressed
- **WHEN** a reader inspects the `## Edge Cases` section of any migration guide
- **THEN** the four canonical situations (missing file, custom frontmatter, dirty tree, concurrent invocation) are each explicitly addressed or marked not-applicable
- **AND** if marked not-applicable, the reason is stated in one sentence

### Requirement: Guides write imperatively for cross-agent compatibility

Migration guide prose SHALL be written imperatively and concretely so that LLM agents from different vendors / model versions interpret them consistently. Specifically:

- Use numbered, atomic instructions ("1. Read README.md. 2. Locate the line starting with `status:`. 3. Replace it with `state:`.").
- Embed exact match strings, paths, and shell commands; avoid metaphors or paraphrase.
- Avoid hedging language ("might", "consider", "you could") — every step SHALL be a definite action.
- When the guide describes alternatives, frame them as branches with explicit detection conditions ("If `<file>` contains `<X>`, do A; otherwise do B"), not as "either A or B is fine".

This style is documented in `packages/core/migrations/README.md` as a reminder for guide authors.

#### Scenario: Imperative prose is enforced by review
- **WHEN** a reviewer audits a draft migration guide
- **THEN** they reject any step using hedging language ("might", "consider", "you could")
- **AND** they reject any step that lacks a definite action verb

#### Scenario: README documents the style rule
- **WHEN** a reader opens `packages/core/migrations/README.md`
- **THEN** it contains a section explicitly requiring imperative, atomic, hedge-free prose for guides
- **AND** it points to this spec for the full rules

### Requirement: Repo `CLAUDE.md` directs future authors to consult this spec

Repo `CLAUDE.md` SHALL contain a section (under "OpenSpec workflow" or as a new sibling section) that explicitly directs future agents to read `openspec/specs/fs-migration-guide-authoring/spec.md` before authoring a new migration guide. The pointer SHALL name the spec by path so an agent can fetch it directly.

#### Scenario: CLAUDE.md mentions the meta-spec
- **WHEN** a reader greps `CLAUDE.md` for `fs-migration-guide-authoring`
- **THEN** the result contains a sentence directing future authors to consult that spec before writing a `v<N>-to-v<N+1>.md` guide
- **AND** the sentence states the path is `openspec/specs/fs-migration-guide-authoring/spec.md`
