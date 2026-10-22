## Why

Service Reports and Wiki pages forward live applications whose requests need not be read-only, so ordinary share links (whole Project, one page, public pages) correctly never reach them. The owner still wants to hand one particular service to someone deliberately.

## What Changes

- A new share kind: a **service link** for one service Report or Wiki page. It is issued only on request from the share dialog of that page, carries its own token and link (the page URL with `share=<token>`), and is listed and revocable like other links (shown as "Service · Report R0010").
- A service token admits that document's page and reads (like a page link) plus every HTTP method and WebSocket of exactly that service through the content-service gateway. It grants no other service and nothing else in the Project.
- Project, page and public grants still never reach a service. A browser may hold a service token beside other tokens of the same Project (the viewer cookie already holds several); their grants add up.
- Creating a service link for a document whose presentation is not `service` is refused. Services can never be public.
- Viewers holding the grant see the live application on the page; others keep the owner-only notice.

## Capabilities

### New Capabilities

### Modified Capabilities
- `project-share`: owners can issue service links; grants of several tokens combine.
- `content-bundles`: service forwarding admits the owner or a service grant for exactly that document.

## Impact

`apps/web/lib/server/share-registry.ts`, `share-validator.ts`, `share-api.ts`, `auth/identity.ts`, `central/server-auth.ts`, `content-service-gateway.ts`, `server.ts`, `app/api/shares/route.ts`, `lib/dto/shares.ts`, `components/manage-shares-dialog.tsx`, `components/content-presentation.tsx` and their tests. Central-only: PATCH release.
