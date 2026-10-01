## 1. Purposes (direct canonical edits)

- [x] 1.1 Replace the placeholder Purpose of the experiment, run and filesystem specs (`archive-frontmatter`, `experiment-discovery`, `experiment-edit`, `experiment-membership-anomalies`, `experiment-readme`, `experiment-results-views`, `structured-experiment-sections`, `run-edit`, `run-readme`, `hypotheses`, `fs-migration-runtime`, `fs-version-tracking`) after checking each against its code; verify with `openspec validate <name> --type spec --strict`
- [x] 1.2 Replace the placeholder Purpose of the git and code specs (`git-status`, `git-diff-dialog`, `git-history-dialog`, `git-submodules`, `git-submodule-bump-diff`, `code-preview`, `markdown-link-preview`, `code-review-store`, `code-review-viewer`) after checking each against its code; verify with `openspec validate <name> --type spec --strict`
- [ ] 1.3 Replace the placeholder Purpose of the documents, viewer and tooling specs (`document-components`, `component-execution`, `reports-store`, `log-viewer`, `log-viewer-tools`, `theme-switching`, `dev-route-prewarm`, `test-suite`) after checking each against its code; verify with `openspec validate <name> --type spec --strict`
- [ ] 1.4 Confirm no spec described a removed feature (otherwise use a `Deprecated: … superseded by …` Purpose and list it as a retirement candidate); verify `grep -l 'TBD' openspec/specs/*/spec.md` finds no Purpose placeholder

## 2. Contradiction deltas

- [ ] 2.1 Verify the `wiki-cli` delta against the registered `memon wiki --help` subcommands
- [ ] 2.2 Verify the `experiment-readme` and `web-layout` deltas against `apps/web/components/status-pill.tsx` and the `run-readme` status requirement
- [ ] 2.3 Verify the `run-edit` delta against `packages/cli/src/commands/run-warning.ts` and the warning deprecation notice
- [ ] 2.4 Verify the `experiment-edit` delta against `CANONICAL_EXPERIMENT_SECTION_HEADINGS` and `runExperimentStatusSet`
- [ ] 2.5 Run `openspec validate tidy-canonical-specs --type change --strict` and confirm it passes

## 3. Verification

- [ ] 3.1 Run `openspec validate --specs --strict` and confirm 71/71 canonical specs pass
