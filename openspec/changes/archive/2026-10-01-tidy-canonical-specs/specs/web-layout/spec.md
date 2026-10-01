## MODIFIED Requirements

### Requirement: Status display uses colored Badge with lucide icon

Run status (`PENDING` / `RUNNING` / `FINISHED` / `INTERRUPTED` / `FAILED` / `UNKNOWN`), experiment-doc status (`OPEN` / `RESOLVED` / `ABANDONED`), and hypothesis status (`CONFIRMED` / `REFUTED` / `PARTIAL` / `OPEN` / `DEFERRED`) SHALL render in the UI as a `<Badge variant="outline">` with a `lucide-react` icon plus the enum string. A status emoji SHALL never be shown in the rendered UI. On disk, Run README and experiment-doc frontmatter store only the bare enum string; `docs/hypotheses.md` is the only file whose status notation uses emoji, which the hypotheses parser maps back to the enum before rendering.

Run-status color family and icon mapping (each color family has light and dark variants):

| Status | Badge color family | Lucide icon |
|---|---|---|
| `PENDING` | slate (neutral gray) | `Clock` |
| `RUNNING` | sky (blue) | `Loader2` (spinning unless archived) |
| `FINISHED` | emerald (green) | `CheckCircle2` |
| `INTERRUPTED` | amber (yellow) | `PauseCircle` |
| `FAILED` | red | `XCircle` |
| `UNKNOWN` | rose (deeper / muted red, distinct from `FAILED`) | `HelpCircle` |

`UNKNOWN` SHALL render in the rose family so it is visually separable from `FAILED` (the red family) at-a-glance, while still reading as "needs attention" rather than "neutral."

ExperimentStatus color family and icon mapping:

| Status | Badge color family | Lucide icon |
|---|---|---|
| `OPEN` | sky (blue, mirrors `RUNNING`'s family) | `CircleDot` |
| `RESOLVED` | emerald (green) | `CheckCircle2` |
| `ABANDONED` | stone (warm gray) | `XCircle` |

Hypothesis-status color family and icon mapping:

| Status | Badge color family | Lucide icon |
|---|---|---|
| `CONFIRMED` | emerald (green) | `CheckCircle2` |
| `REFUTED` | red | `XCircle` |
| `PARTIAL` | amber | `CircleDot` |
| `OPEN` | sky (blue) | `Circle` |
| `DEFERRED` | muted theme tokens | `CircleSlash` |

Each status SHALL be composed via `cn()` over shadcn `Badge` (never by forking `badge.tsx`).

Stale-RUNNING marker SHALL render as an amber `lucide-react AlertTriangle` icon next to the badge — not the ⚠ emoji.

Archived items (per `archive-frontmatter`'s "Visual treatment of archived items") SHALL render their status pill in a desaturated variant of the same color family, prefixed by a `lucide Archive` icon.

#### Scenario: Run status pill — PENDING
- **WHEN** rendering a run with status PENDING
- **THEN** the pill shows a `Clock` icon + the text `PENDING` on a slate (neutral-gray) Badge

#### Scenario: Run status pill — RUNNING
- **WHEN** rendering a run with status RUNNING
- **THEN** the pill shows a spinning `Loader2` icon + the text `RUNNING` on a sky-tinted Badge; the text `🟢` does not appear in the DOM

#### Scenario: Run status pill — FINISHED
- **WHEN** rendering a run with status FINISHED
- **THEN** the pill shows a `CheckCircle2` icon + the text `FINISHED` on an emerald Badge

#### Scenario: Run status pill — INTERRUPTED
- **WHEN** rendering a run with status INTERRUPTED
- **THEN** the pill shows a `PauseCircle` icon + the text `INTERRUPTED` on an amber Badge; the text `⏸` does not appear in the DOM

#### Scenario: Run status pill — FAILED
- **WHEN** rendering a run with status FAILED
- **THEN** the pill shows an `XCircle` icon + the text `FAILED` on a red Badge

#### Scenario: Run status pill — UNKNOWN distinct from FAILED
- **WHEN** rendering a run with status UNKNOWN
- **THEN** the pill shows a `HelpCircle` icon + the text `UNKNOWN` on a rose Badge (deeper / muted-red)
- **AND** the badge color resolves to a different value than the FAILED pill on the same page

#### Scenario: Stale-RUNNING marker
- **WHEN** the run status is RUNNING and `stale` is true (no directory activity for >1h)
- **THEN** an amber `AlertTriangle` lucide icon is rendered immediately adjacent to the badge; the text `⚠` does not appear in the DOM

#### Scenario: Hypothesis status pill
- **WHEN** rendering a hypothesis card with status PARTIAL
- **THEN** the pill shows a `CircleDot` icon + the text `PARTIAL` on an amber-tinted Badge; the text `🟡` does not appear in the DOM

#### Scenario: Experiment status pill — OPEN
- **WHEN** rendering an experiment card with status OPEN
- **THEN** the pill shows a `CircleDot` icon + the text `OPEN` on a sky Badge
- **AND** if a sibling RUNNING run pill is on the same page, the OPEN exp pill and the RUNNING run pill share the sky color family but are distinguishable by icon (`CircleDot` vs spinning `Loader2`) and label

#### Scenario: Experiment status pill — RESOLVED
- **WHEN** rendering an experiment card with status RESOLVED
- **THEN** the pill shows a `CheckCircle2` icon + the text `RESOLVED` on an emerald Badge

#### Scenario: Experiment status pill — ABANDONED
- **WHEN** rendering an experiment card with status ABANDONED
- **THEN** the pill shows an `XCircle` icon + the text `ABANDONED` on a stone-gray Badge
- **AND** the gray reads as "moved on," not as an error (the red color is reserved for FAILED runs)

#### Scenario: Archived overlay desaturates the status pill
- **WHEN** rendering any item with `archived: true` (run or exp)
- **THEN** the status pill SHALL render in the desaturated variant of its color family
- **AND** a `lucide Archive` icon prefixes the status pill in the same Badge
- **AND** an archived RUNNING pill's `Loader2` icon does not spin
