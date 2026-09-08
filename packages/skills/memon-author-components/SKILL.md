---
name: memon-author-components
description: "Write registered fenced-block components inside memon Markdown — wiki pages, Experiment READMEs, Run records, code reviews, and Reports. Use when a section needs a reproducible data table, an embedded HTML view, or any other block the plain Markdown renderer cannot express, and you need to know which component exists, how to write it, and how to verify it renders."
---

# memon-author-components

The only skill that describes how to author registered components. Other memon
skills route here instead of restating these rules.

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

The renderer is shared across every Markdown surface memon renders, so the same
block works in a wiki page, an Experiment README, a Run record, a code review,
and a Report. An unregistered info string is just an ordinary code block — no
diagnostic, no rendering, no harm.

## When to use

- A table whose numbers must stay traceable to a collector.
- An embedded HTML view inside otherwise ordinary Markdown.
- You are about to hand-roll a `<div>` soup and want to know whether a component
  already covers it.
- A block you wrote lints `WIKI_COMPONENT_UNPINNED`, `WIKI_COMPONENT_INVALID`,
  `WIKI_DATA_BLOCK_INVALID`, or `WIKI_DATA_PROVENANCE_MISSING`.

## When NOT to use

- Ordinary prose, lists, links, and small Markdown tables.
- Callouts: GitHub alert blockquotes (`> [!NOTE]`, `> [!WARNING]`,
  `> [!DEPRECATED]`, …) already render as styled callouts.
- Page-level HTML in a wiki bundle (`entry:` frontmatter) — that is the wiki
  bundle contract, not a component.
- Adding, changing, or versioning a component: that is a harness change in the
  memon repo. Surface the need instead (last section).

## Step 1 — Name the content shape

Say in one phrase what the content *is* — "five numbers reproducible from a
script", "a diagram of the training pipeline", "an interactive scatter plot the
reader can filter", "three sentences and a link".

**Plain Markdown is the default and right answer for most sections.** A static
table nobody will regenerate is a Markdown table; a one-off image is an image.
Reach for a component only when the shape needs reproducibility metadata or an
HTML runtime.

Do not ask the user which component to use and do not show a draft block for
approval: pick the one matching the shape, write it, and let lint and the
rendered page be the feedback loop.

## Step 2 — Read the registry

The registry lives on the central dashboard and the CLI is its only reference;
there is no committed catalogue to drift. Both commands need `--central <url>`
or `MEMON_CENTRAL_URL`; without one they exit 2 and name both options.

```sh
memon --project-root . wiki components ls --central <url>
memon --project-root . wiki components show memon-data@1 --central <url>
```

`ls` prints each registered component with its version, a one-line description,
and whether your pinned version is outdated. `show <name>[@N]` is the
authoritative manual — read all of it before writing: purpose and when to use
it, accepted arguments, valid examples to copy, invalid examples paired with the
lint code each triggers, and `Rendered examples:` pointers to fixture pages with
a live block. Open a fixture when the printed example is not enough; the fixture
wiki *is* the coverage documentation.

Never copy a field list from this skill or another page into your block — this
skill deliberately contains no field reference. The registry output is the
contract.

## Step 3 — Write the block

- **Always pin the version** (`memon-data@1`). An unpinned block resolves to the
  highest registered version but lints `WIKI_COMPONENT_UNPINNED` and silently
  changes meaning when a new major ships.
- **Attributes in the info string, payload in the body**, in the shape `show`
  documents. An invented attribute lints `WIKI_COMPONENT_INVALID`.
- **Relative payload paths resolve against the containing document's asset
  route.** Inside a wiki bundle `./data/metrics.csv` works; a single-file page
  has no asset route, so use the inline form.
- **Keep the block diffable.** Inline rows for tables a human should see change
  in a commit; a file under the bundle's `data/` for anything large or shared.

Currently registered: `memon-data@1` (tabular data with provenance) and
`html-embed@1` (an embedded HTML document) — confirm against `components ls`
rather than trusting this sentence.

Data blocks are captured by hand: run the collector yourself, read its output,
and paste the rows with the provenance fields `show` documents. A data block
whose rows were never produced by running its own collector is a fabricated
table. Collector scripts live in the project's `scripts/`, not inside
`docs/wiki/`, and are committed separately from the page.

## Step 4 — Verify

```sh
memon --project-root . wiki lint --strict --central <url>
```

**Read the diagnostics, not just the exit code.** Component validation happens
centrally: a lint run without `--central` reports only structural
`WIKI_COMPONENT_UNPINNED` and exits 0 on ragged rows or a missing data file. A
clean structural lint proves nothing about the payload.

Then, whenever a dashboard is reachable, open the page and look at it. A block
can lint clean and render as an empty table, an unreadable overflow, or a blank
iframe. Fix what you see before handing off.

## When nothing fits

Do not force the closest component and do not invent an info string.

1. Write raw HTML at the narrowest scope that works: inline HTML for static
   structure (its scripts do not execute), an `html-embed` block for a
   self-contained interactive fragment, or — in a wiki bundle — a
   `views/<slug>/index.html` referenced by frontmatter `entry`.
2. Say in the surrounding prose that this is hand-written HTML and why.
3. Create a `harness-feedback` page proposing the component:

   ```sh
   memon --project-root . wiki create harness-feedback interactive-3d-plot-component \
     --title "Wiki needs an interactive 3-D plot component" \
     --description "Rotatable 3-D scatter plots are hand-written HTML in every page that needs one." \
     --status PROPOSED
   ```

   `Motivation` names the page and the moment the gap hurt; `Proposal` names the
   smallest component that would close it. Leave the status `PROPOSED` —
   accepting it is a human decision and shipping it is a harness change.

## Guardrails

- Never write an unpinned component info string.
- Never document or copy component fields from memory; run `components show`.
- Never claim a data table is current without having run its collector in this
  task.
- Never treat a structural-only lint pass as verification of a component.
- Never add, edit, or version a component from a project working tree.
- Never ask the user to choose the component or approve a draft block.
