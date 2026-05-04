---
name: memon-write-script
description: Write a shell script (typically `run.sh`) for an experiment in a memon project. Use when the user wants to scaffold or edit a script that launches an experiment, with the memon naming + directory conventions baked in.
license: MIT
metadata:
  author: memon
  version: "0.1.0"
---

# memon-write-script

Author a shell script for an experiment. Scripts live inside an experiment
run directory (e.g. `<projectRoot>/logs/<name>-yymmdd-hhmmss/run.sh`) so they
travel with the experiment's other outputs.

This skill follows the upstream
[`write-shell-script`](https://github.com/MikaStars39/claude-templates/blob/main/commands/write-shell-script.md)
template (Style A flat / Style B structured-arrays) but **adapts the directory
layout to memon conventions**.

## Conventions you MUST follow

1. **Directory name regex**: the experiment dir's base name MUST match
   `^.+-\d{6}-\d{6}$` (e.g. `bf16-deltas-260504-141512`). Do NOT use
   `outputs/run_name_${TIMESTAMP}` from the upstream template.

2. **One-line header at the top of every shell script**, right after the
   shebang:

   ```bash
   #!/usr/bin/env bash
   # <one-line functional description of what THIS script does>
   set -euo pipefail
   ```

   Keep it functional (what the script does), not motivational (that goes in
   README.md). Single sentence, ~80 chars max. Examples:

   - `# Sweep batch size 4/8/16 with fp16, log per-step loss to log/.`
   - `# Convert checkpoints/*.bin to safetensors, drop in checkpoints/sft/.`
   - `# Run unit tests on the dataloader; emit junit.xml for CI.`

3. **Logging**: end the main pipeline with `2>&1 | tee <run-dir>/run.log`
   (or `<run-dir>/log/<name>.log` for multi-stream cases). memon's web log
   viewer auto-discovers `*.log` files under the run dir.

4. **Status enum**: if the script transitions the experiment status (rare;
   most scripts only set `RUNNING` at the start and `FINISHED`/`FAILED` at
   the end), use `memon experiment status set` from outside the script
   rather than mutating README front-matter inline.

5. **Path portability**: define `REPO_ROOT` or `PROJECT_DIR` at the top.

## Workflow

When the user asks you to write or edit an experiment script:

1. **Identify the project root**. Either the user names it, or use cwd.
2. **Decide whether to scaffold or edit**:
   - New experiment → `memon new <name> --project-root <root>` to scaffold a
     fresh run dir with a starter `run.sh`. Then edit that file.
   - Existing run dir → just edit the script(s) inside.
3. **Pick Style A or Style B** based on complexity:
   - **Style A (flat)** — minimal params, single command. Use this by default.
   - **Style B (structured)** — >50 lines, logically grouped flags. Group
     into `# ---- <section> ----` blocks of bash arrays.
4. **Add the one-line header** as described above.
5. **Tee the log to `<run-dir>/run.log`** at the end of the main pipeline.

## Style A (default)

```bash
#!/usr/bin/env bash
# <one-line purpose>
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
RUN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$REPO_ROOT"
python -m my_module --out "$RUN_DIR" 2>&1 | tee "$RUN_DIR/run.log"
```

## Style B (only when justified)

```bash
#!/usr/bin/env bash
# <one-line purpose>
set -ex

REPO_ROOT="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
RUN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- model ----
MODEL_ARGS=(
  --model-name "${MODEL_NAME:-llama3-8b}"
  --dtype bf16
)

# ---- training ----
TRAIN_ARGS=(
  --batch-size "${BATCH_SIZE:-8}"
  --lr "${LR:-1e-5}"
  --max-steps "${MAX_STEPS:-1000}"
)

# ---- io ----
IO_ARGS=(
  --output-dir "$RUN_DIR"
  --log-file "$RUN_DIR/run.log"
)

cd "$REPO_ROOT"
python -m train "${MODEL_ARGS[@]}" "${TRAIN_ARGS[@]}" "${IO_ARGS[@]}" 2>&1 | tee "$RUN_DIR/run.log"
```

## Anti-patterns

- ❌ Banners or `usage()` functions (this isn't a CLI tool, it's a launcher)
- ❌ Multi-paragraph header comments (put motivation in README.md, not here)
- ❌ Mutating README.md from inside the script (use `memon experiment status set` from outside)
- ❌ Hard-coding `/Users/me/...` paths (define `REPO_ROOT` at top, derive everything from it)
- ❌ Different timestamp format from `^.+-\d{6}-\d{6}$` (memon discovery skips non-matching dirs)

## When you're done

Tell the user:
1. Where the script was written (`<runDir>/run.sh`)
2. The one-line header you chose
3. How to launch it (`bash <runDir>/run.sh` or via `memon-run-experiment`)
