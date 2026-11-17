# Proposal

## Why

On a service Report or Wiki page the share dialog defaults to "This page only", which issues a link that opens the page shell but not its live application; the owner has to notice and pick a separate "Service" option. Owners twice sent such links and recipients saw only "Sign in as the owner, or open a service link". The owner decided that on a service page "This page only" means the page together with its service.

## What Changes

- On a service Report or Wiki page, "This page only" (still the default) issues a service link. The separate "Service" choice is removed from the dialog.
- With that choice selected on a service page, the dialog states that recipients can use the live application fully, including any writes it makes.
- With "Whole project" selected on a service page, the dialog states that the link does not reach this page's live application.
- While the dialog is still determining whether the current Report or Wiki page is a service, creating a page link is unavailable (a whole-project link stays available), so a shell-only link cannot be issued by a fast click.
- Unchanged: the `POST /api/shares` contract, gateway admission, and every existing record. Page links issued earlier for service pages keep opening only the page shell and stay listed without the "Service" mark; they are not upgraded.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-share`: the share entry's "This page only" choice issues a service link on a service Report or Wiki page.

## Impact

- `apps/web/components/manage-shares-dialog.tsx` and its test. Central Web only; patch release. No API, CLI, skill or filesystem change.
