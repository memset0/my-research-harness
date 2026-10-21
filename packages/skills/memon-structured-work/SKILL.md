---
name: memon-structured-work
description: Maintain optional implementation and investigation tracking only when explicitly requested.
---

# Optional structured tracking

Read `../PREFLIGHT.md`. Ordinary experiments need no phase documents.
When requested, maintain schema-v1 `implementation.yaml` / `investigation.yaml`
in the Experiment bundle, preserving IDs and evidence. Read the needed format in
[schema.md](references/schema.md), edit directly, then inspect with
`memon --project-root . show <E-id> --section implementation` (or investigation)
and publish with `refresh <E-id>`, then `refresh --check` (preflight, Published
index). Resolve reported structural errors.
Add README pointers only for sections the user wants displayed. Track meaningful
work or decisions, not every agent action; task completion is not a finding.
