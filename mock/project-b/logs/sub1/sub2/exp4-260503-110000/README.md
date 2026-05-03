---
id: exp4-260503-110000
name: exp4
project: project-b
status: FINISHED
created_at: 2026-05-03T11:00:00+08:00
finished_at: 2026-05-03T11:30:00+08:00
host: bench-01
pid: 9531
gpus: [0]
entry: ./run.sh
command: bash run.sh --workload=baseline --quick --samples=100
wandb: null
hypotheses: []
tags: [smoke, nested-path]
---

## Motivation

Quick smoke test to confirm bench-01 is healthy after exp3's crash.
Mostly serves as a fixture for testing nested log directory discovery.

## Setup

- single A100, SD-1.5, DDIM-50, CFG=7.5
- 100 prompts (subset of exp1 set)

## Method

Same workload as exp1 but truncated to 100 samples.

## Result

- mean wall time = 1.41s / image, p99 = 1.62s — within historical envelope
- FID not computed (sample count too small to be meaningful)

## Conclusion

bench-01 is healthy. No hypothesis impact.

## Caveats

(none)

## Artifacts

- `./outputs/quick.csv` — per-prompt wall times
