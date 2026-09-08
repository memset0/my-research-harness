# agent-handoff Specification

## Purpose

Define the dashboard boundary for coding-agent integrations after removal of
the per-experiment handoff launcher.

## Requirements

### Requirement: No per-experiment Coding Agent launcher

The web dashboard SHALL NOT render an `Ask Claude Code`, `Open Claude Code`,
or equivalent Coding Agent launcher on Project, Experiment, or Run surfaces.
It SHALL NOT generate or copy agent prompts or shell launch commands from
those surfaces.

#### Scenario: Experiment detail has no Coding Agent action

- **WHEN** an owner opens an Experiment detail page
- **THEN** no Coding Agent launcher or prompt-handoff dialog is present

### Requirement: No in-browser LLM dialog

The web app SHALL NOT render a chat UI that talks directly to Claude or any
other LLM. There is no message thread, streaming response, or API-key input.

#### Scenario: No chat surface in the UI

- **WHEN** a user navigates the dashboard
- **THEN** no LLM chat or prompt-handoff surface exists

### Requirement: Research handoff context is source-based by default

A normal research handoff SHALL contain the artifact identity/path, current frontmatter highlights, source-document references, relevant roadmap/decision references when available, the requested research action, and Chinese-response guidance. It SHALL NOT read or inject Journal events by default. A debugging handoff MAY explicitly request a bounded diagnostic history slice and SHALL label it operational context rather than scientific truth. Context SHALL be deterministic for the captured source state and missing Wiki context SHALL be reported honestly.

#### Scenario: Normal prompt ignores history growth
- **WHEN** only diagnostic history changes while the research documents and user intent are unchanged
- **THEN** the normal generated research prompt is unchanged

#### Scenario: Debug prompt is explicit
- **WHEN** the owner requests a debug handoff with recent failed operations
- **THEN** the prompt includes only the selected bounded diagnostic slice, without credentials or full environment dumps
