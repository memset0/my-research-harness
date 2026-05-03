---
id: exp3-260503-100000
name: exp3
project: project-b
status: FAILED
created_at: 2026-05-03T10:00:00+08:00
finished_at: 2026-05-03T10:30:00+08:00
host: bench-01
pid: null
gpus: [0]
entry: ./run.sh
command: bash run.sh --workload=concurrency_sweep --profile=nsight
wandb: null
hypotheses: [H3]
tags: [profile, nsight]
---

## Motivation

Capture an nsight profile during the concurrency=8 workload to look for
memory-bound stalls (H3).

## Setup

- same workload as exp2 at c=8
- nsight-cu-cli wrapping the run

## Method

Wrap the binary with nsight, run for 5 minutes, dump report.

## Result

- run exited with SIGSEGV at minute 3 (no profile output)
- nsight overhead may have changed pointer alignment in a way that triggered
  a latent UB in the workload (best guess)

## Conclusion

- H3 still 🔵 OPEN — profile incomplete.
- Need a rerun, possibly without nsight or with different sampling rate.

## Caveats

- profiler may have crashed the workload; rerun without profiler first to
  confirm baseline c=8 still works

## Artifacts

- `./logs/stdout.log` — partial run log
- `./logs/stderr.log` — SIGSEGV traceback
