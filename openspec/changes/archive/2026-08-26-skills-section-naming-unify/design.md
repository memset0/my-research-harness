## Context

The user's original guidance (paraphrased): "Constraints 里的 ✅ 项移到对应的 ## Workflow 步骤里作为加粗 invariant；保留的 ❌ 项整合进 Anti-patterns".

Reading the actual ✅ bullets in `memon-digest-journal` and `memon-write-report`, they are not new content — every one is already stated as an imperative (often already bolded) somewhere in the workflow body. Examples:

- `digest-journal` ✅ "INVOCATION_TIME and OBSERVED_LAST_DIGEST_AT captured at start, never recomputed mid-run" — workflow §1 already says: "Capture `INVOCATION_TIME` and `OBSERVED_LAST_DIGEST_AT` at the very start, before doing anything else. **Hold them in conversation memory through the entire run.**"
- `digest-journal` ✅ "Each digest covers a strict, non-overlapping interval; consecutive digests are adjacent" — the entire `## Coverage model — strictly non-overlapping intervals` section is about this.
- `digest-journal` ✅ "Race-safe via re-read of `last_digest_at` immediately before `digest-mark`" — workflow §6 is titled "Race check, then advance the watermark" and explicitly does this.
- `write-report` ✅ "Always record the `selector` verbatim in frontmatter" — frontmatter section says "`selector` — **required**".
- `write-report` ✅ "Show drafts inline before any file write" — workflow steps 4 (new) and 4 (update) both say "Show the draft inline".

Adding explicit `**Invariant:** ...` callouts on top of these existing imperatives would be redundant noise. The cleaner move is to remove the ✅ bullets entirely (their information already lives in the workflow), rename the section to `## Anti-patterns`, and keep the ❌ bullets.

## Goals / Non-Goals

**Goals:**
- After apply, no SKILL.md has a `## Constraints` heading.
- 6 of the 8 skills have `## Anti-patterns` (4 already + 2 renamed).
- 1 skill (`memon-propose`) preserves `## Heuristics` (positive judgment, not anti-patterns).
- 1 skill (`memon-append-journal`) has neither (`## When NOT to use` covers it).
- The 11 ✅ bullets that get dropped have NO information loss — every one re-states an imperative already in the workflow.

**Non-Goals:**
- Adding explicit `**Invariant:** ...` callouts in the workflow body. The bullets are redundant; the workflow imperatives stand.
- Renaming `## Heuristics` to `## Anti-patterns` in `memon-propose`. The content is different in kind.
- Modifying any of the 4 existing `## Anti-patterns` sections (`memon-write-script`, `memon-run-experiment`, `memon-append-warning`, `memon-migrate-fs`).
- Adding an `## Anti-patterns` section to `memon-append-journal` (its `## When NOT to use` already serves the role).

## Decisions

### Decision 1: Drop ✅ bullets without re-locating them

The user's guidance said "move ✅ to Workflow as bold invariants". After auditing, the bullets are already present as imperatives — moving them adds noise. Dropping them is functionally equivalent. design.md (this file) explicitly maps each dropped bullet to its existing workflow location so the audit trail survives this change.

### Decision 2: Per-bullet mapping (delete-source justification)

#### `memon-digest-journal` ✅ bullets (all already in workflow)

| ✅ bullet | Already at |
|---|---|
| `INVOCATION_TIME` and `OBSERVED_LAST_DIGEST_AT` captured at start, never recomputed mid-run | §1 ("Hold them in conversation memory through the entire run.") |
| Each digest covers a strict, non-overlapping interval; consecutive digests are adjacent | `## Coverage model — strictly non-overlapping intervals` (whole section) |
| Same date → append to existing date's file. New date → new file with next global N | `## File naming` (whole section) |
| Doctor checks happen before the digest body is finalized; user walks through fixes interactively | Workflow ordering: §3 (integrity sweep) precedes §5 (write digest) |
| Race-safe via re-read of `last_digest_at` immediately before `digest-mark` | §6 ("Race check, then advance the watermark") |

#### `memon-write-report` ✅ bullets (all already in workflow)

| ✅ bullet | Already at |
|---|---|
| Always record the `selector` verbatim in frontmatter | `## Frontmatter` ("`selector` — **required**") |
| Show drafts inline before any file write; user can correct course | `## Workflow — new report` step 4; `## Workflow — update an existing report` step 4 |
| Numbering is global across `docs/reports/` and never recycled | `## File naming` ("4-digit zero-padded counter — next available across the whole `docs/reports/` directory") |

### Decision 3: ❌ bullets are kept verbatim

The 6 ❌ bullets in `digest-journal` and 4 ❌ bullets in `write-report` are kept under the new `## Anti-patterns` heading without rewording. Their existing phrasing matches the convention used by the 4 skills that already have `## Anti-patterns` sections (varying styles, mostly `- ❌ ...` bullets).

### Decision 4: `## Heuristics` stays in `memon-propose`

The `## Heuristics` section in `memon-propose` is not renamed:

- Its bullets are positive guidance ("Prefer hypotheses with status `OPEN` or `PARTIAL`", "Open REQUESTs in JOURNAL trump everything").
- A few bullets have a "negative" component ("Avoid re-running already-failed setups verbatim", "Don't be afraid to propose negative results"), but they're judgment calls, not blanket prohibitions.
- Anti-patterns is the wrong heading for a section that is about prioritisation and trade-offs.
- Renaming would cost more (rewriting bullets to fit Anti-patterns shape) than it gains (heading uniformity that doesn't actually map to content).

The spec scenario added in this change calls out `memon-propose`'s Heuristics as a deliberate exemption.

### Decision 5: Position of `## Anti-patterns` is "just before `## Errors`"

`memon-digest-journal` and `memon-write-report` both have `## Errors` sections. The renamed `## Anti-patterns` sits in the same position the old `## Constraints` sat — just before `## Errors`. No further re-positioning is needed since the existing position already matches the convention used by the other Anti-patterns-having skills.

## Risks / Trade-offs

- **Risk**: A reader who relied on the ✅ bullets as a checklist may miss them after this change. → **Mitigation**: every ✅ bullet's content is still present, just inline as a workflow imperative. The `Decision 2` table above is the audit trail showing where each one went.
- **Trade-off**: Not adding explicit `**Invariant:**` callouts diverges from the user's original instruction wording. → **Mitigation**: the proposal and design.md surface this trade-off explicitly so the user can override if they want callouts after all.

## Migration Plan

Pure content edits. No on-disk migration. After apply:

```sh
grep -L '^## Constraints$' packages/skills/memon-*/SKILL.md | wc -l
# Expected: 8 (every skill is in this list = nobody has ## Constraints).

grep -l '^## Anti-patterns$' packages/skills/memon-*/SKILL.md | wc -l
# Expected: 6 (4 existing + 2 renamed).

grep -l '^## Heuristics$' packages/skills/memon-*/SKILL.md | wc -l
# Expected: 1 (memon-propose).
```

Rollback: revert the change. The ✅ bullets come back; the heading flips back to `## Constraints`. No information loss either way.
