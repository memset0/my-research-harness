## ADDED Requirements

### Requirement: Ask Claude Code button on detail page

The experiment detail page SHALL provide an `Ask Claude Code` action (button or menu entry) in the header area, alongside `+ Note` and `Edit README`. Clicking the action SHALL open a small dialog containing a generated prompt and a `Copy to clipboard` action.

The web app SHALL NOT call any LLM API directly. The integration is **handoff only**: prompt generation + clipboard copy. The user pastes into their Claude Code terminal session.

#### Scenario: Open the handoff dialog
- **WHEN** the user clicks `Ask Claude Code` on an experiment detail page
- **THEN** a dialog opens showing a multi-line prompt textarea (read-only) and two buttons: `Copy prompt` and `Copy "cd <root> && claude"`

#### Scenario: Copy prompt
- **WHEN** the user clicks `Copy prompt`
- **THEN** the prompt text is written to the system clipboard via `navigator.clipboard.writeText()` and a success toast `Copied · paste into Claude Code` appears

#### Scenario: Clipboard unavailable / blocked
- **WHEN** clipboard write fails (browser permission denied, insecure context, etc.)
- **THEN** the dialog falls back to selecting the prompt text in the textarea so the user can copy manually, and a toast `Clipboard blocked — please copy manually` appears

### Requirement: Generated prompt content

The generated prompt SHALL include, at minimum:
1. The experiment id and absolute path
2. Front matter highlights: status, created/finished timestamps, tags, related hypothesis IDs
3. Up to 10 most recent JOURNAL events whose `experimentId` matches this experiment
4. A short, opinionated instruction asking the model to summarize, critique, and propose new hypotheses
5. A "respond in Chinese" hint (matching the user's working language)

The prompt SHALL be deterministic given the experiment state at the moment the dialog was opened (re-opening produces identical text unless the experiment changed in between).

#### Scenario: Includes experiment context
- **WHEN** the prompt is generated for `foo-260501-100000` with `status: RUNNING`, hypotheses `[H0001, H0003]`, and 3 recent JOURNAL events
- **THEN** the prompt text contains the literal id `foo-260501-100000`, the absolute experiment path, the words `H0001` and `H0003`, and the bodies of those 3 JOURNAL events

#### Scenario: Bounded prompt size
- **WHEN** the experiment has 100+ JOURNAL events
- **THEN** the prompt only includes the 10 most recent events (no full history dump); the readme reference is a path, not its full content

### Requirement: Cd-and-launch command hint

The handoff dialog SHALL render a one-line shell snippet of the form:

```
cd <project-root> && claude
```

(or `claude code` if `claude` is not yet aliased — the dialog SHOWS both forms with a small note recommending whichever the user has wired up).

The exact `<project-root>` SHALL come from the resolved config's project entry, NOT from the experiment subpath.

#### Scenario: Render the cd snippet
- **WHEN** the active experiment belongs to `project-a` whose `root` is `/mnt/p/a`
- **THEN** the dialog shows `cd /mnt/p/a && claude` as a copyable snippet

### Requirement: No in-browser LLM dialog

The web app SHALL NOT render an in-browser chat UI talking to Claude or any LLM. There is no message thread, no streaming response, no API key input. The only AI-related action is the **handoff** described above.

#### Scenario: No chat surface in the UI
- **WHEN** the user navigates the entire dashboard
- **THEN** no chat / message-bubble UI surface exists; the only AI-related affordance is the `Ask Claude Code` dialog
