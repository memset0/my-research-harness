## Why

The bundled SKILL.md files embed sample Chinese-language dialogue at the points where the agent should switch from English instructions to talking-to-the-user-in-Chinese. The placement convention is mostly consistent — markdown blockquote (`> ...`), preceded by a prose sentence that ends with `(in Chinese)` so the agent knows the next quoted text is the literal phrasing to use. But a handful of occurrences drift from the convention:

- Some blockquotes have no `(in Chinese)` prefix on the preceding prose, leaving an agent reading just one section unsure whether the next blockquote is a Chinese sample or some other quoted matter.
- One blockquote wraps its content in `"..."` quotes inside the `>` lines — redundant since the blockquote IS already a quoting device.
- One uses `(Chinese)` and one uses `In Chinese:` instead of the canonical `(in Chinese):` form.
- One has a typo where a `>` line lacks the trailing space (`>能走完整的` instead of `> 能走完整的`).

Standardising these makes "is this a Chinese-dialogue sample?" answerable from local context alone (no scrolling), and makes a future grep-based audit (e.g. CI) feasible.

## What Changes

Standardise on this exact convention everywhere a SKILL.md embeds Chinese dialogue:

```
... <prose ending with the marker> (in Chinese):

> <Chinese line 1>
> <Chinese line 2>
> ...
```

The prose introducing the blockquote ends with the literal `(in Chinese)` followed by a colon. The blockquote itself contains plain Chinese prose — no surrounding `"..."` quotes (the `>` is the quote).

Specific edits:

- `memon-write-script/SKILL.md` — two fixes:
  - Line ~287: change `**ask the user**:` → `**ask the user** (in Chinese):`. Remove the `"..."` quotes wrapping the two blockquote lines that follow.
  - Line ~533: change `just offer:` → `just offer (in Chinese):`.
- `memon-run-experiment/SKILL.md` — two fixes:
  - Line ~115: change `In Chinese:` → `(in Chinese):` (preceding prose tweak).
  - Line ~946: fix `>能走完整的` → `> 能走完整的` (add the missing space after `>` so the markdown blockquote line renders as part of the quote, not as a heading-adjacent fragment).
- `memon-migrate-fs/SKILL.md` — two fixes:
  - Line ~83: change `Embed the prompt as user-facing dialogue (Chinese):` → `Embed the prompt as user-facing dialogue (in Chinese):`.
  - Line ~187: insert a one-line prose lead-in `Tell the user (in Chinese):` immediately before the existing `> 迁移完成。…` blockquote.
- `memon-append-warning/SKILL.md` — already uses the convention; no edits.
- The other 4 SKILL.md files have no inline Chinese dialogue blocks; no edits.

Out of scope:
- Inline Chinese phrases that are NOT dialogue (e.g. agent-facing bullets in `memon-run-experiment` §9 that mix Chinese in a list of "what to cover when walking the user through" — those are notes to the agent about content, not literal sample dialogue, and the existing form is fine).
- Parenthetical example phrasings in regular prose (e.g. `(e.g. "claude code 容器里没开放外网访问,需要你 yolo 一下")` in `memon-run-experiment` §"Network / auth failures" — these are illustrative, not dialogue blocks, and don't need the blockquote treatment).

Acceptance gate:
- Every blockquote in a SKILL.md whose content contains Chinese characters is preceded (within the same paragraph or list item) by prose ending in `(in Chinese):`.
- No SKILL.md contains the variants `(Chinese):` or `In Chinese:` as the lead-in to a Chinese blockquote.
- No `>` line in a Chinese blockquote starts with a non-space character (i.e. all `>` lines have either nothing or a space after the `>`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memon-skills`: ADD a requirement that inline Chinese dialogue uses the `(in Chinese):` + blockquote convention consistently.

## Impact

- **Code**: none.
- **Docs / skill bodies**: 3 SKILL.md files (`memon-write-script`, `memon-run-experiment`, `memon-migrate-fs`).
- **Specs**: delta on `memon-skills`.
- **No runtime changes**.
- **Migration risk**: zero. Pure formatting normalisation.
