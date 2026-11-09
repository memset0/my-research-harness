# Proposal

**Status: implementation authorized (2026-11-08).** The owner approved entering implementation to evaluate the working feature. Use the confirmed defaults below; archive and project data migration remain separate.

## Why

Research decisions made with agents need a shared place where the owner can answer questions and agents can read, acknowledge and act on that feedback. Reports currently require project-specific scripts to approximate this loop; discussions make it a native file-backed workflow.

## What Changes

- Add `docs/discussions/D<NNNN>-<slug>/README.md`, append-only `responses.jsonl`, and optional relative assets. Heading sections beginning with a `question` fence carry stable question identities and typed metadata while leaving their research prose free-form.
- Give each discussion its own explicit DRAFT / OPEN / CLOSED lifecycle. DRAFT means the agent is still preparing it for the user; OPEN is available for discussion; CLOSED ends the discussion while retaining any unresolved questions. Age and content changes never assign a stale state or automatically close a discussion.
- Support free-form question categories chosen by the user and agent, with optional category display order and category filtering. Memon imposes no built-in taxonomy or automatic category assignment.
- Parse and diagnose choice, multi, confirm and text questions, derive ANSWERED and REVISED states from response history, and preserve invalid questions visibly with source line numbers.
- Add agent CLI commands for creation, listing, showing, pending responses, resolution, threaded replies and a decision log; integrate discovery and publication with `memon refresh`.
- Render single-column question cards, category/status navigation, pending-owner and decision views. Owners answer through the website; share viewers read without mutation authority. Preserve Markdown components, images and embedded HTML inside descriptions.
- Persist the browser's last displayed discussion state in localStorage. Compare later fetch results against that baseline and animate changed questions or newly appended replies; unchanged fetches produce no repeated animation. Keep in-progress form input and browsing position stable.
- Add an expected-size guarded, single-line append primitive, scoped File Agent capability `scoped-append-v1`, and central `allowed_edits: [discussion]` for response-only writes on read-only Projects.
- Ship the explicitly requested v12 convention with a reviewed v11-to-v12 guide. **BREAKING:** the FS marker/release major advances, so skill preflight requires an explicit marker migration even though existing research documents need no conversion. Deployment never migrates project data.

## Capabilities

### New Capabilities

- `discussions`: discussion files, parsing, response history and states, catalogs, CLI workflow and browser interaction.
- `discussion-response-append`: transport-independent guarded appends, File Agent scoped grants, and owner/read-only authorization.

### Modified Capabilities

- `fs-version-tracking`: propose the handoff's v12 discussion convention boundary, retaining existing formats and requiring owner review of the policy exception and explicit migration guide/marker transition.

## Impact

Core domain/schema/catalogs and CLI, backend services and both host-qualified and ordinary routes, central authorization, Web navigation/rendering/query keys, the file protocol and optional Go File Agent, bundled agent guidance, migration documentation and release validation. No external database, watcher, research-project conversion, or automatic File Agent upgrade is introduced.

The handoff defaults are included as proposals: per-question owner/agent threads, discussions-only questions, a project decision log, no rank type, and no NEEDS_INFO state. Question IDs provisionally allow trailing and repeated hyphens. Existing unrelated active changes remain untouched and unarchived.

The owner has confirmed discussion-level DRAFT / OPEN / CLOSED, agent preparation as the meaning of DRAFT, user/agent-defined question categories, and localStorage-backed update animation. DRAFT discussions do not enter ordinary user-facing or waiting-for-you views. Those decisions supersede any earlier suggestion to model discussion freshness as stale/current. Question-level status and answer validity remain separate concerns.

Revision validity compares question title, type, options, preference and description; category and processing-status changes do not invalidate an answer. Keep a separate exact section hash for write locking/comparison. Agents publish DRAFT as OPEN; owners can close and reopen published discussions through bounded browser status edits.
