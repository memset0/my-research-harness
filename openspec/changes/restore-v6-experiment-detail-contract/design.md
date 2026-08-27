## Context

The v6 parser already discovers the canonical README section order and loads `implementation.yaml`, `investigation.yaml`, and `results.yaml`. The standalone route combines that Core `Experiment` with a Web-only display projector. The split Backend DTO omits `rawSections` and `documents`; central proxying bypasses the standalone route, so `ExperimentPage` invokes its explicit old-payload fallback and synthesizes Motivation/Method/Plan/Conclusion/Caveats.

Live evidence for a representative Experiment shows valid canonical raw sections, 24 Implementation items, 27 Investigation items, 54 Results Variants, no YAML parse errors, and no populated legacy Method/Plan/Caveats. The source data is correct; loss occurs solely at the service contract.

## Goals / Non-Goals

**Goals:**

- Preserve every user-visible v6 managed-document behavior through central.
- Use one canonical display projection in Core for standalone and Backend.
- Keep wire data strict, portable, bounded, and free of absolute paths/raw filesystem authority.
- Make a missing current-release v6 payload a contract error instead of a legacy downgrade.

**Non-Goals:**

- Changing YAML schemas, canonical section headings, or filesystem layout.
- Sending absolute document paths or using central to read cluster files.
- Adding managed-document bodies to Experiment list responses.

## Decisions

### Core owns the normalized display projection

Move the projection currently implemented in the Web server layer into Core beside parsing/lint/render logic. Web re-exports or imports it, and Backend calls the same function. This prevents the standalone and split paths from drifting again.

### Backend detail sends sanitized structured documents

Add strict protocol schemas for raw section descriptors, diagnostics, Implementation/Investigation/Results data, sanitized parsed-document envelopes, display sections, and document read-only/update metadata. Envelopes contain a relative `resource` and parsed `data`; they omit absolute `path`, raw YAML bytes, and unknown `extra` fields not used by the UI.

### Lists stay compact

`BackendExperimentSummary` remains list-oriented. Only `BackendExperimentDetail` adds managed documents and display projection. Results refresh continues using the dedicated results route.

### Current central releases cannot silently invoke the legacy fallback

The Web may retain legacy fallback only for standalone compatibility payloads explicitly identified as legacy. A current/prior supported split Backend missing the v6 detail fields is misconfigured/incompatible, not a reason to show deprecated sections as though they were canonical.

## Risks / Trade-offs

- [Recursive managed-item schemas are large] → Define bounded recursive Zod schemas with maximum arrays/strings and omit unused `extra` data.
- [Projection contains run links] → Backend emits portable content; Web constructs Host-qualified links from ProjectTarget and structured data.
- [Larger detail response] → Documents appear only on detail; list payload remains unchanged and SSH compression is enabled.
- [Legacy standalone fixtures rely on fallback] → Keep explicit legacy tests while adding current-contract tests that forbid fallback.

## Migration Plan

1. Add shared schemas/projection and Backend serialization with contract tests.
2. Adapt standalone route to the same safe payload and update Web types.
3. Remove silent central legacy downgrade and add browser rendering tests.
4. Verify representative live Experiment fields and no path leakage.
5. Commit implementation separately, publish a new Backend/CLI Minor release, update central first, reinstall Backend, and retain the prior release for rollback.
