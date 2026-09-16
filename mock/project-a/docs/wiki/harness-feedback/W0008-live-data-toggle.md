---
id: W0008
kind: harness-feedback
title: Data blocks should show live vs saved capture
description: Proposal to let the dashboard re-run a data block's collector instead of comparing it against hand-pasted rows.
status: ACCEPTED
sources: [W0001, W0002]
tags: [components]
created_at: "2026-05-06T16:00:00+08:00"
updated_at: "2026-05-07T09:00:00+08:00"
---

# Data blocks should show live vs saved capture

## Motivation

While writing @W0001 and @W0002 the saved tables went out of date twice within a day; readers could not tell whether a number was current without re-running the collector by hand.

## Proposal

Let a data block carry its own collector and recompute on request instead of
holding hand-pasted rows. Recompute reports `updated`, `unchanged`, or `failed`;
a failing collector keeps the last good data and shows its error. Tracked as an
OpenSpec change in the harness repo.

## Status

Accepted; shipped as the executable payload of `datatable@1` — see the
`#fid_by_precond` block on @W0006 and `memon components run`.
