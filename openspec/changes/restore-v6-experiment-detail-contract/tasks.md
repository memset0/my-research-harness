## 1. Shared Contract and Projection

- [x] 1.1 Move the canonical Experiment document display projection into Core and verify existing projection/lint/render tests pass unchanged.
- [x] 1.2 Add bounded strict protocol schemas for raw sections, diagnostics, sanitized managed documents, display sections, read-only state, and Results update metadata; verify unsafe paths/raw/extra fields fail.

## 2. Backend and Standalone Serialization

- [x] 2.1 Extend ID-addressed Backend Experiment detail serialization with the safe v6 payload while keeping list summaries compact; verify real-like Implementation/Investigation/Results fixtures and path-redaction tests.
- [x] 2.2 Adapt standalone detail to the shared serializer/projection and remove duplicate Web-only logic; verify standalone behavior remains equivalent.

## 3. Central and Browser Enforcement

- [x] 3.1 Update public Experiment types/client validation so supported split Backends require v6 detail fields; verify missing fields fail as compatibility errors instead of invoking legacy fallback.
- [x] 3.2 Add combined page tests rendering structured Implementation, Investigation, and Results Variants through a Host-qualified ProjectTarget while forbidding legacy Plan/Caveats.
- [ ] 3.3 Verify live representative Experiment API and desktop/mobile page output contain managed content, no absolute paths, and no silent downgrade.

## 4. Release

- [ ] 4.1 Run Core/Backend/CLI/Web focused and contract tests, typechecks, lint, production build, and security/path-redaction regression tests.
- [ ] 4.2 Commit implementation separately, publish the Backend/CLI Minor as `release: vMAJOR.MINOR.PATCH`, update central first, reinstall the exact Backend revision, and retain rollback.
