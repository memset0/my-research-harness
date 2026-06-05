## Context

`add-code-review-docs` shipped the runtime + viewer. This is the authoring half,
per the runtime-first / skill-second split. memon skills live at
`packages/skills/memon-*/SKILL.md`, are auto-discovered + synced by
`memon install-skills`, are written in English (Chinese only inside `>`
user-dialogue quotes), and depend on nothing in the web stack — they call the
`memon` CLI and `git`. Closest template: `memon-write-report` (also writes one
markdown doc per invocation, references `../PREFLIGHT.md`).

## Goals / Non-Goals

**Goals:** one skill that makes agent-authored code-review docs conform to the
frontmatter contract + body conventions the viewer already renders; a correct,
submodule-aware GitHub-URL recipe; explicit "angles, not a template" framing.

**Non-Goals:** a CLI helper for URL building or id allocation (raw-git recipe
instead); changing the doc format (fixed by change 1); any runtime/UI work.

## Decisions

### D1. Model-invocable
No `disable-model-invocation`. One doc per invocation = a single low-stakes
markdown write, the same tier as `memon-write-report` / `memon-append-journal`.

### D2. GitHub URLs via raw git in the skill
The store records resolved `url`s; building them is the author's job. Recipe:
`git -C <repo> remote get-url origin` → strip a trailing `.git`, convert
`git@<host>:<owner>/<repo>` and `https://<host>/<owner>/<repo>` to
`https://<host>/<owner>/<repo>` (GitHub for `github.com`); commit URL =
`<base>/commit/<sha>`, line permalink = `<base>/blob/<sha>/<path>#L<a>-L<b>`.
For files inside a submodule the link uses THAT submodule's remote + its own
`sha` (from `git submodule status` / `git -C <sub> rev-parse HEAD`) and a
`<path>` relative to the submodule root — never the superproject path.

### D3. Body template mirrors what the viewer renders
The viewer builds the commit checklist from `commits[]`, the todolist from
`review_todolist[]`, and renders the markdown body (KaTeX + GFM). The skill's
template is exactly that shape so authored docs display correctly: sections
`Requirement` / `Changes` / `Verification` / `Notes`, each change titled
Conventional-Commits style with H4 Deliverables / Design Decisions / Analysis /
Verification / Details.

### D4. Preflight
The skill references `../PREFLIGHT.md` (consistent with the other write skills);
this change adds it to that doc's list.

### D5. Writing philosophy baked into the prose
The skill frames sections as lenses, not fields: fill what applies, omit what
doesn't, add more when useful. When the change-split granularity is ambiguous
the agent asks via AskUserQuestion (or a plain question on agents without that
tool — the skill is synced to `.claude` / `.codex` / `.opencode`).

### D6. Completion notification via memon-notify

On a successful write the skill fires `memon notify done "[code-review] …"
--agent … --session … --soft`. Best-effort: a missing Telegram config (exit 2)
is surfaced once and does NOT fail the write — the doc already exists. The
`[code-review]` title prefix makes the ping scannable and filterable.

### D7. memon-drive proactively offers a code-review

The orchestrator already calls write-script / run-experiment as sub-tools; it
gains a handoff to `memon-write-code-review`. Trigger: a Plan item whose work was
a non-trivial code change (feature / fix / refactor with commits) completes and
isn't yet written up → ask once (not per commit), skip results-only runs. The
offer is the orchestrator's; the actual authoring is delegated to the skill.

## Risks / Trade-offs

- The raw-git URL recipe is fiddly (ssh vs https, non-github hosts, detached
  submodules). Mitigation: explicit commands + a worked example; note non-github
  hosts keep their host. A future CLI helper can replace the recipe.
- Skill drift vs the runtime contract. Mitigation: cite the exact frontmatter
  keys the parser validates; change 1's specs are the source of truth.

## Migration Plan

1. Write `SKILL.md`. 2. `README.md` matrix + files table. 3. `PREFLIGHT.md`
list. 4. memon-skills spec delta. 5. `openspec validate`. 6. Sanity:
`memon install-skills` discovers the dir; frontmatter `name` + English body.

## Open Questions

- Whether to later add `memon code-review …` CLI helpers (URL building, next
  filename). Deferred; the skill is self-contained with raw git.
