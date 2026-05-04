# Zero-terminal-SNR brightness vs composition tradeoff

Theme report distilling the brightness shift observed across the
zero-SNR sweep (H0003) for project-a's diffusion runs.

## Context

The zero-SNR schedule shifts the noise/signal at the terminal step,
which removes a long-known brightness bias in v-prediction models.
Side effect: composition (object placement, framing) drifts subtly
toward a less centered distribution.

## Findings

- All 4 zero-SNR runs (`zero-snr-260502-110000`, `snr-sweep-260430-160000`,
  …) showed a +6 to +9 mean brightness shift on the eval set, matching
  the expected direction.
- Composition score regressed by 1.2–1.7 % on the auto-eval suite.
- Tradeoff is acceptable for the brightness-recovery use case but not
  for the centered-product-shot use case.

## Selector

```sh
# Re-run the matching filter on the current journal:
memon search --in fm zero-snr | jq '.matches[].id'
```

## See also

- H0003 — zero-terminal-SNR brightness/composition tradeoff
- D0002-2026-05-04 — last digest covering this period
