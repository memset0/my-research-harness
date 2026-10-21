## 1. Implementation

- [x] 1.1 Move the URL expanded-state hook into a shared module with an Expand toggle and a focused-pane hook (scroll lock, Escape); keep HTML bundle behaviour unchanged; verify existing content-presentation tests pass
- [x] 1.2 Add the Expand action and focused pane to full Markdown Report and Wiki pages; verify with component tests for the toggle, URL replacement, Escape and the HTML-page exclusion

## 2. Verification

- [ ] 2.1 Run the touched tests, web typecheck and Biome; after deployment confirm the served page code includes the new action
