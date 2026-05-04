---
id: recent-260503-100000
name: recent
project: project-a
status: PENDING
created_at: 2026-05-03T10:00:00+08:00
finished_at: null
host: null
pid: null
gpus: []
entry: ./train.sh
command: bash train.sh --rerun=baz-260503-080000 --skip-nan-step --grad-clip=0.5
wandb: null
hypotheses: [H0004]
tags: [edm2, rerun]
---

## Motivation

Clean rerun of baz-260503-080000 to confirm H0004 refutation without the
NaN crash that limited the prior measurement. Also test whether tighter
grad clipping (0.5 instead of 1.0) prevents the cross-attn NaN.

## Setup

(TBD — same as baz-260503-080000 with NaN-skip patch and grad_clip=0.5)

## Method

(TBD)

## Result

(TBD)

## Conclusion

(TBD)

## Caveats

(TBD)

## Artifacts

(TBD)
