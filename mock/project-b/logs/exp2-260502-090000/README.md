---
id: exp2-260502-090000
name: exp2
project: project-b
status: FINISHED
created_at: 2026-05-02T09:00:00+08:00
finished_at: 2026-05-02T17:00:00+08:00
host: bench-01
pid: 9012
gpus: [0]
entry: ./run.sh
command: bash run.sh --workload=concurrency_sweep
wandb: null
hypotheses: [H2]
tags: [tail-latency, sweep]
---

## Motivation

Measure tail latency under increasing concurrency to test H2.

## Setup

- single A100, concurrency ∈ {1, 8}
- 1k iterations per concurrency point, 5 reruns

## Method

Run the workload at each concurrency level, capture full latency
distribution including p99.

## Result

- concurrency=1: mean=8ms, p99=18ms
- concurrency=8: mean=14ms, p99=72ms (4× p99 for 8× concurrency)

## Conclusion

- H2 🟡 PARTIAL — clear non-linearity but only 2 sample points; need a
  proper sweep at {2, 4, 16, 32} to confirm a curve shape.

## Caveats

- only 2 concurrency points
- bench-01 has noisy neighbor on its NUMA peer

## Artifacts

- `./outputs/concurrency_1.csv` — full latency distribution at c=1
- `./outputs/concurrency_8.csv` — full latency distribution at c=8
- `./logs/stdout.log` — run stdout
