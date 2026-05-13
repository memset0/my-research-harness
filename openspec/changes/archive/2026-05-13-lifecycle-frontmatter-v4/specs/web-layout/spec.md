## MODIFIED Requirements

### Requirement: Status display uses colored Badge with lucide icon

Run status (`PENDING` / `RUNNING` / `FINISHED` / `INTERRUPTED` / `FAILED` / `UNKNOWN`), experiment-doc status (`OPEN` / `RESOLVED` / `ABANDONED`), and hypothesis status (`CONFIRMED` / `REFUTED` / `PARTIAL` / `OPEN` / `DEFERRED`) SHALL render in the UI as a `<Badge variant="outline">` with a `lucide-react` icon plus the enum string. The on-disk `docs/journal.md` / `docs/hypotheses.md` / `README.md` / experiment-doc files continue to use the canonical emoji per the parsing spec; the **emoji is never shown in the rendered UI**.

Run-status color and icon mapping:

| Status | Badge color (Tailwind / shadcn) | Lucide icon |
|---|---|---|
| `PENDING` | `bg-muted text-muted-foreground border-border` (neutral gray) | `Circle` |
| `RUNNING` | `bg-sky-100 text-sky-800 border-sky-300` (blue) | `Loader2` (spinning) |
| `FINISHED` | `bg-emerald-100 text-emerald-800 border-emerald-300` (green) | `CheckCircle2` |
| `INTERRUPTED` | `bg-amber-100 text-amber-800 border-amber-300` (yellow / amber) | `PauseCircle` |
| `FAILED` | `bg-red-100 text-red-800 border-red-300` (red) | `XCircle` |
| `UNKNOWN` | `bg-rose-50 text-rose-900 border-rose-200` (deeper / muted-red, distinct from `FAILED`) | `HelpCircle` |

`UNKNOWN` SHALL render in a deeper / muted-red tone (the rose family) so it is visually separable from `FAILED` (the red family) at-a-glance, while still reading as "needs attention" rather than "neutral."

ExperimentStatus color and icon mapping:

| Status | Badge color | Lucide icon |
|---|---|---|
| `OPEN` | `bg-sky-100 text-sky-800 border-sky-300` (blue, mirrors `RUNNING`'s family) | `CircleDot` |
| `RESOLVED` | `bg-emerald-100 text-emerald-800 border-emerald-300` (green) | `CheckCircle2` |
| `ABANDONED` | `bg-stone-100 text-stone-800 border-stone-300` (warm gray) | `XCircle` |

Each status SHALL be composed via `cn()` over shadcn `Badge` (never by forking `badge.tsx`). Hypothesis-status mapping is unchanged from the prior version of this requirement.

Stale-RUNNING marker SHALL render as a `lucide-react AlertTriangle` icon next to (or inside) the badge — not the ⚠ emoji.

Archived items (per `archive-frontmatter`'s "Visual treatment of archived items") SHALL render their status pill in a desaturated variant of the same color family (e.g. `bg-emerald-50 text-emerald-600 border-emerald-200` for `RESOLVED`-archived in place of the active variant), prefixed by a `lucide Archive` icon.

#### Scenario: Run status pill — PENDING
- **WHEN** rendering a run with status PENDING
- **THEN** the pill shows a `Circle` icon + the text `PENDING` on a neutral-gray Badge

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
- **AND** the badge color resolves to a different oklch() value than the FAILED pill on the same page

#### Scenario: Stale-RUNNING marker
- **WHEN** the experiment status is RUNNING and `stale` is true (no directory activity for >1h)
- **THEN** an `AlertTriangle` lucide icon is rendered immediately adjacent to the badge in an amber color; the text `⚠` does not appear in the DOM

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
- **THEN** the status pill SHALL render in the desaturated variant of its color family (e.g. `bg-emerald-50` instead of `bg-emerald-100` for a RESOLVED-archived exp)
- **AND** a `lucide Archive` icon prefixes the status pill in the same Badge
