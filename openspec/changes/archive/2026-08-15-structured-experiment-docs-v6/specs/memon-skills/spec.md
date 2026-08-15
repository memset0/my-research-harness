## ADDED Requirements

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

## REMOVED Requirements

### Requirement: README authorship is exclusive to memon-run-experiment

**Reason**: v6 separates Run README authorship from Experiment semantic writes. `memon-run-experiment` continues to own Run README content, while the dedicated `memon-write-experiment-doc` owns the Experiment README and structured YAML sidecars.

**Migration**: Route Experiment semantic writes through `memon-write-experiment-doc`; launcher scripts still never author Run READMEs.

### Requirement: `memon-append-warning` exists as a model-invocable single-row appender

**Reason**: v6 removes the standalone warning skill so every Experiment semantic write follows the same bundle-aware writer workflow. The warning CLI remains available for compatibility.

**Migration**: Official skills invoke `memon-write-experiment-doc` for Warning changes; installed stale copies of `memon-append-warning` are removed during skill synchronization.
