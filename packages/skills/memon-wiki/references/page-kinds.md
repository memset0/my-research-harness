# Wiki page kinds

The canonical reference for `memon-wiki`. One directory per kind under
`docs/wiki/`; the directory name and the frontmatter `kind` must agree.

## Contents

- [Choosing a kind](#choosing-a-kind)
- [Shared frontmatter](#shared-frontmatter)
- [`meeting`](#meeting)
- [`roadmap`](#roadmap)
- [`finding`](#finding)
- [`bottleneck`](#bottleneck)
- [`question`](#question)
- [`decision`](#decision)
- [`showcase`](#showcase)
- [`note`](#note)
- [`harness-feedback`](#harness-feedback)
- [Reserved: `code-review`](#reserved-code-review)
- [Unknown kinds](#unknown-kinds)
- [At a glance](#at-a-glance)

## Choosing a kind

Ask what the page *is for*, not what it contains:

- Something happened at a point in time and people agreed things →
  `meeting`.
- Goals, research questions, and directions need a navigable research tree →
  `roadmap`.
- Something is now known, with data behind it → `finding`.
- Something is holding the project back → `bottleneck`.
- Something is not known and someone should find out → `question`.
- Someone chose between options and the project should stop re-litigating it →
  `decision`.
- Something should be *shown* — a plot, an explorer, a rendered artifact →
  `showcase`.
- Durable context that is none of the above → `note`.
- The tooling itself is missing something → `harness-feedback`.

A page has exactly one kind. If a meeting produced a decision worth citing on
its own, write the `meeting` and a separate `decision` that cites it, rather
than overloading one page. `memon wiki move <page> <kind>` reclassifies later
without changing the id; pass `--status` in the same call when the current
status is not valid for the target kind.

## Shared frontmatter

| key | required | owner | notes |
|---|---|---|---|
| `id` | yes | CLI | `W<NNNN>`, unique, equals the filename prefix |
| `kind` | yes | CLI | equals the enclosing directory name |
| `title` | yes | author | display title; also the H1 |
| `description` | in practice | author | 1–3 plain-text sentences; shown in every listing |
| `status` | per kind | author | see each kind below; never auto-transitions |
| `date` | `meeting` only | author | `YYYY-MM-DD` |
| `tags` | no | author | string list |
| `sources` | `finding` requires it | author | evidence identifiers, see below |
| `legacy_id` | no | `migrate-report` | `R<NNNN>` of the migrated Report |
| `entry` | bundle only | author | relative HTML document rendered as the primary body |
| `deprecated` | no | `wiki deprecate` | `{ at, reason, superseded_by? }` |
| `created_at`, `updated_at` | yes | CLI | ISO8601 with offset |

Unknown keys are preserved verbatim on every write; do not strip a key you do
not recognise.

**Source forms** accepted in `sources`: `E<NNNN>` or `E<NNNN>-slug`,
`E<NNNN>/V<NNNN>` (a Variant row in that Experiment's `results.yaml`),
`H<NNNN>`, `W<NNNN>`, and a run directory base name
(`zero-snr-eval-260502-110000`). The Variant form is the preferred citation
for a `finding` — it addresses the exact Results row. CLI operations preserve
these references and validate their syntax without opening their targets.
Target existence and `WIKI_SOURCE_UNRESOLVED` checks belong to the Web view.

**Staleness** is derived in Web, not authored: a page is `stale` when any cited
artifact changed after the page's `updated_at`. Inspect source freshness in Web;
the CLI does not resolve targets or offer a source-staleness scan. Re-read the
source and either update the page or explain why it still holds.

## `meeting`

What was discussed and agreed on a given day.

- Status: none.
- Required: `date` (`YYYY-MM-DD`). Slugs conventionally start with the date,
  e.g. `W0004-2026-05-04-weekly`.
- Recommended H2s: `Attendees`, `Notes`, `Decisions`, `Action items`.

Write `Decisions` and `Action items` as two separate lists — a decision is a
settled outcome, an action item has an owner and is not done yet. Cite every
Experiment discussed in `sources`. Do not paraphrase away disagreement; a
meeting page that records only the consensus loses the reason the consensus
was reached.

## `roadmap`

A content-first research tree connecting goals, questions, and directions.

- Status: none. Describe relevant node state in prose; there is no page-level
  lifecycle.
- Recommended H2s: none — the content determines the tree's shape.

Use headings and nested lists to show how questions and directions refine a
larger goal. Nodes are not Experiment slots: do not require one Experiment per
node or turn the page into an Experiment inventory. Proposed goals and open
questions need no evidence.

Cite an Experiment or Variant inline wherever its evidence bears on a node,
and say what role that evidence plays. The relationship is many-to-many: one
artifact can support multiple nodes or roadmaps, and one node can cite multiple
artifacts. Keep detailed designs, metrics, execution state, and experiment-local
tasks in the Experiment document rather than duplicating them here.

## `finding`

Something the project now knows, with evidence.

- Status: `TENTATIVE` (default) / `VERIFIED` / `RETRACTED`.
- Required: non-empty `sources`.
- Recommended H2s: `Claim`, `Evidence`, `Limits`.

`Claim` is one paragraph a reader can quote. `Evidence` names every number
next to the Experiment, Variant, or run directory it came from. `Limits` states
what the evidence does *not* cover — the CFG scale, the prompt count, the model
size, the single seed.

`VERIFIED` means every claim reproduces from the cited Results; anything less
stays `TENTATIVE`. A body that cites no `E`/`V`/run identifier at all lints
`WIKI_CLAIM_WITHOUT_EVIDENCE` even when `sources` is populated — the prose must
point at the evidence, not only the frontmatter. When a finding turns out to be
wrong, set `RETRACTED` and explain why in place; do not delete it.

## `bottleneck`

Something that is slowing the project down.

- Status: `OPEN` (default) / `MITIGATED` / `RESOLVED`.
- Recommended H2s: `Problem`, `Impact`, `Status`, `Candidates`.

`Impact` should be quantified where possible (hours per week, GPU-hours,
throughput) and cited like any other number. `Candidates` lists options with
their cost, including the ones that were rejected and why. `MITIGATED` means a
workaround exists and the underlying problem does not; keep the distinction.

## `question`

Something not yet known that someone should answer.

- Status: `OPEN` (default) / `ANSWERED` / `DROPPED`.
- Recommended H2s: `Question`, `Context`, `Answer`.

State the question so it has a falsifiable answer. `Context` says why it
matters now and what has already been ruled out. Leave `Answer` empty until
there is one; when it arrives, fill it, cite the Experiment, set `ANSWERED`,
and consider whether the answer also deserves a `finding`. `DROPPED` records
that the question stopped mattering — say what changed.

## `decision`

A choice the project made and should not re-litigate.

- Status: `PROPOSED` (default) / `ACCEPTED` / `SUPERSEDED`.
- Recommended H2s: `Decision`, `Rationale`, `Consequences`.

`Decision` is one sentence in the imperative. `Rationale` names the
alternatives and the evidence that discriminated between them.
`Consequences` records what the project now has to live with, including the
costs. When a later decision replaces this one, set `SUPERSEDED` and deprecate
the page with `--superseded-by` pointing at the successor.

## `showcase`

Something to look at: a rendered artifact, a plot set, an interactive
explorer.

- Status: `DRAFT` (default) / `READY` / `OUTDATED`.
- Recommended H2s: `What to show`, `How to reproduce`, `Assets`.

Usually the bundle form (`memon wiki create showcase <slug> --bundle`), with
`data/` and `views/<slug>/index.html`. `How to reproduce` is mandatory in
substance: the exact command, the input data, and the Experiment that produced
it — a showcase nobody can regenerate becomes `OUTDATED` the first time the
data moves. See `html-bundle.md` before writing any HTML.

## `note`

Durable context that fits no other kind: a glossary, an environment quirk, a
reading summary, an onboarding page.

- Status: none.
- Recommended H2s: none — free-form.

`note` is the honest choice for content that is not a claim. It is not a
dumping ground: if the content is really a finding without evidence, write the
`finding` as `TENTATIVE` instead so it shows up in the evidence workflow.

## `harness-feedback`

A gap in memon itself, surfaced by real work.

- Status: `PROPOSED` (only value an agent may write) / `ACCEPTED` / `SHIPPED`
  / `REJECTED` (human-owned).
- Recommended H2s: `Motivation`, `Proposal`, `Status`.

`Motivation` describes the concrete moment the gap hurt, with the page or task
it happened in. `Proposal` describes the smallest change that would fix it —
a new kind, a CLI flag, a dashboard affordance — not a redesign. These pages
are the input to an OpenSpec change in the harness repo; the agent writes them
and stops there.

## Reserved: `code-review`

`code-review` is reserved for a later consolidation. `memon wiki create
code-review …` and `memon wiki move <page> code-review` exit 2. Code reviews
are authored by `memon-write-code-review` under their existing paths.

## Unknown kinds

A directory outside the canonical list is still discovered — its pages are
readable and listable — but lints `WIKI_UNKNOWN_KIND`. Do not create one. If
an existing project has one, report it and offer to `move` its pages into a
canonical kind rather than deleting anything.

## At a glance

| kind | status vocabulary | required | recommended H2s |
|---|---|---|---|
| `meeting` | — | `date` | Attendees, Notes, Decisions, Action items |
| `roadmap` | — | — | content-defined research tree |
| `finding` | `TENTATIVE` / `VERIFIED` / `RETRACTED` | non-empty `sources` | Claim, Evidence, Limits |
| `bottleneck` | `OPEN` / `MITIGATED` / `RESOLVED` | — | Problem, Impact, Status, Candidates |
| `question` | `OPEN` / `ANSWERED` / `DROPPED` | — | Question, Context, Answer |
| `decision` | `PROPOSED` / `ACCEPTED` / `SUPERSEDED` | — | Decision, Rationale, Consequences |
| `showcase` | `DRAFT` / `READY` / `OUTDATED` | — | What to show, How to reproduce, Assets |
| `note` | — | — | free-form |
| `harness-feedback` | `PROPOSED` / `ACCEPTED` / `SHIPPED` / `REJECTED` | — | Motivation, Proposal, Status |

A missing recommended H2 is a `WIKI_MISSING_SECTION` warning, never an error.
Extra or reordered sections produce no diagnostic.
