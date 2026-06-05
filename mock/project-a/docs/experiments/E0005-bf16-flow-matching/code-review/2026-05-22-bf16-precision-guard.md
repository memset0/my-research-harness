---
title: bf16 precision guard for the flow-matching loss
description: Stop the flow-matching loss from NaN-ing in bf16 at high diffusion timesteps.
experiment: E0005-bf16-flow-matching
created_at: 2026-05-22T09:00:00+08:00
updated_at: 2026-05-23T11:20:00+08:00
commits:
  - repo: .
    sha: 7c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293
    url: https://github.com/acme/project-a/commit/7c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293
    subject: "fix(loss): compute flow-matching target in fp32 then cast"
    reviewed: true
  - repo: .
    sha: 9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b
    url: https://github.com/acme/project-a/commit/9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b
    subject: "test(loss): add a high-timestep NaN regression test"
    reviewed: false
review_todolist:
  - item: Verify fp32 accumulation does not regress throughput more than 3%
    done: true
  - item: Confirm the cast happens after the sigma-weighting, not before
    done: false
  - item: Check the regression test actually fails on the pre-fix commit
    done: false
---

# bf16 precision guard for the flow-matching loss

## Requirement

- Driving bug: at high diffusion timesteps the flow-matching target magnitude exceeds bf16's
  usable range and the loss goes NaN within ~200 steps.
- Agreed scope: fix the loss computation only; do NOT change the sampler or the model dtype.

## Changes

### fix(loss): compute flow-matching target in fp32 then cast

#### Deliverables
- `src/loss/flow_matching.py`: accumulate the target + weighting in fp32, cast to bf16 at the end.
  Commit `7c1d2e3` (main repo).

#### Design Decisions
The flow-matching target is $v_\theta = \alpha_t \epsilon - \sigma_t x_0$ and the loss weight
$\lambda(t) = 1 / \sigma_t^2$ blows up as $\sigma_t \to 0$ (high $t$). In bf16 the product
$\lambda(t)\,\lVert v \rVert^2$ overflows before the mean reduction:
$$ \mathcal{L} = \mathbb{E}_t\big[\lambda(t)\,\lVert v_\theta - \hat v\rVert^2\big] $$
Doing the weighting and reduction in fp32 keeps it finite; only the final scalar is cast back.

#### Analysis
```python
# real excerpt
target = (alpha_t * eps - sigma_t * x0).float()       # fp32
loss = (weight.float() * (pred.float() - target) ** 2).mean()
return loss.to(dtype)                                 # cast the scalar only
```
Full implementation: https://github.com/acme/project-a/blob/7c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293/src/loss/flow_matching.py#L55-L78

#### Verification
16k-step run on the E0005 config: no NaN; loss matches an fp32-reference run to < 1e-3 relative.

#### Details
None.

### test(loss): add a high-timestep NaN regression test

#### Deliverables
- `tests/test_flow_matching.py`: assert a finite loss at $t$ near 1.0. Commit `9e0f1a2`.

#### Design Decisions
Lock in the fix with a test that reproduces the original NaN on the pre-fix code path.

#### Analysis
Full test: https://github.com/acme/project-a/blob/9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b/tests/test_flow_matching.py#L1-L34

#### Verification
Runs in CI; ~0.4s.

#### Details
None.

## Verification

- Experiment: see runs under E0005-bf16-flow-matching — the post-fix run trains 16k steps cleanly.
- Unit tests: `pytest tests/test_flow_matching.py` -> 2 passed.

## Notes

- Lesson: this bug traces to an early design choice to keep the *entire* loss path in the model
  dtype. The dtype boundary belongs at the loss output, not the loss internals — worth auditing
  the other losses for the same mistake.
- Hardware note: the fp32 reduction adds ~2% step time on A100; acceptable per the scope agreement.
