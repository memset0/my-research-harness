## MODIFIED Requirements

### Requirement: `memon hypo` subcommands

`memon hypo` SHALL be a parent command with at least:
- `memon hypo list` — list all hypotheses across configured projects (or filtered by `--project`)
- `memon hypo show <id>` — output a single hypothesis entry. The `<id>` argument SHALL strictly match `^H\d{4}$` (canonical 4-digit zero-padded form). Unpadded input (`H3`, `H03`) SHALL produce a `BAD_REQUEST` error and exit code 2.

#### Scenario: List
- **WHEN** the user runs `memon hypo list --project fsdp-comm`
- **THEN** stdout is JSON with the hypothesis records for that project, every record's `id` field in canonical padded form

#### Scenario: Show with padded id
- **WHEN** the user runs `memon hypo show H0003 --project fsdp-comm`
- **THEN** stdout is JSON with the parsed hypothesis record (statement, status, experiments, evidence, etc.) and `id: "H0003"`

#### Scenario: Show with unpadded id rejected
- **WHEN** the user runs `memon hypo show H3 --project fsdp-comm`
- **THEN** the command exits with code 2 and stderr names `BAD_REQUEST` plus a hint that the canonical form is `H0003`
