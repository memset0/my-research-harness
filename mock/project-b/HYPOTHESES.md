# samplebench hypotheses

## Status legend

| Symbol | Status |
| :---: | --- |
| ✅ | CONFIRMED |
| ❌ | REFUTED |
| 🟡 | PARTIAL |
| 🔵 | OPEN |
| ⚪ | DEFERRED |

## Summary table

| ID | Statement | Status | Experiments |
| :-: | --- | :-: | --- |
| H1 | DDIM @ 50 steps matches DDPM @ 1000 steps on FID for SD-1.5 | ✅ | exp1-260501-090000 |
| H2 | CFG scale > 7.5 reduces sample diversity (LPIPS) non-linearly | 🟡 | exp2-260502-090000 |
| H3 | nsight profile shows VAE decoder dominates inference tail | 🔵 | exp3-260503-100000 |
| H4 | rescale-CFG (Lin et al.) eliminates over-saturation at scale ≥ 12 | ⚪ | cfg-rescale-260503-130000 |

## H1. ddim-50-matches-ddpm-1000

- **Statement**: DDIM with 50 sampling steps reaches the same FID as DDPM with 1000 sampling steps on SD-1.5 (within ±0.1 FID), at the same CFG scale
- **Origin**: methodology baseline; needed as a reference before exploring fewer-step samplers
- **Status**: ✅ CONFIRMED
- **Experiments**: exp1-260501-090000
- **Evidence**:
  - DDIM-50 FID = 12.48 ± 0.07 (10 reruns)
  - DDPM-1000 FID = 12.51 ± 0.05 (3 reruns; DDPM is expensive)
  - difference well within reported variance
- **Caveats**:
  - SD-1.5 only; SDXL behavior unverified
  - same prompt set (COCO-2017-val 5k) for both
- **Last verified**: 2026-05-01

## H2. cfg-above-7-hurts-diversity

- **Statement**: pairwise LPIPS distance over 4 samples per prompt drops faster than linearly as CFG scale exceeds 7.5
- **Origin**: anecdotal observation that high-CFG outputs look "samey"
- **Status**: 🟡 PARTIAL
- **Experiments**: exp2-260502-090000
- **Evidence**:
  - mean pairwise LPIPS at CFG=4.5: 0.41
  - mean pairwise LPIPS at CFG=7.5: 0.38 (-7%)
  - mean pairwise LPIPS at CFG=10:  0.31 (-24%)
  - mean pairwise LPIPS at CFG=12:  0.26 (-37%)
- **Caveats**:
  - only 4 CFG points; need a finer sweep at {6, 8, 9, 11}
  - LPIPS is one diversity proxy; FID-coverage might disagree
- **Last verified**: 2026-05-02

## H3. vae-decoder-dominates-tail

- **Statement**: in single-image SD-1.5 inference, the VAE decoder accounts for ≥ 40% of wall time at p99 (and is the dominant contributor to the tail)
- **Origin**: derived from H2's tail-latency observations
- **Status**: 🔵 OPEN
- **Experiments**: exp3-260503-100000
- **Evidence**:
  - profile run failed (SIGSEGV under nsight); no trace captured yet
- **Caveats**:
  - run instrumentation may have caused crash; rerun without nsight first to
    confirm baseline still works
- **Last verified**: —

## H4. rescale-cfg-reduces-saturation

- **Statement**: rescale-CFG (Lin et al. 2024) with phi=0.7 brings high-CFG (scale=12) outputs back into the saturation envelope of low-CFG (scale=4.5) without losing prompt adherence
- **Statement**: CLIP-T similarity preserved within 1%; saturation metric (V-channel mean of HSV) drops back to baseline range
- **Origin**: design proposal motivated by H2's diversity finding and the
  composition-loss observation in project-a (zero-snr-260502-110000)
- **Status**: ⚪ DEFERRED
- **Experiments**: cfg-rescale-260503-130000 (in flight, treated as a probe rather than a confirmation run)
- **Evidence**:
  - none yet from this project; project-a context suggests it may help
- **Caveats**:
  - blocked on H3 baseline measurement before commiting to a full sweep
- **Last verified**: —
