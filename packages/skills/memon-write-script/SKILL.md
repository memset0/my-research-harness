---
name: memon-write-script
description: Write or update a portable shell launcher for a memon Run, including run-directory creation, logging, and machine-readable launch output. Use when an Experiment or Variant needs a reusable launcher, wrapper, or sweep script; return its entry/recipe/env provenance for the Experiment writer without automatically creating an Implementation item.
---

# memon-write-script

Author a launcher script. It creates a fresh timestamped Run directory;
`memon-run-experiment` owns the execution and the Run record around it.

## Preflight and context

Follow `../PREFLIGHT.md` — FS-version check, secrets, Journal, CLI issue
handoff. Read project instructions and nearby launchers, then determine the
Experiment and optional Variant this launcher serves, whether a meaningful
Implementation item already exists, the entry command, recipe, env, output path
and resume behavior, and the project's Python environment, scheduler, GPU, and
logs conventions.

Do not create an Implementation item merely because a script is being added. If
the script implements part of an existing engineering item, hand its path back
to `memon-write-experiment-doc`; otherwise record it as Variant/Run provenance.

## Placement

- Cross-Experiment and portable launcher → `scripts/<area>/`.
- Experiment-specific scheduler wrapper, smoke launcher, or sweep helper → the
  Experiment directory beside its bundle.
- One-shot CPU analysis producing a plot/table → an Experiment-local utility,
  not this skill and not a Run.

Keep generated Run data out of the launcher directory.

The Run directory itself goes where the project's effective Run locations
discover it (`../PREFLIGHT.md`): read them with
`memon --project-root . --format json project lint` (`.effective.patterns`).
Without a declaration they are `logs/*`, `outputs/*` and `experiments/*`, so a
fresh Run is `logs/<RUN_NAME>-<YYMMDD>-<HHMMSS>` (or directly under `outputs/` or
`experiments/`). Never place a Run directory inside another Run directory. When
the user wants a deeper layout such as `outputs/<group>/<run>`, recommend
`memon project init`, a manual edit of `run_dirs` in `.memon/project.yml` and a
commit by the user; never write that file yourself.

## Launcher contract

Every launcher must:

1. Start with a functional one-line description and strict shell mode.
2. Derive `PROJECT_ROOT` portably; never hard-code a user's absolute path.
3. Accept caller-overridable `RUN_NAME` and `RUN_DIR`.
4. Create a fresh `<RUN_NAME>-<YYMMDD>-<HHMMSS>` directory at an effective Run
   location (default `logs/`), never inside another Run directory, unless an
   existing `RUN_DIR` is explicitly supplied for a supported resume.
5. Emit these lines immediately after directory creation:

   ```text
   [memon] PROJECT_ROOT=<absolute path>
   [memon] RUN_NAME=<slug>
   [memon] RUN_DIR=<absolute path>
   ```

6. Append stdout/stderr to `"$RUN_DIR/run.log"` with `tee -a`.
7. Never call `memon`, write a Run record, or mutate the Experiment bundle.
8. Stay runnable with bash and the project's real dependencies even when memon
   is not installed on the execution host.

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

Use bash arrays for a large argument surface, and thin wrappers that set env
vars and delegate when a stable core launcher exists. A sweep wrapper lets the
core derive a separate Run directory per setting. Inline environment activation
only with a clear repository precedent — never guess a conda/venv name.

## Variant alignment

When the script is part of an imminent Run: confirm the Variant already exists
in `results.yaml`; make entry, recipe, and injected env match its provenance;
never silently broaden one invocation into undeclared Variants; expose
comparison parameters as explicit env vars/flags so the actual command can be
audited against Results.

This skill may prepare a launcher before the Variant is final, but it never
launches. `memon-run-experiment` enforces the pre-launch check.

## Workflow

1. Inspect instructions, sibling scripts, entry code, and recipe.
2. Choose placement, and whether to extend a core launcher or add a standalone
   script.
3. Implement the smallest auditable launcher.
4. Run `bash -n <script>`, plus the repository's shell linter if configured.
5. Only a cheap dry/smoke invocation, and only when it is safe and explicitly
   supported. Never start the real training job by accident.
6. For a launcher written inside `docs/experiments/E<NNNN>-<slug>/`, close the
   direct maintenance with one submission (`../PREFLIGHT.md`):

   ```sh
   memon --project-root . --format json journal submit \
     --files docs/experiments/E0007-bf16-numerics/smoke_bf16.sh
   ```

   A launcher under `scripts/` is outside the accepted scope — do not submit it.
7. Hand back provenance: the files written, the `entry`, `recipe`, and `env` the
   Experiment writer needs, the Experiment/Variant it serves, the existing
   Implementation item or `null`, the verification commands you ran, and the
   `invocationId` from step 6 when there was one. Invoke
   `memon-write-experiment-doc` for any bundle metadata change instead of
   editing it here.

## Guardrails

- Do not register scripts in a legacy `Method` section.
- Do not create a generic Implementation item for every launcher.
- Do not write Variant facts after a Run has started.
- Do not put credentials or cluster-local secrets into committed scripts,
  recipes, provenance env, or logs.
- Do not overwrite an existing script without reading and preserving its
  supported interfaces.
- Do not use a timestamp-free directory for a fresh Run, and do not truncate an
  existing `run.log`.
- Do not nest a Run directory inside another Run directory, and do not create,
  edit or commit `.memon/project.yml` or anything under `.memon/index/`. A
  launcher that rewrites its Run README `status` needs no index step.
- Do not read, write, or repair a Journal file beyond the step 6 submission.
