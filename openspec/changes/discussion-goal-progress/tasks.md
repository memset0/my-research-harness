# Tasks

Implementation authorized by the owner on 2026-11-26. Track verified completion only.

## 1. Core model

- [x] 1.1 Extend the question schema with `subgoal` type, optional `work`, `decided_by`, `refs` and frontmatter `goal`, with diagnostics for subgoal options/preference/decision/DECIDED, DOING/DONE before settled, and malformed refs; verify that old fixtures produce no new diagnostics and that the validity snapshot ignores the new fields.
- [x] 1.2 Restrict subgoal responses to comments at response validation; verify typed answers return BAD_REQUEST and comments append.
- [x] 1.3 Add `deriveDiscussionProgress` with the partition from design.md; verify the spec's mixed-discussion scenario, pending feedback on a settled unit, invalid questions and DEFERRED/DROPPED exclusion.
- [x] 1.4 Resolve structured refs and inline Report links (descriptions and agent replies) against the Reports catalog and publish per-question refs, types and work in `discussions.json` (progress is derived live from those fields plus response logs, never stored); verify catalog tests for missing Reports, anchors, repeated citations and DRAFT discussions.

## 2. CLI

- [x] 2.1 Factor the single-fence field edit out of resolve; add `discussion work <D>/<ID> <state>` and `resolve --work/--by` with automatic `decided_by`; verify byte preservation outside the fence, exit 9 on concurrent edit, and no acks from `work`.
- [x] 2.2 Add `discussion todo` and progress counts in `discussion show`; verify command output and help text.
- [x] 2.3 Update the bundled `memon-research` skill: when to set `goal`, add subgoals, mark `work`, use `refs`, and run `memon update` before using subgoals; run the skills build check.

## 3. Backend and API

- [x] 3.1 Carry goal, progress, work, decider and resolved refs (with Report titles) in discussion list/detail DTOs for host-qualified and ordinary routes; verify backend tests.
- [x] 3.2 Add the Report discussion-references read with `read` route classification, refused for document-scoped grants and excluding DRAFT; verify the route manifest, capability tests and share-viewer scenarios.

## 4. Web

- [x] 4.1 Render the goal line and segmented progress bar with summary in the discussion header, and compact counts on list rows, using stock shadcn primitives; add query-key constructors and invalidation after responses.
- [x] 4.2 Render work, agent-decided and ref badges on cards; render subgoal cards with a comment-only form; add the work-state filter to the overview.
- [x] 4.3 Add the "Referenced by" list on Report pages.
- [x] 4.4 Run the UI verification protocol (typecheck, markup and CSS token greps, verify-page screenshots on desktop and 390px) against a neutral fixture with mixed units, subgoals and refs.

## 5. Verification

- [x] 5.1 Run the change-relevant testlist (core discussion model/store/catalog, CLI discussion, backend discussion services, web discussion routes and components, route manifest/capabilities) and record results in `verification.md`.
