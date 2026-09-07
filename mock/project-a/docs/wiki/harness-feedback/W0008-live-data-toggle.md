---
id: W0008
kind: harness-feedback
title: Data blocks should show live vs saved capture
description: Proposal to let the dashboard re-run a memon-data collector and compare it against the saved rows.
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

Add a Saved / Live toggle to the `memon-data` component. Live re-runs the block's collector without writing; a difference marks the saved view `stale`, a failing collector shows `collector broken` with stderr. Tracked as an OpenSpec change in the harness repo.

## Status

Accepted; shipped with the `wiki-system` change.
