---
name: memon-write-script
description: Write a shell script that launches an experiment in a memon project. The script lives in a stable scripts directory and, on each invocation, creates its own timestamped run directory under the project's logs path.
argument-hint: <what the script should do, plus where it should live>
disable-model-invocation: true
license: MIT
metadata:
  author: memset0
  version: '0.3.0'
---

# memon-write-script

Author a shell script that launches an experiment.

## Preflight — FS convention version

Before doing anything else, confirm the project root's on-disk schema
matches what this skill expects. Run:

```sh
memon fs-version check --project-root . --format json
```

Branch on the `status` field:

- `match` → proceed with the rest of the skill.
- `behind` → STOP. Tell the user: "Project FS convention is at v<current>;
  current memon expects v<available>. Please run the `memon-migrate-fs`
  skill to upgrade before continuing." Do NOT read or write any spec file
  (`README.md`, `docs/hypotheses.md`, `docs/journal.md`, `docs/digests/*`,
  `docs/reports/*`).
- `uninitialised` → STOP. Tell the user: "This project root has not had
  memon installed yet. Run `memon install-skills --project-root .` first."
  Do NOT read or write any spec file.
- `ahead` → the CLI already exited 11 (`MEMON_TOO_OLD`). Forward the
  error: "Project FS convention is at v<current>; this memon supports up
  to v<available>. Upgrade memon to a release that supports v<current> or
  later." Do NOT proceed.

(`memon-migrate-fs` itself is exempt from this preflight; it IS the
migration runtime and reads `.memon/version.json` directly.)

## Mental model — script ≠ run

A script is a **launcher**. It lives in a stable, repo-tracked location
(typically `<projectRoot>/scripts/<area>/`) and gets reused across many
runs. **Each invocation generates a fresh run directory** under the
project's logs path, named `<RUN_NAME>-<YYMMDD>-<HHMMSS>` so it matches
the memon experiment regex `^.+-\d{6}-\d{6}$`.

There is **no single "right" file layout**. All of these are fine:

```
# A. Several independent standalone scripts (no shared core)
<projectRoot>/scripts/erdos/
├── run_baseline.sh
├── run_smoke.sh
└── run_resume.sh

# B. One core + several thin wrappers that set env vars
<projectRoot>/scripts/erdos/
├── run.sh           # core launcher
├── run_smoke.sh     # `RUN_NAME=smoke ... bash run.sh`
└── run_bs8.sh       # `RUN_NAME=bs8 BS=8 ... bash run.sh`

# C. One file that's both — runnable directly AND callable from a wrapper
<projectRoot>/scripts/erdos/
└── run.sh           # accepts ${VAR:-default} env vars; standalone OR delegated to
```

Every run dir lands somewhere matching `^.+-\d{6}-\d{6}$`. Default
location: `<projectRoot>/<LOGS_DIR>/<RUN_NAME>-<TIMESTAMP>/`.

The _script_ never moves. The _run dirs_ accumulate as the experiment is
re-run with different params. Re-invoking the script with `RUN_DIR=<existing-path>`
**resumes** into that existing dir instead of creating a new one (only do
this if the underlying training program actually supports resume).

**The only hard requirement is**: the script that ends up running must
correctly create `RUN_DIR` (and emit the three `[memon]` output lines —
see Convention #5). Whether that script is a standalone, a core, a thin
wrapper, or some hybrid is up to whatever fits the experiment.

## The variables you'll see in every script

Two **caller-tunable** vars (`RUN_NAME`, `RUN_DIR`) plus two
**environment-derived** vars (`PROJECT_ROOT`, `LOGS_DIR`):

| variable       | role                                                                                                               | when to override                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `RUN_NAME`     | short slug WITHOUT timestamp (`baseline`, `bs16`, `smoke`, `lr1e4`). Becomes the prefix of the run dir's basename. | Sweeps — set per iteration so each gets a distinct run dir. |
| `RUN_DIR`      | absolute path to the actual run directory. **Don't pass this in normally**; the script computes it.                | **Only** for resuming into a specific existing run dir.     |
| `PROJECT_ROOT` | absolute path to the repo root. Defaults to `git rev-parse --show-toplevel`.                                       | Rarely — when running outside a git checkout.               |
| `LOGS_DIR`     | logs directory **relative to** `PROJECT_ROOT` (default `logs`).                                                    | Per-project — match the project's existing convention.      |

Default derivation:

```bash
RUN_DIR="${PROJECT_ROOT}/${LOGS_DIR}/${RUN_NAME}-$(date +%y%m%d-%H%M%S)"
```

where `LOGS_DIR` is the logs directory **relative to the project root**
(default `logs`, but the project may use `outputs/logs`, `exp/<area>/logs`,
etc. — pick what fits the project, ask if not clear).

Everything generated by the run — `run.log`, `README.md`, all
checkpoints, all output files — lives inside `RUN_DIR`.

## Conventions you MUST follow

1. **Script lives in a stable location** under the project (typically
   `<projectRoot>/scripts/<area>/`), tracked by git. It is NOT placed
   inside any run directory.

2. **Each invocation creates its own run dir.** Use the `RUN_NAME` +
   timestamp pattern above; the basename must match `^.+-\d{6}-\d{6}$`.

3. **`RUN_NAME` is env-overridable** so a wrapper can run a sweep:
   `RUN_NAME=bs16 BS=16 bash run.sh`.

4. **`RUN_DIR` is env-overridable** for resume:
   `RUN_DIR=<projectRoot>/logs/baseline-260504-141512 bash run.sh`. The
   `${RUN_DIR:-...}` form below already supports this.

5. **Echo three `[memon] ...=<value>` lines to stdout right after
   `mkdir`** so any caller (notably `memon-run-experiment`) can grep
   them from the captured output / `tmux capture-pane` without
   re-deriving anything from the script's source or filesystem state:

   ```bash
   echo "[memon] PROJECT_ROOT=$PROJECT_ROOT"
   echo "[memon] RUN_NAME=$RUN_NAME"
   echo "[memon] RUN_DIR=$RUN_DIR"
   ```

   Order is not strict, but emit all three. These three lines are the
   only "memon-aware" content the script carries; they don't make it
   depend on memon (they're just `echo`s of strings).

6. **Don't write `README.md` from the script.** That's
   `memon-run-experiment`'s job — the agent running that skill writes
   the initial frontmatter + Setup content right after the script gets
   going. The script's _only_ responsibility for the run dir is
   `mkdir -p`; everything else (README, finalization, status
   transitions, **and the v3 bind to a parent
   `docs/experiments/E<NNNN>-<slug>.md` experiment doc**) happens from
   outside via `memon-run-experiment`'s §0 + §6 / `memon experiment
   link` CLI. The script itself stays purely v3-agnostic.

7. **One-line header at the top of every shell script**, right after the
   shebang:

   ```bash
   #!/usr/bin/env bash
   # <one-line functional description of what THIS script does>
   set -euo pipefail
   ```

   Functional, not motivational. Examples:
   - `# Sweep batch size 4/8/16 with bf16, log per-step Δparam histograms.`
   - `# Smoke test: 100 steps, single GPU, tiny model.`
   - `# Resume a run from its latest checkpoint.`

8. **Logging**: end the main pipeline with `2>&1 | tee -a "$RUN_DIR/run.log"`.
   `tee -a` (append) instead of `tee` so a resume invocation
   (`RUN_DIR=<existing> bash run.sh`) keeps the prior log content. memon's
   web log viewer auto-discovers `*.log` files under the run dir.

9. **The script MUST NOT depend on memon.** No `memon ...` invocations,
   no `@memon/*` imports, no writes to `README.md`. The script must run
   on any machine with bash + the experiment's actual deps, even with
   memon uninstalled. (The `[memon] RUN_DIR=...` echo above is just a
   string — not a memon dep.)

10. **Path portability**: derive `PROJECT_ROOT` from
    `git rev-parse --show-toplevel` (with a fallback) at the top —
    never hard-code `/home/...` or `/Users/...`.

## Optional: in-script env activation

The script MAY embed `conda activate <env>` (or `source
<venv>/bin/activate`) right after `set -euo pipefail` so it doesn't
silently inherit whatever env the calling shell happened to have
active. This avoids the classic "ran with the wrong python" failure
that costs hours to diagnose because everything looks fine until
imports fail mid-run.

```bash
#!/usr/bin/env bash
# <one-line purpose>
set -euo pipefail

# Activate the project's env so we don't inherit the caller's shell.
# shellcheck disable=SC1091
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate erdos
```

(For `venv` / `uv`: `source .venv/bin/activate` instead.)

**When to do this:**

- The project has a single canonical env (look for `environment.yml`,
  `pyproject.toml`, sibling scripts that already activate one).
- Different sub-projects of the repo have different envs and the
  caller often forgets which one applies.
- The user has been bitten by env mismatches before in this project.

**When to skip it:**

- The caller (e.g. `memon-run-experiment`) is expected to activate the
  env outside the script.
- The repo has no Python env convention yet — don't invent one.

**How to pick the right env name**: read sibling scripts in the same
`scripts/<area>/` dir (or `make` targets, CI configs, README) for the
project's existing `conda activate` / `source .venv` line. If there's
no precedent, **ask the user**:

> "我看到 scripts 目录下没有现成的环境激活规范,这个脚本要不要 inline
> `conda activate <env>` ?如果要,环境叫什么?"

1. **Identify where the script should live.** Ask if not clear; default
   `<projectRoot>/scripts/<area>/`. If a sibling `run.sh` already exists
   there, prefer adding a variant `run_<descriptor>.sh` that delegates
   to the core, instead of duplicating logic.

2. **Identify `LOGS_DIR`** for this project (default `logs`, but check
   for an existing convention in `CLAUDE.md` or sibling scripts).

3. **Decide layout** (matches Mental Model A / B / C above):
   - **Standalone (A)**: a single `run_xxx.sh` that does everything itself.
   - **Variant of an existing core (B)**: when a core `run.sh` exists in
     the same dir, the new variant just sets env vars and `bash`-execs
     the core. See "Composability" below.
   - **Hybrid single-file (C)**: one `run.sh` that's both directly
     runnable AND callable from a thin wrapper that sets env vars. Use
     when there's only ever one runner today but you want to leave the
     door open for sweeps without splitting the file yet.

4. **Pick Style A or Style B** based on complexity:
   - **Style A (flat)** — minimal params, single command. Default.
   - **Style B (structured)** — >50 lines, grouped flags as bash arrays.

5. **Add the one-line header**.

6. **`tee -a` the log** to `"$RUN_DIR/run.log"` (append, never truncate
   — Convention #8 / Resume contract).

## Style A (default, standalone)

```bash
#!/usr/bin/env bash
# <one-line purpose>
set -euo pipefail

# --- naming + paths ---
RUN_NAME="${RUN_NAME:-baseline}"            # slug; override per sweep iteration
LOGS_DIR="${LOGS_DIR:-logs}"                # relative to PROJECT_ROOT
PROJECT_ROOT="${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
RUN_DIR="${RUN_DIR:-${PROJECT_ROOT}/${LOGS_DIR}/${RUN_NAME}-$(date +%y%m%d-%H%M%S)}"
mkdir -p "$RUN_DIR"
echo "[memon] PROJECT_ROOT=$PROJECT_ROOT"
echo "[memon] RUN_NAME=$RUN_NAME"
echo "[memon] RUN_DIR=$RUN_DIR"

cd "$PROJECT_ROOT"
python -m my_module \
    --out "$RUN_DIR" \
    2>&1 \
  | tee -a "$RUN_DIR/run.log"
```

## Composability — optional core + variants pattern

When several scripts in the same dir share most of their logic, factoring
the shared part into a core `run.sh` and having siblings delegate via env
vars can reduce duplication. **This is one valid pattern, not a
requirement** — independent standalone scripts are equally valid.

When you do use it:

**Core** (`scripts/erdos/run.sh`): the Style A template above.

**Variant** (`scripts/erdos/run_bs16.sh`):

```bash
#!/usr/bin/env bash
# Same as run.sh but with batch size 16.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_NAME="${RUN_NAME:-bs16}" BS=16 bash "$HERE/run.sh"
```

**Sweep wrapper** (`scripts/erdos/run_sweep_bs.sh`):

```bash
#!/usr/bin/env bash
# Sweep batch size 4/8/16, one run dir per setting.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for bs in 4 8 16; do
  RUN_NAME="bs$bs" BS=$bs bash "$HERE/run.sh"
done
```

Variants stay tiny — they only set env vars + delegate. The core owns
the actual logic and the run-dir derivation. `RUN_DIR` should NOT be set
by the wrapper — let the core compute a fresh one per iteration so each
setting gets its own dir.

**No naming convention is enforced** for variant filenames — pick what
matches the variant's purpose (`run_smoke.sh`, `run_resume.sh`,
`run_bs16.sh`, …).

## Style B (only when justified — large param space)

```bash
#!/usr/bin/env bash
# <one-line purpose>
set -ex

RUN_NAME="${RUN_NAME:-train_full}"
LOGS_DIR="${LOGS_DIR:-logs}"
PROJECT_ROOT="${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
RUN_DIR="${RUN_DIR:-${PROJECT_ROOT}/${LOGS_DIR}/${RUN_NAME}-$(date +%y%m%d-%H%M%S)}"
mkdir -p "$RUN_DIR"
echo "[memon] PROJECT_ROOT=$PROJECT_ROOT"
echo "[memon] RUN_NAME=$RUN_NAME"
echo "[memon] RUN_DIR=$RUN_DIR"

MODEL_ARGS=(
  --model-name "${MODEL_NAME:-llama3-8b}"
  --dtype bf16
)

TRAIN_ARGS=(
  --batch-size "${BATCH_SIZE:-8}"
  --lr "${LR:-1e-5}"
  --max-steps "${MAX_STEPS:-1000}"
)

IO_ARGS=(
  --output-dir "$RUN_DIR"
  --log-file "$RUN_DIR/run.log"
)

cd "$PROJECT_ROOT"
python -m train \
    "${MODEL_ARGS[@]}" \
    "${TRAIN_ARGS[@]}" \
    "${IO_ARGS[@]}" \
    2>&1 \
  | tee -a "$RUN_DIR/run.log"
```

## Resume — minimal contract

`memon-run-experiment` is what decides _when_ to resume; the only thing
this skill needs to bake into the script is the **mechanical contract**
that makes resume possible:

1. `RUN_DIR` is env-overridable (the `${RUN_DIR:-...}` form already
   handles this) — caller can pass `RUN_DIR=<existing>` to reuse a dir.
2. **The log pipe uses `tee -a`** (append) instead of `tee` (truncate),
   so a resume into an existing `run.log` keeps prior content. Bake
   `tee -a "$RUN_DIR/run.log"` into the template; it does the right
   thing for both fresh and resume invocations.
3. The actual training program is responsible for picking up from a
   checkpoint inside `$RUN_DIR` — the launcher just hands it the path.
   If the program doesn't support resume, mention that in the script's
   one-line header.

Beyond those three points, resume orchestration (when to do it, how to
detect prior state, README updates) belongs in `memon-run-experiment`,
not here.

## Anti-patterns

- ❌ **Calling `memon` from inside the script** — breaks the "runs on a
  memon-less machine" guarantee.
- ❌ Importing `@memon/*` from Python / TS code that the script invokes.
- ❌ Putting the script _inside_ a run dir. Scripts are stable launchers
  in `scripts/`; run dirs are per-invocation under `${LOGS_DIR}/`.
- ❌ Naming the run dir something that doesn't match `^.+-\d{6}-\d{6}$`.
  memon discovery silently skips non-matching dirs.
- ❌ Hard-coding `RUN_DIR` without a `${RUN_DIR:-...}` fallback. Breaks
  resume _and_ sweeps simultaneously.
- ❌ Setting `RUN_DIR` from a sweep wrapper. Let `RUN_NAME` differentiate
  iterations and let the core derive distinct `RUN_DIR`s.
- ❌ Skipping the three `[memon] ...` echo lines. Callers grep them to
  locate the run dir without re-deriving paths or scanning the
  filesystem; missing them breaks `memon-run-experiment`'s lifecycle.
- ❌ Writing `README.md` from the script. That's `memon-run-experiment`'s
  job — the script only `mkdir`s the run dir and tees the log.
- ❌ Banners / `usage()` functions / multi-paragraph header comments.
- ❌ Hard-coded `/home/...` / `/Users/...` paths.

## When you're done

Tell the user:

1. Where the script was written (`<scriptsDir>/run_<name>.sh`)
2. The one-line header you chose
3. How to launch it (`bash <path>` or `RUN_NAME=foo BS=16 bash <path>`)
4. Where its run dirs will land
   (`<projectRoot>/${LOGS_DIR}/<RUN_NAME>-<TIMESTAMP>/`)
5. Whether resume works (depends on the training program)
6. **Ask whether to smoke-test now.** A throwaway `RUN_NAME=__smoke__`
   invocation catches typos in the three `[memon]` echo lines and
   verifies `RUN_DIR` is created where claimed — but it spends real
   compute on the training step unless the script gates that. Don't
   run it by default; just offer:

   > 要现在跑一个 smoke-test 验证 `[memon]` 行 + `RUN_DIR` 正确吗?
   > (会真的执行训练步骤,除非脚本里有 `${SMOKE:-0}` 这样的 gate)

   If the user says yes, run the smoke-test (you can wrap heavy
   sections of the script in `[ "${SMOKE:-0}" = "1" ] && exit 0` first
   if the training step is too costly).
