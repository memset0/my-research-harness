## Why

Copying a command or snippet from rendered Markdown means selecting it by hand.

## What Changes

- Every ordinary fenced code block in rendered Markdown gets a "Copy all" button (top right, shown on hover or focus) that copies the block's plain text and briefly shows "Copied". Component blocks are unchanged.

## Capabilities

### New Capabilities
- `code-block-copy`: copy button on Markdown code blocks.

### Modified Capabilities

## Impact

`apps/web/components/{code-block,markdown}.tsx` and test. Central-only: PATCH release.
