## 1. Preference Model

- [x] 1.1 Add normalized `columnOrderIds` persistence that appends newly discovered columns and ignores stale/duplicate IDs.
- [x] 1.2 Use the shared order for checkbox controls and table columns while retaining pin-side grouping.
- [x] 1.3 Include column order in reset behavior and the existing browser/SQLite preference payload.

## 2. Drag Interactions

- [x] 2.1 Make the complete checkbox control and each table header draggable column-order sources and targets.
- [x] 2.2 Make saved row-filter badges draggable and persist their displayed/evaluation priority.
- [x] 2.3 Make default-sort badges draggable and apply their new comparator priority immediately.
- [x] 2.4 Add restrained drag/drop visual states using the existing design language and remove redundant instructional paragraphs.
- [x] 2.5 Make sticky pinned header/body backgrounds fully opaque for normal, metric, and starred columns.

## 3. Verification and Delivery

- [x] 3.1 Add regressions for synchronized column dragging from both surfaces and refresh restoration.
- [x] 3.2 Add regressions proving filter order persistence and sort-rule dragging changes final row order.
- [x] 3.3 Run focused tests, type checking, formatting checks, strict OpenSpec validation, and a production build.
- [x] 3.4 Deploy the verified build to port 3737 without overwriting concurrent agents' source changes.
