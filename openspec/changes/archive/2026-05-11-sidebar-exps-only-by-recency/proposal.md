## Why

The project sidebar currently renders **two** sub-sections under each
expanded project: an `Experiments` list (v3 exp docs from
`fetchExperimentDocs`) AND a `Runs` list (legacy v2 `IndexedRun` from
`fetchExperiments`). This contradicts the existing
`web-layout` spec — "Per-project collapsed-by-default with on-demand
run list" — whose body explicitly says the sidebar SHALL show
**experiments**, sorted by `effective_updated_at` descending, and
SHALL NOT show a separate runs entry. The implementation drifted from
the spec at some point during the v2→v3 rename.

Two concrete problems result:

1. **Visual noise.** Every expanded project shows two stacked lists;
   the Runs list duplicates information that's already reachable via
   each exp's detail page (each exp panel lists its member runs).
   Users get a longer scroll for less unique information.
2. **No sort guarantee.** `ProjectExperimentDocs` renders exps in the
   API's natural order (filename / id ascending). The exp list page
   (`experiment-card-grid.tsx`) sorts by `effectiveUpdatedAt`
   descending. The two surfaces disagree, so "the recent thing I was
   looking at" doesn't appear at the top of the sidebar — it could be
   anywhere.

Bringing the implementation back in line with the spec — and tightening
the spec wording so the next reader can't re-introduce the same drift
— is a small focused change.

## What Changes

- **Remove the `Runs` sub-section** (`ProjectExperiments` component +
  its `fetchExperiments` query + the `IndexedRun` import) from
  `apps/web/components/app-sidebar.tsx`. Each expanded project group
  renders **only** the experiments list.
- **Sort the experiments list** in `ProjectExperimentDocs` by
  `effectiveUpdatedAt` descending (string `localeCompare` is correct
  because timestamps are ISO8601 with offset; same technique
  `experiment-card-grid.tsx` uses).
- **Drop the now-redundant `Experiments` sub-header label** above the
  list. With only one sub-section per project, the label is visual
  clutter — the project group header already disambiguates.
- **Keep** the existing 5 + `View more` pagination (no change).
- **Keep** the right-side `runs.length` count badge per exp row (no
  change).
- **Update the `web-layout` spec** (MODIFIED in place; titles preserved
  to avoid validator ambiguity around requirement-name changes — the
  body carries the new normative content):
  - Add an explicit normative line: "The sidebar SHALL NOT render a
    separate `Runs` sub-section under any project group." (Today the
    spec says it SHALL NOT show a separate "All Runs" entry, which
    is about a different element. Tighten to cover per-project
    sub-sections too.)
  - Add an explicit normative line on sort key + direction: "The
    experiment list SHALL be sorted by `effectiveUpdatedAt`
    descending so the most recently active experiment appears at
    the top — matching the default order on the `Experiments` list
    page (`experiment-card-grid.tsx`)."
  - Note: requirement titles "Per-project collapsed-by-default with
    on-demand **run list**" and "**5 runs**" are preserved verbatim
    in the canonical spec because OpenSpec's MODIFIED operation
    matches on title. The body of each requirement is the canonical
    normative content; readers should ignore the v2-era wording in
    the titles.
- **Update the existing sidebar test** (`app-sidebar.test.tsx`) to
  mock `fetchExperimentDocs` (currently it mocks `fetchExperiments`,
  which after this change the sidebar no longer calls). Add a small
  test that asserts the rendered exp rows are in
  `effectiveUpdatedAt`-descending order.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-layout`: tighten the existing sidebar requirements to
  (a) drop the per-project `Runs` sub-section, (b) make the sort key
  explicit, (c) align the requirement title with its body.

## Impact

- **Code — `apps/web/components/app-sidebar.tsx`**: delete
  `ProjectExperiments`, drop the `fetchExperiments` / `IndexedRun`
  imports, delete the `Experiments` sub-header `<div>`, add
  `.slice().sort((a, b) => b.effectiveUpdatedAt.localeCompare(a.effectiveUpdatedAt))`
  inside `ProjectExperimentDocs`. Net: -1 component, -1 sub-header,
  +1 sort line.
- **Code — `apps/web/components/app-sidebar.test.tsx`**: swap the
  `fetchExperiments` mock for `fetchExperimentDocs`. Add a sort-order
  assertion test.
- **API**: no changes. `GET /api/experiments?project=…` already
  returns `effectiveUpdatedAt` on each item; the sidebar already
  consumes that field.
- **Specs**: delta on `web-layout` only.
- **Other consumers of the now-unused sidebar imports**: none — the
  `fetchExperiments` / `IndexedRun` symbols are still used elsewhere
  (e.g. orphan run cards, manage pages); we're only removing the
  *sidebar's* use of them.
- **Test impact**: the active-project / persistence tests should pass
  unchanged once the mock swap lands (both test scenarios are
  independent of which sub-section renders inside the project group).
- **Migration / FS_CONVENTION_VERSION**: none. UI-only change, no
  on-disk format impact.
