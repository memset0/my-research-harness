## Context

After `v3-spec-sync` archived, the canonical specs reflect v3
faithfully. But the skills bundled at `packages/skills/memon-*`
were written incrementally — some pre-v3, some during the
transition — and still embed v2 caveat blocks that confuse a fresh
agent reading them today. The clearest example is
`memon-append-warning` whose §"When to use" still tells the agent
"use the v2 form below; switching invocations is mechanical once
the v3 backend lands" — that backend has long since landed.

Three quality issues to address simultaneously:

1. **Inline v2/v3 talk** — every conditional "if you're on v3 do
   X else do Y" branch in skill body is dead weight now that v3
   is the only supported convention (older projects get caught at
   preflight by `memon fs-version check`).

2. **Wrong content routing** — `memon-run-experiment` §10 lists
   five content kinds but only assigns four homes; "实现思路 /
   想让用户注意的细节" gets the loose "如果两边都没合适的位置写"
   instruction. In the v3 model that text deterministically belongs
   to the parent exp doc's `## Method` (rationale) or `## Caveats`
   (interpretive limits). The "neither" escape hatch is a smell.

3. **Script ↔ exp doc disconnection** — `memon-write-script`
   currently disclaims "exp doc handling is `memon-run-experiment`'s
   job", but the user-facing flow is "I want to run experiment X,
   write a script for it." If the script never gets recorded on the
   exp doc, future agents looking at the exp can't find the script
   and have to re-derive the connection from `logs/<run>/run.sh`
   inspection.

The CLI side has a related friction point: warning attribution to a
parent exp requires resolving `run.frontMatter.experiment` first,
which is two commands. A `memon run warning add` shortcut collapses
the two and refuses cleanly when the run is orphan (so the agent
can't accidentally create a hanging warning).

## Goals / Non-Goals

**Goals:**

- Strip the "if v3 do X, if v2 do Y" inline branches out of the
  three skills, leaving v3-only flow with v2 considerations
  consolidated in a single end-of-doc reference section.
- Make every content kind in `memon-run-experiment` §10 land in a
  named, deterministic home — no third loose path.
- Make `memon-write-script` aware of the exp doc lifecycle: identify
  the parent exp, optionally help the user create one, and register
  the new script in the exp's `## Method` so the connection
  survives.
- Add CLI shortcuts that match the high-frequency skill flow
  (`memon run warning add` + `memon run resolve-exp`) so agents
  don't need to chain two commands.

**Non-Goals:**

- New on-disk schema. No `scripts:` frontmatter field; scripts live
  in `## Method` body per the user's design call. No new section
  conventions on the run README or the exp doc.
- Removing v2 support from CLI / parser. The
  `memon experiment warning add <run-id>` v2 path stays in the CLI
  for projects that haven't migrated yet — only the SKILL stops
  emitting it. Same for the warnings-table 6-col parser
  back-compat.
- Touching `memon-migrate-fs`, `memon-digest-journal`,
  `memon-write-report`, or other skills. The three rewrites here
  are scoped to skills that demonstrably contain stale v2 talk or
  mis-routed content.
- Web UI changes. Action bars / endpoints / SSE all stay where
  v3-spec-sync left them.

## Decisions

### D1 — Scripts live in `## Method`, not a new section or frontmatter

**Decision** (per user pick): the script registry on an exp doc is
one-or-more lines inside the existing `## Method` body, formatted
as `- \`<rel-path>\` — <one-sentence purpose>`. No new
`## Scripts` H2 section, no `scripts: []` frontmatter field. The
agent (via `memon-write-script`) appends to `## Method` directly
through the existing readme write path.

**Rationale**: Method is "how this experiment is run", and scripts
ARE part of how it's run. Co-locating them with the prose
description means a reader of `## Method` sees both the rationale
and the entry points. A separate section creates a hop the reader
has to make.

**Alternatives considered**:
- New `## Scripts` H2 — cleaner machine-extraction but a real
  schema change, and the user explicitly chose against it.
- Frontmatter `scripts: []` — strictest machine readability but
  frontmatter isn't where prose-adjacent info belongs in this
  repo's conventions (Artifacts on the run README similarly lives
  in body, not frontmatter).

### D2 — `memon run warning add` refuses on orphan runs

**Decision** (per user pick): a `BAD_STATE` (exit 9) when the run's
`frontMatter.experiment` is null/empty/absent. Stderr explains:
"run is orphan; bind it to an experiment via `memon experiment
link` first, then retry."

**Rationale**: warnings are fundamentally exp-level — they're about
"what does the user need to adjudicate about THIS investigation."
An orphan run has no investigation context, so a warning has
nowhere meaningful to land. Auto-creating an exp would be magical;
falling back to the run README contradicts the v3 spec.

**Alternatives considered**:
- Fall back to writing the warning on the run README (v2 form).
  Rejected: contradicts the user's #1 design point ("warning are
  exp-level in v3").
- Auto-create a default exp doc to host the warning. Rejected:
  too much magic; user wants a deliberate `memon experiment link`.

### D3 — `memon-run-experiment` §10 routes "实现思路" → Method, "用户注意细节" → Caveats

**Decision**: replace the current bullet:
> 实现思路或想让用户注意的细节, 如果两边都没合适的位置写

with two explicit bullets:
> 实现思路 (设计 rationale) → 父 exp doc 的 `## Method`
> 让用户注意的细节 (caveat / 解读限制) → 父 exp doc 的 `## Caveats`

Both updates happen via `memon experiment readme write` on the exp
doc, not on the run README. The skill's instruction is to OPEN the
exp doc, append to the relevant section, and re-write — same
pattern §10 already uses for `## Conclusion` updates.

**Rationale**: Method captures HOW (= rationale, key choices made
during impl); Caveats captures WHAT TO WATCH FOR (= caveats users
would otherwise miss). Every piece of "实现思路 / 用户注意" content
maps cleanly to one of those. The loose path was a hedge from
when we weren't sure; we are now.

**Alternatives considered**:
- Add a third H2 like `## Notes` for free-form content. Rejected:
  one more section to maintain, and the existing two cover it.
- Push these to the run README. Rejected: they're cross-run
  insights (relevant to every member run of the exp), so they
  belong on the exp doc.

### D4 — `memon-write-script` asks the user before creating an exp doc

**Decision**: when the user describes an experiment but no exp doc
exists, the skill ASKS rather than auto-creates. The skill prompts
in Chinese (per skill convention) something like:
> 这个脚本看起来对应 experiment "<slug>"，但 docs/experiments/
> 还没有对应的文档。要不要现在创建？如果要，初始的 Motivation /
> Method 写什么？

If the user declines, the script is written without exp binding;
no `# experiment: <id>` comment is added, no exp readme write
happens.

**Rationale**: matches the user's #4 design point — "如果用户让你
不要创建 exp 对应的文档只是写个脚本，那么就只编写脚本". User
agency over the exp doc lifecycle stays explicit.

**Alternatives considered**:
- Auto-create an exp doc with a placeholder when the script names
  one. Rejected: too presumptuous; user might be experimenting
  with a quick one-off.

### D5 — Migration helpers move to skill-end, not removed

**Decision**: the v2/v3 detection + "ask user about migration"
content stays in `memon-run-experiment` but gets consolidated into
a single `## Migration helpers (legacy projects only)` section at
the end. Body of the skill assumes v3.

**Rationale**: agent reads top-to-bottom, hits §0 Identify, §1
Pre-launch, …, gets to the bottom and sees migration only if a
preflight failure pointed there. Inline branching dilutes attention
on the happy path.

## Risks / Trade-offs

- **Risk**: scripts in `## Method` body lose machine-extractability
  → agents that need to enumerate "what scripts belong to this
  exp" have to grep the body for backtick-quoted relative paths.
  → **Mitigation**: spec the format strictly (`- \`<path>\` — <text>`)
  so the regex is reliable, and don't worry about machine extraction
  beyond grep — the user pick was unambiguous.

- **Risk**: `memon run warning add` makes orphan-run debugging
  slightly harder (can't drop a warning on a stray run dir without
  binding it first).
  → **Mitigation**: error message names the unblock command
  (`memon experiment link`); CLI exits 9 (`BAD_STATE`) which is
  the existing "you need to fix state first" signal.

- **Risk**: agents that have the OLD skills cached (e.g. a long-
  running session that read `SKILL.md` once) won't see the new
  guidance until they re-read.
  → **Mitigation**: skills are bundled in `packages/skills/` and
  re-installed via `memon install-skills`. Documenting the
  refresh step is the user's call (CLAUDE.md mentions it
  separately).

- **Trade-off**: the rewrites are fairly invasive (the
  run-experiment SKILL.md is 924 lines). The patch will be large.
  Reviewing the diff line-by-line is the only way to catch
  regressions.

## Migration Plan

No on-disk migration needed. Deployment:

1. Land the change on `main`.
2. Users on existing projects re-run `memon install-skills` to
   pick up the new skill content.
3. Agents in long-running sessions naturally pick up the new
   skills next time they invoke them.

Rollback: revert the change PR. The CLI shortcuts are additive (no
existing command behavior changes), so removing them is safe.

## Open Questions

None — the user has confirmed both design picks (D1: scripts in
Method; D2: orphan warnings refused).
