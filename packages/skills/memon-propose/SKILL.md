---
name: memon-propose
description: Read a memon project's hypotheses, structured Investigations and Results, Findings, Limitations, Runs, journal, digests, and reports to brainstorm and rank useful next Experiments or Variant sets. Use when the user asks what to investigate next; remain read-only and hand selected ideas to memon-drive.
---

# memon-propose

Act as a read-only research collaborator. Diverge into credible alternatives,
then converge to the strongest few. Do not scaffold, edit, or launch anything.

## Preflight

Run `memon --project-root . --format json fs-version check` first. Continue only
for `match`; otherwise follow `../PREFLIGHT.md` and stop without reading spec
files.

## Memon CLI issue handoff

For every `memon` command used by this skill, follow the CLI issue handoff in
`../PREFLIGHT.md`. After safely finishing the requested task, report any CLI
crash, valid-input rejection, malformed/inconsistent output, or required CLI
workaround; if it blocks completion, report it in the blocked handoff. Do not
mislabel an expected validation or domain-state rejection as a CLI bug.

## Snapshot the project

Read:

1. `docs/hypotheses.md`, especially `OPEN` and `PARTIAL` hypotheses.
2. Relevant Experiments' Motivation, Design, Implementation, Investigation,
   Results, Findings, Limitations, Conclusion, and Warnings.
3. Selected Runs and failed/invalid Attempts, including their Setup/Result.
4. Open Journal requests and recent notes/errors.
5. Recent digests and theme reports.

Use the canonical projections:

```sh
memon --project-root . --format human experiment doc render <id> investigation
memon --project-root . --format human experiment doc render <id> results
memon --project-root . --format json experiment doc lint <id>
```

Read unsupported README sections too. They are legacy/user context even though
lint reports them.

## Avoid duplicate work

Before proposing a candidate, ask:

- Is an equivalent Investigation already `PLANNED`, `IN_PROGRESS`, or
  `BLOCKED`?
- Does an existing Variant already represent the condition?
- Did an Attempt fail for a mechanical reason that should be fixed first?
- Is the evidence already sufficient in Findings/Conclusion?
- Does a Limitation identify a more valuable missing axis?
- Is an Implementation dependency unresolved?

Reusing a baseline Variant is preferable to duplicating it. Repeating a failed
condition is useful only when the new proposal addresses its failure or tests a
different claim.

## Diverge

Produce 5–8 concise candidates grounded in current evidence. Include a mix of:

- direct hypothesis probes;
- ablations and controls;
- cheap falsification tests;
- replication/robustness checks;
- follow-ups to surprising Results or Attempts;
- at least one orthogonal or unconventional direction.

For each candidate state:

- question and rationale;
- expected evidence / success criterion;
- likely Investigation placement;
- candidate Variant axes and reused baselines;
- Implementation dependency, if any;
- estimated compute/time and primary risk.

When useful, show the proposed Variant set as a Markdown table. These are
proposals only; do not allocate IDs or write `results.yaml`.

## Converge

Rank the strongest 1–3 candidates by information gain, cost, feasibility,
relationship to open Investigation work, and ability to resolve a known
Limitation. For each include:

```markdown
## Proposal: <short name>

**Question:** ...

**Why now:** ...

**Investigation sketch:** ...

| Candidate condition | Changed parameters | Reused baseline | Expected evidence |
|---|---|---|---|
| ... | ... | ... | ... |

**Implementation dependency:** none / ...

**Cost and risk:** ...

**Why this beats alternatives:** ...
```

Explicitly name when the best next action is to finish an existing
Investigation rather than create a new Experiment.

## Stop and hand off

Ask the user which proposal, if any, they want to pursue. Do not write the
choice. Once selected, hand it to `memon-drive`, which will discuss/define the
structured Investigation and pre-launch Variants through
`memon-write-experiment-doc`.

## Guardrails

- Never modify files, statuses, YAML, or the Journal.
- Never assume a hard-coded number of Runs is enough evidence.
- Never treat Attempts as if they were selected Results, but do learn from their
  failure modes.
- Never propose a Variant as an after-the-fact label for an already launched
  Run.
- Never mistake Implementation work for the research question it enables.
