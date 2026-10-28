## 1. Implementation

- [x] 1.1 Sidebar: flat project list with Host chips, saved drag order, section nodes with item lists, auto-open and scroll-into-view of the current item, no reads from restored expansion
- [x] 1.2 AppBar: keep tabs and counts, ordered Wiki, Experiments, Reports, Code Review, Journal
- [x] 1.3 Reports: remove the rail, toggles and mobile drawer; card index with content filters
- [x] 1.4 Wiki: remove the rails and toggles; card index with content, kind and text filters
- [x] 1.5 Update sidebar, AppBar, Report and Wiki shell tests to the new navigation
- [x] 1.6 Document header with Details toggle; hosted HTML/service embeds fill the body with controls in the header; no Edit for them
- [x] 1.7 Tests: hosted embed toolbar, header Details and Edit only for Markdown Reports
- [x] 1.8 Header line shows title and relative update time, toggles on click with a leading indicator; remove the Report and Wiki quick switchers
- [x] 1.9 Report, Wiki and Experiment panes fill the layout scroller instead of a viewport calc, so the page no longer scrolls the header under the AppBar

## 2. Verification

- [x] 2.1 Rendered checks (local dev server): Report index, Report page with the tree revealed, Wiki index, an HTML service Report and a Markdown Report header
