# fsdp-comm hypotheses

## Status legend

| Symbol | Status | Meaning |
| :---: | --- | --- |
| ✅ | CONFIRMED | measured data supports |
| ❌ | REFUTED | measured data contradicts |
| 🟡 | PARTIAL | conditional / partial support |
| 🔵 | OPEN | proposed, not yet measured |
| ⚪ | DEFERRED | explicitly out of current scope |

## Summary table

| ID | Statement | Status | Experiments |
| :-: | --- | :-: | --- |
| H1 | bf16 param delta is sparse across optimizer steps | ✅ | foo-260501-100000, bar-260502-150000 |
| H2 | grad has intrinsic magnitude sparsity | ✅ | bar-260502-150000 |
| H3 | top-k mask is unstable across steps (>50% drift) | 🟡 | foo-260501-100000 |
| H4 | overlap regression on FSDP2 with delta-AG | ❌ | baz-260503-080000 |
| H5 | mixed precision affects sparsity below ULP threshold | 🔵 | — |
| H6 | smaller batch size shifts embed row sparsity | ⚪ | — |

## H1. per-step-bf16-param-delta-is-sparse

- **Statement**: under bf16 representation, >99% of param positions are bit-equal between adjacent optimizer steps
- **Origin**: research-plan.md core idea (prior work observation)
- **Status**: ✅ CONFIRMED
- **Experiments**: foo-260501-100000 (data) → bar-260502-150000 (analysis)
- **Evidence**:
  - 1-step bit_equal = 99.89%
  - 32-step bit_equal = 98.85%
  - 160-step persistence = 97.23%
- **Caveats**:
  - strongly tied to lr=1e-6
  - only 5 RL fine-tuning steps measured
- **Last verified**: 2026-04-30

## H2. grad-has-intrinsic-magnitude-sparsity

- **Statement**: gradient tensor has strong intrinsic magnitude sparsity (~93% positions below 1e-8)
- **Origin**: derived from FSDP overlap design exploration
- **Status**: ✅ CONFIRMED
- **Experiments**: bar-260502-150000
- **Evidence**:
  - per-tensor magnitude histogram is heavily skewed
  - threshold @1e-8 retains 99.7% of norm with 7% mask
- **Caveats**:
  - lm_head and embed behave differently from attn/mlp
- **Last verified**: 2026-04-30

## H3. top-k-mask-is-unstable

- **Statement**: per-step grad top-k positions drift out >80% in 32 steps; static top-k mask is unviable for attn/mlp
- **Origin**: extension of H2
- **Status**: 🟡 PARTIAL
- **Experiments**: foo-260501-100000
- **Evidence**:
  - drift_rate(k=1024) = 0.81 over 32 steps for attn
  - drift_rate is layer-dependent: attn 0.85, embed 0.40
- **Caveats**:
  - embed/lm_head behave differently — top-k mask is more stable there
- **Last verified**: 2026-05-01

## H4. overlap-regression-on-fsdp2-with-delta-ag

- **Statement**: delta all-gather on FSDP2 cannot preserve comm-compute overlap (overlap killer)
- **Origin**: protocol-level analysis
- **Status**: ❌ REFUTED
- **Experiments**: baz-260503-080000
- **Evidence**:
  - measured overlap ratio 0.92 with delta-AG (vs. 0.94 baseline)
  - regression is smaller than predicted, not categorical
- **Caveats**:
  - test was on 4xA100 only; multi-node behavior unverified
- **Last verified**: 2026-05-03

## H5. mixed-precision-below-ulp

- **Statement**: when per-step update magnitude is below bf16 ULP, fp32 master state still accumulates measurable drift
- **Origin**: numerical analysis discussion
- **Status**: 🔵 OPEN
- **Experiments**: —
- **Evidence**:
  - none yet
- **Caveats**:
  - requires fp32 master dump per step (instrumentation TODO)
- **Last verified**: —

## H6. batch-size-affects-embed-sparsity

- **Statement**: smaller batch size reduces embed row sparsity (more tokens hit per step)
- **Origin**: speculation from token frequency analysis
- **Status**: ⚪ DEFERRED
- **Experiments**: —
- **Evidence**:
  - none yet
- **Caveats**:
  - low priority, deferred until H5 produces baseline numbers
- **Last verified**: —
