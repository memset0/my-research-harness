---
id: W0010
kind: note
title: Checklist component example
description: A recursive checklist with independent Agent and human flags.
tags: [components, checklist]
created_at: 2026-09-11T09:00:00+00:00
updated_at: 2026-09-11T09:00:00+00:00
---

# Checklist component example

## Release gate

Every flag below is independent: the Agent marks its own completion, the
human marks what they have seen and what they have reviewed.

```yaml checklist@1 #release_gate
items:
  - title: Collect baseline measurements
    content: |
      Run the baseline on every configured host.
      Record wall time and peak memory in the Experiment.
    status:
      agent_completed: true
    children:
      - title: Host A
        status:
          agent_completed: true
          human_acknowledged: true
      - title: Host B
  - title: Write up the comparison
  - title: Empty subtree with no description
    children: []
```
