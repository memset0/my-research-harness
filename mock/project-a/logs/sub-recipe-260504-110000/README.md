---
id: sub-recipe-260504-110000
name: sub-recipe
project: image-generation
status: FINISHED
created_at: 2026-05-04T11:00:00+08:00
finished_at: 2026-05-04T12:30:00+08:00
host: gpu-node-09
pid: 99221
gpus: [0, 1]
entry: ./train.sh
command: bash train.sh --recipe=image-generation --bs=64
wandb: null
hypotheses: [H0001]
tags: [recipe-style, sub-project-demo]
---

## Motivation

Fixture demonstrating the **sub-project label** semantic introduced by
`project-membership-from-config`: this experiment lives under the memon
project `project-a` (per `config.yml`) but its front-matter `project:`
field is set to `image-generation`, mimicking the sparse-fsdp layout where
one workspace contains experiments tagged with finer-grained recipe names.

Verifies in the web UI:
- Experiment list row shows an "image-generation" badge next to the id.
- Detail page shows "Project: project-a" + "Sub-project: image-generation"
  as separate rows.
- Filter `?project=project-a` includes this experiment (membership unchanged).
- Filter `?project=image-generation` excludes it (front-matter is not
  consulted for membership).

## Setup

n/a — fixture only.

## Method

n/a — fixture only.

## Result

n/a — fixture only.

## Conclusion

n/a — fixture only.

## Caveats

This experiment is a test fixture, not a real run.

## Artifacts

(none)
