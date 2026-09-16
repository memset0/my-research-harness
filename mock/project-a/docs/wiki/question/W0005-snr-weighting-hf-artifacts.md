---
id: W0005
kind: question
title: Does SNR-weighted loss reduce high-frequency artifacts beyond 128²?
description: "Wiki question page for H0002 / E0003 covering whether SNR-weighted loss reduces high-frequency artifacts below 128². The answer is partial: confirmed at 256² but untested at smaller resolutions."
status: OPEN
sources: [H0002, E0003]
tags: [snr, artifacts]
created_at: "2026-05-02T10:00:00+08:00"
updated_at: "2026-05-05T09:40:00+08:00"
---

# Does SNR-weighted loss reduce high-frequency artifacts beyond 128²?

## Question

Does SNR-weighted loss reduce high-frequency artifacts beyond 128²?

## Context

Hypothesis @H0002 claims that min-SNR-γ weighting reduces high-frequency artifacts, and it is marked ✅ CONFIRMED on the basis of @E0003-snr-sweep and @E0001-vpred-convergence. However, the evidence cited under @H0002 — HF-band energy ratio dropping from 0.184 to 0.139 (-24%) and FID@256 going from 8.92 to 8.87 — is reported at 256² resolution. The hypothesis page itself flags a caveat: 'small-batch runs (bs=32) show much weaker effect,' and the resolution caveat for the parent v-pred experiment (@H0001) limits transferability. No run in the supplied context measures the SNR-weighted loss below 128², so the sub-128² behavior of the artifact-reduction effect is not empirically established by @E0003 or @E0001.

```yaml datatable@1 #hf_artifacts
title: HF artifact score by resolution (E0003)
columns: [resolution, uniform_loss, snr_weighted_loss]
data:
  - [64, 0.41, 0.29]
  - [128, 0.38, 0.27]
views:
  - type: table
  - type: line
    x: resolution
    y: snr_weighted_loss
```

```foo-chart
this language is not a registered component and must render as a plain code block
```

## Answer

Based on the available evidence, the claim is 🟡 PARTIAL rather than fully confirmed for resolutions below 128². @H0002 is confirmed only at 256², where min-SNR-γ=5 cut HF-band energy ratio from 0.184 to 0.139 (-24%) in @E0003-snr-sweep with FID@256 essentially unchanged (8.92 → 8.87, @E0001-vpred-convergence baseline). @E0003-snr-sweep does not include 64² or 32² cells, so we cannot assert the effect persists at those resolutions; the @E0003 caveat about weak effects at bs=32 further suggests the mechanism is sensitive to training conditions. To answer the question directly: it is unknown whether SNR-weighted loss reduces high-frequency artifacts below 128², and the current @H0002 evidence does not support extrapolating the 256² result downward. A new 64²/32² arm in @E0003-snr-sweep (or a follow-on experiment) would be required to convert this from PARTIAL to CONFIRMED.
