---
id: exp1-260501-090000
name: exp1
project: project-b
status: FINISHED
created_at: 2026-05-01T09:00:00+08:00
finished_at: 2026-05-01T11:00:00+08:00
host: bench-01
pid: 8421
gpus: [0]
entry: ./run.sh
command: bash run.sh --reruns=10 --workload=baseline
wandb: null
hypotheses: [H1]
tags: [baseline, reproducibility]
---

## Motivation

Establish baseline reproducibility (H1) before more interesting workloads.

## Setup

- single A100, no concurrency
- 10 reruns of identical workload, 1k iterations each

## Method

Run workload N=10 times back-to-back, record mean latency per run.

## Result

- mean = 12.5ms
- std = 0.07ms
- max - min = 0.21ms
- variance is well within the 1% target

## Conclusion

H1 ✅ CONFIRMED.

## Caveats

- single host
- workload is CPU-light; GPU-bound workloads may behave differently

## Artifacts

- `./outputs/runs.csv` — per-run mean latency
- `./logs/stdout.log` — short run log
