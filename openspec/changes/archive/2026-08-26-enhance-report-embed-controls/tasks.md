## 1. Resource Revision Contract

- [x] 1.1 Add stable resource version/ETag/Last-Modified headers to Report bundle assets and serve `HEAD` without reading the body.
- [x] 1.2 Classify authenticated Report asset `HEAD` requests as read operations and add route/auth regressions.

## 2. Reload and Change Detection

- [x] 2.1 Add a manual Reload action that reuses the probe lifecycle, remounts the iframe, and preserves the canonical URL.
- [x] 2.2 Poll the entry resource with low-frequency `HEAD` requests only while ready/visible and show an accessible semantic update dot without automatic reload.

## 3. Expanded View and Responsive Toolbar

- [x] 3.1 Replace browser Fullscreen API behavior with page-internal expanded mode, body-scroll locking, Escape exit, and drawer/split compatibility.
- [x] 3.2 Keep direct desktop actions and place all mobile actions behind a compact three-dot menu beside the title.
- [x] 3.3 Present mobile zoom as a persistent minus/percentage/plus stepper that stays open across repeated adjustments.

## 4. Multi-Embed Reliability

- [x] 4.1 Gate each lazy iframe load timeout on viewport proximity so below-fold plots remain mounted until the browser begins their navigation.
- [x] 4.2 Add regressions for multiple lazy embeds, timeout timing, manual reload, update polling, expanded mode, and mobile menu behavior.
- [x] 4.3 Add a regression proving repeated mobile zoom adjustments update the percentage without dismissing the menu.

## 5. Verification and Delivery

- [x] 5.1 Run focused route/component/browser tests, workspace type checks, production build, and strict OpenSpec validation.
- [x] 5.2 Deploy the verified build to port 3737 and confirm the authenticated service responds; leave archive/commit/push pending user confirmation.
