## Why

`figure@1` shipped inside `component-system-v2` (document-relative `image`, caption, description, served through the path-safe document asset route). What that change did not carry over from this one is the authoring boundary for images: which images an agent may insert, how agent-drawn SVG must be constrained, and how descriptions must be grounded. Without it the `memon-components` skill lets an agent hotlink or download unapproved images or write descriptions it never verified.

## What Changes

- Add image-authoring guidance to the `memon-components` skill: keep images beside the document (`<stem>__assets/`), preserve user-provided bytes, ask before downloading or inserting images the user did not supply or authorize, never hotlink, keep agent-drawn SVG self-contained (no scripts, event handlers, `foreignObject`, or external resources), and ground descriptions in the actual image.
- Record in the `document-components` spec that the figure renders SVG as an image element, never as injected markup.
- The original shared `docs/wiki/assets/<slug>` storage, slug/basename rule, and `memon wiki components show figure@1` reference are withdrawn; they were superseded by `component-system-v2`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-components`: `figure@1` SVG-as-image scenario.
- `memon-wiki-skill`: image authoring and authorization rules in `memon-components`.

## Impact

`packages/skills/memon-components/SKILL.md` (hand-written section) and its `.claude/skills` mirror; no runtime code. Skills are a distributed artifact, so this is a MINOR release.
