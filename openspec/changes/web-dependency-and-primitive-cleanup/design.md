## Context

See proposal.md - Why. `components.json` already exists from a real
`shadcn init` (style `radix-mira`, base color `mist`, lucide icons), so
`shadcn add <names> --overwrite --yes` runs non-interactively. Every other
file under `components/ui/` imports from the `radix-ui` aggregate package and
the CSS imports `tw-animate-css`, not `tailwindcss-animate`. `biome.json`
already excludes `components/ui/` (v6.19.0).

Two Web files carry their own atomic-write helper and are being changed by a
concurrent task; this change does not touch them.

## Goals / Non-Goals

**Goals:**
- Zero declared-but-unimported Web dependencies among the audited candidates.
- The four primitives are byte-for-byte CLI output; any divergence lives in a
  wrapper.
- Confirmation prompts render inside the themed dialog layer.

**Non-Goals:**
- Unifying relative imports vs. the `@/` alias.
- Touching `sidebar.tsx` (confirmed upstream) or other primitives.
- Replacing `js-yaml` with `yaml` (both are used; consolidating is a separate
  refactor).

## Decisions

- **Verify each removal by grep, not by tooling.** Each candidate is grepped
  across `.ts/.tsx/.css/.mjs` sources; only zero-reference packages are
  removed. Alternative (depcheck/knip) adds a tool for a one-off sweep.
- **Regenerate, then reconcile through wrappers.** After regeneration, every
  export the app imports is checked against the generated file. Upstream
  context-menu already provides `Sub`, `SubTrigger`, `SubContent`, `Label` and
  `Separator`, so the earlier hand-appended Sub family is expected to be
  replaced by upstream code. If an app call site depends on non-upstream
  styling, that styling is passed through `className` at the call site or a
  wrapper in `components/` (F3 pattern, cf. `colored-badge.tsx`).
- **Controlled AlertDialog state.** Each confirm site keeps a pending-action
  state (`pendingSha` / pending unverify target); the AlertDialog opens when it
  is set, Cancel clears it, the action button performs the original effect.
  This keeps the existing click handlers synchronous and testable without
  mocking `window.confirm`.
- **Render verification on an isolated host.** The checkout's `.next` is not
  the live deployment's build, so `next build` in the checkout is safe. The
  verification host runs on a spare port with a scratch config that points at
  scratch copies of the mock projects and has no central block; it is stopped
  and its config (with the first-run password) deleted afterwards.

## Risks / Trade-offs

- [Upstream primitive styling differs from the hand-written one (density,
  ring vs. border)] → accept the upstream look unless a call site visibly
  breaks; restore only via call-site `className` or a wrapper.
- [Removing a package another package resolves transitively at runtime] →
  `pnpm -r typecheck`, `next build`, and the full Web test suite must pass
  after removal.
- [Concurrent agent edits in the same working tree] → stage exact paths only.
