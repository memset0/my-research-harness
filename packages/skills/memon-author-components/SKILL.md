---
name: memon-author-components
description: "Write registered fenced-block components inside memon Markdown — wiki pages, Experiment READMEs, Run READMEs, code reviews, digests, and Reports. Use when a section needs a reproducible data table, an embedded HTML view, or any other block the plain Markdown renderer cannot express, and you need to know which component exists, how to write it, and how to verify it renders."
---

# memon-author-components

The only skill that describes how to author registered components. Other memon
skills route here; they do not restate these rules.

A component is a fenced code block whose info string names a registered
component and a pinned major version:

````markdown
```memon-data@1 title="Brightness bias by CFG scale"
columns: [cfg, baseline, zero_snr]
rows:
  - [4.5, 0.061, 0.009]
  - [7.5, 0.087, 0.011]
```
````

The renderer is shared across every Markdown surface memon renders, so the
same block works in a wiki page, an Experiment README, a Run README, a code
review, a digest, and a Report. An unregistered info string is just an
ordinary code block — no diagnostic, no rendering, no harm.

## When to use

- A section needs a table whose numbers must stay traceable to a collector.
- A section needs an embedded HTML view inside otherwise ordinary Markdown.
- You are about to hand-roll a `<div>` soup and want to know whether a
  component already covers it.
- A block you wrote lints `WIKI_COMPONENT_UNPINNED`, `WIKI_COMPONENT_INVALID`,
  `WIKI_DATA_BLOCK_INVALID`, or `WIKI_DATA_PROVENANCE_MISSING`.

## When NOT to use

- Ordinary prose, lists, links, and small Markdown tables — those need no
  component and should not get one.
- Callouts: GitHub alert blockquotes (`> [!NOTE]`, `> [!WARNING]`,
  `> [!DEPRECATED]`, …) already render as styled callouts.
- Page-level HTML in a wiki bundle (`entry:` frontmatter) — that is the wiki
  bundle contract, not a component.
- Adding, changing, or versioning a component. That is a harness change in the
  memon repo, not authoring work; surface the need instead (see the last
  section).

## Step 1 — Name the content shape first

Before looking at any registry, say in one phrase what the content *is*:

- "a table of five numbers whose values must be reproducible from a script";
- "a diagram of the training pipeline";
- "an interactive scatter plot the reader can filter";
- "three sentences and a link".

Then choose:

**Plain Markdown is the default and the right answer for most sections.** A
static table that nobody will regenerate is a Markdown table. A one-off image
is an image. Reach for a component only when the content shape needs something
the plain renderer cannot give it: reproducibility metadata, or an HTML
runtime.

Do not ask the user which component to use, and do not show a draft block for
approval. Pick the one that matches the shape you just named, write it, and
let lint and the rendered page be the feedback loop.

## Step 2 — Read the registry

The registry lives on the central dashboard, and the CLI is its only
reference — there is no committed Markdown catalogue that could drift from the
code. Both commands need a central address, via `--central <url>` or
`MEMON_CENTRAL_URL`; without one they exit 2 and name both options.

```sh
memon --project-root . wiki components ls --central <url>
memon --project-root . wiki components show memon-data@1 --central <url>
```

`ls` prints each registered component with its version, a one-line
description, and whether the pinned version you have is outdated.

`show <name>[@N]` is the authoritative per-component manual. Read all of it
before writing a block; it prints, in order:

1. what the component is for and when to use it;
2. its accepted arguments and their effect;
3. valid example blocks you can copy;
4. invalid example blocks, each paired with the lint code it triggers — read
   these, they are the fastest way to learn the constraints;
5. `Rendered examples:` pointers to fixture pages in the mock project that
   contain a live block of that component.

Open a fixture pointer when the printed example is not enough. The fixture
wiki *is* the coverage documentation; there is no separate catalogue page.

Never copy a field list from this skill or from another page into your block —
this skill deliberately contains no component field reference. The registry
output is the contract.

## Step 3 — Write the block

Rules that apply to every component:

- **Always pin the version** (`memon-data@1`, not `memon-data`). An unpinned
  block still resolves to the highest registered version, but lints
  `WIKI_COMPONENT_UNPINNED` and will silently change meaning when a new major
  version ships.
- **Attributes go in the info string**, payload goes in the block body, in the
  shape `show` documents. Do not invent an attribute; an unknown one lints
  `WIKI_COMPONENT_INVALID`.
- **Relative payload paths resolve against the containing document's asset
  route.** Inside a wiki bundle, `./data/metrics.csv` works; in a single-file
  page there is no asset route, so use the inline form instead.
- **Keep the block small enough to diff.** Inline rows are for tables where a
  human should see the change in a commit; a file under the bundle's `data/`
  is for anything large or shared between blocks.

Currently registered: `memon-data@1` (tabular data with provenance) and
`html-embed@1` (an embedded HTML document). Confirm against `components ls`
rather than trusting this sentence — the registry is the truth.

### Data blocks are captured by hand

There is no automatic capture. Run the collector yourself, read its output,
and paste the resulting rows into the block along with the provenance fields
`show` documents. A data block whose rows were never produced by running its
own collector is a fabricated table; do not write one.

Collector scripts live outside the document — in the project's `scripts/`
directory, not inside `docs/wiki/` — and are committed separately from the
page that references them.

## Step 4 — Verify

Two checks, in this order, every time:

```sh
memon --project-root . wiki lint --strict --central <url>
```

**Read the diagnostics text, not just the exit code.** Component validation
happens centrally, so a lint run without `--central` reports only the
structural `WIKI_COMPONENT_UNPINNED` and will happily exit 0 on a block with
ragged rows or a missing data file. A clean structural lint proves nothing
about the component payload.

Then, whenever a dashboard is reachable, open the page and look at it. A block
can lint clean and still render as an empty table, an unreadable overflow, or
a blank iframe. Fix what you see before handing off.

## When nothing fits

Do not force the closest component and do not invent an info string.

1. Write raw HTML at the narrowest scope that works: inline HTML for static
   structure (scripts inside inline HTML do not execute), an `html-embed`
   block for a self-contained interactive fragment, or — for a wiki bundle
   page — a `views/<slug>/index.html` referenced by frontmatter `entry`.
2. Say in the surrounding prose that this is hand-written HTML and why no
   component covered it.
3. Create a `harness-feedback` page proposing the component:

   ```sh
   memon --project-root . wiki create harness-feedback interactive-3d-plot-component \
     --title "Wiki needs an interactive 3-D plot component" \
     --description "Rotatable 3-D scatter plots are currently hand-written HTML in every page that needs one." \
     --status PROPOSED
   ```

   `Motivation` names the page and the moment the gap hurt; `Proposal` names
   the smallest component that would close it. Leave the status at `PROPOSED`
   — accepting it is a human decision, and shipping it is an OpenSpec change
   in the harness repo.

## Guardrails

- Never write an unpinned component info string.
- Never document or copy component fields from memory; run `components show`.
- Never claim a data table is current without having run its collector in this
  task.
- Never treat a structural-only lint pass as verification of a component.
- Never add, edit, or version a component from a project working tree; the
  registry ships with the harness.
- Never ask the user to choose the component or approve a draft block; lint
  and the rendered page are the review loop.
