---
id: W0007
kind: finding
title: Karras-EDM preconditioning is the production baseline
description: Original baseline choice for preconditioning; superseded once E0004 reran without the NaN crash.
status: RETRACTED
sources: [E0001, H0004]
tags: [precond]
created_at: "2026-04-28T10:00:00+08:00"
updated_at: "2026-05-04T10:00:00+08:00"
deprecated:
  at: 2026-05-04T10:00:00+08:00
  reason: "E0004 rerun shows EDM2 preconditioning ahead at every checkpoint"
  superseded_by: W0006
---

# Karras-EDM preconditioning is the production baseline

## Claim

Karras-EDM preconditioning remains the production default; EDM2 gains at 64²/128² (@H0004) have not been reproduced at 256².

## Evidence

@E0001 and the first @E0004 run (@edm2-precond-260503-080000), which crashed at step 84k before a comparable checkpoint existed.

## Limits

No 256² comparison existed when this was written.
