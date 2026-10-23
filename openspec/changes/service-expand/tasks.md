## 1. Implementation

- [x] 1.1 Add a `live` mode to `ReportHtmlEmbed` that mounts `src` directly and skips the HTML probe and revision polling
- [x] 1.2 Render the reachable live application through `ReportHtmlEmbed` in `content-presentation.tsx`, with URL-kept expansion on full pages
- [x] 1.3 Tests for live mode (no probe fetch, Expand works) and the service presentation passing expansion through

## 2. Verification

- [ ] 2.1 Run the touched tests, web typecheck and Biome; after deployment confirm the served bundle renders the toolbar on a live service page
