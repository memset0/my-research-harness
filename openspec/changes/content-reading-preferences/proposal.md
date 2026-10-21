## Why

An operator who temporarily disables translation still sees its controls and availability errors. HTML Wiki and Report entries also need useful descriptions without constraining the artifact itself.

## What Changes

- Honor the existing translation environment switch in the initial browser runtime configuration: disabled instances render original content without translation controls, shortcuts or background probes.
- Keep enabled translation behavior and server authorization intact.
- Teach Wiki and Report authors to maintain a concise `description` in HTML manifests, including examples. Preserve compatibility with older manifests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `body-translation`: hide the optional reading mode when disabled by the operator.
- `memon-skills`: maintain useful descriptions for HTML content entries.

## Impact

Central runtime bootstrap, translation component and focused tests; shared Wiki/Report authoring references. No filesystem migration or provider protocol change. Project content conversions are separate operator work.
