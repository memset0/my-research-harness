## Why

`openspec validate --all --strict` fails on 29 canonical specs whose Purpose is
still the `TBD - created by archiving change …` placeholder, so strict
validation cannot be used as a gate. Several canonical requirements also
contradict the shipped behavior or each other, which misleads agents that treat
the specs as the source of truth.

## What Changes

- Replace the placeholder Purpose of 29 canonical specs with a 2–4 sentence
  English Purpose (what the capability is, who it serves, its boundary, and
  where its source of truth lives). Purpose is not a requirement, so these are
  direct edits to `openspec/specs/<name>/spec.md`, not deltas.
- Fix four contradictory requirement areas through MODIFIED/REMOVED (and one replacing ADDED) deltas, synced at archive:
  1. `wiki-cli`: the command-group requirement lists `stale`, `data` and
     `components` subcommands that are not registered (and `stale` is forbidden
     elsewhere in the same spec). The list is corrected to the registered set.
  2. `experiment-readme` / `web-layout`: "fixed emoji prefix" status rendering
     contradicts the lucide-icon Badge actually rendered. The duplicated Run
     status-enum requirement in `experiment-readme` is removed (the `run-readme`
     copy is authoritative); the ExperimentStatus requirement drops its emoji
     table; the `web-layout` status-display requirement is aligned with the
     shipped icons/colours and states precisely which files carry emoji on disk.
  3. `run-edit`: "Run-side warnings do not exist in v3" is replaced by an
     accurate description — Runs store no warnings, and `memon run warning add`
     is a deprecated compatibility entry that writes through to the parent
     Experiment's `## Warnings`.
  4. `experiment-edit`: the obsolete `## Plan` editing requirement is removed;
     `memon experiment status set` and the Web README PUT are rewritten for the
     bundle path `docs/experiments/E<NNNN>-<slug>/README.md` and invocation
     receipts instead of the legacy journal file.
- No code, test, skill or release-version change. Structural reorganisation of
  the spec tree is listed as future work only.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `wiki-cli`: the `memon wiki` command-group requirement lists only registered subcommands.
- `experiment-readme`: the Run status-enum duplicate is removed and ExperimentStatus no longer prescribes emoji rendering.
- `web-layout`: the status-display requirement matches the shipped icon/colour mapping and the on-disk emoji scope.
- `run-edit`: "Run-side warnings do not exist in v3" is removed and replaced by a requirement describing no Run-side storage plus the write-through compatibility entry.
- `experiment-edit`: the `## Plan` requirement is removed; status set and README PUT use the bundle path and invocation receipts.

## Impact

- Documentation only: `openspec/specs/**` (29 Purpose edits now; requirement
  deltas synced at archive) and `openspec/changes/tidy-canonical-specs/**`.
- No runtime, CLI, Web, skill, filesystem or release-version impact.
