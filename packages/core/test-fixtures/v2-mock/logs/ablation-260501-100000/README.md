---
id: ablation-260501-100000
name: ablation-baseline
project: example-project
status: FINISHED
created_at: 2026-05-01T10:00:00+08:00
finished_at: 2026-05-01T11:30:00+08:00
host: gpu-04
pid: 12345
gpus: [0, 1, 2, 3]
entry: ./run.sh
command: bash run.sh --bs=8
wandb: null
hypotheses: [H0001, H0003]
tags: [ablation, baseline]
---

## Motivation

测试 v3 migration 的 deterministic transform 是否能从 v2 README 生成
canonical v3 README。Motivation 段在 v3 里搬到 exp doc，run README
里应该被剥离。

## Setup

4×A100，bs=8，lr=1e-4。

## Method

跑 5k step，每 100 step 落 checkpoint。

## Result

eval loss 收敛到 2.31，比 baseline 低 0.04。

## Conclusion

v3 里这一段也搬到 exp doc。

## Caveats

强绑定 lr=1e-6 — caveat 也搬。

## Warnings

| Status | Created | Category | Message | Resolved | Note |
| :-- | :-- | :-- | :-- | :-- | :-- |
| OPEN | 2026-05-01T10:30:00+08:00 | result | loss spike at step 1500 | — | — | <!-- id:w_2026-05-01T10-30-00+08-00_a3f1 -->

## Artifacts

- `./out/loss.csv` — per-step loss

## New Hypotheses

H0099: warmup matters more than expected.
