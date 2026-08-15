## 1. Core model and format

- [x] 1.1 Add v6 canonical sections, exact managed pointers, ordered lossless H2 parsing, and strict lint diagnostics.
- [x] 1.2 Add schema-versioned Implementation and Investigation recursive YAML schemas, normalized types, validators, and Markdown renderers.
- [x] 1.3 Add Results column/Variant schema, runs/attempts validation, lifecycle states, provenance, and Markdown renderer.
- [x] 1.4 Bump `FS_CONVENTION_VERSION` and export the YAML compatibility mapping.
- [x] 1.5 Update experiment creation/serialization to create the complete v6 bundle.

## 2. CLI

- [x] 2.1 Add structured section show/render commands with JSON and human-readable Markdown output.
- [x] 2.2 Add Experiment bundle validate/lint commands without YAML CRUD operations.
- [x] 2.3 Keep warning CLI commands functional and print permanent deprecation notices.

## 3. Web and reports

- [x] 3.1 Render all three structured sections through the shared Markdown projection.
- [x] 3.2 Render unsupported/duplicate legacy sections and managed conflicts with their real content plus diagnostics.
- [x] 3.3 Preserve readable legacy FS projects while blocking unsupported writes.
- [x] 3.4 Discover/read legacy and directory Reports; serve confined sibling assets with correct MIME types.
- [x] 3.5 Render local HTML image references as unsandboxed iframes and normal HTML links as links.
- [x] 3.6 Poll README, managed YAML, and bundle-directory mtimes separately; use README mtime for write locks.
- [x] 3.7 Preserve binary Report asset bytes across Hub/node RPC and link Results Runs to memon/W&B.
- [x] 3.8 Render Implementation and Investigation from the normalized YAML model as status-aware nested work trees.
- [x] 3.9 Prioritize Results at the top of Experiment detail, move Runs to the bottom, and render Results as an interactive horizontally scrollable table.
- [x] 3.10 Persist per-Experiment Results column visibility, editable multi-column default-sort badges, maximum cell lines, ordered left/right pins, AND row filters, and force row overrides in browser storage; keep header sorting temporary, use Variant ID as the default/tie-breaker, persist starred column names at Project scope, expose hide/pin/star header actions, clickable filter badges and row-context override actions, provide non-persistent row/column show-all toggles, and compact exact W&B URL values into chart-icon links with full-URL tooltips.
- [x] 3.11 Mirror owner Results preferences into a username-keyed SQLite database beside `config.yml`; make present server rows authoritative, migrate browser state only when the server row is absent, keep viewer/anonymous sessions browser-only, and never block client rendering on a server write.

## 4. Skills

- [x] 4.1 Add `memon-write-experiment-doc` and make it the shared semantic writer workflow.
- [x] 4.2 Rewrite `memon-drive`, `memon-run-experiment`, and `memon-write-script` around pre-run Variants and structured document routing.
- [x] 4.3 Update propose/digest/code-review/journal/report skills for v6 reads and links.
- [x] 4.4 Remove `memon-append-warning` from the bundled skill inventory.
- [x] 4.5 Make HTML Report directory creation explicit-user-only in the single report skill.

## 5. Migration

- [x] 5.1 Author the v5-to-v6 guide with persistent staging, per-experiment review, approval hashes, final all-at-once publish, backup, verification, and rollback.
- [x] 5.2 Provide deterministic scripts for mechanical bundle/YAML transformations and dry-run validation.
- [x] 5.3 Preserve ambiguous old content in staging until the user assigns it; never silently discard unsupported sections.
- [x] 5.4 Reject changed source/Experiment sets and validate staged bundles before any production copy.

## 6. Verification

- [x] 6.1 Add Core/CLI/Web/Skills tests for valid, legacy, conflict, missing-file, invalid-reference, and report-asset paths.
- [x] 6.2 Run package builds, typechecks, tests, lint, and production web build.
- [x] 6.3 Validate this OpenSpec change strictly and smoke a staged migration without touching a real project.
- [x] 6.4 Cover structured work trees, Results ordering, column controls, value-domain previews, line breaks, compact W&B links, persistent multi-column default sorting, temporary header sorting, Variant-ID fallback, ordered pinning with sticky-overflow fallback, four row-filter operators, badge editing, row-context force overrides, temporary show-all bypass, and browser preference restoration in Web tests.
- [x] 6.5 Cover owner/user isolation, missing-versus-explicit-empty SQLite semantics, local-to-server migration, server-over-local conflict resolution, guest local-only behavior, and non-blocking client updates.
