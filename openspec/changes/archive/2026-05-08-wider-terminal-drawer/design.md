## Context

`tmux-session-rework` shipped the lifted `TerminalDrawerProvider` with
the same `SheetContent` width the original `TerminalSheet` used:
`w-[min(95vw,960px)] sm:max-w-[960px]`. With CLI agents (claude code,
codex) running in the iframe, 960px is cramped — long tool-call
output and side-by-side prompts wrap awkwardly.

## Goals / Non-Goals

**Goals:**
- More horizontal room for the terminal iframe without making the
  drawer dominate the viewport.
- Cap to 80vw on smaller screens so the underlying page peeks through.

**Non-Goals:**
- Make the drawer resizable. Out of scope; users who want different
  sizes can use Pop out (a separate full popup window) or open in a
  real terminal via `tmux attach`.
- Touch the legacy `terminal-sheet.tsx` width. That component is on a
  deletion track and not worth a one-line edit.

## Decisions

### D1. New value: `w-[min(80vw,1280px)] sm:max-w-[1280px]`

- **Desktop ceiling:** 1280px. Big enough to fit two side-by-side
  ~500ch lines comfortably; standard "wide-but-not-fullscreen" feel.
  At 1920px wide it's 67% of viewport.
- **Small-screen cap:** 80vw. At 1024px wide that's 819px (vs the old
  973px from 95vw). The user explicitly asked for "不超过屏幕宽度的
  80%". Below ~1600px the 80vw cap dominates over the 1280px cap.

Alternatives considered:
- 1100px: too close to the old 960; not worth the change.
- 1440px: dominates anything < 1800px wide; no breathing room.
- 1280px is a common content-width breakpoint and reads as "wide
  drawer" without becoming the page itself.

## Risks / Trade-offs

- [Risk] Users on narrower laptops (< 1280px) get the 80vw cap as
  the actual width, which is wider than before in some cases. →
  Mitigation: 80vw on a 1280px laptop is 1024px, only marginally
  larger than the old 95vw=1216px or the 960px cap (whichever was
  smaller). Most laptops are 1440px+.
- [Risk] Some pages have contextual sidebars / panels that get
  squeezed. → Mitigation: 20vw of the underlying page still shows;
  the user can close the drawer (without losing session) for
  full-width.
