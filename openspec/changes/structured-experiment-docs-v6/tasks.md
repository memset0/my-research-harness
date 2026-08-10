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
