# Handoff: the v12 "discussion" feature (design agreed, nothing built)

Written 2026-11-08 when maintenance of this repository moved to another
machine. The design below was worked out with the owner in conversation
(2026-10-28/29). **No OpenSpec change and no code exist yet.** The next step
is `openspec propose` for this feature, using this file as the input, then
let the owner review the proposal before apply.

## 1. What the owner wants

- A new feature called **discussion**, shipped as **v12**. The owner makes
  many decisions together with agents and wants a memon interface for it.
- Agents write the discussion; the owner, logged in on the website, picks
  options and/or leaves comments; agents read the feedback back through the
  CLI, act on it and update the discussion.
- Agents must be free to organize the content (rich Markdown, images, HTML,
  existing components). memon only imposes structure on the questions.
- Each decision is a **question**: it has an identity, a type, a category
  and a status. Some questions offer options and the agent's preference.

Background: a research project currently fakes this inside a Report
(per-feature Markdown files with a `### Qn · kind · state · title` heading
grammar, a `decisions.json`, a build script and a two-column "waiting for
you" tab). That is the prior art and its limits motivated the feature. Do
not migrate it automatically; converting it is a per-project decision.

## 2. Agreed design

### 2.1 Layout on disk

```
docs/discussions/D<NNNN>-<slug>/
  README.md          # the whole discussion: prose plus ALL questions (one file)
  responses.jsonl    # ALL owner responses and agent acks (one file, append-only)
  assets/            # images, HTML, data, referenced by relative path
```

- Discussion IDs follow the Report/Wiki numbering style (`D0001`).
- `README.md` front matter: `title`, optional `categories: [..]` (display
  order of categories; undeclared categories still render, after them).

### 2.2 Questions inside README.md

A question is a heading section: any heading level whose first following
block is a fenced `question` block. The heading text is the question title.
The section runs until the next heading of the same or higher level.

````markdown
## Where should feedback be stored

```question
id: STORAGE-FEEDBACK
type: choice
category: storage
status: OPEN
options:
  - id: a
    label: Project files
    detail: Travels with git; agents read it directly.   # optional, Markdown
  - id: b
    label: Central database
prefer:                      # optional: the agent's preference
  option: a
  reason: Research data stays in the project.
```

Free Markdown description of this question: tables, images
(![](assets/flow.png)), raw HTML, `embed` / `datatable` blocks,
`###` subsections, and so on.
````

- **id**: required, free format, only uppercase letters, digits and `-`
  (proposed regex `^[A-Z0-9][A-Z0-9-]*$`, max 64; whether to also forbid a
  trailing `-` or `--` is still open, leaning to allow). Unique within the
  discussion; it never changes when the question is revised. Page anchor is
  `#<ID>` (heading slugs are lowercase, so no clash). Cross-references and
  the CLI use `D0001/<ID>`.
- **type** (the question follows its type; validated by schema):

  | type | interaction | response field |
  |---|---|---|
  | `choice` | single choice | `choice: a` |
  | `multi` | multiple choice | `choices: [a, c]` |
  | `confirm` | agree / disagree with the agent's proposal | `confirm: true/false` |
  | `text` | open question, text only | `text: …` |

  Every type also accepts a comment. `options` and `prefer` are optional;
  `prefer` only makes sense for `choice` / `multi` / `confirm`.
- **category**: free string per question.
- **status**: written only by agents. Stored values: `OPEN`, `DECIDED`
  (plus `decision:` and optional `rationale`), `DEFERRED`, `DROPPED`.
  Derived, never stored:
  - `ANSWERED`: an owner response exists without a matching agent ack
    ("waiting for agent").
  - `REVISED`: the question section changed after the owner's latest
    response (compare the response's `snapshot`); the UI shows a diff and
    asks the owner to confirm again.
- Invalid questions (missing/illegal/duplicate id, bad type, schema error)
  are reported with line numbers by `memon refresh` and
  `memon discussion show`, and rendered as an error card. Never skip
  silently.

### 2.3 responses.jsonl

```jsonl
{"type":"response","id":"r1","question":"STORAGE-FEEDBACK","at":"2026-10-28T21:10:00+08:00","by":"owner","choice":"a","comment":"Agree, but keep it exportable","snapshot":"sha256:…"}
{"type":"ack","response":"r1","at":"2026-10-28T21:30:00+08:00","by":"agent","note":"Adopted, question is DECIDED"}
```

- Append-only for both sides; nobody rewrites existing lines. The full
  back-and-forth of each question can be reconstructed.
- The web appends `response` lines; agents append `ack` lines via the CLI.
- `snapshot` is the hash of the question section when the owner answered.
  The old text for a REVISED diff comes from git history, falling back to a
  ≤ 4 KB section copy stored in the response when the section was never
  committed.
- Timestamps follow the repo rule: ISO 8601 with the writer's local offset.

### 2.4 Writes through the File Agent

Extend the scoped `read-edit` grant (added for title renames) with an
`append` operation:

- only `docs/discussions/*/responses.jsonl` (creatable when missing);
- each append ≤ 4096 bytes and exactly one complete newline-terminated line;
- carries `expectedSize`; a mismatch is a conflict, and the web re-reads and
  retries, so concurrent answers never interleave.
- Advertise a new capability (e.g. `scoped-append-v1`); deployed agents must
  be upgraded once.

Central side mirrors the title-edit gate: a new `allowed_edits` value (e.g.
`discussion`) lets a read-only Project accept only response appends.

### 2.5 CLI for agents

- `memon discussion pending`: unacked responses across all discussions.
- `memon discussion show D0001 [--json]`: parsed questions, statuses, history.
- `memon discussion resolve D0001/<ID> --status DECIDED --decision a [--note …]`:
  rewrites only that question block's fields (other bytes untouched) and
  appends the ack. Agents may also edit README.md by hand, then
  `memon refresh`.
- (default, see §3) `memon discussion reply D0001/<ID> "…"` for threaded
  replies.

### 2.6 Web

- Each question section renders as **one question card**, single column,
  top to bottom (the owner explicitly rejected any left/right split):
  1. header from metadata: ID, title, type, category, status badges;
  2. the description, i.e. the section's Markdown body after the `question`
     block (collapsible when long);
  3. options from metadata, the agent-preferred one marked with its reason
     and an "adopt" button;
  4. answer controls (choice/text plus comment);
  5. history from `responses.jsonl`.
  Everything except the description is generated from metadata and
  responses. Prose and grouping headings between questions render outside
  the cards as normal Markdown.
- Per status: OPEN is answerable; ANSWERED shows the pick plus "waiting for
  agent" and allows a follow-up response; DECIDED collapses options to
  "decided: a + rationale" and folds the description; REVISED shows a
  banner and a diff button.
- A discussion page has an overview at the top grouped by category and
  filterable by status; clicking jumps to `#<ID>` (URL kept in sync).
- A project-level "waiting for you" view lists OPEN and REVISED questions
  across discussions.
- Share-link viewers see the cards read-only.

## 3. Defaults not yet confirmed by the owner

Put these into the proposal as defaults and let the owner adjust them:

1. Status vocabulary as in §2.2 (whether to add something like
   `NEEDS_INFO` for agent→owner follow-ups).
2. Comments become per-question threads; agents reply with
   `memon discussion reply`.
3. Questions live only in discussions for now, not embeddable in
   Reports/Wiki.
4. A project-level decision log of DECIDED questions for later agents.
5. No `rank` question type yet.

Also note the owner's message "no i think they should be put into one file"
was read as "all responses in one file" (→ `responses.jsonl`); double-check
if anything suggests otherwise.

## 4. Versioning and process

- v12 means `FS_CONVENTION_VERSION` 12 and release `12.0.0`, so a
  `packages/core/migrations/v11-to-v12.md` guide is required. Read
  `openspec/specs/fs-migration-guide-authoring/spec.md` first (AGENTS.md
  §6.8). The change is additive (a new `docs/discussions/` kind), so the
  guide should need no data conversion.
- The File Agent part is installed separately from central releases.
- Follow AGENTS.md: propose → owner review → apply → commit → release →
  push → deploy → verify; archive only with explicit authorization.

## 5. Code pointers

- Fenced component grammar: `apps/web/lib/components/fence.ts`, registry
  `apps/web/lib/components/registry.ts`; the `checklist/v1` component
  (`update.ts`, `write-context.tsx`) is prior art for web-driven rewrites of
  a component block.
- Block rewrite helpers: `apps/web/lib/components/rewrite.ts`.
- Scoped File Agent edits: `packages/file-agent/internal/agent/scoped.go`,
  `server.go` (`authorizeMutation`, `/v1/mutate`, capabilities list).
- Title-edit plumbing to mirror: `packages/core/src/content-title.ts`,
  `packages/backend/src/document-service.ts` (`setReportTitle`),
  backend routes `routes/documents-wiki.ts` (`editMutating` in
  `routes/shared.ts`), `apps/web/lib/server/api-route-manifest.ts`
  (`edit:` field), `apps/web/lib/server/central/direct-runtime.ts`
  (`allowsEdit`), `backend-proxy.ts` (edit capability exemption). Note:
  host-qualified API calls go through the backend route table, not the
  Next route handlers, so new endpoints need both.
- Catalog/inventory: `.memon/index/*.json` published catalogs; a new
  `discussions.json` catalog will be needed for sidebar/list pages.
- Page header pattern: `apps/web/components/document-header.tsx`.

## 6. Other repository state at handoff

- `main` at `973cbeec` (`release: v11.22.3`), in sync with origin.
- Unarchived changes whose work has shipped (archive needs the owner's OK):
  `scoped-title-edits`, `embed-location-sync`, `code-block-copy`,
  `sidebar-navigation`, `agent-service-hosts` (task 2.1 still open: a
  deployed agent forwarding service ports to compute-node dashboards
  without local proxies), plus older active changes listed by
  `openspec list`.
- Known pre-existing test failures unrelated to recent work: web
  `lib/server/reports.test.ts`, the conflict case in
  `app/api/wiki/[id]/route.test.ts`, backend-route / backend-proxy tests
  for the removed shares route, and content-service-gateway SSH tests.
- Deployment and cluster facts (central host, agents, tunnels, configs) are
  in the old machine's gitignored `LOCAL.md`; they are deliberately not in
  this file. Bring that notebook over manually or rebuild it on the new
  machine (AGENTS.md §1.1).
