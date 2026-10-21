## Why

Share links currently look like `/s/<token>`, which hides which page is being shared, and every reader needs a token. The owner wants a copied link to be the page's own address with the token carried in a query parameter, and wants some Reports and Wiki pages to be public so that anyone with the plain page address can read them.

## What Changes

- The copied share URL becomes the landing page's own URL plus `?share=<token>` (or `&share=` when the path already has a query). Opening it validates the token for that Project, adds it to the viewer cookie and redirects (302) to the same URL without the `share` parameter. Unknown, expired or other-Project tokens get the generic invalid-link page. Existing `/s/<token>` links keep working.
- Owners can make a Report or Wiki page public. Anyone opening that page's plain address, without login or token, can read that page and its own reads exactly as a document-scoped viewer would; everything else stays protected. Public pages are recorded in the central share registry, listed in the share dialog as "Public", and made private again by revoking the record.
- The share dialog copies the new URL form, offers "Make public" on Report and Wiki pages, and lists public pages.

## Capabilities

### New Capabilities

### Modified Capabilities
- `project-share`: page URL with `share` query as the issued link; public Report/Wiki pages in the registry and dialog.
- `auth-system`: token redemption from the `share` query; anonymous access to public document reads.

## Impact

`apps/web` (registry record flag, `/api/shares`, middleware, central gateway authorization, share dialog). Central-only: PATCH release.
