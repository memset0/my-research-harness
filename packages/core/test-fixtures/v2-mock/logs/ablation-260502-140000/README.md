---
id: ablation-260502-140000
name: ablation-rerun
project: example-project
status: FAILED
created_at: 2026-05-02T14:00:00+08:00
finished_at: 2026-05-02T14:25:00+08:00
host: gpu-04
pid: 12346
gpus: [0]
entry: ./run.sh
command: bash run.sh --bs=8 --seed=43
wandb: null
hypotheses: [H0001]
tags: [ablation]
---

## Motivation

Repro 验证。

## Setup

1×A100，bs=8，seed=43。

## Method

同 baseline 跑 5k。

## Result

OOM at step 800.

## Conclusion

需要 grad accumulation。

## Caveats

bs=8 在 1 卡下边界值。

## Artifacts
