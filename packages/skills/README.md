# Bundled memon skills

Install into research projects with `memon install-skills`; the harness keeps
one source in this package. `memon-research` is the default experiment workflow:
create an Experiment, optionally draft Variants, execute Runs, extract useful
results, and maintain the research explanation. Run records use `run.json`;
there is no mandatory Run prose or Experiment phase checklist.

| Task | Skill |
|---|---|
| Experiment design, execution, analysis and maintenance | `memon-research` |
| Optional implementation/investigation tracking, explicitly requested | `memon-structured-work` |
| Durable project knowledge and HTML artifacts | `memon-wiki` |
| Standalone report requested by the user | `memon-write-report` |
| Existing dashboard component syntax | `memon-components` |
| A requested human code review | `memon-write-code-review` |
| Explicit, scoped filesystem migration | `memon-migrate-fs` |

Read `PREFLIGHT.md` once, then only the reference needed for the task. No
required delegation, repeated preflight or fixed document length. The six old
experiment skills are consolidated into `memon-research`; the retirement
registry lets installation remove unchanged shipped copies while preserving
locally modified or unmanaged skills. Wiki review markers and Git review gates
are removed; ordinary Git history and independent code review remain available.
