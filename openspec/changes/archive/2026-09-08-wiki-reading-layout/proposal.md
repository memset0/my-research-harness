## Why

The wiki's whole-page unverified styling resembles a quotation and distracts from reading. Wide text and a detached outline make scanning long pages harder.

## What Changes

- Remove the quote-like decoration around unverified page bodies while retaining review metadata and changed-line indicators.
- Limit document content to 720px and center it together with its adjacent desktop outline.
- Hide the outline on mobile, including the existing inline outline.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wiki-viewer`: Refine reading width, outline placement, mobile visibility, and whole-page unverified presentation.

## Impact

Wiki rendering and focused component tests only; no API, persistence, or dependency changes.
