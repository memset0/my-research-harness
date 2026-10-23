## Why

Copying a listed whole-Project share link always yields the page it was issued from (often the Project root). The owner expects the copy action on any page of the Project to hand out a link to the page currently open, since the token can read the whole Project anyway.

## What Changes

- In the share dialog, copying a listed Project-scoped token link builds the URL from the current page (its path and query, any existing `share` parameter removed, no fragment) with `share=<token>` appended.
- Document-scoped links and public pages keep copying their own record link. Creating a link is unchanged (a new Project-scoped link already lands on the current page).

## Capabilities

### New Capabilities

### Modified Capabilities
- `project-share`: the share dialog copies Project-scoped links for the current page.

## Impact

`apps/web/components/manage-shares-dialog.tsx` and its test. Central-only: PATCH release.
