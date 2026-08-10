## MODIFIED Requirements

### Requirement: Drive coordinates all Experiment work through a dedicated writer skill

`memon-drive` SHALL read the v6 bundle, distinguish engineering work from empirical investigation, define Variants before launching Runs, and invoke `memon-write-experiment-doc` for every Experiment semantic write. The writer SHALL directly edit README/YAML and validate afterward; it SHALL NOT require item-level mutation CLI commands.

Before a run, drive SHALL decide from the user's intent whether Variant-table approval is required. Explicit autonomous delegation permits immediate creation/execution; collaborative design prompts require a proposed Markdown table and confirmation. In all cases, the Variant exists before launch.

#### Scenario: Autonomous experiment still records Variant first
- **GIVEN** the user explicitly delegates autonomous experimental choices
- **WHEN** drive launches a run
- **THEN** the corresponding Variant is already present in `results.yaml`

### Requirement: Warning skill is removed while CLI compatibility remains

The bundled skill inventory SHALL NOT contain `memon-append-warning`. Official skills SHALL route Warning updates through `memon-write-experiment-doc`. Existing warning CLI commands remain functional indefinitely and print a deprecation notice on every invocation.

#### Scenario: Installed skill set removes warning skill
- **WHEN** `memon install-skills` synchronizes v6 skills
- **THEN** no `memon-append-warning` directory remains in the target
