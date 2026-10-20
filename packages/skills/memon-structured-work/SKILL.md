---
name: memon-structured-work
description: Maintain optional memon implementation and investigation documents only when the user explicitly requests this structured tracking. Ordinary experiments do not need these documents.
---

# Optional structured work

Read `../PREFLIGHT.md`. Enable this workflow only on explicit request; its
absence is valid and the front end still renders old documents when present.
Use `memon experiment doc --help` to read, lint or update schema-v1
`implementation.yaml` and `investigation.yaml` in an Experiment bundle.
Read existing content and preserve IDs and useful evidence before editing.
Use each document's CLI schema/help for fields. Add the corresponding README
pointer only when the user wants that section displayed. Keep entries limited
to decisions or work that actually benefit from tracking; avoid a log of every
agent action. A completed task does not imply a scientific finding.
