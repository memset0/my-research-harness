## Context

See proposal.md for motivation. 29 canonical specs carry the archive-time
`TBD` Purpose placeholder, which is the only reason `openspec validate --all
--strict` fails on them. Separately, five canonical requirements contradict the
shipped code or each other (`wiki-cli`, `experiment-readme` + `web-layout`,
`run-edit`, `experiment-edit`). This change is documentation-only; no code,
test, skill or release-version change is made.

## Goals / Non-Goals

**Goals:**
- Every canonical spec has a real Purpose and `openspec validate --all --strict`
  passes for all 71 canonical specs.
- The four contradiction areas describe what the code actually does.

**Non-Goals:**
- Merging, splitting, renaming or deleting spec directories.
- Fixing other drift not listed in the proposal (see Future).
- Changing any behavior to match a spec.

## Decisions

### D1. Purpose is edited directly; requirements go through deltas

A Purpose is not a requirement: the delta format has no operation that can
change it, and archive ignores a `## Purpose` in a delta for an existing
capability. The 29 Purposes are therefore edited in place in
`openspec/specs/<name>/spec.md` during apply, while every requirement change
is expressed as a MODIFIED/REMOVED delta under
`openspec/changes/tidy-canonical-specs/specs/` and reaches the canonical specs
only through sync at archive. Alternative considered: a separate tooling
commit outside OpenSpec — rejected because the Purposes should be reviewed
together with the change that motivates them.

Each Purpose is 2–4 English sentences in the register of the existing
non-placeholder Purposes: what the capability is, who it serves, its boundary,
and where its source of truth lives. Before writing one, the spec's
requirements were read and the code was checked for the feature. A spec whose
feature no longer exists would get a one-line `Deprecated: … superseded by …`
Purpose and be listed as a retirement candidate instead of receiving an
invented Purpose; none of the 29 met that bar (every described surface still
has code in `packages/*` or `apps/web`).

### D2. Contradictions are fixed toward the shipped behavior

- `wiki-cli`: the subcommand list is aligned with the registered commander
  tree; `stale`, `data`, `components` are explicitly not registered.
- `experiment-readme`: the duplicated Run status-enum requirement is REMOVED
  (`run-readme` stays authoritative) and the ExperimentStatus requirement
  drops the emoji table. `web-layout`'s status-display requirement is MODIFIED
  so icons and colour families match `apps/web/components/status-pill.tsx`
  (e.g. `PENDING` uses `Clock`) and so the on-disk emoji scope is precise
  (only `docs/hypotheses.md`). Colour classes are stated as colour families
  rather than exact Tailwind strings to avoid re-drifting on palette tweaks.
- `run-edit`: the old warnings requirement is REMOVED and replaced by an
  ADDED one (a rename was needed because its scenario names asserted the
  wrong behavior); it states that Runs store no
  warnings and that `memon run warning add` is a deprecated write-through
  entry to the parent Experiment. It no longer cites the
  `LEGACY_SECTION_IN_RUN` code, which the parser does not emit.
- `experiment-edit`: the `## Plan` requirement is REMOVED; `status set` and
  the README PUT are MODIFIED for the bundle path and invocation receipts.

## Risks / Trade-offs

- [Purposes drift again as code evolves] → Purposes name the owning package or
  directory rather than enumerate details, and requirements stay the detailed
  contract.
- [Deltas only land at archive, so canonical specs remain contradictory until
  then] → acceptable; the change stays active with deltas validated, and the
  user decides when to archive.

## Future

Recommendations only; not executed here:
- Consolidate spec granularity: the seven `wiki-*` specs into about three;
  split `web-layout` (~1.6k lines) and `web-dashboard` by surface; merge
  `log-viewer` / `log-viewer-tools` and `reports-store` / `report-workspace`.
- Retire `commit-verification` (body already marked Deprecated in favour of
  wiki review) and `digests-store` (Digests retired to the Wiki) through
  REMOVED deltas, then delete the directories.
- Remaining legacy journal wording (`[EXPERIMENT]`, `[BIND]`, `[RENAME]`,
  `[ARCHIVE]` JOURNAL events) in `experiment-edit` and `archive-frontmatter`
  should be rewritten for invocation receipts.
- `run-readme` still names a `LEGACY_SECTION_IN_RUN` warning that the parser
  does not emit.
