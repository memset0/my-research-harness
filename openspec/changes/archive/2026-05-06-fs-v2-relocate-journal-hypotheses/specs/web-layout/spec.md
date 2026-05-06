## MODIFIED Requirements

### Requirement: Status display uses colored Badge with lucide icon

Both experiment-run status (`PENDING` / `RUNNING` / `FINISHED` / `FAILED` / `UNKNOWN`) and hypothesis status (`CONFIRMED` / `REFUTED` / `PARTIAL` / `OPEN` / `DEFERRED`) SHALL render in the UI as a `<Badge variant="outline">` with a `lucide-react` icon plus the enum string. The on-disk `docs/journal.md` / `docs/hypotheses.md` / `README.md` files continue to use the canonical emoji (📝 🟢 ✅ ❌ ❓ for runs, ✅ ❌ 🟡 🔵 ⚪ for hypotheses) per the parsing spec; the **emoji is never shown in the rendered UI**.

Each status uses a distinct color family (composed via `cn()` over shadcn `Badge`, never by forking `badge.tsx`):
- emerald — success / confirmed
- red — failure / refuted
- amber — partial
- sky — running / open
- slate / muted — pending / deferred / unknown

Stale-RUNNING marker SHALL render as a `lucide-react AlertTriangle` icon next to (or inside) the badge — not the ⚠ emoji.

#### Scenario: Run status pill
- **WHEN** rendering an experiment with status RUNNING
- **THEN** the pill shows a spinning `Loader2` icon + the text `RUNNING` on a sky-tinted Badge; the text `🟢` does not appear in the DOM

#### Scenario: Stale-RUNNING marker
- **WHEN** the experiment status is RUNNING and `stale` is true (no directory activity for >1h)
- **THEN** an `AlertTriangle` lucide icon is rendered immediately adjacent to the badge in an amber color; the text `⚠` does not appear in the DOM

#### Scenario: Hypothesis status pill
- **WHEN** rendering a hypothesis card with status PARTIAL
- **THEN** the pill shows a `CircleDot` icon + the text `PARTIAL` on an amber-tinted Badge; the text `🟡` does not appear in the DOM

### Requirement: Hypothesis summary uses structured tags, not raw markdown

The hypothesis summary table at the top of `/p/<project>/hypotheses` SHALL be rendered as a structured component (one row per parsed `HypothesisEntry`) with columns `id` / `status` / `statement` / `experiments`. The `status` cell SHALL use `<HypothesisStatusPill>` (not the raw emoji from disk). Each `experiment` cell SHALL render the experiment id as a Next.js `<Link>` to `/p/<project>/experiments/<id>`. The raw `summaryTableBlock` from `docs/hypotheses.md` is NOT rendered as markdown in the UI.

#### Scenario: Summary row with multiple experiments
- **WHEN** a hypothesis is associated with `foo-260501-100000` and `bar-260502-150000`
- **THEN** the summary row shows both ids as Next.js `<Link>` elements; clicking either navigates client-side (no full page reload) to that experiment
