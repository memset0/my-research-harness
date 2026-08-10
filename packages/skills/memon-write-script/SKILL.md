---
name: memon-write-script
description: Write or update a portable shell launcher for a memon Run, including run-directory creation, logging, and machine-readable launch output. Use when an Experiment or Variant needs a reusable launcher, wrapper, or sweep script; return its entry/recipe/env provenance for the Experiment writer without automatically creating an Implementation item.
---

# memon-write-script

Author a launcher script. The script creates a fresh timestamped Run directory;
`memon-run-experiment` owns the Run README and lifecycle around it.

## Preflight and context

Run `memon --project-root . --format json fs-version check` first and follow
`../PREFLIGHT.md` unless the status is `match`.

Read project instructions and nearby launchers before writing. Determine:

- the Experiment and optional Variant this launcher serves;
- whether a meaningful Implementation item already exists;
- the entry command, training recipe, environment variables, output path, and
  resume behavior;
- the project's Python environment, scheduler, GPU, and logs conventions.

Do not create an Implementation item merely because a script is being added.
If the script implements part of an existing engineering item, hand its path
back to `memon-write-experiment-doc`; otherwise record it as Variant/Run
provenance.

## Placement

- Cross-Experiment and portable launcher → `scripts/<area>/`.
- Experiment-specific scheduler wrapper, smoke launcher, or sweep helper → the
  Experiment directory next to its bundle.
- One-shot CPU analysis producing a plot/table → write it as an
  Experiment-local utility, not through this skill and not as a Run.

Keep generated Run data out of the launcher directory.

## Launcher contract

Every launcher must:

1. Start with a functional one-line description and strict shell mode.
2. Derive `PROJECT_ROOT` portably; never hard-code a user's absolute path.
3. Accept caller-overridable `RUN_NAME` and `RUN_DIR`.
4. Create a fresh directory named `<RUN_NAME>-<YYMMDD>-<HHMMSS>` unless an
   existing `RUN_DIR` is explicitly supplied for a supported resume.
5. Emit these lines immediately after directory creation:

   ```text
   [memon] PROJECT_ROOT=<absolute path>
   [memon] RUN_NAME=<slug>
   [memon] RUN_DIR=<absolute path>
   ```

6. Append stdout/stderr to `"$RUN_DIR/run.log"` with `tee -a`.
7. Never call `memon`, write `README.md`, or mutate the Experiment bundle.
8. Remain runnable with bash and the project's actual dependencies even when
   memon is not installed on the execution host.

Default template:

```bash
#!/usr/bin/env bash
# <one-line functional description>
set -euo pipefail

RUN_NAME="${RUN_NAME:-baseline}"
LOGS_DIR="${LOGS_DIR:-logs}"
PROJECT_ROOT="${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
RUN_DIR="${RUN_DIR:-${PROJECT_ROOT}/${LOGS_DIR}/${RUN_NAME}-$(date +%y%m%d-%H%M%S)}"

mkdir -p "$RUN_DIR"
echo "[memon] PROJECT_ROOT=$PROJECT_ROOT"
echo "[memon] RUN_NAME=$RUN_NAME"
echo "[memon] RUN_DIR=$RUN_DIR"

cd "$PROJECT_ROOT"
python -m my_module \
  --out "$RUN_DIR" \
  2>&1 | tee -a "$RUN_DIR/run.log"
```

Use bash arrays for a large argument surface. Use thin wrappers that set env
vars and delegate when a stable core launcher already exists. A sweep wrapper
must let the core derive a separate Run directory per Variant/setting.

Inline environment activation only when the repository has a clear precedent.
Do not guess a conda/venv name.

## Variant alignment

When this script is part of an imminent Run:

- confirm the Variant already exists in `results.yaml` before launch;
- make entry, recipe, and injected env match that Variant's provenance;
- do not silently broaden one launcher invocation into undeclared Variants;
- expose comparison parameters as explicit env vars/flags so the actual command
  can be audited against Results.

This skill may prepare the launcher before the Variant is finalized, but it must
not launch it. `memon-run-experiment` enforces the pre-launch Variant check.

## Workflow

1. Inspect instructions, sibling scripts, entry code, and recipe.
2. Choose placement and whether to extend a core launcher or add a standalone
   script.
3. Implement the smallest auditable launcher.
4. Run `bash -n <script>` and the repository's shell formatter/linter if
   configured.
5. Perform only a cheap dry/smoke invocation when it is safe and explicitly
   supported. Do not accidentally start the full training job.
6. Return a provenance handoff. If Experiment bundle metadata must change,
   invoke `memon-write-experiment-doc` rather than editing it here.

Handoff shape:

```json
{
  "files": ["scripts/train/run_bf16.sh"],
  "entry": "scripts/train/run_bf16.sh",
  "recipe": "recipes/bf16.yaml",
  "env": {"PRECISION": "bf16"},
  "experiment": "E0007-bf16-numerics",
  "variant": "V0002",
  "implementation_item": null,
  "verification": ["bash -n scripts/train/run_bf16.sh"]
}
```

Use actual values and omit irrelevant optional fields.

## Guardrails

- Do not register scripts in a legacy `Method` section.
- Do not create a generic Implementation item for every launcher.
- Do not write Variant facts after a Run has started.
- Do not put credentials or cluster-local secrets into committed scripts,
  recipes, provenance env, or logs.
- Do not overwrite an existing script without reading and preserving its
  supported interfaces.
- Do not use a timestamp-free directory for a fresh Run.
